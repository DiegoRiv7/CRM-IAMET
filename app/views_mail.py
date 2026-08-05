# app/views_mail.py
# Integrated mail module — IMAP read / SMTP send / Opportunity linking

import imaplib
import smtplib
import ssl
import json
import base64
import re
import mimetypes
import email as email_lib
import email.header
import email.utils
import email.mime.multipart
import email.mime.text
import email.mime.base
from email.mime.image import MIMEImage
from email.mime.application import MIMEApplication
from email.mime.audio import MIMEAudio
import logging
import threading
from email.encoders import encode_base64
from datetime import datetime, timezone

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.db import connections
from django.db.models import Count, Max, Q
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils import timezone as django_tz

from .models import (
    MailConexion, MailCorreo, MailAdjunto, MailAccionPendiente,
    TodoItem, OportunidadActividad, MensajeOportunidad, TareaOportunidad,
    Actividad, MailPlantilla, MailBorrador, MailProgramado, mail_hilo_key,
)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Encryption helpers
# ─────────────────────────────────────────────────────────────────────────────

def _encrypt_password(plain: str) -> str:
    key = settings.MAIL_ENCRYPTION_KEY
    if not key:
        return plain  # Fallback: store plain if no key configured
    try:
        from cryptography.fernet import Fernet
        f = Fernet(key.encode() if isinstance(key, str) else key)
        return f.encrypt(plain.encode()).decode()
    except Exception as exc:
        logger.error("Mail encrypt error: %s", exc)
        return plain


def _decrypt_password(encrypted: str) -> str:
    key = settings.MAIL_ENCRYPTION_KEY
    if not key:
        return encrypted
    try:
        from cryptography.fernet import Fernet
        f = Fernet(key.encode() if isinstance(key, str) else key)
        return f.decrypt(encrypted.encode()).decode()
    except Exception as exc:
        logger.error("Mail decrypt error: %s", exc)
        return encrypted


# ─────────────────────────────────────────────────────────────────────────────
# IMAP / SMTP connection helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_imap(conexion: MailConexion):
    ctx = ssl.create_default_context()
    password = _decrypt_password(conexion.password_encriptado)
    if conexion.imap_usar_ssl:
        imap = imaplib.IMAP4_SSL(conexion.imap_servidor, conexion.imap_puerto, ssl_context=ctx)
    else:
        imap = imaplib.IMAP4(conexion.imap_servidor, conexion.imap_puerto)
        imap.starttls(ssl_context=ctx)
    imap.login(conexion.correo_electronico, password)
    return imap


def _get_smtp(conexion: MailConexion):
    password = _decrypt_password(conexion.password_encriptado)
    if conexion.smtp_usar_ssl:
        ctx = ssl.create_default_context()
        smtp = smtplib.SMTP_SSL(conexion.smtp_servidor, conexion.smtp_puerto, context=ctx)
    else:
        smtp = smtplib.SMTP(conexion.smtp_servidor, conexion.smtp_puerto)
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
    smtp.login(conexion.correo_electronico, password)
    return smtp


def _detect_sent_folder(imap) -> str:
    """Try common sent-folder names and return the first one that exists."""
    candidates = ['Sent', 'Sent Items', 'Enviados', 'INBOX.Sent', '"[Gmail]/Sent Mail"']
    typ, folder_list = imap.list()
    available = ' '.join(str(f) for f in folder_list).lower() if folder_list else ''
    for name in candidates:
        if name.lower().replace('"', '') in available:
            return name
    return 'Sent'


# ─────────────────────────────────────────────────────────────────────────────
# Header parsing helpers
# ─────────────────────────────────────────────────────────────────────────────

def _decode_header_value(raw) -> str:
    """Decode RFC 2047 encoded header value to plain Unicode string."""
    if not raw:
        return ''
    parts = email.header.decode_header(raw)
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            result.append(part.decode(enc or 'utf-8', errors='replace'))
        else:
            result.append(str(part))
    return ''.join(result)


def _parse_address(raw) -> tuple:
    """Return (name, email) from a raw address header."""
    name, addr = email.utils.parseaddr(raw or '')
    name = _decode_header_value(name)
    return name.strip(), addr.strip().lower()


def _parse_message_headers(msg) -> dict:
    """Extract key header fields from an email.message.Message object."""
    subject = _decode_header_value(msg.get('Subject', ''))
    from_name, from_addr = _parse_address(msg.get('From', ''))

    # Parse To + CC into list of dicts
    destinatarios = []
    for header in ('To', 'CC'):
        raw = msg.get(header, '')
        if raw:
            for addr_tuple in email.utils.getaddresses([raw]):
                dest_name = _decode_header_value(addr_tuple[0])
                dest_email = addr_tuple[1].strip().lower()
                if dest_email:
                    destinatarios.append({'nombre': dest_name, 'email': dest_email})

    # Parse date
    fecha = None
    date_str = msg.get('Date', '')
    if date_str:
        try:
            fecha = email.utils.parsedate_to_datetime(date_str)
            if fecha.tzinfo is None:
                fecha = fecha.replace(tzinfo=timezone.utc)
        except Exception:
            fecha = None

    return {
        'asunto': subject,
        'remitente_nombre': from_name,
        'remitente_email': from_addr,
        'destinatarios': destinatarios,
        'fecha': fecha,
        'message_id': (msg.get('Message-ID') or '').strip(),
        'in_reply_to': (msg.get('In-Reply-To') or '').strip(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Views
# ─────────────────────────────────────────────────────────────────────────────

@login_required
def mail_home(request):
    try:
        conexion = MailConexion.objects.get(usuario=request.user)
        tiene_conexion = True
        correo_electronico = conexion.correo_electronico
        ultima_sync = conexion.ultima_sincronizacion
    except MailConexion.DoesNotExist:
        tiene_conexion = False
        correo_electronico = ''
        ultima_sync = None

    return render(request, 'mail.html', {
        'tiene_conexion': tiene_conexion,
        'correo_electronico': correo_electronico,
        'ultima_sincronizacion': ultima_sync,
    })


@login_required
@csrf_exempt
@require_http_methods(['GET', 'POST'])
def api_mail_conexion(request):
    if request.method == 'GET':
        conexiones = MailConexion.objects.filter(usuario=request.user)
        if not conexiones.exists():
            return JsonResponse({'ok': False, 'tiene_conexion': False})
        
        lista = []
        for c in conexiones:
            lista.append({
                'id': c.id,
                'correo_electronico': c.correo_electronico,
                'imap_servidor': c.imap_servidor,
                'imap_puerto': c.imap_puerto,
                'imap_usar_ssl': c.imap_usar_ssl,
                'smtp_servidor': c.smtp_servidor,
                'smtp_puerto': c.smtp_puerto,
                'smtp_usar_ssl': c.smtp_usar_ssl,
                'activo': c.activo,
                'firma_html': c.firma_html or '',
                'ultima_sincronizacion': c.ultima_sincronizacion.isoformat() if c.ultima_sincronizacion else None,
            })
        return JsonResponse({'ok': True, 'tiene_conexion': True, 'conexiones': lista})

    # POST — save/update connection
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    correo = data.get('correo_electronico', '').strip()
    password_plain = data.get('password', '').strip()
    imap_srv = data.get('imap_servidor', 'mail.iamet.mx').strip()
    imap_puerto = int(data.get('imap_puerto', 993))
    imap_ssl = bool(data.get('imap_usar_ssl', True))
    smtp_srv = data.get('smtp_servidor', 'mail.iamet.mx').strip()
    smtp_puerto = int(data.get('smtp_puerto', 465))
    smtp_ssl = bool(data.get('smtp_usar_ssl', True))

    if not correo or not password_plain:
        return JsonResponse({'ok': False, 'error': 'Correo y contraseña son requeridos'}, status=400)

    # Test connection before saving
    try:
        test_con = MailConexion(
            usuario=request.user,
            correo_electronico=correo,
            imap_servidor=imap_srv,
            imap_puerto=imap_puerto,
            imap_usar_ssl=imap_ssl,
            smtp_servidor=smtp_srv,
            smtp_puerto=smtp_puerto,
            smtp_usar_ssl=smtp_ssl,
            password_encriptado=password_plain,  # plain for test only
        )
        imap = _get_imap(test_con)
        imap.logout()
    except imaplib.IMAP4.error as e:
        return JsonResponse({'ok': False, 'error': f'Error de autenticación IMAP: {e}'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': f'No se pudo conectar al servidor IMAP: {e}'}, status=400)

    # Save with encrypted password
    conexion, _ = MailConexion.objects.get_or_create(usuario=request.user, correo_electronico=correo)
    conexion.correo_electronico = correo
    conexion.imap_servidor = imap_srv
    conexion.imap_puerto = imap_puerto
    conexion.imap_usar_ssl = imap_ssl
    conexion.smtp_servidor = smtp_srv
    conexion.smtp_puerto = smtp_puerto
    conexion.smtp_usar_ssl = smtp_ssl
    conexion.password_encriptado = _encrypt_password(password_plain)
    conexion.activo = True
    conexion.save()
    return JsonResponse({'ok': True, 'message': 'Conexión configurada correctamente', 'conexion_id': conexion.id})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_sincronizar(request):
    conexion_id = request.GET.get('conexion_id')
    if not conexion_id:
        try:
            import json
            data = json.loads(request.body)
            conexion_id = data.get('conexion_id')
        except:
            pass
    try:
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Conexión no encontrada'}, status=400)

    try:
        imap = _get_imap(conexion)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': f'Error al conectar: {e}'}, status=500)

    nuevos_total = 0

    # ── Sync INBOX ──────────────────────────────────────────
    try:
        imap.select('INBOX', readonly=True)
        typ, data = imap.uid('SEARCH', None, 'ALL')
        all_uids = data[0].split() if data[0] else []
        uids_to_fetch = [u.decode() for u in all_uids[-50:]]  # Last 50

        existing_uids = set(
            MailCorreo.objects.filter(
                usuario=request.user, carpeta_imap='INBOX'
            ).values_list('uid_imap', flat=True)
        )
        new_uids = [u for u in uids_to_fetch if u not in existing_uids]

        # Pre-load message_ids of linked correos for auto-thread-linking
        linked_message_ids = {
            c.message_id: c.oportunidad_id
            for c in MailCorreo.objects.filter(
                usuario=request.user, oportunidad__isnull=False
            ).exclude(message_id='')
        }
        linked_hilos = {
            c.hilo_key: c.oportunidad_id
            for c in MailCorreo.objects.filter(
                usuario=request.user, oportunidad__isnull=False
            ).exclude(hilo_key='').exclude(hilo_key__startswith='solo-')
        }

        for uid in new_uids:
            try:
                typ, fetch_data = imap.uid(
                    'FETCH', uid.encode(),
                    '(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO CONTENT-TYPE)])'
                )
                if not fetch_data or fetch_data[0] is None:
                    continue

                raw_headers = fetch_data[0][1] if isinstance(fetch_data[0], tuple) else b''
                if not raw_headers:
                    continue

                msg = email_lib.message_from_bytes(raw_headers)
                parsed = _parse_message_headers(msg)

                # Detect attachments from raw response string
                raw_str = str(fetch_data)
                has_adj = ('attachment' in raw_str.lower() or '"application/' in raw_str.lower()
                           or 'multipart/mixed' in raw_str.lower())

                # Auto-thread-linking
                opp_id = None
                irt = parsed['in_reply_to']
                if irt and irt in linked_message_ids:
                    opp_id = linked_message_ids[irt]
                if not opp_id:
                    # Respuestas del mismo hilo (asunto normalizado) se van
                    # solas a la oportunidad ya vinculada
                    opp_id = linked_hilos.get(mail_hilo_key(parsed['asunto']))

                MailCorreo.objects.create(
                    usuario=request.user,
                    conexion=conexion,
                    uid_imap=uid,
                    carpeta_imap='INBOX',
                    carpeta_display='INBOX',
                    message_id=parsed['message_id'],
                    in_reply_to=parsed['in_reply_to'],
                    asunto=parsed['asunto'],
                    remitente_nombre=parsed['remitente_nombre'],
                    remitente_email=parsed['remitente_email'],
                    destinatarios_json=json.dumps(parsed['destinatarios'], ensure_ascii=False),
                    fecha_envio=parsed['fecha'],
                    leido=False,
                    tiene_adjuntos=has_adj,
                    oportunidad_id=opp_id,
                )
                nuevos_total += 1
            except Exception as exc:
                logger.warning("Error syncing INBOX uid %s: %s", uid, exc)
    except Exception as e:
        logger.error("INBOX sync error: %s", e)

    # ── Sync Sent ────────────────────────────────────────────
    try:
        sent_folder = _detect_sent_folder(imap)
        imap.select(sent_folder, readonly=True)
        typ, data = imap.uid('SEARCH', None, 'ALL')
        all_uids = data[0].split() if data[0] else []
        uids_to_fetch = [u.decode() for u in all_uids[-30:]]

        existing_sent_uids = set(
            MailCorreo.objects.filter(
                usuario=request.user, carpeta_imap=sent_folder
            ).values_list('uid_imap', flat=True)
        )
        new_sent_uids = [u for u in uids_to_fetch if u not in existing_sent_uids]

        for uid in new_sent_uids:
            try:
                typ, fetch_data = imap.uid(
                    'FETCH', uid.encode(),
                    '(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO)])'
                )
                if not fetch_data or fetch_data[0] is None:
                    continue
                raw_headers = fetch_data[0][1] if isinstance(fetch_data[0], tuple) else b''
                if not raw_headers:
                    continue

                msg = email_lib.message_from_bytes(raw_headers)
                parsed = _parse_message_headers(msg)

                MailCorreo.objects.create(
                    usuario=request.user,
                    conexion=conexion,
                    uid_imap=uid,
                    carpeta_imap=sent_folder,
                    carpeta_display='SENT',
                    message_id=parsed['message_id'],
                    in_reply_to=parsed['in_reply_to'],
                    asunto=parsed['asunto'],
                    remitente_nombre=parsed['remitente_nombre'],
                    remitente_email=parsed['remitente_email'],
                    destinatarios_json=json.dumps(parsed['destinatarios'], ensure_ascii=False),
                    fecha_envio=parsed['fecha'],
                    leido=True,
                    tiene_adjuntos=False,
                )
                nuevos_total += 1
            except Exception as exc:
                logger.warning("Error syncing SENT uid %s: %s", uid, exc)
    except Exception as e:
        logger.warning("SENT sync error (folder may not exist): %s", e)

    imap.logout()

    conexion.ultima_sincronizacion = django_tz.now()
    conexion.save(update_fields=['ultima_sincronizacion'])

    total = MailCorreo.objects.filter(usuario=request.user, conexion=conexion).count()
    return JsonResponse({'ok': True, 'nuevos': nuevos_total, 'total': total})


@login_required
@require_http_methods(['GET'])
def api_mail_lista(request):
    carpeta = request.GET.get('carpeta', 'INBOX')
    conexion_id = request.GET.get('conexion_id')
    pagina = max(1, int(request.GET.get('pagina', 1)))
    por_pagina = 50

    qs = MailCorreo.objects.filter(usuario=request.user)
    if conexion_id:
        qs = qs.filter(conexion_id=conexion_id)
    if carpeta == 'SENT':
        qs = qs.filter(carpeta_display='SENT', eliminado=False)
    elif carpeta == 'STARRED':
        qs = qs.filter(destacado=True, eliminado=False)
    elif carpeta == 'ARCHIVE':
        qs = qs.filter(archivado=True, eliminado=False)
    elif carpeta == 'TRASH':
        qs = qs.filter(eliminado=True)
    else:
        qs = qs.filter(carpeta_display='INBOX', eliminado=False, archivado=False)

    # Búsqueda en servidor: historial completo de la carpeta, incluye cuerpo
    # (el buscador del cliente solo filtraba la página cargada en pantalla)
    q = (request.GET.get('q') or '').strip()
    if q:
        qs = qs.filter(
            Q(asunto__icontains=q)
            | Q(remitente_nombre__icontains=q)
            | Q(remitente_email__icontains=q)
            | Q(cuerpo_texto__icontains=q)
        )

    offset = (pagina - 1) * por_pagina

    def _row(c, hilo_count=1, hilo_no_leidos=0):
        # Vista previa: primer tramo con sustancia del cuerpo (sin costo: ya
        # está en la fila). Si el cuerpo aún no se ha bajado, va vacía.
        preview = ' '.join((c.cuerpo_texto or '').split())[:110]
        return {
            'id': c.id,
            'asunto': c.asunto or '(Sin asunto)',
            'remitente_nombre': c.remitente_nombre,
            'remitente_email': c.remitente_email,
            'fecha_envio': c.fecha_envio.isoformat() if c.fecha_envio else None,
            'leido': c.leido,
            'tiene_adjuntos': c.tiene_adjuntos,
            'oportunidad_id': c.oportunidad_id,
            'oportunidad_nombre': c.oportunidad.oportunidad if c.oportunidad else None,
            'destacado': c.destacado,
            'eliminado': c.eliminado,
            'hilo_key': c.hilo_key,
            'hilo_count': hilo_count,
            'hilo_no_leidos': hilo_no_leidos,
            'preview': preview,
        }

    # ── Vista de HILOS (Gmail-style): una fila por conversación ──
    if request.GET.get('hilos') == '1':
        resumen = (
            qs.values('hilo_key')
            .annotate(
                ultima=Max('fecha_envio'),
                n=Count('id'),
                no_leidos=Count('id', filter=Q(leido=False)),
            )
            .order_by('-ultima')
        )
        total = resumen.count()
        pagina_hilos = list(resumen[offset: offset + por_pagina])
        keys = [r['hilo_key'] for r in pagina_hilos]
        meta = {r['hilo_key']: r for r in pagina_hilos}
        # Representante = el correo más reciente de cada hilo
        reps = {}
        for c in qs.filter(hilo_key__in=keys).select_related('oportunidad').order_by('-fecha_envio'):
            if c.hilo_key not in reps:
                reps[c.hilo_key] = c
        result = []
        for r in pagina_hilos:
            c = reps.get(r['hilo_key'])
            if c:
                result.append(_row(c, hilo_count=meta[c.hilo_key]['n'],
                                   hilo_no_leidos=meta[c.hilo_key]['no_leidos']))
        return JsonResponse({
            'ok': True, 'correos': result, 'total': total, 'pagina': pagina,
            'por_pagina': por_pagina, 'hay_mas': (offset + por_pagina) < total,
        })

    total = qs.count()
    correos = qs.select_related('oportunidad')[offset: offset + por_pagina]
    result = [_row(c) for c in correos]

    return JsonResponse({
        'ok': True,
        'correos': result,
        'total': total,
        'pagina': pagina,
        'por_pagina': por_pagina,
        'hay_mas': (offset + por_pagina) < total,
    })


# ═════════════════════════════════════════════════════════════════════════
# FASE 2 — SYNC DE DOS VÍAS (CRM ⇄ IMAP)
# Las acciones locales se encolan (MailAccionPendiente) y se aplican contra
# el servidor: intento inmediato en hilo daemon + reintentos del comando
# sincronizar_correo. El worker además baja nuevos y refresca flags.
# ═════════════════════════════════════════════════════════════════════════

_TRASH_CANDIDATAS = ['Trash', 'Deleted Items', 'Deleted Messages', 'Papelera', 'INBOX.Trash']
_ARCHIVE_CANDIDATAS = ['Archive', 'Archivo', 'Archived', 'INBOX.Archive']


def _detectar_carpeta(imap, candidatas, crear=None):
    """Busca una carpeta del servidor por nombre (case-insensitive, tolera
    prefijos INBOX. o /). Si no existe y `crear` viene, intenta crearla."""
    nombres = []
    try:
        typ, folders = imap.list()
        for f in (folders or []):
            try:
                s = f.decode(errors='ignore') if isinstance(f, bytes) else str(f)
                m = re.search(r'"([^"]+)"\s*$', s)
                nombres.append(m.group(1) if m else s.split()[-1].strip('"'))
            except Exception:
                continue
        for cand in candidatas:
            cl = cand.lower()
            for n in nombres:
                nl = n.lower()
                if nl == cl or nl.endswith('.' + cl) or nl.endswith('/' + cl):
                    return n
    except Exception as e:
        logger.warning("No se pudieron listar carpetas IMAP: %s", e)
    if crear:
        try:
            imap.create(crear)
            return crear
        except Exception:
            pass
    return None


def encolar_accion_mail(correo, accion):
    """Encola una acción CRM→IMAP y dispara un intento inmediato en un hilo
    daemon (la UI nunca espera al servidor de correo). Si el intento falla,
    la acción queda pendiente y la recoge el worker en su siguiente pasada."""
    if not correo.conexion_id:
        return
    MailAccionPendiente.objects.create(
        conexion_id=correo.conexion_id, correo=correo, accion=accion
    )

    def _bg(conexion_id):
        try:
            conexion = MailConexion.objects.get(id=conexion_id, activo=True)
            aplicar_acciones_pendientes(conexion)
        except Exception as e:
            logger.warning("Flush inmediato de acciones falló (reintenta el worker): %s", e)
        finally:
            connections.close_all()  # conexión BD del hilo

    threading.Thread(target=_bg, args=(correo.conexion_id,), daemon=True).start()


def aplicar_acciones_pendientes(conexion, imap=None):
    """Aplica la cola de acciones contra el servidor IMAP. Devuelve cuántas
    se resolvieron. Se rinde tras 10 intentos por acción (correo borrado en
    el servidor, carpeta inexistente, etc.)."""
    pendientes = list(
        MailAccionPendiente.objects.filter(conexion=conexion, resuelta=False, intentos__lt=10)
        .select_related('correo')
        .order_by('fecha_creacion')[:100]
    )
    if not pendientes:
        return 0

    cerrar = False
    if imap is None:
        imap = _get_imap(conexion)
        cerrar = True

    aplicadas = 0
    destinos = {}  # cache de carpetas detectadas en esta pasada
    try:
        for acc in pendientes:
            c = acc.correo
            try:
                if not c or not c.uid_imap or not c.uid_imap.isdigit():
                    # Sin UID utilizable (ya movido/borrado): nada que hacer
                    acc.resuelta = True
                    acc.ultimo_error = 'sin uid imap utilizable'
                    acc.fecha_resuelta = django_tz.now()
                    acc.save(update_fields=['resuelta', 'ultimo_error', 'fecha_resuelta'])
                    continue

                imap.select(c.carpeta_imap)  # readwrite
                uid = c.uid_imap.encode()

                if acc.accion == 'leido':
                    imap.uid('STORE', uid, '+FLAGS', '(\\Seen)')
                elif acc.accion == 'destacar':
                    imap.uid('STORE', uid, '+FLAGS', '(\\Flagged)')
                elif acc.accion == 'no_destacar':
                    imap.uid('STORE', uid, '-FLAGS', '(\\Flagged)')
                elif acc.accion in ('eliminar', 'archivar'):
                    clave = 'trash' if acc.accion == 'eliminar' else 'archive'
                    if clave not in destinos:
                        if clave == 'trash':
                            destinos[clave] = _detectar_carpeta(imap, _TRASH_CANDIDATAS)
                        else:
                            destinos[clave] = _detectar_carpeta(imap, _ARCHIVE_CANDIDATAS, crear='Archive')
                        # select() de la detección pudo cambiar el buzón activo
                        imap.select(c.carpeta_imap)
                    destino = destinos[clave]
                    if destino:
                        imap.uid('COPY', uid, f'"{destino}"' if ' ' in destino else destino)
                    imap.uid('STORE', uid, '+FLAGS', '(\\Deleted)')
                    imap.expunge()
                    # El UID viejo dejó de existir y el nuevo (en destino) no se
                    # conoce sin UIDPLUS → invalidar para futuras acciones
                    c.uid_imap = f'movido-{c.id}'
                    c.save(update_fields=['uid_imap'])

                acc.resuelta = True
                acc.fecha_resuelta = django_tz.now()
                acc.save(update_fields=['resuelta', 'fecha_resuelta'])
                aplicadas += 1
            except Exception as e:
                acc.intentos += 1
                acc.ultimo_error = str(e)[:500]
                acc.save(update_fields=['intentos', 'ultimo_error'])
                logger.warning("Acción mail %s (correo %s) falló: %s", acc.accion, acc.correo_id, e)
    finally:
        if cerrar:
            try:
                imap.logout()
            except Exception:
                pass
    return aplicadas


def refrescar_flags_inbox(conexion, imap, max_correos=200):
    """IMAP→CRM: refleja \\Seen y \\Flagged del servidor en la caché local
    (lo que leíste/destacaste desde el celular aparece igual en el CRM)."""
    usuario = conexion.usuario
    correos = list(
        MailCorreo.objects.filter(usuario=usuario, carpeta_imap='INBOX', eliminado=False)
        .order_by('-fecha_envio')[:max_correos]
    )
    por_uid = {c.uid_imap: c for c in correos if c.uid_imap.isdigit()}
    if not por_uid:
        return 0
    imap.select('INBOX', readonly=True)
    typ, data = imap.uid('FETCH', ','.join(sorted(por_uid, key=int)).encode(), '(FLAGS)')
    # No pisar cambios locales que aún no llegan al servidor
    con_pendientes = set(
        MailAccionPendiente.objects.filter(conexion=conexion, resuelta=False)
        .values_list('correo_id', flat=True)
    )
    cambios = 0
    for linea in (data or []):
        if isinstance(linea, tuple):
            linea = linea[0]
        if not linea:
            continue
        s = linea.decode(errors='ignore') if isinstance(linea, bytes) else str(linea)
        m = re.search(r'UID (\d+)', s)
        if not m:
            continue
        c = por_uid.get(m.group(1))
        if not c or c.id in con_pendientes:
            continue
        flags = s.upper()
        leido = '\\SEEN' in flags
        destacado = '\\FLAGGED' in flags
        upd = []
        if c.leido != leido:
            c.leido = leido
            upd.append('leido')
        if c.destacado != destacado:
            c.destacado = destacado
            upd.append('destacado')
        if upd:
            c.save(update_fields=upd)
            cambios += 1
    return cambios


def sincronizar_nuevos_conexion(conexion, imap):
    """Núcleo de sync para el worker en segundo plano: baja encabezados
    nuevos de INBOX (últimos 50) y SENT (últimos 30). Espejo compacto de
    api_mail_sincronizar sin depender del request."""
    usuario = conexion.usuario
    nuevos_total = 0

    linked_message_ids = {
        c.message_id: c.oportunidad_id
        for c in MailCorreo.objects.filter(usuario=usuario, oportunidad__isnull=False).exclude(message_id='')
    }
    linked_hilos = {
        c.hilo_key: c.oportunidad_id
        for c in MailCorreo.objects.filter(usuario=usuario, oportunidad__isnull=False)
        .exclude(hilo_key='').exclude(hilo_key__startswith='solo-')
    }

    def _crear(uid, fetch_data, carpeta_imap, carpeta_display, leido):
        raw_headers = fetch_data[0][1] if isinstance(fetch_data[0], tuple) else b''
        if not raw_headers:
            return 0
        msg = email_lib.message_from_bytes(raw_headers)
        parsed = _parse_message_headers(msg)
        raw_str = str(fetch_data)
        has_adj = ('attachment' in raw_str.lower() or '"application/' in raw_str.lower()
                           or 'multipart/mixed' in raw_str.lower())
        opp_id = None
        irt = parsed['in_reply_to']
        if irt and irt in linked_message_ids:
            opp_id = linked_message_ids[irt]
        if not opp_id:
            opp_id = linked_hilos.get(mail_hilo_key(parsed['asunto']))
        MailCorreo.objects.create(
            usuario=usuario,
            conexion=conexion,
            uid_imap=uid,
            carpeta_imap=carpeta_imap,
            carpeta_display=carpeta_display,
            message_id=parsed['message_id'],
            in_reply_to=parsed['in_reply_to'],
            asunto=parsed['asunto'],
            remitente_nombre=parsed['remitente_nombre'],
            remitente_email=parsed['remitente_email'],
            destinatarios_json=json.dumps(parsed['destinatarios'], ensure_ascii=False),
            fecha_envio=parsed['fecha'],
            leido=leido,
            tiene_adjuntos=has_adj if carpeta_display == 'INBOX' else False,
            oportunidad_id=opp_id,
        )
        return 1

    campos = '(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO CONTENT-TYPE)])'

    # INBOX
    try:
        imap.select('INBOX', readonly=True)
        typ, data = imap.uid('SEARCH', None, 'ALL')
        all_uids = [u.decode() for u in (data[0].split() if data[0] else [])]
        existing = set(
            MailCorreo.objects.filter(usuario=usuario, carpeta_imap='INBOX')
            .values_list('uid_imap', flat=True)
        )
        for uid in [u for u in all_uids[-50:] if u not in existing]:
            try:
                typ, fetch_data = imap.uid('FETCH', uid.encode(), campos)
                if fetch_data and fetch_data[0] is not None:
                    nuevos_total += _crear(uid, fetch_data, 'INBOX', 'INBOX', leido=False)
            except Exception as exc:
                logger.warning("Worker: error INBOX uid %s: %s", uid, exc)
    except Exception as e:
        logger.warning("Worker: error sync INBOX %s: %s", conexion.correo_electronico, e)

    # SENT — detectar contra los nombres REALES del LIST (el heurístico viejo
    # devolvía 'Sent' aunque la carpeta real fuera INBOX.Sent y el select
    # fallaba dejando la sesión en AUTH).
    try:
        sent_folder = _detectar_carpeta(
            imap, ['Sent', 'Sent Items', 'Sent Messages', 'Enviados']
        ) or _detect_sent_folder(imap)
        typ, _sel = imap.select(
            f'"{sent_folder}"' if ' ' in sent_folder else sent_folder, readonly=True
        )
        if typ != 'OK':
            raise RuntimeError(f'no se pudo abrir la carpeta {sent_folder!r}')
        typ, data = imap.uid('SEARCH', None, 'ALL')
        all_uids = [u.decode() for u in (data[0].split() if data[0] else [])]
        existing = set(
            MailCorreo.objects.filter(usuario=usuario, carpeta_imap=sent_folder)
            .values_list('uid_imap', flat=True)
        )
        for uid in [u for u in all_uids[-30:] if u not in existing]:
            try:
                typ, fetch_data = imap.uid('FETCH', uid.encode(), campos)
                if fetch_data and fetch_data[0] is not None:
                    nuevos_total += _crear(uid, fetch_data, sent_folder, 'SENT', leido=True)
            except Exception as exc:
                logger.warning("Worker: error SENT uid %s: %s", uid, exc)
    except Exception as e:
        logger.warning("Worker: error sync SENT %s: %s", conexion.correo_electronico, e)

    conexion.ultima_sincronizacion = django_tz.now()
    conexion.save(update_fields=['ultima_sincronizacion'])
    return nuevos_total


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_antiguos(request):
    """Backfill del historial: baja del servidor los 50 encabezados de INBOX
    anteriores al correo más viejo ya cacheado. El botón 'Buscar más antiguos'
    lo llama cuando la caché local se agotó."""
    conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
    if not conexion:
        return JsonResponse({'ok': False, 'error': 'Sin conexión'}, status=400)
    try:
        imap = _get_imap(conexion)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': f'Error al conectar: {e}'}, status=500)

    nuevos = 0
    try:
        imap.select('INBOX', readonly=True)
        typ, data = imap.uid('SEARCH', None, 'ALL')
        all_uids = [u.decode() for u in (data[0].split() if data[0] else [])]

        existing = set(
            MailCorreo.objects.filter(usuario=request.user, carpeta_imap='INBOX')
            .values_list('uid_imap', flat=True)
        )
        numeric_cached = [int(u) for u in existing if u.isdigit()]
        if numeric_cached:
            min_cached = min(numeric_cached)
            pool = [u for u in all_uids if u not in existing and u.isdigit() and int(u) < min_cached]
        else:
            pool = [u for u in all_uids if u not in existing]
        lote = pool[-50:]  # los 50 más recientes de los faltantes viejos

        linked_message_ids = {
            c.message_id: c.oportunidad_id
            for c in MailCorreo.objects.filter(
                usuario=request.user, oportunidad__isnull=False
            ).exclude(message_id='')
        }
        linked_hilos = {
            c.hilo_key: c.oportunidad_id
            for c in MailCorreo.objects.filter(
                usuario=request.user, oportunidad__isnull=False
            ).exclude(hilo_key='').exclude(hilo_key__startswith='solo-')
        }

        for uid in lote:
            try:
                typ, fetch_data = imap.uid(
                    'FETCH', uid.encode(),
                    '(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO CONTENT-TYPE)])'
                )
                if not fetch_data or fetch_data[0] is None:
                    continue
                raw_headers = fetch_data[0][1] if isinstance(fetch_data[0], tuple) else b''
                if not raw_headers:
                    continue
                msg = email_lib.message_from_bytes(raw_headers)
                parsed = _parse_message_headers(msg)
                raw_str = str(fetch_data)
                has_adj = ('attachment' in raw_str.lower() or '"application/' in raw_str.lower()
                           or 'multipart/mixed' in raw_str.lower())
                opp_id = None
                irt = parsed['in_reply_to']
                if irt and irt in linked_message_ids:
                    opp_id = linked_message_ids[irt]
                if not opp_id:
                    # Respuestas del mismo hilo (asunto normalizado) se van
                    # solas a la oportunidad ya vinculada
                    opp_id = linked_hilos.get(mail_hilo_key(parsed['asunto']))
                MailCorreo.objects.create(
                    usuario=request.user,
                    conexion=conexion,
                    uid_imap=uid,
                    carpeta_imap='INBOX',
                    carpeta_display='INBOX',
                    message_id=parsed['message_id'],
                    in_reply_to=parsed['in_reply_to'],
                    asunto=parsed['asunto'],
                    remitente_nombre=parsed['remitente_nombre'],
                    remitente_email=parsed['remitente_email'],
                    destinatarios_json=json.dumps(parsed['destinatarios'], ensure_ascii=False),
                    fecha_envio=parsed['fecha'],
                    leido=True,  # correos viejos: no ensuciar el contador de no leídos
                    tiene_adjuntos=has_adj,
                    oportunidad_id=opp_id,
                )
                nuevos += 1
            except Exception as exc:
                logger.warning("Error backfill uid %s: %s", uid, exc)
        quedan = len(pool) - len(lote)
    except Exception as e:
        logger.error("Backfill error: %s", e)
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    return JsonResponse({'ok': True, 'nuevos': nuevos, 'quedan_en_servidor': max(0, quedan)})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_firma(request):
    """Guarda la firma HTML de una conexión (Fase 4)."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    conexion_id = data.get('conexion_id')
    qs = MailConexion.objects.filter(usuario=request.user, activo=True)
    conexion = qs.filter(id=conexion_id).first() if conexion_id else qs.first()
    if not conexion:
        return JsonResponse({'ok': False, 'error': 'Conexión no encontrada'}, status=404)
    conexion.firma_html = (data.get('firma_html') or '')[:20000]
    conexion.save(update_fields=['firma_html'])
    return JsonResponse({'ok': True})


@login_required
@csrf_exempt
@require_http_methods(['GET', 'POST'])
def api_mail_plantillas(request):
    """Plantillas de correo del usuario: GET lista, POST crea."""
    if request.method == 'GET':
        plantillas = [
            {'id': t.id, 'nombre': t.nombre, 'asunto': t.asunto, 'cuerpo_html': t.cuerpo_html}
            for t in MailPlantilla.objects.filter(usuario=request.user)
        ]
        return JsonResponse({'ok': True, 'plantillas': plantillas})
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return JsonResponse({'ok': False, 'error': 'Nombre requerido'}, status=400)
    t = MailPlantilla.objects.create(
        usuario=request.user,
        nombre=nombre[:120],
        asunto=(data.get('asunto') or '')[:500],
        cuerpo_html=(data.get('cuerpo_html') or '')[:100000],
    )
    return JsonResponse({'ok': True, 'id': t.id})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_plantilla_eliminar(request, plantilla_id):
    MailPlantilla.objects.filter(usuario=request.user, id=plantilla_id).delete()
    return JsonResponse({'ok': True})


@login_required
@require_http_methods(['GET'])
def api_mail_borradores(request):
    """Lista de borradores + envíos programados pendientes (carpeta Borradores)."""
    borradores = [
        {
            'id': b.id,
            'para': b.para,
            'asunto': b.asunto or '(Sin asunto)',
            'fecha': b.fecha_actualizacion.isoformat() if b.fecha_actualizacion else None,
        }
        for b in MailBorrador.objects.filter(usuario=request.user)[:100]
    ]
    programados = [
        {
            'id': pr.id,
            'para': pr.para,
            'asunto': pr.asunto or '(Sin asunto)',
            'fecha_programada': pr.fecha_programada.isoformat(),
            'error': pr.error,
        }
        for pr in MailProgramado.objects.filter(usuario=request.user, enviado=False)[:50]
    ]
    return JsonResponse({'ok': True, 'borradores': borradores, 'programados': programados})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_borrador_guardar(request):
    """Upsert de borrador (autoguardado del compose)."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    bid = data.get('id')
    campos = {
        'para': (data.get('para') or '')[:2000],
        'cc': (data.get('cc') or '')[:2000],
        'asunto': (data.get('asunto') or '')[:500],
        'cuerpo_html': (data.get('cuerpo_html') or '')[:200000],
    }
    if bid:
        actualizados = MailBorrador.objects.filter(usuario=request.user, id=bid).update(**campos)
        if actualizados:
            return JsonResponse({'ok': True, 'id': bid})
    conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
    b = MailBorrador.objects.create(usuario=request.user, conexion=conexion, **campos)
    return JsonResponse({'ok': True, 'id': b.id})


@login_required
@require_http_methods(['GET'])
def api_mail_borrador_detalle(request, borrador_id):
    try:
        b = MailBorrador.objects.get(usuario=request.user, id=borrador_id)
    except MailBorrador.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Borrador no encontrado'}, status=404)
    return JsonResponse({
        'ok': True, 'id': b.id, 'para': b.para, 'cc': b.cc,
        'asunto': b.asunto, 'cuerpo_html': b.cuerpo_html,
    })


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_borrador_eliminar(request, borrador_id):
    MailBorrador.objects.filter(usuario=request.user, id=borrador_id).delete()
    return JsonResponse({'ok': True})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_programar(request):
    """Agenda un envío para después: mismo payload multipart que enviar +
    fecha_programada (YYYY-MM-DDTHH:MM, hora local). Lo despacha el worker."""
    data, archivos = _parse_mail_request(request)

    para = (data.get('para') or '').strip()
    asunto = (data.get('asunto') or '').strip()
    fecha_raw = (data.get('fecha_programada') or '').strip()
    if not para or not asunto:
        return JsonResponse({'ok': False, 'error': 'Faltan destinatario o asunto'}, status=400)
    if not fecha_raw:
        return JsonResponse({'ok': False, 'error': 'Falta la fecha programada'}, status=400)
    try:
        fecha_naive = datetime.fromisoformat(fecha_raw)
        fecha_prog = django_tz.make_aware(fecha_naive) if django_tz.is_naive(fecha_naive) else fecha_naive
    except ValueError:
        return JsonResponse({'ok': False, 'error': 'Fecha inválida'}, status=400)
    if fecha_prog <= django_tz.now():
        return JsonResponse({'ok': False, 'error': 'La fecha debe ser en el futuro'}, status=400)

    err_size = _validar_tamanios_adjuntos(archivos)
    if err_size:
        return JsonResponse({'ok': False, 'error': err_size}, status=400)

    adjuntos = []
    for f in archivos:
        f.seek(0)
        adjuntos.append({
            'nombre': f.name[:300],
            'content_type': (f.content_type or 'application/octet-stream')[:100],
            'b64': base64.b64encode(f.read()).decode(),
        })

    conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
    if not conexion:
        return JsonResponse({'ok': False, 'error': 'Sin conexión de correo'}, status=400)

    pr = MailProgramado.objects.create(
        usuario=request.user,
        conexion=conexion,
        para=para,
        cc=(data.get('cc') or ''),
        bcc=(data.get('bcc') or ''),
        asunto=asunto,
        cuerpo_html=data.get('cuerpo_html') or '',
        cuerpo_texto=data.get('cuerpo_texto') or '',
        adjuntos_json=json.dumps(adjuntos),
        fecha_programada=fecha_prog,
    )
    return JsonResponse({
        'ok': True, 'id': pr.id,
        'fecha_programada': django_tz.localtime(fecha_prog).strftime('%d/%m/%Y %H:%M'),
    })


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_programado_cancelar(request, programado_id):
    MailProgramado.objects.filter(usuario=request.user, id=programado_id, enviado=False).delete()
    return JsonResponse({'ok': True})


def procesar_envios_programados():
    """Despacha por SMTP los envíos programados vencidos. Lo llama el worker
    sincronizar_correo en cada pasada. Devuelve cuántos envió."""
    pendientes = MailProgramado.objects.filter(
        enviado=False, intentos__lt=5, fecha_programada__lte=django_tz.now()
    ).select_related('conexion', 'usuario')[:20]
    enviados = 0
    for pr in pendientes:
        conexion = pr.conexion or MailConexion.objects.filter(usuario=pr.usuario, activo=True).first()
        if not conexion:
            pr.intentos += 1
            pr.error = 'Sin conexión de correo activa'
            pr.save(update_fields=['intentos', 'error'])
            continue
        try:
            msg = _build_msg_with_attachments(pr.cuerpo_html, pr.cuerpo_texto, [])
            msg['Subject'] = pr.asunto
            msg['From'] = conexion.correo_electronico
            msg['To'] = pr.para
            if pr.cc:
                msg['Cc'] = pr.cc
            try:
                for adj in json.loads(pr.adjuntos_json or '[]'):
                    parte = MIMEApplication(base64.b64decode(adj['b64']))
                    parte.add_header('Content-Disposition', 'attachment', filename=adj.get('nombre') or 'adjunto')
                    if adj.get('content_type'):
                        parte.set_type(adj['content_type'])
                    msg.attach(parte)
            except Exception as e_adj:
                logger.warning("Programado %s: adjunto omitido: %s", pr.id, e_adj)

            destinos = [a.strip() for a in (pr.para + ',' + pr.cc + ',' + pr.bcc).split(',') if a.strip()]
            smtp = _get_smtp(conexion)
            smtp.sendmail(conexion.correo_electronico, destinos, msg.as_bytes())
            smtp.quit()

            correo_sent = MailCorreo.objects.create(
                usuario=pr.usuario, conexion=conexion,
                uid_imap=f'prog_{pr.id}_{django_tz.now().timestamp()}',
                carpeta_imap='SENT', carpeta_display='SENT',
                asunto=pr.asunto,
                remitente_nombre=pr.usuario.get_full_name() or pr.usuario.username,
                remitente_email=conexion.correo_electronico,
                destinatarios_json=json.dumps(
                    [{'nombre': '', 'email': e} for e in destinos], ensure_ascii=False
                ),
                cuerpo_html=pr.cuerpo_html, cuerpo_texto=pr.cuerpo_texto,
                fecha_envio=django_tz.now(), leido=True, cuerpo_cargado=True,
                tiene_adjuntos=bool(pr.adjuntos_json and pr.adjuntos_json != '[]'),
            )
            pr.enviado = True
            pr.fecha_enviado = django_tz.now()
            pr.error = ''
            pr.save(update_fields=['enviado', 'fecha_enviado', 'error'])
            enviados += 1
        except Exception as e:
            pr.intentos += 1
            pr.error = str(e)[:500]
            pr.save(update_fields=['intentos', 'error'])
            logger.warning("Envío programado %s falló (intento %s): %s", pr.id, pr.intentos, e)
    return enviados


@login_required
@require_http_methods(['GET'])
def api_mail_contexto(request, correo_id):
    """Panel de contexto CRM del correo (Fase 3, paso 1). Dos estados:
    vinculado (ficha + oportunidad + tareas + actividad) o sin vincular."""
    try:
        correo = MailCorreo.objects.select_related('oportunidad__cliente', 'oportunidad__usuario').get(
            id=correo_id, usuario=request.user
        )
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)

    if not correo.oportunidad_id:
        return JsonResponse({'ok': True, 'vinculado': False})

    opp = correo.oportunidad
    cliente = opp.cliente

    tareas = list(
        TareaOportunidad.objects.filter(oportunidad=opp, estado='pendiente')
        .order_by('fecha_limite')[:3]
    )
    actividades = list(
        OportunidadActividad.objects.filter(oportunidad=opp)
        .order_by('-fecha_creacion')[:3]
    )
    correos_count = MailCorreo.objects.filter(usuario=request.user, oportunidad=opp).count()
    responsable = (opp.usuario.get_full_name() or opp.usuario.username) if opp.usuario else ''

    # Barra de ETAPA: posición de la etapa actual dentro de su pipeline
    from .models import EtapaPipeline
    pipeline = 'proyecto' if (opp.tipo_negociacion or '') in ('proyecto', 'bitrix_proyecto') else 'runrate'
    _terminales = {'ganado', 'perdido', 'pagado', 'sin respuesta'}
    etapas = [
        n for n in EtapaPipeline.objects.filter(pipeline=pipeline, activo=True)
        .order_by('orden').values_list('nombre', flat=True)
        if n.strip().lower() not in _terminales and not n.strip().lower().startswith('prueba')
    ]
    etapa_idx = None
    etapa_nombre = opp.etapa_corta or ''
    if etapa_nombre and etapas:
        for _i, _n in enumerate(etapas):
            if _n.strip().lower() == etapa_nombre.strip().lower():
                etapa_idx = _i
                break
    # Sin etapa en BD: el widget de oportunidad la muestra en la PRIMERA
    # etapa del pipeline — reflejar lo mismo aquí (no decir "Sin etapa").
    if not etapa_nombre and etapas:
        etapa_idx = 0
        etapa_nombre = etapas[0]

    # Próxima actividad de calendario de la oportunidad (si existe)
    prox_act = (
        Actividad.objects.filter(
            oportunidad=opp, completada=False, fecha_fin__gte=django_tz.now()
        ).order_by('fecha_inicio').first()
    )

    return JsonResponse({
        'ok': True,
        'vinculado': True,
        'oportunidad': {
            'id': opp.id,
            'nombre': opp.oportunidad,
            'monto': float(opp.monto or 0),
            'probabilidad': opp.probabilidad_cierre or 0,
            'etapa': etapa_nombre,
            'etapa_color': opp.etapa_color or '#3B82F6',
            'etapa_idx': etapa_idx,
            'etapa_total': len(etapas),
            'responsable': responsable,
            'cierre': ('%s/%s' % (opp.mes_cierre, opp.anio_cierre)) if (opp.mes_cierre and opp.anio_cierre) else '',
        },
        'cliente': {
            'empresa': cliente.nombre_empresa if cliente else '',
            'contacto': (cliente.contacto_principal if cliente else '') or opp.contacto or '',
            'telefono': (cliente.telefono if cliente else '') or '',
            'email': (cliente.email if cliente else '') or '',
        },
        'tareas': [
            {
                'id': t.id,
                'titulo': t.titulo,
                'fecha_limite': t.fecha_limite.isoformat() if t.fecha_limite else None,
            }
            for t in tareas
        ],
        'actividades': [
            {
                'titulo': a.titulo,
                'tipo': a.tipo,
                'fecha': a.fecha_creacion.isoformat() if a.fecha_creacion else None,
            }
            for a in actividades
        ],
        'proxima_actividad': {
            'titulo': prox_act.titulo,
            'fecha': prox_act.fecha_inicio.isoformat() if prox_act.fecha_inicio else None,
        } if prox_act else None,
        'correos_count': correos_count,
    })


@login_required
@require_http_methods(['GET'])
def api_mail_hilo(request):
    """Todos los correos de una conversación (INBOX + SENT), orden cronológico.
    Alimenta la tira 'En esta conversación' del panel de lectura."""
    key = (request.GET.get('key') or '').strip()
    if not key:
        return JsonResponse({'ok': False, 'error': 'key requerida'}, status=400)
    correos = (
        MailCorreo.objects.filter(usuario=request.user, hilo_key=key, eliminado=False)
        .order_by('fecha_envio')
    )
    result = []
    for c in correos:
        result.append({
            'id': c.id,
            'carpeta': c.carpeta_display,
            'asunto': c.asunto or '(Sin asunto)',
            'remitente_nombre': c.remitente_nombre,
            'remitente_email': c.remitente_email,
            'fecha_envio': c.fecha_envio.isoformat() if c.fecha_envio else None,
            'leido': c.leido,
        })
    return JsonResponse({'ok': True, 'correos': result})


@login_required
@require_http_methods(['GET'])
def api_mail_detalle(request, correo_id):
    try:
        correo = MailCorreo.objects.select_related('oportunidad').prefetch_related('adjuntos').get(
            id=correo_id, usuario=request.user
        )
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)

    # Fetch body from IMAP if not yet loaded
    if not correo.cuerpo_cargado:
        try:
            conexion = correo.conexion
            if not conexion:
                conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            imap = _get_imap(conexion)
            imap.select(correo.carpeta_imap, readonly=False)

            typ, fetch_data = imap.uid('FETCH', correo.uid_imap.encode(), '(RFC822)')
            raw_email = None
            if fetch_data and isinstance(fetch_data[0], tuple):
                raw_email = fetch_data[0][1]

            if raw_email:
                msg = email_lib.message_from_bytes(raw_email)
                html_body = ''
                text_body = ''
                adjuntos_nuevos = []
                cid_map = {}  # content-id → data URI for inline images

                for part in msg.walk():
                    ct = part.get_content_type()
                    disposition = str(part.get('Content-Disposition', ''))
                    content_id = (part.get('Content-ID') or '').strip('<>').strip()
                    fname = _decode_header_value(part.get_filename() or '')

                    # Collect inline images (cid: references) as base64 data URIs
                    if ct.startswith('image/') and content_id and 'attachment' not in disposition:
                        payload = part.get_payload(decode=True)
                        if payload:
                            b64 = base64.b64encode(payload).decode()
                            cid_map[content_id] = f'data:{ct};base64,{b64}'
                            # Fotos "inline" reales (iPhone/Outlook mandan las fotos
                            # así): listarlas TAMBIÉN como adjunto descargable. Se
                            # filtra el ruido de logos/firmas (<20 KB y sin nombre).
                            if fname or len(payload) > 20480:
                                ext = mimetypes.guess_extension(ct) or '.img'
                                adjuntos_nuevos.append(MailAdjunto(
                                    correo=correo,
                                    nombre_archivo=(fname or f'imagen-{len(adjuntos_nuevos) + 1}{ext}')[:300],
                                    content_type=ct[:100],
                                    tamanio_bytes=len(payload),
                                    parte_num='',
                                    datos_b64=b64,
                                ))

                    # Real attachments: CUALQUIER parte con nombre de archivo.
                    # (Antes se exigía Content-Disposition attachment/inline y los
                    # clientes que mandan solo Content-Type con name= se perdían.)
                    elif fname:
                        payload_bytes = part.get_payload(decode=True) or b''
                        adjuntos_nuevos.append(MailAdjunto(
                            correo=correo,
                            nombre_archivo=fname[:300],
                            content_type=ct[:100],
                            tamanio_bytes=len(payload_bytes),
                            parte_num='',
                            datos_b64=base64.b64encode(payload_bytes).decode() if payload_bytes else '',
                        ))

                    elif ct == 'text/html' and not html_body:
                        charset = part.get_content_charset() or 'utf-8'
                        html_body = (part.get_payload(decode=True) or b'').decode(charset, errors='replace')
                        if len(html_body) > 524288:  # 512 KB cap
                            html_body = html_body[:524288] + '\n<!-- truncated -->'
                    elif ct == 'text/plain' and not text_body:
                        charset = part.get_content_charset() or 'utf-8'
                        text_body = (part.get_payload(decode=True) or b'').decode(charset, errors='replace')

                # Replace cid: references with embedded base64 data URIs
                if html_body and cid_map:
                    for cid, data_url in cid_map.items():
                        html_body = html_body.replace(f'cid:{cid}', data_url)
                        # Some clients wrap cid with angle brackets in src
                        html_body = re.sub(r'cid:' + re.escape(cid), data_url, html_body, flags=re.IGNORECASE)

                correo.cuerpo_html = html_body
                correo.cuerpo_texto = text_body
                correo.cuerpo_cargado = True
                correo.leido = True
                correo.save(update_fields=['cuerpo_html', 'cuerpo_texto', 'cuerpo_cargado', 'leido'])

                if adjuntos_nuevos:
                    MailAdjunto.objects.bulk_create(adjuntos_nuevos, ignore_conflicts=True)
                    correo.tiene_adjuntos = True
                    correo.save(update_fields=['tiene_adjuntos'])

                # Si el correo fue auto-enlazado durante sync, agregar a conversación
                # ahora que tenemos el cuerpo disponible
                if correo.oportunidad_id:
                    _agregar_correo_a_conversacion(correo, correo.oportunidad, request.user)

                # Mark as read on server
                try:
                    imap.uid('STORE', correo.uid_imap.encode(), '+FLAGS', '(\\Seen)')
                except Exception:
                    pass

            imap.close()
            imap.logout()
        except Exception as exc:
            logger.error("Error fetching body for correo %s: %s", correo_id, exc)

    # Cuerpo ya en caché pero sin leer (p.ej. quedó no-leído tras un refresh
    # de flags): marcar leído local y propagar \Seen al servidor vía cola.
    if correo.cuerpo_cargado and not correo.leido:
        correo.leido = True
        correo.save(update_fields=['leido'])
        encolar_accion_mail(correo, 'leido')

    adjuntos = [
        {'id': a.id, 'nombre': a.nombre_archivo, 'content_type': a.content_type, 'tamanio': a.tamanio_bytes}
        for a in correo.adjuntos.all()
    ]

    try:
        destinatarios = json.loads(correo.destinatarios_json)
    except Exception:
        destinatarios = []

    return JsonResponse({
        'ok': True,
        'id': correo.id,
        'asunto': correo.asunto or '(Sin asunto)',
        'remitente_nombre': correo.remitente_nombre,
        'remitente_email': correo.remitente_email,
        'destinatarios': destinatarios,
        'fecha_envio': correo.fecha_envio.isoformat() if correo.fecha_envio else None,
        'cuerpo_html': correo.cuerpo_html,
        'cuerpo_texto': correo.cuerpo_texto,
        'adjuntos': adjuntos,
        'leido': correo.leido,
        'oportunidad_id': correo.oportunidad_id,
        'oportunidad_nombre': correo.oportunidad.oportunidad if correo.oportunidad else None,
        'message_id': correo.message_id,
        'destacado': correo.destacado,
        'eliminado': correo.eliminado,
    })


# Tamaños máximos para adjuntos (en bytes)
MAX_ADJUNTO_SIZE = 25 * 1024 * 1024  # 25 MB por archivo
MAX_ADJUNTOS_TOTAL_SIZE = 50 * 1024 * 1024  # 50 MB total


def _validar_tamanios_adjuntos(archivos):
    """
    Valida que ningún archivo exceda 25 MB y que el total no exceda 50 MB.
    Retorna un mensaje de error (str) si excede; None si todo OK.
    """
    if not archivos:
        return None
    total = 0
    for f in archivos:
        size = getattr(f, 'size', None)
        if size is None:
            # Fallback: medir leyendo (no debería pasar con UploadedFile de Django)
            try:
                pos = f.tell()
                f.seek(0, 2)
                size = f.tell()
                f.seek(pos)
            except Exception:
                size = 0
        if size > MAX_ADJUNTO_SIZE:
            mb = MAX_ADJUNTO_SIZE // (1024 * 1024)
            return f'Archivo "{f.name}" excede tamaño máximo de {mb} MB'
        total += size
    if total > MAX_ADJUNTOS_TOTAL_SIZE:
        mb = MAX_ADJUNTOS_TOTAL_SIZE // (1024 * 1024)
        return f'El total de adjuntos excede el máximo de {mb} MB'
    return None


def _build_attachment_part(file_obj):
    """
    Construye un MIME part con el Content-Type correcto según la extensión/MIME
    del archivo, y codifica el filename usando RFC 2231 para soportar acentos y
    espacios. Compatibilidad legacy: también incluye `name=` en Content-Type.
    """
    payload = file_obj.read()
    filename = file_obj.name or 'adjunto'

    # Detectar tipo: primero usar lo que reporte el cliente (django UploadedFile),
    # luego mimetypes.guess_type, finalmente fallback.
    content_type = getattr(file_obj, 'content_type', None) or ''
    if not content_type or content_type == 'application/octet-stream':
        guessed, _enc = mimetypes.guess_type(filename)
        if guessed:
            content_type = guessed
    if not content_type:
        content_type = 'application/octet-stream'

    maintype, _, subtype = content_type.partition('/')
    if not subtype:
        maintype, subtype = 'application', 'octet-stream'

    # Crear el subtype MIME apropiado
    if maintype == 'image':
        try:
            part = MIMEImage(payload, _subtype=subtype)
        except Exception:
            part = email.mime.base.MIMEBase(maintype, subtype)
            part.set_payload(payload)
            encode_base64(part)
    elif maintype == 'text':
        # Para texto necesitamos decodificar; si falla, tratar como binario
        try:
            text = payload.decode('utf-8')
            part = email.mime.text.MIMEText(text, _subtype=subtype, _charset='utf-8')
        except UnicodeDecodeError:
            part = email.mime.base.MIMEBase(maintype, subtype)
            part.set_payload(payload)
            encode_base64(part)
    elif maintype == 'audio':
        try:
            part = MIMEAudio(payload, _subtype=subtype)
        except Exception:
            part = email.mime.base.MIMEBase(maintype, subtype)
            part.set_payload(payload)
            encode_base64(part)
    elif maintype == 'application':
        part = MIMEApplication(payload, _subtype=subtype)
    else:
        part = email.mime.base.MIMEBase(maintype, subtype)
        part.set_payload(payload)
        encode_base64(part)

    # Content-Disposition con filename codificado RFC 2231 (tuple activa la codificación)
    part.add_header(
        'Content-Disposition', 'attachment',
        filename=('utf-8', '', filename),
    )
    # Compatibilidad legacy: agregar name= al Content-Type
    try:
        part.set_param('name', filename, header='Content-Type', charset='utf-8')
    except Exception:
        pass
    return part


def _build_msg_with_attachments(cuerpo_html, cuerpo_texto, archivos):
    """Build a MIMEMultipart message with text/html body and optional file attachments."""
    if archivos:
        msg = email.mime.multipart.MIMEMultipart('mixed')
        body_part = email.mime.multipart.MIMEMultipart('alternative')
        if cuerpo_texto:
            body_part.attach(email.mime.text.MIMEText(cuerpo_texto, 'plain', 'utf-8'))
        body_part.attach(email.mime.text.MIMEText(cuerpo_html or cuerpo_texto, 'html', 'utf-8'))
        msg.attach(body_part)
        for f in archivos:
            try:
                part = _build_attachment_part(f)
            except Exception as exc:
                logger.exception('Error armando adjunto %s: %s', getattr(f, 'name', '?'), exc)
                # Fallback al comportamiento original para no perder el adjunto
                f.seek(0)
                part = email.mime.base.MIMEBase('application', 'octet-stream')
                part.set_payload(f.read())
                encode_base64(part)
                part.add_header(
                    'Content-Disposition', 'attachment',
                    filename=('utf-8', '', f.name),
                )
            msg.attach(part)
    else:
        msg = email.mime.multipart.MIMEMultipart('alternative')
        if cuerpo_texto:
            msg.attach(email.mime.text.MIMEText(cuerpo_texto, 'plain', 'utf-8'))
        msg.attach(email.mime.text.MIMEText(cuerpo_html or cuerpo_texto, 'html', 'utf-8'))
    return msg


def _parse_mail_request(request):
    """Parse POST data from either JSON or multipart/form-data, returning (data_dict, files_list)."""
    content_type = request.content_type or ''
    if 'multipart/form-data' in content_type:
        data = request.POST.dict()
        archivos = request.FILES.getlist('adjuntos')
        return data, archivos
    else:
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            data = {}
        return data, []


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_enviar(request):
    data, archivos = _parse_mail_request(request)
    if not data:
        return JsonResponse({'ok': False, 'error': 'Datos inválidos'}, status=400)

    try:
        conexion_id = data.get('conexion_id')
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Sin conexión de correo'}, status=400)

    para = data.get('para', '').strip()
    asunto = data.get('asunto', '').strip()
    cuerpo_html = data.get('cuerpo_html', '').strip()
    cuerpo_texto = data.get('cuerpo_texto', '').strip()
    cc = data.get('cc', '').strip()

    if not para or not asunto:
        return JsonResponse({'ok': False, 'error': 'Destinatario y asunto son requeridos'}, status=400)

    # Validación de tamaño de adjuntos antes de tocar SMTP (evita errores crípticos del provider)
    err_size = _validar_tamanios_adjuntos(archivos)
    if err_size:
        return JsonResponse({'ok': False, 'error': err_size}, status=400)

    # Generamos un Message-ID propio antes de enviar para poder detectar
    # respuestas (vía In-Reply-To / References) y propagar la vinculación
    # con la oportunidad al hilo completo.
    from email.utils import make_msgid
    msg_id = make_msgid(domain=(conexion.correo_electronico.split('@')[-1] if '@' in conexion.correo_electronico else 'iamet.mx'))

    msg = _build_msg_with_attachments(cuerpo_html, cuerpo_texto, archivos)
    msg['Subject'] = asunto
    msg['From'] = conexion.correo_electronico
    msg['To'] = para
    msg['Message-ID'] = msg_id
    if cc:
        msg['CC'] = cc

    try:
        smtp = _get_smtp(conexion)
        recipients = [a.strip() for a in para.split(',')]
        if cc:
            recipients += [a.strip() for a in cc.split(',')]
        smtp.sendmail(conexion.correo_electronico, recipients, msg.as_bytes())
        smtp.quit()
    except Exception as e:
        logger.exception('SMTP enviar falló: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error al enviar: {e}'}, status=500)

    # Vínculo opcional con una Oportunidad — cuando el envío viene del chat
    # de oportunidad, queda registrada la evidencia del correo allí.
    oportunidad_obj = None
    opp_id = data.get('oportunidad_id')
    if opp_id:
        try:
            from .models import TodoItem
            oportunidad_obj = TodoItem.objects.filter(id=int(opp_id)).first()
        except (TypeError, ValueError):
            oportunidad_obj = None

    # Vínculo opcional con un Prospecto — equivalente al de oportunidad pero
    # para la etapa de prospección. El composer del widget de prospecto setea
    # `prospecto_id` en el FormData de envío.
    prospecto_obj = None
    prosp_id = data.get('prospecto_id')
    if prosp_id:
        try:
            from .models import Prospecto
            prospecto_obj = Prospecto.objects.filter(id=int(prosp_id)).first()
        except (TypeError, ValueError):
            prospecto_obj = None

    # Save to sent cache
    correo_sent = MailCorreo.objects.create(
        usuario=request.user,
        conexion=conexion,
        uid_imap=f'sent_{django_tz.now().timestamp()}',
        message_id=msg_id,
        carpeta_imap='SENT',
        carpeta_display='SENT',
        asunto=asunto,
        remitente_nombre=request.user.get_full_name() or request.user.username,
        remitente_email=conexion.correo_electronico,
        destinatarios_json=json.dumps([{'nombre': '', 'email': e} for e in para.split(',')], ensure_ascii=False),
        cuerpo_html=cuerpo_html,
        cuerpo_texto=cuerpo_texto,
        fecha_envio=django_tz.now(),
        leido=True,
        cuerpo_cargado=True,
        tiene_adjuntos=bool(archivos),
        oportunidad=oportunidad_obj,
        prospecto=prospecto_obj,
    )

    # Save attachments metadata
    for f in archivos:
        f.seek(0)
        MailAdjunto.objects.create(
            correo=correo_sent,
            nombre_archivo=f.name,
            content_type=f.content_type or 'application/octet-stream',
            tamanio_bytes=f.size,
            datos_b64=base64.b64encode(f.read()).decode(),
        )

    # ── Hook Marketing → Campañas de marca ────────────────────────────
    # Si el correo se disparó desde el módulo Marketing (Compartir
    # material) y vino el slug de la marca, registramos un envío como
    # `Campana(estado='enviada', producto=KEY_MARCA)`. Eso hace que el
    # contador de "Campañas" de la sección Marcas refleje envíos reales
    # del equipo. Los aliases de key (zebra/ZEBRA/Zebra) se resuelven
    # vía MarcaCRM para mantener una sola fuente de verdad.
    marketing_brand = (data.get('marketing_brand') or '').strip()
    if marketing_brand:
        try:
            from .models import Campana, MarcaCRM
            slug_up = marketing_brand.upper()
            # Match por key exacto o por nombre (Marketing Hub usa slugs
            # como 'panduit' / 'avigilion'; MarcaCRM.key suele ser
            # 'PANDUIT' / 'AVIGILON').
            marca_obj = MarcaCRM.objects.filter(
                Q(key__iexact=slug_up) | Q(nombre__iexact=marketing_brand)
            ).first()
            producto_val = (marca_obj.key if marca_obj else slug_up) or ''
            if producto_val:
                Campana.objects.create(
                    nombre=asunto[:200] or 'Envío de marketing',
                    asunto=asunto[:200] or '',
                    estado='enviada',
                    producto=producto_val,
                    creado_por=request.user,
                    total_enviados=len(recipients),
                    fecha_envio=django_tz.now(),
                )
        except Exception:
            # Auditoría defensive: si por algún motivo el registro falla,
            # NO debe romper el envío de correo (que ya pasó). Lo logueamos.
            try:
                logger.exception('Failed to record Campana from marketing share')
            except Exception:
                pass

    return JsonResponse({'ok': True})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_responder(request, correo_id):
    try:
        original = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)

    data, archivos = _parse_mail_request(request)
    if not data:
        return JsonResponse({'ok': False, 'error': 'Datos inválidos'}, status=400)

    try:
        conexion_id = data.get('conexion_id')
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Sin conexión de correo'}, status=400)

    cuerpo_html = data.get('cuerpo_html', '').strip()
    cuerpo_texto = data.get('cuerpo_texto', '').strip()
    cc = data.get('cc', '').strip()
    bcc = data.get('bcc', '').strip()
    asunto = f"Re: {original.asunto}" if not original.asunto.startswith('Re:') else original.asunto
    para = original.remitente_email

    # Validación de tamaño antes de SMTP
    err_size = _validar_tamanios_adjuntos(archivos)
    if err_size:
        return JsonResponse({'ok': False, 'error': err_size}, status=400)

    msg = _build_msg_with_attachments(cuerpo_html, cuerpo_texto, archivos)
    msg['Subject'] = asunto
    msg['From'] = conexion.correo_electronico
    msg['To'] = para
    if cc:
        msg['CC'] = cc
    if original.message_id:
        msg['In-Reply-To'] = original.message_id
        msg['References'] = original.message_id

    try:
        recipients = [para]
        if cc:
            recipients += [a.strip() for a in cc.split(',') if a.strip()]
        if bcc:
            recipients += [a.strip() for a in bcc.split(',') if a.strip()]
        # Simulador del asistente (views_crm): los correos @simulacion.iamet son de
        # prueba — no hay SMTP real, solo se guarda el SENT para disparar los flujos.
        if not all('simulacion.iamet' in r.lower() for r in recipients):
            smtp = _get_smtp(conexion)
            smtp.sendmail(conexion.correo_electronico, recipients, msg.as_bytes())
            smtp.quit()
    except Exception as e:
        logger.exception('SMTP responder falló: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error al enviar respuesta: {e}'}, status=500)

    # Save sent reply
    reply = MailCorreo.objects.create(
        usuario=request.user,
        conexion=conexion,
        uid_imap=f'reply_{django_tz.now().timestamp()}',
        carpeta_imap='SENT',
        carpeta_display='SENT',
        asunto=asunto,
        remitente_nombre=request.user.get_full_name() or request.user.username,
        remitente_email=conexion.correo_electronico,
        destinatarios_json=json.dumps([{'nombre': original.remitente_nombre, 'email': para}], ensure_ascii=False),
        in_reply_to=original.message_id,
        cuerpo_html=cuerpo_html,
        cuerpo_texto=cuerpo_texto,
        fecha_envio=django_tz.now(),
        leido=True,
        cuerpo_cargado=True,
        oportunidad=original.oportunidad,
        prospecto=original.prospecto,
        tiene_adjuntos=bool(archivos),
    )

    # Save attachments metadata
    for f in archivos:
        f.seek(0)
        MailAdjunto.objects.create(
            correo=reply,
            nombre_archivo=f.name,
            content_type=f.content_type or 'application/octet-stream',
            tamanio_bytes=f.size,
            datos_b64=base64.b64encode(f.read()).decode(),
        )

    # Add reply to opportunity conversation if linked
    if reply.oportunidad:
        _agregar_correo_a_conversacion(reply, reply.oportunidad, request.user)

    return JsonResponse({'ok': True, 'reply_id': reply.id})


def _agregar_correo_a_conversacion(correo, opp, usuario):
    """DEPRECADO (Fase 3): la conversación de la oportunidad ya pinta los
    correos vinculados como TARJETAS clicables directamente desde MailCorreo
    (api_chat_oportunidad los inyecta al feed). Este mensaje de texto los
    duplicaba con el cuerpo crudo pegado — se dejó de generar; los viejos
    se filtran del feed con texto__startswith='[mail:'."""
    return


def _agregar_correo_a_conversacion_legacy(correo, opp, usuario):
    marker = f'[mail:{correo.id}]'
    if MensajeOportunidad.objects.filter(oportunidad=opp, texto__startswith=marker).exists():
        return  # Ya fue agregado

    # Encabezado legible
    if correo.carpeta_display == 'SENT':
        try:
            destinatarios = json.loads(correo.destinatarios_json)
            dest_str = ', '.join(
                d.get('nombre') or d.get('email', '') for d in destinatarios
            ) or correo.remitente_email
        except Exception:
            dest_str = correo.remitente_email
        header = f"Respuesta enviada a: {dest_str}"
    else:
        remit = correo.remitente_nombre or correo.remitente_email
        if correo.remitente_nombre and correo.remitente_email:
            remit = f"{correo.remitente_nombre} <{correo.remitente_email}>"
        header = f"De: {remit}"

    fecha_str = correo.fecha_envio.strftime('%d/%m/%Y %H:%M') if correo.fecha_envio else ''
    asunto = correo.asunto or '(Sin asunto)'

    # Cuerpo (solo texto plano, máx 2000 chars)
    cuerpo = ''
    if correo.cuerpo_cargado and correo.cuerpo_texto:
        cuerpo = correo.cuerpo_texto.strip()[:2000]
    elif correo.cuerpo_cargado and correo.cuerpo_html:
        import html as html_lib
        import re as _re
        texto = _re.sub(r'<[^>]+>', ' ', correo.cuerpo_html)
        texto = html_lib.unescape(texto)
        cuerpo = ' '.join(texto.split())[:2000]

    lineas = [marker, header, f"Asunto: {asunto}"]
    if fecha_str:
        lineas.append(f"Fecha: {fecha_str}")
    if cuerpo:
        lineas.append('---')
        lineas.append(cuerpo)

    MensajeOportunidad.objects.create(
        oportunidad=opp,
        usuario=usuario,
        texto='\n'.join(lineas),
    )


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_vincular_oportunidad(request, correo_id):
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    # Desvincular: clic en el chip "Vinculado" del panel de contexto
    if data.get('desvincular'):
        opp_ant = correo.oportunidad
        correo.oportunidad = None
        correo.save(update_fields=['oportunidad'])
        if opp_ant:
            OportunidadActividad.objects.create(
                oportunidad=opp_ant,
                tipo='email',
                titulo=f'Correo desvinculado: {correo.asunto[:100]}',
                descripcion=f'De: {correo.remitente_nombre} <{correo.remitente_email}>',
                usuario=request.user,
            )
        return JsonResponse({'ok': True, 'desvinculado': True})

    opp_id = data.get('oportunidad_id')
    if not opp_id:
        return JsonResponse({'ok': False, 'error': 'oportunidad_id requerido'}, status=400)

    try:
        opp = TodoItem.objects.get(id=opp_id)
    except TodoItem.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Oportunidad no encontrada'}, status=404)

    correo.oportunidad = opp
    correo.save(update_fields=['oportunidad'])

    # Add entry to opportunity timeline
    OportunidadActividad.objects.create(
        oportunidad=opp,
        tipo='email',
        titulo=f'Correo vinculado: {correo.asunto[:100]}',
        descripcion=f'De: {correo.remitente_nombre} <{correo.remitente_email}>',
        usuario=request.user,
    )

    # Add email content to opportunity conversation
    _agregar_correo_a_conversacion(correo, opp, request.user)

    return JsonResponse({'ok': True, 'oportunidad_nombre': opp.oportunidad})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_crear_oportunidad_desde_correo(request, correo_id):
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    opp_nombre = (data.get('oportunidad') or '').strip()
    if not opp_nombre:
        return JsonResponse({'ok': False, 'error': 'Nombre de oportunidad requerido'}, status=400)

    producto = data.get('producto', '').strip()
    contacto_nombre = data.get('contacto_nombre', '').strip()
    mes_actual = django_tz.now().strftime('%Y-%m')

    # Create the opportunity
    opp = TodoItem.objects.create(
        usuario=request.user,
        oportunidad=opp_nombre,
        contacto=contacto_nombre,
        producto=producto or 'No definido',
        monto=0,
        probabilidad_cierre=50,
        mes_cierre=mes_actual,
        etapa_corta='Nuevo',
        etapa_color='#6B7280',
        estado_crm='activo',
    )

    # Link correo to new opp
    correo.oportunidad = opp
    correo.save(update_fields=['oportunidad'])

    # Timeline entry
    OportunidadActividad.objects.create(
        oportunidad=opp,
        tipo='creacion',
        titulo='Oportunidad creada desde correo',
        descripcion=f'Asunto del correo: {correo.asunto}  |  De: {correo.remitente_email}',
        usuario=request.user,
    )

    return JsonResponse({'ok': True, 'oportunidad_id': opp.id, 'oportunidad_nombre': opp.oportunidad})


@login_required
@require_http_methods(['GET'])
def api_mail_descargar_adjunto(request, adjunto_id):
    """Serve an email attachment — from DB cache if available, otherwise re-fetch from IMAP."""
    from django.http import HttpResponse, Http404

    try:
        adj = MailAdjunto.objects.select_related('correo').get(
            id=adjunto_id, correo__usuario=request.user
        )
    except MailAdjunto.DoesNotExist:
        raise Http404

    disp = 'inline' if request.GET.get('inline') == '1' else 'attachment'
    safe_fname = adj.nombre_archivo.replace('"', '_')
    ct = adj.content_type or 'application/octet-stream'

    # ── Fast path: serve from DB cache ───────────────────────────────────────
    if adj.datos_b64:
        try:
            raw_bytes = base64.b64decode(adj.datos_b64)
            response = HttpResponse(raw_bytes, content_type=ct)
            response['Content-Disposition'] = f'{disp}; filename="{safe_fname}"'
            response['X-Content-Type-Options'] = 'nosniff'
            return response
        except Exception as e:
            logger.warning("datos_b64 decode failed for adjunto %s: %s", adjunto_id, e)

    # ── Slow path: re-fetch full email from IMAP ──────────────────────────────
    correo = adj.correo
    try:
        conexion_id = request.GET.get('conexion_id')
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'error': 'Sin conexión configurada'}, status=400)

    try:
        imap = _get_imap(conexion)
        imap.select(correo.carpeta_imap, readonly=True)
        typ, fetch_data = imap.uid('FETCH', correo.uid_imap.encode(), '(RFC822)')
        raw_email = None
        if fetch_data and isinstance(fetch_data[0], tuple):
            raw_email = fetch_data[0][1]
        imap.close()
        imap.logout()
    except Exception as e:
        logger.error("IMAP error fetching adjunto %s: %s", adjunto_id, e)
        return JsonResponse({'error': f'Error IMAP: {e}'}, status=500)

    if not raw_email:
        raise Http404

    msg = email_lib.message_from_bytes(raw_email)
    adj_lower = adj.nombre_archivo.strip().lower()
    target_payload = None
    all_parts = list(msg.walk())

    # Strategy 1: case-insensitive filename match
    for part in all_parts:
        fname = _decode_header_value(
            part.get_filename() or
            part.get_param('name', header='content-type') or
            part.get_param('name') or ''
        ).strip()
        if fname.lower() == adj_lower:
            payload = part.get_payload(decode=True)
            if payload:
                target_payload = payload
                ct = part.get_content_type() or ct
                break

    # Strategy 2: Content-ID based match (e.g. image001.jpg@01DCA1C5.AA9234D0)
    if not target_payload:
        for part in all_parts:
            cid = (part.get('Content-ID') or '').strip('<>').strip()
            if cid:
                cid_name = cid.split('@')[0] if '@' in cid else cid
                if cid_name.strip().lower() == adj_lower:
                    payload = part.get_payload(decode=True)
                    if payload:
                        target_payload = payload
                        ct = part.get_content_type() or ct
                        break

    # Strategy 3: content_type + exact size (handles encoding-mangled filenames)
    if not target_payload and adj.tamanio_bytes > 0 and adj.content_type:
        for part in all_parts:
            if part.get_content_type() == adj.content_type:
                payload = part.get_payload(decode=True)
                if payload and len(payload) == adj.tamanio_bytes:
                    target_payload = payload
                    break

    # Strategy 4: content_type alone, any non-trivial payload (last resort)
    if not target_payload and adj.content_type:
        for part in all_parts:
            if part.get_content_type() == adj.content_type:
                payload = part.get_payload(decode=True)
                if payload and len(payload) > 100:
                    target_payload = payload
                    break

    if not target_payload:
        raise Http404

    # Cache bytes so next request hits the fast path
    try:
        adj.datos_b64 = base64.b64encode(target_payload).decode()
        adj.save(update_fields=['datos_b64'])
    except Exception:
        pass

    response = HttpResponse(target_payload, content_type=ct)
    response['Content-Disposition'] = f'{disp}; filename="{safe_fname}"'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@login_required
@require_http_methods(['POST'])
def api_mail_check_nuevos(request):
    """Lightweight endpoint: syncs INBOX and returns count of new emails."""
    try:
        data = {}
        try:
            import json
            data = json.loads(request.body)
        except:
            pass
        conexion_id = data.get('conexion_id')
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'nuevos': 0})

    try:
        imap = _get_imap(conexion)
        imap.select('INBOX', readonly=True)
        typ, data = imap.uid('SEARCH', None, 'ALL')
        all_uids = data[0].split() if data[0] else []
        uids_to_check = [u.decode() for u in all_uids[-50:]]
        imap.logout()

        existing = set(
            MailCorreo.objects.filter(
                usuario=request.user, carpeta_imap='INBOX'
            ).values_list('uid_imap', flat=True)
        )
        new_count = sum(1 for u in uids_to_check if u not in existing)
        total_no_leidos = MailCorreo.objects.filter(
            usuario=request.user,
            carpeta_display='INBOX',
            leido=False,
            eliminado=False
        ).count()
        return JsonResponse({'ok': True, 'nuevos': new_count, 'total_no_leidos': total_no_leidos})
    except Exception as e:
        return JsonResponse({'ok': False, 'nuevos': 0, 'error': str(e)})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_destacar(request, correo_id):
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)
    correo.destacado = not correo.destacado
    correo.save(update_fields=['destacado'])
    encolar_accion_mail(correo, 'destacar' if correo.destacado else 'no_destacar')
    return JsonResponse({'ok': True, 'destacado': correo.destacado})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_archivar(request, correo_id):
    """Toggle de archivo. Local de inmediato; al archivar se encola el
    movimiento a la carpeta Archive REAL del servidor (Fase 2)."""
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)
    correo.archivado = not correo.archivado
    correo.save(update_fields=['archivado'])
    if correo.archivado:
        encolar_accion_mail(correo, 'archivar')  # mover a Archive REAL del servidor
    # Des-archivar es solo local (el UID nuevo en Archive no se conoce sin UIDPLUS)
    return JsonResponse({'ok': True, 'archivado': correo.archivado})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_eliminar(request, correo_id):
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)
    try:
        data = json.loads(request.body)
    except Exception:
        data = {}
    if data.get('restaurar'):
        # Restaurar es solo local: el UID en el servidor ya cambió al moverse
        # a la papelera real (sin UIDPLUS no lo conocemos).
        correo.eliminado = False
    else:
        correo.eliminado = True
    correo.save(update_fields=['eliminado'])
    if correo.eliminado:
        encolar_accion_mail(correo, 'eliminar')  # mover a papelera REAL del servidor
    return JsonResponse({'ok': True, 'eliminado': correo.eliminado})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_reenviar(request, correo_id):
    try:
        original = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)

    data, archivos = _parse_mail_request(request)
    if not data:
        return JsonResponse({'ok': False, 'error': 'Datos inválidos'}, status=400)

    try:
        conexion_id = data.get('conexion_id')
        if conexion_id:
            conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user, activo=True)
        else:
            conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if not conexion:
                raise MailConexion.DoesNotExist
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Sin conexión de correo'}, status=400)

    para = data.get('para', '').strip()
    cuerpo_html = data.get('cuerpo_html', '').strip()
    cuerpo_texto = data.get('cuerpo_texto', '').strip()
    if not para:
        return JsonResponse({'ok': False, 'error': 'Destinatario requerido'}, status=400)

    asunto = f"Fwd: {original.asunto}" if not original.asunto.startswith('Fwd:') else original.asunto

    # Build forward body with original email quoted
    orig_texto = original.cuerpo_texto or ''
    orig_html = original.cuerpo_html or ''
    fwd_header_txt = f"\n\n--- Mensaje reenviado ---\nDe: {original.remitente_nombre} <{original.remitente_email}>\nAsunto: {original.asunto}\n\n"
    fwd_header_html = (
        f'<br><br><div style="border-top:1px solid #E5E7EB;padding-top:10px;color:#6B7280;font-size:0.85em;">'
        f'<strong>--- Mensaje reenviado ---</strong><br>'
        f'De: {original.remitente_nombre} &lt;{original.remitente_email}&gt;<br>'
        f'Asunto: {original.asunto}</div><br>'
    )

    full_html = (cuerpo_html or cuerpo_texto) + fwd_header_html + orig_html
    full_texto = (cuerpo_texto or '') + fwd_header_txt + orig_texto

    # Validación de tamaño antes de SMTP
    err_size = _validar_tamanios_adjuntos(archivos)
    if err_size:
        return JsonResponse({'ok': False, 'error': err_size}, status=400)

    msg = _build_msg_with_attachments(full_html, full_texto, archivos)
    msg['Subject'] = asunto
    msg['From'] = conexion.correo_electronico
    msg['To'] = para

    # Adjuntos ORIGINALES del correo reenviado (estilo Gmail): van incluidos
    # siempre. Están cacheados en base64 desde la primera apertura.
    adjuntos_orig = list(original.adjuntos.all())
    total_orig = 0
    for adj in adjuntos_orig:
        if not adj.datos_b64:
            continue
        try:
            contenido = base64.b64decode(adj.datos_b64)
            total_orig += len(contenido)
            if total_orig > MAX_ADJUNTOS_TOTAL_SIZE:
                logger.warning("Reenviar %s: adjuntos originales exceden el total, se omite %s",
                               correo_id, adj.nombre_archivo)
                break
            parte = MIMEApplication(contenido)
            parte.add_header('Content-Disposition', 'attachment',
                             filename=adj.nombre_archivo or 'adjunto')
            if adj.content_type:
                parte.set_type(adj.content_type)
            msg.attach(parte)
        except Exception as e:
            logger.warning("Reenviar %s: no se pudo adjuntar %s: %s", correo_id, adj.nombre_archivo, e)

    try:
        smtp = _get_smtp(conexion)
        smtp.sendmail(conexion.correo_electronico, [a.strip() for a in para.split(',')], msg.as_bytes())
        smtp.quit()
    except Exception as e:
        logger.exception('SMTP reenviar falló: %s', e)
        return JsonResponse({'ok': False, 'error': f'Error al reenviar: {e}'}, status=500)

    correo_fwd = MailCorreo.objects.create(
        usuario=request.user, conexion=conexion,
        uid_imap=f'fwd_{django_tz.now().timestamp()}',
        carpeta_imap='SENT', carpeta_display='SENT',
        asunto=asunto,
        remitente_nombre=request.user.get_full_name() or request.user.username,
        remitente_email=conexion.correo_electronico,
        destinatarios_json=json.dumps([{'nombre': '', 'email': e.strip()} for e in para.split(',')], ensure_ascii=False),
        cuerpo_html=full_html, cuerpo_texto=full_texto,
        fecha_envio=django_tz.now(), leido=True, cuerpo_cargado=True,
        tiene_adjuntos=bool(archivos) or bool(adjuntos_orig),
    )

    for f in archivos:
        f.seek(0)
        MailAdjunto.objects.create(
            correo=correo_fwd,
            nombre_archivo=f.name,
            content_type=f.content_type or 'application/octet-stream',
            tamanio_bytes=f.size,
            datos_b64=base64.b64encode(f.read()).decode(),
        )

    return JsonResponse({'ok': True})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_eliminar_conexion(request, conexion_id):
    try:
        conexion = MailConexion.objects.get(id=conexion_id, usuario=request.user)
    except MailConexion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Conexión no encontrada'}, status=404)
    conexion.delete()
    return JsonResponse({'ok': True})


@login_required
@require_http_methods(['GET'])
def api_mail_auto_sync(request):
    """Lightweight auto-sync: checks for new emails and syncs headers only."""
    try:
        conexion = MailConexion.objects.filter(usuario=request.user, activo=True).first()
        if not conexion:
            return JsonResponse({'ok': False, 'error': 'Sin conexión'})

        password = _decrypt_password(conexion.password_encriptado)

        # Quick IMAP check
        ctx = ssl.create_default_context()
        if conexion.imap_usar_ssl:
            imap = imaplib.IMAP4_SSL(conexion.imap_servidor, conexion.imap_puerto, ssl_context=ctx)
        else:
            imap = imaplib.IMAP4(conexion.imap_servidor, conexion.imap_puerto)
            imap.starttls(ssl_context=ctx)

        imap.login(conexion.correo_electronico, password)
        imap.select('INBOX', readonly=True)

        status, data = imap.uid('search', None, 'ALL')
        all_uids = data[0].split() if data[0] else []
        recent_uids = [u.decode() for u in all_uids[-50:]]

        # Check which UIDs we don't have yet
        existing_uids = set(MailCorreo.objects.filter(
            usuario=request.user,
            carpeta_imap='INBOX'
        ).values_list('uid_imap', flat=True))

        new_uids = [u for u in recent_uids if u not in existing_uids]

        imap.logout()

        nuevos = len(new_uids)
        total_no_leidos = MailCorreo.objects.filter(
            usuario=request.user, carpeta_display='INBOX', leido=False, eliminado=False
        ).count()

        # If there are new emails, trigger a full sync
        should_sync = nuevos > 0

        return JsonResponse({
            'ok': True,
            'nuevos': nuevos,
            'total_no_leidos': total_no_leidos + nuevos,
            'should_sync': should_sync,
        })
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)})

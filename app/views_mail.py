# app/views_mail.py
# Integrated mail module — IMAP read / SMTP send / Opportunity linking

import imaplib
import smtplib
import ssl
import json
import base64
import re
import email as email_lib
import email.header
import email.utils
import email.mime.multipart
import email.mime.text
import email.mime.base
import logging
from email.encoders import encode_base64
from datetime import datetime, timezone

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils import timezone as django_tz

from .models import (
    MailConexion, MailCorreo, MailAdjunto,
    TodoItem, OportunidadActividad, MensajeOportunidad,
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
                has_adj = 'attachment' in raw_str.lower() or '"application/' in raw_str.lower()

                # Auto-thread-linking
                opp_id = None
                irt = parsed['in_reply_to']
                if irt and irt in linked_message_ids:
                    opp_id = linked_message_ids[irt]

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
        uids_to_fetch = [u.decode() for u in all_uids[-20:]]

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
    por_pagina = 25

    qs = MailCorreo.objects.filter(usuario=request.user)
    if conexion_id:
        qs = qs.filter(conexion_id=conexion_id)
    if carpeta == 'SENT':
        qs = qs.filter(carpeta_display='SENT')
    else:
        qs = qs.filter(carpeta_display='INBOX')

    total = qs.count()
    offset = (pagina - 1) * por_pagina
    correos = qs.select_related('oportunidad')[offset: offset + por_pagina]

    result = []
    for c in correos:
        result.append({
            'id': c.id,
            'asunto': c.asunto or '(Sin asunto)',
            'remitente_nombre': c.remitente_nombre,
            'remitente_email': c.remitente_email,
            'fecha_envio': c.fecha_envio.isoformat() if c.fecha_envio else None,
            'leido': c.leido,
            'tiene_adjuntos': c.tiene_adjuntos,
            'oportunidad_id': c.oportunidad_id,
            'oportunidad_nombre': c.oportunidad.oportunidad if c.oportunidad else None,
        })

    return JsonResponse({
        'ok': True,
        'correos': result,
        'total': total,
        'pagina': pagina,
        'por_pagina': por_pagina,
        'hay_mas': (offset + por_pagina) < total,
    })


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

                    # Real attachments: explicit attachment disposition OR inline+filename
                    elif fname and ('attachment' in disposition or 'inline' in disposition):
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
    })


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_enviar(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

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

    msg = email.mime.multipart.MIMEMultipart('alternative')
    msg['Subject'] = asunto
    msg['From'] = conexion.correo_electronico
    msg['To'] = para
    if cc:
        msg['CC'] = cc
    if cuerpo_texto:
        msg.attach(email.mime.text.MIMEText(cuerpo_texto, 'plain', 'utf-8'))
    msg.attach(email.mime.text.MIMEText(cuerpo_html or cuerpo_texto, 'html', 'utf-8'))

    try:
        smtp = _get_smtp(conexion)
        recipients = [a.strip() for a in para.split(',')]
        if cc:
            recipients += [a.strip() for a in cc.split(',')]
        smtp.sendmail(conexion.correo_electronico, recipients, msg.as_bytes())
        smtp.quit()
    except Exception as e:
        return JsonResponse({'ok': False, 'error': f'Error al enviar: {e}'}, status=500)

    # Save to sent cache
    MailCorreo.objects.create(
        usuario=request.user,
        conexion=conexion,
        uid_imap=f'sent_{django_tz.now().timestamp()}',
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
    )

    return JsonResponse({'ok': True})


@login_required
@csrf_exempt
@require_http_methods(['POST'])
def api_mail_responder(request, correo_id):
    try:
        original = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Correo no encontrado'}, status=404)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

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

    msg = email.mime.multipart.MIMEMultipart('alternative')
    msg['Subject'] = asunto
    msg['From'] = conexion.correo_electronico
    msg['To'] = para
    if cc:
        msg['CC'] = cc
    if original.message_id:
        msg['In-Reply-To'] = original.message_id
        msg['References'] = original.message_id
    if cuerpo_texto:
        msg.attach(email.mime.text.MIMEText(cuerpo_texto, 'plain', 'utf-8'))
    msg.attach(email.mime.text.MIMEText(cuerpo_html or cuerpo_texto, 'html', 'utf-8'))

    try:
        smtp = _get_smtp(conexion)
        recipients = [para]
        if cc:
            recipients += [a.strip() for a in cc.split(',') if a.strip()]
        if bcc:
            recipients += [a.strip() for a in bcc.split(',') if a.strip()]
        smtp.sendmail(conexion.correo_electronico, recipients, msg.as_bytes())
        smtp.quit()
    except Exception as e:
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
        oportunidad=original.oportunidad,  # Inherit opp link from original
    )

    # Add reply to opportunity conversation if linked
    if reply.oportunidad:
        _agregar_correo_a_conversacion(reply, reply.oportunidad, request.user)

    return JsonResponse({'ok': True, 'reply_id': reply.id})


def _agregar_correo_a_conversacion(correo, opp, usuario):
    """
    Crea un MensajeOportunidad con el contenido del correo.
    Usa el marcador [mail:{id}] para evitar duplicados.
    """
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
        return JsonResponse({'ok': True, 'nuevos': new_count})
    except Exception as e:
        return JsonResponse({'ok': False, 'nuevos': 0, 'error': str(e)})

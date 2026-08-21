# ----------------------------------------------------------------------
# views_leads_web.py — Integración de leads externos (página iamet-platform).
#
# La página web pública empuja cada lead de sus formularios al CRM:
#   POST /app/api/leads/web/   con header  Authorization: Bearer <token>
# El token vive en LeadWebConfig (Panel de Administración → Leads Web),
# igual que el responsable al que se asignan los prospectos creados.
# ----------------------------------------------------------------------

import json
import logging
import secrets

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db import transaction
from django.http import JsonResponse
from django.utils.crypto import constant_time_compare
from django.views.decorators.csrf import csrf_exempt

from .models import (
    Cliente, Contacto, LeadWeb, LeadWebConfig, Notificacion, Prospecto,
)
from .views_utils import is_supervisor

logger = logging.getLogger(__name__)

FUENTES_VALIDAS = {f[0] for f in LeadWeb.FUENTE_CHOICES}

TAMANO_LABELS = {
    '1-10': '1–10 empleados',
    '11-50': '11–50 empleados',
    '51-200': '51–200 empleados',
    '201-500': '201–500 empleados',
    '500+': 'Más de 500 empleados',
}


def _token_del_request(request):
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        return auth[7:].strip()
    return ''


def _sitio_por_token(token):
    """Devuelve el sitio (LeadWebConfig) cuyo token coincide, o None."""
    if not token:
        return None
    for cfg in LeadWebConfig.objects.select_related('responsable').all():
        if cfg.token and constant_time_compare(token, cfg.token):
            return cfg
    return None


def _responsable_efectivo(cfg):
    """Responsable configurado, o un supervisor como respaldo para no perder leads."""
    if cfg.responsable and cfg.responsable.is_active:
        return cfg.responsable
    respaldo = User.objects.filter(is_superuser=True, is_active=True).order_by('id').first()
    if not respaldo:
        respaldo = User.objects.filter(groups__name='Supervisores', is_active=True).order_by('id').first()
    return respaldo


def _comentarios_prospecto(data, sitio_nombre='iamet.mx'):
    """Arma el bloque de comentarios del Prospecto con todo el contexto del lead."""
    lineas = ['Lead recibido desde la página web (%s).' % sitio_nombre, '']
    nombre = (data.get('contactName') or data.get('nombre') or '').strip()
    email = (data.get('email') or '').strip()
    telefono = (data.get('phone') or data.get('telefono') or '').strip()
    if nombre:
        lineas.append(f'• Contacto: {nombre}')
    if email:
        lineas.append(f'• Correo: {email}')
    if telefono:
        lineas.append(f'• Teléfono: {telefono}')
    industria = (data.get('industry') or data.get('industria') or '').strip()
    tamano = (data.get('companySize') or data.get('tamano_empresa') or '').strip()
    vertical = (data.get('verticalSlug') or data.get('vertical') or '').strip()
    if industria:
        lineas.append(f'• Industria: {industria}')
    if tamano:
        lineas.append(f'• Tamaño de empresa: {TAMANO_LABELS.get(tamano, tamano)}')
    if vertical:
        lineas.append(f'• Vertical de interés: {vertical}')
    descripcion = (data.get('problemDescription') or data.get('descripcion') or '').strip()
    if descripcion:
        lineas += ['', 'Mensaje del cliente:', f'"{descripcion}"']
    utm = []
    for campo, etiqueta in (('utmSource', 'fuente'), ('utmMedium', 'medio'), ('utmCampaign', 'campaña')):
        valor = (data.get(campo) or data.get(campo.lower()) or '').strip()
        if valor:
            utm.append(f'{etiqueta}: {valor}')
    if utm:
        lineas += ['', 'Campaña de origen — ' + ' · '.join(utm)]

    # Campos EXTRA: cada formulario puede traer campos propios (ciudad,
    # servicio de interés, etc.). Todo lo que no reconocemos se muestra tal
    # cual como línea adicional — el vendedor no pierde ningún dato.
    conocidos = {
        'company', 'empresa', 'contactname', 'nombre', 'email', 'phone',
        'telefono', 'industry', 'industria', 'companysize', 'tamano_empresa',
        'problemdescription', 'descripcion', 'verticalslug', 'vertical',
        'source', 'fuente', 'externalid', 'external_id', 'gclid', 'fbclid',
        'msclkid', 'referrer', 'landingurl', 'firstpage', 'sessionid',
        'score', 'scorebreakdown', 'notes',
    }
    extras = []
    for clave, valor in data.items():
        if not isinstance(clave, str) or clave.lower() in conocidos or clave.lower().startswith('utm'):
            continue
        if isinstance(valor, (int, float)):
            valor = str(valor)
        if not isinstance(valor, str) or not valor.strip():
            continue
        import re as _re
        etiqueta = _re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', clave.replace('_', ' ')).strip().capitalize()
        extras.append(f'• {etiqueta}: {valor.strip()[:150]}')
        if len(extras) >= 10:
            break
    if extras:
        lineas += ['', 'Otros datos del formulario:'] + extras
    return '\n'.join(lineas)


@csrf_exempt
def api_leads_web(request):
    """Recibe un lead desde la página web y lo convierte en Prospecto."""
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST requerido'}, status=405)

    LeadWebConfig.obtener()  # garantiza que exista el sitio default con token
    cfg = _sitio_por_token(_token_del_request(request))
    if not cfg:
        return JsonResponse({'success': False, 'error': 'Token inválido'}, status=401)
    if not cfg.activo:
        return JsonResponse({'success': False, 'error': 'Integración desactivada para este sitio'}, status=503)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON inválido'}, status=400)

    empresa = (data.get('company') or data.get('empresa') or '').strip()[:200]
    nombre_contacto = (data.get('contactName') or data.get('nombre') or '').strip()[:200]
    email = (data.get('email') or '').strip()[:254]
    telefono = (data.get('phone') or data.get('telefono') or '').strip()[:30]
    fuente = (data.get('source') or data.get('fuente') or 'form').strip()
    if fuente not in FUENTES_VALIDAS:
        fuente = 'otro'
    external_id = str(data.get('externalId') or data.get('external_id') or '').strip()[:100]

    if not (empresa or nombre_contacto or email):
        return JsonResponse({'success': False, 'error': 'Se requiere al menos empresa, nombre o email'}, status=400)

    # Anti-duplicados: si la web reintenta el mismo lead, respondemos OK sin recrear.
    if external_id:
        previo = LeadWeb.objects.filter(external_id=external_id, fuente=fuente,
                                        sitio=cfg).exclude(estado='error').first()
        if previo:
            return JsonResponse({
                'success': True, 'duplicado': True,
                'lead_id': previo.id, 'prospecto_id': previo.prospecto_id,
            })

    responsable = _responsable_efectivo(cfg)
    if not responsable:
        return JsonResponse({'success': False, 'error': 'No hay responsable configurado'}, status=500)

    try:
        with transaction.atomic():
            nombre_cliente = empresa or nombre_contacto or email
            cliente = Cliente.objects.filter(nombre_empresa__iexact=nombre_cliente).first()
            if not cliente:
                cliente = Cliente.objects.create(
                    nombre_empresa=nombre_cliente,
                    contacto_principal=nombre_contacto or None,
                    telefono=telefono or None,
                    email=email or None,
                    asignado_a=responsable,
                    es_prospecto=True,
                )

            contacto = None
            if nombre_contacto or email:
                if email:
                    contacto = Contacto.objects.filter(cliente=cliente, email__iexact=email).first()
                if not contacto:
                    contacto = Contacto.objects.create(
                        nombre=nombre_contacto or email,
                        email=email,
                        telefono=telefono,
                        cliente=cliente,
                    )

            # El usuario pidió (2026-08-19) que el Área del prospecto muestre la
            # industria que la persona eligió en el formulario web, y que el
            # producto quede VACÍO — no sabemos qué marca busca hasta calificarlo.
            industria = (data.get('industry') or data.get('industria') or '').strip()[:50]
            # Inscripciones de IAMET Academy: el mensaje llega como "Solicita el
            # curso: ..." — el prospecto se nombra como solicitud de curso y el
            # producto queda en CURSO para distinguirlo en el kanban.
            mensaje_lead = str(data.get('problemDescription') or data.get('descripcion') or '').strip()
            es_curso = mensaje_lead.lower().startswith('solicita el curso')
            prospecto = Prospecto.objects.create(
                usuario=responsable,
                nombre=(f'Solicitud de curso — {nombre_cliente}' if es_curso
                        else f'Solicitud web — {nombre_cliente}')[:200],
                cliente=cliente,
                contacto=contacto,
                producto='CURSO' if es_curso else '',
                area=industria or 'SISTEMAS',
                comentarios=_comentarios_prospecto(data, cfg.nombre),
            )

            lead = LeadWeb.objects.create(
                external_id=external_id,
                fuente=fuente,
                empresa=empresa,
                nombre_contacto=nombre_contacto,
                email=email,
                telefono=telefono,
                payload=data,
                prospecto=prospecto,
                cliente=cliente,
                estado='procesado',
                sitio=cfg,
            )
    except Exception as e:
        logger.error(f'[leads-web] Error procesando lead: {e}')
        try:
            LeadWeb.objects.create(
                external_id=external_id, fuente=fuente, empresa=empresa,
                nombre_contacto=nombre_contacto, email=email, telefono=telefono,
                payload=data, estado='error', error=str(e)[:1000], sitio=cfg,
            )
        except Exception:
            pass
        return JsonResponse({'success': False, 'error': 'Error interno al procesar el lead'}, status=500)

    _notificar_lead_nuevo(cfg, responsable, lead)
    return JsonResponse({'success': True, 'lead_id': lead.id, 'prospecto_id': prospecto.id})


def _notificar_lead_nuevo(cfg, responsable, lead):
    """Avisa al responsable (y opcionalmente a supervisores) del lead nuevo."""
    quien = lead.nombre_contacto or lead.email or 'Alguien'
    empresa = f' de {lead.empresa}' if lead.empresa else ''
    titulo = 'Nuevo lead desde la página web'
    sitio = lead.sitio.nombre if lead.sitio else 'la página web'
    mensaje = f'{quien}{empresa} pidió información en {sitio}. Ya está en tu kanban de prospección.'
    destinatarios = {responsable.id: responsable}
    if cfg.notificar_supervisores:
        for sup in User.objects.filter(groups__name='Supervisores', is_active=True):
            destinatarios.setdefault(sup.id, sup)
    for u in destinatarios.values():
        try:
            Notificacion.objects.create(
                usuario_destinatario=u,
                tipo='lead_web',
                titulo=titulo,
                mensaje=mensaje,
                prospecto=lead.prospecto,
            )
        except Exception as e:
            logger.warning(f'[leads-web] No se pudo notificar a {u}: {e}')


@login_required
def api_admin_leads_web(request):
    """Panel de Administración → Leads Web: sitios conectados + últimos leads."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'No autorizado'}, status=403)

    LeadWebConfig.obtener()  # garantiza que exista al menos el sitio default

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'success': False, 'error': 'JSON inválido'}, status=400)

        accion = data.get('accion', '')
        if accion == 'crear_sitio':
            nombre = (data.get('nombre') or '').strip()[:80]
            if not nombre:
                return JsonResponse({'success': False, 'error': 'Nombre del sitio requerido'}, status=400)
            if LeadWebConfig.objects.filter(nombre__iexact=nombre).exists():
                return JsonResponse({'success': False, 'error': 'Ya existe un sitio con ese nombre'}, status=400)
            LeadWebConfig.objects.create(nombre=nombre, token=secrets.token_urlsafe(32))
        else:
            try:
                cfg = LeadWebConfig.objects.get(id=int(data.get('sitio_id')))
            except (LeadWebConfig.DoesNotExist, ValueError, TypeError):
                return JsonResponse({'success': False, 'error': 'Sitio no encontrado'}, status=404)
            if accion == 'regenerar_token':
                cfg.token = secrets.token_urlsafe(32)
                cfg.save(update_fields=['token', 'fecha_actualizacion'])
            elif accion == 'eliminar_sitio':
                if cfg.leads.exists():
                    return JsonResponse({'success': False, 'error': 'Este sitio ya recibió leads; mejor desactívalo'}, status=400)
                cfg.delete()
            else:
                if 'nombre' in data:
                    nombre = (data.get('nombre') or '').strip()[:80]
                    if nombre:
                        cfg.nombre = nombre
                if 'responsable_id' in data:
                    rid = data.get('responsable_id')
                    if rid:
                        try:
                            cfg.responsable = User.objects.get(id=int(rid), is_active=True)
                        except (User.DoesNotExist, ValueError, TypeError):
                            return JsonResponse({'success': False, 'error': 'Usuario no encontrado'}, status=400)
                    else:
                        cfg.responsable = None
                if 'activo' in data:
                    cfg.activo = bool(data['activo'])
                if 'notificar_supervisores' in data:
                    cfg.notificar_supervisores = bool(data['notificar_supervisores'])
                cfg.save()

    sitios = [{
        'id': c.id,
        'nombre': c.nombre,
        'responsable_id': c.responsable_id,
        'activo': c.activo,
        'notificar_supervisores': c.notificar_supervisores,
        'token': c.token,
        'leads_recibidos': c.leads.count(),
    } for c in LeadWebConfig.objects.all().order_by('id')]

    leads = []
    for l in LeadWeb.objects.select_related('prospecto', 'sitio')[:30]:
        leads.append({
            'id': l.id,
            'fecha': l.fecha_creacion.strftime('%d/%m/%Y %H:%M'),
            'empresa': l.empresa,
            'contacto': l.nombre_contacto,
            'email': l.email,
            'telefono': l.telefono,
            'fuente': l.get_fuente_display(),
            'sitio': l.sitio.nombre if l.sitio else '—',
            'estado': l.estado,
            'prospecto_id': l.prospecto_id,
            'prospecto_etapa': l.prospecto.get_etapa_display() if l.prospecto else '',
        })

    usuarios = [
        {'id': u.id, 'nombre': (f'{u.first_name} {u.last_name}'.strip() or u.username)}
        for u in User.objects.filter(is_active=True).order_by('first_name', 'last_name', 'username')
    ]

    return JsonResponse({
        'success': True,
        'sitios': sitios,
        'endpoint': request.build_absolute_uri('/app/api/leads/web/'),
        'usuarios': usuarios,
        'leads': leads,
    })

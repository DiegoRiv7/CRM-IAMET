# views_campanas.py — Campaign template import & browse

import json
import logging
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods

from .models import CampanaTemplate, CampanaEnvio, Cliente
from .views_utils import is_supervisor

logger = logging.getLogger(__name__)


@login_required
def api_campana_templates(request):
    """GET: listar templates. POST: crear template (solo admin/supervisor)."""
    if request.method == 'GET':
        marca = request.GET.get('marca', '')
        qs = CampanaTemplate.objects.filter(activa=True)
        if marca:
            qs = qs.filter(marca__iexact=marca)
        qs = qs.order_by('-fecha_creacion')

        templates = []
        for t in qs:
            templates.append({
                'id': t.id,
                'nombre': t.nombre,
                'marca': t.marca,
                'preview_text': (t.html_content or '')[:200].replace('<', '&lt;'),
                'fecha': t.fecha_creacion.strftime('%d/%m/%Y %H:%M') if t.fecha_creacion else '',
                'creado_por': t.creado_por.get_full_name() or t.creado_por.username if t.creado_por else '',
            })
        return JsonResponse({'templates': templates})

    elif request.method == 'POST':
        if not is_supervisor(request.user):
            return JsonResponse({'success': False, 'error': 'Solo administradores pueden importar plantillas'}, status=403)

        nombre = request.POST.get('nombre', '').strip()
        marca = request.POST.get('marca', '').strip().upper()
        html_file = request.FILES.get('html_file')

        if not nombre:
            return JsonResponse({'success': False, 'error': 'Nombre requerido'}, status=400)
        if not marca:
            return JsonResponse({'success': False, 'error': 'Marca requerida'}, status=400)
        if not html_file:
            return JsonResponse({'success': False, 'error': 'Archivo HTML requerido'}, status=400)

        # Read HTML content
        try:
            html_content = html_file.read().decode('utf-8')
        except Exception as e:
            return JsonResponse({'success': False, 'error': f'Error al leer archivo: {str(e)}'}, status=400)

        template = CampanaTemplate.objects.create(
            nombre=nombre,
            marca=marca,
            html_content=html_content,
            creado_por=request.user,
        )

        return JsonResponse({
            'success': True,
            'id': template.id,
            'nombre': template.nombre,
            'marca': template.marca,
        })


@login_required
def api_campana_template_detalle(request, template_id):
    """GET: detalle con HTML completo. DELETE: desactivar (solo admin)."""
    try:
        template = CampanaTemplate.objects.get(id=template_id)
    except CampanaTemplate.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Template no encontrado'}, status=404)

    if request.method == 'GET':
        return JsonResponse({
            'id': template.id,
            'nombre': template.nombre,
            'marca': template.marca,
            'html_content': template.html_content,
            'fecha': template.fecha_creacion.strftime('%d/%m/%Y %H:%M') if template.fecha_creacion else '',
            'creado_por': template.creado_por.get_full_name() or template.creado_por.username if template.creado_por else '',
        })

    elif request.method == 'DELETE':
        if not is_supervisor(request.user):
            return JsonResponse({'success': False, 'error': 'Solo administradores'}, status=403)
        template.activa = False
        template.save(update_fields=['activa'])
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no soportado'}, status=405)


@login_required
def api_campana_template_render(request, template_id):
    """POST: devuelve el HTML del template para preview."""
    try:
        template = CampanaTemplate.objects.get(id=template_id)
    except CampanaTemplate.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Template no encontrado'}, status=404)

    return JsonResponse({
        'html': template.html_content,
        'nombre': template.nombre,
        'marca': template.marca,
    })


@login_required
def api_campana_registrar_envio(request):
    """POST: registra un envío de campaña por correo."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST requerido'}, status=405)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'JSON invalido'}, status=400)

    template_id = data.get('template_id')
    contacto_email = data.get('contacto_email', '').strip()
    message_id = data.get('message_id', '')

    if not template_id or not contacto_email:
        return JsonResponse({'error': 'template_id y contacto_email requeridos'}, status=400)

    try:
        template = CampanaTemplate.objects.get(id=template_id)
    except CampanaTemplate.DoesNotExist:
        return JsonResponse({'error': 'Template no encontrado'}, status=404)

    # Try to find client by email
    cliente = None
    try:
        from .models import Contacto
        contacto = Contacto.objects.filter(email__iexact=contacto_email).first()
        if contacto and contacto.cliente_id:
            cliente = contacto.cliente
        else:
            # Try matching by client email
            cliente = Cliente.objects.filter(email__iexact=contacto_email).first()
    except Exception:
        pass

    envio = CampanaEnvio.objects.create(
        template=template,
        cliente=cliente,
        contacto_email=contacto_email,
        contacto_nombre=contacto_email.split('@')[0],
        enviado_por=request.user,
        mail_message_id=message_id,
    )

    return JsonResponse({'ok': True, 'envio_id': envio.id})

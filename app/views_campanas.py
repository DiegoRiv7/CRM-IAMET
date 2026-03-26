# views_campanas.py — Campaign template import & browse

import json
import logging
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods

from .models import CampanaTemplate
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

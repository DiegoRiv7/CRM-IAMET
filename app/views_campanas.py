# views_campanas.py — Campaign management views

import json
import logging
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.utils import timezone

from .models import CampanaTemplate, Campana, Cliente, Contacto, Prospecto
from .views_utils import is_supervisor

logger = logging.getLogger(__name__)


# ─── HTML Render Engine ──────────────────────────────────────────────────────

def render_bloques_to_html(bloques, config=None):
    """Convert editor blocks to email-safe HTML with inline CSS.

    Block types:
    - header: {text, level, align}
    - text: {html (rich text), align}
    - image: {src, alt, width, align, link}
    - button: {text, url, color, align}
    - divider: {color, spacing}
    - product: {name, description, price, image_src}
    - spacer: {height}
    - columns: {columns: [{blocks: [...]}]}  # 2-3 column layout
    - footer: {text, unsubscribe_text}
    """
    if not config:
        config = {}

    primary_color = config.get('color_primario', '#0052D4')
    bg_color = config.get('color_fondo', '#F5F5F7')
    logo_url = config.get('logo_url', '')

    # Email-safe HTML uses tables for layout, inline CSS, no external stylesheets
    html_parts = []

    # Wrapper
    html_parts.append(f'''<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:{bg_color};font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{bg_color};">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
''')

    # Logo if provided
    if logo_url:
        html_parts.append(f'''<tr><td align="center" style="padding:24px 30px 12px;">
<img src="{logo_url}" alt="Logo" style="max-width:180px;height:auto;display:block;">
</td></tr>''')

    # Render each block
    for block in bloques:
        block_type = block.get('type', '')
        content = block.get('content', {})

        if block_type == 'header':
            text = content.get('text', '')
            level = content.get('level', 1)
            align = content.get('align', 'left')
            sizes = {1: '28px', 2: '22px', 3: '18px'}
            size = sizes.get(level, '22px')
            html_parts.append(f'''<tr><td style="padding:20px 30px 8px;font-size:{size};font-weight:700;color:#1D1D1F;text-align:{align};line-height:1.3;">
{text}</td></tr>''')

        elif block_type == 'text':
            text_html = content.get('html', content.get('text', ''))
            align = content.get('align', 'left')
            html_parts.append(f'''<tr><td style="padding:8px 30px;font-size:15px;color:#3C3C43;text-align:{align};line-height:1.6;">
{text_html}</td></tr>''')

        elif block_type == 'image':
            src = content.get('src', '')
            alt = content.get('alt', '')
            width = content.get('width', '100%')
            link = content.get('link', '')
            align = content.get('align', 'center')
            img_html = f'<img src="{src}" alt="{alt}" style="max-width:{width};height:auto;display:block;border-radius:6px;">'
            if link:
                img_html = f'<a href="{link}" target="_blank">{img_html}</a>'
            html_parts.append(f'''<tr><td align="{align}" style="padding:12px 30px;">
{img_html}</td></tr>''')

        elif block_type == 'button':
            text = content.get('text', 'Click aquí')
            url = content.get('url', '#')
            color = content.get('color', primary_color)
            align = content.get('align', 'center')
            html_parts.append(f'''<tr><td align="{align}" style="padding:16px 30px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background-color:{color};border-radius:8px;">
<a href="{url}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">{text}</a>
</td></tr></table></td></tr>''')

        elif block_type == 'divider':
            color_div = content.get('color', '#E5E5EA')
            spacing = content.get('spacing', '20')
            html_parts.append(f'''<tr><td style="padding:{spacing}px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="border-top:1px solid {color_div};font-size:0;line-height:0;">&nbsp;</td></tr>
</table></td></tr>''')

        elif block_type == 'product':
            name = content.get('name', '')
            desc = content.get('description', '')
            price = content.get('price', '')
            img = content.get('image_src', '')
            img_cell = f'<td width="120" style="padding-right:16px;vertical-align:top;"><img src="{img}" alt="{name}" style="width:120px;height:auto;border-radius:6px;display:block;"></td>' if img else ''
            html_parts.append(f'''<tr><td style="padding:12px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:8px;padding:16px;">
<tr>{img_cell}<td style="vertical-align:top;">
<div style="font-size:16px;font-weight:700;color:#1D1D1F;margin-bottom:4px;">{name}</div>
<div style="font-size:13px;color:#86868B;line-height:1.4;margin-bottom:8px;">{desc}</div>
{f'<div style="font-size:18px;font-weight:700;color:{primary_color};">{price}</div>' if price else ''}
</td></tr></table></td></tr>''')

        elif block_type == 'spacer':
            height = content.get('height', '20')
            html_parts.append(f'<tr><td style="height:{height}px;font-size:0;line-height:0;">&nbsp;</td></tr>')

        elif block_type == 'columns':
            columns = content.get('columns', [])
            num_cols = len(columns)
            if num_cols > 0:
                col_width = int(600 / num_cols)
                html_parts.append('<tr><td style="padding:8px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>')
                for col in columns:
                    col_blocks = col.get('blocks', [])
                    col_html = render_bloques_to_html_inner(col_blocks, config)
                    html_parts.append(f'<td width="{col_width}" style="vertical-align:top;padding:0 4px;">{col_html}</td>')
                html_parts.append('</tr></table></td></tr>')

        elif block_type == 'footer':
            text = content.get('text', '')
            unsub = content.get('unsubscribe_text', '')
            html_parts.append(f'''<tr><td style="padding:20px 30px;font-size:12px;color:#86868B;text-align:center;line-height:1.5;border-top:1px solid #E5E5EA;">
{text}
{f'<br><a href="#" style="color:#86868B;text-decoration:underline;">{unsub}</a>' if unsub else ''}
</td></tr>''')

    # Close wrapper
    html_parts.append('''</table>
</td></tr></table>
</body></html>''')

    return '\n'.join(html_parts)


def render_bloques_to_html_inner(bloques, config=None):
    """Render blocks without the full HTML wrapper (for nested columns)."""
    if not config:
        config = {}

    primary_color = config.get('color_primario', '#0052D4')
    parts = []

    for block in bloques:
        block_type = block.get('type', '')
        content = block.get('content', {})

        if block_type == 'header':
            text = content.get('text', '')
            level = content.get('level', 1)
            align = content.get('align', 'left')
            sizes = {1: '28px', 2: '22px', 3: '18px'}
            size = sizes.get(level, '22px')
            parts.append(f'<div style="padding:8px 0;font-size:{size};font-weight:700;color:#1D1D1F;text-align:{align};line-height:1.3;">{text}</div>')

        elif block_type == 'text':
            text_html = content.get('html', content.get('text', ''))
            align = content.get('align', 'left')
            parts.append(f'<div style="padding:4px 0;font-size:15px;color:#3C3C43;text-align:{align};line-height:1.6;">{text_html}</div>')

        elif block_type == 'image':
            src = content.get('src', '')
            alt = content.get('alt', '')
            width = content.get('width', '100%')
            link = content.get('link', '')
            img_html = f'<img src="{src}" alt="{alt}" style="max-width:{width};height:auto;display:block;border-radius:6px;">'
            if link:
                img_html = f'<a href="{link}" target="_blank">{img_html}</a>'
            parts.append(f'<div style="padding:8px 0;text-align:center;">{img_html}</div>')

        elif block_type == 'button':
            text = content.get('text', 'Click aquí')
            url = content.get('url', '#')
            color = content.get('color', primary_color)
            align = content.get('align', 'center')
            parts.append(f'<div style="padding:8px 0;text-align:{align};"><a href="{url}" target="_blank" style="display:inline-block;padding:10px 24px;background-color:{color};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;border-radius:6px;">{text}</a></div>')

        elif block_type == 'divider':
            color_div = content.get('color', '#E5E5EA')
            parts.append(f'<div style="padding:8px 0;"><hr style="border:none;border-top:1px solid {color_div};"></div>')

        elif block_type == 'spacer':
            height = content.get('height', '20')
            parts.append(f'<div style="height:{height}px;"></div>')

    return ''.join(parts)


# ─── Template CRUD ───────────────────────────────────────────────────────────

@login_required
@require_http_methods(["GET", "POST"])
def api_campana_templates(request):
    """GET: list templates, POST: create template"""
    if request.method == 'GET':
        # User sees own templates + system templates
        templates = CampanaTemplate.objects.filter(
            models_q_filter_templates(request.user)
        ).select_related('creado_por')

        data = [{
            'id': t.id,
            'nombre': t.nombre,
            'descripcion': t.descripcion,
            'asunto': t.asunto,
            'color_primario': t.color_primario,
            'color_fondo': t.color_fondo,
            'logo_url': t.logo_url,
            'es_plantilla_sistema': t.es_plantilla_sistema,
            'creado_por': t.creado_por.get_full_name() or t.creado_por.username,
            'fecha_creacion': t.fecha_creacion.isoformat(),
            'fecha_actualizacion': t.fecha_actualizacion.isoformat(),
        } for t in templates]

        return JsonResponse({'ok': True, 'templates': data})

    # POST — create
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    nombre = body.get('nombre', '').strip()
    if not nombre:
        return JsonResponse({'ok': False, 'error': 'El nombre es requerido'}, status=400)

    template = CampanaTemplate.objects.create(
        nombre=nombre,
        descripcion=body.get('descripcion', ''),
        bloques_json=body.get('bloques_json', []),
        html_rendered=body.get('html_rendered', ''),
        color_primario=body.get('color_primario', '#0052D4'),
        color_fondo=body.get('color_fondo', '#F5F5F7'),
        logo_url=body.get('logo_url', ''),
        asunto=body.get('asunto', ''),
        creado_por=request.user,
        es_plantilla_sistema=False,
    )

    return JsonResponse({
        'ok': True,
        'template': {
            'id': template.id,
            'nombre': template.nombre,
        }
    }, status=201)


def models_q_filter_templates(user):
    """Return Q filter: own templates + system templates."""
    from django.db.models import Q
    return Q(creado_por=user) | Q(es_plantilla_sistema=True)


@login_required
@require_http_methods(["GET", "PUT", "DELETE"])
def api_campana_template_detalle(request, template_id):
    """GET/PUT/DELETE a single template"""
    try:
        template = CampanaTemplate.objects.select_related('creado_por').get(id=template_id)
    except CampanaTemplate.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Template no encontrado'}, status=404)

    # Access check: own template or system template (read) or supervisor
    if template.creado_por != request.user and not template.es_plantilla_sistema and not is_supervisor(request.user):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)

    if request.method == 'GET':
        return JsonResponse({
            'ok': True,
            'template': {
                'id': template.id,
                'nombre': template.nombre,
                'descripcion': template.descripcion,
                'bloques_json': template.bloques_json,
                'html_rendered': template.html_rendered,
                'color_primario': template.color_primario,
                'color_fondo': template.color_fondo,
                'logo_url': template.logo_url,
                'asunto': template.asunto,
                'es_plantilla_sistema': template.es_plantilla_sistema,
                'creado_por': template.creado_por.get_full_name() or template.creado_por.username,
                'fecha_creacion': template.fecha_creacion.isoformat(),
                'fecha_actualizacion': template.fecha_actualizacion.isoformat(),
            }
        })

    # Write operations: must be owner or supervisor
    if template.creado_por != request.user and not is_supervisor(request.user):
        return JsonResponse({'ok': False, 'error': 'Sin permisos para editar'}, status=403)

    if request.method == 'PUT':
        try:
            body = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

        if 'nombre' in body:
            template.nombre = body['nombre']
        if 'descripcion' in body:
            template.descripcion = body['descripcion']
        if 'bloques_json' in body:
            template.bloques_json = body['bloques_json']
        if 'html_rendered' in body:
            template.html_rendered = body['html_rendered']
        if 'color_primario' in body:
            template.color_primario = body['color_primario']
        if 'color_fondo' in body:
            template.color_fondo = body['color_fondo']
        if 'logo_url' in body:
            template.logo_url = body['logo_url']
        if 'asunto' in body:
            template.asunto = body['asunto']

        template.save()
        return JsonResponse({'ok': True, 'message': 'Template actualizado'})

    if request.method == 'DELETE':
        template.delete()
        return JsonResponse({'ok': True, 'message': 'Template eliminado'})


@login_required
@require_http_methods(["POST"])
def api_campana_template_render(request, template_id):
    """POST: recibe bloques_json, genera html_rendered y lo devuelve.
    Also saves the rendered HTML to the template.
    """
    try:
        template = CampanaTemplate.objects.get(id=template_id)
    except CampanaTemplate.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Template no encontrado'}, status=404)

    if template.creado_por != request.user and not is_supervisor(request.user):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    bloques = body.get('bloques_json', template.bloques_json)
    config = {
        'color_primario': body.get('color_primario', template.color_primario),
        'color_fondo': body.get('color_fondo', template.color_fondo),
        'logo_url': body.get('logo_url', template.logo_url),
    }

    html = render_bloques_to_html(bloques, config)

    # Save to template
    template.bloques_json = bloques
    template.html_rendered = html
    if 'color_primario' in body:
        template.color_primario = body['color_primario']
    if 'color_fondo' in body:
        template.color_fondo = body['color_fondo']
    if 'logo_url' in body:
        template.logo_url = body['logo_url']
    template.save()

    return JsonResponse({
        'ok': True,
        'html': html,
    })


# ─── Campaña CRUD ────────────────────────────────────────────────────────────

@login_required
@require_http_methods(["GET", "POST"])
def api_campanas(request):
    """GET: list campañas del usuario, POST: create"""
    if request.method == 'GET':
        qs = Campana.objects.select_related('template', 'creado_por', 'prospecto', 'cliente')

        # Supervisors see all, regular users see their own
        if not is_supervisor(request.user):
            qs = qs.filter(creado_por=request.user)

        # Optional filters
        estado = request.GET.get('estado')
        if estado:
            qs = qs.filter(estado=estado)

        data = [{
            'id': c.id,
            'nombre': c.nombre,
            'asunto': c.asunto,
            'estado': c.estado,
            'total_enviados': c.total_enviados,
            'total_abiertos': c.total_abiertos,
            'total_clicks': c.total_clicks,
            'template_nombre': c.template.nombre if c.template else None,
            'prospecto_nombre': str(c.prospecto) if c.prospecto else None,
            'cliente_nombre': str(c.cliente) if c.cliente else None,
            'producto': c.producto,
            'destinatarios_count': len(c.destinatarios_json) if c.destinatarios_json else 0,
            'creado_por': c.creado_por.get_full_name() or c.creado_por.username,
            'fecha_creacion': c.fecha_creacion.isoformat(),
            'fecha_envio': c.fecha_envio.isoformat() if c.fecha_envio else None,
        } for c in qs]

        return JsonResponse({'ok': True, 'campanas': data})

    # POST — create
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    nombre = body.get('nombre', '').strip()
    asunto = body.get('asunto', '').strip()
    if not nombre:
        return JsonResponse({'ok': False, 'error': 'El nombre es requerido'}, status=400)
    if not asunto:
        return JsonResponse({'ok': False, 'error': 'El asunto es requerido'}, status=400)

    # Resolve template
    template = None
    template_id = body.get('template_id')
    if template_id:
        try:
            template = CampanaTemplate.objects.get(id=template_id)
        except CampanaTemplate.DoesNotExist:
            pass

    # Resolve prospecto/cliente
    prospecto = None
    prospecto_id = body.get('prospecto_id')
    if prospecto_id:
        try:
            prospecto = Prospecto.objects.get(id=prospecto_id)
        except Prospecto.DoesNotExist:
            pass

    cliente = None
    cliente_id = body.get('cliente_id')
    if cliente_id:
        try:
            cliente = Cliente.objects.get(id=cliente_id)
        except Cliente.DoesNotExist:
            pass

    campana = Campana.objects.create(
        nombre=nombre,
        asunto=asunto,
        template=template,
        html_final=body.get('html_final', template.html_rendered if template else ''),
        estado='borrador',
        destinatarios_json=body.get('destinatarios_json', []),
        prospecto=prospecto,
        cliente=cliente,
        producto=body.get('producto', ''),
        creado_por=request.user,
    )

    return JsonResponse({
        'ok': True,
        'campana': {
            'id': campana.id,
            'nombre': campana.nombre,
            'estado': campana.estado,
        }
    }, status=201)


@login_required
@require_http_methods(["GET", "PUT", "DELETE"])
def api_campana_detalle(request, campana_id):
    """GET/PUT/DELETE a single campana"""
    try:
        campana = Campana.objects.select_related(
            'template', 'creado_por', 'prospecto', 'cliente'
        ).get(id=campana_id)
    except Campana.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Campaña no encontrada'}, status=404)

    # Access check
    if campana.creado_por != request.user and not is_supervisor(request.user):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)

    if request.method == 'GET':
        return JsonResponse({
            'ok': True,
            'campana': {
                'id': campana.id,
                'nombre': campana.nombre,
                'asunto': campana.asunto,
                'estado': campana.estado,
                'html_final': campana.html_final,
                'template_id': campana.template_id,
                'template_nombre': campana.template.nombre if campana.template else None,
                'destinatarios_json': campana.destinatarios_json,
                'total_enviados': campana.total_enviados,
                'total_abiertos': campana.total_abiertos,
                'total_clicks': campana.total_clicks,
                'prospecto_id': campana.prospecto_id,
                'prospecto_nombre': str(campana.prospecto) if campana.prospecto else None,
                'cliente_id': campana.cliente_id,
                'cliente_nombre': str(campana.cliente) if campana.cliente else None,
                'producto': campana.producto,
                'creado_por': campana.creado_por.get_full_name() or campana.creado_por.username,
                'fecha_creacion': campana.fecha_creacion.isoformat(),
                'fecha_envio': campana.fecha_envio.isoformat() if campana.fecha_envio else None,
            }
        })

    if request.method == 'PUT':
        # Can only edit drafts or cancelled
        if campana.estado not in ('borrador', 'cancelada'):
            return JsonResponse({'ok': False, 'error': 'Solo se pueden editar campañas en borrador'}, status=400)

        try:
            body = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

        if 'nombre' in body:
            campana.nombre = body['nombre']
        if 'asunto' in body:
            campana.asunto = body['asunto']
        if 'html_final' in body:
            campana.html_final = body['html_final']
        if 'estado' in body:
            allowed = ('borrador', 'programada', 'cancelada')
            if body['estado'] in allowed:
                campana.estado = body['estado']
        if 'destinatarios_json' in body:
            campana.destinatarios_json = body['destinatarios_json']
        if 'producto' in body:
            campana.producto = body['producto']

        # Resolve template
        if 'template_id' in body:
            if body['template_id']:
                try:
                    campana.template = CampanaTemplate.objects.get(id=body['template_id'])
                except CampanaTemplate.DoesNotExist:
                    pass
            else:
                campana.template = None

        # Resolve prospecto/cliente
        if 'prospecto_id' in body:
            if body['prospecto_id']:
                try:
                    campana.prospecto = Prospecto.objects.get(id=body['prospecto_id'])
                except Prospecto.DoesNotExist:
                    pass
            else:
                campana.prospecto = None

        if 'cliente_id' in body:
            if body['cliente_id']:
                try:
                    campana.cliente = Cliente.objects.get(id=body['cliente_id'])
                except Cliente.DoesNotExist:
                    pass
            else:
                campana.cliente = None

        campana.save()
        return JsonResponse({'ok': True, 'message': 'Campaña actualizada'})

    if request.method == 'DELETE':
        if campana.estado in ('enviando', 'enviada'):
            return JsonResponse({'ok': False, 'error': 'No se puede eliminar una campaña enviada'}, status=400)
        campana.delete()
        return JsonResponse({'ok': True, 'message': 'Campaña eliminada'})


@login_required
@require_http_methods(["GET"])
def api_campana_preview(request, campana_id):
    """GET: devuelve HTML preview de la campaña"""
    try:
        campana = Campana.objects.select_related('template').get(id=campana_id)
    except Campana.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Campaña no encontrada'}, status=404)

    if campana.creado_por != request.user and not is_supervisor(request.user):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)

    html = campana.html_final
    if not html and campana.template:
        # Re-render from template if no final HTML
        config = {
            'color_primario': campana.template.color_primario,
            'color_fondo': campana.template.color_fondo,
            'logo_url': campana.template.logo_url,
        }
        html = render_bloques_to_html(campana.template.bloques_json, config)

    return JsonResponse({
        'ok': True,
        'html': html,
        'asunto': campana.asunto,
    })


# ─── Destinatarios ───────────────────────────────────────────────────────────

@login_required
@require_http_methods(["GET", "POST"])
def api_campana_destinatarios(request, campana_id):
    """GET: list destinatarios, POST: add/replace destinatarios"""
    try:
        campana = Campana.objects.get(id=campana_id)
    except Campana.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Campaña no encontrada'}, status=404)

    if campana.creado_por != request.user and not is_supervisor(request.user):
        return JsonResponse({'ok': False, 'error': 'Sin permisos'}, status=403)

    if request.method == 'GET':
        # Return current destinatarios + available contacts
        destinatarios = campana.destinatarios_json or []

        # Also return available contacts for selection
        contactos_qs = Contacto.objects.filter(email__isnull=False).exclude(email='')
        if campana.cliente:
            contactos_qs = contactos_qs.filter(cliente=campana.cliente)

        contactos_disponibles = [{
            'id': c.id,
            'nombre': c.nombre,
            'email': c.email,
            'cliente': str(c.cliente) if c.cliente else '',
        } for c in contactos_qs[:200]]

        return JsonResponse({
            'ok': True,
            'destinatarios': destinatarios,
            'contactos_disponibles': contactos_disponibles,
        })

    # POST — set destinatarios
    if campana.estado not in ('borrador', 'programada'):
        return JsonResponse({'ok': False, 'error': 'No se pueden cambiar destinatarios'}, status=400)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)

    action = body.get('action', 'replace')

    if action == 'add_contactos':
        # Add contacts by IDs
        contacto_ids = body.get('contacto_ids', [])
        contactos = Contacto.objects.filter(
            id__in=contacto_ids, email__isnull=False
        ).exclude(email='')

        existing_emails = {d.get('email') for d in (campana.destinatarios_json or [])}
        nuevos = []
        for c in contactos:
            if c.email not in existing_emails:
                nuevos.append({
                    'contacto_id': c.id,
                    'nombre': c.nombre,
                    'email': c.email,
                    'cliente': str(c.cliente) if c.cliente else '',
                })

        campana.destinatarios_json = (campana.destinatarios_json or []) + nuevos
        campana.save(update_fields=['destinatarios_json'])

        return JsonResponse({
            'ok': True,
            'message': f'{len(nuevos)} destinatarios agregados',
            'total': len(campana.destinatarios_json),
        })

    elif action == 'add_manual':
        # Add manual email entries
        entries = body.get('entries', [])
        existing_emails = {d.get('email') for d in (campana.destinatarios_json or [])}
        nuevos = []
        for entry in entries:
            email = entry.get('email', '').strip()
            if email and email not in existing_emails:
                nuevos.append({
                    'nombre': entry.get('nombre', ''),
                    'email': email,
                })
                existing_emails.add(email)

        campana.destinatarios_json = (campana.destinatarios_json or []) + nuevos
        campana.save(update_fields=['destinatarios_json'])

        return JsonResponse({
            'ok': True,
            'message': f'{len(nuevos)} destinatarios agregados',
            'total': len(campana.destinatarios_json),
        })

    elif action == 'remove':
        # Remove by email
        emails_to_remove = set(body.get('emails', []))
        campana.destinatarios_json = [
            d for d in (campana.destinatarios_json or [])
            if d.get('email') not in emails_to_remove
        ]
        campana.save(update_fields=['destinatarios_json'])

        return JsonResponse({
            'ok': True,
            'message': 'Destinatarios eliminados',
            'total': len(campana.destinatarios_json),
        })

    elif action == 'replace':
        # Full replace
        campana.destinatarios_json = body.get('destinatarios', [])
        campana.save(update_fields=['destinatarios_json'])

        return JsonResponse({
            'ok': True,
            'message': 'Destinatarios actualizados',
            'total': len(campana.destinatarios_json),
        })

    return JsonResponse({'ok': False, 'error': f'Acción desconocida: {action}'}, status=400)

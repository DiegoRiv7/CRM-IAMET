# ----------------------------------------------------------------------
# views_marketing.py — Endpoints CRUD para RecursoMarketing (Marketing Hub).
#
# La lectura (GET) está abierta a cualquier usuario autenticado: el módulo
# Marketing es público para vendedores. La escritura (POST/PATCH/DELETE)
# requiere `UserProfile.can_manage_marketing == True`.
#
# DELETE es soft-delete: marca `visible=False` para preservar historial.
# ----------------------------------------------------------------------

import json
import logging

from django.contrib.auth.decorators import login_required
from django.db.models import Max
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import RecursoMarketing

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────

def _user_can_manage_marketing(user) -> bool:
    """True si el usuario tiene UserProfile.can_manage_marketing=True.

    Defensivo: si el usuario no tiene UserProfile, regresa False.
    """
    profile = getattr(user, 'userprofile', None)
    return bool(getattr(profile, 'can_manage_marketing', False))


def _parse_tags(raw):
    """Acepta tags como:
       - lista ya parseada
       - JSON string (`'["a","b"]'`)
       - CSV (`'a, b, c'`)
       - None / cadena vacía → []
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    if not isinstance(raw, str):
        return []
    s = raw.strip()
    if not s:
        return []
    # Intentar JSON primero
    try:
        parsed = json.loads(s)
        if isinstance(parsed, list):
            return [str(t).strip() for t in parsed if str(t).strip()]
    except (ValueError, TypeError):
        pass
    # Fallback CSV
    return [p.strip() for p in s.split(',') if p.strip()]


def _recurso_to_dict(r: RecursoMarketing) -> dict:
    """Serialización canónica de un RecursoMarketing.

    `can_edit` se sirve a nivel de la respuesta, no por recurso, así que
    aquí no lo incluimos.
    """
    usr = r.subido_por
    if usr:
        subido_por_nombre = (usr.get_full_name() or usr.username or '').strip() or usr.username
    else:
        subido_por_nombre = '—'

    return {
        'id': r.id,
        'brand': r.brand,
        'tipo': r.tipo,
        'titulo': r.titulo,
        'descripcion': r.descripcion or '',
        'tags': list(r.tags or []),
        'url_efectiva': r.url_efectiva,
        'tamano_legible': r.tamano_legible,
        'fecha_iso': r.fecha_creacion.isoformat() if r.fecha_creacion else '',
        'fecha_legible': r.fecha_creacion.strftime('%d %b %Y') if r.fecha_creacion else '',
        'subido_por_nombre': subido_por_nombre,
        'visible': r.visible,
        'orden': r.orden,
    }


_BRAND_VALUES = {b for b, _ in RecursoMarketing.BRAND_CHOICES}
_TIPO_VALUES = {t for t, _ in RecursoMarketing.TIPO_CHOICES}


# ── Endpoints ────────────────────────────────────────────────────────────

@login_required
@require_http_methods(["GET", "POST"])
def api_marketing_recursos_list(request):
    """GET   → lista de recursos visibles (cualquier usuario autenticado).
    POST  → crear nuevo recurso (requiere can_manage_marketing).
    """
    can_edit = _user_can_manage_marketing(request.user)

    # ── GET: listar ──────────────────────────────────────────────────
    if request.method == 'GET':
        qs = (
            RecursoMarketing.objects
            .filter(visible=True)
            .select_related('subido_por')
            .order_by('orden', '-fecha_creacion')
        )
        recursos = [_recurso_to_dict(r) for r in qs]
        return JsonResponse({
            'ok': True,
            'recursos': recursos,
            'can_edit': can_edit,
        })

    # ── POST: crear ──────────────────────────────────────────────────
    if not can_edit:
        return JsonResponse(
            {'ok': False, 'error': 'No tienes permisos para gestionar Marketing'},
            status=403,
        )

    # Multipart: usar request.POST + request.FILES
    brand = (request.POST.get('brand') or '').strip()
    tipo = (request.POST.get('tipo') or '').strip()
    titulo = (request.POST.get('titulo') or '').strip()
    descripcion = (request.POST.get('descripcion') or '').strip()
    tags = _parse_tags(request.POST.get('tags'))
    url_externa = (request.POST.get('url') or '').strip()
    archivo = request.FILES.get('archivo')

    # Validaciones
    if brand not in _BRAND_VALUES:
        return JsonResponse(
            {'ok': False, 'error': f'brand inválido: {brand!r}'},
            status=400,
        )
    if tipo not in _TIPO_VALUES:
        return JsonResponse(
            {'ok': False, 'error': f'tipo inválido: {tipo!r}'},
            status=400,
        )
    if not titulo:
        return JsonResponse(
            {'ok': False, 'error': 'El título es obligatorio'},
            status=400,
        )
    if not archivo and not url_externa:
        return JsonResponse(
            {'ok': False, 'error': 'Debes proporcionar al menos un archivo o una URL'},
            status=400,
        )

    # Calcular siguiente orden
    next_orden = (RecursoMarketing.objects.aggregate(m=Max('orden'))['m'] or 0) + 1

    try:
        recurso = RecursoMarketing.objects.create(
            brand=brand,
            tipo=tipo,
            titulo=titulo,
            descripcion=descripcion,
            tags=tags,
            archivo=archivo if archivo else None,
            url=url_externa,
            tamano_bytes=(archivo.size if archivo else 0),
            subido_por=request.user,
            visible=True,
            orden=next_orden,
        )
    except Exception as e:
        logger.exception("Error creando RecursoMarketing")
        return JsonResponse(
            {'ok': False, 'error': f'Error al guardar el recurso: {e}'},
            status=500,
        )

    return JsonResponse({
        'ok': True,
        'recurso': _recurso_to_dict(recurso),
        'can_edit': can_edit,
    })


@login_required
@require_http_methods(["PATCH", "DELETE"])
def api_marketing_recurso_detalle(request, rid):
    """PATCH  → editar subset de campos (JSON body). No toca `archivo`.
    DELETE → soft-delete (visible=False).
    Ambos requieren can_manage_marketing.
    """
    if not _user_can_manage_marketing(request.user):
        return JsonResponse(
            {'ok': False, 'error': 'No tienes permisos para gestionar Marketing'},
            status=403,
        )

    try:
        recurso = RecursoMarketing.objects.select_related('subido_por').get(id=rid)
    except RecursoMarketing.DoesNotExist:
        return JsonResponse(
            {'ok': False, 'error': 'Recurso no encontrado'},
            status=404,
        )

    # ── DELETE: soft-delete ──────────────────────────────────────────
    if request.method == 'DELETE':
        recurso.visible = False
        recurso.save(update_fields=['visible', 'fecha_actualizacion'])
        return JsonResponse({'ok': True})

    # ── PATCH: edit parcial vía JSON ─────────────────────────────────
    try:
        data = json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        return JsonResponse(
            {'ok': False, 'error': 'JSON inválido'},
            status=400,
        )
    if not isinstance(data, dict):
        return JsonResponse(
            {'ok': False, 'error': 'El cuerpo debe ser un objeto JSON'},
            status=400,
        )

    update_fields = []

    if 'brand' in data:
        brand = (data.get('brand') or '').strip()
        if brand not in _BRAND_VALUES:
            return JsonResponse(
                {'ok': False, 'error': f'brand inválido: {brand!r}'},
                status=400,
            )
        recurso.brand = brand
        update_fields.append('brand')

    if 'tipo' in data:
        tipo = (data.get('tipo') or '').strip()
        if tipo not in _TIPO_VALUES:
            return JsonResponse(
                {'ok': False, 'error': f'tipo inválido: {tipo!r}'},
                status=400,
            )
        recurso.tipo = tipo
        update_fields.append('tipo')

    if 'titulo' in data:
        titulo = (data.get('titulo') or '').strip()
        if not titulo:
            return JsonResponse(
                {'ok': False, 'error': 'El título no puede estar vacío'},
                status=400,
            )
        recurso.titulo = titulo
        update_fields.append('titulo')

    if 'descripcion' in data:
        recurso.descripcion = (data.get('descripcion') or '').strip()
        update_fields.append('descripcion')

    if 'tags' in data:
        recurso.tags = _parse_tags(data.get('tags'))
        update_fields.append('tags')

    if 'url' in data:
        recurso.url = (data.get('url') or '').strip()
        update_fields.append('url')

    if 'visible' in data:
        recurso.visible = bool(data.get('visible'))
        update_fields.append('visible')

    if 'orden' in data:
        try:
            recurso.orden = int(data.get('orden'))
        except (TypeError, ValueError):
            return JsonResponse(
                {'ok': False, 'error': 'orden debe ser entero'},
                status=400,
            )
        update_fields.append('orden')

    if not update_fields:
        return JsonResponse(
            {'ok': False, 'error': 'No se proporcionó ningún campo válido para actualizar'},
            status=400,
        )

    # `fecha_actualizacion` se actualiza solo con auto_now=True al hacer save()
    update_fields.append('fecha_actualizacion')

    try:
        recurso.save(update_fields=update_fields)
    except Exception as e:
        logger.exception("Error actualizando RecursoMarketing id=%s", rid)
        return JsonResponse(
            {'ok': False, 'error': f'Error al guardar el recurso: {e}'},
            status=500,
        )

    return JsonResponse({
        'ok': True,
        'recurso': _recurso_to_dict(recurso),
        'can_edit': True,
    })

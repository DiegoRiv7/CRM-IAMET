# ----------------------------------------------------------------------
# views_marketing.py — Endpoints CRUD para RecursoMarketing (Marketing Hub).
#
# La lectura (GET) está abierta a cualquier usuario autenticado: el módulo
# Marketing es público para vendedores. La escritura (POST/PATCH/DELETE)
# requiere `UserProfile.can_manage_marketing == True`.
#
# DELETE es soft-delete: marca `visible=False` para preservar historial.
# ----------------------------------------------------------------------

from .empresa import modulo_activo
import json
import logging

from django.contrib.auth.decorators import login_required
from django.db.models import Max
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import MarcaMarketing, RecursoMarketing

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

@modulo_activo('marketing_hub')
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


@modulo_activo('marketing_hub')
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


# ── Marcas del Marketing Hub ─────────────────────────────────────────────
#
# Las marcas son catálogo editable: nombre, logo y visibilidad. El slug es
# inmutable (lo usa RecursoMarketing.brand como identificador estable).
# Lectura abierta a cualquier usuario autenticado; escritura requiere
# `can_manage_marketing`. DELETE / "eliminar" es soft-delete (visible=False),
# reversible vía PATCH visible=true para no romper recursos asociados.

# Tipos MIME aceptados para el logo. Incluye PNG/JPEG (raster típicos),
# WEBP (moderno, mejor compresión) y SVG (vector, ideal para logos).
_LOGO_MIME_VALIDOS = {
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/svg+xml',
    'image/webp',
}
_LOGO_MAX_BYTES = 5 * 1024 * 1024  # 5 MB


def _can_manage_marketing(user) -> bool:
    """Alias semántico: misma lógica que `_user_can_manage_marketing`.

    Existe para que las firmas de las vistas de marcas sean legibles.
    """
    profile = getattr(user, 'userprofile', None)
    return bool(getattr(profile, 'can_manage_marketing', False))


def _marca_to_dict(m: MarcaMarketing) -> dict:
    return {
        'id': m.id,
        'slug': m.slug,
        'nombre': m.nombre,
        'logo_url': m.logo.url if m.logo else '',
        'visible': m.visible,
        'orden': m.orden,
    }


@modulo_activo('marketing_hub')
@login_required
@require_http_methods(['GET', 'POST'])
def api_marketing_marcas_list(request):
    """GET  → lista las marcas visibles del Marketing Hub.
    POST → crea una marca nueva (requiere can_manage_marketing).

    Lectura abierta a cualquier usuario autenticado. `can_edit` indica si
    el caller puede mutar (sirve para que el front decida si pinta o no
    los botones de editar).
    """
    if request.method == 'POST':
        if not _can_manage_marketing(request.user):
            return JsonResponse(
                {'ok': False, 'error': 'No tienes permisos para gestionar Marketing'},
                status=403,
            )
        try:
            data = json.loads(request.body or b'{}')
        except json.JSONDecodeError:
            return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            return JsonResponse({'ok': False, 'error': 'El nombre es requerido'}, status=400)
        # Slug: el caller puede mandarlo o se deriva del nombre.
        # Lo normalizamos (lower, sin espacios) y truncamos a 20 chars
        # (límite del modelo). Si choca con otro slug, le agregamos un sufijo.
        from django.utils.text import slugify as _slugify
        slug_raw = (data.get('slug') or '').strip() or _slugify(nombre)
        slug = (slug_raw or 'marca').replace('-', '')[:20]
        if not slug:
            return JsonResponse({'ok': False, 'error': 'Slug inválido'}, status=400)
        base_slug = slug
        suffix = 2
        while MarcaMarketing.objects.filter(slug=slug).exists():
            tail = str(suffix)
            slug = (base_slug[:20 - len(tail)] + tail)
            suffix += 1
            if suffix > 999:
                return JsonResponse({'ok': False, 'error': 'No se pudo generar un slug único'}, status=500)
        # Orden por defecto: al final.
        max_orden = MarcaMarketing.objects.aggregate(m=Max('orden')).get('m') or 0
        marca = MarcaMarketing.objects.create(
            slug=slug,
            nombre=nombre,
            visible=True,
            orden=max_orden + 1,
        )
        return JsonResponse({'ok': True, 'marca': _marca_to_dict(marca)}, status=201)

    qs = MarcaMarketing.objects.filter(visible=True).order_by('orden', 'nombre')
    return JsonResponse({
        'ok': True,
        'can_edit': _can_manage_marketing(request.user),
        'marcas': [_marca_to_dict(m) for m in qs],
    })


@modulo_activo('marketing_hub')
@login_required
@require_http_methods(['PATCH', 'DELETE'])
def api_marketing_marca_detalle(request, mid):
    """PATCH  → editar nombre / orden / visible (JSON body).
    DELETE → soft-delete (visible=False), alias del endpoint /eliminar/.
    Ambos requieren `can_manage_marketing`.
    """
    if not _can_manage_marketing(request.user):
        return JsonResponse(
            {'ok': False, 'error': 'No tienes permisos para gestionar Marketing'},
            status=403,
        )

    try:
        marca = MarcaMarketing.objects.get(id=mid)
    except MarcaMarketing.DoesNotExist:
        return JsonResponse(
            {'ok': False, 'error': 'Marca no encontrada'},
            status=404,
        )

    # ── DELETE: soft-delete ──────────────────────────────────────────
    if request.method == 'DELETE':
        marca.visible = False
        marca.save(update_fields=['visible', 'fecha_actualizacion'])
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

    if 'nombre' in data:
        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            return JsonResponse(
                {'ok': False, 'error': 'El nombre no puede estar vacío'},
                status=400,
            )
        marca.nombre = nombre
        update_fields.append('nombre')

    if 'orden' in data:
        try:
            marca.orden = int(data.get('orden'))
        except (TypeError, ValueError):
            return JsonResponse(
                {'ok': False, 'error': 'orden debe ser entero'},
                status=400,
            )
        update_fields.append('orden')

    if 'visible' in data:
        marca.visible = bool(data.get('visible'))
        update_fields.append('visible')

    if not update_fields:
        return JsonResponse(
            {'ok': False, 'error': 'No se proporcionó ningún campo válido para actualizar'},
            status=400,
        )

    update_fields.append('fecha_actualizacion')

    try:
        marca.save(update_fields=update_fields)
    except Exception as e:
        logger.exception("Error actualizando MarcaMarketing id=%s", mid)
        return JsonResponse(
            {'ok': False, 'error': f'Error al guardar la marca: {e}'},
            status=500,
        )

    return JsonResponse({
        'ok': True,
        'marca': _marca_to_dict(marca),
    })


@modulo_activo('marketing_hub')
@login_required
@require_http_methods(['DELETE', 'POST'])
def api_marketing_marca_eliminar(request, mid):
    """Soft-delete explícito (visible=False). Acepta POST como fallback
    para clientes que no pueden enviar DELETE. Reversible vía PATCH
    {visible: true}."""
    if not _can_manage_marketing(request.user):
        return JsonResponse(
            {'ok': False, 'error': 'No tienes permisos para gestionar Marketing'},
            status=403,
        )

    try:
        marca = MarcaMarketing.objects.get(id=mid)
    except MarcaMarketing.DoesNotExist:
        return JsonResponse(
            {'ok': False, 'error': 'Marca no encontrada'},
            status=404,
        )

    marca.visible = False
    marca.save(update_fields=['visible', 'fecha_actualizacion'])
    return JsonResponse({'ok': True})


@modulo_activo('marketing_hub')
@login_required
@require_http_methods(['POST'])
def api_marketing_marca_logo(request, mid):
    """Subir logo (multipart, key='logo').

    Validaciones:
      - MIME ∈ {png, jpeg, svg+xml, webp}
      - Tamaño ≤ 5 MB

    Si la marca ya tenía logo, lo elimina del storage antes de asignar
    el nuevo (evita acumular archivos huérfanos).
    """
    if not _can_manage_marketing(request.user):
        return JsonResponse(
            {'ok': False, 'error': 'No tienes permisos para gestionar Marketing'},
            status=403,
        )

    try:
        marca = MarcaMarketing.objects.get(id=mid)
    except MarcaMarketing.DoesNotExist:
        return JsonResponse(
            {'ok': False, 'error': 'Marca no encontrada'},
            status=404,
        )

    logo = request.FILES.get('logo')
    if not logo:
        return JsonResponse(
            {'ok': False, 'error': "Debes enviar el archivo en el campo 'logo'"},
            status=400,
        )

    mime = (getattr(logo, 'content_type', '') or '').lower()
    if mime not in _LOGO_MIME_VALIDOS:
        return JsonResponse(
            {'ok': False,
             'error': f'Tipo de archivo no permitido: {mime!r}. '
                      f'Usa PNG, JPEG, SVG o WEBP.'},
            status=400,
        )

    if logo.size > _LOGO_MAX_BYTES:
        return JsonResponse(
            {'ok': False,
             'error': f'El logo supera 5 MB ({logo.size} bytes).'},
            status=400,
        )

    # Borrar el logo anterior del storage para no dejar archivos huérfanos.
    # `save=False` evita un save intermedio antes de asignar el nuevo.
    if marca.logo:
        try:
            marca.logo.delete(save=False)
        except Exception:
            logger.exception(
                "No se pudo borrar el logo anterior de la marca id=%s", mid
            )

    marca.logo = logo
    try:
        marca.save(update_fields=['logo', 'fecha_actualizacion'])
    except Exception as e:
        logger.exception("Error guardando logo de MarcaMarketing id=%s", mid)
        return JsonResponse(
            {'ok': False, 'error': f'Error al guardar el logo: {e}'},
            status=500,
        )

    return JsonResponse({
        'ok': True,
        'marca': _marca_to_dict(marca),
    })

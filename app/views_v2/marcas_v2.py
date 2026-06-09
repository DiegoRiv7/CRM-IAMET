"""
marcas_v2.py — Vistas de la sección "Marcas" del dashboard + CRUD del
catálogo persistido en DB (modelo MarcaCRM).

Hasta junio 2026 el catálogo era una constante hardcoded; ahora vive en
`MarcaCRM` con metadata rica (logo, descripción, 3 contactos, meta anual,
estrategia). El comportamiento del dashboard es idéntico (mismas KPIs,
mismos endpoints de lectura), pero supervisores pueden crear/editar
marcas vía endpoints CRUD.

Endpoints:
    GET  /app/api/marcas/resumen/                    — todas + totales
    GET  /app/api/marcas/<key>/                      — detalle + ops
    GET  /app/api/marcas/<key>/edit/                 — payload editor
    POST /app/api/marcas/crear/                      — alta (supervisor)
    POST /app/api/marcas/<key>/actualizar/           — edit (supervisor)
    POST /app/api/marcas/<key>/eliminar/             — soft-del (super)

Filtros (en resumen/detalle):
    anio       — YYYY (default año actual)
    vendedores — CSV de user IDs (solo aplica si supervisor)
"""
import json
import logging
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.contrib.auth.decorators import login_required
from django.db.models import Count, Q, Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from app.models import Campana, Cotizacion, MarcaCRM, TodoItem
from app.views_utils import is_supervisor
from app.views_grupos import get_usuarios_visibles_ids

logger = logging.getLogger(__name__)


# Constantes de validación de logo (alineadas con views_marketing.py).
_LOGO_MIME_VALIDOS = {
    'image/png', 'image/jpeg', 'image/jpg',
    'image/svg+xml', 'image/webp',
}
_LOGO_MAX_BYTES = 5 * 1024 * 1024  # 5 MB


# ─────────────────────────────────────────────────────────────────────
# CATÁLOGO desde DB (con cache por-request)
# ─────────────────────────────────────────────────────────────────────

def _get_marcas_catalogo():
    """Devuelve la lista de marcas activas como list[dict] con las claves
    {key, label, match, cat}. `match` siempre incluye la `key` además de
    aliases conocidos (PÓLIZA con tilde, AVIGILION, Desarrollo) para
    cubrir los valores históricos del CharField producto.

    No usa cache de proceso para que cambios en /admin o vía endpoint
    se vean en la siguiente request. Las vistas que llaman 2+ veces en
    una misma request deberían cachear el resultado en local.
    """
    aliases_extra = {
        'POLIZA':   ['PÓLIZA', 'POLIZA'],
        'AVIGILON': ['AVIGILON', 'AVIGILION'],
        'SOFTWARE': ['SOFTWARE', 'Desarrollo'],
    }
    out = []
    for m in MarcaCRM.objects.filter(activa=True).order_by('nombre'):
        match = list({(m.key or '').upper(), *aliases_extra.get(m.key, [])})
        out.append({
            'key': m.key,
            'label': m.nombre,
            'match': match,
            'cat': m.categoria or '',
            '_obj': m,
        })
    return out


def _build_key_index(catalogo):
    """{producto_raw.upper() : key_canónica} desde el catálogo."""
    idx = {}
    for m in catalogo:
        for v in m['match']:
            idx[v.upper()] = m['key']
    return idx


def _normalizar_marca_with_idx(producto_raw, idx):
    if not producto_raw:
        return None
    return idx.get(str(producto_raw).upper())


# ─────────────────────────────────────────────────────────────────────
# HELPERS de filtros (compartidos resumen/detalle)
# ─────────────────────────────────────────────────────────────────────

def _filtros_visibilidad(user):
    if is_supervisor(user):
        return Q()
    visibles = get_usuarios_visibles_ids(user)
    if visibles is None:
        return Q()
    return Q(usuario_id__in=visibles)


def _aplicar_vendedores(qs, request, es_super):
    if not es_super:
        return qs
    vf = (request.GET.get('vendedores') or '').strip()
    if not vf or vf.lower() == 'todos':
        return qs
    ids = [int(x) for x in vf.split(',') if x.strip().isdigit()]
    if ids:
        qs = qs.filter(usuario_id__in=ids)
    return qs


def _parse_anio(request):
    val = (request.GET.get('anio') or '').strip()
    if val and val.lower() != 'todos':
        try:
            return int(val)
        except (ValueError, TypeError):
            pass
    return timezone.localdate().year


def _logo_url(marca, request):
    """URL absoluta del logo si existe; '' si no."""
    if not marca.logo:
        return ''
    try:
        url = marca.logo.url
    except Exception:
        return ''
    # Build absolute URL solo si tenemos request (para JSON)
    if request is not None:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            pass
    return url


def _contactos_dict(marca):
    """Empaqueta los 9 CharFields de contacto en un dict con 3 grupos."""
    return {
        'marca': {
            'nombre':   marca.contacto_marca_nombre or '',
            'email':    marca.contacto_marca_email or '',
            'telefono': marca.contacto_marca_telefono or '',
        },
        'ingenieria': {
            'nombre':   marca.contacto_ingenieria_nombre or '',
            'email':    marca.contacto_ingenieria_email or '',
            'telefono': marca.contacto_ingenieria_telefono or '',
        },
        'mayorista': {
            'nombre':   marca.contacto_mayorista_nombre or '',
            'email':    marca.contacto_mayorista_email or '',
            'telefono': marca.contacto_mayorista_telefono or '',
        },
    }


def _marca_full_dict(marca, request=None):
    """Payload completo de una marca (para editor + detalle widget)."""
    return {
        'id': marca.id,
        'key': marca.key,
        'nombre': marca.nombre,
        'categoria': marca.categoria or '',
        'descripcion': marca.descripcion or '',
        'logo_url': _logo_url(marca, request),
        'contactos': _contactos_dict(marca),
        'meta_anual': float(marca.meta_anual or 0),
        'estrategia': marca.estrategia or '',
        'activa': bool(marca.activa),
    }


# ─────────────────────────────────────────────────────────────────────
# READ — Resumen y detalle (públicos a cualquier login)
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_http_methods(["GET"])
def api_marcas_resumen(request):
    """
    Resumen de TODAS las marcas + totales globales.

    Respuesta:
        {
            ok: true,
            anio: 2026,
            marcas: [
                {
                    key, label, cat, descripcion, logo_url,
                    contactos: {marca, ingenieria, mayorista},
                    meta_anual, estrategia,
                    facturado, pipeline, ops_count,
                    cotizaciones, campanias,
                    meta, avance, gap,
                }, ...
            ],
            totals: { facturado, pipeline, cotizaciones, campanias, meta, gap }
        }
    """
    try:
        user = request.user
        anio = _parse_anio(request)
        es_super = is_supervisor(user)
        catalogo = _get_marcas_catalogo()
        key_idx = _build_key_index(catalogo)

        opp_qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
            anio_cierre=anio,
        )
        opp_qs = _aplicar_vendedores(opp_qs, request, es_super)

        agg = (
            opp_qs.values('producto')
            .annotate(
                fact_sum=Sum('monto_facturacion'),
                pipe_sum=Sum('monto'),
                ops_count=Count('id'),
            )
        )
        por_marca = defaultdict(lambda: {
            'facturado': Decimal('0'),
            'pipeline': Decimal('0'),
            'ops_count': 0,
        })
        for r in agg:
            key = _normalizar_marca_with_idx(r['producto'], key_idx)
            if not key:
                continue
            por_marca[key]['facturado'] += (r['fact_sum'] or Decimal('0'))
            por_marca[key]['pipeline']  += (r['pipe_sum'] or Decimal('0'))
            por_marca[key]['ops_count'] += int(r['ops_count'] or 0)

        # Cotizaciones por marca
        cot_counts = defaultdict(int)
        cot_qs = (
            Cotizacion.objects
            .select_related('oportunidad')
            .filter(oportunidad__in=opp_qs)
        )
        for c in cot_qs.values('oportunidad__producto').annotate(n=Count('id')):
            key = _normalizar_marca_with_idx(c['oportunidad__producto'], key_idx)
            if key:
                cot_counts[key] += int(c['n'] or 0)

        # Campañas por marca
        cam_counts = defaultdict(int)
        try:
            cam_qs = Campana.objects.filter(
                estado__in=['programada', 'enviando', 'enviada']
            )
            if hasattr(Campana, 'creado_por'):
                if not es_super:
                    cam_qs = cam_qs.filter(creado_por=user)
            for c in cam_qs.values('producto').annotate(n=Count('id')):
                key = _normalizar_marca_with_idx(c['producto'], key_idx)
                if key:
                    cam_counts[key] += int(c['n'] or 0)
        except Exception:
            logger.exception('marcas: error contando campañas')

        marcas_out = []
        for m in catalogo:
            d = por_marca.get(m['key'], {})
            facturado = float(d.get('facturado') or 0)
            pipeline  = float(d.get('pipeline') or 0)
            ops_count = int(d.get('ops_count') or 0)
            cotizaciones = int(cot_counts.get(m['key'], 0))
            campanias    = int(cam_counts.get(m['key'], 0))
            obj = m['_obj']
            meta = float(obj.meta_anual or 0)
            avance = (facturado / meta) if meta else 0
            gap = facturado - meta
            marcas_out.append({
                'key': m['key'],
                'label': m['label'],
                'cat': m['cat'],
                'descripcion': obj.descripcion or '',
                'logo_url': _logo_url(obj, request),
                'contactos': _contactos_dict(obj),
                'meta_anual': meta,
                'estrategia': obj.estrategia or '',
                'facturado': facturado,
                'pipeline': pipeline,
                'ops_count': ops_count,
                'cotizaciones': cotizaciones,
                'campanias': campanias,
                'meta': meta,
                'avance': avance,
                'gap': gap,
            })

        totals = {
            'facturado': sum(x['facturado'] for x in marcas_out),
            'pipeline': sum(x['pipeline'] for x in marcas_out),
            'cotizaciones': sum(x['cotizaciones'] for x in marcas_out),
            'campanias': sum(x['campanias'] for x in marcas_out),
            'meta': sum(x['meta'] for x in marcas_out),
        }
        totals['gap'] = totals['facturado'] - totals['meta']

        return JsonResponse({
            'ok': True,
            'anio': anio,
            'marcas': marcas_out,
            'totals': totals,
            'can_manage': es_super,
        })
    except Exception as e:
        logger.exception('api_marcas_resumen failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def api_marca_detalle(request, marca_key):
    """Detalle: KPIs + oportunidades + metadata rica de la marca."""
    try:
        user = request.user
        anio = _parse_anio(request)
        es_super = is_supervisor(user)
        key_up = (marca_key or '').upper()

        catalogo = _get_marcas_catalogo()
        marca = next((m for m in catalogo if m['key'] == key_up), None)
        if not marca:
            return JsonResponse({'ok': False, 'error': 'Marca no encontrada'}, status=404)
        obj = marca['_obj']

        opp_qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
            anio_cierre=anio,
            producto__in=marca['match'],
        ).select_related('cliente')
        opp_qs = _aplicar_vendedores(opp_qs, request, es_super)

        ops = []
        facturado = Decimal('0')
        pipeline  = Decimal('0')
        for o in opp_qs:
            mes = int(o.mes_cierre) if o.mes_cierre else 0
            monto = float(o.monto or 0)
            prob = int(o.probabilidad_cierre or 0)
            ops.append({
                'id': o.id,
                'cliente': (o.cliente.nombre_empresa if o.cliente_id else ''),
                'oportunidad': o.oportunidad or '',
                'monto': monto,
                'mes': mes,
                'prob': prob,
                'etapa': o.etapa_corta or '',
                'po': (o.po_number or '').strip(),
            })
            facturado += (o.monto_facturacion or Decimal('0'))
            pipeline += (o.monto or Decimal('0'))

        cot_count = (
            Cotizacion.objects
            .filter(oportunidad__in=opp_qs)
            .count()
        )
        cam_count = 0
        try:
            cam_qs = Campana.objects.filter(
                estado__in=['programada', 'enviando', 'enviada'],
                producto__in=marca['match'],
            )
            if not es_super and hasattr(Campana, 'creado_por'):
                cam_qs = cam_qs.filter(creado_por=user)
            cam_count = cam_qs.count()
        except Exception:
            logger.exception('marca_detalle: error contando campañas')

        meta = float(obj.meta_anual or 0)
        avance = (float(facturado) / meta) if meta else 0
        gap = float(facturado) - meta

        return JsonResponse({
            'ok': True,
            'anio': anio,
            'marca': {
                'key': marca['key'],
                'label': marca['label'],
                'cat': marca['cat'],
                'descripcion': obj.descripcion or '',
                'logo_url': _logo_url(obj, request),
                'contactos': _contactos_dict(obj),
                'meta_anual': meta,
                'estrategia': obj.estrategia or '',
                'facturado': float(facturado),
                'pipeline': float(pipeline),
                'ops_count': len(ops),
                'cotizaciones': cot_count,
                'campanias': cam_count,
                'meta': meta,
                'avance': avance,
                'gap': gap,
            },
            'ops': sorted(ops, key=lambda x: -x['monto']),
            'can_manage': es_super,
        })
    except Exception as e:
        logger.exception('api_marca_detalle failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ─────────────────────────────────────────────────────────────────────
# CRUD — Solo supervisores
# ─────────────────────────────────────────────────────────────────────

def _require_supervisor(request):
    """Devuelve None si OK, o JsonResponse 403 si no es supervisor."""
    if not is_supervisor(request.user):
        return JsonResponse(
            {'ok': False, 'error': 'Solo supervisores pueden gestionar marcas.'},
            status=403,
        )
    return None


_KEY_RE = re.compile(r'^[A-Z0-9_-]{1,40}$')


def _normalizar_key(raw):
    """Slug canónico para `key`: uppercase, sin tildes, alfanumérico+_-."""
    if raw is None:
        return ''
    s = str(raw).strip().upper()
    # Reemplazar tildes / caracteres comunes
    repl = {
        'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
        'Ñ': 'N', 'Ü': 'U',
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    # Espacios → underscore
    s = re.sub(r'\s+', '_', s)
    # Filtrar chars
    s = re.sub(r'[^A-Z0-9_-]', '', s)
    return s[:40]


def _read_body(request):
    """Lee body como JSON o como POST/multipart. Devuelve dict."""
    ctype = (request.META.get('CONTENT_TYPE') or '').lower()
    if 'application/json' in ctype:
        try:
            return json.loads(request.body or b'{}') or {}
        except (ValueError, json.JSONDecodeError):
            return {}
    # multipart o form-urlencoded
    return {k: request.POST.get(k) for k in request.POST.keys()}


def _aplicar_campos(marca, data, is_create=False):
    """Aplica campos editables al objeto (sin save). Devuelve lista de
    campos modificados para `update_fields`."""
    fields = []

    # nombre — obligatorio en create
    if 'nombre' in data:
        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            raise ValueError('El nombre no puede estar vacío.')
        marca.nombre = nombre[:80]
        fields.append('nombre')

    if 'categoria' in data:
        marca.categoria = (data.get('categoria') or '').strip()[:100]
        fields.append('categoria')

    if 'descripcion' in data:
        marca.descripcion = (data.get('descripcion') or '').strip()
        fields.append('descripcion')

    if 'estrategia' in data:
        marca.estrategia = (data.get('estrategia') or '').strip()
        fields.append('estrategia')

    if 'meta_anual' in data:
        raw = data.get('meta_anual')
        if raw in (None, '', 'null'):
            marca.meta_anual = Decimal('0')
        else:
            try:
                # Quitar comas / símbolos de moneda
                cleaned = re.sub(r'[^0-9.\-]', '', str(raw))
                marca.meta_anual = Decimal(cleaned) if cleaned else Decimal('0')
            except (InvalidOperation, TypeError):
                raise ValueError('meta_anual inválido.')
        fields.append('meta_anual')

    if 'activa' in data:
        v = data.get('activa')
        marca.activa = (v in (True, 'true', 'True', '1', 1, 'on'))
        fields.append('activa')

    # Contactos — pueden venir como objetos anidados (JSON) o como flat
    # (multipart con keys "contacto_marca_nombre" etc.). Soportamos ambos.
    contactos = data.get('contactos')
    if isinstance(contactos, dict):
        flatmap = {
            'marca': ('contacto_marca_nombre', 'contacto_marca_email', 'contacto_marca_telefono'),
            'ingenieria': ('contacto_ingenieria_nombre', 'contacto_ingenieria_email', 'contacto_ingenieria_telefono'),
            'mayorista': ('contacto_mayorista_nombre', 'contacto_mayorista_email', 'contacto_mayorista_telefono'),
        }
        for grupo, (fn, fe, ft) in flatmap.items():
            g = contactos.get(grupo) or {}
            if not isinstance(g, dict):
                continue
            if 'nombre' in g:
                setattr(marca, fn, (g.get('nombre') or '').strip()[:120]); fields.append(fn)
            if 'email' in g:
                setattr(marca, fe, (g.get('email') or '').strip()[:120]); fields.append(fe)
            if 'telefono' in g:
                setattr(marca, ft, (g.get('telefono') or '').strip()[:40]); fields.append(ft)

    # Flat overrides (siempre tienen precedencia, útiles para multipart)
    for f in (
        'contacto_marca_nombre', 'contacto_marca_email', 'contacto_marca_telefono',
        'contacto_ingenieria_nombre', 'contacto_ingenieria_email', 'contacto_ingenieria_telefono',
        'contacto_mayorista_nombre', 'contacto_mayorista_email', 'contacto_mayorista_telefono',
    ):
        if f in data:
            maxlen = 40 if f.endswith('_telefono') else 120
            setattr(marca, f, (data.get(f) or '').strip()[:maxlen])
            fields.append(f)

    return list(dict.fromkeys(fields))  # de-dup preservando orden


def _aplicar_logo(marca, request, fields):
    """Si vino archivo 'logo' (multipart), valida y asigna."""
    logo = request.FILES.get('logo') if hasattr(request, 'FILES') else None
    if not logo:
        return fields
    mime = (getattr(logo, 'content_type', '') or '').lower()
    if mime not in _LOGO_MIME_VALIDOS:
        raise ValueError(
            f'Tipo de archivo no permitido: {mime!r}. Usa PNG, JPEG, SVG o WEBP.'
        )
    if logo.size > _LOGO_MAX_BYTES:
        raise ValueError(f'El logo supera 5 MB ({logo.size} bytes).')
    # Borrar logo previo (evita archivos huérfanos)
    if marca.logo:
        try:
            marca.logo.delete(save=False)
        except Exception:
            logger.exception('No se pudo borrar logo previo de marca id=%s', marca.id)
    marca.logo = logo
    fields.append('logo')
    return fields


@login_required
@require_http_methods(["POST"])
def api_marca_crear(request):
    """Alta de marca. Body JSON o multipart (con campo `logo`)."""
    err = _require_supervisor(request)
    if err:
        return err
    try:
        data = _read_body(request)

        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            return JsonResponse({'ok': False, 'error': 'El nombre es requerido.'}, status=400)

        raw_key = data.get('key') or nombre
        key = _normalizar_key(raw_key)
        if not key or not _KEY_RE.match(key):
            return JsonResponse(
                {'ok': False, 'error': 'Key inválida (usa A-Z, 0-9, _, -).'},
                status=400,
            )

        # Unicidad: key y nombre
        if MarcaCRM.objects.filter(key=key).exists():
            return JsonResponse(
                {'ok': False, 'error': f'Ya existe una marca con key "{key}".'},
                status=409,
            )
        if MarcaCRM.objects.filter(nombre=nombre).exists():
            return JsonResponse(
                {'ok': False, 'error': f'Ya existe una marca con nombre "{nombre}".'},
                status=409,
            )

        marca = MarcaCRM(key=key, nombre=nombre, activa=True)
        try:
            _aplicar_campos(marca, data, is_create=True)
            _aplicar_logo(marca, request, [])
        except ValueError as ve:
            return JsonResponse({'ok': False, 'error': str(ve)}, status=400)

        marca.save()
        return JsonResponse(
            {'ok': True, 'marca': _marca_full_dict(marca, request)},
            status=201,
        )
    except Exception as e:
        logger.exception('api_marca_crear failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def api_marca_edit(request, marca_key):
    """Devuelve TODA la metadata de la marca para alimentar el editor."""
    try:
        key_up = (marca_key or '').upper()
        try:
            marca = MarcaCRM.objects.get(key=key_up)
        except MarcaCRM.DoesNotExist:
            return JsonResponse({'ok': False, 'error': 'Marca no encontrada'}, status=404)
        return JsonResponse({
            'ok': True,
            'marca': _marca_full_dict(marca, request),
            'can_manage': is_supervisor(request.user),
        })
    except Exception as e:
        logger.exception('api_marca_edit failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_marca_actualizar(request, marca_key):
    """Update parcial. Multipart si trae logo, JSON si no."""
    err = _require_supervisor(request)
    if err:
        return err
    try:
        key_up = (marca_key or '').upper()
        try:
            marca = MarcaCRM.objects.get(key=key_up)
        except MarcaCRM.DoesNotExist:
            return JsonResponse({'ok': False, 'error': 'Marca no encontrada'}, status=404)

        data = _read_body(request)

        # Si quieren cambiar el nombre, validar unicidad
        new_nombre = (data.get('nombre') or '').strip() if 'nombre' in data else None
        if new_nombre and new_nombre != marca.nombre:
            if MarcaCRM.objects.filter(nombre=new_nombre).exclude(id=marca.id).exists():
                return JsonResponse(
                    {'ok': False, 'error': f'Ya existe otra marca con nombre "{new_nombre}".'},
                    status=409,
                )

        try:
            fields = _aplicar_campos(marca, data, is_create=False)
            fields = _aplicar_logo(marca, request, fields)
        except ValueError as ve:
            return JsonResponse({'ok': False, 'error': str(ve)}, status=400)

        if not fields:
            return JsonResponse(
                {'ok': False, 'error': 'No se proporcionó ningún campo válido.'},
                status=400,
            )
        fields.append('updated_at')
        try:
            marca.save(update_fields=fields)
        except Exception as e:
            logger.exception('api_marca_actualizar save failed (key=%s)', marca_key)
            return JsonResponse({'ok': False, 'error': f'Error al guardar: {e}'}, status=500)

        return JsonResponse({'ok': True, 'marca': _marca_full_dict(marca, request)})
    except Exception as e:
        logger.exception('api_marca_actualizar failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_marca_eliminar(request, marca_key):
    """Soft-delete: marca activa=False. Reversible vía actualizar."""
    err = _require_supervisor(request)
    if err:
        return err
    try:
        key_up = (marca_key or '').upper()
        try:
            marca = MarcaCRM.objects.get(key=key_up)
        except MarcaCRM.DoesNotExist:
            return JsonResponse({'ok': False, 'error': 'Marca no encontrada'}, status=404)
        marca.activa = False
        marca.save(update_fields=['activa', 'updated_at'])
        return JsonResponse({'ok': True})
    except Exception as e:
        logger.exception('api_marca_eliminar failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

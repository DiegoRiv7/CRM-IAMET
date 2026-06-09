"""
proveedores_v2.py — Vistas de la sección "Proveedores" del dashboard +
CRUD del catálogo persistido en DB (modelo ProveedorCRM).

Espejo estructural de marcas_v2.py. Difiere en:
  * Contactos renombrados: principal / ventas / soporte (en vez de
    marca / ingenieria / mayorista).
  * El campo TodoItem.proveedor AÚN no existe en el modelo — los
    endpoints que dependen de él retornan payloads vacíos (facturado=0,
    pipeline=0, ops=[]). Cuando se agregue el campo, automáticamente se
    poblará. La query se hace dentro de try/except para no romper
    mientras no exista.

Endpoints:
    GET  /app/api/proveedores/resumen/                  — todos + totales
    GET  /app/api/proveedores/<key>/                    — detalle + ops
    GET  /app/api/proveedores/<key>/edit/               — payload editor
    POST /app/api/proveedores/crear/                    — alta (supervisor)
    POST /app/api/proveedores/<key>/actualizar/         — edit (supervisor)
    POST /app/api/proveedores/<key>/eliminar/           — soft-del (super)

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
from django.core.exceptions import FieldError
from django.db.models import Count, Q, Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from app.models import ProveedorCRM, TodoItem
from app.views_utils import is_supervisor
from app.views_grupos import get_usuarios_visibles_ids

logger = logging.getLogger(__name__)


# Constantes de validación de logo (alineadas con marcas_v2.py).
_LOGO_MIME_VALIDOS = {
    'image/png', 'image/jpeg', 'image/jpg',
    'image/svg+xml', 'image/webp',
}
_LOGO_MAX_BYTES = 5 * 1024 * 1024  # 5 MB


# ─────────────────────────────────────────────────────────────────────
# CATÁLOGO desde DB (con cache por-request)
# ─────────────────────────────────────────────────────────────────────

def _get_proveedores_catalogo():
    """Devuelve la lista de proveedores activos como list[dict] con las
    claves {key, label, match, cat}. `match` incluye la `key` y se
    extiende con aliases extra a futuro (vacío por ahora — proveedores
    no tiene historial de tildes/typos como sí tenía Marcas).

    No usa cache de proceso para que cambios en /admin o vía endpoint
    se vean en la siguiente request.
    """
    aliases_extra = {}  # vacío: proveedores no tiene historial heredado
    out = []
    for p in ProveedorCRM.objects.filter(activa=True).order_by('nombre'):
        match = list({(p.key or '').upper(), *aliases_extra.get(p.key, [])})
        out.append({
            'key': p.key,
            'label': p.nombre,
            'match': match,
            'cat': p.categoria or '',
            '_obj': p,
        })
    return out


def _build_key_index(catalogo):
    """{proveedor_raw.upper() : key_canónica} desde el catálogo."""
    idx = {}
    for p in catalogo:
        for v in p['match']:
            idx[v.upper()] = p['key']
    return idx


def _normalizar_proveedor_with_idx(proveedor_raw, idx):
    if not proveedor_raw:
        return None
    return idx.get(str(proveedor_raw).upper())


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


def _logo_url(proveedor, request):
    """URL absoluta del logo si existe; '' si no."""
    if not proveedor.logo:
        return ''
    try:
        url = proveedor.logo.url
    except Exception:
        return ''
    if request is not None:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            pass
    return url


def _contactos_dict(proveedor):
    """Empaqueta los 9 CharFields de contacto en un dict con 3 grupos."""
    return {
        'principal': {
            'nombre':   proveedor.contacto_principal_nombre or '',
            'email':    proveedor.contacto_principal_email or '',
            'telefono': proveedor.contacto_principal_telefono or '',
        },
        'ventas': {
            'nombre':   proveedor.contacto_ventas_nombre or '',
            'email':    proveedor.contacto_ventas_email or '',
            'telefono': proveedor.contacto_ventas_telefono or '',
        },
        'soporte': {
            'nombre':   proveedor.contacto_soporte_nombre or '',
            'email':    proveedor.contacto_soporte_email or '',
            'telefono': proveedor.contacto_soporte_telefono or '',
        },
    }


def _proveedor_full_dict(proveedor, request=None):
    """Payload completo de un proveedor (para editor + detalle widget)."""
    return {
        'id': proveedor.id,
        'key': proveedor.key,
        'nombre': proveedor.nombre,
        'categoria': proveedor.categoria or '',
        'descripcion': proveedor.descripcion or '',
        'logo_url': _logo_url(proveedor, request),
        'contactos': _contactos_dict(proveedor),
        'meta_anual': float(proveedor.meta_anual or 0),
        'estrategia': proveedor.estrategia or '',
        'activa': bool(proveedor.activa),
    }


def _has_proveedor_field():
    """¿Existe el campo `proveedor` en TodoItem? Si no, los queries que
    lo usan se cortocircuitan con queryset vacío para no romper."""
    try:
        TodoItem._meta.get_field('proveedor')
        return True
    except Exception:
        return False


def _safe_opp_qs(user, anio, request, es_super, proveedor=None):
    """Devuelve el queryset base de TodoItem filtrado por visibilidad,
    año y vendedores. Si `proveedor` está dado, también filtra por
    `proveedor__in=proveedor['match']`. Si el campo `proveedor` no
    existe en TodoItem, retorna queryset vacío.
    """
    qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
        anio_cierre=anio,
    )
    qs = _aplicar_vendedores(qs, request, es_super)
    if proveedor is not None:
        if not _has_proveedor_field():
            return TodoItem.objects.none()
        try:
            qs = qs.filter(proveedor__in=proveedor['match'])
        except (FieldError, AttributeError):
            return TodoItem.objects.none()
    return qs


# ─────────────────────────────────────────────────────────────────────
# READ — Resumen y detalle (públicos a cualquier login)
# ─────────────────────────────────────────────────────────────────────

@login_required
@require_http_methods(["GET"])
def api_proveedores_resumen(request):
    """
    Resumen de TODOS los proveedores + totales globales.

    Respuesta:
        {
            ok: true,
            anio: 2026,
            proveedores: [
                {
                    key, label, cat, descripcion, logo_url,
                    contactos: {principal, ventas, soporte},
                    meta_anual, estrategia,
                    facturado, pipeline, ops_count,
                    meta, avance, gap,
                }, ...
            ],
            totals: { facturado, pipeline, meta, gap }
        }

    Mientras `TodoItem.proveedor` no exista, facturado/pipeline/ops
    quedan en 0.
    """
    try:
        user = request.user
        anio = _parse_anio(request)
        es_super = is_supervisor(user)
        catalogo = _get_proveedores_catalogo()
        key_idx = _build_key_index(catalogo)

        # Agregaciones por proveedor (vacío si el campo no existe).
        por_prov = defaultdict(lambda: {
            'facturado': Decimal('0'),
            'pipeline': Decimal('0'),
            'ops_count': 0,
        })

        if _has_proveedor_field():
            try:
                opp_qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
                    anio_cierre=anio,
                )
                opp_qs = _aplicar_vendedores(opp_qs, request, es_super)
                agg = (
                    opp_qs.values('proveedor')
                    .annotate(
                        fact_sum=Sum('monto_facturacion'),
                        pipe_sum=Sum('monto'),
                        ops_count=Count('id'),
                    )
                )
                for r in agg:
                    key = _normalizar_proveedor_with_idx(r['proveedor'], key_idx)
                    if not key:
                        continue
                    por_prov[key]['facturado'] += (r['fact_sum'] or Decimal('0'))
                    por_prov[key]['pipeline']  += (r['pipe_sum'] or Decimal('0'))
                    por_prov[key]['ops_count'] += int(r['ops_count'] or 0)
            except (FieldError, AttributeError):
                logger.exception('proveedores: TodoItem.proveedor existe pero falla la query')

        proveedores_out = []
        for p in catalogo:
            d = por_prov.get(p['key'], {})
            facturado = float(d.get('facturado') or 0)
            pipeline  = float(d.get('pipeline') or 0)
            ops_count = int(d.get('ops_count') or 0)
            obj = p['_obj']
            meta = float(obj.meta_anual or 0)
            avance = (facturado / meta) if meta else 0
            gap = facturado - meta
            proveedores_out.append({
                'key': p['key'],
                'label': p['label'],
                'cat': p['cat'],
                'descripcion': obj.descripcion or '',
                'logo_url': _logo_url(obj, request),
                'contactos': _contactos_dict(obj),
                'meta_anual': meta,
                'estrategia': obj.estrategia or '',
                'facturado': facturado,
                'pipeline': pipeline,
                'ops_count': ops_count,
                'cotizaciones': 0,
                'campanias': 0,
                'meta': meta,
                'avance': avance,
                'gap': gap,
            })

        totals = {
            'facturado': sum(x['facturado'] for x in proveedores_out),
            'pipeline': sum(x['pipeline'] for x in proveedores_out),
            'cotizaciones': 0,
            'campanias': 0,
            'meta': sum(x['meta'] for x in proveedores_out),
        }
        totals['gap'] = totals['facturado'] - totals['meta']

        return JsonResponse({
            'ok': True,
            'anio': anio,
            'proveedores': proveedores_out,
            'totals': totals,
            'can_manage': es_super,
        })
    except Exception as e:
        logger.exception('api_proveedores_resumen failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def api_proveedor_detalle(request, proveedor_key):
    """Detalle: KPIs + oportunidades + metadata rica del proveedor.

    Si `TodoItem.proveedor` no existe, devuelve ops=[] y facturado=0.
    """
    try:
        user = request.user
        anio = _parse_anio(request)
        es_super = is_supervisor(user)
        key_up = (proveedor_key or '').upper()

        catalogo = _get_proveedores_catalogo()
        proveedor = next((p for p in catalogo if p['key'] == key_up), None)
        if not proveedor:
            return JsonResponse({'ok': False, 'error': 'Proveedor no encontrado'}, status=404)
        obj = proveedor['_obj']

        ops = []
        facturado = Decimal('0')
        pipeline  = Decimal('0')

        if _has_proveedor_field():
            try:
                opp_qs = _safe_opp_qs(user, anio, request, es_super, proveedor=proveedor)
                opp_qs = opp_qs.select_related('cliente')
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
            except (FieldError, AttributeError):
                logger.exception('proveedor_detalle: query con campo proveedor falló')

        meta = float(obj.meta_anual or 0)
        avance = (float(facturado) / meta) if meta else 0
        gap = float(facturado) - meta

        return JsonResponse({
            'ok': True,
            'anio': anio,
            'proveedor': {
                'key': proveedor['key'],
                'label': proveedor['label'],
                'cat': proveedor['cat'],
                'descripcion': obj.descripcion or '',
                'logo_url': _logo_url(obj, request),
                'contactos': _contactos_dict(obj),
                'meta_anual': meta,
                'estrategia': obj.estrategia or '',
                'facturado': float(facturado),
                'pipeline': float(pipeline),
                'ops_count': len(ops),
                'cotizaciones': 0,
                'campanias': 0,
                'meta': meta,
                'avance': avance,
                'gap': gap,
            },
            'ops': sorted(ops, key=lambda x: -x['monto']),
            'can_manage': es_super,
        })
    except Exception as e:
        logger.exception('api_proveedor_detalle failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ─────────────────────────────────────────────────────────────────────
# CRUD — Solo supervisores
# ─────────────────────────────────────────────────────────────────────

def _require_supervisor(request):
    """Devuelve None si OK, o JsonResponse 403 si no es supervisor."""
    if not is_supervisor(request.user):
        return JsonResponse(
            {'ok': False, 'error': 'Solo supervisores pueden gestionar proveedores.'},
            status=403,
        )
    return None


_KEY_RE = re.compile(r'^[A-Z0-9_-]{1,40}$')


def _normalizar_key(raw):
    """Slug canónico para `key`: uppercase, sin tildes, alfanumérico+_-."""
    if raw is None:
        return ''
    s = str(raw).strip().upper()
    repl = {
        'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
        'Ñ': 'N', 'Ü': 'U',
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    s = re.sub(r'\s+', '_', s)
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
    return {k: request.POST.get(k) for k in request.POST.keys()}


def _aplicar_campos(proveedor, data, is_create=False):
    """Aplica campos editables al objeto (sin save). Devuelve lista de
    campos modificados para `update_fields`."""
    fields = []

    if 'nombre' in data:
        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            raise ValueError('El nombre no puede estar vacío.')
        proveedor.nombre = nombre[:80]
        fields.append('nombre')

    if 'categoria' in data:
        proveedor.categoria = (data.get('categoria') or '').strip()[:100]
        fields.append('categoria')

    if 'descripcion' in data:
        proveedor.descripcion = (data.get('descripcion') or '').strip()
        fields.append('descripcion')

    if 'estrategia' in data:
        proveedor.estrategia = (data.get('estrategia') or '').strip()
        fields.append('estrategia')

    if 'meta_anual' in data:
        raw = data.get('meta_anual')
        if raw in (None, '', 'null'):
            proveedor.meta_anual = Decimal('0')
        else:
            try:
                cleaned = re.sub(r'[^0-9.\-]', '', str(raw))
                proveedor.meta_anual = Decimal(cleaned) if cleaned else Decimal('0')
            except (InvalidOperation, TypeError):
                raise ValueError('meta_anual inválido.')
        fields.append('meta_anual')

    if 'activa' in data:
        v = data.get('activa')
        proveedor.activa = (v in (True, 'true', 'True', '1', 1, 'on'))
        fields.append('activa')

    # Contactos — pueden venir como objetos anidados (JSON) o como flat
    # (multipart con keys "contacto_principal_nombre" etc.). Soportamos ambos.
    contactos = data.get('contactos')
    if isinstance(contactos, dict):
        flatmap = {
            'principal': ('contacto_principal_nombre', 'contacto_principal_email', 'contacto_principal_telefono'),
            'ventas':    ('contacto_ventas_nombre',    'contacto_ventas_email',    'contacto_ventas_telefono'),
            'soporte':   ('contacto_soporte_nombre',   'contacto_soporte_email',   'contacto_soporte_telefono'),
        }
        for grupo, (fn, fe, ft) in flatmap.items():
            g = contactos.get(grupo) or {}
            if not isinstance(g, dict):
                continue
            if 'nombre' in g:
                setattr(proveedor, fn, (g.get('nombre') or '').strip()[:120]); fields.append(fn)
            if 'email' in g:
                setattr(proveedor, fe, (g.get('email') or '').strip()[:120]); fields.append(fe)
            if 'telefono' in g:
                setattr(proveedor, ft, (g.get('telefono') or '').strip()[:40]); fields.append(ft)

    # Flat overrides (siempre tienen precedencia, útiles para multipart)
    for f in (
        'contacto_principal_nombre', 'contacto_principal_email', 'contacto_principal_telefono',
        'contacto_ventas_nombre',    'contacto_ventas_email',    'contacto_ventas_telefono',
        'contacto_soporte_nombre',   'contacto_soporte_email',   'contacto_soporte_telefono',
    ):
        if f in data:
            maxlen = 40 if f.endswith('_telefono') else 120
            setattr(proveedor, f, (data.get(f) or '').strip()[:maxlen])
            fields.append(f)

    return list(dict.fromkeys(fields))


def _aplicar_logo(proveedor, request, fields):
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
    if proveedor.logo:
        try:
            proveedor.logo.delete(save=False)
        except Exception:
            logger.exception('No se pudo borrar logo previo de proveedor id=%s', proveedor.id)
    proveedor.logo = logo
    fields.append('logo')
    return fields


@login_required
@require_http_methods(["POST"])
def api_proveedor_crear(request):
    """Alta de proveedor. Body JSON o multipart (con campo `logo`)."""
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

        if ProveedorCRM.objects.filter(key=key).exists():
            return JsonResponse(
                {'ok': False, 'error': f'Ya existe un proveedor con key "{key}".'},
                status=409,
            )
        if ProveedorCRM.objects.filter(nombre=nombre).exists():
            return JsonResponse(
                {'ok': False, 'error': f'Ya existe un proveedor con nombre "{nombre}".'},
                status=409,
            )

        proveedor = ProveedorCRM(key=key, nombre=nombre, activa=True)
        try:
            _aplicar_campos(proveedor, data, is_create=True)
            _aplicar_logo(proveedor, request, [])
        except ValueError as ve:
            return JsonResponse({'ok': False, 'error': str(ve)}, status=400)

        proveedor.save()
        return JsonResponse(
            {'ok': True, 'proveedor': _proveedor_full_dict(proveedor, request)},
            status=201,
        )
    except Exception as e:
        logger.exception('api_proveedor_crear failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def api_proveedor_edit(request, proveedor_key):
    """Devuelve TODA la metadata del proveedor para alimentar el editor."""
    try:
        key_up = (proveedor_key or '').upper()
        try:
            proveedor = ProveedorCRM.objects.get(key=key_up)
        except ProveedorCRM.DoesNotExist:
            return JsonResponse({'ok': False, 'error': 'Proveedor no encontrado'}, status=404)
        return JsonResponse({
            'ok': True,
            'proveedor': _proveedor_full_dict(proveedor, request),
            'can_manage': is_supervisor(request.user),
        })
    except Exception as e:
        logger.exception('api_proveedor_edit failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_proveedor_actualizar(request, proveedor_key):
    """Update parcial. Multipart si trae logo, JSON si no."""
    err = _require_supervisor(request)
    if err:
        return err
    try:
        key_up = (proveedor_key or '').upper()
        try:
            proveedor = ProveedorCRM.objects.get(key=key_up)
        except ProveedorCRM.DoesNotExist:
            return JsonResponse({'ok': False, 'error': 'Proveedor no encontrado'}, status=404)

        data = _read_body(request)

        new_nombre = (data.get('nombre') or '').strip() if 'nombre' in data else None
        if new_nombre and new_nombre != proveedor.nombre:
            if ProveedorCRM.objects.filter(nombre=new_nombre).exclude(id=proveedor.id).exists():
                return JsonResponse(
                    {'ok': False, 'error': f'Ya existe otro proveedor con nombre "{new_nombre}".'},
                    status=409,
                )

        try:
            fields = _aplicar_campos(proveedor, data, is_create=False)
            fields = _aplicar_logo(proveedor, request, fields)
        except ValueError as ve:
            return JsonResponse({'ok': False, 'error': str(ve)}, status=400)

        if not fields:
            return JsonResponse(
                {'ok': False, 'error': 'No se proporcionó ningún campo válido.'},
                status=400,
            )
        fields.append('updated_at')
        try:
            proveedor.save(update_fields=fields)
        except Exception as e:
            logger.exception('api_proveedor_actualizar save failed (key=%s)', proveedor_key)
            return JsonResponse({'ok': False, 'error': f'Error al guardar: {e}'}, status=500)

        return JsonResponse({'ok': True, 'proveedor': _proveedor_full_dict(proveedor, request)})
    except Exception as e:
        logger.exception('api_proveedor_actualizar failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_proveedor_eliminar(request, proveedor_key):
    """Soft-delete: proveedor activa=False. Reversible vía actualizar."""
    err = _require_supervisor(request)
    if err:
        return err
    try:
        key_up = (proveedor_key or '').upper()
        try:
            proveedor = ProveedorCRM.objects.get(key=key_up)
        except ProveedorCRM.DoesNotExist:
            return JsonResponse({'ok': False, 'error': 'Proveedor no encontrado'}, status=404)
        proveedor.activa = False
        proveedor.save(update_fields=['activa', 'updated_at'])
        return JsonResponse({'ok': True})
    except Exception as e:
        logger.exception('api_proveedor_eliminar failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

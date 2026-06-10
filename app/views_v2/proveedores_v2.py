"""
proveedores_v2.py — Vistas de la sección "Proveedores" del dashboard +
CRUD del catálogo persistido en DB (modelo ProveedorCRM).

Espejo estructural de marcas_v2.py. Difiere en:
  * Contactos renombrados: principal / ventas / soporte (en vez de
    marca / ingenieria / mayorista).
  * Pipeline derivado de DetalleCotizacion.proveedor (FK por línea),
    filtrando a la ÚLTIMA cotización de cada opp (junio 2026).
    El M2M `TodoItem.proveedores` fue eliminado en migración 0184 —
    una opp con N proveedores se cubre porque cada línea de su última
    cotización tiene su propio FK proveedor.

Reglas (alineadas con marcas_v2.py):
  1. SOLO la última cotización (id más alto) de cada opp cuenta.
  2. Monto por proveedor = subtotales de SUS líneas (no monto total
     del TodoItem).
  3. Opps sin cotización quedan fuera.
  4. Una línea cuenta como facturado si su opp tiene
     monto_facturacion > 0, sino como pipeline.

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
from django.db.models import Max, Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from app.models import Cotizacion, DetalleCotizacion, ProveedorCRM, TodoItem
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


# ─────────────────────────────────────────────────────────────────────
# AGREGACIÓN desde DetalleCotizacion (regla "última cotización por opp")
# ─────────────────────────────────────────────────────────────────────

def _ultimas_cotizaciones_ids(opp_qs):
    """Lista de IDs de la última cotización (mayor id) por opp."""
    return list(
        Cotizacion.objects
        .filter(oportunidad_id__in=opp_qs.values_list('id', flat=True))
        .values('oportunidad_id')
        .annotate(max_id=Max('id'))
        .values_list('max_id', flat=True)
    )


def _subtotal_linea(detalle):
    """cantidad * precio_unitario * (1 - descuento/100). Decimal."""
    cant = Decimal(detalle.cantidad or 0)
    precio = detalle.precio_unitario or Decimal('0')
    desc = detalle.descuento_porcentaje or Decimal('0')
    return cant * precio * (Decimal('1') - desc / Decimal('100'))


def _agregar_por_proveedor(ultimas_cot_ids):
    """Itera líneas de las últimas cotizaciones y agrega por
    DetalleCotizacion.proveedor. Devuelve dict
    {key_proveedor: {facturado, pipeline, ops_count, cotizaciones}}.
    """
    qs = (
        DetalleCotizacion.objects
        .filter(cotizacion_id__in=ultimas_cot_ids, proveedor__isnull=False)
        .select_related('cotizacion__oportunidad', 'proveedor')
    )
    por_prov = defaultdict(lambda: {
        'facturado': Decimal('0'),
        'pipeline': Decimal('0'),
        'opps': set(),
        'cots': set(),
    })
    for d in qs:
        cot = d.cotizacion
        opp = cot.oportunidad if cot is not None else None
        if opp is None or d.proveedor is None:
            continue
        if (d.tipo or 'producto') != 'producto':
            continue
        sub = _subtotal_linea(d)
        key = d.proveedor.key
        if opp.monto_facturacion and opp.monto_facturacion > 0:
            por_prov[key]['facturado'] += sub
        else:
            por_prov[key]['pipeline'] += sub
        por_prov[key]['opps'].add(opp.id)
        por_prov[key]['cots'].add(cot.id)
    return {
        k: {
            'facturado':   v['facturado'],
            'pipeline':    v['pipeline'],
            'ops_count':   len(v['opps']),
            'cotizaciones': len(v['cots']),
        }
        for k, v in por_prov.items()
    }


def _opps_de_proveedor(ultimas_cot_ids, proveedor_key):
    """{opp_id: {opp, monto_prov}} donde monto_prov = suma de
    subtotales de las líneas del proveedor en la última cotización."""
    qs = (
        DetalleCotizacion.objects
        .filter(
            cotizacion_id__in=ultimas_cot_ids,
            proveedor__key=proveedor_key,
        )
        .select_related('cotizacion__oportunidad__cliente')
    )
    out = {}
    for d in qs:
        cot = d.cotizacion
        opp = cot.oportunidad if cot is not None else None
        if opp is None:
            continue
        if (d.tipo or 'producto') != 'producto':
            continue
        sub = _subtotal_linea(d)
        rec = out.setdefault(opp.id, {'opp': opp, 'monto_prov': Decimal('0')})
        rec['monto_prov'] += sub
    return out


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
                    facturado, pipeline, ops_count, cotizaciones,
                    meta, avance, gap,
                }, ...
            ],
            totals: { facturado, pipeline, cotizaciones, meta, gap }
        }
    """
    try:
        user = request.user
        anio = _parse_anio(request)
        es_super = is_supervisor(user)
        catalogo = _get_proveedores_catalogo()

        opp_qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
            anio_cierre=anio,
        )
        opp_qs = _aplicar_vendedores(opp_qs, request, es_super)
        ultimas_cot_ids = _ultimas_cotizaciones_ids(opp_qs)
        por_prov = _agregar_por_proveedor(ultimas_cot_ids)

        proveedores_out = []
        for p in catalogo:
            d = por_prov.get(p['key'], {})
            facturado = float(d.get('facturado') or 0)
            pipeline  = float(d.get('pipeline') or 0)
            ops_count = int(d.get('ops_count') or 0)
            cotizaciones = int(d.get('cotizaciones') or 0)
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
                'cotizaciones': cotizaciones,
                'campanias': 0,
                'meta': meta,
                'avance': avance,
                'gap': gap,
            })

        totals = {
            'facturado': sum(x['facturado'] for x in proveedores_out),
            'pipeline': sum(x['pipeline'] for x in proveedores_out),
            'cotizaciones': sum(x['cotizaciones'] for x in proveedores_out),
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

    Las ops listadas son las cuya última cotización tiene al menos
    una línea con `proveedor` = este. El "monto" mostrado por opp
    es lo que aporta ESTE proveedor (subtotales de sus líneas).
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

        opp_qs = TodoItem.objects.filter(_filtros_visibilidad(user)).filter(
            anio_cierre=anio,
        )
        opp_qs = _aplicar_vendedores(opp_qs, request, es_super)
        ultimas_cot_ids = _ultimas_cotizaciones_ids(opp_qs)
        opps_prov = _opps_de_proveedor(ultimas_cot_ids, proveedor['key'])

        ops = []
        facturado = Decimal('0')
        pipeline  = Decimal('0')
        for rec in opps_prov.values():
            o = rec['opp']
            monto_prov = rec['monto_prov']
            mes = int(o.mes_cierre) if o.mes_cierre else 0
            prob = int(o.probabilidad_cierre or 0)
            ops.append({
                'id': o.id,
                'cliente': (o.cliente.nombre_empresa if o.cliente_id else ''),
                'oportunidad': o.oportunidad or '',
                'monto': float(monto_prov),
                'mes': mes,
                'prob': prob,
                'etapa': o.etapa_corta or '',
                'po': (o.po_number or '').strip(),
            })
            if o.monto_facturacion and o.monto_facturacion > 0:
                facturado += monto_prov
            else:
                pipeline += monto_prov

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
                'cotizaciones': len(ops),
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
@require_http_methods(["POST"])
def api_proveedor_quick_create(request):
    """Crea un ProveedorCRM mínimo a partir de un nombre escrito por el
    usuario (típicamente desde el dropdown del formulario de cotización).

    Reglas:
      * Si ya existe un proveedor con el mismo nombre case-insensitive →
        lo retorna sin crear duplicado (`ya_existia: true`).
      * Si no existe → lo crea con `key` autogenerada vía `_normalizar_key`
        sobre el nombre, y `activa=True`.
      * Cualquier usuario autenticado puede invocarlo (NO restringido a
        supervisor) — el caso de uso es agregar proveedores sobre la
        marcha mientras se llena una cotización, sin bloquear al vendedor.

    Body: JSON `{nombre: "X"}` o form-encoded `nombre=X`.
    Response 200/201:
        {ok: true, id, key, nombre, ya_existia: bool}
    """
    try:
        data = _read_body(request)
        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            return JsonResponse(
                {'ok': False, 'error': 'El nombre es requerido.'}, status=400,
            )
        nombre = nombre[:80]

        # Buscar duplicado case-insensitive sobre nombre.
        existente = ProveedorCRM.objects.filter(nombre__iexact=nombre).first()
        if existente is not None:
            return JsonResponse({
                'ok': True,
                'id': existente.id,
                'key': existente.key,
                'nombre': existente.nombre,
                'ya_existia': True,
            })

        # Generar key canónica a partir del nombre. Si colisiona (otro
        # proveedor con misma key pero distinto nombre, ej. tildes), añade
        # sufijo numérico hasta encontrar libre.
        base_key = _normalizar_key(nombre)
        if not base_key:
            return JsonResponse(
                {'ok': False, 'error': 'No se pudo generar key a partir del nombre.'},
                status=400,
            )
        key = base_key
        sufijo = 2
        while ProveedorCRM.objects.filter(key=key).exists():
            sufijo_str = f'_{sufijo}'
            key = (base_key[:40 - len(sufijo_str)] + sufijo_str)
            sufijo += 1
            if sufijo > 100:
                return JsonResponse(
                    {'ok': False, 'error': 'No se pudo generar key única.'},
                    status=500,
                )

        proveedor = ProveedorCRM.objects.create(
            key=key, nombre=nombre, activa=True,
        )
        return JsonResponse({
            'ok': True,
            'id': proveedor.id,
            'key': proveedor.key,
            'nombre': proveedor.nombre,
            'ya_existia': False,
        }, status=201)
    except Exception as e:
        logger.exception('api_proveedor_quick_create failed')
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

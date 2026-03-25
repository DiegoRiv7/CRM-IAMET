# ═══════════════════════════════════════════════════════════════
#  views_iamet.py — APIs del modulo de Proyectos IAMET
#  Gestion de proyectos de telecomunicaciones
# ═══════════════════════════════════════════════════════════════

import json
from decimal import Decimal, InvalidOperation
from datetime import date
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.db.models import Sum, DecimalField
from django.utils import timezone
from .models import (
    ProyectoIAMET as Proyecto, ProyectoPartida, ProyectoOrdenCompra,
    ProyectoFacturaProveedor, ProyectoFacturaIngreso,
    ProyectoGasto, ProyectoTarea, ProyectoAlerta,
    ProyectoConfiguracion,
)
from .views_utils import is_supervisor
from .views_grupos import get_usuarios_visibles_ids


# ─── Helpers ──────────────────────────────────────────────────

def _get_proyectos_qs(user):
    if is_supervisor(user):
        return Proyecto.objects.all()
    vis_ids = get_usuarios_visibles_ids(user)
    if vis_ids is None:
        return Proyecto.objects.all()
    return Proyecto.objects.filter(usuario_id__in=vis_ids)


def _check_access(user, proyecto):
    if is_supervisor(user):
        return True
    vis_ids = get_usuarios_visibles_ids(user)
    if vis_ids is None:
        return True
    return proyecto.usuario_id in vis_ids


def _dec(val, default=Decimal('0')):
    if val is None or val == '':
        return default
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError):
        return default


def _parse_date(val):
    if not val:
        return None
    try:
        parts = str(val).split('-')
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except Exception:
        return None


def _fmt(val):
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    return str(val)


def _proyecto_to_dict(p, include_alerts=False):
    d = {
        'id': p.id,
        'usuario_id': p.usuario_id,
        'usuario_nombre': (p.usuario.first_name + ' ' + p.usuario.last_name).strip() or p.usuario.username,
        'nombre': p.nombre,
        'descripcion': p.descripcion,
        'cliente_nombre': p.cliente_nombre,
        'status': p.status,
        'utilidad_presupuestada': float(p.utilidad_presupuestada),
        'utilidad_real': float(p.utilidad_real),
        'fecha_inicio': _fmt(p.fecha_inicio),
        'fecha_fin': _fmt(p.fecha_fin),
        'created_at': _fmt(p.created_at),
        'updated_at': _fmt(p.updated_at),
        'oportunidad_id': p.oportunidad_id if hasattr(p, 'oportunidad_id') else None,
        'oportunidad_nombre': p.oportunidad.oportunidad if hasattr(p, 'oportunidad_id') and p.oportunidad_id and p.oportunidad else None,
    }
    if include_alerts:
        d['alertas_pendientes'] = p.alertas.filter(resuelta=False).count()
    return d


def _partida_to_dict(p):
    return {
        'id': p.id,
        'proyecto_id': p.proyecto_id,
        'categoria': p.categoria,
        'descripcion': p.descripcion,
        'marca': p.marca,
        'numero_parte': p.numero_parte,
        'cantidad': float(p.cantidad),
        'cantidad_pendiente': float(p.cantidad_pendiente),
        'precio_lista': float(p.precio_lista),
        'descuento': float(p.descuento),
        'costo_unitario': float(p.costo_unitario),
        'costo_total': float(p.costo_total),
        'precio_venta_unitario': float(p.precio_venta_unitario),
        'precio_venta_total': float(p.precio_venta_total),
        'ganancia': float(p.ganancia),
        'proveedor': p.proveedor,
        'status': p.status,
        'created_at': _fmt(p.created_at),
        'updated_at': _fmt(p.updated_at),
    }


def _oc_to_dict(oc):
    return {
        'id': oc.id,
        'proyecto_id': oc.proyecto_id,
        'partida_id': oc.partida_id,
        'partida_descripcion': oc.partida.descripcion if oc.partida else '',
        'numero_oc': oc.numero_oc,
        'proveedor': oc.proveedor,
        'cantidad': float(oc.cantidad),
        'precio_unitario': float(oc.precio_unitario),
        'monto_total': float(oc.monto_total),
        'status': oc.status,
        'fecha_emision': _fmt(oc.fecha_emision),
        'fecha_entrega_esperada': _fmt(oc.fecha_entrega_esperada),
        'fecha_entrega_real': _fmt(oc.fecha_entrega_real),
        'notas': oc.notas,
        'created_at': _fmt(oc.created_at),
        'updated_at': _fmt(oc.updated_at),
    }


def _factura_prov_to_dict(f):
    return {
        'id': f.id,
        'proyecto_id': f.proyecto_id,
        'orden_compra_id': f.orden_compra_id,
        'numero_factura': f.numero_factura,
        'proveedor': f.proveedor,
        'monto': float(f.monto),
        'monto_presupuestado': float(f.monto_presupuestado) if f.monto_presupuestado else None,
        'varianza': float(f.varianza) if f.varianza is not None else None,
        'varianza_porcentaje': float(f.varianza_porcentaje) if f.varianza_porcentaje is not None else None,
        'fecha_factura': _fmt(f.fecha_factura),
        'fecha_vencimiento': _fmt(f.fecha_vencimiento),
        'fecha_pago': _fmt(f.fecha_pago),
        'status': f.status,
        'notas': f.notas,
        'created_at': _fmt(f.created_at),
        'updated_at': _fmt(f.updated_at),
    }


def _factura_ingreso_to_dict(f):
    return {
        'id': f.id,
        'proyecto_id': f.proyecto_id,
        'numero_factura': f.numero_factura,
        'monto': float(f.monto),
        'fecha_factura': _fmt(f.fecha_factura),
        'fecha_vencimiento': _fmt(f.fecha_vencimiento),
        'fecha_pago': _fmt(f.fecha_pago),
        'status': f.status,
        'metodo_pago': f.metodo_pago,
        'notas': f.notas,
        'created_at': _fmt(f.created_at),
        'updated_at': _fmt(f.updated_at),
    }


def _gasto_to_dict(g):
    return {
        'id': g.id,
        'proyecto_id': g.proyecto_id,
        'categoria': g.categoria,
        'descripcion': g.descripcion,
        'monto': float(g.monto),
        'monto_presupuestado': float(g.monto_presupuestado) if g.monto_presupuestado else None,
        'varianza': float(g.varianza) if g.varianza is not None else None,
        'fecha_gasto': _fmt(g.fecha_gasto),
        'estado_aprobacion': g.estado_aprobacion,
        'aprobado_por_id': g.aprobado_por_id,
        'aprobado_por_nombre': (
            (g.aprobado_por.first_name + ' ' + g.aprobado_por.last_name).strip() or g.aprobado_por.username
        ) if g.aprobado_por else None,
        'fecha_aprobacion': _fmt(g.fecha_aprobacion),
        'notas': g.notas,
        'created_at': _fmt(g.created_at),
        'updated_at': _fmt(g.updated_at),
    }


def _tarea_to_dict(t):
    return {
        'id': t.id,
        'proyecto_id': t.proyecto_id,
        'titulo': t.titulo,
        'descripcion': t.descripcion,
        'status': t.status,
        'prioridad': t.prioridad,
        'asignado_a_id': t.asignado_a_id,
        'asignado_a_nombre': (
            (t.asignado_a.first_name + ' ' + t.asignado_a.last_name).strip() or t.asignado_a.username
        ) if t.asignado_a else None,
        'fecha_limite': _fmt(t.fecha_limite),
        'fecha_completada': _fmt(t.fecha_completada),
        'horas_estimadas': float(t.horas_estimadas) if t.horas_estimadas else None,
        'horas_reales': float(t.horas_reales) if t.horas_reales else None,
        'notas': t.notas,
        'created_at': _fmt(t.created_at),
        'updated_at': _fmt(t.updated_at),
    }


def _alerta_to_dict(a):
    return {
        'id': a.id,
        'proyecto_id': a.proyecto_id,
        'tipo_alerta': a.tipo_alerta,
        'severidad': a.severidad,
        'titulo': a.titulo,
        'mensaje': a.mensaje,
        'entidad_tipo': a.entidad_tipo,
        'entidad_id': a.entidad_id,
        'resuelta': a.resuelta,
        'fecha_resolucion': _fmt(a.fecha_resolucion),
        'created_at': _fmt(a.created_at),
    }


# ═══════════════════════════════════════════════════════════════
#  PROYECTOS CRUD
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_proyectos_lista(request):
    try:
        qs = _get_proyectos_qs(request.user)
        status_filter = request.GET.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        qs = qs.select_related('usuario')
        proyectos = [_proyecto_to_dict(p, include_alerts=True) for p in qs]
        return JsonResponse({'ok': True, 'data': proyectos})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_proyecto_crear(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return JsonResponse({'success': False, 'error': 'El nombre es obligatorio'}, status=400)

    proyecto = Proyecto.objects.create(
        usuario=request.user,
        nombre=nombre,
        descripcion=data.get('descripcion', ''),
        cliente_nombre=data.get('cliente_nombre', ''),
        status=data.get('status', 'planning'),
        utilidad_presupuestada=_dec(data.get('utilidad_presupuestada')),
        fecha_inicio=_parse_date(data.get('fecha_inicio')),
        fecha_fin=_parse_date(data.get('fecha_fin')),
    )
    ProyectoConfiguracion.objects.create(proyecto=proyecto)
    return JsonResponse({'success': True, 'data': _proyecto_to_dict(proyecto, include_alerts=True)})


@login_required
@require_http_methods(["GET"])
def api_proyecto_detalle(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.select_related('usuario', 'configuracion', 'oportunidad').get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    d = _proyecto_to_dict(proyecto, include_alerts=True)

    # KPIs calculados
    partidas_agg = proyecto.partidas.aggregate(
        total_costo=Sum('costo_total', default=Decimal('0')),
        total_venta=Sum('precio_venta_total', default=Decimal('0')),
        total_ganancia=Sum('ganancia', default=Decimal('0')),
    )
    ingresos = proyecto.facturas_ingreso.aggregate(
        total=Sum('monto', default=Decimal('0'))
    )['total']
    costos_prov = proyecto.facturas_proveedor.aggregate(
        total=Sum('monto', default=Decimal('0'))
    )['total']
    gastos_aprobados = proyecto.gastos.filter(estado_aprobacion='approved').aggregate(
        total=Sum('monto', default=Decimal('0'))
    )['total']
    utilidad_real = ingresos - costos_prov - gastos_aprobados
    margen = (utilidad_real / ingresos * 100) if ingresos > 0 else Decimal('0')

    d['kpis'] = {
        'total_costo_partidas': float(partidas_agg['total_costo']),
        'total_venta_partidas': float(partidas_agg['total_venta']),
        'utilidad_presupuestada': float(partidas_agg['total_ganancia']),
        'ingresos': float(ingresos),
        'costos_proveedor': float(costos_prov),
        'gastos_aprobados': float(gastos_aprobados),
        'utilidad_real': float(utilidad_real),
        'margen': float(margen),
        'alertas_pendientes': proyecto.alertas.filter(resuelta=False).count(),
        'tareas_pendientes': proyecto.tareas_proyecto.exclude(status__in=['completed', 'cancelled']).count(),
        'ordenes_compra_activas': proyecto.ordenes_compra.exclude(status='cancelled').count(),
    }

    # Configuracion
    try:
        config = proyecto.configuracion
        d['configuracion'] = {
            'umbral_utilidad_minima': float(config.umbral_utilidad_minima),
            'umbral_alerta_varianza': float(config.umbral_alerta_varianza),
            'umbral_cantidad_critica': float(config.umbral_cantidad_critica),
            'requiere_aprobacion_gastos': config.requiere_aprobacion_gastos,
        }
    except ProyectoConfiguracion.DoesNotExist:
        d['configuracion'] = None

    return JsonResponse({'success': True, 'data': d})


@login_required
@require_http_methods(["POST"])
def api_proyecto_actualizar(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    updatable = ['nombre', 'descripcion', 'cliente_nombre', 'status']
    for field in updatable:
        if field in data:
            setattr(proyecto, field, data[field])

    if 'utilidad_presupuestada' in data:
        proyecto.utilidad_presupuestada = _dec(data['utilidad_presupuestada'])
    if 'fecha_inicio' in data:
        proyecto.fecha_inicio = _parse_date(data['fecha_inicio'])
    if 'fecha_fin' in data:
        proyecto.fecha_fin = _parse_date(data['fecha_fin'])

    proyecto.save()

    # Actualizar configuracion si viene
    config_data = data.get('configuracion')
    if config_data and isinstance(config_data, dict):
        config, _ = ProyectoConfiguracion.objects.get_or_create(proyecto=proyecto)
        if 'umbral_utilidad_minima' in config_data:
            config.umbral_utilidad_minima = _dec(config_data['umbral_utilidad_minima'], Decimal('15'))
        if 'umbral_alerta_varianza' in config_data:
            config.umbral_alerta_varianza = _dec(config_data['umbral_alerta_varianza'], Decimal('5'))
        if 'umbral_cantidad_critica' in config_data:
            config.umbral_cantidad_critica = _dec(config_data['umbral_cantidad_critica'], Decimal('5'))
        if 'requiere_aprobacion_gastos' in config_data:
            config.requiere_aprobacion_gastos = bool(config_data['requiere_aprobacion_gastos'])
        config.save()

    return JsonResponse({'success': True, 'data': _proyecto_to_dict(proyecto, include_alerts=True)})


@login_required
@require_http_methods(["POST"])
def api_proyecto_eliminar(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.select_related('usuario', 'oportunidad').get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado'}, status=404)

    # Solo el creador del proyecto o el responsable de la oportunidad puede eliminar
    puede_eliminar = False
    if proyecto.usuario_id == request.user.id:
        puede_eliminar = True
    if proyecto.oportunidad and proyecto.oportunidad.usuario_id == request.user.id:
        puede_eliminar = True
    if is_supervisor(request.user):
        puede_eliminar = True

    if not puede_eliminar:
        return JsonResponse({'ok': False, 'error': 'Solo el creador del proyecto o el responsable de la oportunidad puede eliminarlo'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'JSON invalido'}, status=400)

    motivo = (data.get('motivo') or '').strip()
    if not motivo:
        return JsonResponse({'ok': False, 'error': 'Debes documentar el motivo de eliminacion'}, status=400)

    # Guardar info antes de eliminar
    proyecto_nombre = proyecto.nombre
    cliente_nombre = proyecto.cliente_nombre
    usuario_nombre = (request.user.first_name + ' ' + request.user.last_name).strip() or request.user.username

    # Notificar a todos los administradores
    from .models import Notificacion
    from django.contrib.auth.models import User as AuthUser
    admins = AuthUser.objects.filter(
        Q(is_superuser=True) | Q(groups__name='Supervisores')
    ).distinct().exclude(id=request.user.id)

    for admin in admins:
        Notificacion.objects.create(
            usuario_destinatario=admin,
            usuario_remitente=request.user,
            tipo='sistema',
            titulo=f'Proyecto eliminado: {proyecto_nombre}',
            mensaje=f'{usuario_nombre} elimino el proyecto "{proyecto_nombre}" (Cliente: {cliente_nombre}).\n\nMotivo: {motivo}',
        )

    proyecto.delete()
    return JsonResponse({'ok': True, 'data': {'deleted': proyecto_id}})


# ═══════════════════════════════════════════════════════════════
#  PARTIDAS
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_partidas_lista(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    partidas = proyecto.partidas.all()
    items = [_partida_to_dict(p) for p in partidas]

    totals = proyecto.partidas.aggregate(
        total_costo=Sum('costo_total', default=Decimal('0')),
        total_venta=Sum('precio_venta_total', default=Decimal('0')),
        total_ganancia=Sum('ganancia', default=Decimal('0')),
    )

    return JsonResponse({
        'success': True,
        'data': {
            'partidas': items,
            'totales': {
                'costo_total': float(totals['total_costo']),
                'precio_venta_total': float(totals['total_venta']),
                'ganancia': float(totals['total_ganancia']),
            },
        },
    })


@login_required
@require_http_methods(["POST"])
def api_partida_crear(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    proyecto_id = data.get('proyecto_id')
    if not proyecto_id:
        return JsonResponse({'success': False, 'error': 'proyecto_id es obligatorio'}, status=400)

    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    cantidad = _dec(data.get('cantidad'), Decimal('1'))
    cantidad_pendiente = _dec(data.get('cantidad_pendiente'), cantidad)

    partida = ProyectoPartida(
        proyecto=proyecto,
        categoria=data.get('categoria', 'equipamiento'),
        descripcion=data.get('descripcion', ''),
        marca=data.get('marca', ''),
        numero_parte=data.get('numero_parte', ''),
        cantidad=cantidad,
        cantidad_pendiente=cantidad_pendiente,
        precio_lista=_dec(data.get('precio_lista')),
        descuento=_dec(data.get('descuento')),
        costo_unitario=_dec(data.get('costo_unitario')),
        precio_venta_unitario=_dec(data.get('precio_venta_unitario')),
        proveedor=data.get('proveedor', ''),
        status=data.get('status', 'pending'),
    )
    partida.save()  # calcular_totales via model save()

    return JsonResponse({'success': True, 'data': _partida_to_dict(partida)})


@login_required
@require_http_methods(["POST"])
def api_partida_actualizar(request, partida_id):
    try:
        partida = ProyectoPartida.objects.select_related('proyecto').get(id=partida_id)
    except ProyectoPartida.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Partida no encontrada'}, status=404)

    if not _check_access(request.user, partida.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    str_fields = ['categoria', 'descripcion', 'marca', 'numero_parte', 'proveedor', 'status']
    for field in str_fields:
        if field in data:
            setattr(partida, field, data[field])

    dec_fields = ['cantidad', 'cantidad_pendiente', 'precio_lista', 'descuento',
                  'costo_unitario', 'precio_venta_unitario']
    for field in dec_fields:
        if field in data:
            setattr(partida, field, _dec(data[field]))

    partida.save()  # auto-recalculates totals

    return JsonResponse({'success': True, 'data': _partida_to_dict(partida)})


@login_required
@require_http_methods(["POST"])
def api_partida_eliminar(request, partida_id):
    try:
        partida = ProyectoPartida.objects.select_related('proyecto').get(id=partida_id)
    except ProyectoPartida.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Partida no encontrada'}, status=404)

    if not _check_access(request.user, partida.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    partida.delete()
    return JsonResponse({'success': True, 'data': {'deleted': partida_id}})


# ═══════════════════════════════════════════════════════════════
#  ORDENES DE COMPRA
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_oc_lista(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    ordenes = proyecto.ordenes_compra.select_related('partida').all()
    items = [_oc_to_dict(oc) for oc in ordenes]
    return JsonResponse({'success': True, 'data': items})


@login_required
@require_http_methods(["POST"])
def api_oc_crear(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    proyecto_id = data.get('proyecto_id')
    partida_id = data.get('partida_id')
    if not proyecto_id or not partida_id:
        return JsonResponse({'success': False, 'error': 'proyecto_id y partida_id son obligatorios'}, status=400)

    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        partida = ProyectoPartida.objects.get(id=partida_id, proyecto=proyecto)
    except ProyectoPartida.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Partida no encontrada en este proyecto'}, status=404)

    cantidad_oc = _dec(data.get('cantidad'), Decimal('0'))
    if cantidad_oc <= 0:
        return JsonResponse({'success': False, 'error': 'La cantidad debe ser mayor a 0'}, status=400)

    if cantidad_oc > partida.cantidad_pendiente:
        return JsonResponse({
            'success': False,
            'error': f'Cantidad excede pendiente ({float(partida.cantidad_pendiente)} disponibles)'
        }, status=400)

    oc = ProyectoOrdenCompra(
        proyecto=proyecto,
        partida=partida,
        numero_oc=data.get('numero_oc', ''),
        proveedor=data.get('proveedor', ''),
        cantidad=cantidad_oc,
        precio_unitario=_dec(data.get('precio_unitario')),
        status=data.get('status', 'draft'),
        fecha_emision=_parse_date(data.get('fecha_emision')),
        fecha_entrega_esperada=_parse_date(data.get('fecha_entrega_esperada')),
        fecha_entrega_real=_parse_date(data.get('fecha_entrega_real')),
        notas=data.get('notas', ''),
    )
    oc.save()  # auto-calc monto_total + auto-generate numero_oc

    # Deduct from partida cantidad_pendiente
    partida.cantidad_pendiente -= cantidad_oc
    if partida.cantidad_pendiente <= 0:
        partida.cantidad_pendiente = Decimal('0')
        partida.status = 'closed'
    partida.save()

    return JsonResponse({'success': True, 'data': _oc_to_dict(oc)})


@login_required
@require_http_methods(["POST"])
def api_oc_actualizar(request, oc_id):
    try:
        oc = ProyectoOrdenCompra.objects.select_related('proyecto', 'partida').get(id=oc_id)
    except ProyectoOrdenCompra.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Orden de compra no encontrada'}, status=404)

    if not _check_access(request.user, oc.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    str_fields = ['proveedor', 'status', 'notas']
    for field in str_fields:
        if field in data:
            setattr(oc, field, data[field])

    if 'precio_unitario' in data:
        oc.precio_unitario = _dec(data['precio_unitario'])
    if 'cantidad' in data:
        oc.cantidad = _dec(data['cantidad'])

    date_fields = ['fecha_emision', 'fecha_entrega_esperada', 'fecha_entrega_real']
    for field in date_fields:
        if field in data:
            setattr(oc, field, _parse_date(data[field]))

    oc.save()  # auto-recalc monto_total

    return JsonResponse({'success': True, 'data': _oc_to_dict(oc)})


# ═══════════════════════════════════════════════════════════════
#  FACTURAS PROVEEDOR
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_facturas_proveedor_lista(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    facturas = proyecto.facturas_proveedor.all()
    items = [_factura_prov_to_dict(f) for f in facturas]
    return JsonResponse({'success': True, 'data': items})


@login_required
@require_http_methods(["POST"])
def api_factura_proveedor_crear(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    proyecto_id = data.get('proyecto_id')
    if not proyecto_id:
        return JsonResponse({'success': False, 'error': 'proyecto_id es obligatorio'}, status=400)

    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    fecha_factura = _parse_date(data.get('fecha_factura'))
    if not fecha_factura:
        return JsonResponse({'success': False, 'error': 'fecha_factura es obligatoria'}, status=400)

    orden_compra = None
    oc_id = data.get('orden_compra_id')
    if oc_id:
        try:
            orden_compra = ProyectoOrdenCompra.objects.get(id=oc_id, proyecto=proyecto)
        except ProyectoOrdenCompra.DoesNotExist:
            return JsonResponse({'success': False, 'error': 'Orden de compra no encontrada'}, status=404)

    factura = ProyectoFacturaProveedor(
        proyecto=proyecto,
        orden_compra=orden_compra,
        numero_factura=data.get('numero_factura', ''),
        proveedor=data.get('proveedor', ''),
        monto=_dec(data.get('monto')),
        monto_presupuestado=_dec(data.get('monto_presupuestado')) if data.get('monto_presupuestado') else None,
        fecha_factura=fecha_factura,
        fecha_vencimiento=_parse_date(data.get('fecha_vencimiento')),
        fecha_pago=_parse_date(data.get('fecha_pago')),
        status=data.get('status', 'pending'),
        notas=data.get('notas', ''),
    )
    factura.save()  # auto-calc varianza via model save()

    # Si la varianza_porcentaje > 5, crear alerta
    if factura.varianza_porcentaje is not None and factura.varianza_porcentaje > 5:
        ProyectoAlerta.objects.create(
            proyecto=proyecto,
            tipo_alerta='budget_variance',
            severidad='warning' if factura.varianza_porcentaje <= 15 else 'critical',
            titulo=f'Varianza de {float(factura.varianza_porcentaje):.1f}% en factura {factura.numero_factura}',
            mensaje=(
                f'La factura {factura.numero_factura} de {factura.proveedor} tiene una varianza '
                f'de {float(factura.varianza_porcentaje):.1f}% respecto al presupuesto. '
                f'Monto: ${float(factura.monto):,.2f}, '
                f'Presupuestado: ${float(factura.monto_presupuestado):,.2f}'
            ),
            entidad_tipo='factura_proveedor',
            entidad_id=factura.id,
        )

    return JsonResponse({'success': True, 'data': _factura_prov_to_dict(factura)})


@login_required
@require_http_methods(["POST"])
def api_factura_proveedor_actualizar(request, factura_id):
    try:
        factura = ProyectoFacturaProveedor.objects.select_related('proyecto').get(id=factura_id)
    except ProyectoFacturaProveedor.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Factura no encontrada'}, status=404)

    if not _check_access(request.user, factura.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    str_fields = ['numero_factura', 'proveedor', 'status', 'notas']
    for field in str_fields:
        if field in data:
            setattr(factura, field, data[field])

    if 'monto' in data:
        factura.monto = _dec(data['monto'])
    if 'monto_presupuestado' in data:
        factura.monto_presupuestado = _dec(data['monto_presupuestado']) if data['monto_presupuestado'] else None

    date_fields = ['fecha_factura', 'fecha_vencimiento', 'fecha_pago']
    for field in date_fields:
        if field in data:
            setattr(factura, field, _parse_date(data[field]))

    if 'orden_compra_id' in data:
        oc_id = data['orden_compra_id']
        if oc_id:
            try:
                factura.orden_compra = ProyectoOrdenCompra.objects.get(id=oc_id, proyecto=factura.proyecto)
            except ProyectoOrdenCompra.DoesNotExist:
                return JsonResponse({'success': False, 'error': 'Orden de compra no encontrada'}, status=404)
        else:
            factura.orden_compra = None

    factura.save()  # auto-recalc varianza

    return JsonResponse({'success': True, 'data': _factura_prov_to_dict(factura)})


# ═══════════════════════════════════════════════════════════════
#  FACTURAS INGRESO
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_facturas_ingreso_lista(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    facturas = proyecto.facturas_ingreso.all()
    items = [_factura_ingreso_to_dict(f) for f in facturas]
    return JsonResponse({'success': True, 'data': items})


@login_required
@require_http_methods(["POST"])
def api_factura_ingreso_crear(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    proyecto_id = data.get('proyecto_id')
    if not proyecto_id:
        return JsonResponse({'success': False, 'error': 'proyecto_id es obligatorio'}, status=400)

    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    fecha_factura = _parse_date(data.get('fecha_factura'))
    if not fecha_factura:
        return JsonResponse({'success': False, 'error': 'fecha_factura es obligatoria'}, status=400)

    factura = ProyectoFacturaIngreso.objects.create(
        proyecto=proyecto,
        numero_factura=data.get('numero_factura', ''),
        monto=_dec(data.get('monto')),
        fecha_factura=fecha_factura,
        fecha_vencimiento=_parse_date(data.get('fecha_vencimiento')),
        fecha_pago=_parse_date(data.get('fecha_pago')),
        status=data.get('status', 'emitted'),
        metodo_pago=data.get('metodo_pago', ''),
        notas=data.get('notas', ''),
    )

    return JsonResponse({'success': True, 'data': _factura_ingreso_to_dict(factura)})


@login_required
@require_http_methods(["POST"])
def api_factura_ingreso_actualizar(request, factura_id):
    try:
        factura = ProyectoFacturaIngreso.objects.select_related('proyecto').get(id=factura_id)
    except ProyectoFacturaIngreso.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Factura no encontrada'}, status=404)

    if not _check_access(request.user, factura.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    str_fields = ['numero_factura', 'status', 'metodo_pago', 'notas']
    for field in str_fields:
        if field in data:
            setattr(factura, field, data[field])

    if 'monto' in data:
        factura.monto = _dec(data['monto'])

    date_fields = ['fecha_factura', 'fecha_vencimiento', 'fecha_pago']
    for field in date_fields:
        if field in data:
            setattr(factura, field, _parse_date(data[field]))

    factura.save()

    return JsonResponse({'success': True, 'data': _factura_ingreso_to_dict(factura)})


# ═══════════════════════════════════════════════════════════════
#  GASTOS
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_gastos_lista(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    gastos = proyecto.gastos.select_related('aprobado_por').all()
    items = [_gasto_to_dict(g) for g in gastos]
    return JsonResponse({'success': True, 'data': items})


@login_required
@require_http_methods(["POST"])
def api_gasto_crear(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    proyecto_id = data.get('proyecto_id')
    if not proyecto_id:
        return JsonResponse({'success': False, 'error': 'proyecto_id es obligatorio'}, status=400)

    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    fecha_gasto = _parse_date(data.get('fecha_gasto'))
    if not fecha_gasto:
        return JsonResponse({'success': False, 'error': 'fecha_gasto es obligatoria'}, status=400)

    gasto = ProyectoGasto(
        proyecto=proyecto,
        categoria=data.get('categoria', 'other'),
        descripcion=data.get('descripcion', ''),
        monto=_dec(data.get('monto')),
        monto_presupuestado=_dec(data.get('monto_presupuestado')) if data.get('monto_presupuestado') else None,
        fecha_gasto=fecha_gasto,
        estado_aprobacion=data.get('estado_aprobacion', 'pending'),
        notas=data.get('notas', ''),
    )
    gasto.save()  # auto-calc varianza

    return JsonResponse({'success': True, 'data': _gasto_to_dict(gasto)})


@login_required
@require_http_methods(["POST"])
def api_gasto_actualizar(request, gasto_id):
    try:
        gasto = ProyectoGasto.objects.select_related('proyecto', 'aprobado_por').get(id=gasto_id)
    except ProyectoGasto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Gasto no encontrado'}, status=404)

    if not _check_access(request.user, gasto.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    str_fields = ['categoria', 'descripcion', 'notas']
    for field in str_fields:
        if field in data:
            setattr(gasto, field, data[field])

    if 'monto' in data:
        gasto.monto = _dec(data['monto'])
    if 'monto_presupuestado' in data:
        gasto.monto_presupuestado = _dec(data['monto_presupuestado']) if data['monto_presupuestado'] else None

    if 'fecha_gasto' in data:
        gasto.fecha_gasto = _parse_date(data['fecha_gasto'])

    gasto.save()  # auto-recalc varianza

    return JsonResponse({'success': True, 'data': _gasto_to_dict(gasto)})


@login_required
@require_http_methods(["POST"])
def api_gasto_aprobar(request, gasto_id):
    if not is_supervisor(request.user):
        return JsonResponse({'success': False, 'error': 'Solo supervisores pueden aprobar gastos'}, status=403)

    try:
        gasto = ProyectoGasto.objects.select_related('proyecto', 'aprobado_por').get(id=gasto_id)
    except ProyectoGasto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Gasto no encontrado'}, status=404)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        data = {}

    accion = data.get('accion', 'approved')  # 'approved' or 'rejected'
    if accion not in ('approved', 'rejected'):
        return JsonResponse({'success': False, 'error': 'accion debe ser approved o rejected'}, status=400)

    gasto.estado_aprobacion = accion
    gasto.aprobado_por = request.user
    gasto.fecha_aprobacion = timezone.now()
    gasto.save()

    return JsonResponse({'success': True, 'data': _gasto_to_dict(gasto)})


# ═══════════════════════════════════════════════════════════════
#  TAREAS PROYECTO
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_tareas_proyecto_lista(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    # 1) Tareas propias del proyecto
    tareas = proyecto.tareas_proyecto.select_related('asignado_a').all()
    items = []
    for t in tareas:
        d = _tarea_to_dict(t)
        d['source'] = 'proyecto'
        items.append(d)

    # 2) Tareas de la oportunidad vinculada (modelo Tarea del CRM)
    if proyecto.oportunidad_id:
        from .models import Tarea
        tareas_crm = Tarea.objects.filter(
            oportunidad_id=proyecto.oportunidad_id
        ).select_related('asignado_a', 'creado_por')
        prioridad_map = {'baja': 'low', 'media': 'medium', 'alta': 'high'}
        estado_map = {'pendiente': 'pending', 'iniciada': 'in_progress', 'en_progreso': 'in_progress', 'completada': 'completed', 'cancelada': 'cancelled'}
        for t in tareas_crm:
            resp_name = None
            if t.asignado_a:
                resp_name = (t.asignado_a.first_name + ' ' + t.asignado_a.last_name).strip() or t.asignado_a.username
            items.append({
                'id': t.id,
                'source': 'oportunidad',
                'titulo': t.titulo,
                'descripcion': getattr(t, 'descripcion', ''),
                'prioridad': prioridad_map.get(t.prioridad, 'medium'),
                'status': estado_map.get(t.estado, 'pending'),
                'asignado_a_nombre': resp_name,
                'fecha_limite': _fmt(t.fecha_limite),
            })

    return JsonResponse({'success': True, 'data': items})


@login_required
@require_http_methods(["POST"])
def api_tarea_proyecto_crear(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    proyecto_id = data.get('proyecto_id')
    if not proyecto_id:
        return JsonResponse({'success': False, 'error': 'proyecto_id es obligatorio'}, status=400)

    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    asignado_a = None
    asignado_a_id = data.get('asignado_a_id')
    if asignado_a_id:
        from django.contrib.auth.models import User
        try:
            asignado_a = User.objects.get(id=asignado_a_id)
        except User.DoesNotExist:
            return JsonResponse({'success': False, 'error': 'Usuario asignado no encontrado'}, status=404)

    tarea = ProyectoTarea.objects.create(
        proyecto=proyecto,
        titulo=data.get('titulo', ''),
        descripcion=data.get('descripcion', ''),
        status=data.get('status', 'pending'),
        prioridad=data.get('prioridad', 'medium'),
        asignado_a=asignado_a,
        fecha_limite=_parse_date(data.get('fecha_limite')),
        horas_estimadas=_dec(data.get('horas_estimadas')) if data.get('horas_estimadas') else None,
        notas=data.get('notas', ''),
    )

    return JsonResponse({'success': True, 'data': _tarea_to_dict(tarea)})


@login_required
@require_http_methods(["POST"])
def api_tarea_proyecto_actualizar(request, tarea_id):
    try:
        tarea = ProyectoTarea.objects.select_related('proyecto', 'asignado_a').get(id=tarea_id)
    except ProyectoTarea.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Tarea no encontrada'}, status=404)

    if not _check_access(request.user, tarea.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    str_fields = ['titulo', 'descripcion', 'prioridad', 'notas']
    for field in str_fields:
        if field in data:
            setattr(tarea, field, data[field])

    if 'status' in data:
        new_status = data['status']
        if new_status == 'completed' and tarea.status != 'completed':
            tarea.fecha_completada = timezone.now()
        elif new_status != 'completed':
            tarea.fecha_completada = None
        tarea.status = new_status

    if 'fecha_limite' in data:
        tarea.fecha_limite = _parse_date(data['fecha_limite'])

    if 'horas_estimadas' in data:
        tarea.horas_estimadas = _dec(data['horas_estimadas']) if data['horas_estimadas'] else None
    if 'horas_reales' in data:
        tarea.horas_reales = _dec(data['horas_reales']) if data['horas_reales'] else None

    if 'asignado_a_id' in data:
        asignado_a_id = data['asignado_a_id']
        if asignado_a_id:
            from django.contrib.auth.models import User
            try:
                tarea.asignado_a = User.objects.get(id=asignado_a_id)
            except User.DoesNotExist:
                return JsonResponse({'success': False, 'error': 'Usuario asignado no encontrado'}, status=404)
        else:
            tarea.asignado_a = None

    tarea.save()

    return JsonResponse({'success': True, 'data': _tarea_to_dict(tarea)})


# ═══════════════════════════════════════════════════════════════
#  ALERTAS
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_alertas_lista(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    qs = proyecto.alertas.all()
    show_all = request.GET.get('all')
    if not show_all:
        qs = qs.filter(resuelta=False)

    items = [_alerta_to_dict(a) for a in qs]
    return JsonResponse({'success': True, 'data': items})


@login_required
@require_http_methods(["POST"])
def api_alerta_resolver(request, alerta_id):
    try:
        alerta = ProyectoAlerta.objects.select_related('proyecto').get(id=alerta_id)
    except ProyectoAlerta.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Alerta no encontrada'}, status=404)

    if not _check_access(request.user, alerta.proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    alerta.resuelta = True
    alerta.fecha_resolucion = timezone.now()
    alerta.save()

    return JsonResponse({'success': True, 'data': _alerta_to_dict(alerta)})


# ═══════════════════════════════════════════════════════════════
#  FINANCIEROS (KPIs consolidados)
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_proyecto_financieros(request, proyecto_id):
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proyecto no encontrado'}, status=404)

    if not _check_access(request.user, proyecto):
        return JsonResponse({'success': False, 'error': 'Sin acceso'}, status=403)

    utilidad_presupuestada = proyecto.partidas.aggregate(
        total=Sum('ganancia', default=Decimal('0'))
    )['total']

    ingresos = proyecto.facturas_ingreso.aggregate(
        total=Sum('monto', default=Decimal('0'))
    )['total']

    costos = proyecto.facturas_proveedor.aggregate(
        total=Sum('monto', default=Decimal('0'))
    )['total']

    gastos = proyecto.gastos.filter(estado_aprobacion='approved').aggregate(
        total=Sum('monto', default=Decimal('0'))
    )['total']

    utilidad_real = ingresos - costos - gastos
    costos_gastos = costos + gastos
    margen = (utilidad_real / ingresos * 100) if ingresos > 0 else Decimal('0')
    cobertura = (ingresos / costos_gastos * 100) if costos_gastos > 0 else Decimal('0')
    alertas_pendientes = proyecto.alertas.filter(resuelta=False).count()

    return JsonResponse({
        'success': True,
        'data': {
            'utilidad_presupuestada': float(utilidad_presupuestada),
            'ingresos': float(ingresos),
            'costos': float(costos),
            'gastos': float(gastos),
            'utilidad_real': float(utilidad_real),
            'margen': float(margen),
            'cobertura': float(cobertura),
            'alertas_pendientes': alertas_pendientes,
        },
    })


# ═══════════════════════════════════════════════════════════════
#  IMPORTAR EXCEL (Volumetria)
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(['POST'])
def api_importar_excel(request):
    """POST: Importar partidas desde archivo Excel (formato volumetria ingenieros)"""
    try:
        proyecto_id = request.POST.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'proyecto_id requerido'}, status=400)

        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso'}, status=403)

        archivo = request.FILES.get('archivo')
        if not archivo:
            return JsonResponse({'ok': False, 'error': 'Archivo requerido'}, status=400)

        import openpyxl
        import requests as http_requests
        wb = openpyxl.load_workbook(archivo, data_only=True)
        ws = wb.active

        # --- Obtain USD->MXN exchange rate ---
        exchange_rate = Decimal('19.50')  # fallback
        try:
            resp = http_requests.get(
                'https://api.exchangerate-api.com/v4/latest/USD', timeout=5
            )
            if resp.status_code == 200:
                rate = resp.json().get('rates', {}).get('MXN')
                if rate:
                    exchange_rate = Decimal(str(rate))
        except Exception:
            pass  # use fallback

        # --- Section category mapping ---
        SECTION_MAP = {
            'material': 'equipamiento',
            'equipamiento': 'equipamiento',
            'equipos de elevacion': 'equipamiento',
            'canalizacion': 'accesorios',
            'accesorios': 'accesorios',
            'mano de obra': 'mano_obra',
        }

        def classify_section(text):
            """Return category for a section header text."""
            t = (text or '').strip().lower()
            for key, cat in SECTION_MAP.items():
                if key in t:
                    return cat
            return 'otros'

        def is_section_header(row_values):
            """A section header has text in col A but no valid cantidad in col C,
            and often has a subtotal in col H."""
            col_a = row_values[0]
            col_c = row_values[2] if len(row_values) > 2 else None
            if not col_a or not str(col_a).strip():
                return False, ''
            # col C must be empty or non-numeric for a header
            if col_c is not None and col_c != '' and col_c != 0:
                try:
                    float(col_c)
                    # col C is a number — could still be a header if cantidad is 0
                    if float(col_c) != 0:
                        return False, ''
                except (ValueError, TypeError):
                    pass
            return True, str(col_a).strip()

        # --- Parse rows ---
        items_created = 0
        errors = []
        current_category = 'equipamiento'
        total_venta_mxn = Decimal('0')
        total_costo_mxn = Decimal('0')
        max_row = ws.max_row or 0

        # Read all rows (skip first 4 metadata/header rows, start from row 5 onward)
        # Row 5 is column headers, data starts at row 6
        for row_idx in range(6, min(max_row + 1, 81)):  # stop before summary (row 81+)
            try:
                row_cells = []
                for col_idx in range(1, 12):  # cols A-K (1-11)
                    cell = ws.cell(row=row_idx, column=col_idx)
                    row_cells.append(cell.value)

                # Pad to 11 elements
                while len(row_cells) < 11:
                    row_cells.append(None)

                # Check if this is a section header
                is_header, header_text = is_section_header(row_cells)
                if is_header and header_text:
                    current_category = classify_section(header_text)
                    continue

                # Extract values (0-indexed from row_cells)
                marca = str(row_cells[0] or '').strip()         # col A
                numero_parte = str(row_cells[1] or '').strip()  # col B
                cantidad_raw = row_cells[2]                      # col C
                descripcion = str(row_cells[3] or '').strip()   # col D
                precio_lista_raw = row_cells[4]                  # col E
                descuento_raw = row_cells[5]                     # col F
                precio_venta_raw = row_cells[6]                  # col G
                # col H = total venta (skip, calculated)
                # col I = descuento costo (skip)
                costo_raw = row_cells[9]                         # col J
                # col K = total costo (skip, calculated)

                # Validate: skip if no descripcion
                if not descripcion:
                    continue

                # Validate: skip if cantidad is empty, 0, or not a number
                cantidad = _dec(cantidad_raw)
                if cantidad <= 0:
                    continue

                precio_lista = _dec(precio_lista_raw)
                descuento_pct = _dec(descuento_raw)  # decimal form, e.g. 0.3
                precio_venta = _dec(precio_venta_raw)
                costo = _dec(costo_raw)

                # For labor rows: if precio_venta is empty, use precio_lista
                if current_category == 'mano_obra':
                    if precio_venta == 0 and precio_lista > 0:
                        precio_venta = precio_lista
                    if costo == 0:
                        costo = precio_venta  # labor cost = sale price

                # Convert descuento from decimal to percentage (0.3 -> 30)
                descuento_display = descuento_pct * Decimal('100')

                # Convert USD prices to MXN
                precio_lista_mxn = precio_lista * exchange_rate
                precio_venta_mxn = precio_venta * exchange_rate
                costo_mxn = costo * exchange_rate

                # Use marca as default proveedor
                proveedor = marca

                ProyectoPartida.objects.create(
                    proyecto=proyecto,
                    categoria=current_category,
                    descripcion=descripcion,
                    marca=marca,
                    numero_parte=numero_parte,
                    cantidad=cantidad,
                    cantidad_pendiente=cantidad,
                    precio_lista=precio_lista_mxn,
                    descuento=descuento_display,
                    costo_unitario=costo_mxn,
                    precio_venta_unitario=precio_venta_mxn,
                    proveedor=proveedor,
                )
                items_created += 1
                total_venta_mxn += precio_venta_mxn * cantidad
                total_costo_mxn += costo_mxn * cantidad

            except Exception as row_err:
                errors.append(f'Fila {row_idx}: {str(row_err)}')

        # Recalculate project utilidad_presupuestada
        ganancia_total = Decimal('0')
        for p in proyecto.partidas.all():
            ganancia_total += p.ganancia
        proyecto.utilidad_presupuestada = ganancia_total
        proyecto.save(update_fields=['utilidad_presupuestada'])

        ganancia_mxn = total_venta_mxn - total_costo_mxn

        return JsonResponse({
            'ok': True,
            'items_created': items_created,
            'total_venta_mxn': float(total_venta_mxn.quantize(Decimal('0.01'))),
            'total_costo_mxn': float(total_costo_mxn.quantize(Decimal('0.01'))),
            'ganancia_mxn': float(ganancia_mxn.quantize(Decimal('0.01'))),
            'exchange_rate': float(exchange_rate.quantize(Decimal('0.01'))),
            'errors': errors,
        })

    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

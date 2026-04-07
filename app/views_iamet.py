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
from django.db.models import Sum, Count, Q, DecimalField
from django.utils import timezone
from .models import (
    ProyectoIAMET as Proyecto, ProyectoPartida, ProyectoOrdenCompra,
    ProyectoFacturaProveedor, ProyectoFacturaIngreso,
    ProyectoGasto, ProyectoTarea, ProyectoAlerta,
    ProyectoConfiguracion, ProyectoVolumetriaVersion,
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


def _calcular_avance(proyecto):
    """Calcula % de avance del proyecto basado en partidas + etapa oportunidad."""
    from .models import ProgramacionActividad

    # 40% weight: partidas completadas (status closed or received)
    total_partidas = proyecto.partidas.count()
    if total_partidas > 0:
        partidas_completas = proyecto.partidas.filter(status__in=['closed', 'received']).count()
        pct_partidas = (partidas_completas / total_partidas) * 100
    else:
        pct_partidas = 0

    # 30% weight: etapa de oportunidad
    pct_etapa = 0
    if proyecto.oportunidad and proyecto.oportunidad.etapa_corta:
        etapa = proyecto.oportunidad.etapa_corta
        # Map etapas to progress %
        etapa_map = {
            'En Solicitud': 5, 'Cotizando': 15, 'Enviada': 25, 'Seguimiento': 35,
            'Vendido s/PO': 45, 'Vendido c/PO': 55, 'En Tránsito': 65,
            'Facturado': 75, 'Programado': 80, 'Entregado': 85,
            'Esperando Pago': 90, 'Ganado': 95, 'Pagado': 100,
        }
        pct_etapa = etapa_map.get(etapa, 50)

    # 30% weight: programa de obra (actividades completadas)
    pct_programa = 0
    actividades = ProgramacionActividad.objects.filter(proyecto_key=f'proy_{proyecto.id}')
    total_acts = actividades.count()
    if total_acts > 0:
        # Activities with fecha in the past are considered "done"
        acts_pasadas = actividades.filter(fecha__lt=timezone.localdate()).count()
        pct_programa = (acts_pasadas / total_acts) * 100

    avance = (pct_partidas * 0.4) + (pct_etapa * 0.3) + (pct_programa * 0.3)

    # Cap: if oportunidad is not 'Pagado', max 95%
    if proyecto.oportunidad and proyecto.oportunidad.etapa_corta != 'Pagado':
        avance = min(avance, 95)

    return round(min(avance, 100), 1)


def _calcular_efectividad(proyecto):
    """Calcula % de efectividad. Empieza en 100% y baja por penalizaciones."""
    from .models import ProgramacionActividad

    efectividad = 100.0
    hoy = timezone.localdate()

    # -5% por cada tarea vencida no completada
    tareas_vencidas = proyecto.tareas_proyecto.filter(
        fecha_limite__lt=timezone.now()
    ).exclude(status__in=['completed', 'cancelled']).count()
    efectividad -= tareas_vencidas * 5

    # -5% si gastado > costo total presupuestado
    gastado = float(proyecto.ordenes_compra.exclude(status='cancelled').aggregate(t=Sum('monto_total'))['t'] or 0)
    costo_total = float(proyecto.partidas.aggregate(t=Sum('costo_total'))['t'] or 0)
    if costo_total > 0 and gastado > costo_total:
        efectividad -= 5

    # -3% por cada OC con precio_unitario > partida.costo_unitario
    for oc in proyecto.ordenes_compra.exclude(status='cancelled').select_related('partida'):
        if oc.partida and oc.precio_unitario and oc.partida.costo_unitario:
            if oc.precio_unitario > oc.partida.costo_unitario:
                efectividad -= 3

    # -10% si fecha actual > fecha_fin y oportunidad no está en Pagado
    if proyecto.fecha_fin and hoy > proyecto.fecha_fin:
        if not proyecto.oportunidad or proyecto.oportunidad.etapa_corta != 'Pagado':
            efectividad -= 10

    # -5% si programa de obra tiene actividades atrasadas
    acts_atrasadas = ProgramacionActividad.objects.filter(
        proyecto_key=f'proy_{proyecto.id}',
        fecha__lt=hoy
    ).count()
    # Only penalize if there are activities that should have happened
    if acts_atrasadas > 0:
        total_acts = ProgramacionActividad.objects.filter(proyecto_key=f'proy_{proyecto.id}').count()
        if total_acts > 0:
            # Check if there are future activities too (meaning project is ongoing)
            acts_futuras = ProgramacionActividad.objects.filter(
                proyecto_key=f'proy_{proyecto.id}',
                fecha__gte=hoy
            ).count()
            if acts_futuras == 0 and proyecto.status != 'completed':
                efectividad -= 5

    return round(max(0, min(100, efectividad)), 1)


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
        'oportunidad_etapa': p.oportunidad.etapa_corta if p.oportunidad else None,
        'oportunidad_etapa_color': p.oportunidad.etapa_color if p.oportunidad else None,
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
#  PROYECTOS DASHBOARD / FINANCIERO
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(["GET"])
def api_proyectos_dashboard(request):
    """KPIs agregados de todos los proyectos visibles, con filtro opcional por mes/año."""
    try:
        qs = _get_proyectos_qs(request.user)

        # Filtrar por mes/año de creación si se proporcionan
        mes = request.GET.get('mes', '')
        anio = request.GET.get('anio', '')
        if anio:
            try:
                qs = qs.filter(created_at__year=int(anio))
            except (ValueError, TypeError):
                pass
        if mes and mes != 'todos':
            try:
                qs = qs.filter(created_at__month=int(mes))
            except (ValueError, TypeError):
                pass

        # No filtrar solo activos — contar todos los del periodo
        activos = qs.filter(status='active')
        data = {
            'total_proyectos': qs.count(),
            'proyectos_ejecucion': activos.count(),
            'proyectos_programados': qs.filter(status='planning').count(),
            'proyectos_completados': qs.filter(status='completed').count(),
            'utilidad_total': float(
                qs.aggregate(t=Sum('partidas__ganancia'))['t'] or 0
            ),
            'costo_total': float(
                qs.aggregate(t=Sum('partidas__costo_total'))['t'] or 0
            ),
            'venta_total': float(
                qs.aggregate(t=Sum('partidas__precio_venta_total'))['t'] or 0
            ),
        }
        return JsonResponse({'success': True, 'data': data})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def api_proyectos_financiero(request):
    """Lista de proyectos con datos financieros agregados."""
    try:
        qs = _get_proyectos_qs(request.user)
        status_filter = request.GET.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        qs = qs.select_related('usuario').annotate(
            partidas_costo_total=Sum('partidas__costo_total'),
            partidas_venta_total=Sum('partidas__precio_venta_total'),
            partidas_ganancia=Sum('partidas__ganancia'),
        )

        proyectos = []
        for p in qs:
            costo = float(p.partidas_costo_total or 0)
            venta = float(p.partidas_venta_total or 0)
            utilidad = float(p.partidas_ganancia or 0)
            margen = (utilidad / venta * 100) if venta > 0 else 0.0
            proyectos.append({
                'id': p.id,
                'nombre': p.nombre,
                'cliente_nombre': p.cliente_nombre,
                'status': p.status,
                'utilidad_presupuestada': utilidad,
                'costo_total': costo,
                'venta_total': venta,
                'margen': round(margen, 2),
            })

        return JsonResponse({'success': True, 'data': proyectos})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


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
        total_costo=Sum('costo_total'),
        total_venta=Sum('precio_venta_total'),
        total_ganancia=Sum('ganancia'),
    )
    ingresos = proyecto.facturas_ingreso.aggregate(total=Sum('monto'))['total'] or Decimal('0')
    costos_prov = proyecto.facturas_proveedor.aggregate(total=Sum('monto'))['total'] or Decimal('0')
    gastos_aprobados = proyecto.gastos.filter(estado_aprobacion='approved').aggregate(total=Sum('monto'))['total'] or Decimal('0')
    utilidad_real = ingresos - costos_prov - gastos_aprobados
    margen = (utilidad_real / ingresos * 100) if ingresos > 0 else Decimal('0')

    d['kpis'] = {
        'total_costo_partidas': float(partidas_agg['total_costo'] or 0),
        'total_venta_partidas': float(partidas_agg['total_venta'] or 0),
        'utilidad_presupuestada': float(partidas_agg['total_ganancia'] or 0),
        'ingresos': float(ingresos),
        'costos_proveedor': float(costos_prov),
        'gastos_aprobados': float(gastos_aprobados),
        'utilidad_real': float(utilidad_real),
        'margen': float(margen),
        'alertas_pendientes': proyecto.alertas.filter(resuelta=False).count(),
        'tareas_pendientes': proyecto.tareas_proyecto.exclude(status__in=['completed', 'cancelled']).count(),
        'ordenes_compra_activas': proyecto.ordenes_compra.exclude(status='cancelled').count(),
        # Gastado: sum of OC montos (not cancelled)
        'gastado': float(proyecto.ordenes_compra.exclude(status='cancelled').aggregate(t=Sum('monto_total'))['t'] or 0),
        # Cobrado: sum of facturas ingreso
        'cobrado': float(proyecto.facturas_ingreso.aggregate(t=Sum('monto'))['t'] or 0),
        # KPIs operativos
        'avance_pct': _calcular_avance(proyecto),
        'efectividad_pct': _calcular_efectividad(proyecto),
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
        try:
            proyecto = Proyecto.objects.select_related('usuario', 'oportunidad').get(id=proyecto_id)
        except Exception:
            proyecto = Proyecto.objects.select_related('usuario').get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado'}, status=404)

    # Solo el creador del proyecto o el responsable de la oportunidad puede eliminar
    puede_eliminar = False
    if proyecto.usuario_id == request.user.id:
        puede_eliminar = True
    try:
        if proyecto.oportunidad and proyecto.oportunidad.usuario_id == request.user.id:
            puede_eliminar = True
    except Exception:
        pass
    if is_supervisor(request.user):
        puede_eliminar = True

    if not puede_eliminar:
        return JsonResponse({'ok': False, 'error': 'Solo el creador o supervisor puede eliminarlo'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'JSON invalido'}, status=400)

    motivo = (data.get('motivo') or '').strip()
    if not motivo:
        return JsonResponse({'ok': False, 'error': 'Debes documentar el motivo de eliminacion'}, status=400)

    proyecto_nombre = proyecto.nombre
    cliente_nombre = proyecto.cliente_nombre or ''
    usuario_nombre = (request.user.first_name + ' ' + request.user.last_name).strip() or request.user.username

    try:
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
    except Exception:
        pass  # No fallar si la notificacion no se puede crear

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

    partidas = list(proyecto.partidas.all())
    items = [_partida_to_dict(p) for p in partidas]

    # Calcular totales en Python (evita problemas con Sum/Decimal en MySQL)
    t_costo = Decimal('0')
    t_venta = Decimal('0')
    for p in partidas:
        cu = p.costo_unitario if p.costo_unitario else Decimal('0')
        vu = p.precio_venta_unitario if p.precio_venta_unitario else Decimal('0')
        q = p.cantidad if p.cantidad else Decimal('0')
        t_costo += cu * q
        t_venta += vu * q
        print(f'[PARTIDA] {p.descripcion[:30]} | cu={cu} vu={vu} q={q} | costo={cu*q} venta={vu*q} ganancia={(vu-cu)*q}')
    t_ganancia = t_venta - t_costo
    print(f'[TOTALES] costo={t_costo} venta={t_venta} ganancia={t_ganancia}')

    return JsonResponse({
        'success': True,
        'data': {
            'partidas': items,
            'totales': {
                'costo_total': float(t_costo),
                'precio_venta_total': float(t_venta),
                'ganancia': float(t_ganancia),
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

    # Usar utilidad_presupuestada del proyecto (viene del resumen del Excel)
    utilidad_presupuestada = proyecto.utilidad_presupuestada or Decimal('0')
    ingresos = proyecto.facturas_ingreso.aggregate(total=Sum('monto'))['total'] or Decimal('0')
    costos = proyecto.facturas_proveedor.aggregate(total=Sum('monto'))['total'] or Decimal('0')
    gastos = proyecto.gastos.filter(estado_aprobacion='approved').aggregate(total=Sum('monto'))['total'] or Decimal('0')

    utilidad_real = ingresos - costos - gastos
    costos_gastos = costos + gastos
    margen = (utilidad_real / ingresos * 100) if ingresos > 0 else Decimal('0')
    cobertura = (ingresos / costos_gastos * 100) if costos_gastos > 0 else Decimal('0')
    alertas_pendientes = proyecto.alertas.filter(resuelta=False).count()

    # KPIs operativos
    gastado = float(proyecto.ordenes_compra.exclude(status='cancelled').aggregate(t=Sum('monto_total'))['t'] or 0)
    cobrado = float(ingresos)

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
            'gastado': gastado,
            'cobrado': cobrado,
            'avance_pct': _calcular_avance(proyecto),
            'efectividad_pct': _calcular_efectividad(proyecto),
        },
    })


# ═══════════════════════════════════════════════════════════════
#  IMPORTAR EXCEL (Volumetria)
# ═══════════════════════════════════════════════════════════════

@login_required
@require_http_methods(['POST'])
def api_importar_excel(request):
    """Import volumetria Excel — specific format used by IAMET engineers.

    2-pass approach:
      Pass 1: Pre-scan to find MO cost/venta totals and summary ganancia.
      Pass 2: Import rows — material items get normal costo, MO VENTA items
              get proportionally-distributed costo, MO COST items are skipped.
    """
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
        wb = openpyxl.load_workbook(archivo, data_only=True)
        ws = wb.active

        # Get exchange rate USD->MXN
        exchange_rate = Decimal('19.50')  # fallback
        try:
            import urllib.request
            resp = urllib.request.urlopen('https://api.exchangerate-api.com/v4/latest/USD', timeout=5)
            import json as _json
            rates = _json.loads(resp.read())
            exchange_rate = Decimal(str(rates['rates'].get('MXN', 19.50)))
        except Exception:
            pass

        # Also try to get exchange rate from cell I4 which says "Moneda : Dolares 19.50"
        try:
            cell_i4 = str(ws.cell(4, 9).value or '')
            if 'dolar' in cell_i4.lower():
                import re
                match = re.search(r'[\d.]+', cell_i4.replace('Dolares', '').replace('dolares', ''))
                if match:
                    tc_from_excel = Decimal(match.group())
                    if tc_from_excel > 10:  # sanity check
                        exchange_rate = tc_from_excel
        except Exception:
            pass

        # Section category mapping
        SECTION_MAP = {
            'material': 'equipamiento',
            'equipamiento': 'equipamiento',
            'canalizacion': 'accesorios',
            'canalización': 'accesorios',
            'equipos de elevacion': 'equipamiento',
            'equipos de elevación': 'equipamiento',
            'accesorios': 'accesorios',
            'mano de obra': 'mano_obra',
        }

        # ─── PASS 1: Pre-scan for MO totals and summary ─────────────
        total_mo_venta = Decimal('0')
        total_mo_costo = Decimal('0')
        total_ganancia_resumen = Decimal('0')
        mo_cost_header_row = None  # Row of the cost section header

        for r in range(1, ws.max_row + 1):
            cell_a = str(ws.cell(r, 1).value or '').strip().lower()
            cell_d = str(ws.cell(r, 4).value or '').strip().lower()
            cell_e = str(ws.cell(r, 5).value or '').strip().lower()
            cell_h = ws.cell(r, 8).value
            cell_c3 = ws.cell(r, 3).value

            # "TOTAL MANO DE OBRA:" row — col H has total MO venta
            if 'total mano de obra' in cell_a or 'total mano de obra' in cell_d:
                total_mo_venta = _dec(cell_h)

            # "COSTO MANO DE OBRA:" row — col H has total MO cost
            if 'costo mano de obra' in cell_a or 'costo mano de obra' in cell_d:
                total_mo_costo = _dec(cell_h)

            # "Total de Ganancia" in the summary section
            if 'total de ganancia' in cell_a:
                total_ganancia_resumen = _dec(cell_c3)

            # Detect cost header: row with "Descripcion" in col D and "Costo unit"/"Costo unitario" in col E
            if cell_d in ('descripcion', 'descripción') and cell_e in ('costo unit', 'costo unitario'):
                mo_cost_header_row = r

        print(f'[IMPORT PRE-SCAN] MO venta={total_mo_venta}, MO costo={total_mo_costo}, '
              f'ganancia_resumen={total_ganancia_resumen}, cost_header_row={mo_cost_header_row}')

        # MO cost ratio: what fraction of MO venta is cost
        mo_cost_ratio = Decimal('0')
        if total_mo_venta > 0 and total_mo_costo > 0:
            mo_cost_ratio = (total_mo_costo / total_mo_venta).quantize(Decimal('0.000001'))

        # ─── Archive current partidas as a new version before importing ──
        existing_partidas = list(proyecto.partidas.all())
        if existing_partidas:
            last_version = ProyectoVolumetriaVersion.objects.filter(
                proyecto=proyecto
            ).order_by('-version').first()
            next_version = (last_version.version + 1) if last_version else 1

            snapshot = []
            snap_costo = Decimal('0')
            snap_venta = Decimal('0')
            for p in existing_partidas:
                cu = p.costo_unitario or Decimal('0')
                vu = p.precio_venta_unitario or Decimal('0')
                q = p.cantidad or Decimal('0')
                snap_costo += cu * q
                snap_venta += vu * q
                snapshot.append({
                    'categoria': p.categoria,
                    'descripcion': p.descripcion,
                    'marca': p.marca,
                    'numero_parte': p.numero_parte,
                    'cantidad': float(q),
                    'precio_lista': float(p.precio_lista or 0),
                    'descuento': float(p.descuento or 0),
                    'costo_unitario': float(cu),
                    'precio_venta_unitario': float(vu),
                    'ganancia': float((vu - cu) * q),
                    'proveedor': p.proveedor,
                    'status': p.status,
                })
            snap_ganancia = snap_venta - snap_costo
            snap_margen = (snap_ganancia / snap_venta * 100) if snap_venta > 0 else Decimal('0')

            ProyectoVolumetriaVersion.objects.create(
                proyecto=proyecto,
                version=next_version,
                archivo_nombre=archivo.name if hasattr(archivo, 'name') else '',
                subido_por=request.user,
                total_costo=snap_costo,
                total_venta=snap_venta,
                ganancia=snap_ganancia,
                margen=snap_margen,
                num_partidas=len(existing_partidas),
                partidas_json=snapshot,
            )

            # Delete old partidas
            proyecto.partidas.all().delete()

        # ─── PASS 2: Import rows with intelligence ──────────────────
        current_category = 'equipamiento'  # default
        items_created = 0
        errors = []
        total_venta = Decimal('0')
        total_costo = Decimal('0')
        in_mo_cost_zone = False  # True after "TOTAL MANO DE OBRA:" row

        # Detect summary section start
        summary_keywords = ['analisis de costos', 'análisis de costos', 'precio de lista',
                            'precio bajanet', 'ganancia de material', 'total de ganancia']

        for row_idx in range(6, ws.max_row + 1):
            try:
                # Read all cells
                col_a = ws.cell(row_idx, 1).value   # Marca
                col_b = ws.cell(row_idx, 2).value   # No. Parte
                col_c = ws.cell(row_idx, 3).value   # Cantidad
                col_d = ws.cell(row_idx, 4).value   # Descripcion
                col_e = ws.cell(row_idx, 5).value   # Precio Lista
                col_f = ws.cell(row_idx, 6).value   # Descuento
                col_g = ws.cell(row_idx, 7).value   # Unitario (venta)
                col_h = ws.cell(row_idx, 8).value   # Total (venta)
                col_i = ws.cell(row_idx, 9).value   # Desc costo
                col_j = ws.cell(row_idx, 10).value  # Unitario (costo)
                col_k = ws.cell(row_idx, 11).value  # Total (costo)

                col_a_str = str(col_a or '').strip().lower()
                col_d_str = str(col_d or '').strip().lower()

                # Check for summary section — STOP processing
                if any(kw in col_a_str for kw in summary_keywords) or \
                   any(kw in col_d_str for kw in summary_keywords):
                    break

                # Detect "TOTAL MANO DE OBRA:" row — everything after is MO cost zone
                if 'total mano de obra' in col_a_str or 'total mano de obra' in col_d_str:
                    in_mo_cost_zone = True
                    continue

                # Skip all rows in MO cost zone (Tecnico, combustible, casetas, etc.)
                if in_mo_cost_zone:
                    continue

                # Also skip rows that are clearly in the cost header zone
                if mo_cost_header_row and row_idx >= mo_cost_header_row:
                    continue

                # Check for section header
                if col_a and isinstance(col_a, str) and col_a.strip():
                    is_section = False
                    for section_name in SECTION_MAP:
                        if section_name in col_a_str:
                            current_category = SECTION_MAP[section_name]
                            is_section = True
                            break
                    if is_section:
                        continue

                if col_d and isinstance(col_d, str) and col_d.strip():
                    for section_name in SECTION_MAP:
                        if section_name in col_d_str:
                            current_category = SECTION_MAP[section_name]

                # Check for header rows (like "Marca | No. Parte | Cantidad | Descripcion...")
                if col_a_str in ('marca', '') and col_d_str in ('descripcion', 'descripción', ''):
                    if col_a_str == 'marca':
                        continue  # skip header row

                # Validate: must have quantity > 0 and description
                cantidad = None
                try:
                    if col_c is not None:
                        cantidad = Decimal(str(col_c))
                except (ValueError, InvalidOperation):
                    pass

                if not cantidad or cantidad <= 0:
                    continue

                descripcion = str(col_d or '').strip()
                if not descripcion:
                    continue

                # Skip if description is just a number (subtotal row)
                try:
                    float(descripcion.replace(',', ''))
                    continue  # it's a number, skip
                except ValueError:
                    pass

                # Skip "Total de..." rows
                if descripcion.lower().startswith('total de') or \
                   descripcion.lower().startswith('total '):
                    continue

                # Parse prices
                marca = str(col_a or '').strip()
                numero_parte = str(col_b or '').strip()

                precio_lista = _dec(col_e)
                descuento_dec = _dec(col_f)  # decimal like 0.3
                precio_venta_unit = _dec(col_g)
                costo_unit = _dec(col_j)
                total_venta_excel = _dec(col_h)
                total_costo_excel = _dec(col_k)

                # Determine if this is a MO VENTA item:
                # category is mano_obra AND has venta but no costo columns
                is_mo_venta = (
                    current_category == 'mano_obra'
                    and total_venta_excel > 0
                    and total_costo_excel == 0
                    and costo_unit == 0
                )

                if is_mo_venta:
                    # Distribute MO cost proportionally across MO venta items
                    # item_costo_total = item_venta_total * (total_mo_costo / total_mo_venta)
                    total_costo_excel = (total_venta_excel * mo_cost_ratio).quantize(Decimal('0.01'))
                    if cantidad > 0:
                        costo_unit = (total_costo_excel / cantidad).quantize(Decimal('0.01'))

                # Fallbacks (for material items)
                if precio_venta_unit == 0 and precio_lista > 0:
                    precio_venta_unit = precio_lista
                if total_venta_excel == 0 and precio_venta_unit > 0:
                    total_venta_excel = precio_venta_unit * cantidad
                if total_costo_excel == 0 and costo_unit > 0:
                    total_costo_excel = costo_unit * cantidad

                # Convert to MXN
                precio_lista_mxn = (precio_lista * exchange_rate).quantize(Decimal('0.01'))
                precio_venta_mxn = (precio_venta_unit * exchange_rate).quantize(Decimal('0.01'))
                costo_mxn = (costo_unit * exchange_rate).quantize(Decimal('0.01'))
                descuento_pct = (descuento_dec * Decimal('100')).quantize(Decimal('0.01'))

                venta_total = (total_venta_excel * exchange_rate).quantize(Decimal('0.01'))
                costo_total = (total_costo_excel * exchange_rate).quantize(Decimal('0.01'))
                ganancia = (venta_total - costo_total).quantize(Decimal('0.01'))

                ProyectoPartida.objects.create(
                    proyecto=proyecto,
                    categoria=current_category,
                    descripcion=descripcion,
                    marca=marca,
                    numero_parte=numero_parte,
                    cantidad=cantidad,
                    cantidad_pendiente=cantidad,
                    precio_lista=precio_lista_mxn,
                    descuento=descuento_pct,
                    costo_unitario=costo_mxn,
                    precio_venta_unitario=precio_venta_mxn,
                    costo_total=costo_total,
                    precio_venta_total=venta_total,
                    ganancia=ganancia,
                    proveedor=marca if marca else '',
                )
                items_created += 1
                total_venta += venta_total
                total_costo += costo_total

            except Exception as e:
                errors.append(f'Fila {row_idx}: {str(e)}')

        # ─── Read "Total de Ganancia" from summary ──────────────────
        ganancia_excel = Decimal('0')
        if total_ganancia_resumen > 0:
            ganancia_excel = total_ganancia_resumen * exchange_rate
        else:
            # Fallback: scan bottom of sheet
            for r in range(max(ws.max_row - 30, 1), ws.max_row + 1):
                cell_a = str(ws.cell(r, 1).value or '').strip().lower()
                if 'total de ganancia' in cell_a:
                    val = ws.cell(r, 3).value
                    if val:
                        try:
                            ganancia_excel = _dec(val) * exchange_rate
                        except Exception:
                            pass
                    break

        # Fallback: sum partidas ganancia if no summary found
        if ganancia_excel == 0:
            ganancia_excel = proyecto.partidas.aggregate(total=Sum('ganancia'))['total'] or Decimal('0')

        proyecto.utilidad_presupuestada = ganancia_excel.quantize(Decimal('0.01'))
        proyecto.save(update_fields=['utilidad_presupuestada'])
        print(f'[IMPORT] Utilidad guardada: {proyecto.utilidad_presupuestada} '
              f'(ganancia_excel={ganancia_excel}, mo_ratio={mo_cost_ratio})')

        ganancia_mxn = total_venta - total_costo

        return JsonResponse({
            'ok': True,
            'items_created': items_created,
            'total_venta_mxn': float(total_venta.quantize(Decimal('0.01'))),
            'total_costo_mxn': float(total_costo.quantize(Decimal('0.01'))),
            'ganancia_mxn': float(ganancia_mxn.quantize(Decimal('0.01'))),
            'exchange_rate': float(exchange_rate),
            'mo_venta': float(total_mo_venta),
            'mo_costo': float(total_mo_costo),
            'mo_cost_ratio': float(mo_cost_ratio),
            'errors': errors,
        })
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ─── Historial de versiones de volumetria ─────────────────────

@login_required
@require_http_methods(["GET"])
def api_volumetria_versiones(request, proyecto_id):
    """GET: Historial de versiones de volumetria"""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado'}, status=404)
    if not _check_access(request.user, proyecto):
        return JsonResponse({'ok': False, 'error': 'Sin acceso'}, status=403)

    versiones = ProyectoVolumetriaVersion.objects.filter(proyecto=proyecto).select_related('subido_por')
    data = []
    for v in versiones:
        data.append({
            'version': v.version,
            'archivo': v.archivo_nombre,
            'subido_por': (v.subido_por.first_name + ' ' + v.subido_por.last_name).strip() if v.subido_por else '—',
            'fecha': v.fecha.isoformat() if v.fecha else None,
            'total_costo': float(v.total_costo),
            'total_venta': float(v.total_venta),
            'ganancia': float(v.ganancia),
            'margen': float(v.margen),
            'num_partidas': v.num_partidas,
            'partidas_json': v.partidas_json or [],
        })

    # Add current version info
    current = list(proyecto.partidas.all())
    if current:
        c_costo = sum((p.costo_unitario or Decimal('0')) * (p.cantidad or Decimal('0')) for p in current)
        c_venta = sum((p.precio_venta_unitario or Decimal('0')) * (p.cantidad or Decimal('0')) for p in current)
        c_gan = c_venta - c_costo
        # Get last import info
        last_ver = versiones.first()  # ordered by -version
        last_user = ''
        last_date = None
        if last_ver:
            # The current is the one AFTER the last version
            last_user = (last_ver.subido_por.first_name + ' ' + last_ver.subido_por.last_name).strip() if last_ver.subido_por else '—'
            last_date = last_ver.fecha.isoformat() if last_ver.fecha else None
        data.insert(0, {
            'version': len(data) + 1,
            'archivo': 'Actual',
            'subido_por': last_user,
            'fecha': last_date,
            'total_costo': float(c_costo),
            'total_venta': float(c_venta),
            'ganancia': float(c_gan),
            'margen': float((c_gan / c_venta * 100) if c_venta > 0 else 0),
            'num_partidas': len(current),
            'is_current': True,
        })

    return JsonResponse({'ok': True, 'data': data})


@login_required
@require_http_methods(["POST"])
def api_restaurar_version(request, proyecto_id):
    """POST: Restaurar volumetria a una version anterior"""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado'}, status=404)
    if not _check_access(request.user, proyecto):
        return JsonResponse({'ok': False, 'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'ok': False, 'error': 'JSON invalido'}, status=400)

    version_num = data.get('version')
    if not version_num:
        return JsonResponse({'ok': False, 'error': 'Version requerida'}, status=400)

    try:
        version = ProyectoVolumetriaVersion.objects.get(proyecto=proyecto, version=version_num)
    except ProyectoVolumetriaVersion.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Version no encontrada'}, status=404)

    # Archive current partidas first
    existing = list(proyecto.partidas.all())
    if existing:
        last_ver = ProyectoVolumetriaVersion.objects.filter(proyecto=proyecto).order_by('-version').first()
        next_ver = (last_ver.version + 1) if last_ver else 1
        snapshot = []
        sc = Decimal('0')
        sv = Decimal('0')
        for p in existing:
            cu = p.costo_unitario or Decimal('0')
            vu = p.precio_venta_unitario or Decimal('0')
            q = p.cantidad or Decimal('0')
            sc += cu * q
            sv += vu * q
            snapshot.append({
                'categoria': p.categoria, 'descripcion': p.descripcion, 'marca': p.marca,
                'numero_parte': p.numero_parte, 'cantidad': float(q),
                'precio_lista': float(p.precio_lista or 0), 'descuento': float(p.descuento or 0),
                'costo_unitario': float(cu), 'precio_venta_unitario': float(vu),
                'ganancia': float((vu - cu) * q), 'proveedor': p.proveedor, 'status': p.status,
            })
        sg = sv - sc
        ProyectoVolumetriaVersion.objects.create(
            proyecto=proyecto, version=next_ver, archivo_nombre='Antes de restaurar v' + str(version_num),
            subido_por=request.user, total_costo=sc, total_venta=sv, ganancia=sg,
            margen=(sg / sv * 100) if sv > 0 else Decimal('0'),
            num_partidas=len(existing), partidas_json=snapshot,
        )
        proyecto.partidas.all().delete()

    # Restore partidas from version snapshot
    restored = 0
    for item in (version.partidas_json or []):
        ProyectoPartida.objects.create(
            proyecto=proyecto,
            categoria=item.get('categoria', 'otros'),
            descripcion=item.get('descripcion', ''),
            marca=item.get('marca', ''),
            numero_parte=item.get('numero_parte', ''),
            cantidad=Decimal(str(item.get('cantidad', 0))),
            cantidad_pendiente=Decimal(str(item.get('cantidad', 0))),
            precio_lista=Decimal(str(item.get('precio_lista', 0))),
            descuento=Decimal(str(item.get('descuento', 0))),
            costo_unitario=Decimal(str(item.get('costo_unitario', 0))),
            precio_venta_unitario=Decimal(str(item.get('precio_venta_unitario', 0))),
            proveedor=item.get('proveedor', ''),
        )
        restored += 1

    # Update project utilidad
    total_g = sum(
        ((p.precio_venta_unitario or Decimal('0')) - (p.costo_unitario or Decimal('0'))) * (p.cantidad or Decimal('0'))
        for p in proyecto.partidas.all()
    )
    proyecto.utilidad_presupuestada = total_g
    proyecto.save(update_fields=['utilidad_presupuestada'])

    return JsonResponse({'ok': True, 'restored': restored})

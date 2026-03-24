# ===============================================================
#  views_proyectos_iamet.py — APIs para el modulo Proyectos IAMET
#  Gestion de proyectos de telecomunicaciones
# ===============================================================

import json
import time
from datetime import date
from decimal import Decimal, InvalidOperation

from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.http import require_http_methods
from django.db.models import Sum, F, Q, DecimalField
from django.utils import timezone

from .models import (
    ProyectoIAMET as Proyecto, ProyectoPartida, ProyectoOrdenCompra,
    ProyectoFacturaProveedor, ProyectoFacturaIngreso,
    ProyectoGasto, ProyectoTarea, ProyectoAlerta,
    ProyectoConfiguracion, ProyectoEvidencia,
)
from .views_utils import is_supervisor
from .views_grupos import get_usuarios_visibles_ids


# --- Helpers ---------------------------------------------------

def _get_proyectos_qs(user):
    """Returns queryset of projects visible to this user."""
    if is_supervisor(user):
        return Proyecto.objects.all()
    vis_ids = get_usuarios_visibles_ids(user)
    if vis_ids is None:
        return Proyecto.objects.all()
    return Proyecto.objects.filter(usuario_id__in=vis_ids)


def _check_proyecto_access(user, proyecto):
    """Returns True if user can access this project."""
    if is_supervisor(user):
        return True
    vis_ids = get_usuarios_visibles_ids(user)
    if vis_ids is None:
        return True
    return proyecto.usuario_id in vis_ids


def _decimal(val, default=Decimal('0')):
    """Safe decimal conversion."""
    if val is None or val == '':
        return default
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError):
        return default


def _date_or_none(val):
    """Parse date string YYYY-MM-DD or return None."""
    if not val:
        return None
    try:
        parts = val.split('-')
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except Exception:
        return None


def _serialize_date(d):
    """Format date for JSON."""
    if d is None:
        return None
    return d.isoformat() if hasattr(d, 'isoformat') else str(d)


def _serialize_datetime(dt):
    """Format datetime for JSON."""
    if dt is None:
        return None
    return dt.isoformat() if hasattr(dt, 'isoformat') else str(dt)


def _user_name(user):
    if user is None:
        return ''
    return (user.first_name + ' ' + user.last_name).strip() or user.username


def _serialize_proyecto(p):
    return {
        'id': p.id,
        'usuario_id': p.usuario_id,
        'usuario_nombre': _user_name(p.usuario),
        'nombre': p.nombre,
        'descripcion': p.descripcion,
        'cliente_nombre': p.cliente_nombre,
        'status': p.status,
        'utilidad_presupuestada': str(p.utilidad_presupuestada),
        'utilidad_real': str(p.utilidad_real),
        'fecha_inicio': _serialize_date(p.fecha_inicio),
        'fecha_fin': _serialize_date(p.fecha_fin),
        'created_at': _serialize_datetime(p.created_at),
        'updated_at': _serialize_datetime(p.updated_at),
    }


def _serialize_partida(p):
    return {
        'id': p.id,
        'proyecto_id': p.proyecto_id,
        'categoria': p.categoria,
        'descripcion': p.descripcion,
        'marca': p.marca,
        'numero_parte': p.numero_parte,
        'cantidad': str(p.cantidad),
        'cantidad_pendiente': str(p.cantidad_pendiente),
        'precio_lista': str(p.precio_lista),
        'descuento': str(p.descuento),
        'costo_unitario': str(p.costo_unitario),
        'costo_total': str(p.costo_total),
        'precio_venta_unitario': str(p.precio_venta_unitario),
        'precio_venta_total': str(p.precio_venta_total),
        'ganancia': str(p.ganancia),
        'proveedor': p.proveedor,
        'status': p.status,
        'created_at': _serialize_datetime(p.created_at),
        'updated_at': _serialize_datetime(p.updated_at),
    }


def _serialize_oc(oc):
    return {
        'id': oc.id,
        'proyecto_id': oc.proyecto_id,
        'partida_id': oc.partida_id,
        'partida_descripcion': oc.partida.descripcion if oc.partida else '',
        'numero_oc': oc.numero_oc,
        'proveedor': oc.proveedor,
        'cantidad': str(oc.cantidad),
        'precio_unitario': str(oc.precio_unitario),
        'monto_total': str(oc.monto_total),
        'status': oc.status,
        'fecha_emision': _serialize_date(oc.fecha_emision),
        'fecha_entrega_esperada': _serialize_date(oc.fecha_entrega_esperada),
        'fecha_entrega_real': _serialize_date(oc.fecha_entrega_real),
        'notas': oc.notas,
        'created_at': _serialize_datetime(oc.created_at),
    }


def _serialize_factura_proveedor(f):
    return {
        'id': f.id,
        'proyecto_id': f.proyecto_id,
        'orden_compra_id': f.orden_compra_id,
        'numero_factura': f.numero_factura,
        'proveedor': f.proveedor,
        'monto': str(f.monto),
        'monto_presupuestado': str(f.monto_presupuestado) if f.monto_presupuestado else None,
        'varianza': str(f.varianza) if f.varianza is not None else None,
        'varianza_porcentaje': str(f.varianza_porcentaje) if f.varianza_porcentaje is not None else None,
        'fecha_factura': _serialize_date(f.fecha_factura),
        'fecha_vencimiento': _serialize_date(f.fecha_vencimiento),
        'fecha_pago': _serialize_date(f.fecha_pago),
        'status': f.status,
        'notas': f.notas,
        'archivo_url': f.archivo.url if f.archivo else None,
        'created_at': _serialize_datetime(f.created_at),
    }


def _serialize_factura_ingreso(f):
    return {
        'id': f.id,
        'proyecto_id': f.proyecto_id,
        'numero_factura': f.numero_factura,
        'monto': str(f.monto),
        'fecha_factura': _serialize_date(f.fecha_factura),
        'fecha_vencimiento': _serialize_date(f.fecha_vencimiento),
        'fecha_pago': _serialize_date(f.fecha_pago),
        'status': f.status,
        'metodo_pago': f.metodo_pago,
        'notas': f.notas,
        'archivo_url': f.archivo.url if f.archivo else None,
        'created_at': _serialize_datetime(f.created_at),
    }


def _serialize_gasto(g):
    return {
        'id': g.id,
        'proyecto_id': g.proyecto_id,
        'categoria': g.categoria,
        'descripcion': g.descripcion,
        'monto': str(g.monto),
        'monto_presupuestado': str(g.monto_presupuestado) if g.monto_presupuestado else None,
        'varianza': str(g.varianza) if g.varianza is not None else None,
        'fecha_gasto': _serialize_date(g.fecha_gasto),
        'estado_aprobacion': g.estado_aprobacion,
        'aprobado_por_id': g.aprobado_por_id,
        'aprobado_por_nombre': _user_name(g.aprobado_por) if g.aprobado_por else None,
        'fecha_aprobacion': _serialize_datetime(g.fecha_aprobacion),
        'notas': g.notas,
        'created_at': _serialize_datetime(g.created_at),
    }


def _serialize_tarea(t):
    return {
        'id': t.id,
        'proyecto_id': t.proyecto_id,
        'titulo': t.titulo,
        'descripcion': t.descripcion,
        'status': t.status,
        'prioridad': t.prioridad,
        'asignado_a_id': t.asignado_a_id,
        'asignado_a_nombre': _user_name(t.asignado_a) if t.asignado_a else None,
        'fecha_limite': _serialize_date(t.fecha_limite),
        'fecha_completada': _serialize_datetime(t.fecha_completada),
        'horas_estimadas': str(t.horas_estimadas) if t.horas_estimadas else None,
        'horas_reales': str(t.horas_reales) if t.horas_reales else None,
        'notas': t.notas,
        'created_at': _serialize_datetime(t.created_at),
    }


def _serialize_alerta(a):
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
        'fecha_resolucion': _serialize_datetime(a.fecha_resolucion),
        'created_at': _serialize_datetime(a.created_at),
    }


# ===============================================================
#  PROYECTOS --- CRUD
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_proyectos_lista(request):
    """GET: Lista de proyectos visibles para el usuario."""
    try:
        qs = _get_proyectos_qs(request.user).select_related('usuario')
        status_filter = request.GET.get('status', '')
        if status_filter:
            qs = qs.filter(status=status_filter)
        proyectos = [_serialize_proyecto(p) for p in qs]
        return JsonResponse({'ok': True, 'proyectos': proyectos})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_proyecto_crear(request):
    """POST: Crear nuevo proyecto + auto-create configuracion."""
    try:
        data = json.loads(request.body)
        nombre = data.get('nombre', '').strip()
        if not nombre:
            return JsonResponse({'ok': False, 'error': 'El nombre es obligatorio.'}, status=400)

        proyecto = Proyecto.objects.create(
            usuario=request.user,
            nombre=nombre,
            descripcion=data.get('descripcion', ''),
            cliente_nombre=data.get('cliente_nombre', ''),
            status=data.get('status', 'planning'),
            utilidad_presupuestada=_decimal(data.get('utilidad_presupuestada')),
            utilidad_real=_decimal(data.get('utilidad_real')),
            fecha_inicio=_date_or_none(data.get('fecha_inicio')),
            fecha_fin=_date_or_none(data.get('fecha_fin')),
        )
        # Auto-create project configuration
        ProyectoConfiguracion.objects.create(proyecto=proyecto)

        return JsonResponse({'ok': True, 'proyecto': _serialize_proyecto(proyecto)})
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['GET'])
def api_proyecto_detalle(request, proyecto_id):
    """GET: Detalle completo de un proyecto con KPIs calculados."""
    try:
        proyecto = Proyecto.objects.select_related('usuario').get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        result = _serialize_proyecto(proyecto)

        # Financials from partidas
        partidas_agg = ProyectoPartida.objects.filter(proyecto=proyecto).aggregate(
            total_costo=Sum('costo_total'),
            total_venta=Sum('precio_venta_total'),
            total_ganancia=Sum('ganancia'),
        )
        result['partidas_costo_total'] = str(partidas_agg['total_costo'] or Decimal('0'))
        result['partidas_venta_total'] = str(partidas_agg['total_venta'] or Decimal('0'))
        result['utilidad_presupuestada_calc'] = str(partidas_agg['total_ganancia'] or Decimal('0'))

        # Actuals
        ingresos = ProyectoFacturaIngreso.objects.filter(proyecto=proyecto).aggregate(
            total=Sum('monto'))['total'] or Decimal('0')
        costos = ProyectoFacturaProveedor.objects.filter(proyecto=proyecto).aggregate(
            total=Sum('monto'))['total'] or Decimal('0')
        gastos = ProyectoGasto.objects.filter(
            proyecto=proyecto, estado_aprobacion='approved').aggregate(
            total=Sum('monto'))['total'] or Decimal('0')

        utilidad_real = ingresos - costos - gastos
        margen = (utilidad_real / ingresos * 100) if ingresos > 0 else Decimal('0')

        result['ingresos_totales'] = str(ingresos)
        result['costos_totales'] = str(costos)
        result['gastos_totales'] = str(gastos)
        result['utilidad_real_calc'] = str(utilidad_real)
        result['margen'] = str(margen.quantize(Decimal('0.01')))

        # Counts
        result['num_partidas'] = ProyectoPartida.objects.filter(proyecto=proyecto).count()
        result['num_oc'] = ProyectoOrdenCompra.objects.filter(proyecto=proyecto).count()
        result['num_alertas_activas'] = ProyectoAlerta.objects.filter(
            proyecto=proyecto, resuelta=False).count()
        result['num_tareas_pendientes'] = ProyectoTarea.objects.filter(
            proyecto=proyecto, status__in=['pending', 'in_progress']).count()

        return JsonResponse({'ok': True, 'proyecto': result})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_proyecto_actualizar(request, proyecto_id):
    """POST: Actualizar campos del proyecto."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        data = json.loads(request.body)

        if 'nombre' in data:
            nombre = data['nombre'].strip()
            if not nombre:
                return JsonResponse({'ok': False, 'error': 'El nombre no puede estar vacio.'}, status=400)
            proyecto.nombre = nombre
        if 'descripcion' in data:
            proyecto.descripcion = data['descripcion']
        if 'cliente_nombre' in data:
            proyecto.cliente_nombre = data['cliente_nombre']
        if 'status' in data:
            proyecto.status = data['status']
        if 'utilidad_presupuestada' in data:
            proyecto.utilidad_presupuestada = _decimal(data['utilidad_presupuestada'])
        if 'utilidad_real' in data:
            proyecto.utilidad_real = _decimal(data['utilidad_real'])
        if 'fecha_inicio' in data:
            proyecto.fecha_inicio = _date_or_none(data['fecha_inicio'])
        if 'fecha_fin' in data:
            proyecto.fecha_fin = _date_or_none(data['fecha_fin'])

        proyecto.save()
        return JsonResponse({'ok': True, 'proyecto': _serialize_proyecto(proyecto)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_proyecto_eliminar(request, proyecto_id):
    """POST: Eliminar proyecto (solo owner o supervisor)."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if proyecto.usuario_id != request.user.id and not is_supervisor(request.user):
            return JsonResponse({'ok': False, 'error': 'Solo el propietario o un supervisor puede eliminar.'}, status=403)

        proyecto.delete()
        return JsonResponse({'ok': True})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  PARTIDAS (Line Items)
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_partidas_lista(request, proyecto_id):
    """GET: Partidas de un proyecto con totales."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        partidas = ProyectoPartida.objects.filter(proyecto=proyecto)
        data = [_serialize_partida(p) for p in partidas]

        totales = partidas.aggregate(
            total_costo=Sum('costo_total'),
            total_venta=Sum('precio_venta_total'),
            total_ganancia=Sum('ganancia'),
        )
        return JsonResponse({
            'ok': True,
            'partidas': data,
            'totales': {
                'costo': str(totales['total_costo'] or Decimal('0')),
                'venta': str(totales['total_venta'] or Decimal('0')),
                'ganancia': str(totales['total_ganancia'] or Decimal('0')),
            },
        })
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_partida_crear(request):
    """POST: Crear partida con auto-calculo de totales."""
    try:
        data = json.loads(request.body)
        proyecto_id = data.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'proyecto_id es obligatorio.'}, status=400)

        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        descripcion = data.get('descripcion', '').strip()
        if not descripcion:
            return JsonResponse({'ok': False, 'error': 'La descripcion es obligatoria.'}, status=400)

        cantidad = _decimal(data.get('cantidad'), Decimal('1'))

        partida = ProyectoPartida(
            proyecto=proyecto,
            categoria=data.get('categoria', 'equipamiento'),
            descripcion=descripcion,
            marca=data.get('marca', ''),
            numero_parte=data.get('numero_parte', ''),
            cantidad=cantidad,
            cantidad_pendiente=_decimal(data.get('cantidad_pendiente'), cantidad),
            precio_lista=_decimal(data.get('precio_lista')),
            descuento=_decimal(data.get('descuento')),
            costo_unitario=_decimal(data.get('costo_unitario')),
            precio_venta_unitario=_decimal(data.get('precio_venta_unitario')),
            proveedor=data.get('proveedor', ''),
            status=data.get('status', 'pending'),
        )
        # save() calls calcular_totales() automatically
        partida.save()

        return JsonResponse({'ok': True, 'partida': _serialize_partida(partida)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_partida_actualizar(request, partida_id):
    """POST: Actualizar partida."""
    try:
        partida = ProyectoPartida.objects.select_related('proyecto').get(id=partida_id)
        if not _check_proyecto_access(request.user, partida.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        data = json.loads(request.body)

        if 'categoria' in data:
            partida.categoria = data['categoria']
        if 'descripcion' in data:
            partida.descripcion = data['descripcion']
        if 'marca' in data:
            partida.marca = data['marca']
        if 'numero_parte' in data:
            partida.numero_parte = data['numero_parte']
        if 'cantidad' in data:
            partida.cantidad = _decimal(data['cantidad'], partida.cantidad)
        if 'cantidad_pendiente' in data:
            partida.cantidad_pendiente = _decimal(data['cantidad_pendiente'], partida.cantidad_pendiente)
        if 'precio_lista' in data:
            partida.precio_lista = _decimal(data['precio_lista'])
        if 'descuento' in data:
            partida.descuento = _decimal(data['descuento'])
        if 'costo_unitario' in data:
            partida.costo_unitario = _decimal(data['costo_unitario'])
        if 'precio_venta_unitario' in data:
            partida.precio_venta_unitario = _decimal(data['precio_venta_unitario'])
        if 'proveedor' in data:
            partida.proveedor = data['proveedor']
        if 'status' in data:
            partida.status = data['status']

        # save() recalculates totals
        partida.save()
        return JsonResponse({'ok': True, 'partida': _serialize_partida(partida)})
    except ProyectoPartida.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Partida no encontrada.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_partida_eliminar(request, partida_id):
    """POST: Eliminar partida."""
    try:
        partida = ProyectoPartida.objects.select_related('proyecto').get(id=partida_id)
        if not _check_proyecto_access(request.user, partida.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        partida.delete()
        return JsonResponse({'ok': True})
    except ProyectoPartida.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Partida no encontrada.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  ORDENES DE COMPRA
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_oc_lista(request, proyecto_id):
    """GET: Ordenes de compra de un proyecto."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        ocs = ProyectoOrdenCompra.objects.filter(
            proyecto=proyecto).select_related('partida')
        data = [_serialize_oc(oc) for oc in ocs]
        return JsonResponse({'ok': True, 'ordenes_compra': data})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_oc_crear(request):
    """POST: Crear OC + deducir cantidad_pendiente de la partida."""
    try:
        data = json.loads(request.body)
        proyecto_id = data.get('proyecto_id')
        partida_id = data.get('partida_id')
        if not proyecto_id or not partida_id:
            return JsonResponse({'ok': False, 'error': 'proyecto_id y partida_id son obligatorios.'}, status=400)

        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        partida = ProyectoPartida.objects.get(id=partida_id, proyecto=proyecto)

        cantidad = _decimal(data.get('cantidad'), Decimal('0'))
        if cantidad <= 0:
            return JsonResponse({'ok': False, 'error': 'La cantidad debe ser mayor a 0.'}, status=400)

        if cantidad > partida.cantidad_pendiente:
            return JsonResponse({
                'ok': False,
                'error': f'Cantidad solicitada ({cantidad}) excede la pendiente ({partida.cantidad_pendiente}).',
            }, status=400)

        precio_unitario = _decimal(data.get('precio_unitario'), Decimal('0'))
        proveedor = data.get('proveedor', '').strip()
        if not proveedor:
            return JsonResponse({'ok': False, 'error': 'El proveedor es obligatorio.'}, status=400)

        oc = ProyectoOrdenCompra(
            proyecto=proyecto,
            partida=partida,
            numero_oc=data.get('numero_oc', ''),
            proveedor=proveedor,
            cantidad=cantidad,
            precio_unitario=precio_unitario,
            status=data.get('status', 'draft'),
            fecha_emision=_date_or_none(data.get('fecha_emision')),
            fecha_entrega_esperada=_date_or_none(data.get('fecha_entrega_esperada')),
            fecha_entrega_real=_date_or_none(data.get('fecha_entrega_real')),
            notas=data.get('notas', ''),
        )
        # save() auto-calculates monto_total and generates numero_oc if empty
        oc.save()

        # Deduct from partida pending quantity
        partida.cantidad_pendiente -= cantidad
        if partida.cantidad_pendiente <= 0:
            partida.cantidad_pendiente = Decimal('0')
            partida.status = 'closed'
        partida.save()

        return JsonResponse({'ok': True, 'orden_compra': _serialize_oc(oc)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except ProyectoPartida.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Partida no encontrada en este proyecto.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_oc_actualizar(request, oc_id):
    """POST: Actualizar OC."""
    try:
        oc = ProyectoOrdenCompra.objects.select_related('proyecto', 'partida').get(id=oc_id)
        if not _check_proyecto_access(request.user, oc.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        data = json.loads(request.body)

        if 'proveedor' in data:
            oc.proveedor = data['proveedor']
        if 'cantidad' in data:
            oc.cantidad = _decimal(data['cantidad'], oc.cantidad)
        if 'precio_unitario' in data:
            oc.precio_unitario = _decimal(data['precio_unitario'], oc.precio_unitario)
        if 'status' in data:
            oc.status = data['status']
        if 'fecha_emision' in data:
            oc.fecha_emision = _date_or_none(data['fecha_emision'])
        if 'fecha_entrega_esperada' in data:
            oc.fecha_entrega_esperada = _date_or_none(data['fecha_entrega_esperada'])
        if 'fecha_entrega_real' in data:
            oc.fecha_entrega_real = _date_or_none(data['fecha_entrega_real'])
        if 'notas' in data:
            oc.notas = data['notas']

        # save() recalculates monto_total
        oc.save()
        return JsonResponse({'ok': True, 'orden_compra': _serialize_oc(oc)})
    except ProyectoOrdenCompra.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Orden de compra no encontrada.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  FACTURAS PROVEEDOR
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_facturas_proveedor_lista(request, proyecto_id):
    """GET: Facturas de proveedor de un proyecto."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        facturas = ProyectoFacturaProveedor.objects.filter(proyecto=proyecto)
        data = [_serialize_factura_proveedor(f) for f in facturas]
        total = facturas.aggregate(total=Sum('monto'))['total'] or Decimal('0')
        return JsonResponse({'ok': True, 'facturas': data, 'total': str(total)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_factura_proveedor_crear(request):
    """POST: Crear factura proveedor con auto-calculo de varianza."""
    try:
        data = json.loads(request.body)
        proyecto_id = data.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'proyecto_id es obligatorio.'}, status=400)

        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        numero_factura = data.get('numero_factura', '').strip()
        if not numero_factura:
            return JsonResponse({'ok': False, 'error': 'numero_factura es obligatorio.'}, status=400)

        proveedor = data.get('proveedor', '').strip()
        if not proveedor:
            return JsonResponse({'ok': False, 'error': 'El proveedor es obligatorio.'}, status=400)

        fecha_factura = _date_or_none(data.get('fecha_factura'))
        if not fecha_factura:
            return JsonResponse({'ok': False, 'error': 'fecha_factura es obligatoria.'}, status=400)

        monto = _decimal(data.get('monto'))
        monto_presupuestado = _decimal(data.get('monto_presupuestado')) or None

        orden_compra_id = data.get('orden_compra_id')
        orden_compra = None
        if orden_compra_id:
            try:
                orden_compra = ProyectoOrdenCompra.objects.get(id=orden_compra_id, proyecto=proyecto)
            except ProyectoOrdenCompra.DoesNotExist:
                return JsonResponse({'ok': False, 'error': 'Orden de compra no encontrada.'}, status=404)

        factura = ProyectoFacturaProveedor(
            proyecto=proyecto,
            orden_compra=orden_compra,
            numero_factura=numero_factura,
            proveedor=proveedor,
            monto=monto,
            monto_presupuestado=monto_presupuestado,
            fecha_factura=fecha_factura,
            fecha_vencimiento=_date_or_none(data.get('fecha_vencimiento')),
            fecha_pago=_date_or_none(data.get('fecha_pago')),
            status=data.get('status', 'pending'),
            notas=data.get('notas', ''),
        )
        # save() auto-calculates varianza and varianza_porcentaje
        factura.save()

        # Auto-create alert if variance > threshold (default 5%)
        if factura.varianza_porcentaje is not None and factura.varianza_porcentaje > Decimal('5'):
            try:
                config = ProyectoConfiguracion.objects.get(proyecto=proyecto)
                threshold = config.umbral_alerta_varianza
            except ProyectoConfiguracion.DoesNotExist:
                threshold = Decimal('5')

            if factura.varianza_porcentaje > threshold:
                ProyectoAlerta.objects.create(
                    proyecto=proyecto,
                    tipo_alerta='budget_variance',
                    severidad='warning' if factura.varianza_porcentaje <= 15 else 'critical',
                    titulo=f'Varianza en factura {factura.numero_factura}',
                    mensaje=(
                        f'La factura {factura.numero_factura} de {factura.proveedor} tiene una '
                        f'varianza de {factura.varianza_porcentaje}% respecto al presupuesto.'
                    ),
                    entidad_tipo='factura_proveedor',
                    entidad_id=factura.id,
                )

        return JsonResponse({'ok': True, 'factura': _serialize_factura_proveedor(factura)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_factura_proveedor_actualizar(request, factura_id):
    """POST: Actualizar factura de proveedor."""
    try:
        factura = ProyectoFacturaProveedor.objects.select_related('proyecto').get(id=factura_id)
        if not _check_proyecto_access(request.user, factura.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        data = json.loads(request.body)

        if 'numero_factura' in data:
            factura.numero_factura = data['numero_factura']
        if 'proveedor' in data:
            factura.proveedor = data['proveedor']
        if 'monto' in data:
            factura.monto = _decimal(data['monto'], factura.monto)
        if 'monto_presupuestado' in data:
            factura.monto_presupuestado = _decimal(data['monto_presupuestado']) or None
        if 'fecha_factura' in data:
            factura.fecha_factura = _date_or_none(data['fecha_factura']) or factura.fecha_factura
        if 'fecha_vencimiento' in data:
            factura.fecha_vencimiento = _date_or_none(data['fecha_vencimiento'])
        if 'fecha_pago' in data:
            factura.fecha_pago = _date_or_none(data['fecha_pago'])
        if 'status' in data:
            factura.status = data['status']
        if 'notas' in data:
            factura.notas = data['notas']
        if 'orden_compra_id' in data:
            oc_id = data['orden_compra_id']
            if oc_id:
                try:
                    factura.orden_compra = ProyectoOrdenCompra.objects.get(
                        id=oc_id, proyecto=factura.proyecto)
                except ProyectoOrdenCompra.DoesNotExist:
                    return JsonResponse({'ok': False, 'error': 'OC no encontrada.'}, status=404)
            else:
                factura.orden_compra = None

        # save() recalculates varianza
        factura.save()
        return JsonResponse({'ok': True, 'factura': _serialize_factura_proveedor(factura)})
    except ProyectoFacturaProveedor.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Factura no encontrada.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  FACTURAS INGRESO
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_facturas_ingreso_lista(request, proyecto_id):
    """GET: Facturas de ingreso de un proyecto."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        facturas = ProyectoFacturaIngreso.objects.filter(proyecto=proyecto)
        data = [_serialize_factura_ingreso(f) for f in facturas]
        total = facturas.aggregate(total=Sum('monto'))['total'] or Decimal('0')
        return JsonResponse({'ok': True, 'facturas': data, 'total': str(total)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_factura_ingreso_crear(request):
    """POST: Crear factura de ingreso."""
    try:
        data = json.loads(request.body)
        proyecto_id = data.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'proyecto_id es obligatorio.'}, status=400)

        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        numero_factura = data.get('numero_factura', '').strip()
        if not numero_factura:
            return JsonResponse({'ok': False, 'error': 'numero_factura es obligatorio.'}, status=400)

        fecha_factura = _date_or_none(data.get('fecha_factura'))
        if not fecha_factura:
            return JsonResponse({'ok': False, 'error': 'fecha_factura es obligatoria.'}, status=400)

        monto = _decimal(data.get('monto'))

        factura = ProyectoFacturaIngreso.objects.create(
            proyecto=proyecto,
            numero_factura=numero_factura,
            monto=monto,
            fecha_factura=fecha_factura,
            fecha_vencimiento=_date_or_none(data.get('fecha_vencimiento')),
            fecha_pago=_date_or_none(data.get('fecha_pago')),
            status=data.get('status', 'emitted'),
            metodo_pago=data.get('metodo_pago', ''),
            notas=data.get('notas', ''),
        )

        return JsonResponse({'ok': True, 'factura': _serialize_factura_ingreso(factura)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_factura_ingreso_actualizar(request, factura_id):
    """POST: Actualizar factura de ingreso."""
    try:
        factura = ProyectoFacturaIngreso.objects.select_related('proyecto').get(id=factura_id)
        if not _check_proyecto_access(request.user, factura.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        data = json.loads(request.body)

        if 'numero_factura' in data:
            factura.numero_factura = data['numero_factura']
        if 'monto' in data:
            factura.monto = _decimal(data['monto'], factura.monto)
        if 'fecha_factura' in data:
            factura.fecha_factura = _date_or_none(data['fecha_factura']) or factura.fecha_factura
        if 'fecha_vencimiento' in data:
            factura.fecha_vencimiento = _date_or_none(data['fecha_vencimiento'])
        if 'fecha_pago' in data:
            factura.fecha_pago = _date_or_none(data['fecha_pago'])
        if 'status' in data:
            factura.status = data['status']
        if 'metodo_pago' in data:
            factura.metodo_pago = data['metodo_pago']
        if 'notas' in data:
            factura.notas = data['notas']

        factura.save()
        return JsonResponse({'ok': True, 'factura': _serialize_factura_ingreso(factura)})
    except ProyectoFacturaIngreso.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Factura no encontrada.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  GASTOS OPERATIVOS
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_gastos_lista(request, proyecto_id):
    """GET: Gastos operativos de un proyecto."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        gastos = ProyectoGasto.objects.filter(proyecto=proyecto).select_related('aprobado_por')
        data = [_serialize_gasto(g) for g in gastos]

        totales = gastos.aggregate(total=Sum('monto'))
        total_aprobado = gastos.filter(estado_aprobacion='approved').aggregate(
            total=Sum('monto'))['total'] or Decimal('0')
        return JsonResponse({
            'ok': True,
            'gastos': data,
            'total': str(totales['total'] or Decimal('0')),
            'total_aprobado': str(total_aprobado),
        })
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_gasto_crear(request):
    """POST: Crear gasto operativo."""
    try:
        data = json.loads(request.body)
        proyecto_id = data.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'proyecto_id es obligatorio.'}, status=400)

        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        descripcion = data.get('descripcion', '').strip()
        if not descripcion:
            return JsonResponse({'ok': False, 'error': 'La descripcion es obligatoria.'}, status=400)

        fecha_gasto = _date_or_none(data.get('fecha_gasto'))
        if not fecha_gasto:
            return JsonResponse({'ok': False, 'error': 'fecha_gasto es obligatoria.'}, status=400)

        monto = _decimal(data.get('monto'))
        monto_presupuestado = _decimal(data.get('monto_presupuestado')) or None

        gasto = ProyectoGasto(
            proyecto=proyecto,
            categoria=data.get('categoria', 'other'),
            descripcion=descripcion,
            monto=monto,
            monto_presupuestado=monto_presupuestado,
            fecha_gasto=fecha_gasto,
            notas=data.get('notas', ''),
        )
        # save() calculates varianza if monto_presupuestado is set
        gasto.save()

        return JsonResponse({'ok': True, 'gasto': _serialize_gasto(gasto)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_gasto_actualizar(request, gasto_id):
    """POST: Actualizar gasto operativo."""
    try:
        gasto = ProyectoGasto.objects.select_related('proyecto').get(id=gasto_id)
        if not _check_proyecto_access(request.user, gasto.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        data = json.loads(request.body)

        if 'categoria' in data:
            gasto.categoria = data['categoria']
        if 'descripcion' in data:
            gasto.descripcion = data['descripcion']
        if 'monto' in data:
            gasto.monto = _decimal(data['monto'], gasto.monto)
        if 'monto_presupuestado' in data:
            gasto.monto_presupuestado = _decimal(data['monto_presupuestado']) or None
        if 'fecha_gasto' in data:
            gasto.fecha_gasto = _date_or_none(data['fecha_gasto']) or gasto.fecha_gasto
        if 'notas' in data:
            gasto.notas = data['notas']

        # save() recalculates varianza
        gasto.save()
        return JsonResponse({'ok': True, 'gasto': _serialize_gasto(gasto)})
    except ProyectoGasto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Gasto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_gasto_aprobar(request, gasto_id):
    """POST: Aprobar/rechazar gasto (solo supervisor)."""
    try:
        if not is_supervisor(request.user):
            return JsonResponse({'ok': False, 'error': 'Solo supervisores pueden aprobar gastos.'}, status=403)

        gasto = ProyectoGasto.objects.select_related('proyecto').get(id=gasto_id)

        data = json.loads(request.body)
        accion = data.get('accion', '')  # 'approved' or 'rejected'
        if accion not in ('approved', 'rejected'):
            return JsonResponse({'ok': False, 'error': 'Accion debe ser "approved" o "rejected".'}, status=400)

        gasto.estado_aprobacion = accion
        gasto.aprobado_por = request.user
        gasto.fecha_aprobacion = timezone.now()
        gasto.save()

        return JsonResponse({'ok': True, 'gasto': _serialize_gasto(gasto)})
    except ProyectoGasto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Gasto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  TAREAS DE PROYECTO
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_tareas_proyecto_lista(request, proyecto_id):
    """GET: Tareas de un proyecto."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        tareas = ProyectoTarea.objects.filter(
            proyecto=proyecto).select_related('asignado_a')

        status_filter = request.GET.get('status', '')
        if status_filter:
            tareas = tareas.filter(status=status_filter)

        data = [_serialize_tarea(t) for t in tareas]
        return JsonResponse({'ok': True, 'tareas': data})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_tarea_proyecto_crear(request):
    """POST: Crear tarea de proyecto."""
    try:
        data = json.loads(request.body)
        proyecto_id = data.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'proyecto_id es obligatorio.'}, status=400)

        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        titulo = data.get('titulo', '').strip()
        if not titulo:
            return JsonResponse({'ok': False, 'error': 'El titulo es obligatorio.'}, status=400)

        asignado_a = None
        asignado_a_id = data.get('asignado_a_id')
        if asignado_a_id:
            try:
                asignado_a = User.objects.get(id=asignado_a_id)
            except User.DoesNotExist:
                return JsonResponse({'ok': False, 'error': 'Usuario asignado no encontrado.'}, status=404)

        tarea = ProyectoTarea.objects.create(
            proyecto=proyecto,
            titulo=titulo,
            descripcion=data.get('descripcion', ''),
            status=data.get('status', 'pending'),
            prioridad=data.get('prioridad', 'medium'),
            asignado_a=asignado_a,
            fecha_limite=_date_or_none(data.get('fecha_limite')),
            horas_estimadas=_decimal(data.get('horas_estimadas')) or None,
            horas_reales=_decimal(data.get('horas_reales')) or None,
            notas=data.get('notas', ''),
        )

        return JsonResponse({'ok': True, 'tarea': _serialize_tarea(tarea)})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_tarea_proyecto_actualizar(request, tarea_id):
    """POST: Actualizar tarea de proyecto."""
    try:
        tarea = ProyectoTarea.objects.select_related('proyecto').get(id=tarea_id)
        if not _check_proyecto_access(request.user, tarea.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        data = json.loads(request.body)

        if 'titulo' in data:
            tarea.titulo = data['titulo']
        if 'descripcion' in data:
            tarea.descripcion = data['descripcion']
        if 'prioridad' in data:
            tarea.prioridad = data['prioridad']
        if 'notas' in data:
            tarea.notas = data['notas']
        if 'horas_estimadas' in data:
            tarea.horas_estimadas = _decimal(data['horas_estimadas']) or None
        if 'horas_reales' in data:
            tarea.horas_reales = _decimal(data['horas_reales']) or None
        if 'fecha_limite' in data:
            tarea.fecha_limite = _date_or_none(data['fecha_limite'])

        if 'asignado_a_id' in data:
            aid = data['asignado_a_id']
            if aid:
                try:
                    tarea.asignado_a = User.objects.get(id=aid)
                except User.DoesNotExist:
                    return JsonResponse({'ok': False, 'error': 'Usuario asignado no encontrado.'}, status=404)
            else:
                tarea.asignado_a = None

        if 'status' in data:
            new_status = data['status']
            if new_status == 'completed' and tarea.status != 'completed':
                tarea.fecha_completada = timezone.now()
            elif new_status != 'completed':
                tarea.fecha_completada = None
            tarea.status = new_status

        tarea.save()
        return JsonResponse({'ok': True, 'tarea': _serialize_tarea(tarea)})
    except ProyectoTarea.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Tarea no encontrada.'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON invalido.'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  ALERTAS
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_alertas_lista(request, proyecto_id):
    """GET: Alertas no resueltas de un proyecto."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        alertas = ProyectoAlerta.objects.filter(proyecto=proyecto, resuelta=False)
        data = [_serialize_alerta(a) for a in alertas]
        return JsonResponse({'ok': True, 'alertas': data})
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(['POST'])
def api_alerta_resolver(request, alerta_id):
    """POST: Marcar alerta como resuelta."""
    try:
        alerta = ProyectoAlerta.objects.select_related('proyecto').get(id=alerta_id)
        if not _check_proyecto_access(request.user, alerta.proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        alerta.resuelta = True
        alerta.fecha_resolucion = timezone.now()
        alerta.save()

        return JsonResponse({'ok': True, 'alerta': _serialize_alerta(alerta)})
    except ProyectoAlerta.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Alerta no encontrada.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ===============================================================
#  FINANCIEROS (Dashboard KPIs)
# ===============================================================

@login_required
@require_http_methods(['GET'])
def api_proyecto_financieros(request, proyecto_id):
    """GET: Calcula metricas financieras del proyecto en tiempo real."""
    try:
        proyecto = Proyecto.objects.get(id=proyecto_id)
        if not _check_proyecto_access(request.user, proyecto):
            return JsonResponse({'ok': False, 'error': 'Sin permiso.'}, status=403)

        # Utilidad presupuestada = sum of partida.ganancia
        utilidad_presupuestada = ProyectoPartida.objects.filter(
            proyecto=proyecto).aggregate(
            total=Sum('ganancia'))['total'] or Decimal('0')

        # Ingresos totales = sum of facturas ingreso
        ingresos_totales = ProyectoFacturaIngreso.objects.filter(
            proyecto=proyecto).aggregate(
            total=Sum('monto'))['total'] or Decimal('0')

        # Costos totales = sum of facturas proveedor
        costos_totales = ProyectoFacturaProveedor.objects.filter(
            proyecto=proyecto).aggregate(
            total=Sum('monto'))['total'] or Decimal('0')

        # Gastos totales = sum of gastos aprobados
        gastos_totales = ProyectoGasto.objects.filter(
            proyecto=proyecto, estado_aprobacion='approved').aggregate(
            total=Sum('monto'))['total'] or Decimal('0')

        # Utilidad real = ingresos - costos - gastos
        utilidad_real = ingresos_totales - costos_totales - gastos_totales

        # Margen = (utilidad_real / ingresos) * 100
        if ingresos_totales > 0:
            margen = (utilidad_real / ingresos_totales * 100).quantize(Decimal('0.01'))
        else:
            margen = Decimal('0')

        # Cobertura de costos = (ingresos / (costos + gastos)) * 100
        total_egresos = costos_totales + gastos_totales
        if total_egresos > 0:
            cobertura_costos = (ingresos_totales / total_egresos * 100).quantize(Decimal('0.01'))
        else:
            cobertura_costos = Decimal('0')

        # Totals from partidas
        partidas_agg = ProyectoPartida.objects.filter(proyecto=proyecto).aggregate(
            total_costo=Sum('costo_total'),
            total_venta=Sum('precio_venta_total'),
        )

        return JsonResponse({
            'ok': True,
            'financieros': {
                'utilidad_presupuestada': str(utilidad_presupuestada),
                'ingresos_totales': str(ingresos_totales),
                'costos_totales': str(costos_totales),
                'gastos_totales': str(gastos_totales),
                'utilidad_real': str(utilidad_real),
                'margen': str(margen),
                'cobertura_costos': str(cobertura_costos),
                'partidas_costo_total': str(partidas_agg['total_costo'] or Decimal('0')),
                'partidas_venta_total': str(partidas_agg['total_venta'] or Decimal('0')),
            },
        })
    except Proyecto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Proyecto no encontrado.'}, status=404)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

"""Vistas de Eventos de Marketing.

CRUD JSON sobre Evento y EventoAsistente. La lista se renderiza server-side
desde `views_crm.crm_home` (cuando tab=prospeccion + vista=eventos); este
módulo expone las APIs para crear/editar/eliminar/listar y para manejar
asistentes.
"""
import json

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from .models import Cliente, Evento, EventoAsistente, Prospecto
from .views_utils import is_ingeniero


def _access_ok(user):
    """Marketing no es visible para ingenieros."""
    return not is_ingeniero(user)


def _evento_to_dict(e):
    return {
        'id': e.id,
        'nombre': e.nombre,
        'tipo': e.tipo,
        'tipo_display': e.get_tipo_display(),
        'estado': e.estado,
        'estado_display': e.get_estado_display(),
        'fecha_evento': e.fecha_evento.isoformat() if e.fecha_evento else None,
        'fecha_evento_display': e.fecha_evento.strftime('%d %b %Y · %H:%M') if e.fecha_evento else '',
        'duracion_minutos': e.duracion_minutos,
        'ubicacion': e.ubicacion,
        'descripcion': e.descripcion,
        'marcas': e.marcas or [],
        'costo': float(e.costo or 0),
        'notas_post': e.notas_post,
        'organizador_id': e.organizador_id,
        'organizador_nombre': (e.organizador.get_full_name() or e.organizador.username) if e.organizador else '',
        'asistentes_count': e.asistentes.count(),
    }


def _asistente_to_dict(a):
    if a.cliente_id:
        nombre = a.cliente.nombre_empresa
        kind = 'cliente'
    elif a.prospecto_id:
        nombre = a.prospecto.nombre
        kind = 'prospecto'
    else:
        nombre = a.contacto_nombre
        kind = 'contacto'
    return {
        'id': a.id,
        'kind': kind,
        'cliente_id': a.cliente_id,
        'prospecto_id': a.prospecto_id,
        'contacto_nombre': a.contacto_nombre,
        'contacto_email': a.contacto_email,
        'nombre_display': nombre,
        'confirmado': a.confirmado,
        'asistio': a.asistio,
        'notas': a.notas,
    }


@login_required
@require_http_methods(['GET'])
def api_eventos_list(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    qs = Evento.objects.select_related('organizador').prefetch_related('asistentes')
    mes = request.GET.get('mes', '')
    anio = request.GET.get('anio', '')
    estado = request.GET.get('estado', '')
    if mes and mes != 'todos':
        try:
            qs = qs.filter(fecha_evento__month=int(mes))
        except ValueError:
            pass
    if anio and anio != 'todos':
        try:
            qs = qs.filter(fecha_evento__year=int(anio))
        except ValueError:
            pass
    if estado:
        qs = qs.filter(estado=estado)
    return JsonResponse({'eventos': [_evento_to_dict(e) for e in qs.order_by('-fecha_evento')]})


@login_required
@require_http_methods(['GET'])
def api_evento_detalle(request, evento_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    e = get_object_or_404(
        Evento.objects.select_related('organizador')
                      .prefetch_related('asistentes__cliente', 'asistentes__prospecto'),
        id=evento_id,
    )
    return JsonResponse({
        'evento': _evento_to_dict(e),
        'asistentes': [_asistente_to_dict(a) for a in e.asistentes.all()],
    })


@login_required
@require_http_methods(['POST'])
def api_evento_crear(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    fecha_str = (data.get('fecha_evento') or '').strip()
    if not nombre:
        return JsonResponse({'error': 'El nombre es requerido'}, status=400)
    fecha_dt = parse_datetime(fecha_str) if fecha_str else None
    if not fecha_dt:
        return JsonResponse({'error': 'Fecha y hora son requeridas'}, status=400)

    organizador_id = data.get('organizador_id') or request.user.id
    organizador = User.objects.filter(id=organizador_id).first() or request.user

    try:
        duracion = int(data.get('duracion_minutos') or 60)
    except (TypeError, ValueError):
        duracion = 60
    try:
        costo = data.get('costo')
        costo = 0 if costo in (None, '') else costo
    except Exception:
        costo = 0

    e = Evento.objects.create(
        nombre=nombre,
        tipo=data.get('tipo') or 'presencial',
        estado=data.get('estado') or 'programado',
        fecha_evento=fecha_dt,
        duracion_minutos=duracion,
        ubicacion=(data.get('ubicacion') or '').strip(),
        descripcion=(data.get('descripcion') or '').strip(),
        marcas=data.get('marcas') or [],
        costo=costo,
        organizador=organizador,
        creado_por=request.user,
    )
    return JsonResponse({'ok': True, 'evento': _evento_to_dict(e)})


@login_required
@require_http_methods(['POST'])
def api_evento_editar(request, evento_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    e = get_object_or_404(Evento, id=evento_id)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    if 'nombre' in data:
        v = (data['nombre'] or '').strip()
        if v:
            e.nombre = v
    if 'tipo' in data and data['tipo']:
        e.tipo = data['tipo']
    if 'estado' in data and data['estado']:
        e.estado = data['estado']
    if 'fecha_evento' in data and data['fecha_evento']:
        dt = parse_datetime(data['fecha_evento'])
        if dt:
            e.fecha_evento = dt
    if 'duracion_minutos' in data:
        try:
            e.duracion_minutos = int(data['duracion_minutos'])
        except (TypeError, ValueError):
            pass
    if 'ubicacion' in data:
        e.ubicacion = (data['ubicacion'] or '').strip()
    if 'descripcion' in data:
        e.descripcion = (data['descripcion'] or '').strip()
    if 'marcas' in data:
        e.marcas = data['marcas'] or []
    if 'costo' in data and data['costo'] not in (None, ''):
        try:
            e.costo = data['costo']
        except Exception:
            pass
    if 'notas_post' in data:
        e.notas_post = (data['notas_post'] or '').strip()
    if 'organizador_id' in data and data['organizador_id']:
        org = User.objects.filter(id=data['organizador_id']).first()
        if org:
            e.organizador = org
    e.save()
    return JsonResponse({'ok': True, 'evento': _evento_to_dict(e)})


@login_required
@require_http_methods(['POST'])
def api_evento_eliminar(request, evento_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    e = get_object_or_404(Evento, id=evento_id)
    e.delete()
    return JsonResponse({'ok': True})


@login_required
@require_http_methods(['POST'])
def api_evento_asistente_agregar(request, evento_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    e = get_object_or_404(Evento, id=evento_id)
    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    cliente_id = data.get('cliente_id')
    prospecto_id = data.get('prospecto_id')
    contacto_nombre = (data.get('contacto_nombre') or '').strip()
    contacto_email = (data.get('contacto_email') or '').strip()
    if not (cliente_id or prospecto_id or contacto_nombre):
        return JsonResponse({'error': 'Indica un cliente, un prospecto o un nombre de contacto'}, status=400)

    a = EventoAsistente.objects.create(
        evento=e,
        cliente=Cliente.objects.filter(id=cliente_id).first() if cliente_id else None,
        prospecto=Prospecto.objects.filter(id=prospecto_id).first() if prospecto_id else None,
        contacto_nombre=contacto_nombre,
        contacto_email=contacto_email,
    )
    return JsonResponse({'ok': True, 'asistente': _asistente_to_dict(a)})


@login_required
@require_http_methods(['POST'])
def api_evento_asistente_quitar(request, evento_id, asistente_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    a = get_object_or_404(EventoAsistente, id=asistente_id, evento_id=evento_id)
    a.delete()
    return JsonResponse({'ok': True})

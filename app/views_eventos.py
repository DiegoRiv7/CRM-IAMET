"""Vistas de Eventos de Marketing.

CRUD JSON sobre Evento y EventoAsistente. La lista se renderiza server-side
desde `views_crm.crm_home` (cuando tab=prospeccion + vista=eventos); este
módulo expone las APIs para crear/editar/eliminar/listar y para manejar
asistentes. Incluye sync bidireccional con Calendario (Actividad) y con
Prospección (Prospecto.evento_origen).
"""
import json
from datetime import timedelta

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db.models import Q
from django.http import HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_http_methods

from .models import Actividad, Cliente, Evento, EventoAsistente, Prospecto
from .views_utils import is_ingeniero


# Color violeta para distinguir los eventos en el calendario
EVENTO_CALENDAR_COLOR = '#AF52DE'


def _sync_calendario(evento, fallback_user=None):
    """Crea o actualiza la Actividad del calendario que espeja un Evento.
    Si el evento se marca como cancelado, se elimina del calendario.
    """
    if evento.estado == 'cancelado':
        Actividad.objects.filter(evento=evento).delete()
        return None

    fecha_fin = evento.fecha_evento + timedelta(minutes=evento.duracion_minutos or 60)
    desc_parts = []
    if evento.ubicacion:
        desc_parts.append(f'📍 {evento.ubicacion}')
    if evento.marcas:
        desc_parts.append(f'Marcas: {", ".join(evento.marcas)}')
    if evento.descripcion:
        desc_parts.append(evento.descripcion)
    descripcion = '\n\n'.join(desc_parts)

    titulo = f'📅 {evento.nombre}'
    completada = (evento.estado == 'realizado')
    creador = evento.organizador or fallback_user or evento.creado_por

    actividad = Actividad.objects.filter(evento=evento).first()
    if actividad:
        actividad.titulo = titulo
        actividad.descripcion = descripcion
        actividad.fecha_inicio = evento.fecha_evento
        actividad.fecha_fin = fecha_fin
        actividad.completada = completada
        actividad.color = EVENTO_CALENDAR_COLOR
        actividad.tipo_actividad = 'reunion'
        actividad.save()
    else:
        actividad = Actividad.objects.create(
            evento=evento,
            titulo=titulo,
            tipo_actividad='reunion',
            descripcion=descripcion,
            fecha_inicio=evento.fecha_evento,
            fecha_fin=fecha_fin,
            creado_por=creador,
            color=EVENTO_CALENDAR_COLOR,
            completada=completada,
        )
    if evento.organizador and not actividad.participantes.filter(id=evento.organizador.id).exists():
        actividad.participantes.add(evento.organizador)
    return actividad


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
    try:
        _sync_calendario(e, fallback_user=request.user)
    except Exception as exc:
        # No fallar la creación del evento si la sync del calendario falla.
        print(f'[Eventos] sync calendario falló al crear: {exc}')
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
    try:
        _sync_calendario(e, fallback_user=request.user)
    except Exception as exc:
        print(f'[Eventos] sync calendario falló al editar: {exc}')
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
    generar_prospecto = bool(data.get('generar_prospecto'))
    if not (cliente_id or prospecto_id or contacto_nombre):
        return JsonResponse({'error': 'Indica un cliente, un prospecto o un nombre de contacto'}, status=400)

    cliente = Cliente.objects.filter(id=cliente_id).first() if cliente_id else None
    prospecto = Prospecto.objects.filter(id=prospecto_id).first() if prospecto_id else None

    # Si invitamos a un Cliente y se pidió generar Prospecto, créalo y vincúlalo
    # al evento. Default: pipeline runrate, marca = primera del evento o ZEBRA.
    prospecto_generado = None
    if cliente and generar_prospecto and not prospecto:
        marca_default = (e.marcas[0] if e.marcas else 'ZEBRA')
        prospecto = Prospecto.objects.create(
            usuario=request.user,
            nombre=f'{cliente.nombre_empresa} — Seguimiento {e.nombre}',
            cliente=cliente,
            producto=marca_default,
            area='SISTEMAS',
            comentarios=(
                f'Generado automáticamente desde el evento "{e.nombre}" del '
                f'{e.fecha_evento:%d %b %Y}. Da seguimiento aquí.'
            ),
            evento_origen=e,
        )
        prospecto_generado = prospecto

    a = EventoAsistente.objects.create(
        evento=e,
        cliente=cliente,
        prospecto=prospecto,
        contacto_nombre=contacto_nombre,
        contacto_email=contacto_email,
    )
    return JsonResponse({
        'ok': True,
        'asistente': _asistente_to_dict(a),
        'prospecto_generado_id': prospecto_generado.id if prospecto_generado else None,
    })


# ── Autocomplete de prospectos (para el modal de Eventos) ───────────
@login_required
@require_http_methods(['GET'])
def api_buscar_prospectos(request):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    query = (request.GET.get('q') or '').strip()
    if len(query) < 2:
        return JsonResponse({'prospectos': []})
    qs = Prospecto.objects.select_related('cliente').filter(
        Q(nombre__icontains=query) | Q(cliente__nombre_empresa__icontains=query)
    ).order_by('-fecha_actualizacion')[:10]
    out = [{
        'id': p.id,
        'nombre': p.nombre,
        'cliente_nombre': p.cliente.nombre_empresa if p.cliente else '',
        'etapa': p.get_etapa_display(),
    } for p in qs]
    return JsonResponse({'prospectos': out})


@login_required
@require_http_methods(['POST'])
def api_evento_asistente_quitar(request, evento_id, asistente_id):
    if not _access_ok(request.user):
        return HttpResponseForbidden()
    a = get_object_or_404(EventoAsistente, id=asistente_id, evento_id=evento_id)
    a.delete()
    return JsonResponse({'ok': True})

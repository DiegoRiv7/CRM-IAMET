"""
views_automatizacion.py
API para el sistema de tareas automatizadas por etapa de oportunidad.
Accesible solo para administradores (is_superuser o is_supervisor).
"""

import json
from datetime import timedelta, datetime

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import (
    ReglaAutomatizacion,
    EjecucionAutomatizacion,
    TareaOportunidad,
    TodoItem,
    Notificacion,
)
from .views_utils import is_supervisor, crear_notificacion


# ─── Helpers ────────────────────────────────────────────────────────────────

def _es_admin(user):
    return user.is_superuser or is_supervisor(user)


def _regla_to_dict(regla):
    """Serializa una ReglaAutomatizacion a dict para el frontend."""
    return {
        'id': regla.id,
        'nombre': regla.nombre,
        'activa': regla.activa,
        'etapa_disparadora': regla.etapa_disparadora,
        'tipo_negociacion': regla.tipo_negociacion,
        'titulo_tarea': regla.titulo_tarea,
        'descripcion_tarea': regla.descripcion_tarea,
        'prioridad_tarea': regla.prioridad_tarea,
        'offset_tipo': regla.offset_tipo,
        'offset_valor': regla.offset_valor,
        'fecha_fija': regla.fecha_fija.strftime('%Y-%m-%d') if regla.fecha_fija else None,
        'orden': regla.orden,
        'responsable': {
            'id': regla.responsable_predeterminado.id,
            'nombre': regla.responsable_predeterminado.get_full_name() or regla.responsable_predeterminado.username,
        } if regla.responsable_predeterminado else None,
        'participantes': [
            {'id': u.id, 'nombre': u.get_full_name() or u.username}
            for u in regla.participantes_predeterminados.all()
        ],
        'observadores': [
            {'id': u.id, 'nombre': u.get_full_name() or u.username}
            for u in regla.observadores_predeterminados.all()
        ],
        'fecha_creacion': regla.fecha_creacion.strftime('%d/%m/%Y'),
        'creada_por': regla.creada_por.get_full_name() or regla.creada_por.username if regla.creada_por else 'Sistema',
    }


def _calcular_fecha_limite(regla, ahora=None):
    """Calcula la fecha límite de la tarea según la configuración de la regla."""
    if ahora is None:
        ahora = timezone.now()

    if regla.offset_tipo == 'dias':
        return ahora + timedelta(days=regla.offset_valor)
    elif regla.offset_tipo == 'horas':
        return ahora + timedelta(hours=regla.offset_valor)
    elif regla.offset_tipo == 'fecha_fija' and regla.fecha_fija:
        # Convertir date a datetime al final del día
        from django.utils.timezone import make_aware
        dt = datetime.combine(regla.fecha_fija, datetime.min.time().replace(hour=23, minute=59))
        try:
            return make_aware(dt)
        except Exception:
            return dt
    return ahora + timedelta(days=3)  # fallback


# ─── API: Listar reglas ──────────────────────────────────────────────────────

@login_required
def api_automatizacion_listar(request):
    """GET /app/api/automatizacion/reglas/ — Lista todas las reglas."""
    if not _es_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Sin permisos'}, status=403)

    reglas = ReglaAutomatizacion.objects.prefetch_related(
        'participantes_predeterminados',
        'observadores_predeterminados',
        'responsable_predeterminado',
    ).all()

    # Agrupar por etapa para facilitar el frontend
    por_etapa = {}
    for r in reglas:
        etapa = r.etapa_disparadora
        if etapa not in por_etapa:
            por_etapa[etapa] = []
        por_etapa[etapa].append(_regla_to_dict(r))

    return JsonResponse({
        'success': True,
        'reglas': [_regla_to_dict(r) for r in reglas],
        'por_etapa': por_etapa,
        'total': reglas.count(),
    })


# ─── API: Crear regla ────────────────────────────────────────────────────────

@login_required
@require_http_methods(['POST'])
def api_automatizacion_crear(request):
    """POST /app/api/automatizacion/reglas/ — Crea una nueva regla."""
    if not _es_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Sin permisos'}, status=403)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'JSON inválido'}, status=400)

    # Validaciones básicas
    nombre = (data.get('nombre') or '').strip()
    etapa = (data.get('etapa_disparadora') or '').strip()
    titulo_tarea = (data.get('titulo_tarea') or '').strip()

    if not nombre:
        return JsonResponse({'success': False, 'error': 'El nombre de la regla es requerido'})
    if not etapa:
        return JsonResponse({'success': False, 'error': 'La etapa disparadora es requerida'})
    if not titulo_tarea:
        return JsonResponse({'success': False, 'error': 'El título de la tarea es requerido'})

    # Fecha fija (si aplica)
    fecha_fija = None
    if data.get('offset_tipo') == 'fecha_fija' and data.get('fecha_fija'):
        try:
            fecha_fija = datetime.strptime(data['fecha_fija'], '%Y-%m-%d').date()
        except ValueError:
            return JsonResponse({'success': False, 'error': 'Formato de fecha inválido (use YYYY-MM-DD)'})

    # Responsable
    responsable = None
    if data.get('responsable_id'):
        try:
            responsable = User.objects.get(id=data['responsable_id'])
        except User.DoesNotExist:
            return JsonResponse({'success': False, 'error': 'Responsable no encontrado'})

    # Crear regla
    regla = ReglaAutomatizacion.objects.create(
        nombre=nombre,
        activa=data.get('activa', True),
        etapa_disparadora=etapa,
        tipo_negociacion=data.get('tipo_negociacion', 'ambos'),
        titulo_tarea=titulo_tarea,
        descripcion_tarea=data.get('descripcion_tarea', ''),
        prioridad_tarea=data.get('prioridad_tarea', 'normal'),
        offset_tipo=data.get('offset_tipo', 'dias'),
        offset_valor=int(data.get('offset_valor', 3)),
        fecha_fija=fecha_fija,
        orden=int(data.get('orden', 0)),
        responsable_predeterminado=responsable,
        creada_por=request.user,
    )

    # Participantes y observadores (M2M)
    if data.get('participantes_ids'):
        participantes = User.objects.filter(id__in=data['participantes_ids'])
        regla.participantes_predeterminados.set(participantes)

    if data.get('observadores_ids'):
        observadores = User.objects.filter(id__in=data['observadores_ids'])
        regla.observadores_predeterminados.set(observadores)

    return JsonResponse({
        'success': True,
        'message': f'Regla "{nombre}" creada correctamente',
        'regla': _regla_to_dict(regla),
    })


# ─── API: Editar regla ───────────────────────────────────────────────────────

@login_required
@require_http_methods(['PUT', 'PATCH'])
def api_automatizacion_editar(request, regla_id):
    """PUT /app/api/automatizacion/reglas/<id>/ — Edita una regla existente."""
    if not _es_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Sin permisos'}, status=403)

    try:
        regla = ReglaAutomatizacion.objects.get(id=regla_id)
    except ReglaAutomatizacion.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Regla no encontrada'}, status=404)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'JSON inválido'}, status=400)

    # Actualizar campos simples
    if 'nombre' in data:
        regla.nombre = (data['nombre'] or '').strip()
    if 'activa' in data:
        regla.activa = bool(data['activa'])
    if 'etapa_disparadora' in data:
        regla.etapa_disparadora = (data['etapa_disparadora'] or '').strip()
    if 'tipo_negociacion' in data:
        regla.tipo_negociacion = data['tipo_negociacion']
    if 'titulo_tarea' in data:
        regla.titulo_tarea = (data['titulo_tarea'] or '').strip()
    if 'descripcion_tarea' in data:
        regla.descripcion_tarea = data['descripcion_tarea'] or ''
    if 'prioridad_tarea' in data:
        regla.prioridad_tarea = data['prioridad_tarea']
    if 'offset_tipo' in data:
        regla.offset_tipo = data['offset_tipo']
    if 'offset_valor' in data:
        regla.offset_valor = int(data['offset_valor'] or 3)
    if 'orden' in data:
        regla.orden = int(data['orden'] or 0)

    if 'fecha_fija' in data:
        if data['fecha_fija']:
            try:
                regla.fecha_fija = datetime.strptime(data['fecha_fija'], '%Y-%m-%d').date()
            except ValueError:
                return JsonResponse({'success': False, 'error': 'Formato de fecha inválido'})
        else:
            regla.fecha_fija = None

    # Responsable
    if 'responsable_id' in data:
        if data['responsable_id']:
            try:
                regla.responsable_predeterminado = User.objects.get(id=data['responsable_id'])
            except User.DoesNotExist:
                return JsonResponse({'success': False, 'error': 'Responsable no encontrado'})
        else:
            regla.responsable_predeterminado = None

    regla.save()

    # M2M
    if 'participantes_ids' in data:
        participantes = User.objects.filter(id__in=(data['participantes_ids'] or []))
        regla.participantes_predeterminados.set(participantes)

    if 'observadores_ids' in data:
        observadores = User.objects.filter(id__in=(data['observadores_ids'] or []))
        regla.observadores_predeterminados.set(observadores)

    return JsonResponse({
        'success': True,
        'message': f'Regla actualizada correctamente',
        'regla': _regla_to_dict(regla),
    })


# ─── API: Eliminar regla ─────────────────────────────────────────────────────

@login_required
@require_http_methods(['DELETE'])
def api_automatizacion_eliminar(request, regla_id):
    """DELETE /app/api/automatizacion/reglas/<id>/ — Elimina una regla."""
    if not _es_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Sin permisos'}, status=403)

    try:
        regla = ReglaAutomatizacion.objects.get(id=regla_id)
        nombre = regla.nombre
        regla.delete()
        return JsonResponse({'success': True, 'message': f'Regla "{nombre}" eliminada'})
    except ReglaAutomatizacion.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Regla no encontrada'}, status=404)


# ─── API: Toggle activa/inactiva ─────────────────────────────────────────────

@login_required
@require_http_methods(['POST'])
def api_automatizacion_toggle(request, regla_id):
    """POST /app/api/automatizacion/reglas/<id>/toggle/ — Activa o desactiva una regla."""
    if not _es_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Sin permisos'}, status=403)

    try:
        regla = ReglaAutomatizacion.objects.get(id=regla_id)
        regla.activa = not regla.activa
        regla.save()
        estado = 'activada' if regla.activa else 'desactivada'
        return JsonResponse({
            'success': True,
            'activa': regla.activa,
            'message': f'Regla {estado}',
        })
    except ReglaAutomatizacion.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Regla no encontrada'}, status=404)


# ─── Función principal: ejecutar automatizaciones ────────────────────────────

def ejecutar_automatizaciones(oportunidad, nueva_etapa, usuario):
    """
    Busca reglas activas para la etapa dada y crea las tareas correspondientes.
    Llamar desde views_crm.py cuando se cambia la etapa de una oportunidad.

    Args:
        oportunidad: instancia de TodoItem
        nueva_etapa: str con el nombre de la nueva etapa (etapa_corta)
        usuario: instancia de User que realizó el cambio
    """
    tipo_neg = getattr(oportunidad, 'tipo_negociacion', 'runrate') or 'runrate'

    # Buscar reglas activas para esta etapa
    reglas = ReglaAutomatizacion.objects.filter(
        activa=True,
        etapa_disparadora__iexact=nueva_etapa,
    ).filter(
        # Aplica si la regla es para ambos tipos, o si coincide con el tipo de la oportunidad
        tipo_negociacion__in=['ambos', tipo_neg]
    ).prefetch_related(
        'participantes_predeterminados',
        'observadores_predeterminados',
    ).order_by('orden')

    tareas_creadas = []

    for regla in reglas:
        # Verificar si ya se ejecutó esta regla para esta oportunidad
        ya_ejecutada = EjecucionAutomatizacion.objects.filter(
            regla=regla,
            oportunidad=oportunidad,
        ).exists()

        if ya_ejecutada:
            continue

        # Calcular fecha límite
        fecha_limite = _calcular_fecha_limite(regla)

        # Determinar responsable: usar el de la regla, o el dueño de la oportunidad como fallback
        responsable = regla.responsable_predeterminado or oportunidad.usuario

        # Crear la tarea
        try:
            tarea = TareaOportunidad.objects.create(
                oportunidad=oportunidad,
                titulo=regla.titulo_tarea,
                descripcion=regla.descripcion_tarea,
                prioridad=regla.prioridad_tarea if regla.prioridad_tarea in ['normal', 'alta'] else 'normal',
                estado='pendiente',
                fecha_limite=fecha_limite,
                creado_por=usuario,
                responsable=responsable,
            )

            # Asignar participantes y observadores
            if regla.participantes_predeterminados.exists():
                tarea.participantes.set(regla.participantes_predeterminados.all())

            if regla.observadores_predeterminados.exists():
                tarea.observadores.set(regla.observadores_predeterminados.all())

            # Registrar ejecución (para evitar duplicados)
            EjecucionAutomatizacion.objects.create(
                regla=regla,
                oportunidad=oportunidad,
                tarea_creada=tarea,
                ejecutada_por=usuario,
            )

            # Notificar al responsable
            if responsable and responsable != usuario:
                crear_notificacion(
                    usuario_destinatario=responsable,
                    tipo='tarea_opp_asignada',
                    titulo='Tarea asignada automáticamente',
                    mensaje=f'Se creó la tarea "{tarea.titulo}" en la oportunidad "{oportunidad.oportunidad}" al pasar a etapa "{nueva_etapa}".',
                    tarea_opp=tarea,
                    oportunidad=oportunidad,
                    usuario_remitente=usuario,
                )

            # Notificar a participantes
            for participante in tarea.participantes.all():
                if participante != usuario and participante != responsable:
                    crear_notificacion(
                        usuario_destinatario=participante,
                        tipo='tarea_participante',
                        titulo='Agregado como participante',
                        mensaje=f'Fuiste agregado como participante en la tarea "{tarea.titulo}" (automatización).',
                        tarea_opp=tarea,
                        oportunidad=oportunidad,
                        usuario_remitente=usuario,
                    )

            # Notificar a observadores
            for observador in tarea.observadores.all():
                if observador != usuario and observador != responsable:
                    crear_notificacion(
                        usuario_destinatario=observador,
                        tipo='tarea_observador',
                        titulo='Agregado como observador',
                        mensaje=f'Fuiste agregado como observador en la tarea "{tarea.titulo}" (automatización).',
                        tarea_opp=tarea,
                        oportunidad=oportunidad,
                        usuario_remitente=usuario,
                    )

            tareas_creadas.append({
                'id': tarea.id,
                'titulo': tarea.titulo,
                'regla': regla.nombre,
            })

        except Exception as e:
            print(f"[Automatización] Error creando tarea para regla {regla.id}: {e}")
            continue

    return tareas_creadas


# ─── API: Historial de ejecuciones ───────────────────────────────────────────

@login_required
def api_automatizacion_historial(request):
    """GET /app/api/automatizacion/historial/ — Historial de ejecuciones."""
    if not _es_admin(request.user):
        return JsonResponse({'success': False, 'error': 'Sin permisos'}, status=403)

    ejecuciones = EjecucionAutomatizacion.objects.select_related(
        'regla', 'oportunidad', 'tarea_creada', 'ejecutada_por'
    ).order_by('-fecha_ejecucion')[:100]

    data = []
    for e in ejecuciones:
        data.append({
            'id': e.id,
            'regla': e.regla.nombre if e.regla else '—',
            'oportunidad': e.oportunidad.oportunidad if e.oportunidad else '—',
            'oportunidad_id': e.oportunidad.id if e.oportunidad else None,
            'tarea': e.tarea_creada.titulo if e.tarea_creada else '—',
            'ejecutada_por': e.ejecutada_por.get_full_name() or e.ejecutada_por.username if e.ejecutada_por else 'Sistema',
            'fecha': e.fecha_ejecucion.strftime('%d/%m/%Y %H:%M'),
        })

    return JsonResponse({'success': True, 'ejecuciones': data})

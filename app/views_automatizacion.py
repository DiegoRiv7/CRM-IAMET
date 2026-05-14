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
    Tarea,
    TodoItem,
    Notificacion,
    AvanceEtapaPendiente,
)
from .views_utils import is_supervisor, crear_notificacion


# ─── Helpers ────────────────────────────────────────────────────────────────

def _es_admin(user):
    return user.is_superuser or is_supervisor(user)


ETAPAS_RUNRATE = [
    'En Solicitud', 'Cotizando', 'Enviada', 'Seguimiento',
    'Vendido s/PO', 'Vendido c/PO', 'En Tránsito', 'Facturado',
    'Programado', 'Entregado', 'Esperando Pago', 'Sin Respuesta',
    'Ganado', 'Perdido',
]

ETAPAS_PROYECTO = [
    'Oportunidad', 'Levantamiento', 'Base Cotización', 'Cotizando',
    'Enviada', 'Seguimiento', 'Vendido s/PO', 'Vendido c/PO',
    'Cotiz. Proveedor', 'Comprando', 'En Tránsito', 'Ejecutando',
    'Entregado', 'Facturado', 'Reportes', 'Pagado', 'Perdido',
]


def obtener_siguiente_etapa(tipo_negociacion, etapa_actual):
    """
    Devuelve la siguiente etapa dada la etapa actual y el tipo de negociacion.
    Retorna None si no hay siguiente etapa (ultima etapa o etapa no encontrada).
    """
    etapas = ETAPAS_PROYECTO if tipo_negociacion == 'proyecto' else ETAPAS_RUNRATE
    try:
        idx = etapas.index(etapa_actual)
    except ValueError:
        # Intentar busqueda case-insensitive
        lower_map = {e.lower(): i for i, e in enumerate(etapas)}
        idx = lower_map.get(etapa_actual.lower(), -1)
        if idx == -1:
            return None

    if idx + 1 < len(etapas):
        siguiente = etapas[idx + 1]
        # No avanzar a Perdido automaticamente
        if siguiente == 'Perdido':
            return None
        return siguiente
    return None


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
        'avanzar_etapa_al_completar': regla.avanzar_etapa_al_completar,
        'incluir_dueno_participante': regla.incluir_dueno_participante,
        'incluir_dueno_observador': regla.incluir_dueno_observador,
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
        avanzar_etapa_al_completar=bool(data.get('avanzar_etapa_al_completar', False)),
        incluir_dueno_participante=bool(data.get('incluir_dueno_participante', False)),
        incluir_dueno_observador=bool(data.get('incluir_dueno_observador', False)),
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
    if 'avanzar_etapa_al_completar' in data:
        regla.avanzar_etapa_al_completar = bool(data['avanzar_etapa_al_completar'])
    if 'incluir_dueno_participante' in data:
        regla.incluir_dueno_participante = bool(data['incluir_dueno_participante'])
    if 'incluir_dueno_observador' in data:
        regla.incluir_dueno_observador = bool(data['incluir_dueno_observador'])

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

def _reglas_para_etapa(oportunidad, etapa):
    """Devuelve un queryset de ReglaAutomatizacion activas que aplican a la
    etapa dada, considerando el tipo_negociacion de la oportunidad."""
    tipo_neg = getattr(oportunidad, 'tipo_negociacion', 'runrate') or 'runrate'
    return (
        ReglaAutomatizacion.objects.filter(
            activa=True,
            etapa_disparadora__iexact=etapa,
        )
        .filter(tipo_negociacion__in=['ambos', tipo_neg])
        .prefetch_related(
            'participantes_predeterminados',
            'observadores_predeterminados',
        )
        .order_by('orden')
    )


def previsualizar_avance_etapa(tarea):
    """
    Para una tarea que acaba de completarse, calcula si al cerrarla habrá un
    avance de etapa (su regla_origen tiene avanzar_etapa_al_completar=True) y
    qué tareas se crearían en la siguiente etapa.

    Devuelve un dict {'aplica': bool, 'etapa_actual': str, 'etapa_siguiente': str|None,
                      'proximas_reglas': [...], 'oportunidad_id': int|None}
    o None si no aplica.
    """
    regla = getattr(tarea, 'regla_origen', None)
    if not regla or not regla.avanzar_etapa_al_completar:
        return None
    oportunidad = getattr(tarea, 'oportunidad', None)
    if not oportunidad:
        return None
    tipo_neg = getattr(oportunidad, 'tipo_negociacion', 'runrate') or 'runrate'
    etapa_actual = oportunidad.etapa_corta or ''
    siguiente = obtener_siguiente_etapa(tipo_neg, etapa_actual)
    if not siguiente:
        return None

    # Reglas que se ejecutarían en la siguiente etapa (excluyendo las ya ejecutadas
    # para esta oportunidad, igual que hace `ejecutar_automatizaciones`).
    reglas_qs = _reglas_para_etapa(oportunidad, siguiente)
    ya_ejecutadas_ids = set(
        EjecucionAutomatizacion.objects.filter(
            regla__in=reglas_qs, oportunidad=oportunidad,
        ).values_list('regla_id', flat=True)
    )
    proximas = []
    for r in reglas_qs:
        if r.id in ya_ejecutadas_ids:
            continue
        proximas.append({
            'regla_id': r.id,
            'titulo': r.titulo_tarea,
            'descripcion_sugerida': r.descripcion_tarea or '',
            'prioridad': r.prioridad_tarea,
        })

    return {
        'aplica': True,
        'oportunidad_id': oportunidad.id,
        'oportunidad_nombre': oportunidad.oportunidad,
        'etapa_actual': etapa_actual,
        'etapa_siguiente': siguiente,
        'proximas_reglas': proximas,
        # Si no hay próximas reglas, el avance es trivial (no se piden descripciones).
        'requiere_descripcion': len(proximas) > 0,
    }


def ejecutar_automatizaciones(oportunidad, nueva_etapa, usuario, descripciones_por_regla=None):
    """
    Busca reglas activas para la etapa dada y crea las tareas correspondientes.
    Llamar desde views_crm.py cuando se cambia la etapa de una oportunidad.

    Args:
        oportunidad: instancia de TodoItem
        nueva_etapa: str con el nombre de la nueva etapa (etapa_corta)
        usuario: instancia de User que realizó el cambio
        descripciones_por_regla: dict opcional {regla_id (int|str): str} con
            descripciones provistas por el usuario que reemplazan la
            descripción predeterminada de la regla.
    """
    # Buscar reglas activas para esta etapa
    reglas = _reglas_para_etapa(oportunidad, nueva_etapa)

    descripciones_por_regla = descripciones_por_regla or {}
    # Normalizar claves a int para tolerar JSON con strings
    descripciones_norm = {}
    for k, v in descripciones_por_regla.items():
        try:
            descripciones_norm[int(k)] = v
        except (TypeError, ValueError):
            continue

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
            # Si el usuario proveyó una descripción específica para esta regla, usarla.
            descripcion_final = descripciones_norm.get(regla.id, None)
            if descripcion_final is None or not str(descripcion_final).strip():
                descripcion_final = regla.descripcion_tarea
            tarea = Tarea.objects.create(
                oportunidad=oportunidad,
                titulo=regla.titulo_tarea,
                descripcion=descripcion_final,
                prioridad=regla.prioridad_tarea if regla.prioridad_tarea in ['normal', 'alta'] else 'normal',
                estado='pendiente',
                fecha_limite=fecha_limite,
                creado_por=oportunidad.usuario or usuario,
                asignado_a=responsable,
                regla_origen=regla,
            )

            # Asignar participantes y observadores
            if regla.participantes_predeterminados.exists():
                tarea.participantes.set(regla.participantes_predeterminados.all())
            # Incluir dueño de la oportunidad como participante
            if regla.incluir_dueno_participante and oportunidad.usuario:
                tarea.participantes.add(oportunidad.usuario)

            if regla.observadores_predeterminados.exists():
                tarea.observadores.set(regla.observadores_predeterminados.all())
            # Incluir dueño de la oportunidad como observador
            if regla.incluir_dueno_observador and oportunidad.usuario:
                tarea.observadores.add(oportunidad.usuario)

            # Registrar ejecución (para evitar duplicados)
            EjecucionAutomatizacion.objects.create(
                regla=regla,
                oportunidad=oportunidad,
                tarea_creada=None,
                tarea_general=tarea,
                ejecutada_por=usuario,
            )

            # Notificar al responsable
            if responsable and responsable != usuario:
                crear_notificacion(
                    usuario_destinatario=responsable,
                    tipo='tarea_asignada',
                    titulo='Tarea asignada automáticamente',
                    mensaje=f'Se creó la tarea "{tarea.titulo}" en la oportunidad "{oportunidad.oportunidad}" al pasar a etapa "{nueva_etapa}".',
                    tarea_id=tarea.id,
                    tarea_titulo=tarea.titulo,
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
                        tarea_id=tarea.id,
                        tarea_titulo=tarea.titulo,
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
                        tarea_id=tarea.id,
                        tarea_titulo=tarea.titulo,
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


# ─── Cadena reactiva: completar tarea → avanzar etapa → nuevas tareas ────────

MAX_AVANCES_CADENA = 10  # Proteccion contra loops infinitos


def procesar_cadena_reactiva(tarea, usuario, descripciones_por_regla=None):
    """
    Al completar una tarea creada por automatizacion, verifica si la regla
    tiene avanzar_etapa_al_completar=True. Si es asi, avanza la oportunidad
    a la siguiente etapa y ejecuta las automatizaciones de esa nueva etapa.

    Args:
        tarea: la Tarea recién completada
        usuario: User que disparó el avance
        descripciones_por_regla: dict opcional {regla_id: str} con descripciones
            que reemplazan la descripción default al crear las nuevas tareas.

    Retorna dict con info de lo que sucedio, o None si no aplica.
    """
    regla = tarea.regla_origen
    if not regla or not regla.avanzar_etapa_al_completar:
        return None

    oportunidad = tarea.oportunidad
    if not oportunidad:
        return None

    tipo_neg = getattr(oportunidad, 'tipo_negociacion', 'runrate') or 'runrate'
    etapa_actual = oportunidad.etapa_corta or ''

    resultado = {
        'avances': [],
        'tareas_creadas': [],
    }

    for paso in range(MAX_AVANCES_CADENA):
        siguiente = obtener_siguiente_etapa(tipo_neg, etapa_actual)
        if not siguiente:
            break

        # Avanzar la etapa de la oportunidad
        oportunidad.etapa_corta = siguiente
        # Automatización: Vendido s/PO o c/PO → probabilidad 100% + mes cierre 2 meses después
        update_fields = ['etapa_corta']
        if siguiente in ('Vendido s/PO', 'Vendido c/PO'):
            from datetime import date as _date
            from dateutil.relativedelta import relativedelta
            oportunidad.probabilidad_cierre = 100
            fecha_cierre = _date.today() + relativedelta(months=2)
            oportunidad.mes_cierre = str(fecha_cierre.month).zfill(2)
            oportunidad.anio_cierre = fecha_cierre.year
            update_fields.extend(['probabilidad_cierre', 'mes_cierre', 'anio_cierre'])
        oportunidad.save(update_fields=update_fields)

        resultado['avances'].append({
            'de': etapa_actual,
            'a': siguiente,
            'paso': paso + 1,
        })

        # Ejecutar automatizaciones para la nueva etapa
        nuevas_tareas = ejecutar_automatizaciones(
            oportunidad, siguiente, usuario,
            descripciones_por_regla=descripciones_por_regla,
        )
        resultado['tareas_creadas'].extend(nuevas_tareas)

        # Verificar si alguna de las nuevas tareas tambien tiene avanzar_etapa_al_completar
        # Si ninguna lo tiene, la cadena se detiene aqui (no hay continuacion automatica)
        # La cadena solo continua cuando se COMPLETE manualmente la siguiente tarea
        break

    # Notificar al dueno de la oportunidad sobre el avance automatico
    if resultado['avances'] and oportunidad.usuario and oportunidad.usuario != usuario:
        avance = resultado['avances'][0]
        crear_notificacion(
            usuario_destinatario=oportunidad.usuario,
            tipo='sistema',
            titulo='Etapa avanzada automaticamente',
            mensaje=f'La oportunidad "{oportunidad.oportunidad}" avanzo de "{avance["de"]}" a "{avance["a"]}" al completar la tarea "{tarea.titulo}".',
            oportunidad=oportunidad,
            usuario_remitente=usuario,
        )

    return resultado if resultado['avances'] else None


# ─── API: Confirmar avance de etapa (modal bloqueante) ───────────────────────

@login_required
@require_http_methods(['POST'])
def api_confirmar_avance_etapa(request, pendiente_id):
    """
    POST /app/api/automatizacion/avance-pendiente/<id>/confirmar/

    Body JSON: {"descripciones": {regla_id: "texto", ...}}

    Aplica el avance de etapa de la tarea completada (ya marcada como completed),
    creando las nuevas tareas con las descripciones provistas por el usuario.
    Solo puede confirmar el usuario responsable de la oportunidad (responsable
    de la pendiente). Devuelve el resultado de la cadena reactiva.
    """
    try:
        pendiente = AvanceEtapaPendiente.objects.select_related(
            'tarea', 'oportunidad', 'responsable',
        ).get(id=pendiente_id)
    except AvanceEtapaPendiente.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Pendiente no encontrado'}, status=404)

    if pendiente.estado != 'pendiente':
        return JsonResponse({'success': False, 'error': f'Ya {pendiente.estado}'}, status=400)

    # Solo el responsable (dueño de la oportunidad) o un superusuario pueden confirmar.
    if request.user != pendiente.responsable and not request.user.is_superuser:
        return JsonResponse({'success': False, 'error': 'Sin permisos para confirmar este avance'}, status=403)

    try:
        data = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'JSON inválido'}, status=400)

    descripciones = data.get('descripciones') or {}
    if not isinstance(descripciones, dict):
        descripciones = {}

    tarea = pendiente.tarea
    if tarea is None:
        return JsonResponse({'success': False, 'error': 'La tarea original ya no existe'}, status=400)

    # Verificar que aún hay proximas reglas que requieran descripción y que
    # esas descripciones fueron provistas (no vacías).
    preview = previsualizar_avance_etapa(tarea)
    if preview:
        for r in preview['proximas_reglas']:
            rid = r['regla_id']
            txt = descripciones.get(str(rid)) or descripciones.get(rid)
            if not txt or not str(txt).strip():
                return JsonResponse({
                    'success': False,
                    'error': f'Falta descripción para "{r["titulo"]}"',
                }, status=400)

    resultado = procesar_cadena_reactiva(
        tarea, request.user, descripciones_por_regla=descripciones,
    )

    pendiente.estado = 'confirmado'
    pendiente.fecha_confirmacion = timezone.now()
    pendiente.descripciones_json = descripciones
    pendiente.confirmado_por = request.user
    pendiente.save(update_fields=[
        'estado', 'fecha_confirmacion', 'descripciones_json', 'confirmado_por',
    ])

    return JsonResponse({
        'success': True,
        'cadena_reactiva': resultado or {'avances': [], 'tareas_creadas': []},
        'mensaje': 'Avance confirmado',
    })


@login_required
def api_avance_pendiente_para_usuario(request):
    """
    GET /app/api/automatizacion/avance-pendiente/mio/

    Devuelve el AvanceEtapaPendiente más antiguo en estado 'pendiente' cuyo
    responsable sea el usuario que consulta. Lo usa el frontend para abrir el
    modal cuando el usuario regresa a la app y tenía un avance pendiente
    (porque cerró su tarea en otro lugar o por otra razón).
    """
    pend = (
        AvanceEtapaPendiente.objects.filter(
            responsable=request.user, estado='pendiente',
        )
        .select_related('tarea', 'oportunidad')
        .order_by('fecha_creacion')
        .first()
    )
    if not pend:
        return JsonResponse({'success': True, 'pendiente': None})
    return JsonResponse({
        'success': True,
        'pendiente': _serializar_pendiente(pend),
    })


def _serializar_pendiente(pendiente):
    tarea = pendiente.tarea
    preview = previsualizar_avance_etapa(tarea) if tarea else None
    return {
        'id': pendiente.id,
        'tarea_completada_id': tarea.id if tarea else None,
        'tarea_completada_titulo': tarea.titulo if tarea else '',
        'oportunidad_id': pendiente.oportunidad_id,
        'oportunidad_nombre': pendiente.oportunidad.oportunidad if pendiente.oportunidad else '',
        'etapa_actual': preview['etapa_actual'] if preview else (pendiente.etapa_actual or ''),
        'etapa_siguiente': preview['etapa_siguiente'] if preview else (pendiente.etapa_siguiente or ''),
        'proximas_reglas': preview['proximas_reglas'] if preview else [],
    }


def crear_avance_pendiente(tarea, responsable):
    """
    Helper: crea un AvanceEtapaPendiente para la tarea recién completada,
    sólo si todavía no existe un pendiente abierto para esa tarea.
    Retorna el objeto pendiente (creado o existente).
    """
    if not tarea or not responsable:
        return None
    existente = AvanceEtapaPendiente.objects.filter(
        tarea=tarea, estado='pendiente',
    ).first()
    if existente:
        return existente
    preview = previsualizar_avance_etapa(tarea)
    if not preview:
        return None
    return AvanceEtapaPendiente.objects.create(
        tarea=tarea,
        oportunidad=tarea.oportunidad,
        responsable=responsable,
        etapa_actual=preview['etapa_actual'],
        etapa_siguiente=preview['etapa_siguiente'],
        estado='pendiente',
    )


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

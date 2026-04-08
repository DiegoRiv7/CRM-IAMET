# ----------------------------------------------------------------------
# views_proyectos.py — Proyectos, tareas, actividades, e ingeniería.
# ----------------------------------------------------------------------

import json
import logging
import requests
import mimetypes
import os
from django.conf import settings
import csv
from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse
from django.core.paginator import Paginator, EmptyPage, PageNotAnInteger
from django.contrib import messages
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required, user_passes_test
from django.views.decorators.http import require_http_methods, require_POST
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db import models
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion, UserProfile, Contacto, PendingFileUpload, OportunidadProyecto, Volumetria, DetalleVolumetria, CatalogoCableado, OportunidadActividad, OportunidadComentario, OportunidadArchivo, OportunidadEstado, Notificacion, Proyecto, ProyectoComentario, ProyectoArchivo, Tarea, TareaComentario, TareaArchivo, Actividad, CarpetaProyecto, ArchivoProyecto, CompartirArchivo, IntercambioNavidad, ParticipanteIntercambio, HistorialIntercambio, SolicitudAccesoProyecto, ArchivoFacturacion, CarpetaOportunidad, ArchivoOportunidad, MensajeOportunidad, TareaOportunidad, ComentarioTareaOpp, PostMuro, ComentarioMuro, ProductoOportunidad, AsistenciaJornada, EficienciaMensual, SolicitudCambioPerfil, ProgramacionActividad
from . import views_exportar
from .views_tarea_comentarios import api_comentarios_tarea, api_agregar_comentario_tarea, api_editar_comentario_tarea, api_eliminar_comentario_tarea
from .forms import VentaForm, VentaFilterForm, CotizacionForm, ClienteForm, OportunidadModalForm, NuevaOportunidadForm
from django.db.models import Sum, Count, F, Q, Case, When, Value
from django.db.models.functions import Upper, Coalesce
from django.db.models import Value
from datetime import date, datetime, timedelta
from dateutil.relativedelta import relativedelta
from django.utils import timezone
from decimal import Decimal
import decimal
from django.utils.html import json_script

# Helper function to detect lost opportunities
from .views_utils import *
from .views_utils import _serialize_tarea_opp

@login_required
def api_ingeniero_actividades(request):
    """
    Devuelve las tareas asignadas al ingeniero ordenadas para su tablero personal.
    Combina TareaOportunidad y Tarea generales.
    """
    from app.models import IngenieroBoardItem, TareaOportunidad, Tarea
    user = request.user

    from django.db.models import Q
    _puede_ver_todo = is_supervisor(user) or is_ingeniero(user)

    # TareaOportunidad: admins/ingenieros ven todas, vendedores solo las suyas
    if _puede_ver_todo:
        tareas_opp = TareaOportunidad.objects.exclude(
            estado='completada'
        ).select_related('oportunidad', 'oportunidad__cliente', 'responsable')
    else:
        tareas_opp = TareaOportunidad.objects.filter(
            responsable=user
        ).exclude(estado='completada').select_related('oportunidad', 'oportunidad__cliente')

    # Tareas generales: admins/ingenieros ven todas las de proyectos de ingeniería + sus propias
    if _puede_ver_todo:
        tareas_gen = Tarea.objects.exclude(estado='completada').select_related(
            'oportunidad', 'oportunidad__cliente', 'proyecto', 'asignado_a'
        ).filter(Q(proyecto__es_ingenieria=True) | Q(asignado_a=user)).distinct()
    else:
        tareas_gen = Tarea.objects.exclude(estado='completada').select_related(
            'oportunidad', 'oportunidad__cliente', 'proyecto'
        ).filter(
            Q(asignado_a=user) |
            Q(proyecto__es_ingenieria=True, proyecto__miembros=user)
        ).distinct()

    # Obtener órdenes personales guardados
    board_map_opp = {
        bi.tarea_opp_id: bi
        for bi in IngenieroBoardItem.objects.filter(usuario=user, tarea_opp__isnull=False)
    }
    board_map_gen = {
        bi.tarea_id: bi
        for bi in IngenieroBoardItem.objects.filter(usuario=user, tarea__isnull=False)
    }

    items = []
    for t in tareas_opp:
        bi = board_map_opp.get(t.id)
        items.append({
            'key': f'opp_{t.id}',
            'tipo': 'tarea_opp',
            'id': t.id,
            'titulo': t.titulo,
            'descripcion': t.descripcion or '',
            'estado': t.estado,
            'prioridad': t.prioridad,
            'fecha_limite': t.fecha_limite.strftime('%Y-%m-%d') if t.fecha_limite else None,
            'fecha_limite_display': t.fecha_limite.strftime('%d/%m/%Y') if t.fecha_limite else 'Sin fecha',
            'oportunidad': t.oportunidad.oportunidad if t.oportunidad else '',
            'oportunidad_id': t.oportunidad_id,
            'cliente': (t.oportunidad.cliente.nombre_empresa if t.oportunidad and t.oportunidad.cliente else ''),
            'asignado': (f"{t.responsable.first_name} {t.responsable.last_name}".strip() if getattr(t, 'responsable', None) else ''),
            'orden': bi.orden if bi else 9999,
            'fecha_planeada': str(bi.fecha_planeada) if bi and bi.fecha_planeada else None,
        })

    for t in tareas_gen:
        bi = board_map_gen.get(t.id)
        nombre_contexto = ''
        if t.oportunidad:
            nombre_contexto = t.oportunidad.oportunidad or ''
        elif t.proyecto:
            nombre_contexto = t.proyecto.nombre or ''
        items.append({
            'key': f'gen_{t.id}',
            'tipo': 'tarea',
            'id': t.id,
            'titulo': t.titulo,
            'descripcion': t.descripcion or '',
            'estado': t.estado,
            'prioridad': t.prioridad,
            'fecha_limite': t.fecha_limite.strftime('%Y-%m-%d') if t.fecha_limite else None,
            'fecha_limite_display': t.fecha_limite.strftime('%d/%m/%Y') if t.fecha_limite else 'Sin fecha',
            'fecha_creacion': t.fecha_creacion.strftime('%Y-%m-%d') if getattr(t, 'fecha_creacion', None) else '1970-01-01',
            'oportunidad': nombre_contexto,
            'oportunidad_id': t.oportunidad_id,
            'cliente': (t.oportunidad.cliente.nombre_empresa if t.oportunidad and t.oportunidad.cliente else ''),
            'orden': bi.orden if bi else 9999,
            'fecha_planeada': str(bi.fecha_planeada) if bi and bi.fecha_planeada else None,
        })

    # Ordenar tareas por fecha_creacion (más reciente primero)
    items.sort(key=lambda x: x.get('fecha_creacion', '1970-01-01'), reverse=True)

    return JsonResponse({'items': items})


@login_required
@csrf_exempt
def api_ingeniero_board_reorder(request):
    """Guarda el orden personal del tablero del ingeniero."""
    from app.models import IngenieroBoardItem
    if request.method != 'POST':
        return JsonResponse({'error': 'POST requerido'}, status=405)
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    # data = [{'key': 'opp_5', 'orden': 0, 'fecha_planeada': '2026-03-05'}, ...]
    for i, item in enumerate(data):
        key = item.get('key', '')
        fecha_planeada = item.get('fecha_planeada') or None
        if key.startswith('opp_'):
            tid = int(key[4:])
            IngenieroBoardItem.objects.update_or_create(
                usuario=request.user, tarea_opp_id=tid, tarea=None,
                defaults={'orden': i, 'fecha_planeada': fecha_planeada}
            )
        elif key.startswith('gen_'):
            tid = int(key[4:])
            IngenieroBoardItem.objects.update_or_create(
                usuario=request.user, tarea_id=tid, tarea_opp=None,
                defaults={'orden': i, 'fecha_planeada': fecha_planeada}
            )

    return JsonResponse({'ok': True})


@login_required
@login_required
def api_ingeniero_proyectos(request):
    """
    Devuelve proyectos de ingeniería (es_ingenieria=True) donde el usuario
    es miembro o los puede ver (supervisores ven todos).
    """
    from app.models import Proyecto
    user = request.user
    if is_supervisor(user) or is_ingeniero(user):
        qs = Proyecto.objects.filter(es_ingenieria=True)
    else:
        qs = Proyecto.objects.filter(es_ingenieria=True, miembros=user)

    _estado_map = {
        'pendiente': 'pendiente',
        'en_progreso': 'en_progreso',
        'completado': 'completada',
        'cancelado': 'cancelada',
    }
    items = []
    for p in qs.order_by('-fecha_creacion'):
        estado_raw = getattr(p, 'estado', 'en_progreso') or 'en_progreso'
        items.append({
            'id': p.id,
            'key': f'proy_{p.id}',
            'titulo': p.nombre,
            'prioridad': getattr(p, 'prioridad', 'media') or 'media',
            'estado': estado_raw,
            'fecha_limite': p.fecha_fin.strftime('%Y-%m-%d') if getattr(p, 'fecha_fin', None) else None,
            'fecha_limite_display': p.fecha_fin.strftime('%d/%m/%Y') if getattr(p, 'fecha_fin', None) else 'Sin fecha',
        })
    return JsonResponse({'items': items})


@login_required
def api_ingeniero_proyecto_detalle(request, proyecto_id):
    """Detalle de un proyecto de ingeniería: info, tareas, carpetas y archivos raíz."""
    from app.models import Proyecto, Tarea, CarpetaProyecto, ArchivoProyecto
    try:
        if is_supervisor(request.user) or is_ingeniero(request.user):
            proyecto = Proyecto.objects.get(pk=proyecto_id, es_ingenieria=True)
        else:
            proyecto = Proyecto.objects.get(pk=proyecto_id, es_ingenieria=True, miembros=request.user)
    except Proyecto.DoesNotExist:
        return JsonResponse({'error': 'Proyecto no encontrado'}, status=404)

    tareas = list(
        Tarea.objects.filter(proyecto=proyecto)
        .select_related('asignado_a')
        .order_by('estado', 'fecha_limite')
        .values('id', 'titulo', 'estado', 'prioridad', 'fecha_limite', 'asignado_a__first_name', 'asignado_a__last_name')
    )
    for t in tareas:
        fn = t.pop('asignado_a__first_name') or ''
        ln = t.pop('asignado_a__last_name') or ''
        t['asignado_a'] = (fn + ' ' + ln).strip() or 'Sin asignar'
        t['fecha_limite'] = t['fecha_limite'].strftime('%d/%m/%Y') if t['fecha_limite'] else None

    carpetas = list(
        CarpetaProyecto.objects.filter(proyecto=proyecto, carpeta_padre=None)
        .values('id', 'nombre')
    )
    for c in carpetas:
        c['archivos'] = list(
            ArchivoProyecto.objects.filter(carpeta_id=c['id'])
            .values('id', 'nombre_original', 'tipo_archivo', 'extension', 'bitrix_download_url', 'tamaño')
        )

    archivos_raiz = list(
        ArchivoProyecto.objects.filter(proyecto=proyecto, carpeta=None)
        .values('id', 'nombre_original', 'tipo_archivo', 'extension', 'bitrix_download_url', 'tamaño')
    )

    creado_por = None
    if proyecto.creado_por:
        fn = proyecto.creado_por.first_name or ''
        ln = proyecto.creado_por.last_name or ''
        creado_por = (fn + ' ' + ln).strip() or proyecto.creado_por.username

    miembros_data = []
    for m in proyecto.miembros.all():
        fn = m.first_name or ''
        ln = m.last_name or ''
        nombre = (fn + ' ' + ln).strip() or m.username
        iniciales = ((fn[:1] if fn else '') + (ln[:1] if ln else '')).upper() or m.username[:2].upper()
        miembros_data.append({
            'nombre': nombre,
            'iniciales': iniciales,
            'username': m.username
        })

    return JsonResponse({
        'id': proyecto.id,
        'titulo': proyecto.nombre,
        'descripcion': proyecto.descripcion or '',
        'estado': getattr(proyecto, 'estado', '') or '',
        'fecha_creacion': proyecto.fecha_creacion.strftime('%d/%m/%Y') if getattr(proyecto, 'fecha_creacion', None) else '',
        'creado_por': creado_por,
        'miembros': miembros_data,
        'tareas': tareas,
        'carpetas': carpetas,
        'archivos_raiz': archivos_raiz,
    })


@login_required
@csrf_exempt
def api_ingeniero_dashboard_stats(request):
    """
    Dashboard stats for the engineer: efficiency, hours, project status.
    Efficiency factors in: tareas, actividades (tareas_opp), and proyectos.
    Hours calculated using business hours only: Mon-Fri, 8am-6pm (10h/day).
    """
    from app.models import TareaOportunidad, Tarea, Proyecto, AsistenciaJornada, EficienciaMensual
    from datetime import timedelta, datetime as dt_class, time as time_class
    import math

    user = request.user
    ahora = timezone.now()
    hoy = timezone.localdate()

    # ── Tareas asignadas ──
    tareas = Tarea.objects.filter(asignado_a=user).exclude(estado='cancelada')
    total_tareas = tareas.count()
    tareas_completadas = tareas.filter(estado='completada').count()
    tareas_progreso = tareas.filter(estado__in=['en_progreso', 'iniciada']).count()
    tareas_pendientes = tareas.filter(estado='pendiente').count()
    tareas_vencidas = tareas.filter(fecha_limite__lt=ahora).exclude(estado='completada').count()

    # ── Actividades (Tareas de Oportunidad) ──
    acts = TareaOportunidad.objects.filter(responsable=user)
    total_acts = acts.count()
    acts_completadas = acts.filter(estado='completada').count()
    acts_pendientes = acts.filter(estado='pendiente').count()
    acts_vencidas = acts.filter(fecha_limite__lt=ahora, estado='pendiente').count()

    # ── Proyectos ── (where user has tasks assigned)
    proyecto_ids = set(
        tareas.exclude(proyecto__isnull=True).values_list('proyecto_id', flat=True)
    )
    proyectos = Proyecto.objects.filter(id__in=proyecto_ids) if proyecto_ids else Proyecto.objects.none()
    total_proyectos = proyectos.count()

    # ── EFICIENCIA DEL INGENIERO ──
    # Base: % of items completed on time vs total actionable items
    total_items = total_tareas + total_acts + total_proyectos
    completados = tareas_completadas + acts_completadas
    vencidos = tareas_vencidas + acts_vencidas

    if total_items > 0:
        # Positive: completed items add points
        puntos_posibles = total_items * 10
        puntos_obtenidos = completados * 10
        # Negative: overdue items penalize
        puntos_obtenidos -= vencidos * 5
        puntos_obtenidos = max(0, puntos_obtenidos)
        eficiencia = round((puntos_obtenidos / puntos_posibles) * 100, 1)
    else:
        eficiencia = 100.0

    # Also check EficienciaMensual for historical data
    em = EficienciaMensual.objects.filter(
        usuario=user, mes=hoy.month, anio=hoy.year
    ).first()
    eficiencia_mensual = float(em.promedio_eficiencia) if em else eficiencia

    # ── HORAS para item seleccionado ──
    # Business hours calculation: Mon-Fri, 8am-6pm (10h/day)
    selected_key = request.GET.get('selected', '')
    horas_plan = 0
    horas_actual = 0

    def _business_hours_between(start_dt, end_dt):
        """Calculate business hours between two datetimes (Mon-Fri, 8:00-18:00)."""
        if not start_dt or not end_dt:
            return 0
        # Ensure timezone aware
        if timezone.is_naive(start_dt):
            start_dt = timezone.make_aware(start_dt)
        if timezone.is_naive(end_dt):
            end_dt = timezone.make_aware(end_dt)
        if start_dt >= end_dt:
            return 0

        total_minutes = 0
        current = start_dt

        while current < end_dt:
            # Skip weekends
            if current.weekday() >= 5:
                current = current.replace(hour=8, minute=0, second=0) + timedelta(days=1)
                continue

            day_start = current.replace(hour=8, minute=0, second=0, microsecond=0)
            day_end = current.replace(hour=18, minute=0, second=0, microsecond=0)

            # Clamp to business hours
            effective_start = max(current, day_start)
            effective_end = min(end_dt, day_end)

            if effective_start < effective_end:
                total_minutes += (effective_end - effective_start).total_seconds() / 60

            # Move to next day
            current = day_start + timedelta(days=1)

        return round(total_minutes / 60, 1)

    if selected_key:
        if selected_key.startswith('opp_'):
            tid = int(selected_key[4:])
            try:
                t = TareaOportunidad.objects.get(id=tid)
                # Actual: business hours since creation until now (or completion)
                horas_actual = _business_hours_between(t.fecha_creacion, ahora)
                # Plan: business hours from creation to deadline
                if t.fecha_limite:
                    horas_plan = _business_hours_between(t.fecha_creacion, t.fecha_limite)
            except TareaOportunidad.DoesNotExist:
                pass
        elif selected_key.startswith('gen_'):
            tid = int(selected_key[4:])
            try:
                t = Tarea.objects.get(id=tid)
                horas_actual = _business_hours_between(t.fecha_creacion, ahora)
                if t.fecha_limite:
                    horas_plan = _business_hours_between(t.fecha_creacion, t.fecha_limite)
            except Tarea.DoesNotExist:
                pass

    return JsonResponse({
        'eficiencia': eficiencia,
        'eficiencia_mensual': eficiencia_mensual,
        'total_tareas': total_tareas,
        'tareas_completadas': tareas_completadas,
        'tareas_progreso': tareas_progreso,
        'tareas_pendientes': tareas_pendientes,
        'tareas_vencidas': tareas_vencidas,
        'total_acts': total_acts,
        'acts_completadas': acts_completadas,
        'acts_pendientes': acts_pendientes,
        'acts_vencidas': acts_vencidas,
        'total_proyectos': total_proyectos,
        'horas_plan': horas_plan,
        'horas_actual': horas_actual,
    })


@login_required
def api_programacion_actividades(request):
    """GET: lista actividades de un proyecto_key. POST: crear una nueva."""
    if request.method == 'GET':
        proyecto_key = request.GET.get('proyecto_key', '')
        if not proyecto_key:
            return JsonResponse({'error': 'proyecto_key requerido'}, status=400)

        acts = ProgramacionActividad.objects.filter(
            proyecto_key=proyecto_key
        ).prefetch_related('responsables')

        items = []
        for a in acts:
            responsables = []
            for u in a.responsables.all():
                profile = getattr(u, 'userprofile', None)
                iniciales = profile.iniciales() if profile else (u.first_name[:1] + u.last_name[:1]).upper() if u.first_name else u.username[:2].upper()
                responsables.append({
                    'id': u.id,
                    'nombre': u.get_full_name() or u.username,
                    'iniciales': iniciales,
                })
            items.append({
                'id': a.id,
                'titulo': a.titulo,
                'dia_semana': a.dia_semana,
                'fecha': str(a.fecha) if a.fecha else None,
                'hora_inicio': a.hora_inicio.strftime('%H:%M'),
                'hora_fin': a.hora_fin.strftime('%H:%M'),
                'responsables': responsables,
                'creado_por': a.creado_por.get_full_name() or a.creado_por.username,
            })

        return JsonResponse({'success': True, 'items': items})

    if request.method == 'POST':
        data = json.loads(request.body)
        proyecto_key = data.get('proyecto_key', '')
        titulo = data.get('titulo', '').strip()
        dia_semana = data.get('dia_semana', '')
        hora_inicio_str = data.get('hora_inicio', '')
        hora_fin_str = data.get('hora_fin', '')
        responsable_ids = data.get('responsables', [])
        fecha_str = data.get('fecha', '')

        if not proyecto_key or not dia_semana or not hora_inicio_str or not hora_fin_str:
            return JsonResponse({'error': 'Campos requeridos: proyecto_key, dia_semana, hora_inicio, hora_fin'}, status=400)

        from datetime import time as time_class, datetime as dt_class, timedelta
        try:
            h_ini = dt_class.strptime(hora_inicio_str, '%H:%M').time()
            h_fin = dt_class.strptime(hora_fin_str, '%H:%M').time()
        except ValueError:
            return JsonResponse({'error': 'Formato de hora inválido (usar HH:MM)'}, status=400)

        if h_ini >= h_fin:
            return JsonResponse({'error': 'La hora de inicio debe ser antes de la hora de fin'}, status=400)

        fecha = None
        if fecha_str:
            try:
                fecha = dt_class.strptime(fecha_str, '%Y-%m-%d').date()
            except ValueError:
                pass

        # Verificar conflictos para cada responsable
        conflictos = []
        for uid in responsable_ids:
            user_conflicts = ProgramacionActividad.get_conflictos_usuario(
                uid, dia_semana, h_ini, h_fin, fecha=fecha
            )
            if user_conflicts.exists():
                try:
                    u = User.objects.get(id=uid)
                    nombre = u.get_full_name() or u.username
                except User.DoesNotExist:
                    nombre = f'ID {uid}'
                for c in user_conflicts:
                    conflictos.append({
                        'usuario': nombre,
                        'usuario_id': uid,
                        'actividad': c.titulo,
                        'proyecto_key': c.proyecto_key,
                        'hora': f"{c.hora_inicio.strftime('%H:%M')}-{c.hora_fin.strftime('%H:%M')}",
                    })

        if conflictos:
            return JsonResponse({
                'success': False,
                'error': 'conflicto',
                'conflictos': conflictos,
                'mensaje': 'Algunos responsables tienen conflictos de horario',
            }, status=409)

        act = ProgramacionActividad.objects.create(
            proyecto_key=proyecto_key,
            titulo=titulo or 'Actividad sin título',
            dia_semana=dia_semana,
            fecha=fecha,
            hora_inicio=h_ini,
            hora_fin=h_fin,
            creado_por=request.user,
        )
        usuarios_asignados = []
        if responsable_ids:
            usuarios_asignados = list(User.objects.filter(id__in=responsable_ids))
            act.responsables.set(usuarios_asignados)

        # ── Create calendar Actividad for each assigned person ──
        # Use next occurrence of dia_semana if no fecha given
        from datetime import datetime as dt_class
        if fecha:
            act_fecha = fecha
        else:
            dias_map = {'Lunes':0,'Martes':1,'Miércoles':2,'Jueves':3,'Viernes':4,'Sábado':5,'Domingo':6}
            target_day = dias_map.get(dia_semana, 0)
            today = timezone.localdate()
            days_ahead = target_day - today.weekday()
            if days_ahead <= 0:
                days_ahead += 7
            act_fecha = today + timedelta(days=days_ahead)

        fecha_inicio_cal = timezone.make_aware(dt_class.combine(act_fecha, h_ini))
        fecha_fin_cal = timezone.make_aware(dt_class.combine(act_fecha, h_fin))

        proyecto_titulo = data.get('proyecto_titulo', proyecto_key)

        cal_actividad = Actividad.objects.create(
            titulo=f"📋 {proyecto_titulo}: {titulo or 'Actividad programada'}",
            tipo_actividad='reunion',
            descripcion=f"Actividad programada para el proyecto. Día: {dia_semana}.",
            fecha_inicio=fecha_inicio_cal,
            fecha_fin=fecha_fin_cal,
            creado_por=request.user,
            color='#FF2D55',  # Rosa
        )
        if usuarios_asignados:
            cal_actividad.participantes.set(usuarios_asignados)

        # ── Send notifications to assigned users ──
        for u in usuarios_asignados:
            try:
                crear_notificacion(
                    usuario_destinatario=u,
                    tipo='programacion_proyecto',
                    titulo=f"Asignado a actividad de proyecto",
                    mensaje=f"Se te asignó a '{titulo or 'Actividad'}' el {dia_semana} de {h_ini.strftime('%H:%M')} a {h_fin.strftime('%H:%M')} en el proyecto '{proyecto_titulo}'.",
                    usuario_remitente=request.user,
                    proyecto_nombre=proyecto_titulo,
                )
            except Exception:
                pass

        return JsonResponse({'success': True, 'id': act.id})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_programacion_actividad_detail(request, actividad_id):
    """PUT actualizar / DELETE eliminar una actividad programada."""
    act = get_object_or_404(ProgramacionActividad, pk=actividad_id)

    if request.method == 'PUT':
        data = json.loads(request.body)
        titulo = data.get('titulo', '').strip()
        if titulo:
            act.titulo = titulo
        hora_inicio_str = data.get('hora_inicio', '')
        hora_fin_str = data.get('hora_fin', '')
        if hora_inicio_str and hora_fin_str:
            from datetime import datetime as dt_class
            try:
                act.hora_inicio = dt_class.strptime(hora_inicio_str, '%H:%M').time()
                act.hora_fin = dt_class.strptime(hora_fin_str, '%H:%M').time()
            except ValueError:
                pass
        responsable_ids = data.get('responsables')
        if responsable_ids is not None:
            conflictos = []
            for uid in responsable_ids:
                user_conflicts = ProgramacionActividad.get_conflictos_usuario(
                    uid, act.dia_semana, act.hora_inicio, act.hora_fin,
                    exclude_id=act.id, fecha=act.fecha
                )
                if user_conflicts.exists():
                    try:
                        u = User.objects.get(id=uid)
                        nombre = u.get_full_name() or u.username
                    except User.DoesNotExist:
                        nombre = f'ID {uid}'
                    for c in user_conflicts:
                        conflictos.append({
                            'usuario': nombre,
                            'actividad': c.titulo,
                            'hora': f"{c.hora_inicio.strftime('%H:%M')}-{c.hora_fin.strftime('%H:%M')}",
                        })
            if conflictos:
                return JsonResponse({
                    'success': False,
                    'error': 'conflicto',
                    'conflictos': conflictos,
                }, status=409)
            act.responsables.set(User.objects.filter(id__in=responsable_ids))
        act.save()
        return JsonResponse({'success': True})

    if request.method == 'DELETE':
        act.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_programacion_disponibilidad(request):
    """
    GET: Verifica disponibilidad de usuarios para un día y rango de hora.
    """
    dia_semana = request.GET.get('dia_semana', '')
    hora_inicio_str = request.GET.get('hora_inicio', '')
    hora_fin_str = request.GET.get('hora_fin', '')
    fecha_str = request.GET.get('fecha', '')
    exclude_id = request.GET.get('exclude_id')

    if not dia_semana or not hora_inicio_str or not hora_fin_str:
        return JsonResponse({'error': 'Parámetros requeridos: dia_semana, hora_inicio, hora_fin'}, status=400)

    from datetime import datetime as dt_class
    try:
        h_ini = dt_class.strptime(hora_inicio_str, '%H:%M').time()
        h_fin = dt_class.strptime(hora_fin_str, '%H:%M').time()
    except ValueError:
        return JsonResponse({'error': 'Formato de hora inválido'}, status=400)

    fecha = None
    if fecha_str:
        try:
            fecha = dt_class.strptime(fecha_str, '%Y-%m-%d').date()
        except ValueError:
            pass

    usuarios = User.objects.filter(is_active=True).select_related('userprofile').order_by('first_name', 'last_name')

    resultado = []
    for u in usuarios:
        profile = getattr(u, 'userprofile', None)
        iniciales = profile.iniciales() if profile else (u.first_name[:1] + u.last_name[:1]).upper() if u.first_name else u.username[:2].upper()
        rol = profile.rol if profile else 'vendedor'

        conflictos = ProgramacionActividad.get_conflictos_usuario(
            u.id, dia_semana, h_ini, h_fin,
            exclude_id=int(exclude_id) if exclude_id else None,
            fecha=fecha
        )

        conflict_list = []
        for c in conflictos:
            conflict_list.append({
                'id': c.id,
                'titulo': c.titulo,
                'proyecto_key': c.proyecto_key,
                'hora': f"{c.hora_inicio.strftime('%H:%M')}-{c.hora_fin.strftime('%H:%M')}",
            })

        resultado.append({
            'id': u.id,
            'nombre': u.get_full_name() or u.username,
            'iniciales': iniciales,
            'rol': rol,
            'disponible': len(conflict_list) == 0,
            'conflictos': conflict_list,
        })

    return JsonResponse({'success': True, 'usuarios': resultado})


@login_required
def api_empleados_jornadas(request):
    """Retorna horas trabajadas y eficiencia por día de cada empleado en el mes dado."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'No autorizado'}, status=403)
    import calendar as _cal
    from datetime import date as _date
    try:
        mes = int(request.GET.get('mes', _date.today().month))
        anio = int(request.GET.get('anio', _date.today().year))
    except (ValueError, TypeError):
        mes, anio = _date.today().month, _date.today().year

    users = User.objects.filter(is_active=True).exclude(
        groups__name='Supervisores'
    ).order_by('first_name', 'last_name')

    jornadas = AsistenciaJornada.objects.filter(
        fecha__year=anio, fecha__month=mes
    ).select_related('usuario')

    data = {}
    for j in jornadas:
        uid = j.usuario_id
        day = j.fecha.day
        if uid not in data:
            data[uid] = {}
        data[uid][day] = {
            'horas': round(j.segundos_laborados / 3600, 1),
            'eficiencia': float(j.eficiencia_dia),
        }

    # Today's status (only relevant if viewing current month)
    today = _date.today()
    today_estados = {}
    if mes == today.month and anio == today.year:
        hoy_jornadas = AsistenciaJornada.objects.filter(fecha=today)
        for j in hoy_jornadas:
            if j.hora_fin:
                today_estados[j.usuario_id] = 'inactivo'
            elif j.pausado:
                today_estados[j.usuario_id] = 'pausa'
            else:
                today_estados[j.usuario_id] = 'activo'

    empleados = []
    for u in users:
        dias = data.get(u.id, {})
        empleados.append({
            'id': u.id,
            'nombre': ((u.first_name + ' ' + u.last_name).strip() or u.username),
            'dias': {str(d): v for d, v in dias.items()},
            'estado_hoy': today_estados.get(u.id),
        })

    _, num_dias = _cal.monthrange(anio, mes)
    return JsonResponse({'empleados': empleados, 'mes': mes, 'anio': anio, 'num_dias': num_dias})


@login_required
def api_proyectos(request):
    """
    API para obtener proyectos con paginación
    """
    from .views_utils import is_supervisor
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'Sección en desarrollo. Solo supervisores por ahora.'}, status=403)
    
    # Obtener parámetros de paginación
    page = int(request.GET.get('page', 1))
    per_page = int(request.GET.get('per_page', 30))
    search = request.GET.get('search', '').strip()
    
    # Obtener proyectos reales de la base de datos
    try:
        # Obtener TODOS los proyectos primero para debug
        proyectos_query = Proyecto.objects.all()
        
        # Filtrar por búsqueda si hay término
        if search:
            proyectos_query = proyectos_query.filter(
                Q(nombre__icontains=search) | 
                Q(descripcion__icontains=search)
            )
        
        # Aplicar paginación
        from django.core.paginator import Paginator
        paginator = Paginator(proyectos_query, per_page)
        proyectos_pagina = paginator.get_page(page)
        
        # Convertir a formato JSON
        proyectos_data = []
        for proyecto in proyectos_pagina:
            proyectos_data.append({
                'id': proyecto.id,
                'nombre': proyecto.nombre,
                'descripcion': proyecto.descripcion or '',
                'avance': proyecto.get_avance_porcentaje(),
                'fecha_creacion': proyecto.fecha_creacion.strftime('%d de %b, %Y'),
                'creador': {
                    'id': proyecto.creado_por.id,
                    'nombre': proyecto.creado_por.get_full_name() or proyecto.creado_por.username,
                    'iniciales': ''.join([palabra[0].upper() for palabra in (proyecto.creado_por.get_full_name() or proyecto.creado_por.username).split()[:2]]),
                    'avatar_url': proyecto.creado_por.userprofile.get_avatar_url() if hasattr(proyecto.creado_por, 'userprofile') else None
                },
                'miembros': proyecto.get_miembros_display(),
                'privacidad': proyecto.privacidad,
                'tipo': proyecto.tipo,
                'mi_rol': proyecto.get_rol_usuario(request.user)
            })
            
            # Agregar oportunidades de forma segura
            try:
                oportunidades = []
                print(f"DEBUG: Proyecto {proyecto.id} - {proyecto.nombre}")
                print(f"DEBUG: Tiene oportunidades_ligadas attr: {hasattr(proyecto, 'oportunidades_ligadas')}")
                
                if hasattr(proyecto, 'oportunidades_ligadas'):
                    opp_count = proyecto.oportunidades_ligadas.count()
                    print(f"DEBUG: Número de oportunidades ligadas: {opp_count}")
                    
                    for oportunidad in proyecto.oportunidades_ligadas.all():
                        print(f"DEBUG: Oportunidad encontrada: {oportunidad.oportunidad}")
                        oportunidades.append({
                            'id': oportunidad.id,
                            'titulo': oportunidad.oportunidad
                        })
                proyectos_data[-1]['oportunidades_ligadas'] = oportunidades
                print(f"DEBUG: Total oportunidades procesadas: {len(oportunidades)}")
            except Exception as opp_error:
                print(f"ERROR obteniendo oportunidades para proyecto {proyecto.id}: {opp_error}")
                import traceback
                traceback.print_exc()
                proyectos_data[-1]['oportunidades_ligadas'] = []

        return JsonResponse({
            'success': True,
            'proyectos': proyectos_data,
            'total': paginator.count,
            'page': page,
            'per_page': per_page,
            'total_pages': paginator.num_pages
        })
        
    except Exception as e:
        print(f"Error obteniendo proyectos: {e}")
        # Fallback a datos de ejemplo si hay error
        usuario_actual_id = request.user.id
    
    proyectos_ejemplo = [
        {
            'id': 1380,
            'nombre': 'RFQ-20250428-11 CONTROL DE ACCESO TORNIQUETE',
            'descripcion': 'Sistema de control de acceso con torniquetes inteligentes',
            'avance': 63,
            'fecha_creacion': '15 de Ago, 2024',
            'creador': {
                'id': 1,
                'nombre': 'Diego Rivera',
                'iniciales': 'DR'
            },
            'miembros': [
                {'id': 1, 'nombre': 'Diego Rivera', 'iniciales': 'DR'},
                {'id': 2, 'nombre': 'Juan García', 'iniciales': 'JG'},
                {'id': 3, 'nombre': 'María Pérez', 'iniciales': 'MP'},
                {'id': 4, 'nombre': 'Ana López', 'iniciales': 'AL'}
            ],
            'privacidad': 'publico',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 1 else ('Miembro' if usuario_actual_id in [2, 3, 4] else 'No te has unido al proyecto')
        },
        {
            'id': 2056,
            'nombre': 'CRM NetHive - Sistema de Gestión',
            'descripcion': 'Desarrollo del sistema CRM personalizado',
            'avance': 100,
            'fecha_creacion': '10 de Jul, 2024',
            'creador': {
                'id': 2,
                'nombre': 'Juan García',
                'iniciales': 'JG'
            },
            'miembros': [
                {'id': 2, 'nombre': 'Juan García', 'iniciales': 'JG'},
                {'id': 5, 'nombre': 'Luis Martínez', 'iniciales': 'LM'}
            ],
            'privacidad': 'privado',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 2 else ('Miembro' if usuario_actual_id == 5 else 'No te has unido al proyecto')
        },
        {
            'id': 774,
            'nombre': 'Telvista 34630 CH - Sistema Avigilon',
            'descripcion': 'Implementación de sistema de videovigilancia',
            'avance': 45,
            'fecha_creacion': '5 de Sep, 2024',
            'creador': {
                'id': 3,
                'nombre': 'María Pérez',
                'iniciales': 'MP'
            },
            'miembros': [
                {'id': 3, 'nombre': 'María Pérez', 'iniciales': 'MP'},
                {'id': 1, 'nombre': 'Diego Rivera', 'iniciales': 'DR'},
                {'id': 4, 'nombre': 'Ana López', 'iniciales': 'AL'},
                {'id': 6, 'nombre': 'Carlos Ruiz', 'iniciales': 'CR'}
            ],
            'privacidad': 'privado',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 3 else ('Miembro' if usuario_actual_id in [1, 4, 6] else 'No te has unido al proyecto')
        },
        {
            'id': 1560,
            'nombre': '8700053503 - Equipos ZEBRA PIMS',
            'descripcion': 'Instalación y configuración de equipos ZEBRA',
            'avance': 85,
            'fecha_creacion': '20 de Ago, 2024',
            'creador': {
                'id': 1,
                'nombre': 'Diego Rivera',
                'iniciales': 'DR'
            },
            'miembros': [
                {'id': 1, 'nombre': 'Diego Rivera', 'iniciales': 'DR'},
                {'id': 7, 'nombre': 'Ana Beltrán', 'iniciales': 'AB'},
                {'id': 8, 'nombre': 'Carlos Fuentes', 'iniciales': 'CF'}
            ],
            'privacidad': 'publico',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 1 else ('Miembro' if usuario_actual_id in [7, 8] else 'No te has unido al proyecto')
        },
        {
            'id': 1130,
            'nombre': 'PO 4201027104 - Instalación Access Point',
            'descripcion': 'Instalación de puntos de acceso inalámbricos',
            'avance': 92,
            'fecha_creacion': '1 de Sep, 2024',
            'creador': {
                'id': 4,
                'nombre': 'Ana López',
                'iniciales': 'AL'
            },
            'miembros': [
                {'id': 4, 'nombre': 'Ana López', 'iniciales': 'AL'},
                {'id': 9, 'nombre': 'José Morales', 'iniciales': 'JM'},
                {'id': 10, 'nombre': 'Teresa Ramírez', 'iniciales': 'TR'},
                {'id': 11, 'nombre': 'David López', 'iniciales': 'DL'}
            ],
            'privacidad': 'privado',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 4 else ('Miembro' if usuario_actual_id in [9, 10, 11] else 'No te has unido al proyecto')
        }
    ]
    
    # Filtrar por búsqueda si se proporciona
    if search:
        proyectos_filtrados = [
            p for p in proyectos_ejemplo 
            if search.lower() in p['nombre'].lower() or search.lower() in p['descripcion'].lower()
        ]
    else:
        proyectos_filtrados = proyectos_ejemplo
    
    # Simular paginación
    total_proyectos = len(proyectos_filtrados)
    start_index = (page - 1) * per_page
    end_index = start_index + per_page
    proyectos_pagina = proyectos_filtrados[start_index:end_index]
    
    return JsonResponse({
        'success': True,
        'proyectos': proyectos_pagina,
        'total': total_proyectos,
        'page': page,
        'per_page': per_page,
        'total_pages': (total_proyectos + per_page - 1) // per_page
    })


@login_required
def api_tareas(request):
    """
    API para obtener y crear tareas
    """
    
    if request.method == 'GET':
        # Obtener tareas por proyecto si se especifica, sino mostrar TODAS las tareas
        proyecto_id = request.GET.get('proyecto_id')
        
        oportunidad_id = request.GET.get('oportunidad_id')
        is_paginated = False
        total = None
        page = 1
        total_pages = 1
        try:
            if proyecto_id:
                # Filtrar por proyecto específico
                proyecto = Proyecto.objects.get(id=proyecto_id)
                tareas = Tarea.objects.filter(proyecto=proyecto).select_related(
                    'creado_por', 'asignado_a', 'proyecto'
                ).order_by('-fecha_creacion')
            elif oportunidad_id:
                # Filtrar por oportunidad (tareas del widget de oportunidad)
                tareas = Tarea.objects.filter(oportunidad_id=oportunidad_id).select_related(
                    'creado_por', 'asignado_a', 'proyecto', 'oportunidad'
                ).order_by('fecha_limite', '-fecha_creacion')
            else:
                # Mostrar TODAS las tareas
                estado_filter = request.GET.get('estado', '')  # 'pendientes' | 'completadas' | ''

                if request.user.is_superuser:
                    tareas = Tarea.objects.defer('descripcion').select_related(
                        'creado_por', 'asignado_a', 'proyecto', 'oportunidad', 'oportunidad__cliente'
                    ).order_by('-fecha_creacion')
                else:
                    # Separar queries: FK directas (rápidas) + M2M por IDs (evita JOIN+DISTINCT lento)
                    ids_participando = set(
                        request.user.tareas_participando.values_list('id', flat=True)
                    )
                    ids_observando = set(
                        request.user.tareas_observando.values_list('id', flat=True)
                    )
                    ids_m2m = ids_participando | ids_observando

                    # Incluir tareas de miembros del grupo
                    from .views_grupos import get_usuarios_visibles_ids
                    ids_grupo = get_usuarios_visibles_ids(request.user)
                    if ids_grupo:
                        grupo_filter = Q(creado_por__id__in=ids_grupo) | Q(asignado_a__id__in=ids_grupo)
                    else:
                        grupo_filter = Q()

                    tareas = Tarea.objects.filter(
                        Q(creado_por=request.user) |
                        Q(asignado_a=request.user) |
                        Q(id__in=ids_m2m) |
                        grupo_filter
                    ).defer('descripcion').select_related(
                        'creado_por', 'asignado_a', 'proyecto', 'oportunidad', 'oportunidad__cliente'
                    ).order_by('-fecha_creacion')

                # Filtro de estado
                if estado_filter == 'pendientes':
                    tareas = tareas.exclude(estado='completada')
                elif estado_filter == 'completadas':
                    tareas = tareas.filter(estado='completada')

                # Paginación para completadas y todas (no para pendientes)
                is_paginated = estado_filter in ('completadas', 'todas', '')
                if is_paginated:
                    q_search = request.GET.get('q', '').strip()
                    if q_search:
                        tareas = tareas.filter(titulo__icontains=q_search)
                    per_page = 50
                    page = max(1, int(request.GET.get('page', 1)))
                    total = tareas.count()
                    total_pages = max(1, (total + per_page - 1) // per_page)
                    page = min(page, total_pages)
                    offset = (page - 1) * per_page
                    tareas = tareas[offset:offset + per_page]
            
            tareas_data = []
            for tarea in tareas:
                # Formatear tiempo trabajado
                tiempo_total_str = "00:00:00"
                if hasattr(tarea, 'tiempo_trabajado') and tarea.tiempo_trabajado:
                    total_seconds = int(tarea.tiempo_trabajado.total_seconds())
                    hours = total_seconds // 3600
                    minutes = (total_seconds % 3600) // 60
                    seconds = total_seconds % 60
                    tiempo_total_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                
                tareas_data.append({
                    'id': tarea.id,
                    'titulo': tarea.titulo,
                    'descripcion': tarea.descripcion,
                    'estado': tarea.estado,
                    'prioridad': tarea.prioridad,
                    'fecha_creacion': tarea.fecha_creacion.isoformat(),
                    'fecha_limite': tarea.fecha_limite.isoformat() if tarea.fecha_limite else None,
                    'fecha_completada': tarea.fecha_completada.isoformat() if tarea.fecha_completada else None,
                    'creado_por': tarea.creado_por.get_full_name() or tarea.creado_por.username,
                    'creado_por_id': tarea.creado_por_id,
                    'responsable': tarea.asignado_a.get_full_name() or tarea.asignado_a.username if tarea.asignado_a else None,
                    'asignado_a_id': tarea.asignado_a_id,
                    'proyecto_nombre': tarea.proyecto.nombre if tarea.proyecto else 'Sin proyecto',
                    'proyecto_id': tarea.proyecto.id if tarea.proyecto else None,
                    'oportunidad_id': tarea.oportunidad.id if tarea.oportunidad else None,
                    'oportunidad_nombre': tarea.oportunidad.oportunidad if tarea.oportunidad else None,
                    'oportunidad_cliente': tarea.oportunidad.cliente.nombre_empresa if tarea.oportunidad and tarea.oportunidad.cliente else None,
                    # Datos del cronómetro
                    'trabajando_actualmente': getattr(tarea, 'trabajando_actualmente', False),
                    'pausado': getattr(tarea, 'pausado', False),
                    'tiempo_trabajado': tiempo_total_str,
                    'fecha_inicio_sesion': tarea.fecha_inicio_sesion.isoformat() if hasattr(tarea, 'fecha_inicio_sesion') and tarea.fecha_inicio_sesion else None,
                })
            
            return JsonResponse({
                'success': True,
                'tareas': tareas_data,
                'paginated': is_paginated,
                'total': total if total is not None else len(tareas_data),
                'page': page,
                'total_pages': total_pages,
            })
            
        except Proyecto.DoesNotExist:
            return JsonResponse({'error': 'Proyecto no encontrado'}, status=404)
        except Exception as e:
            return JsonResponse({'error': f'Error obteniendo tareas: {str(e)}'}, status=500)
    
    elif request.method == 'POST':
        # Crear nueva tarea
        try:
            from datetime import datetime
            
            # Obtener datos del formulario
            titulo = request.POST.get('titulo', '').strip()
            descripcion = request.POST.get('descripcion', '').strip()
            proyecto_id = request.POST.get('proyecto_id')
            
            # Manejar prioridad - puede venir como 'alta_prioridad' boolean o 'prioridad' string
            alta_prioridad = request.POST.get('alta_prioridad', 'false').lower() == 'true'
            prioridad = request.POST.get('prioridad', 'alta' if alta_prioridad else 'media')
            
            fecha_limite_str = request.POST.get('fecha_limite')
            responsable_id = request.POST.get('responsable_id')
            
            # Validaciones
            if not titulo:
                return JsonResponse({'error': 'El título es requerido'}, status=400)
            if not proyecto_id:
                return JsonResponse({'error': 'El proyecto es requerido'}, status=400)
            
            # Obtener proyecto
            try:
                proyecto = Proyecto.objects.get(id=proyecto_id)
            except Proyecto.DoesNotExist:
                return JsonResponse({'error': 'Proyecto no encontrado'}, status=404)
            
            # Procesar fecha límite
            fecha_limite = None
            if fecha_limite_str:
                try:
                    fecha_limite = datetime.fromisoformat(fecha_limite_str.replace('Z', '+00:00'))
                except ValueError:
                    return JsonResponse({'error': 'Formato de fecha inválido'}, status=400)
            
            # Obtener responsable
            responsable = None
            if responsable_id:
                try:
                    responsable = User.objects.get(id=responsable_id)
                except User.DoesNotExist:
                    return JsonResponse({'error': 'Usuario responsable no encontrado'}, status=404)
            
            # Crear tarea
            tarea = Tarea.objects.create(
                titulo=titulo,
                descripcion=descripcion,
                proyecto=proyecto,
                creado_por=request.user,
                asignado_a=responsable,
                prioridad=prioridad,
                fecha_limite=fecha_limite
            )
            
            return JsonResponse({
                'success': True,
                'tarea_id': tarea.id,
                'mensaje': 'Tarea creada exitosamente'
            })
            
        except Exception as e:
            return JsonResponse({
                'error': f'Error al crear la tarea: {str(e)}'
            }, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_actualizar_estado_tarea(request):
    """
    API para actualizar el estado de una tarea
    """
    global tareas_temporales
    
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    if request.method == 'POST':
        try:
            tarea_id = request.POST.get('tarea_id')
            nuevo_estado = request.POST.get('nuevo_estado')
            
            # Validaciones básicas
            if not tarea_id:
                return JsonResponse({'error': 'ID de tarea requerido'}, status=400)
            
            if not nuevo_estado:
                return JsonResponse({'error': 'Nuevo estado requerido'}, status=400)
            
            estados_validos = ['pendiente', 'en_progreso', 'completada', 'cancelada']
            if nuevo_estado not in estados_validos:
                return JsonResponse({'error': 'Estado no válido'}, status=400)
            
            # Buscar la tarea en la lista temporal
            tarea_encontrada = None
            for i, tarea in enumerate(tareas_temporales):
                if str(tarea['id']) == str(tarea_id):
                    tarea_encontrada = tarea
                    break
            
            if not tarea_encontrada:
                return JsonResponse({'error': 'Tarea no encontrada'}, status=404)
            
            # Verificar permisos: solo el responsable puede cambiar estados
            if tarea_encontrada['responsable_id'] != request.user.id:
                return JsonResponse({'error': 'Solo el responsable puede cambiar el estado de la tarea'}, status=403)
            
            # Actualizar el estado
            tarea_encontrada['estado'] = nuevo_estado
            
            return JsonResponse({
                'success': True,
                'message': 'Estado actualizado exitosamente',
                'tarea': tarea_encontrada
            })
            
        except Exception as e:
            return JsonResponse({
                'error': f'Error al actualizar estado: {str(e)}'
            }, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_actualizar_tarea(request):
    """
    API para actualizar una tarea completa (solo creadores)
    """
    global tareas_temporales
    
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    if request.method == 'POST':
        try:
            import json
            from datetime import datetime
            from django.contrib.auth.models import User
            from .models import Proyecto
            
            # Obtener datos del request
            data = json.loads(request.body)
            tarea_id = data.get('tarea_id')
            titulo = data.get('titulo', data.get('nombre', '')).strip()
            descripcion = data.get('descripcion', '').strip()
            proyecto_id = data.get('proyecto_id')
            alta_prioridad = data.get('alta_prioridad', False)
            prioridad = data.get('prioridad', 'media')
            fecha_limite = data.get('fecha_limite')
            responsable_id = data.get('responsable_id')
            participantes_json = data.get('participantes', '[]')
            observadores_json = data.get('observadores', '[]')
            
            # Validaciones básicas
            if not tarea_id:
                return JsonResponse({'error': 'ID de tarea requerido'}, status=400)
            
            if not titulo:
                return JsonResponse({'error': 'El título es requerido'}, status=400)
            
            # Buscar la tarea en la lista temporal
            tarea_encontrada = None
            for i, tarea in enumerate(tareas_temporales):
                if str(tarea['id']) == str(tarea_id):
                    tarea_encontrada = tarea
                    break
            
            if not tarea_encontrada:
                return JsonResponse({'error': 'Tarea no encontrada'}, status=404)
            
            # Verificar permisos: solo el creador puede editar
            if tarea_encontrada['creado_por_id'] != request.user.id:
                return JsonResponse({'error': 'Solo el creador puede editar la tarea'}, status=403)
            
            # Obtener el nombre del responsable
            responsable_nombre = tarea_encontrada['responsable']  # Mantener actual por defecto
            if responsable_id:
                try:
                    responsable_user = User.objects.get(id=responsable_id)
                    responsable_nombre = responsable_user.username
                except User.DoesNotExist:
                    pass  # Mantener el valor actual
            
            # Actualizar los campos de la tarea
            tarea_encontrada.update({
                'titulo': titulo,
                'descripcion': descripcion,
                'prioridad': prioridad,
                'fecha_limite': fecha_limite,
                'responsable': responsable_nombre,
                'responsable_id': responsable_id or tarea_encontrada['responsable_id'],
            })
            
            return JsonResponse({
                'success': True,
                'message': 'Tarea actualizada exitosamente',
                'tarea': tarea_encontrada
            })
            
        except Exception as e:
            return JsonResponse({
                'error': f'Error al actualizar la tarea: {str(e)}'
            }, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required  
def api_estadisticas_tareas_proyectos(request):
    """
    API para obtener estadísticas de tareas y proyectos
    """
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    # Por ahora, devolver estadísticas de ejemplo
    estadisticas = {
        'proyectos_activos': 2,
        'tareas_pendientes': 3,
        'tareas_completadas': 12,
        'progreso_general': 68
    }
    
    return JsonResponse({
        'success': True,
        **estadisticas
    })


@login_required
def api_buscar_usuarios(request):
    """
    API para buscar usuarios para agregar como miembros del proyecto
    """
    print(f"🔍 api_buscar_usuarios - Usuario: {request.user.username}, Autenticado: {request.user.is_authenticated}")
    
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)
    
    search_query = request.GET.get('q', '').strip()
    
    from django.contrib.auth.models import User
    
    if search_query and len(search_query) >= 2:
        # Buscar usuarios por nombre, apellido o username
        usuarios = User.objects.filter(
            Q(first_name__icontains=search_query) |
            Q(last_name__icontains=search_query) |
            Q(username__icontains=search_query)
        )[:100]  # Aumentamos el límite y permitimos mostrar al usuario actual
    else:
        # Si no hay query, devolver todos los usuarios (para mostrar lista completa)
        usuarios = User.objects.all().order_by('first_name', 'last_name', 'username')[:100]
    
    usuarios_data = []
    for usuario in usuarios:
        # Generar iniciales
        if usuario.first_name and usuario.last_name:
            iniciales = f"{usuario.first_name[0]}{usuario.last_name[0]}".upper()
            nombre_completo = f"{usuario.first_name} {usuario.last_name}"
        elif usuario.first_name:
            iniciales = usuario.first_name[0].upper()
            nombre_completo = usuario.first_name
        else:
            iniciales = usuario.username[0].upper() if usuario.username else "?"
            nombre_completo = usuario.username
        
        # Determinar rol/cargo
        if usuario.is_superuser:
            rol = "Administrador"
        elif hasattr(usuario, 'groups') and usuario.groups.filter(name='Supervisores').exists():
            rol = "Supervisor"
        else:
            rol = "Usuario"
        
        # Obtener avatar_url del usuario
        avatar_url = None
        if hasattr(usuario, 'userprofile'):
            try:
                avatar_url = usuario.userprofile.get_avatar_url()
                print(f"DEBUG: Avatar URL para {usuario.username}: {avatar_url}")
            except Exception as e:
                print(f"DEBUG: Error obteniendo avatar para {usuario.username}: {e}")
                avatar_url = None
        else:
            print(f"DEBUG: Usuario {usuario.username} no tiene UserProfile")
        
        usuarios_data.append({
            'id': usuario.id,
            'nombre': nombre_completo,
            'username': usuario.username,
            'iniciales': iniciales,
            'rol': rol,
            'email': usuario.email or '',
            'avatar_url': avatar_url
        })
    
    return JsonResponse({
        'success': True,
        'usuarios': usuarios_data
    })


@login_required
def api_crear_proyecto(request):
    """
    API para crear un nuevo proyecto con miembros y enviar notificaciones
    """
    print(f"🔍 Usuario: {request.user.username}, Autenticado: {request.user.is_authenticated}, Superusuario: {request.user.is_superuser}")
    
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        import json
        data = json.loads(request.body)
        
        # Validar datos requeridos
        nombre = data.get('nombre', '').strip()
        if not nombre:
            return JsonResponse({'error': 'El nombre del proyecto es requerido'}, status=400)
        
        descripcion = data.get('descripcion', '').strip()
        privacidad = data.get('privacidad', 'publico')
        tipo = data.get('tipo', 'runrate')
        miembros_ids = data.get('miembros', [])
        
        # Crear el proyecto real en la base de datos
        proyecto = Proyecto.objects.create(
            nombre=nombre,
            descripcion=descripcion,
            tipo=tipo,
            privacidad=privacidad,
            creado_por=request.user
        )
        
        # Crear comentario inicial con la descripción del proyecto (si existe)
        if descripcion.strip():
            ProyectoComentario.objects.create(
                proyecto=proyecto,
                usuario=request.user,
                contenido=f"📝 Proyecto creado: {descripcion}"
            )
        
        # Agregar miembros al proyecto y enviar notificaciones
        from django.contrib.auth.models import User
        miembros_notificados = []
        
        for miembro_id in miembros_ids:
            try:
                usuario = User.objects.get(id=miembro_id)
                # Agregar como miembro del proyecto
                proyecto.miembros.add(usuario)
                
                # Enviar notificación
                notificacion = notificar_miembro_agregado_proyecto(
                    usuario_agregado=usuario,
                    proyecto_nombre=nombre,
                    proyecto_id=proyecto.id,
                    usuario_que_agrega=request.user
                )
                if notificacion:
                    miembros_notificados.append({
                        'id': usuario.id,
                        'nombre': usuario.get_full_name() or usuario.username,
                        'notificado': True
                    })
            except User.DoesNotExist:
                continue
        
        print(f"✅ Proyecto '{nombre}' creado. Notificaciones enviadas a {len(miembros_notificados)} miembros.")
        
        return JsonResponse({
            'success': True,
            'mensaje': 'Proyecto creado exitosamente',
            'proyecto': {
                'id': proyecto.id,
                'nombre': proyecto.nombre,
                'descripcion': proyecto.descripcion,
                'privacidad': proyecto.privacidad,
                'tipo': proyecto.tipo,
                'miembros_notificados': miembros_notificados,
                'creado_por': request.user.get_full_name() or request.user.username,
                'fecha_creacion': proyecto.fecha_creacion.strftime('%Y-%m-%d')
            }
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Datos JSON inválidos'}, status=400)
    except Exception as e:
        print(f"❌ Error creando proyecto: {e}")
        return JsonResponse({'error': 'Error interno del servidor'}, status=500)


@login_required
def api_crear_tarea(request):
    """
    API para crear una nueva tarea independiente (sin proyecto)
    """
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        import json
        data = json.loads(request.body)
        
        # Validar datos requeridos
        nombre = data.get('nombre', '').strip()
        if not nombre:
            return JsonResponse({'error': 'El nombre de la tarea es requerido'}, status=400)
        
        descripcion = data.get('descripcion', '').strip()
        prioridad = data.get('prioridad', 'media')
        fecha_limite = data.get('fecha_limite')
        estimacion_horas = data.get('estimacion_horas')
        asignado_a_id = data.get('asignado_a')
        proyecto_id = data.get('proyecto_id')
        oportunidad_id = data.get('oportunidad_id')
        participantes_ids = data.get('participantes', [])
        observadores_ids = data.get('observadores', [])
        tarea_padre_id = data.get('tarea_padre_id')
        
        # Convertir fecha límite si está presente
        fecha_limite_obj = None
        
        if fecha_limite:
            from datetime import datetime
            try:
                # Intentar formato con hora primero (YYYY-MM-DDTHH:MM)
                fecha_limite_obj = datetime.strptime(fecha_limite, '%Y-%m-%dT%H:%M')
            except ValueError:
                try:
                    # Si falla, intentar solo fecha (YYYY-MM-DD) y agregar hora por defecto
                    fecha_limite_obj = datetime.strptime(fecha_limite + 'T23:59', '%Y-%m-%dT%H:%M')
                except ValueError:
                    print(f"⚠️ Formato de fecha_limite no válido: {fecha_limite}")
                    fecha_limite_obj = None
        
        # Obtener usuario asignado si se especificó
        asignado_a = None
        if asignado_a_id:
            try:
                from django.contrib.auth.models import User
                asignado_a = User.objects.get(id=asignado_a_id)
            except User.DoesNotExist:
                return JsonResponse({'error': 'Usuario asignado no encontrado'}, status=400)
        
        # Obtener proyecto si se especificó
        proyecto = None
        if proyecto_id:
            try:
                proyecto = Proyecto.objects.get(id=proyecto_id)
            except Proyecto.DoesNotExist:
                return JsonResponse({'error': 'Proyecto no encontrado'}, status=400)

        # Obtener oportunidad si se especificó
        oportunidad = None
        if oportunidad_id:
            try:
                oportunidad = TodoItem.objects.get(id=oportunidad_id)
            except TodoItem.DoesNotExist:
                return JsonResponse({'error': 'Oportunidad no encontrada'}, status=400)

        # Obtener tarea padre si se especificó (subtarea)
        tarea_padre = None
        if tarea_padre_id:
            try:
                tarea_padre = Tarea.objects.get(id=tarea_padre_id)
                # Heredar proyecto y oportunidad de la tarea padre si no se especificaron
                if not proyecto and tarea_padre.proyecto:
                    proyecto = tarea_padre.proyecto
                if not oportunidad and tarea_padre.oportunidad:
                    oportunidad = tarea_padre.oportunidad
            except Tarea.DoesNotExist:
                return JsonResponse({'error': 'Tarea padre no encontrada'}, status=400)

        # Crear la tarea en la base de datos
        tarea = Tarea.objects.create(
            titulo=nombre,
            descripcion=descripcion,
            prioridad=prioridad,
            estado='pendiente',
            creado_por=request.user,
            asignado_a=asignado_a,
            fecha_limite=fecha_limite_obj,
            proyecto=proyecto,
            oportunidad=oportunidad,
            tarea_padre=tarea_padre,
        )
        
        # Agregar participantes y observadores
        from django.contrib.auth.models import User as AuthUser
        for pid in participantes_ids:
            try:
                tarea.participantes.add(AuthUser.objects.get(id=pid))
            except Exception:
                pass
        for oid in observadores_ids:
            try:
                tarea.observadores.add(AuthUser.objects.get(id=oid))
            except Exception:
                pass

        # Crear comentario inicial si hay descripción
        if descripcion.strip():
            TareaComentario.objects.create(
                tarea=tarea,
                usuario=request.user,
                contenido=f"📝 Tarea creada: {descripcion}"
            )
        
        # Enviar notificación al usuario asignado
        if asignado_a:
            try:
                crear_notificacion(
                    usuario_destinatario=asignado_a,
                    tipo='tarea_asignada',
                    titulo='Nueva tarea asignada',
                    mensaje=f'Se te ha asignado la tarea "{nombre}"',
                    usuario_remitente=request.user,
                    tarea_id=tarea.id,
                    tarea_titulo=tarea.titulo
                )
            except Exception as e:
                print(f"⚠️ Error enviando notificación: {e}")
        
        return JsonResponse({
            'success': True,
            'message': 'Tarea creada exitosamente',
            'tarea': {
                'id': tarea.id,
                'titulo': tarea.titulo,
                'descripcion': tarea.descripcion,
                'prioridad': tarea.prioridad,
                'estado': tarea.estado,
                'creado_por': request.user.get_full_name() or request.user.username,
                'asignado_a': asignado_a.get_full_name() or asignado_a.username if asignado_a else None,
                'fecha_creacion': tarea.fecha_creacion.strftime('%Y-%m-%d'),
                'fecha_limite': tarea.fecha_limite.strftime('%Y-%m-%d') if tarea.fecha_limite else None
            }
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Datos JSON inválidos'}, status=400)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({'error': str(e), 'trace': traceback.format_exc()}, status=500)


@login_required
def api_comentarios_proyecto(request, proyecto_id):
    """
    API para obtener comentarios de un proyecto
    """
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        
        # Verificar permisos
        if proyecto.privacidad == 'privado':
            if request.user != proyecto.creado_por and request.user not in proyecto.miembros.all():
                return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        # Filtrar comentarios excluyendo los automáticos de configuración
        # PERO manteniendo comentarios de creación del proyecto y manuales
        comentarios = ProyectoComentario.objects.filter(
            proyecto=proyecto
        ).exclude(
            # Excluir comentarios que empiecen con patrones de configuración automática
            Q(contenido__startswith='📋 Configuración actualizada') |
            Q(contenido__startswith='⚙️ Configuración') |
            Q(contenido__startswith='🔧 Configuración') |
            Q(contenido__startswith='📊 Configuración') |
            Q(contenido__startswith='Configuración actualizada') |
            Q(contenido__startswith='Proyecto actualizado') |
            Q(contenido__startswith='Configuración modificada') |
            Q(contenido__contains='Miembro agregado al proyecto') |
            Q(contenido__contains='Miembro removido del proyecto') |
            Q(contenido__contains='Oportunidad ligada al proyecto') |
            Q(contenido__contains='Oportunidad removida del proyecto')
        ).order_by('-fecha_creacion')
        
        comentarios_data = []
        for comentario in comentarios:
            archivos_data = []
            for archivo in comentario.archivos.all():
                archivos_data.append({
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'tamaño': archivo.get_tamaño_legible(),
                    'icono': archivo.get_icono(),
                    'url': archivo.archivo.url,
                    'tipo': archivo.tipo_contenido
                })
            
            comentarios_data.append({
                'id': comentario.id,
                'contenido': getattr(comentario, 'get_contenido_con_menciones', lambda: comentario.contenido)(),
                'contenido_raw': comentario.contenido,
                'usuario': {
                    'id': comentario.usuario.id,
                    'nombre': comentario.usuario.get_full_name() or comentario.usuario.username,
                    'username': comentario.usuario.username,
                    'iniciales': ''.join([palabra[0].upper() for palabra in (comentario.usuario.get_full_name() or comentario.usuario.username).split()[:2]]),
                    'avatar_url': getattr(comentario.usuario.userprofile, 'get_avatar_url', lambda: None)() if hasattr(comentario.usuario, 'userprofile') else None
                },
                'fecha': comentario.fecha_creacion.strftime('%d de %b, %Y - %H:%M'),
                'fecha_edicion': comentario.fecha_edicion.strftime('%d de %b, %Y - %H:%M') if comentario.fecha_edicion else None,
                'editado': comentario.editado,
                'archivos': archivos_data,
                'puede_editar': comentario.usuario == request.user,
                'puede_eliminar': comentario.usuario == request.user or proyecto.creado_por == request.user
            })
        
        return JsonResponse({
            'success': True,
            'comentarios': comentarios_data
        })
        
    except Exception as e:
        print(f"Error obteniendo comentarios: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_agregar_comentario_proyecto(request, proyecto_id):
    """
    API para agregar un comentario a un proyecto
    """
    print(f"🔍 api_agregar_comentario_proyecto - Usuario: {request.user.username}, Proyecto ID: {proyecto_id}")
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        print(f"✅ Proyecto encontrado: {proyecto.nombre}")
        
        # Verificar permisos
        if proyecto.privacidad == 'privado':
            if request.user != proyecto.creado_por and request.user not in proyecto.miembros.all():
                return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        contenido = request.POST.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'error': 'El comentario no puede estar vacío'}, status=400)
        
        # Crear el comentario
        comentario = ProyectoComentario.objects.create(
            proyecto=proyecto,
            usuario=request.user,
            contenido=contenido
        )
        
        # Procesar archivos adjuntos
        archivos_data = []
        for key, file in request.FILES.items():
            if key.startswith('archivo_'):
                archivo = ProyectoArchivo.objects.create(
                    comentario=comentario,
                    archivo=file,
                    nombre_original=file.name,
                    tamaño=file.size,
                    tipo_contenido=file.content_type or ''
                )
                archivos_data.append({
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'tamaño': archivo.get_tamaño_legible(),
                    'icono': archivo.get_icono(),
                    'url': archivo.archivo.url,
                    'tipo': archivo.tipo_contenido
                })
        
        # Enviar notificaciones a usuarios mencionados
        usuarios_mencionados = comentario.extraer_menciones()
        for usuario_mencionado in usuarios_mencionados:
            if usuario_mencionado != request.user:  # No notificar al autor
                crear_notificacion(
                    usuario_destinatario=usuario_mencionado,
                    tipo='proyecto_agregado',
                    titulo=f"Te mencionaron en {proyecto.nombre}",
                    mensaje=f"{request.user.get_full_name() or request.user.username} te mencionó en el proyecto '{proyecto.nombre}': {contenido[:100]}...",
                    usuario_remitente=request.user,
                    proyecto_id=proyecto.id,
                    proyecto_nombre=proyecto.nombre
                )
        
        return JsonResponse({
            'success': True,
            'comentario': {
                'id': comentario.id,
                'contenido': getattr(comentario, 'get_contenido_con_menciones', lambda: comentario.contenido)(),
                'contenido_raw': comentario.contenido,
                'usuario': {
                    'id': comentario.usuario.id,
                    'nombre': comentario.usuario.get_full_name() or comentario.usuario.username,
                    'username': comentario.usuario.username,
                    'iniciales': ''.join([palabra[0].upper() for palabra in (comentario.usuario.get_full_name() or comentario.usuario.username).split()[:2]])
                },
                'fecha': comentario.fecha_creacion.strftime('%d de %b, %Y - %H:%M'),
                'fecha_edicion': None,
                'editado': False,
                'archivos': archivos_data,
                'puede_editar': True,
                'puede_eliminar': True
            }
        })
        
    except Exception as e:
        print(f"Error agregando comentario: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_editar_comentario_proyecto(request, comentario_id):
    """
    API para editar un comentario de proyecto
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(ProyectoComentario, id=comentario_id)
        
        # Verificar permisos
        if comentario.usuario != request.user:
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        contenido = request.POST.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'error': 'El comentario no puede estar vacío'}, status=400)
        
        comentario.contenido = contenido
        comentario.save()
        
        return JsonResponse({
            'success': True,
            'contenido': comentario.get_contenido_con_menciones(),
            'fecha_edicion': comentario.fecha_edicion.strftime('%d de %b, %Y - %H:%M')
        })
        
    except Exception as e:
        print(f"Error editando comentario: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_eliminar_comentario_proyecto(request, comentario_id):
    """
    API para eliminar un comentario de proyecto
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(ProyectoComentario, id=comentario_id)
        
        # Verificar permisos (autor del comentario o creador del proyecto)
        if comentario.usuario != request.user and comentario.proyecto.creado_por != request.user:
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        comentario.delete()
        
        return JsonResponse({'success': True})
        
    except Exception as e:
        print(f"Error eliminando comentario: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_configuracion_proyecto(request, proyecto_id):
    """
    API para actualizar la configuración completa de un proyecto
    """
    print(f"🔍 api_configuracion_proyecto - Usuario: {request.user.username}, Proyecto ID: {proyecto_id}")
    print(f"🔍 Método de request: {request.method}")
    print(f"🔍 Content-Type: {request.content_type}")
    print(f"🔍 Request body: {request.body}")
    
    if request.method != 'PUT':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        print(f"🔍 Proyecto encontrado: {proyecto.nombre}")
        
        # Verificar permisos - solo el creador puede modificar la configuración
        if proyecto.creado_por != request.user:
            print(f"❌ Sin permisos: proyecto creado por {proyecto.creado_por}, usuario actual {request.user}")
            return JsonResponse({'error': 'Sin permisos para modificar este proyecto'}, status=403)
        
        import json
        data = json.loads(request.body)
        print(f"🔍 Datos recibidos: {data}")
        
        # Actualizar información básica
        if 'nombre' in data:
            nombre = data['nombre'].strip()
            if not nombre:
                return JsonResponse({'error': 'El nombre del proyecto es requerido'}, status=400)
            proyecto.nombre = nombre
        
        if 'descripcion' in data:
            proyecto.descripcion = data['descripcion'].strip()
        
        if 'tipo' in data:
            if data['tipo'] in ['runrate', 'ingenieria']:
                proyecto.tipo = data['tipo']
        
        if 'privacidad' in data:
            if data['privacidad'] in ['publico', 'privado']:
                proyecto.privacidad = data['privacidad']
        
        # El campo responsable no existe en el modelo Proyecto
        # Se usa creado_por como responsable del proyecto
        
        # Actualizar miembros
        if 'miembros_ids' in data:
            from django.contrib.auth.models import User
            miembros_ids = data['miembros_ids']
            
            # Limpiar miembros actuales
            proyecto.miembros.clear()
            
            # Agregar nuevos miembros
            for miembro_id in miembros_ids:
                try:
                    usuario = User.objects.get(id=miembro_id)
                    proyecto.miembros.add(usuario)
                    
                    # Enviar notificación si es un miembro nuevo (con try/catch para evitar errores)
                    try:
                        notificar_miembro_agregado_proyecto(
                            usuario_agregado=usuario,
                            proyecto_nombre=proyecto.nombre,
                            proyecto_id=proyecto.id,
                            usuario_que_agrega=request.user
                        )
                    except Exception as notif_error:
                        print(f"⚠️ Error enviando notificación: {notif_error}")
                        # Continuar sin fallar el guardado por error de notificación
                        
                except User.DoesNotExist:
                    continue
        
        # Actualizar oportunidad ligada
        # Manejar oportunidades ligadas
        if 'oportunidades_ids' in data:
            oportunidades_ids = data['oportunidades_ids']
            print(f"🔗 Oportunidades a ligar: {oportunidades_ids}")
            
            # Limpiar oportunidades actuales
            proyecto.oportunidades_ligadas.clear()
            
            # Agregar nuevas oportunidades
            if oportunidades_ids:
                for oportunidad_id in oportunidades_ids:
                    try:
                        oportunidad = TodoItem.objects.get(id=oportunidad_id)
                        proyecto.oportunidades_ligadas.add(oportunidad)
                        print(f"✅ Oportunidad ligada: {oportunidad.oportunidad}")
                    except TodoItem.DoesNotExist:
                        print(f"❌ Oportunidad con ID {oportunidad_id} no encontrada")
                        return JsonResponse({'error': f'Oportunidad con ID {oportunidad_id} no encontrada'}, status=400)
            else:
                print("✅ Todas las oportunidades desligadas")
        
        # Guardar cambios
        proyecto.save()
        
        # Comentarios del sistema temporalmente deshabilitados para evitar errores
        # TODO: Reactivar cuando se resuelvan los problemas de modelo ProyectoComentario
        print(f"📝 Cambios realizados en proyecto '{proyecto.nombre}': {list(data.keys())}")
        
        print(f"✅ Configuración del proyecto '{proyecto.nombre}' actualizada exitosamente")
        
        return JsonResponse({
            'success': True,
            'mensaje': 'Configuración actualizada exitosamente',
            'proyecto': {
                'id': proyecto.id,
                'nombre': proyecto.nombre,
                'descripcion': proyecto.descripcion,
                'tipo': proyecto.tipo,
                'privacidad': proyecto.privacidad,
                'creado_por': proyecto.creado_por.get_full_name() or proyecto.creado_por.username,
                'miembros_count': proyecto.miembros.count(),
                'miembros': list(proyecto.miembros.values_list('id', flat=True)),
                'oportunidades_ligadas': [
                    {
                        'id': oportunidad.id,
                        'titulo': oportunidad.oportunidad,
                        'cliente': oportunidad.cliente.nombre_empresa if oportunidad.cliente else 'Sin cliente'
                    }
                    for oportunidad in proyecto.oportunidades_ligadas.all()
                ]
            }
        })
        
    except json.JSONDecodeError as e:
        print(f"❌ Error de JSON: {e}")
        return JsonResponse({'error': 'Datos JSON inválidos'}, status=400)
    except Exception as e:
        import traceback
        print(f"❌ Error actualizando configuración: {e}")
        print(f"❌ Traceback completo: {traceback.format_exc()}")
        return JsonResponse({'error': f'Error interno del servidor: {str(e)}'}, status=500)


@login_required
def api_buscar_oportunidades_proyecto(request):
    """
    API para buscar oportunidades para vincular con un proyecto
    """
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)
    
    query = request.GET.get('q', '').strip()
    
    try:
        if not query or len(query) < 2:
            # Si no hay query, devolver las últimas 5 oportunidades
            if is_supervisor(request.user):
                oportunidades = TodoItem.objects.select_related('cliente').order_by('-fecha_creacion')[:5]
            else:
                # Usuario regular solo ve sus oportunidades
                oportunidades = TodoItem.objects.filter(
                    usuario=request.user
                ).select_related('cliente').order_by('-fecha_creacion')[:5]
        else:
            # Buscar oportunidades por título, cliente o comentarios
            if is_supervisor(request.user):
                oportunidades = TodoItem.objects.filter(
                    Q(oportunidad__icontains=query) |
                    Q(cliente__nombre_empresa__icontains=query) |
                    Q(comentarios__icontains=query)
                ).select_related('cliente').order_by('-fecha_creacion')[:10]
            else:
                # Usuario regular solo ve sus oportunidades
                oportunidades = TodoItem.objects.filter(
                    usuario=request.user
                ).filter(
                    Q(oportunidad__icontains=query) |
                    Q(cliente__nombre_empresa__icontains=query) |
                    Q(comentarios__icontains=query)
                ).select_related('cliente').order_by('-fecha_creacion')[:10]
        
        oportunidades_data = []
        for oportunidad in oportunidades:
            oportunidades_data.append({
                'id': oportunidad.id,
                'titulo': oportunidad.oportunidad,
                'cliente__nombre_empresa': oportunidad.cliente.nombre_empresa if oportunidad.cliente else 'Cliente no asignado',
                'monto': float(oportunidad.monto) if oportunidad.monto else 0,
                'probabilidad': oportunidad.probabilidad_cierre,
                'mes_cierre': oportunidad.get_mes_cierre_display(),
                'usuario': oportunidad.usuario.get_full_name() or oportunidad.usuario.username
            })
        
        return JsonResponse({
            'success': True,
            'oportunidades': oportunidades_data
        })
        
    except Exception as e:
        print(f"❌ Error buscando oportunidades: {e}")
        return JsonResponse({'error': 'Error interno del servidor'}, status=500)


@login_required
@csrf_exempt
def actividad_list_create(request):
    """
    API para listar y crear actividades del calendario.
    """
    try:
        if request.method == 'GET':
            if is_supervisor(request.user):
                actividades = Actividad.objects.all()
            else:
                    actividades = Actividad.objects.filter(Q(creado_por=request.user) | Q(participantes=request.user)).distinct()

            # Filtro por vendedores (IDs separados por coma)
            vendedores_param = request.GET.get('vendedores', '').strip()
            if vendedores_param and is_supervisor(request.user):
                try:
                    ids = [int(x) for x in vendedores_param.split(',') if x.strip().isdigit()]
                    if ids:
                        actividades = actividades.filter(creado_por_id__in=ids)
                except Exception:
                    pass

            # Filtro por mes (YYYY-MM)
            mes_param = request.GET.get('mes', '').strip()
            if mes_param:
                try:
                    from datetime import datetime as _dt
                    year, month = int(mes_param[:4]), int(mes_param[5:7])
                    from django.utils import timezone as _tz
                    import calendar as _cal
                    last_day = _cal.monthrange(year, month)[1]
                    desde = _tz.make_aware(_dt(year, month, 1, 0, 0, 0))
                    hasta = _tz.make_aware(_dt(year, month, last_day, 23, 59, 59))
                    actividades = actividades.filter(fecha_inicio__lte=hasta, fecha_fin__gte=desde)
                except Exception:
                    pass

            # Filtro por oportunidad
            oportunidad_id = request.GET.get('oportunidad_id', '').strip()
            if oportunidad_id:
                actividades = actividades.filter(oportunidad_id=oportunidad_id)

            actividades = actividades.select_related('creado_por', 'oportunidad').prefetch_related('participantes')

            events = []
            _1h = timedelta(hours=1)
            for actividad in actividades:
                participants_data = [{'id': p.id, 'text': p.get_full_name() or p.username} for p in actividad.participantes.all()]
                opportunity_data = None
                if actividad.oportunidad:
                    opportunity_data = {'id': actividad.oportunidad.id, 'text': actividad.oportunidad.oportunidad, 'monto': float(actividad.oportunidad.monto or 0)}
                # Clampar eventos multi-día a 1h para que no crucen semanas en el calendario
                fin_display = actividad.fecha_fin
                if (fin_display - actividad.fecha_inicio).days >= 1:
                    fin_display = actividad.fecha_inicio + _1h
                events.append({
                    'id': actividad.id,
                    'title': actividad.titulo,
                    'tipo': actividad.tipo_actividad,
                    'start': actividad.fecha_inicio.isoformat(),
                    'end': fin_display.isoformat(),
                    'description': actividad.descripcion or '',
                    'color': actividad.color,
                    'participants': participants_data,
                    'opportunity': opportunity_data,
                    'creado_por': {'id': actividad.creado_por.id, 'text': actividad.creado_por.get_full_name() or actividad.creado_por.username},
                    'es_mio': actividad.creado_por_id == request.user.pk,
                    'completada': actividad.completada,
                })
            return JsonResponse(events, safe=False)

        elif request.method == 'POST':
            data = json.loads(request.body)

            # Validar fechas
            try:
                start_date = datetime.fromisoformat(data['start'])
                end_date = datetime.fromisoformat(data['end'])
                if timezone.is_naive(start_date):
                    start_date = timezone.make_aware(start_date)
                if timezone.is_naive(end_date):
                    end_date = timezone.make_aware(end_date)
            except ValueError:
                return JsonResponse({'error': 'Formato de fecha inválido.'}, status=400)

            actividad = Actividad.objects.create(
                titulo=data['title'],
                tipo_actividad=data.get('tipo', 'otro'),
                descripcion=data.get('description', ''),
                fecha_inicio=start_date,
                fecha_fin=end_date,
                creado_por=request.user,
                color=data.get('color', '#1D1D1F'),
                oportunidad_id=data.get('opportunity')
            )
        
            if 'participants' in data and data['participants']:
                actividad.participantes.set(data['participants'])

            # Registrar en chat de grupo si programó actividad para compañero
            try:
                from .views_grupos import registrar_accion_grupo
                actor_nombre = request.user.get_full_name() or request.user.username
                for p in actividad.participantes.all():
                    if p != request.user:
                        prop_nombre = p.get_full_name() or p.username
                        registrar_accion_grupo(
                            request.user, p,
                            'programar_actividad',
                            f'{actor_nombre} programó la actividad "{actividad.titulo}" para {prop_nombre}',
                            objeto_tipo='actividad', objeto_id=actividad.id, objeto_titulo=actividad.titulo,
                        )
            except Exception:
                pass

            participants_data = []
            for p in actividad.participantes.all():
                participants_data.append({'id': p.id, 'text': p.get_full_name() or p.username})

            opportunity_data = None
            if actividad.oportunidad:
                opportunity_data = {'id': actividad.oportunidad.id, 'text': actividad.oportunidad.oportunidad, 'monto': float(actividad.oportunidad.monto or 0)}

            return JsonResponse({
                'id': actividad.id,
                'title': actividad.titulo,
                'tipo': actividad.tipo_actividad,
                'start': actividad.fecha_inicio.isoformat(),
                'end': actividad.fecha_fin.isoformat(),
                'description': actividad.descripcion,
                'color': actividad.color,
                'participants': participants_data,
                'opportunity': opportunity_data,
                'creado_por': {'id': actividad.creado_por.id, 'text': actividad.creado_por.get_full_name() or actividad.creado_por.username},
                'es_mio': True,
            }, status=201)
    
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    except Exception as e:
        import traceback
        return JsonResponse({'error': str(e), 'trace': traceback.format_exc()}, status=500)


@login_required
@csrf_exempt
def actividad_detail(request, pk):
    """
    API para obtener, actualizar o eliminar una actividad específica.
    """
    actividad = get_object_or_404(Actividad, pk=pk)

    # Verificar permisos: creador, participante, supervisor o compañero de grupo
    if actividad.creado_por != request.user and request.user not in actividad.participantes.all() and not is_supervisor(request.user):
        from .views_grupos import comparten_grupo
        if not comparten_grupo(request.user, actividad.creado_por):
            return JsonResponse({'error': 'No tienes permiso para acceder a esta actividad.'}, status=403)

    if request.method == 'GET':
        participants_data = []
        for p in actividad.participantes.all():
            participants_data.append({'id': p.id, 'text': p.get_full_name() or p.username})
        
        opportunity_data = None
        if actividad.oportunidad:
            opportunity_data = {'id': actividad.oportunidad.id, 'text': actividad.oportunidad.oportunidad}

        return JsonResponse({
            'id': actividad.id,
            'title': actividad.titulo,
            'tipo': actividad.tipo_actividad,
            'start': actividad.fecha_inicio.isoformat(),
            'end': actividad.fecha_fin.isoformat(),
            'description': actividad.descripcion,
            'color': actividad.color,
            'participants': participants_data,
            'opportunity': opportunity_data,
            'creado_por': {'id': actividad.creado_por.id, 'text': actividad.creado_por.get_full_name() or actividad.creado_por.username},
            'es_mio': actividad.creado_por_id == request.user.pk,
            'completada': actividad.completada,
        })

    elif request.method == 'PATCH':
        # Marcar como completada (puede hacerlo el creador, un participante, supervisor o compañero de grupo)
        es_participante = actividad.participantes.filter(pk=request.user.pk).exists()
        from .views_grupos import comparten_grupo
        es_companero = comparten_grupo(request.user, actividad.creado_por) if actividad.creado_por != request.user else False
        if actividad.creado_por != request.user and not es_participante and not is_supervisor(request.user) and not es_companero:
            return JsonResponse({'error': 'No tienes permiso para completar esta actividad.'}, status=403)
        data = json.loads(request.body)
        if 'completada' in data:
            actividad.completada = data['completada']
            actividad.save(update_fields=['completada'])
            # Si es actividad de prospecto (morada), también completar la ProspectoActividad
            if actividad.color == '#8B5CF6' and actividad.completada:
                try:
                    from .models import ProspectoActividad
                    # Buscar la ProspectoActividad más cercana por fecha y título
                    pa = ProspectoActividad.objects.filter(
                        descripcion=actividad.titulo,
                        usuario=actividad.creado_por,
                        completada=False,
                    ).order_by('fecha_programada').first()
                    if pa:
                        pa.completada = True
                        pa.save(update_fields=['completada'])
                except Exception:
                    pass
            # Registrar en chat de grupo si completó actividad de otro
            if actividad.completada and actividad.creado_por != request.user:
                try:
                    from .views_grupos import registrar_accion_grupo
                    actor_nombre = request.user.get_full_name() or request.user.username
                    prop_nombre = actividad.creado_por.get_full_name() or actividad.creado_por.username
                    registrar_accion_grupo(
                        request.user, actividad.creado_por,
                        'completar_actividad',
                        f'{actor_nombre} completó la actividad "{actividad.titulo}" de {prop_nombre}',
                        objeto_tipo='actividad', objeto_id=actividad.id, objeto_titulo=actividad.titulo,
                    )
                except Exception:
                    pass
        return JsonResponse({'id': actividad.id, 'completada': actividad.completada})

    elif request.method == 'PUT':
        data = json.loads(request.body)

        # Verificar permisos: solo el creador o un supervisor puede editar
        if actividad.creado_por != request.user and not is_supervisor(request.user):
            return JsonResponse({'error': 'No tienes permiso para editar esta actividad.'}, status=403)

        # Validar fechas
        try:
            start_date = datetime.fromisoformat(data['start'])
            end_date = datetime.fromisoformat(data['end'])
            if timezone.is_naive(start_date):
                start_date = timezone.make_aware(start_date)
            if timezone.is_naive(end_date):
                end_date = timezone.make_aware(end_date)
        except ValueError:
            return JsonResponse({'error': 'Formato de fecha inválido.'}, status=400)

        actividad.titulo = data['title']
        actividad.tipo_actividad = data.get('tipo', 'otro')
        actividad.descripcion = data.get('description', '')
        actividad.fecha_inicio = start_date
        actividad.fecha_fin = end_date
        actividad.color = data.get('color', '#007AFF')
        actividad.oportunidad_id = data.get('opportunity')
        actividad.save()

        if 'participants' in data and data['participants'] is not None:
            actividad.participantes.set(data['participants'])
        else:
            actividad.participantes.clear() # Clear if no participants are sent

        participants_data = []
        for p in actividad.participantes.all():
            participants_data.append({'id': p.id, 'text': p.get_full_name() or p.username})

        opportunity_data = None
        if actividad.oportunidad:
            opportunity_data = {'id': actividad.oportunidad.id, 'text': actividad.oportunidad.oportunidad}

        return JsonResponse({
            'id': actividad.id,
            'title': actividad.titulo,
            'tipo': actividad.tipo_actividad,
            'start': actividad.fecha_inicio.isoformat(),
            'end': actividad.fecha_fin.isoformat(),
            'description': actividad.descripcion,
            'color': actividad.color,
            'participants': participants_data,
            'opportunity': opportunity_data,
            'creado_por': {'id': actividad.creado_por.id, 'text': actividad.creado_por.get_full_name() or actividad.creado_por.username},
            'es_mio': actividad.creado_por_id == request.user.pk,
        })

    elif request.method == 'DELETE':
        # Pueden completar/eliminar: el creador, los participantes o un supervisor
        es_participante = actividad.participantes.filter(pk=request.user.pk).exists()
        if actividad.creado_por != request.user and not es_participante and not is_supervisor(request.user):
            return JsonResponse({'error': 'No tienes permiso para eliminar esta actividad.'}, status=403)

        actividad.delete()
        return JsonResponse({'message': 'Actividad eliminada exitosamente'}, status=204)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def user_list_api(request):
    """
    API para obtener una lista de usuarios para Select2.
    """
    search_query = request.GET.get('q', '')
    users = User.objects.filter(
        Q(username__icontains=search_query) | 
        Q(first_name__icontains=search_query) | 
        Q(last_name__icontains=search_query)
    ).order_by('username')[:20] # Limitar resultados
    
    results = []
    for user in users:
        avatar_url = None
        if hasattr(user, 'userprofile'):
            try:
                avatar_url = user.userprofile.get_avatar_url()
            except:
                avatar_url = None
        results.append({
            'id': user.id, 
            'text': user.get_full_name() or user.username,
            'avatar_url': avatar_url
        })
    return JsonResponse(results, safe=False)


@login_required
def oportunidad_list_api(request):
    """
    API para obtener una lista de oportunidades para Select2.
    """
    search_query = request.GET.get('q', '')
    
    if is_supervisor(request.user):
        oportunidades = TodoItem.objects.filter(
            Q(oportunidad__icontains=search_query) |
            Q(cliente__nombre_empresa__icontains=search_query)
        ).order_by('-fecha_creacion')[:20]
    else:
        oportunidades = TodoItem.objects.filter(
            Q(usuario=request.user) &
            (Q(oportunidad__icontains=search_query) |
            Q(cliente__nombre_empresa__icontains=search_query))
        ).order_by('-fecha_creacion')[:20]
    
    results = []
    for op in oportunidades:
        results.append({'id': op.id, 'text': f"{op.oportunidad} ({op.cliente.nombre_empresa if op.cliente else 'Sin Cliente'})", 'title': op.oportunidad})
    return JsonResponse(results, safe=False)


@login_required
def api_tarea_detalle(request, tarea_id):
    """
    API para obtener detalles de una tarea específica
    """
    if request.method == 'GET':
        try:
            # Buscar la tarea en la base de datos
            tarea = Tarea.objects.get(id=tarea_id)
            
            # Cualquier usuario autenticado puede ver tareas (accedidas desde el CRM)
            pass
            
            # Función auxiliar para obtener datos del usuario con avatar
            def get_user_data(user):
                if not user:
                    return None
                
                user_data = {
                    'id': user.id,
                    'nombre': user.get_full_name() or user.username,
                    'username': user.username,
                    'avatar_url': None
                }
                
                # Intentar obtener avatar del UserProfile
                try:
                    if hasattr(user, 'userprofile') and user.userprofile.avatar:
                        user_data['avatar_url'] = user.userprofile.avatar.url
                except:
                    pass
                
                return user_data
            
            # Formatear tiempo trabajado
            tiempo_total_str = "00:00:00"
            tiempo_total_segundos = 0
            if hasattr(tarea, 'tiempo_trabajado') and tarea.tiempo_trabajado:
                tiempo_total_segundos = int(tarea.tiempo_trabajado.total_seconds())
                hours = tiempo_total_segundos // 3600
                minutes = (tiempo_total_segundos % 3600) // 60
                seconds = tiempo_total_segundos % 60
                tiempo_total_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

            # Preparar datos de la tarea
            tarea_data = {
                'id': tarea.id,
                'titulo': tarea.titulo,
                'descripcion': tarea.descripcion,
                'descripcion_html': tarea.get_descripcion_html(),
                'estado': tarea.estado,
                'prioridad': tarea.prioridad,
                'proyecto_nombre': tarea.proyecto.nombre if tarea.proyecto else 'Sin proyecto',
                'proyecto_id': tarea.proyecto.id if tarea.proyecto else None,
                'creado_por': tarea.creado_por.get_full_name() or tarea.creado_por.username,
                'creado_por_data': get_user_data(tarea.creado_por),
                'responsable': tarea.asignado_a.get_full_name() or tarea.asignado_a.username if tarea.asignado_a else None,
                'responsable_data': get_user_data(tarea.asignado_a) if tarea.asignado_a else None,
                'fecha_limite': tarea.fecha_limite.isoformat() if tarea.fecha_limite else None,
                'fecha_creacion': tarea.fecha_creacion.isoformat(),
                'fecha_completada': tarea.fecha_completada.isoformat() if tarea.fecha_completada else None,
                'participantes': [get_user_data(p) for p in tarea.participantes.all()] if hasattr(tarea, 'participantes') else [],
                'observadores': [get_user_data(o) for o in tarea.observadores.all()] if hasattr(tarea, 'observadores') else [],
                # Datos del cronómetro
                'trabajando_actualmente': getattr(tarea, 'trabajando_actualmente', False),
                'pausado': getattr(tarea, 'pausado', False),
                'tiempo_trabajado': tiempo_total_str,
                'tiempo_total_trabajado': tiempo_total_segundos,
                'fecha_inicio_sesion': tarea.fecha_inicio_sesion.isoformat() if hasattr(tarea, 'fecha_inicio_sesion') and tarea.fecha_inicio_sesion else None,
                # Oportunidad y cliente
                'oportunidad_id': tarea.oportunidad.id if tarea.oportunidad else None,
                'oportunidad_nombre': tarea.oportunidad.oportunidad if tarea.oportunidad else None,
                # Cliente: primero el directo, luego el de la oportunidad
                'cliente_id': (tarea.cliente.id if tarea.cliente else (tarea.oportunidad.cliente.id if tarea.oportunidad and tarea.oportunidad.cliente else None)),
                'cliente_nombre': (tarea.cliente.nombre_empresa if tarea.cliente else (tarea.oportunidad.cliente.nombre_empresa if tarea.oportunidad and tarea.oportunidad.cliente else None)),
                # Subtareas
                'tarea_padre_id': tarea.tarea_padre_id,
                'tarea_padre_titulo': tarea.tarea_padre.titulo if tarea.tarea_padre else None,
                'subtareas': [{
                    'id': st.id,
                    'titulo': st.titulo,
                    'estado': st.estado,
                    'prioridad': st.prioridad,
                    'asignado_a': st.asignado_a.get_full_name() if st.asignado_a else None,
                    'fecha_limite': st.fecha_limite.strftime('%Y-%m-%d') if st.fecha_limite else None,
                } for st in tarea.subtareas.all().order_by('fecha_creacion')],
            }

            return JsonResponse(tarea_data)
            
        except Tarea.DoesNotExist:
            return JsonResponse({'error': 'Tarea no encontrada'}, status=404)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    elif request.method == 'PUT':
        try:
            import json
            from django.db import transaction
            data = json.loads(request.body)
            
            print(f"🔍 PUT request data: {data}")
            print(f"🔍 User making request: {request.user.username}")
            
            # Usar transacción atómica para asegurar consistencia
            with transaction.atomic():
                # Buscar la tarea
                tarea = Tarea.objects.get(id=tarea_id)
                print(f"🔍 Tarea encontrada: {tarea.titulo} (ID: {tarea.id})")
                
                # Verificar permisos - creador, admin o compañero de grupo
                from .views_grupos import comparten_grupo as _cg
                involucrados = [u for u in [tarea.asignado_a, tarea.creado_por] if u and u != request.user]
                user_can_edit = (
                    tarea.creado_por == request.user or
                    request.user.is_superuser or
                    any(_cg(request.user, u) for u in involucrados)
                )
                
                print(f"🔍 Permisos - Creador: {tarea.creado_por.username}, Current: {request.user.username}, Can edit: {user_can_edit}")
                
                if not user_can_edit:
                    return JsonResponse({'error': 'Sin permisos para modificar esta tarea'}, status=403)
                
                # Obtener datos de la petición
                user_id = data.get('user_id')
                action = data.get('action')  # 'add' o 'remove'
                tipo = data.get('tipo')      # 'participantes' o 'observadores'
                
                print(f"🔍 Datos: user_id={user_id}, action={action}, tipo={tipo}")
                
                if not all([user_id, action, tipo]):
                    return JsonResponse({'error': 'Datos faltantes: user_id, action y tipo son requeridos'}, status=400)
                
                # Obtener usuario
                try:
                    usuario = User.objects.get(id=user_id)
                    print(f"🔍 Usuario encontrado: {usuario.username} ({usuario.get_full_name()})")
                except User.DoesNotExist:
                    return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
                
                # Verificar estado actual antes del cambio
                if tipo == 'participantes':
                    current_participantes = list(tarea.participantes.all())
                    print(f"🔍 Participantes actuales ANTES: {[p.username for p in current_participantes]}")
                elif tipo == 'observadores':
                    current_observadores = list(tarea.observadores.all())
                    print(f"🔍 Observadores actuales ANTES: {[o.username for o in current_observadores]}")
                
                # Aplicar cambios según el tipo
                if tipo == 'participantes':
                    if action == 'add':
                        tarea.participantes.add(usuario)
                        print(f"✅ AGREGADO como participante: {usuario.username}")
                        mensaje = f"{usuario.get_full_name() or usuario.username} ha sido agregado como participante a la tarea '{tarea.titulo}'"
                    elif action == 'remove':
                        tarea.participantes.remove(usuario)
                        print(f"❌ REMOVIDO como participante: {usuario.username}")
                        mensaje = f"{usuario.get_full_name() or usuario.username} ha sido removido como participante de la tarea '{tarea.titulo}'"
                elif tipo == 'observadores':
                    if action == 'add':
                        tarea.observadores.add(usuario)
                        print(f"✅ AGREGADO como observador: {usuario.username}")
                        mensaje = f"{usuario.get_full_name() or usuario.username} ha sido agregado como observador a la tarea '{tarea.titulo}'"
                    elif action == 'remove':
                        tarea.observadores.remove(usuario)
                        print(f"❌ REMOVIDO como observador: {usuario.username}")
                        mensaje = f"{usuario.get_full_name() or usuario.username} ha sido removido como observador de la tarea '{tarea.titulo}'"
                else:
                    return JsonResponse({'error': 'Tipo inválido. Use "participantes" o "observadores"'}, status=400)
                
                # Guardar cambios
                tarea.save()
                print(f"💾 Tarea guardada")
                
                # Verificar estado después del cambio
                if tipo == 'participantes':
                    new_participantes = list(tarea.participantes.all())
                    print(f"🔍 Participantes actuales DESPUÉS: {[p.username for p in new_participantes]}")
                elif tipo == 'observadores':
                    new_observadores = list(tarea.observadores.all())
                    print(f"🔍 Observadores actuales DESPUÉS: {[o.username for o in new_observadores]}")
                
                # Enviar notificación al usuario agregado
                if action == 'add':
                    try:
                        from .models import Notificacion
                        
                        # Determinar el tipo de notificación
                        tipo_notificacion = 'tarea_participante' if tipo == 'participantes' else 'tarea_observador'
                        
                        # Crear la notificación
                        notificacion = Notificacion.objects.create(
                            usuario_destinatario=usuario,
                            usuario_remitente=request.user,
                            tipo=tipo_notificacion,
                            titulo=f"Agregado a tarea: {tarea.titulo}",
                            mensaje=mensaje,
                            tarea_id=tarea.id,
                            tarea_titulo=tarea.titulo,
                            proyecto_id=tarea.proyecto.id if tarea.proyecto else None,
                            proyecto_nombre=tarea.proyecto.nombre if tarea.proyecto else None
                        )
                        
                        print(f"🔔 Notificación creada para {usuario.username}: {notificacion.titulo}")
                        
                    except Exception as e:
                        print(f"❌ Error creando notificación: {e}")
                        # No fallar si hay error en notificación, solo loggearlo
                
                return JsonResponse({
                    'success': True,
                    'message': mensaje,
                    'user_data': {
                        'id': usuario.id,
                        'nombre': usuario.get_full_name() or usuario.username,
                        'username': usuario.username,
                        'avatar_url': usuario.userprofile.get_avatar_url() if hasattr(usuario, 'userprofile') else None
                    }
                })
            
        except Tarea.DoesNotExist:
            return JsonResponse({'error': 'Tarea no encontrada'}, status=404)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required 
def api_notificaciones(request):
    """
    API para obtener notificaciones del usuario actual
    """
    if request.method == 'GET':
        try:
            # Obtener notificaciones no leídas del usuario
            notificaciones = request.user.notificaciones.filter(leida=False).order_by('-fecha_creacion')[:10]
            
            notificaciones_data = []
            for notif in notificaciones:
                notificaciones_data.append({
                    'id': notif.id,
                    'tipo': notif.tipo,
                    'titulo': notif.titulo,
                    'mensaje': notif.mensaje,
                    'url': notif.url,
                    'fecha_creacion': notif.fecha_creacion.isoformat(),
                    'creado_por': notif.creado_por.get_full_name() or notif.creado_por.username if notif.creado_por else None
                })
            
            return JsonResponse({
                'success': True,
                'notificaciones': notificaciones_data,
                'total_no_leidas': request.user.notificaciones.filter(leida=False).count()
            })
            
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    elif request.method == 'PUT':
        try:
            import json
            data = json.loads(request.body)
            
            # Marcar notificación como leída
            notif_id = data.get('id')
            if notif_id:
                from .models import Notificacion
                notificacion = Notificacion.objects.get(id=notif_id, usuario=request.user)
                notificacion.leida = True
                notificacion.save()
                
                return JsonResponse({'success': True, 'message': 'Notificación marcada como leída'})
            else:
                return JsonResponse({'error': 'ID de notificación requerido'}, status=400)
                
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_toggle_task_timer(request, tarea_id):
    """
    API para iniciar/pausar el cronómetro de una tarea
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        # Importaciones necesarias
        from datetime import datetime, timezone, timedelta
        from .models import Tarea
        import json
        
        # Obtener la tarea
        tarea = get_object_or_404(Tarea, id=tarea_id)
        
        # Verificar permisos - solo el asignado puede iniciar/pausar
        if request.user != tarea.asignado_a and not request.user.is_superuser:
            return JsonResponse({'error': 'Solo el responsable puede iniciar/pausar esta tarea'}, status=403)
        
        # Obtener acción del request
        data = json.loads(request.body) if request.body else {}
        action = data.get('action', 'toggle')  # 'start', 'pause', 'toggle'
        
        ahora = datetime.now(timezone.utc)
        
        if not tarea.trabajando_actualmente:
            # INICIAR TAREA
            tarea.trabajando_actualmente = True
            tarea.fecha_inicio_sesion = ahora
            tarea.estado = 'en_progreso'
            tarea.pausado = False
            
            mensaje = f"Tarea iniciada. Cronómetro en marcha."
            
        else:
            # PAUSAR TAREA
            if tarea.fecha_inicio_sesion:
                # Calcular tiempo trabajado en esta sesión
                tiempo_sesion = ahora - tarea.fecha_inicio_sesion
                # Sumar al tiempo total trabajado
                if tarea.tiempo_trabajado:
                    tarea.tiempo_trabajado += tiempo_sesion
                else:
                    tarea.tiempo_trabajado = tiempo_sesion
            
            tarea.trabajando_actualmente = False
            tarea.fecha_inicio_sesion = None
            tarea.estado = 'iniciada'  # Usamos 'iniciada' para representar pausado
            tarea.pausado = True
            
            mensaje = f"Tarea pausada. Tiempo registrado."
        
        tarea.save()
        
        # Formatear tiempo trabajado para respuesta
        tiempo_total_str = "00:00:00"
        if tarea.tiempo_trabajado:
            total_seconds = int(tarea.tiempo_trabajado.total_seconds())
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            seconds = total_seconds % 60
            tiempo_total_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        
        return JsonResponse({
            'success': True,
            'message': mensaje,
            'tarea': {
                'id': tarea.id,
                'trabajando_actualmente': tarea.trabajando_actualmente,
                'estado': tarea.estado,
                'tiempo_trabajado': tiempo_total_str,
                'fecha_inicio_sesion': tarea.fecha_inicio_sesion.isoformat() if tarea.fecha_inicio_sesion else None
            }
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_completar_tarea(request, tarea_id):
    """
    API para marcar una tarea como completada
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        # Importaciones necesarias
        from datetime import datetime, timezone
        from .models import Tarea
        
        # Obtener la tarea
        tarea = get_object_or_404(Tarea, id=tarea_id)
        
        # Verificar permisos - el asignado, creador, superusuario o compañero de grupo
        if (request.user != tarea.asignado_a and
            request.user != tarea.creado_por and
            not request.user.is_superuser):
            from .views_grupos import comparten_grupo
            involucrados = [u for u in [tarea.asignado_a, tarea.creado_por] if u and u != request.user]
            if not any(comparten_grupo(request.user, u) for u in involucrados):
                return JsonResponse({'error': 'Sin permisos para completar esta tarea'}, status=403)
        
        # Verificar que no esté ya completada
        if tarea.estado == 'completada':
            return JsonResponse({'error': 'La tarea ya está completada'}, status=400)

        # Verificar que no tenga subtareas abiertas
        subtareas_abiertas = tarea.subtareas.exclude(estado__in=['completada', 'cancelada']).count()
        if subtareas_abiertas > 0:
            return JsonResponse({'error': f'No se puede completar: tiene {subtareas_abiertas} subtarea(s) pendiente(s)'}, status=400)

        ahora = datetime.now(timezone.utc)
        
        # Si está corriendo el cronómetro, detenerlo y guardar tiempo
        if getattr(tarea, 'trabajando_actualmente', False):
            if hasattr(tarea, 'fecha_inicio_sesion') and tarea.fecha_inicio_sesion:
                # Calcular tiempo trabajado en esta sesión
                tiempo_sesion = ahora - tarea.fecha_inicio_sesion
                # Sumar al tiempo total trabajado
                if hasattr(tarea, 'tiempo_trabajado') and tarea.tiempo_trabajado:
                    tarea.tiempo_trabajado += tiempo_sesion
                else:
                    tarea.tiempo_trabajado = tiempo_sesion
            
            # Detener cronómetro
            tarea.trabajando_actualmente = False
            tarea.fecha_inicio_sesion = None
            tarea.pausado = False
        
        # Marcar como completada
        tarea.estado = 'completada'
        tarea.fecha_completada = ahora
        tarea.save()

        # Notificar al creador si es distinto al que completó
        if tarea.creado_por and tarea.creado_por != request.user:
            completador = request.user.get_full_name() or request.user.username
            crear_notificacion(
                usuario_destinatario=tarea.creado_por,
                tipo='tarea_vencida',
                titulo=f'Tarea completada: {tarea.titulo}',
                mensaje=f'{completador} marcó como completada la tarea "{tarea.titulo}".',
                usuario_remitente=request.user,
                tarea_id=tarea.id,
                tarea_titulo=tarea.titulo,
            )

        # Registrar en chat de grupo si cerró tarea de otro
        try:
            from .views_grupos import registrar_accion_grupo
            actor_nombre = request.user.get_full_name() or request.user.username
            grupos_notificados = set()
            for prop in [tarea.asignado_a, tarea.creado_por]:
                if prop and prop != request.user and prop.id not in grupos_notificados:
                    grupos_notificados.add(prop.id)
                    prop_nombre = prop.get_full_name() or prop.username
                    registrar_accion_grupo(
                        request.user, prop,
                        'cerrar_tarea',
                        f'{actor_nombre} completó la tarea "{tarea.titulo}" de {prop_nombre}',
                        objeto_tipo='tarea', objeto_id=tarea.id, objeto_titulo=tarea.titulo,
                    )
        except Exception as e:
            print(f"[registrar_accion_grupo] Error en completar_tarea: {e}")

        # --- Cadena reactiva: si la tarea fue creada por automatizacion ---
        cadena_resultado = None
        try:
            from .views_automatizacion import procesar_cadena_reactiva
            cadena_resultado = procesar_cadena_reactiva(tarea, request.user)
        except Exception as e_cadena:
            print(f'[Cadena reactiva] Error: {e_cadena}')

        # Formatear tiempo trabajado para respuesta
        tiempo_total_str = "00:00:00"
        if hasattr(tarea, 'tiempo_trabajado') and tarea.tiempo_trabajado:
            total_seconds = int(tarea.tiempo_trabajado.total_seconds())
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            seconds = total_seconds % 60
            tiempo_total_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

        response_data = {
            'success': True,
            'message': 'Tarea completada exitosamente',
            'tarea': {
                'id': tarea.id,
                'estado': tarea.estado,
                'fecha_completada': tarea.fecha_completada.isoformat(),
                'tiempo_trabajado_total': tiempo_total_str,
                'trabajando_actualmente': False
            }
        }

        if cadena_resultado:
            avance = cadena_resultado['avances'][0] if cadena_resultado['avances'] else None
            response_data['cadena_reactiva'] = {
                'avances': cadena_resultado['avances'],
                'tareas_creadas': cadena_resultado['tareas_creadas'],
                'mensaje': f'Oportunidad avanzada a "{avance["a"]}"' if avance else '',
            }
            if avance:
                response_data['message'] += f' | Oportunidad avanzada a "{avance["a"]}"'

        return JsonResponse(response_data)
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_reabrir_tarea(request, tarea_id):
    """Reabre una tarea completada y notifica a todos los administradores/supervisores."""
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    try:
        from .models import Tarea, Notificacion
        from django.contrib.auth.models import User as AuthUser
        from django.db.models import Q

        tarea = get_object_or_404(Tarea, id=tarea_id)

        # Solo el creador, asignado, supervisor o compañero de grupo puede reabrir
        es_supervisor_user = is_supervisor(request.user)
        if request.user != tarea.asignado_a and request.user != tarea.creado_por and not es_supervisor_user:
            from .views_grupos import comparten_grupo
            involucrados = [u for u in [tarea.asignado_a, tarea.creado_por] if u and u != request.user]
            if not any(comparten_grupo(request.user, u) for u in involucrados):
                return JsonResponse({'error': 'Sin permiso para reabrir esta tarea'}, status=403)

        if tarea.estado != 'completada':
            return JsonResponse({'error': 'La tarea no está completada'}, status=400)

        data = json.loads(request.body)
        razon = data.get('razon', '').strip()
        if not razon:
            return JsonResponse({'error': 'Debes indicar el motivo para reabrir la tarea'}, status=400)

        tarea.estado = 'pendiente'
        tarea.fecha_completada = None
        tarea.save(update_fields=['estado', 'fecha_completada'])

        # Notificar a todos los supervisores y superusuarios
        reabridor = request.user.get_full_name() or request.user.username
        admins = AuthUser.objects.filter(
            Q(is_superuser=True) | Q(groups__name='Supervisores')
        ).distinct()
        for admin in admins:
            if admin == request.user:
                continue
            Notificacion.objects.create(
                usuario_destinatario=admin,
                usuario_remitente=request.user,
                tipo='tarea_reabierta',
                titulo=f'Tarea reabierta: {tarea.titulo}',
                mensaje=f'{reabridor} volvió a abrir la tarea "{tarea.titulo}". Motivo: {razon}',
                tarea_id=tarea.id,
                tarea_titulo=tarea.titulo,
            )

        # Notificar al chat de grupo
        try:
            from .views_grupos import registrar_accion_grupo
            for prop in [tarea.asignado_a, tarea.creado_por]:
                if prop and prop != request.user:
                    registrar_accion_grupo(
                        request.user, prop, 'reabrir_tarea',
                        f'{reabridor} reabrió la tarea "{tarea.titulo}". Motivo: {razon}',
                        objeto_tipo='tarea', objeto_id=tarea.id, objeto_titulo=tarea.titulo,
                    )
        except Exception:
            pass

        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def solicitar_acceso_proyecto(request, proyecto_id):
    """
    API para solicitar acceso a un proyecto privado
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        # Verificar si el modelo existe antes de usar
        try:
            from app.models import SolicitudAccesoProyecto
            from django.db import connection
            
            # Verificar si la tabla existe en la base de datos
            with connection.cursor() as cursor:
                # Consulta compatible con MySQL y SQLite
                if 'mysql' in connection.vendor:
                    cursor.execute("""
                        SELECT table_name FROM information_schema.tables 
                        WHERE table_schema = DATABASE() AND table_name = 'app_solicitudaccesoproyecto';
                    """)
                else:
                    cursor.execute("""
                        SELECT name FROM sqlite_master WHERE type='table' AND name='app_solicitudaccesoproyecto';
                    """)
                table_exists = cursor.fetchone()
                
            if not table_exists:
                return JsonResponse({'error': 'Sistema de solicitudes no disponible. Tabla no existe en la base de datos.'}, status=503)
                
        except ImportError:
            return JsonResponse({'error': 'Sistema de solicitudes no disponible. Aplique migraciones.'}, status=503)
            
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        
        # Verificar que sea un proyecto privado
        if proyecto.privacidad != 'privado':
            return JsonResponse({'error': 'Este proyecto es público'}, status=400)
        
        # Verificar que no sea ya miembro
        if (request.user == proyecto.creado_por or 
            request.user in proyecto.miembros.all()):
            return JsonResponse({'error': 'Ya eres miembro de este proyecto'}, status=400)
        
        # Verificar si ya tiene una solicitud pendiente
        from app.models import SolicitudAccesoProyecto
        if SolicitudAccesoProyecto.objects.filter(
            proyecto=proyecto,
            usuario_solicitante=request.user,
            estado='pendiente'
        ).exists():
            return JsonResponse({'error': 'Ya tienes una solicitud pendiente'}, status=400)
        
        # Crear la solicitud
        import json
        data = json.loads(request.body) if request.body else {}
        mensaje = data.get('mensaje', '')
        
        solicitud = SolicitudAccesoProyecto.objects.create(
            proyecto=proyecto,
            usuario_solicitante=request.user,
            mensaje=mensaje
        )
        
        return JsonResponse({
            'success': True,
            'message': 'Solicitud enviada exitosamente'
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def responder_solicitud_proyecto(request, solicitud_id):
    """
    API para aceptar o rechazar una solicitud de acceso a proyecto
    """
    print(f"🔍 DEBUG responder_solicitud_proyecto - Usuario: {request.user.username if request.user.is_authenticated else 'No autenticado'}")
    print(f"🔍 DEBUG - Solicitud ID: {solicitud_id}")
    print(f"🔍 DEBUG - Método: {request.method}")
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        # Verificar si el modelo existe antes de usar
        try:
            from app.models import SolicitudAccesoProyecto
            from django.db import connection
            
            # Verificar si la tabla existe en la base de datos
            with connection.cursor() as cursor:
                # Consulta compatible con MySQL y SQLite
                if 'mysql' in connection.vendor:
                    cursor.execute("""
                        SELECT table_name FROM information_schema.tables 
                        WHERE table_schema = DATABASE() AND table_name = 'app_solicitudaccesoproyecto';
                    """)
                else:
                    cursor.execute("""
                        SELECT name FROM sqlite_master WHERE type='table' AND name='app_solicitudaccesoproyecto';
                    """)
                table_exists = cursor.fetchone()
                
            if not table_exists:
                return JsonResponse({'error': 'Sistema de solicitudes no disponible. Tabla no existe en la base de datos.'}, status=503)
                
        except ImportError:
            return JsonResponse({'error': 'Sistema de solicitudes no disponible. Aplique migraciones.'}, status=503)
            
        solicitud = get_object_or_404(SolicitudAccesoProyecto, id=solicitud_id)
        print(f"🔍 DEBUG - Solicitud encontrada: {solicitud.proyecto.nombre}")
        print(f"🔍 DEBUG - Creador proyecto: {solicitud.proyecto.creado_por.username}")
        print(f"🔍 DEBUG - Usuario actual: {request.user.username}")
        
        # Verificar que sea el creador del proyecto o un miembro
        es_creador = request.user == solicitud.proyecto.creado_por
        es_miembro = request.user in solicitud.proyecto.miembros.all()
        print(f"🔍 DEBUG - ¿Es creador?: {es_creador}")
        print(f"🔍 DEBUG - ¿Es miembro?: {es_miembro}")
        
        if not (es_creador or es_miembro):
            print(f"🔍 DEBUG - NO TIENE PERMISOS - 403")
            return JsonResponse({'error': 'No tienes permisos para responder esta solicitud'}, status=403)
        
        # Verificar que la solicitud esté pendiente
        if solicitud.estado != 'pendiente':
            return JsonResponse({'error': 'Esta solicitud ya fue respondida'}, status=400)
        
        import json
        data = json.loads(request.body)
        accion = data.get('accion')  # 'aceptar' o 'rechazar'
        
        if accion == 'aceptar':
            # Agregar usuario como miembro del proyecto
            solicitud.proyecto.miembros.add(solicitud.usuario_solicitante)
            solicitud.estado = 'aprobada'
            mensaje_respuesta = 'Solicitud aceptada. El usuario ahora es miembro del proyecto.'
        elif accion == 'rechazar':
            solicitud.estado = 'rechazada'
            mensaje_respuesta = 'Solicitud rechazada.'
        else:
            return JsonResponse({'error': 'Acción no válida'}, status=400)
        
        # Actualizar la solicitud
        from django.utils import timezone
        solicitud.fecha_respuesta = timezone.now()
        solicitud.usuario_respuesta = request.user
        solicitud.save()
        
        return JsonResponse({
            'success': True,
            'message': mensaje_respuesta
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def obtener_solicitudes_proyecto(request):
    """
    API para obtener solicitudes pendientes de proyectos donde el usuario puede responder
    """
    try:
        # Verificar si el modelo existe antes de usar
        try:
            from app.models import SolicitudAccesoProyecto, Proyecto
            from django.db import connection
            
            # Verificar si la tabla existe en la base de datos
            with connection.cursor() as cursor:
                # Consulta compatible con MySQL y SQLite
                if 'mysql' in connection.vendor:
                    cursor.execute("""
                        SELECT table_name FROM information_schema.tables 
                        WHERE table_schema = DATABASE() AND table_name = 'app_solicitudaccesoproyecto';
                    """)
                else:
                    cursor.execute("""
                        SELECT name FROM sqlite_master WHERE type='table' AND name='app_solicitudaccesoproyecto';
                    """)
                table_exists = cursor.fetchone()
                
            if not table_exists:
                return JsonResponse({
                    'solicitudes': [], 
                    'total': 0,
                    'message': 'Sistema de solicitudes no disponible'
                })
                
        except (ImportError, Exception) as e:
            return JsonResponse({
                'solicitudes': [], 
                'total': 0,
                'message': f'Sistema de solicitudes no disponible: {str(e)}'
            })
        
        # Obtener proyectos donde el usuario es creador o miembro
        proyectos_con_permisos = Proyecto.objects.filter(
            models.Q(creado_por=request.user) | 
            models.Q(miembros=request.user),
            privacidad='privado'
        ).distinct()
        
        # Obtener solicitudes pendientes para esos proyectos
        solicitudes = SolicitudAccesoProyecto.objects.filter(
            proyecto__in=proyectos_con_permisos,
            estado='pendiente'
        ).select_related('proyecto', 'usuario_solicitante').order_by('-fecha_solicitud')
        
        solicitudes_data = []
        for solicitud in solicitudes:
            solicitudes_data.append({
                'id': solicitud.id,
                'proyecto_nombre': solicitud.proyecto.nombre,
                'proyecto_id': solicitud.proyecto.id,
                'usuario_nombre': solicitud.usuario_solicitante.get_full_name(),
                'usuario_username': solicitud.usuario_solicitante.username,
                'mensaje': solicitud.mensaje,
                'fecha_solicitud': solicitud.fecha_solicitud.strftime('%d de %b, %Y a las %H:%M'),
            })
        
        return JsonResponse({
            'solicitudes': solicitudes_data,
            'total': len(solicitudes_data)
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_eliminar_proyecto_completo(request, proyecto_id):
    """
    API para eliminar un proyecto completo con todas sus dependencias
    Elimina: proyecto, tareas, carpetas, archivos, comentarios, etc.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        print(f"🔍 DEBUG: Buscando proyecto con ID: {proyecto_id}")
        
        # Obtener el proyecto
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        print(f"✅ DEBUG: Proyecto encontrado: {proyecto.nombre}")
        
        # Verificar que el usuario es el creador del proyecto
        print(f"🔍 DEBUG: Creado por: {proyecto.creado_por}, Usuario actual: {request.user}")
        if proyecto.creado_por != request.user:
            return JsonResponse({'error': 'No tienes permisos para eliminar este proyecto'}, status=403)
        
        # Log para debugging
        print(f"🗑️ Iniciando eliminación del proyecto '{proyecto.nombre}' (ID: {proyecto_id})")
        
        import os
        from django.conf import settings
        
        # Contador para logging
        elementos_eliminados = {
            'tareas': 0,
            'archivos': 0,
            'carpetas': 0,
            'comentarios': 0,
            'solicitudes': 0,
            'archivos_fisicos': 0
        }
        
        # 1. Eliminar todas las tareas del proyecto
        tareas = Tarea.objects.filter(proyecto=proyecto)
        elementos_eliminados['tareas'] = tareas.count()
        tareas.delete()
        print(f"   ✅ {elementos_eliminados['tareas']} tareas eliminadas")
        
        # 2. Eliminar archivos físicos y registros
        archivos = ArchivoProyecto.objects.filter(proyecto=proyecto)
        elementos_eliminados['archivos'] = archivos.count()
        
        for archivo in archivos:
            # Eliminar archivo físico del servidor
            try:
                if archivo.archivo and hasattr(archivo.archivo, 'path'):
                    archivo_path = archivo.archivo.path
                    if os.path.exists(archivo_path):
                        os.remove(archivo_path)
                        elementos_eliminados['archivos_fisicos'] += 1
                        print(f"   🗂️ Archivo físico eliminado: {archivo_path}")
            except Exception as e:
                print(f"   ⚠️ Error eliminando archivo físico {archivo.nombre}: {e}")
        
        archivos.delete()
        print(f"   ✅ {elementos_eliminados['archivos']} archivos eliminados")
        
        # 3. Eliminar carpetas
        carpetas = CarpetaProyecto.objects.filter(proyecto=proyecto)
        elementos_eliminados['carpetas'] = carpetas.count()
        carpetas.delete()
        print(f"   ✅ {elementos_eliminados['carpetas']} carpetas eliminadas")
        
        # 4. Eliminar comentarios
        comentarios = ProyectoComentario.objects.filter(proyecto=proyecto)
        elementos_eliminados['comentarios'] = comentarios.count()
        comentarios.delete()
        print(f"   ✅ {elementos_eliminados['comentarios']} comentarios eliminados")
        
        # 5. Eliminar solicitudes de acceso
        solicitudes = SolicitudAccesoProyecto.objects.filter(proyecto=proyecto)
        elementos_eliminados['solicitudes'] = solicitudes.count()
        solicitudes.delete()
        print(f"   ✅ {elementos_eliminados['solicitudes']} solicitudes de acceso eliminadas")
        
        # 6. Finalmente, eliminar el proyecto
        proyecto_nombre = proyecto.nombre
        proyecto.delete()
        
        print(f"🎯 Proyecto '{proyecto_nombre}' eliminado completamente")
        print(f"📊 Resumen: {elementos_eliminados}")
        
        return JsonResponse({
            'success': True, 
            'message': f'Proyecto "{proyecto_nombre}" eliminado exitosamente',
            'elementos_eliminados': elementos_eliminados
        })
        
    except Proyecto.DoesNotExist:
        print(f"❌ DEBUG: Proyecto con ID {proyecto_id} no encontrado")
        return JsonResponse({'error': 'Proyecto no encontrado'}, status=404)
    except Exception as e:
        print(f"❌ DEBUG: Error eliminando proyecto: {e}")
        print(f"❌ DEBUG: Tipo de error: {type(e)}")
        import traceback
        print(f"❌ DEBUG: Traceback completo:")
        traceback.print_exc()
        return JsonResponse({'error': f'Error interno del servidor: {str(e)}'}, status=500)


@login_required
def api_actualizar_tarea_real(request, tarea_id):
    """
    API para actualizar una tarea real en la base de datos
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        import json
        from datetime import datetime
        
        # Obtener la tarea de la base de datos
        tarea = get_object_or_404(Tarea, id=tarea_id)
        
        # Obtener datos del request
        data = json.loads(request.body)

        es_responsable = tarea.asignado_a == request.user
        es_creador = tarea.creado_por == request.user

        from .views_grupos import comparten_grupo
        involucrados = [u for u in [tarea.asignado_a, tarea.creado_por] if u and u != request.user]
        es_companero_grupo = any(comparten_grupo(request.user, u) for u in involucrados)

        # El responsable solo puede cambiar fecha_limite (con razón obligatoria)
        # El creador, superusuario y compañero de grupo pueden editar todo
        campos_permitidos_responsable = {'fecha_limite', 'razon_reprogramacion'}
        campos_enviados = set(data.keys())
        if not es_creador and not request.user.is_superuser and not es_companero_grupo:
            if not es_responsable:
                return JsonResponse({'error': 'Sin permisos para editar esta tarea'}, status=403)
            # Es responsable — solo puede tocar fecha_limite
            if not campos_enviados.issubset(campos_permitidos_responsable):
                return JsonResponse({'error': 'El responsable solo puede cambiar la fecha límite'}, status=403)
            if 'fecha_limite' in data and not data.get('razon_reprogramacion'):
                return JsonResponse({'error': 'Debes indicar la razón del cambio de fecha'}, status=400)
        
        # Actualizar campos si están presentes en la petición
        if 'nombre' in data or 'titulo' in data:
            nuevo_titulo = data.get('nombre') or data.get('titulo')
            if nuevo_titulo and nuevo_titulo.strip():
                tarea.titulo = nuevo_titulo.strip()
        
        if 'descripcion' in data:
            tarea.descripcion = data.get('descripcion', '') or ''
        
        if 'prioridad' in data:
            prioridad = data.get('prioridad')
            if prioridad in ['baja', 'media', 'alta']:
                tarea.prioridad = prioridad
        
        if 'fecha_limite' in data:
            fecha_limite_str = data.get('fecha_limite')
            if fecha_limite_str:
                try:
                    # Intentar parsear la fecha
                    from django.utils import timezone
                    from datetime import datetime
                    fecha_obj = datetime.fromisoformat(fecha_limite_str.replace('Z', '+00:00'))
                    tarea.fecha_limite = timezone.make_aware(fecha_obj) if timezone.is_naive(fecha_obj) else fecha_obj
                except (ValueError, TypeError):
                    pass  # Ignorar fechas inválidas
            else:
                tarea.fecha_limite = None

        if 'asignado_a' in data:
            asignado_id = data.get('asignado_a')
            if asignado_id:
                try:
                    from django.contrib.auth.models import User
                    tarea.asignado_a = User.objects.get(id=asignado_id)
                except User.DoesNotExist:
                    pass
            else:
                tarea.asignado_a = None

        if 'cliente_id' in data:
            cliente_id_val = data.get('cliente_id')
            if cliente_id_val:
                try:
                    tarea.cliente = Cliente.objects.get(id=cliente_id_val)
                except Cliente.DoesNotExist:
                    pass
            else:
                tarea.cliente = None

        if 'oportunidad_id' in data:
            opp_id_val = data.get('oportunidad_id')
            if opp_id_val:
                try:
                    tarea.oportunidad = TodoItem.objects.get(id=opp_id_val)
                except TodoItem.DoesNotExist:
                    pass
            else:
                tarea.oportunidad = None

        # Guardar cambios
        tarea.save()

        # Notificar a admins/supervisores si el responsable reprogramó la fecha
        razon_reprogramacion = data.get('razon_reprogramacion')
        if razon_reprogramacion and 'fecha_limite' in data and es_responsable:
            RAZONES = {
                'responsable': 'El responsable no logró terminar a tiempo',
                'creador': 'El creador dio poco tiempo o no consideró la carga de trabajo',
                'externo': 'Factor externo (cliente o proveedor)',
            }
            razon_texto = RAZONES.get(razon_reprogramacion, razon_reprogramacion)
            nueva_fecha = tarea.fecha_limite.strftime('%d/%m/%Y %H:%M') if tarea.fecha_limite else 'sin fecha'
            responsable_nombre = request.user.get_full_name() or request.user.username
            from django.contrib.auth.models import User as AuthUser
            from .models import Notificacion
            admins = AuthUser.objects.filter(is_superuser=True)
            for admin in admins:
                if admin != request.user:
                    Notificacion.objects.create(
                        usuario_destinatario=admin,
                        usuario_remitente=request.user,
                        tipo='tarea_reprogramada',
                        titulo=f'Tarea reprogramada: {tarea.titulo}',
                        mensaje=f'{responsable_nombre} cambió la fecha límite a {nueva_fecha}. Razón: {razon_texto}',
                        tarea_id=tarea.id,
                        tarea_titulo=tarea.titulo,
                    )

        # Notificar al chat de grupo si se editó tarea ajena
        try:
            from .views_grupos import registrar_accion_grupo
            actor_nombre = request.user.get_full_name() or request.user.username
            campos_cambiados = [k for k in data.keys() if k not in ('razon_reprogramacion',)]
            resumen = ', '.join(campos_cambiados)
            for prop in [tarea.asignado_a, tarea.creado_por]:
                if prop and prop != request.user:
                    registrar_accion_grupo(
                        request.user, prop, 'editar_tarea',
                        f'{actor_nombre} editó la tarea "{tarea.titulo}" ({resumen})',
                        objeto_tipo='tarea', objeto_id=tarea.id, objeto_titulo=tarea.titulo,
                    )
        except Exception:
            pass

        # Log para debugging
        print(f"✅ Tarea {tarea_id} actualizada: {tarea.titulo}")

        # Devolver datos actualizados
        return JsonResponse({
            'success': True,
            'message': 'Tarea actualizada exitosamente',
            'tarea': {
                'id': tarea.id,
                'titulo': tarea.titulo,
                'descripcion': tarea.descripcion,
                'prioridad': tarea.prioridad,
                'fecha_limite': tarea.fecha_limite.isoformat() if tarea.fecha_limite else None,
                'estado': tarea.estado
            }
        })
        
    except Tarea.DoesNotExist:
        return JsonResponse({'error': 'Tarea no encontrada'}, status=404)
    except Exception as e:
        print(f"❌ Error actualizando tarea {tarea_id}: {e}")
        return JsonResponse({'error': f'Error interno del servidor: {str(e)}'}, status=500)


@login_required
def api_tareas_oportunidad(request, opp_id):
    """GET lista / POST crear — tareas de una oportunidad específica."""
    try:
        opp = get_object_or_404(TodoItem, pk=opp_id)

        if request.method == 'GET':
            from django.db.models import IntegerField
            tareas = opp.tareas_oportunidad.select_related('creado_por', 'responsable').annotate(
                prio_order=Case(When(prioridad='alta', then=Value(0)), default=Value(1), output_field=IntegerField())
            ).order_by('prio_order', F('fecha_limite').asc(nulls_last=True), 'fecha_creacion')
            return JsonResponse({'success': True, 'tareas': [_serialize_tarea_opp(t) for t in tareas]})

        if request.method == 'POST':
            data = json.loads(request.body)
            titulo = data.get('titulo', '').strip()
            if not titulo:
                return JsonResponse({'success': False, 'error': 'Título requerido'}, status=400)

            from django.utils.dateparse import parse_datetime
            from zoneinfo import ZoneInfo
            TIJUANA_TZ = ZoneInfo('America/Tijuana')

            fecha_limite = None
            raw_fecha = data.get('fecha_limite')
            if raw_fecha:
                fecha_limite = parse_datetime(raw_fecha)
                if fecha_limite and fecha_limite.tzinfo is None:
                    fecha_limite = fecha_limite.replace(tzinfo=TIJUANA_TZ)

            # Crear actividad en el calendario (roja por defecto)
            from django.utils.dateparse import parse_datetime as _pdt
            cal_inicio_raw = data.get('cal_inicio')
            cal_fin_raw = data.get('cal_fin')
            cal_ini = None
            cal_fin = None
            if cal_inicio_raw and cal_fin_raw:
                cal_ini = _pdt(cal_inicio_raw)
                cal_fin = _pdt(cal_fin_raw)
                if cal_ini and cal_ini.tzinfo is None:
                    cal_ini = cal_ini.replace(tzinfo=TIJUANA_TZ)
                if cal_fin and cal_fin.tzinfo is None:
                    cal_fin = cal_fin.replace(tzinfo=TIJUANA_TZ)

            # Si no hay fecha_limite explícita, usar cal_fin (hora de cierre de la actividad)
            if fecha_limite is None and cal_fin is not None:
                fecha_limite = cal_fin
            elif fecha_limite is None and cal_ini is not None:
                fecha_limite = cal_ini

            tarea = TareaOportunidad.objects.create(
                oportunidad=opp,
                titulo=titulo,
                descripcion=data.get('descripcion', ''),
                prioridad='alta' if data.get('alta_prioridad') else 'normal',
                fecha_limite=fecha_limite,
                creado_por=request.user,
                responsable_id=data.get('responsable_id') or None,
            )
            if data.get('participantes'):
                tarea.participantes.set(data['participantes'])
            if data.get('observadores'):
                tarea.observadores.set(data['observadores'])

            if cal_ini and cal_fin:
                actividad = Actividad.objects.create(
                    titulo=tarea.titulo,
                    tipo_actividad='tarea',
                    descripcion=tarea.descripcion or '',
                    fecha_inicio=cal_ini,
                    fecha_fin=cal_fin,
                    creado_por=request.user,
                    color='#0052D4',  # azul
                    oportunidad=opp,
                )
                tarea.actividad_calendario = actividad
                tarea.save(update_fields=['actividad_calendario'])

            # Notificar al responsable si es distinto al creador
            if tarea.responsable and tarea.responsable != request.user:
                remitente_nombre = request.user.get_full_name() or request.user.username
                crear_notificacion(
                    usuario_destinatario=tarea.responsable,
                    tipo='tarea_opp_asignada',
                    titulo=f'Tarea asignada: {tarea.titulo}',
                    mensaje=f'{remitente_nombre} te asignó una tarea en la oportunidad "{opp.oportunidad}".',
                    oportunidad=opp,
                    usuario_remitente=request.user,
                    tarea_opp=tarea,
                )

            return JsonResponse({'success': True, 'tarea': _serialize_tarea_opp(tarea)})

    except Exception as e:
        import traceback
        return JsonResponse({'error': str(e), 'trace': traceback.format_exc()}, status=500)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
def api_tarea_oportunidad_detail(request, tarea_id):
    """PUT actualizar / DELETE eliminar — una tarea de oportunidad."""
    tarea = get_object_or_404(TareaOportunidad, pk=tarea_id)
    user = request.user

    if tarea.creado_por != user and tarea.responsable != user and not is_supervisor(user):
        from .views_grupos import comparten_grupo
        involucrados = [u for u in [tarea.responsable, tarea.creado_por] if u and u != user]
        if not any(comparten_grupo(user, u) for u in involucrados):
            return JsonResponse({'error': 'Sin permiso'}, status=403)

    if request.method == 'PUT':
        data = json.loads(request.body)
        if 'titulo' in data:
            tarea.titulo = data['titulo']
        if 'descripcion' in data:
            tarea.descripcion = data['descripcion']
        if 'estado' in data:
            if data['estado'] == 'completada':
                subs_abiertas = tarea.subtareas.exclude(estado__in=['completada', 'cancelada']).count()
                if subs_abiertas > 0:
                    return JsonResponse({'error': f'No se puede completar: tiene {subs_abiertas} subtarea(s) pendiente(s)'}, status=400)
            tarea.estado = data['estado']
        if 'prioridad' in data:
            tarea.prioridad = data['prioridad']
        if 'fecha_limite' in data:
            from django.utils.dateparse import parse_datetime
            tarea.fecha_limite = parse_datetime(data['fecha_limite']) if data['fecha_limite'] else None
        if 'responsable_id' in data:
            new_resp_id = data['responsable_id'] or None
            old_resp_id = tarea.responsable_id
            tarea.responsable_id = new_resp_id
            tarea.save()
            # Notificar al nuevo responsable si cambió y es distinto al editor
            if new_resp_id and new_resp_id != old_resp_id:
                try:
                    nuevo_resp = User.objects.get(pk=new_resp_id)
                    if nuevo_resp != request.user:
                        remitente_nombre = request.user.get_full_name() or request.user.username
                        crear_notificacion(
                            usuario_destinatario=nuevo_resp,
                            tipo='tarea_opp_asignada',
                            titulo=f'Tarea asignada: {tarea.titulo}',
                            mensaje=f'{remitente_nombre} te asignó como responsable de una tarea en "{tarea.oportunidad.oportunidad if tarea.oportunidad else ""}".',
                            oportunidad=tarea.oportunidad,
                            usuario_remitente=request.user,
                            tarea_opp=tarea,
                        )
                except User.DoesNotExist:
                    pass
            return JsonResponse({'success': True})
        # M2M: añadir/quitar participantes y observadores
        remitente_nombre = request.user.get_full_name() or request.user.username
        opp_nombre = tarea.oportunidad.oportunidad if tarea.oportunidad else ''
        if 'participante_add' in data:
            try:
                u = User.objects.get(pk=data['participante_add'])
                tarea.participantes.add(u)
                if u != request.user:
                    crear_notificacion(
                        usuario_destinatario=u,
                        tipo='tarea_opp_asignada',
                        titulo=f'Te agregaron como participante: {tarea.titulo}',
                        mensaje=f'{remitente_nombre} te agregó como participante en la tarea "{tarea.titulo}" de "{opp_nombre}".',
                        oportunidad=tarea.oportunidad,
                        usuario_remitente=request.user,
                        tarea_opp=tarea,
                    )
                return JsonResponse({'success': True})
            except User.DoesNotExist:
                return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
        if 'participante_remove' in data:
            try:
                u = User.objects.get(pk=data['participante_remove'])
                tarea.participantes.remove(u)
                return JsonResponse({'success': True})
            except User.DoesNotExist:
                return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
        if 'observador_add' in data:
            try:
                u = User.objects.get(pk=data['observador_add'])
                tarea.observadores.add(u)
                if u != request.user:
                    crear_notificacion(
                        usuario_destinatario=u,
                        tipo='tarea_opp_asignada',
                        titulo=f'Te agregaron como observador: {tarea.titulo}',
                        mensaje=f'{remitente_nombre} te agregó como observador en la tarea "{tarea.titulo}" de "{opp_nombre}".',
                        oportunidad=tarea.oportunidad,
                        usuario_remitente=request.user,
                        tarea_opp=tarea,
                    )
                return JsonResponse({'success': True})
            except User.DoesNotExist:
                return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
        if 'observador_remove' in data:
            try:
                u = User.objects.get(pk=data['observador_remove'])
                tarea.observadores.remove(u)
                return JsonResponse({'success': True})
            except User.DoesNotExist:
                return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
        tarea.save()
        # Si se marcó como completada, actualizar color de la actividad a verde
        if data.get('estado') == 'completada' and tarea.actividad_calendario_id:
            Actividad.objects.filter(pk=tarea.actividad_calendario_id).update(color='#34C759')
        # Si se cambió la fecha_limite, actualizar la actividad del calendario
        if 'fecha_limite' in data and tarea.actividad_calendario_id and tarea.fecha_limite:
            from datetime import timedelta
            new_start = tarea.fecha_limite
            new_end = tarea.fecha_limite + timedelta(hours=1)
            Actividad.objects.filter(pk=tarea.actividad_calendario_id).update(
                fecha_inicio=new_start, fecha_fin=new_end
            )
        return JsonResponse({'success': True})

    if request.method == 'DELETE':
        tarea.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
def api_todas_tareas_opp(request):
    """GET todas las tareas de oportunidad accesibles para el usuario."""
    from django.db.models import IntegerField
    import calendar
    user = request.user

    if is_supervisor(user):
        qs = TareaOportunidad.objects.select_related('oportunidad', 'creado_por', 'responsable').all()
    else:
        qs = TareaOportunidad.objects.select_related('oportunidad', 'creado_por', 'responsable').filter(
            Q(creado_por=user) | Q(responsable=user) |
            Q(participantes=user) | Q(observadores=user)
        ).distinct()

    # Filter by month/year (based on fecha_creacion)
    mes = request.GET.get('mes', '')
    anio = request.GET.get('anio', '')
    if mes and anio:
        try:
            mes_int = int(mes)
            anio_int = int(anio)
            last_day = calendar.monthrange(anio_int, mes_int)[1]
            from datetime import date
            qs = qs.filter(
                fecha_creacion__date__gte=date(anio_int, mes_int, 1),
                fecha_creacion__date__lte=date(anio_int, mes_int, last_day),
            )
        except (ValueError, TypeError):
            pass

    # Filter by vendedor (user IDs)
    vendedores_param = request.GET.get('vendedores', '')
    if vendedores_param:
        try:
            vids = [int(v) for v in vendedores_param.split(',') if v.strip()]
            if vids:
                qs = qs.filter(
                    Q(creado_por_id__in=vids) | Q(responsable_id__in=vids)
                ).distinct()
        except (ValueError, TypeError):
            pass

    qs = qs.annotate(
        prio_order=Case(When(prioridad='alta', then=Value(0)), default=Value(1), output_field=IntegerField())
    ).order_by('prio_order', F('fecha_limite').asc(nulls_last=True), 'fecha_creacion')

    return JsonResponse({'success': True, 'tareas': [_serialize_tarea_opp(t) for t in qs]})


@login_required
def api_tarea_opp_detalle(request, tarea_id):
    """GET detalle completo de una TareaOportunidad (incluye M2M)."""
    tarea = get_object_or_404(TareaOportunidad, pk=tarea_id)

    def user_data(u):
        if not u:
            return None
        return {'id': u.id, 'nombre': u.get_full_name() or u.username}

    data = {
        'id': tarea.id,
        'titulo': tarea.titulo,
        'descripcion': tarea.descripcion,
        'prioridad': tarea.prioridad,
        'estado': tarea.estado,
        'fecha_limite': tarea.fecha_limite.isoformat() if tarea.fecha_limite else None,
        'fecha_creacion': tarea.fecha_creacion.isoformat(),
        'oportunidad_id': tarea.oportunidad_id,
        'oportunidad_nombre': tarea.oportunidad.oportunidad if tarea.oportunidad else '',
        'creado_por_data': user_data(tarea.creado_por),
        'responsable_data': user_data(tarea.responsable),
        'participantes': [user_data(u) for u in tarea.participantes.all()],
        'observadores': [user_data(u) for u in tarea.observadores.all()],
    }
    return JsonResponse(data)


@login_required
def api_tarea_opp_comentarios(request, tarea_id):
    """GET lista de comentarios / POST agregar comentario a una TareaOportunidad."""
    tarea = get_object_or_404(TareaOportunidad, pk=tarea_id)

    if request.method == 'GET':
        comentarios = tarea.comentarios.select_related('autor').all()
        return JsonResponse({
            'success': True,
            'comentarios': [
                {
                    'id': c.id,
                    'usuario': c.autor.get_full_name() or c.autor.username if c.autor else 'Desconocido',
                    'usuario_id': c.autor_id,
                    'contenido': c.contenido,
                    'fecha': c.fecha_creacion.isoformat(),
                }
                for c in comentarios
            ]
        })

    if request.method == 'POST':
        contenido = request.POST.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'success': False, 'error': 'Comentario vacío'}, status=400)
        ComentarioTareaOpp.objects.create(tarea=tarea, autor=request.user, contenido=contenido)

        # Notificar a creador y responsable (si son distintos al comentarista)
        remitente_nombre = request.user.get_full_name() or request.user.username
        msg_corto = contenido[:100] + ('…' if len(contenido) > 100 else '')
        notif_titulo = f'Comentario en: {tarea.titulo}'
        notif_msg = f'{remitente_nombre}: {msg_corto}'
        destinatarios = set()
        if tarea.creado_por and tarea.creado_por != request.user:
            destinatarios.add(tarea.creado_por)
        if tarea.responsable and tarea.responsable != request.user:
            destinatarios.add(tarea.responsable)
        for dest in destinatarios:
            crear_notificacion(
                usuario_destinatario=dest,
                tipo='tarea_opp_comentario',
                titulo=notif_titulo,
                mensaje=notif_msg,
                oportunidad=tarea.oportunidad,
                usuario_remitente=request.user,
                tarea_opp=tarea,
            )

        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_tarea_opp_comentario_detail(request, tarea_id, comentario_id):
    """PUT editar / DELETE eliminar un comentario de TareaOportunidad."""
    tarea = get_object_or_404(TareaOportunidad, pk=tarea_id)
    comentario = get_object_or_404(ComentarioTareaOpp, pk=comentario_id, tarea=tarea)

    if comentario.autor != request.user and not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permiso'}, status=403)

    if request.method == 'PUT':
        data = json.loads(request.body)
        contenido = data.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'success': False, 'error': 'Contenido vacío'}, status=400)
        comentario.contenido = contenido
        comentario.save()
        return JsonResponse({'success': True})

    if request.method == 'DELETE':
        comentario.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_oportunidad_proyectos(request, opp_id):
    """GET: devuelve confirmados y sugerencias de proyectos para una oportunidad."""
    from app.models import ProyectoOportunidadLink, TodoItem
    try:
        opp = TodoItem.objects.get(pk=opp_id)
    except TodoItem.DoesNotExist:
        return JsonResponse({'error': 'Oportunidad no encontrada'}, status=404)

    confirmados_qs = ProyectoOportunidadLink.objects.filter(
        oportunidad=opp, confirmado=True, rechazado=False
    ).select_related('proyecto')
    sugerencias_qs = ProyectoOportunidadLink.objects.filter(
        oportunidad=opp, confirmado=False, rechazado=False
    ).select_related('proyecto').order_by('-score')

    confirmados = [
        {
            'link_id': lnk.id,
            'id': lnk.proyecto.id,
            'nombre': lnk.proyecto.nombre,
            'score': lnk.score,
            'bitrix_group_id': lnk.proyecto.bitrix_group_id,
        }
        for lnk in confirmados_qs
    ]
    sugerencias = [
        {
            'link_id': lnk.id,
            'id': lnk.proyecto.id,
            'nombre': lnk.proyecto.nombre,
            'score': lnk.score,
            'bitrix_group_id': lnk.proyecto.bitrix_group_id,
        }
        for lnk in sugerencias_qs
    ]
    return JsonResponse({'confirmados': confirmados, 'sugerencias': sugerencias})


@login_required
def api_oportunidad_proyectos_accion(request, opp_id, link_id):
    """POST {"accion": "confirmar"|"rechazar"}: actualiza el link."""
    if request.method != 'POST':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)

    from app.models import ProyectoOportunidadLink
    try:
        lnk = ProyectoOportunidadLink.objects.get(pk=link_id, oportunidad_id=opp_id)
    except ProyectoOportunidadLink.DoesNotExist:
        return JsonResponse({'error': 'Vinculo no encontrado'}, status=404)

    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({'error': 'JSON invalido'}, status=400)

    accion = data.get('accion', '')
    if accion == 'confirmar':
        lnk.confirmado = True
        lnk.rechazado = False
        lnk.vinculado_por = request.user
        lnk.save()
    elif accion == 'rechazar':
        lnk.rechazado = True
        lnk.confirmado = False
        lnk.save()
    else:
        return JsonResponse({'error': 'Accion invalida'}, status=400)

    return JsonResponse({'success': True})


@login_required
def api_oportunidad_proyectos_buscar(request, opp_id):
    """
    GET ?q=texto : busca proyectos por nombre, devuelve top 10 no ligados.
    POST {"proyecto_id": X} : crea un vinculo confirmado manualmente (score=100).
    """
    from app.models import ProyectoOportunidadLink, TodoItem, Proyecto

    try:
        opp = TodoItem.objects.get(pk=opp_id)
    except TodoItem.DoesNotExist:
        return JsonResponse({'error': 'Oportunidad no encontrada'}, status=404)

    if request.method == 'GET':
        q = request.GET.get('q', '').strip()
        if not q:
            return JsonResponse({'results': []})

        ya_ligados = set(
            ProyectoOportunidadLink.objects.filter(oportunidad=opp).values_list('proyecto_id', flat=True)
        )
        proyectos = Proyecto.objects.filter(nombre__icontains=q).exclude(id__in=ya_ligados)[:10]

        try:
            from rapidfuzz import fuzz
            opp_nombre = opp.oportunidad or ''
        except ImportError:
            fuzz = None
            opp_nombre = ''

        results = []
        for p in proyectos:
            score = fuzz.token_set_ratio(opp_nombre, p.nombre) if fuzz else 0
            results.append({
                'id': p.id,
                'nombre': p.nombre,
                'bitrix_group_id': p.bitrix_group_id,
                'score': score,
            })
        results.sort(key=lambda x: x['score'], reverse=True)
        return JsonResponse({'results': results})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except Exception:
            return JsonResponse({'error': 'JSON invalido'}, status=400)

        proyecto_id = data.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'error': 'proyecto_id requerido'}, status=400)

        try:
            proyecto = Proyecto.objects.get(pk=proyecto_id)
        except Proyecto.DoesNotExist:
            return JsonResponse({'error': 'Proyecto no encontrado'}, status=404)

        lnk, _ = ProyectoOportunidadLink.objects.update_or_create(
            proyecto=proyecto,
            oportunidad=opp,
            defaults={
                'score': 100.0,
                'confirmado': True,
                'rechazado': False,
                'vinculado_por': request.user,
            },
        )

        # Crear OportunidadProyecto para que el drive y las tareas funcionen
        tareas_vinculadas = 0
        if proyecto.bitrix_group_id:
            from app.models import OportunidadProyecto, Tarea
            OportunidadProyecto.objects.get_or_create(
                bitrix_project_id=str(proyecto.bitrix_group_id),
                oportunidad=opp,
            )
            tareas_vinculadas = Tarea.objects.filter(
                proyecto=proyecto, oportunidad__isnull=True
            ).update(oportunidad=opp)

        return JsonResponse({
            'success': True,
            'link_id': lnk.id,
            'tareas_vinculadas': tareas_vinculadas,
        })

    return JsonResponse({'error': 'Metodo no permitido'}, status=405)

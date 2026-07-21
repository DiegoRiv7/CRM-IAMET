# ══════════════════════════════════════════════════════════════════════
# views_proyectos.py — ARCHIVO LEGACY (congelado desde 2026-06-04)
#
# ~6,861 líneas mezclando calendario, instalaciones, Gantt, tareas,
# proyectos CRM, ingeniero dashboard. Marcado como LEGACY por Boy Scout
# Rule.
#
# NO agregar endpoints nuevos aquí. Para vistas nuevas:
#   → app/views_v2/proyectos_v2.py
#
# IMPORTANTE: este archivo usa el modelo `Proyecto` legacy. Para código
# nuevo usar `ProyectoIAMET` (moderno, con estructura financiera). Ver
# DECISIONES.md cuando se cree.
#
# Modificar SOLO para bugs críticos. Ver app/views_v2/README.md.
# ══════════════════════════════════════════════════════════════════════

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
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion, UserProfile, Contacto, PendingFileUpload, OportunidadProyecto, Volumetria, DetalleVolumetria, CatalogoCableado, OportunidadActividad, OportunidadComentario, OportunidadArchivo, OportunidadEstado, Notificacion, Proyecto, ProyectoComentario, ProyectoArchivo, Tarea, TareaComentario, TareaArchivo, Actividad, CarpetaProyecto, ArchivoProyecto, CompartirArchivo, IntercambioNavidad, ParticipanteIntercambio, HistorialIntercambio, SolicitudAccesoProyecto, ArchivoFacturacion, CarpetaOportunidad, ArchivoOportunidad, MensajeOportunidad, TareaOportunidad, ComentarioTareaOpp, PostMuro, ComentarioMuro, ProductoOportunidad, AsistenciaJornada, EficienciaMensual, SolicitudCambioPerfil, ProgramacionActividad, ProyectoIAMET, GanttFase, GanttActividad, RecursoMaterial, GanttActividadComentario, GanttActividadArchivo
from . import views_exportar
from .views_tarea_comentarios import api_comentarios_tarea, api_agregar_comentario_tarea, api_editar_comentario_tarea, api_eliminar_comentario_tarea
from .forms import VentaForm, VentaFilterForm, CotizacionForm, ClienteForm, OportunidadModalForm, NuevaOportunidadForm
from django.db.models import Sum, Count, F, Q, Case, When, Value
from django.db.models.functions import Upper, Coalesce
from django.db.models import Value
from datetime import date, datetime, timedelta, time
from dateutil.relativedelta import relativedelta
from django.utils import timezone
from decimal import Decimal, InvalidOperation
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
    from app.models import Proyecto, Tarea, CarpetaProyecto, ArchivoProyecto, ArchivoOportunidad, CarpetaOportunidad
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

    # Drive de oportunidades ligadas: cada opp aporta una carpeta virtual
    # con sus archivos (raíz + subcarpetas). El ingeniero ve todo el material
    # comercial sin tener que salir al CRM.
    for opp in proyecto.oportunidades_ligadas.all():
        archivos_opp = list(
            ArchivoOportunidad.objects.filter(oportunidad=opp)
            .values('id', 'nombre_original', 'tipo_archivo', 'extension',
                    'bitrix_download_url', 'tamaño')
        )
        if not archivos_opp:
            continue
        opp_titulo = (getattr(opp, 'oportunidad', None) or getattr(opp, 'titulo', None)
                      or getattr(opp, 'nombre', None) or 'Oportunidad')
        carpetas.append({
            'id': 'opp-' + str(opp.id),
            'nombre': '[Oportunidad] ' + str(opp_titulo),
            'archivos': archivos_opp,
        })

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
def api_ingeniero_mis_actividades(request):
    """Actividades del calendario (ProgramacionActividad) en las que el
    usuario actual figura como responsable. Pensado para alimentar los
    tiles del Dashboard del ingeniero.

    Retorna: items ordenados por fecha ascendente (primero las más próximas),
    sin completadas. Cada item con id, titulo, fecha ISO, hora_inicio/fin,
    completada, proyecto_key, y link a proyecto/nombre si se puede derivar.
    """
    user = request.user
    acts = ProgramacionActividad.objects.filter(
        responsables=user,
        completada=False,
    ).prefetch_related('responsables').order_by('fecha', 'hora_inicio')[:50]

    # Derivar nombre del proyecto desde proyecto_key (formato 'proy_<id>')
    proyecto_keys = set(a.proyecto_key for a in acts if a.proyecto_key)
    proy_names = {}
    try:
        from app.models import ProyectoIAMET
        proy_ids = []
        for k in proyecto_keys:
            if k and k.startswith('proy_'):
                try: proy_ids.append(int(k.split('_', 1)[1]))
                except Exception: pass
        if proy_ids:
            for p in ProyectoIAMET.objects.filter(id__in=proy_ids).only('id', 'nombre', 'cliente_nombre'):
                proy_names['proy_{}'.format(p.id)] = {
                    'id': p.id,
                    'nombre': p.nombre,
                    'cliente': p.cliente_nombre or '',
                }
    except Exception:
        pass

    items = []
    for a in acts:
        prog = proy_names.get(a.proyecto_key) or {}
        items.append({
            'id': a.id,
            'titulo': a.titulo,
            'fecha': str(a.fecha) if a.fecha else None,
            'hora_inicio': a.hora_inicio.strftime('%H:%M') if a.hora_inicio else '',
            'hora_fin': a.hora_fin.strftime('%H:%M') if a.hora_fin else '',
            'completada': a.completada,
            'proyecto_key': a.proyecto_key or '',
            'proyecto_id': prog.get('id'),
            'proyecto_nombre': prog.get('nombre', ''),
            'cliente_nombre': prog.get('cliente', ''),
        })

    return JsonResponse({'success': True, 'items': items})


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
                'completada': a.completada,
                'fecha_completada': a.fecha_completada.isoformat() if a.fecha_completada else None,
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
            descripcion=data.get('descripcion', '').strip(),
            vehiculos=data.get('vehiculos', '').strip(),
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

        # Título del calendario = nombre de la actividad (no del proyecto).
        # El proyecto queda referenciado en la descripción y el color café
        # ya indica que es una actividad de programa de obra.
        cal_actividad = Actividad.objects.create(
            titulo=titulo or 'Actividad programada',
            tipo_actividad='reunion',
            descripcion=f"Proyecto: {proyecto_titulo}. Día: {dia_semana}. [programacion_actividad_id:{act.id}]",
            fecha_inicio=fecha_inicio_cal,
            fecha_fin=fecha_fin_cal,
            creado_por=request.user,
            color='#92400E',  # Café
        )
        if usuarios_asignados:
            cal_actividad.participantes.set(usuarios_asignados)

        # Vincular la actividad del calendario con la programacionactividad
        act.actividad_calendario = cal_actividad
        act.save(update_fields=['actividad_calendario'])

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
            except Exception as e:
                import logging as _lg
                _lg.getLogger(__name__).exception(
                    '[notif] error en programacion_proyecto user=%s: %s',
                    getattr(u, 'username', '?'), str(e))

        return JsonResponse({'success': True, 'id': act.id})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_programacion_actividad_detail(request, actividad_id):
    """GET detalle / PUT actualizar / DELETE eliminar una actividad programada."""
    act = get_object_or_404(ProgramacionActividad, pk=actividad_id)

    if request.method == 'GET':
        responsables = []
        for u in act.responsables.all():
            profile = getattr(u, 'userprofile', None)
            if profile:
                iniciales = profile.iniciales()
            elif u.first_name:
                iniciales = (u.first_name[:1] + u.last_name[:1]).upper()
            else:
                iniciales = u.username[:2].upper()
            responsables.append({
                'id': u.id,
                'nombre': u.get_full_name() or u.username,
                'iniciales': iniciales,
            })

        # Evidencias (archivos) vinculadas a esta actividad
        evidencias = []
        try:
            from .models import ProyectoEvidencia
            qs_ev = ProyectoEvidencia.objects.filter(
                entidad_tipo='programacion_actividad',
                entidad_id=act.id,
            ).order_by('-created_at')
            for e in qs_ev:
                evidencias.append({
                    'id': e.id,
                    'nombre_archivo': e.nombre_archivo,
                    'url': e.archivo.url if e.archivo else '',
                    'tipo_mime': e.tipo_mime,
                    'tamano': e.tamano,
                    'descripcion': e.descripcion,
                    'subido_por': e.subido_por.get_full_name() or e.subido_por.username,
                    'created_at': e.created_at.isoformat(),
                })
        except Exception:
            pass

        return JsonResponse({
            'success': True,
            'item': {
                'id': act.id,
                'proyecto_key': act.proyecto_key,
                'titulo': act.titulo,
                'descripcion': act.descripcion,
                'vehiculos': act.vehiculos,
                'dia_semana': act.dia_semana,
                'fecha': str(act.fecha) if act.fecha else None,
                'hora_inicio': act.hora_inicio.strftime('%H:%M'),
                'hora_fin': act.hora_fin.strftime('%H:%M'),
                'responsables': responsables,
                'completada': act.completada,
                'fecha_completada': act.fecha_completada.isoformat() if act.fecha_completada else None,
                'completada_por': (act.completada_por.get_full_name() or act.completada_por.username) if act.completada_por else None,
                'evidencia_texto': act.evidencia_texto,
                'evidencias': evidencias,
                'creado_por': act.creado_por.get_full_name() or act.creado_por.username,
                'fecha_creacion': act.fecha_creacion.isoformat(),
            }
        })

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
@require_POST
def api_programacion_actividad_completar(request, actividad_id):
    """
    Marca una actividad de programa de obra como completada y guarda la evidencia.
    Recibe multipart/form-data con:
      - evidencia_texto (str)
      - archivos (files, múltiples)
    """
    act = get_object_or_404(ProgramacionActividad, pk=actividad_id)

    evidencia_texto = request.POST.get('evidencia_texto', '').strip()
    archivos = request.FILES.getlist('archivos')

    if not evidencia_texto and not archivos:
        return JsonResponse({
            'success': False,
            'error': 'Se requiere evidencia (texto o al menos un archivo).',
        }, status=400)

    # Marcar como completada
    act.completada = True
    act.fecha_completada = timezone.now()
    act.completada_por = request.user
    act.evidencia_texto = evidencia_texto
    act.save(update_fields=['completada', 'fecha_completada', 'completada_por', 'evidencia_texto'])

    # Si la actividad es de un proyecto IAMET (proy_X), guardar archivos en ProyectoEvidencia
    archivos_guardados = 0
    if act.proyecto_key.startswith('proy_') and archivos:
        try:
            from .models import ProyectoIAMET, ProyectoEvidencia
            proyecto_id = int(act.proyecto_key.replace('proy_', ''))
            proyecto = ProyectoIAMET.objects.filter(pk=proyecto_id).first()
            if proyecto:
                for f in archivos:
                    ProyectoEvidencia.objects.create(
                        proyecto=proyecto,
                        entidad_tipo='programacion_actividad',
                        entidad_id=act.id,
                        archivo=f,
                        nombre_archivo=f.name,
                        tipo_mime=getattr(f, 'content_type', '') or '',
                        tamano=f.size,
                        descripcion=evidencia_texto[:500],
                        subido_por=request.user,
                    )
                    archivos_guardados += 1
        except Exception as exc:
            logging.exception("Error guardando evidencia de actividad programada: %s", exc)

    # Sincronizar actividad del calendario vinculada (marcar como completada)
    if act.actividad_calendario_id:
        try:
            Actividad.objects.filter(pk=act.actividad_calendario_id).update(completada=True)
        except Exception:
            pass

    return JsonResponse({
        'success': True,
        'archivos_guardados': archivos_guardados,
        'fecha_completada': act.fecha_completada.isoformat(),
    })


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
@login_required
@require_POST
def api_toggle_pin_tarea(request, tarea_id):
    """Toggle anclar/desanclar una tarea para el usuario actual."""
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    ancladas = profile.tareas_ancladas or []
    if tarea_id in ancladas:
        ancladas.remove(tarea_id)
        anclada = False
    else:
        ancladas.append(tarea_id)
        anclada = True
    profile.tareas_ancladas = ancladas
    profile.save(update_fields=['tareas_ancladas'])
    return JsonResponse({'success': True, 'anclada': anclada})


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
                # Ver tareas de otro(s) usuario(s) (para el selector del calendario):
                #   ?user_id=X       → tareas donde X es creador/asignado/participante/observador.
                #   ?user_ids=X,Y,Z  → unión de los calendarios de varios usuarios.
                # Permitido para cualquier autenticado.
                user_id_param = request.GET.get('user_id', '').strip()
                user_ids_param = request.GET.get('user_ids', '').strip()
                uid_list = []
                if user_ids_param:
                    uid_list = [int(x) for x in user_ids_param.split(',') if x.strip().isdigit()]
                elif user_id_param:
                    try:
                        uid_list = [int(user_id_param)]
                    except (ValueError, TypeError):
                        uid_list = []

                # El calendario manda ?solo_responsable=1: una tarea solo debe
                # aparecer en el calendario de su RESPONSABLE (asignado_a), no de
                # su creador, participantes ni observadores. La lista de Tareas NO
                # manda el flag, así que conserva su visibilidad amplia.
                solo_responsable = request.GET.get('solo_responsable') == '1'

                if uid_list and solo_responsable:
                    tareas = Tarea.objects.filter(
                        asignado_a_id__in=uid_list
                    ).select_related(
                        'creado_por', 'asignado_a', 'proyecto', 'oportunidad', 'oportunidad__cliente'
                    ).order_by('-fecha_creacion')
                elif uid_list:
                    ids_part = set(Tarea.objects.filter(participantes__id__in=uid_list).values_list('id', flat=True))
                    ids_obs  = set(Tarea.objects.filter(observadores__id__in=uid_list).values_list('id', flat=True))
                    ids_m2m_u = ids_part | ids_obs
                    tareas = Tarea.objects.filter(
                        Q(creado_por_id__in=uid_list) | Q(asignado_a_id__in=uid_list) | Q(id__in=ids_m2m_u)
                    ).select_related(
                        'creado_por', 'asignado_a', 'proyecto', 'oportunidad', 'oportunidad__cliente'
                    ).order_by('-fecha_creacion')
                elif request.user.is_superuser:
                    tareas = Tarea.objects.select_related(
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
                    ).select_related(
                        'creado_por', 'asignado_a', 'proyecto', 'oportunidad', 'oportunidad__cliente'
                    ).order_by('-fecha_creacion')

                # Filtro de estado
                if estado_filter == 'pendientes':
                    tareas = tareas.exclude(estado='completada')
                elif estado_filter == 'completadas':
                    tareas = tareas.filter(estado='completada')

                # Filtro por mes (YYYY-MM) — usado por el calendario para
                # no traer todo el histórico. Aplica sobre fecha_limite.
                mes_param = request.GET.get('mes', '').strip()
                if mes_param:
                    try:
                        from datetime import datetime as _dt
                        from django.utils import timezone as _tz
                        import calendar as _cal
                        year, month = int(mes_param[:4]), int(mes_param[5:7])
                        last_day = _cal.monthrange(year, month)[1]
                        desde = _tz.make_aware(_dt(year, month, 1, 0, 0, 0))
                        hasta = _tz.make_aware(_dt(year, month, last_day, 23, 59, 59))
                        tareas = tareas.filter(fecha_limite__gte=desde, fecha_limite__lte=hasta)
                    except Exception:
                        pass

                # Paginación para completadas y todas (no para pendientes)
                is_paginated = estado_filter in ('completadas', 'todas', '')
                if is_paginated:
                    q_search = request.GET.get('q', '').strip()
                    if q_search:
                        tareas = tareas.filter(titulo__icontains=q_search)
                    # per_page configurable (default 50, máx 500 para protección).
                    # El calendario usa per_page=500 para jalar todas las tareas
                    # del mes sin paginar.
                    try:
                        per_page = int(request.GET.get('per_page', 50))
                    except (TypeError, ValueError):
                        per_page = 50
                    per_page = max(1, min(per_page, 500))
                    page = max(1, int(request.GET.get('page', 1)))
                    total = tareas.count()
                    total_pages = max(1, (total + per_page - 1) // per_page)
                    page = min(page, total_pages)
                    offset = (page - 1) * per_page
                    tareas = tareas[offset:offset + per_page]
            
            # Prefetch comentarios + archivos solo cuando no se pidió un proyecto
            # u oportunidad específicos (caso del listado global del CRM, donde
            # la búsqueda extendida es relevante). Esto alimenta el search_blob.
            include_search_blob = not proyecto_id and not oportunidad_id
            if include_search_blob:
                tareas = tareas.prefetch_related('comentarios', 'comentarios__archivos')

            # Cargar ids de tareas ancladas del usuario actual
            try:
                profile_actual = UserProfile.objects.get(user=request.user)
                ancladas_ids = set(profile_actual.tareas_ancladas or [])
            except UserProfile.DoesNotExist:
                ancladas_ids = set()

            tareas_data = []
            # Conjunto de IDs de tareas con al menos una versión en el historial.
            # Una sola query (evita N+1) para marcar las que tienen modificaciones.
            from .models import TareaHistorial as _TH
            try:
                _ids_con_hist = set(
                    _TH.objects.filter(tarea_id__in=[t.id for t in tareas])
                    .values_list('tarea_id', flat=True).distinct()
                )
            except Exception:
                _ids_con_hist = set()

            for tarea in tareas:
                # Formatear tiempo trabajado
                tiempo_total_str = "00:00:00"
                if hasattr(tarea, 'tiempo_trabajado') and tarea.tiempo_trabajado:
                    total_seconds = int(tarea.tiempo_trabajado.total_seconds())
                    hours = total_seconds // 3600
                    minutes = (total_seconds % 3600) // 60
                    seconds = total_seconds % 60
                    tiempo_total_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                
                # Search blob: texto plano concatenado con todo lo que el
                # buscador debe poder matchear: titulo, descripcion, comentarios,
                # nombres de archivos adjuntos, proyecto, oportunidad y cliente.
                # Se calcula solo cuando se prefetched comentarios (listado global)
                # para no pagar el costo en vistas de proyecto/oportunidad.
                search_blob = None
                if include_search_blob:
                    blob_parts = []
                    if tarea.titulo:
                        blob_parts.append(tarea.titulo)
                    if tarea.descripcion:
                        # Truncar descripción a 600 chars para no inflar la respuesta
                        blob_parts.append(tarea.descripcion[:600])
                    if tarea.proyecto and tarea.proyecto.nombre:
                        blob_parts.append(tarea.proyecto.nombre)
                    if tarea.oportunidad:
                        if tarea.oportunidad.oportunidad:
                            blob_parts.append(tarea.oportunidad.oportunidad)
                        # PO de la oportunidad: permite buscar tareas por su PO.
                        if getattr(tarea.oportunidad, 'po_number', ''):
                            blob_parts.append(tarea.oportunidad.po_number)
                        if tarea.oportunidad.cliente and tarea.oportunidad.cliente.nombre_empresa:
                            blob_parts.append(tarea.oportunidad.cliente.nombre_empresa)
                    if tarea.asignado_a:
                        blob_parts.append(tarea.asignado_a.get_full_name() or tarea.asignado_a.username)
                    if tarea.creado_por:
                        blob_parts.append(tarea.creado_por.get_full_name() or tarea.creado_por.username)
                    # Comentarios (todos, truncados) — usa prefetch, sin queries extra
                    for c in tarea.comentarios.all():
                        if c.contenido:
                            blob_parts.append(c.contenido[:300])
                        for a in c.archivos.all():
                            if a.nombre_original:
                                blob_parts.append(a.nombre_original)
                    search_blob = ' '.join(blob_parts).lower()
                    # Cap total length para mantener payload razonable
                    if len(search_blob) > 5000:
                        search_blob = search_blob[:5000]

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
                    'oportunidad_po': (getattr(tarea.oportunidad, 'po_number', '') or None) if tarea.oportunidad else None,
                    'oportunidad_cliente': tarea.oportunidad.cliente.nombre_empresa if tarea.oportunidad and tarea.oportunidad.cliente else None,
                    'oportunidad_tipo': tarea.oportunidad.tipo_negociacion if tarea.oportunidad else None,
                    'oportunidad_etapa': tarea.oportunidad.etapa_corta if tarea.oportunidad else None,
                    'esta_anclada': tarea.id in ancladas_ids,
                    'tiene_cambios': tarea.id in _ids_con_hist,
                    'search_blob': search_blob,
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

        # Obtener Proyecto IAMET (modelo moderno) si se especificó — liga la
        # tarea al detalle del proyecto (además de la oportunidad).
        proyecto_iamet = None
        proyecto_iamet_id = data.get('proyecto_iamet_id')
        if proyecto_iamet_id:
            try:
                from .models import ProyectoIAMET
                proyecto_iamet = ProyectoIAMET.objects.get(id=proyecto_iamet_id)
            except Exception:
                proyecto_iamet = None

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
            proyecto_iamet=proyecto_iamet,
            oportunidad=oportunidad,
            tarea_padre=tarea_padre,
        )

        # Si es subtarea (tiene tarea_padre), loguear en el historial
        # de la tarea padre para que se vea allí como "Agregó una subtarea".
        if tarea_padre:
            _log_tarea_historial(
                tarea_padre, request.user, 'subtarea_add',
                nuevo=tarea.titulo,
                extra={'subtarea_id': tarea.id},
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

        # Crear comentario inicial si hay descripción. Las imágenes inline ya se
        # ven en la descripción; en este comentario solo dejamos un marcador para
        # no duplicar la imagen completa en la actividad.
        if descripcion.strip():
            import re as _re
            desc_comentario = _re.sub(r'!\[[^\]]*\]\([^)\s]+\)', '🖼️ imagen', descripcion).strip()
            if desc_comentario:
                TareaComentario.objects.create(
                    tarea=tarea,
                    usuario=request.user,
                    contenido=f"📝 Tarea creada: {desc_comentario}"
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


def _usuarios_seleccionables_responsable(request_user):
    """
    Devuelve un queryset (puede estar vacío) con los usuarios que `request_user`
    puede asignar como responsable de una actividad de calendario.

    Reglas:
      - Admin / superuser / supervisor global → todos los usuarios activos.
      - Jefe de grupo (supervisor_grupo de un GrupoTrabajo activo) → miembros
        de sus grupos (incluido él mismo y otros jefes de esos grupos).
      - Cualquier otro → solo él mismo (queryset con un único elemento).
    """
    from app.models import GrupoTrabajo

    if request_user.is_superuser or is_supervisor(request_user) or is_administrador(request_user):
        return User.objects.filter(is_active=True).order_by('first_name', 'last_name', 'username')

    # Jefes de grupo: usuarios que figuran como supervisor_grupo en algún grupo activo.
    grupos_jefe = GrupoTrabajo.objects.filter(supervisor_grupo=request_user, activo=True)
    if grupos_jefe.exists():
        ids = {request_user.id}
        for g in grupos_jefe.prefetch_related('miembros'):
            ids.update(g.miembros.values_list('id', flat=True))
        return User.objects.filter(id__in=ids, is_active=True).order_by('first_name', 'last_name', 'username')

    # Sin permiso especial: solo se puede asignar a sí mismo.
    return User.objects.filter(id=request_user.id)


@login_required
def api_calendario_seleccionables_responsable(request):
    """
    Devuelve la lista de usuarios que el solicitante puede seleccionar como
    responsable al crear una actividad de calendario.

    Respuesta:
        {
          "puede_asignar": bool,            # True si tiene a alguien además de sí mismo
          "es_admin": bool,                 # True si es admin/super/supervisor global
          "usuarios": [
            {"id": 12, "username": "ana", "nombre_completo": "Ana López", "es_yo": false},
            ...
          ]
        }
    """
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)

    qs = _usuarios_seleccionables_responsable(request.user)
    usuarios = []
    for u in qs:
        nombre = (u.first_name + ' ' + u.last_name).strip() or u.username
        usuarios.append({
            'id': u.id,
            'username': u.username,
            'nombre_completo': nombre,
            'es_yo': (u.id == request.user.id),
        })

    es_admin = bool(
        request.user.is_superuser or is_supervisor(request.user) or is_administrador(request.user)
    )
    # "puede_asignar" → hay al menos un usuario distinto al solicitante.
    puede_asignar = any(not u['es_yo'] for u in usuarios)
    return JsonResponse({
        'puede_asignar': puede_asignar,
        'es_admin': es_admin,
        'usuarios': usuarios,
    })


@login_required
@csrf_exempt
def actividad_list_create(request):
    """
    API para listar y crear actividades del calendario.
    """
    try:
        if request.method == 'GET':
            # Ver calendario de otro(s) usuario(s):
            #   ?user_id=X       → actividades donde X es creador o participante.
            #   ?user_ids=X,Y,Z  → unión de los calendarios de varios usuarios
            #                      (para multi-select en el selector del calendario).
            # Permitido para cualquier usuario autenticado — no sensible en este CRM.
            user_id_param = request.GET.get('user_id', '').strip()
            user_ids_param = request.GET.get('user_ids', '').strip()
            uid_list = []
            if user_ids_param:
                uid_list = [int(x) for x in user_ids_param.split(',') if x.strip().isdigit()]
            elif user_id_param:
                try:
                    uid_list = [int(user_id_param)]
                except (ValueError, TypeError):
                    uid_list = []

            if uid_list:
                actividades = Actividad.objects.filter(
                    Q(creado_por_id__in=uid_list) | Q(participantes__id__in=uid_list)
                ).distinct()
            elif is_supervisor(request.user):
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

            # Búsqueda de texto (búsqueda potente del calendario): cuando hay
            # ?q=, filtra por título/descripción en TODAS las fechas e ignora
            # el filtro de mes (para encontrar actividades fuera del mes visible).
            q_param = request.GET.get('q', '').strip()
            if q_param:
                actividades = actividades.filter(Q(titulo__icontains=q_param) | Q(descripcion__icontains=q_param))

            # Filtro por mes (YYYY-MM) — se omite cuando hay búsqueda de texto.
            mes_param = request.GET.get('mes', '').strip()
            if mes_param and not q_param:
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

            actividades = actividades.select_related('creado_por', 'oportunidad', 'evento', 'curso').prefetch_related('participantes')

            events = []
            _1h = timedelta(hours=1)
            for actividad in actividades:
                participants_data = [{'id': p.id, 'text': p.get_full_name() or p.username} for p in actividad.participantes.all()]
                opportunity_data = None
                if actividad.oportunidad:
                    opportunity_data = {'id': actividad.oportunidad.id, 'text': actividad.oportunidad.oportunidad, 'monto': float(actividad.oportunidad.monto or 0)}
                evento_data = None
                if actividad.evento_id:
                    evento_data = {'id': actividad.evento_id, 'nombre': actividad.evento.nombre}
                curso_data = None
                if actividad.curso_id:
                    curso_data = {'id': actividad.curso_id, 'nombre': actividad.curso.nombre}
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
                    'evento': evento_data,
                    'curso': curso_data,
                    'creado_por': {'id': actividad.creado_por.id, 'text': actividad.creado_por.get_full_name() or actividad.creado_por.username},
                    'es_mio': actividad.creado_por_id == request.user.pk,
                    'completada': actividad.completada,
                    # Cuando ≠ null, indica que la actividad es parte de
                    # una serie recurrente (varias instancias creadas
                    # juntas). El frontend usa esto para mostrar un
                    # indicador visual (icono de repetición).
                    'recurrence_group_id': str(actividad.recurrence_group_id) if actividad.recurrence_group_id else None,
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

            # ── Recurrencia (opcional) ────────────────────────────────
            # Esquema esperado en `data['recurrencia']`:
            #   { "dias": [1..7],          # 1=Lun … 7=Dom (ISO weekday)
            #     "hasta": "YYYY-MM-DD" }  # fecha límite inclusive
            # Cuando viene, generamos N Actividad reales (una por cada
            # fecha del rango que caiga en alguno de los días pedidos),
            # todas con el mismo recurrence_group_id. Cada copia conserva
            # la hora de inicio/fin original; sólo se desplaza la fecha.
            recurrencia = data.get('recurrencia') or {}
            fechas = []  # lista de (start_dt, end_dt) a crear
            recurrence_group_id = None

            if recurrencia and recurrencia.get('dias') and recurrencia.get('hasta'):
                try:
                    dias = [int(d) for d in recurrencia['dias'] if int(d) in (1, 2, 3, 4, 5, 6, 7)]
                    hasta = datetime.strptime(str(recurrencia['hasta'])[:10], '%Y-%m-%d').date()
                except (ValueError, TypeError):
                    return JsonResponse({'error': 'Recurrencia inválida.'}, status=400)
                if not dias:
                    return JsonResponse({'error': 'Debes seleccionar al menos un día de la semana.'}, status=400)

                base_start_date = start_date.date()
                if hasta < base_start_date:
                    return JsonResponse({'error': '"Repetir hasta" debe ser igual o posterior a la fecha de inicio.'}, status=400)

                # Tope defensivo: máximo ~1 año (366 días) para evitar
                # que un date picker confundido genere miles de filas.
                MAX_DAYS = 366
                span = (hasta - base_start_date).days
                if span > MAX_DAYS:
                    return JsonResponse({'error': f'El rango de recurrencia no puede exceder {MAX_DAYS} días.'}, status=400)

                duracion = end_date - start_date
                cur = base_start_date
                while cur <= hasta:
                    # isoweekday(): Mon=1 … Sun=7 — coincide con nuestros chips.
                    if cur.isoweekday() in dias:
                        # Reconstruir start con la fecha actual conservando hora/zona
                        nuevo_start = start_date.replace(year=cur.year, month=cur.month, day=cur.day)
                        nuevo_end = nuevo_start + duracion
                        fechas.append((nuevo_start, nuevo_end))
                    cur += timedelta(days=1)

                if not fechas:
                    return JsonResponse({'error': 'Ningún día del rango coincide con los días seleccionados.'}, status=400)

                import uuid as _uuid
                recurrence_group_id = _uuid.uuid4()
            else:
                fechas = [(start_date, end_date)]

            participants_ids = data.get('participants') or []
            titulo = data['title']
            tipo_actividad = data.get('tipo', 'otro')
            descripcion = data.get('description', '')
            color = data.get('color', '#1D1D1F')
            oportunidad_id = data.get('opportunity')

            # ── Responsable (opcional) ────────────────────────────────
            # Admins / supervisores globales / jefes de grupo pueden agendar
            # actividades a nombre de otro usuario. El frontend manda
            # `responsable_id` cuando seleccionan a alguien distinto.
            responsable_id_raw = data.get('responsable_id')
            try:
                responsable_id = int(responsable_id_raw) if responsable_id_raw else None
            except (ValueError, TypeError):
                responsable_id = None

            creador_obj = request.user
            if responsable_id and responsable_id != request.user.id:
                seleccionables_ids = set(
                    _usuarios_seleccionables_responsable(request.user).values_list('id', flat=True)
                )
                if responsable_id not in seleccionables_ids:
                    return JsonResponse(
                        {'error': 'No tienes permiso para asignar la actividad a ese usuario.'},
                        status=403,
                    )
                try:
                    creador_obj = User.objects.get(id=responsable_id, is_active=True)
                except User.DoesNotExist:
                    return JsonResponse({'error': 'Usuario responsable no encontrado.'}, status=404)

            # Enlace opcional a una Idea (desde el widget de detalle de Idea).
            idea_id_raw = data.get('idea')
            try:
                idea_id = int(idea_id_raw) if idea_id_raw else None
            except (ValueError, TypeError):
                idea_id = None

            from django.db import transaction
            actividades_creadas = []
            with transaction.atomic():
                for s_dt, e_dt in fechas:
                    act = Actividad.objects.create(
                        titulo=titulo,
                        tipo_actividad=tipo_actividad,
                        descripcion=descripcion,
                        fecha_inicio=s_dt,
                        fecha_fin=e_dt,
                        creado_por=creador_obj,
                        color=color,
                        oportunidad_id=oportunidad_id,
                        idea_id=idea_id,
                        recurrence_group_id=recurrence_group_id,
                    )
                    if participants_ids:
                        act.participantes.set(participants_ids)
                    actividades_creadas.append(act)

            # Por compatibilidad con la firma original (caso no-recurrente),
            # `actividad` apunta a la primera/única instancia.
            actividad = actividades_creadas[0]

            # Registrar en chat de grupo si programó actividad para compañero
            # (sólo una vez por participante, no N veces por la serie).
            try:
                from .views_grupos import registrar_accion_grupo
                actor_nombre = request.user.get_full_name() or request.user.username
                sufijo = f' ({len(actividades_creadas)} fechas)' if len(actividades_creadas) > 1 else ''
                # Notificar al responsable cuando un admin/jefe se la asignó.
                if creador_obj.id != request.user.id:
                    prop_nombre = creador_obj.get_full_name() or creador_obj.username
                    registrar_accion_grupo(
                        request.user, creador_obj,
                        'programar_actividad',
                        f'{actor_nombre} agendó la actividad "{actividad.titulo}"{sufijo} para {prop_nombre}',
                        objeto_tipo='actividad', objeto_id=actividad.id, objeto_titulo=actividad.titulo,
                    )
                # Notificar a los participantes (excluyendo al creador para no duplicar).
                for p in actividad.participantes.all():
                    if p.id != request.user.id and p.id != creador_obj.id:
                        prop_nombre = p.get_full_name() or p.username
                        registrar_accion_grupo(
                            request.user, p,
                            'programar_actividad',
                            f'{actor_nombre} programó la actividad "{actividad.titulo}"{sufijo} para {prop_nombre}',
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

            response_payload = {
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
            }
            if len(actividades_creadas) > 1:
                response_payload['recurrence_group_id'] = str(recurrence_group_id)
                response_payload['count'] = len(actividades_creadas)
                response_payload['ids'] = [a.id for a in actividades_creadas]

            return JsonResponse(response_payload, status=201)
    
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    except Exception as e:
        import traceback
        return JsonResponse({'error': str(e), 'trace': traceback.format_exc()}, status=500)


@login_required
def api_calendario_usuarios_con_eventos(request):
    """
    Devuelve los usuarios que tienen al menos un evento (Actividad o
    Tarea con fecha_limite) en el calendario, para alimentar el selector
    del widget de Calendario.

    Un usuario "tiene calendario" si es:
      - creador o participante de alguna Actividad
      - creador, asignado, participante u observador de alguna Tarea con fecha_limite

    Filtros:
      - ?mes=YYYY-MM   filtra por usuarios con eventos en ese mes (siempre
                       incluye al usuario que hace la petición).
      - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  igual pero con rango explícito.
      - ?q=...         búsqueda por nombre/apellido/username (ignora el
                       filtro de mes — para encontrar usuarios fuera del
                       rango actual).
    """
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)

    from django.contrib.auth.models import User
    from datetime import datetime as _dt
    from django.utils import timezone as _tz
    import calendar as _cal

    search_query = request.GET.get('q', '').strip()
    mes_param = request.GET.get('mes', '').strip()
    desde_param = request.GET.get('desde', '').strip()
    hasta_param = request.GET.get('hasta', '').strip()

    if search_query:
        # MODO BÚSQUEDA LIBRE: devuelve TODOS los usuarios activos cuyo
        # nombre/apellido/username coincida — tengan o NO eventos en el
        # calendario. Permite a admins/supervisores/jefes encontrar a
        # cualquier persona aunque nunca le hayan agendado nada.
        qs = User.objects.filter(is_active=True).filter(
            Q(first_name__icontains=search_query) |
            Q(last_name__icontains=search_query) |
            Q(username__icontains=search_query)
        ).order_by('first_name', 'last_name', 'username')
    else:
        # MODO LISTA: solo usuarios que tienen al menos un evento (Actividad
        # o Tarea con fecha_limite) — opcionalmente acotado por mes/rango.
        aplicar_rango = mes_param or (desde_param and hasta_param)
        rango_desde = rango_hasta = None
        if aplicar_rango:
            try:
                if mes_param:
                    year, month = int(mes_param[:4]), int(mes_param[5:7])
                    last_day = _cal.monthrange(year, month)[1]
                    rango_desde = _tz.make_aware(_dt(year, month, 1, 0, 0, 0))
                    rango_hasta = _tz.make_aware(_dt(year, month, last_day, 23, 59, 59))
                else:
                    rango_desde = _tz.make_aware(_dt.strptime(desde_param, '%Y-%m-%d').replace(hour=0, minute=0, second=0))
                    rango_hasta = _tz.make_aware(_dt.strptime(hasta_param, '%Y-%m-%d').replace(hour=23, minute=59, second=59))
            except (ValueError, TypeError):
                aplicar_rango = False

        actividades_qs = Actividad.objects.all()
        tareas_cal = Tarea.objects.exclude(fecha_limite__isnull=True)
        if aplicar_rango:
            # Una actividad cae en el rango si su intervalo cruza [desde, hasta].
            actividades_qs = actividades_qs.filter(fecha_inicio__lte=rango_hasta, fecha_fin__gte=rango_desde)
            tareas_cal = tareas_cal.filter(fecha_limite__gte=rango_desde, fecha_limite__lte=rango_hasta)

        ids_act_creador = set(actividades_qs.values_list('creado_por_id', flat=True))
        ids_act_part = set(
            actividades_qs.exclude(participantes__isnull=True)
            .values_list('participantes__id', flat=True)
        )

        ids_t_creador = set(tareas_cal.values_list('creado_por_id', flat=True))
        ids_t_asig = set(tareas_cal.exclude(asignado_a__isnull=True).values_list('asignado_a_id', flat=True))
        ids_t_part = set(tareas_cal.exclude(participantes__isnull=True).values_list('participantes__id', flat=True))
        ids_t_obs = set(tareas_cal.exclude(observadores__isnull=True).values_list('observadores__id', flat=True))

        user_ids = (ids_act_creador | ids_act_part | ids_t_creador | ids_t_asig | ids_t_part | ids_t_obs)
        user_ids.discard(None)

        # Siempre incluimos al usuario actual (para ver su propio calendario
        # aunque esté vacío en el rango filtrado).
        if request.user.id:
            user_ids.add(request.user.id)

        qs = User.objects.filter(id__in=user_ids).order_by('first_name', 'last_name', 'username')

    usuarios_data = []
    for u in qs:
        if u.first_name and u.last_name:
            iniciales = f"{u.first_name[0]}{u.last_name[0]}".upper()
            nombre_completo = f"{u.first_name} {u.last_name}"
        elif u.first_name:
            iniciales = u.first_name[0].upper()
            nombre_completo = u.first_name
        else:
            iniciales = (u.username[:1] or '?').upper()
            nombre_completo = u.username

        avatar_url = None
        try:
            if hasattr(u, 'userprofile'):
                avatar_url = u.userprofile.get_avatar_url()
        except Exception:
            avatar_url = None

        usuarios_data.append({
            'id': u.id,
            'nombre': nombre_completo,
            'username': u.username,
            'iniciales': iniciales,
            'email': u.email or '',
            'avatar_url': avatar_url,
        })

    return JsonResponse({'success': True, 'usuarios': usuarios_data})


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

        resultado_archivos = []
        for a in actividad.resultado_archivos.all():
            try:
                url = a.archivo.url if a.archivo else ''
            except Exception:
                url = ''
            resultado_archivos.append({
                'id': a.id,
                'nombre': a.nombre_original,
                'url': url,
                'tipo_archivo': a.tipo_archivo,
                'extension': a.extension,
                'tamaño': a.tamaño,
                'tamaño_formateado': a.tamaño_formateado,
            })

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
            'resultado': actividad.resultado,
            'resultado_estatus': actividad.resultado_estatus,
            'resultado_archivos': resultado_archivos,
        })

    elif request.method == 'PATCH':
        # Marcar como completada (puede hacerlo el creador, un participante, supervisor o compañero de grupo)
        es_participante = actividad.participantes.filter(pk=request.user.pk).exists()
        from .views_grupos import comparten_grupo
        es_companero = comparten_grupo(request.user, actividad.creado_por) if actividad.creado_por != request.user else False
        if actividad.creado_por != request.user and not es_participante and not is_supervisor(request.user) and not es_companero:
            return JsonResponse({'error': 'No tienes permiso para completar esta actividad.'}, status=403)
        data = json.loads(request.body)
        # Guardar resultado / estatus (resultado de actividad genérica).
        update_fields_resultado = []
        if 'resultado' in data:
            actividad.resultado = data.get('resultado') or ''
            update_fields_resultado.append('resultado')
        if 'resultado_estatus' in data:
            actividad.resultado_estatus = data.get('resultado_estatus') or ''
            update_fields_resultado.append('resultado_estatus')
        if update_fields_resultado:
            actividad.save(update_fields=update_fields_resultado)
        if 'completada' in data:
            actividad.completada = data['completada']
            actividad.save(update_fields=['completada'])
            # Si es actividad de oportunidad, completar la TareaOportunidad vinculada
            if actividad.completada and actividad.oportunidad_id:
                try:
                    from .models import TareaOportunidad
                    TareaOportunidad.objects.filter(
                        actividad_calendario=actividad,
                        estado='pendiente',
                    ).update(estado='completada')
                except Exception:
                    pass
            # Si es actividad del programa de obra, sincronizar la ProgramacionActividad vinculada
            if actividad.completada:
                try:
                    prog_acts = ProgramacionActividad.objects.filter(
                        actividad_calendario=actividad,
                        completada=False,
                    )
                    for prog in prog_acts:
                        prog.completada = True
                        prog.fecha_completada = timezone.now()
                        prog.completada_por = request.user
                        prog.save(update_fields=['completada', 'fecha_completada', 'completada_por'])
                except Exception:
                    pass
            # Si es actividad de prospecto (café, antes morada), también completar la ProspectoActividad
            if actividad.color in ('#B45309', '#8B5CF6') and actividad.completada:
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


def _detectar_tipo_archivo(extension):
    """Mapea una extensión a un tipo_archivo (mismo criterio que views_drive)."""
    ext = (extension or '').lower()
    if ext in ['pdf']:
        return 'pdf'
    elif ext in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp']:
        return 'imagen'
    elif ext in ['doc', 'docx', 'txt', 'rtf', 'odt']:
        return 'documento'
    elif ext in ['xls', 'xlsx', 'csv', 'ods']:
        return 'hoja_calculo'
    elif ext in ['ppt', 'pptx', 'odp']:
        return 'presentacion'
    elif ext in ['mp4', 'avi', 'mov', 'wmv']:
        return 'video'
    elif ext in ['mp3', 'wav', 'aac', 'flac']:
        return 'audio'
    elif ext in ['zip', 'rar', '7z', 'tar', 'gz']:
        return 'archivo_comprimido'
    return 'otro'


@csrf_exempt
@login_required
def actividad_resultado_archivo_upload(request, pk):
    """Sube un archivo adjunto al resultado de una Actividad genérica.

    Multipart: campo FormData `archivo` (un archivo por request). Mismo
    enfoque CSRF/permiso que views_drive (`@csrf_exempt` + `@login_required`).
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    from .models import ArchivoActividad
    actividad = get_object_or_404(Actividad, pk=pk)

    # Permisos: mismos que para completar la actividad (creador, participante,
    # supervisor o compañero de grupo).
    es_participante = actividad.participantes.filter(pk=request.user.pk).exists()
    from .views_grupos import comparten_grupo
    es_companero = comparten_grupo(request.user, actividad.creado_por) if actividad.creado_por != request.user else False
    if actividad.creado_por != request.user and not es_participante and not is_supervisor(request.user) and not es_companero:
        return JsonResponse({'error': 'No tienes permiso para esta actividad.'}, status=403)

    archivo_file = request.FILES.get('archivo')
    if not archivo_file:
        return JsonResponse({'error': 'Archivo requerido'}, status=400)

    extension = archivo_file.name.split('.')[-1].lower() if '.' in archivo_file.name else ''
    tipo_archivo = _detectar_tipo_archivo(extension)
    mime_type = getattr(archivo_file, 'content_type', '') or ''

    a = ArchivoActividad.objects.create(
        actividad=actividad,
        nombre_original=archivo_file.name,
        archivo=archivo_file,
        tipo_archivo=tipo_archivo,
        extension=extension,
        tamaño=archivo_file.size,
        mime_type=mime_type,
        subido_por=request.user,
    )

    try:
        url = a.archivo.url if a.archivo else ''
    except Exception:
        url = ''

    return JsonResponse({
        'ok': True,
        'archivo': {
            'id': a.id,
            'nombre': a.nombre_original,
            'url': url,
            'tipo_archivo': a.tipo_archivo,
            'extension': a.extension,
            'tamaño': a.tamaño,
            'tamaño_formateado': a.tamaño_formateado,
        },
    })


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
                
                # Verificar permisos - creador, responsable, admin o compañero de grupo
                from .views_grupos import comparten_grupo as _cg
                involucrados = [u for u in [tarea.asignado_a, tarea.creado_por] if u and u != request.user]
                user_can_edit = (
                    tarea.creado_por == request.user or
                    tarea.asignado_a == request.user or
                    request.user.is_superuser or
                    any(_cg(request.user, u) for u in involucrados)
                )

                # Obtener datos de la petición (los necesitamos para el chequeo extendido del ingeniero)
                user_id = data.get('user_id')
                action = data.get('action')  # 'add' o 'remove'
                tipo = data.get('tipo')      # 'participantes' o 'observadores'

                # Permiso extendido para ingenieros:
                #   - Pueden agregar cualquier usuario como participante/observador en
                #     cualquier tarea que puedan ver (el GET de esta misma vista es
                #     abierto a autenticados).
                #   - Pueden quitarse a sí mismos como participante/observador.
                # (Para quitarse como responsable usan api_actualizar_tarea_real, que
                # ya permite editar cuando el usuario actual es asignado_a.)
                if not user_can_edit:
                    try:
                        _prof = getattr(request.user, 'userprofile', None)
                        _es_ing = bool(_prof and getattr(_prof, 'rol', 'vendedor') == 'ingeniero')
                    except Exception:
                        _es_ing = False
                    if _es_ing and tipo in ('participantes', 'observadores'):
                        try:
                            _uid_int = int(user_id) if user_id is not None else None
                        except (TypeError, ValueError):
                            _uid_int = None
                        if action == 'add':
                            user_can_edit = True
                        elif action == 'remove' and _uid_int == request.user.id:
                            user_can_edit = True

                print(f"🔍 Permisos - Creador: {tarea.creado_por.username}, Resp: {getattr(tarea.asignado_a, 'username', None)}, Current: {request.user.username}, Can edit: {user_can_edit}")

                if not user_can_edit:
                    return JsonResponse({'error': 'Sin permisos para modificar esta tarea'}, status=403)

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
                nombre_usuario = usuario.get_full_name() or usuario.username
                if tipo == 'participantes':
                    if action == 'add':
                        tarea.participantes.add(usuario)
                        print(f"✅ AGREGADO como participante: {usuario.username}")
                        mensaje = f"{nombre_usuario} ha sido agregado como participante a la tarea '{tarea.titulo}'"
                        _log_tarea_historial(tarea, request.user, 'participante_add',
                                             nuevo=nombre_usuario, extra={'user_id': usuario.id})
                    elif action == 'remove':
                        tarea.participantes.remove(usuario)
                        print(f"❌ REMOVIDO como participante: {usuario.username}")
                        mensaje = f"{nombre_usuario} ha sido removido como participante de la tarea '{tarea.titulo}'"
                        _log_tarea_historial(tarea, request.user, 'participante_remove',
                                             anterior=nombre_usuario, extra={'user_id': usuario.id})
                elif tipo == 'observadores':
                    if action == 'add':
                        tarea.observadores.add(usuario)
                        print(f"✅ AGREGADO como observador: {usuario.username}")
                        mensaje = f"{nombre_usuario} ha sido agregado como observador a la tarea '{tarea.titulo}'"
                        _log_tarea_historial(tarea, request.user, 'observador_add',
                                             nuevo=nombre_usuario, extra={'user_id': usuario.id})
                    elif action == 'remove':
                        tarea.observadores.remove(usuario)
                        print(f"❌ REMOVIDO como observador: {usuario.username}")
                        mensaje = f"{nombre_usuario} ha sido removido como observador de la tarea '{tarea.titulo}'"
                        _log_tarea_historial(tarea, request.user, 'observador_remove',
                                             anterior=nombre_usuario, extra={'user_id': usuario.id})
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
def api_tarea_historial(request, tarea_id):
    """GET lista de versiones de una Tarea (proyectos) ordenadas DESC por fecha.

    Mismo shape que api_tarea_opp_historial para que el frontend pueda
    usar el mismo renderer del timeline.
    """
    if request.method != 'GET':
        return JsonResponse({'success': False, 'error': 'Solo GET'}, status=405)

    from .models import Tarea
    tarea = get_object_or_404(Tarea, pk=tarea_id)
    qs = (
        tarea.historial
        .select_related('autor')
        .order_by('-fecha')
    )

    def _avatar_url(u):
        if not u:
            return None
        try:
            if hasattr(u, 'userprofile'):
                return u.userprofile.get_avatar_url()
        except Exception:
            pass
        return None

    items = []
    for h in qs:
        autor_nombre = ''
        autor_iniciales = '?'
        if h.autor:
            autor_nombre = h.autor.get_full_name() or h.autor.username
            partes = [p for p in autor_nombre.split() if p]
            autor_iniciales = (partes[0][0] + partes[-1][0]).upper() if len(partes) >= 2 else autor_nombre[:2].upper()
        items.append({
            'id': h.id,
            'fecha': h.fecha.isoformat(),
            'tipo': h.tipo,
            'tipo_label': h.get_tipo_display(),
            'autor': {
                'id': h.autor_id,
                'nombre': autor_nombre,
                'iniciales': autor_iniciales,
                'avatar_url': _avatar_url(h.autor),
            } if h.autor_id else None,
            'valor_anterior': h.valor_anterior,
            'valor_nuevo': h.valor_nuevo,
            'motivo': h.motivo,
            'extra': h.extra,
        })

    return JsonResponse({'success': True, 'historial': items, 'total': len(items)})


@login_required
def api_notificaciones(request):
    """
    API para obtener notificaciones del usuario actual
    """
    if request.method == 'GET':
        try:
            # Obtener notificaciones no leídas del usuario.
            # related_name correcto es 'notificaciones_recibidas' (ver modelo).
            qs = request.user.notificaciones_recibidas.filter(
                leida=False
            ).select_related('usuario_remitente').order_by('-fecha_creacion')[:10]

            notificaciones_data = []
            for notif in qs:
                remitente = notif.usuario_remitente
                remitente_nombre = None
                if remitente:
                    remitente_nombre = remitente.get_full_name() or remitente.username
                notificaciones_data.append({
                    'id': notif.id,
                    'tipo': notif.tipo,
                    'titulo': notif.titulo,
                    'mensaje': notif.mensaje,
                    # No existe campo url en el modelo — se deriva si hace falta
                    'url': '',
                    'fecha_creacion': notif.fecha_creacion.isoformat(),
                    'creado_por': remitente_nombre,
                })

            return JsonResponse({
                'success': True,
                'notificaciones': notificaciones_data,
                'total_no_leidas': request.user.notificaciones_recibidas.filter(leida=False).count()
            })

        except Exception as e:
            import traceback; traceback.print_exc()
            return JsonResponse({'error': str(e)}, status=500)
    
    elif request.method == 'PUT':
        try:
            import json
            data = json.loads(request.body)
            
            # Marcar notificación como leída
            notif_id = data.get('id')
            if notif_id:
                from .models import Notificacion
                notificacion = Notificacion.objects.get(id=notif_id, usuario_destinatario=request.user)
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

        # Historial: tarea completada.
        _log_tarea_historial(tarea, request.user, 'cerrada',
                             anterior='pendiente', nuevo='completada')
        # Si es subtarea, también loguear en la padre.
        if tarea.tarea_padre_id:
            _log_tarea_historial(
                tarea.tarea_padre, request.user, 'subtarea_complete',
                nuevo=tarea.titulo,
                extra={'subtarea_id': tarea.id},
            )

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
        # La feature "Requiere verificación al avanzar" fue removida en
        # 2026-05-28: la cadena reactiva SIEMPRE se ejecuta automáticamente
        # cuando la regla tiene avanzar_etapa_al_completar=True. Ya no se
        # crean AvanceEtapaPendiente ni se abre widget bloqueante.
        cadena_resultado = None
        avance_pendiente_info = None
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

        if avance_pendiente_info:
            # Flag para que el frontend sepa que tiene que abrir el modal de
            # avance de etapa antes de refrescar.
            response_data['requiere_descripcion'] = True
            response_data['avance_pendiente'] = avance_pendiente_info

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

        # Historial: tarea reabierta con motivo.
        _log_tarea_historial(tarea, request.user, 'reabierta',
                             anterior='completada', nuevo='pendiente',
                             motivo=razon)

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

        # Creador, responsable, superusuario o compañero de grupo pueden editar todo
        # (titulo, descripcion, fecha_limite, prioridad, asignado_a, etc.)
        if not (es_creador or es_responsable or request.user.is_superuser or es_companero_grupo):
            return JsonResponse({'error': 'Sin permisos para editar esta tarea'}, status=403)

        # Si se cambia fecha_limite y se envía razón, se notifica a admins (audit trail).
        # La razón ya NO es obligatoria — creador y responsable la pueden cambiar libremente.

        # Snapshot ANTES del save para detectar cambios y generar versiones
        # en TareaHistorial. La razon_reprogramacion (si llega) se usa como
        # 'motivo' del cambio de fecha_limite.
        _snap = {
            'titulo': tarea.titulo,
            'descripcion': tarea.descripcion,
            'prioridad': tarea.prioridad,
            'fecha_limite': tarea.fecha_limite,
            'asignado_a_id': tarea.asignado_a_id,
            'cliente_id': tarea.cliente_id,
            'oportunidad_id': tarea.oportunidad_id,
        }
        _motivo_payload = (data.get('motivo') or data.get('razon_reprogramacion') or '').strip()

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

        # ─── Historial: log de cada cambio escalar detectado ───
        from django.contrib.auth.models import User as _UserH
        def _resp_label_h(uid):
            if not uid:
                return '— sin asignar —'
            try:
                u = _UserH.objects.get(pk=uid)
                return u.get_full_name() or u.username
            except _UserH.DoesNotExist:
                return f'User #{uid}'
        def _fmt_dt_h(dt):
            return dt.strftime('%Y-%m-%d %H:%M') if dt else ''
        if ('nombre' in data or 'titulo' in data) and _snap['titulo'] != tarea.titulo:
            _log_tarea_historial(tarea, request.user, 'titulo',
                                 anterior=_snap['titulo'], nuevo=tarea.titulo)
        if 'descripcion' in data and _snap['descripcion'] != tarea.descripcion:
            _log_tarea_historial(tarea, request.user, 'descripcion',
                                 anterior=_snap['descripcion'], nuevo=tarea.descripcion)
        if 'prioridad' in data and _snap['prioridad'] != tarea.prioridad:
            _log_tarea_historial(tarea, request.user, 'prioridad',
                                 anterior=_snap['prioridad'], nuevo=tarea.prioridad)
        if 'fecha_limite' in data and _snap['fecha_limite'] != tarea.fecha_limite:
            _log_tarea_historial(tarea, request.user, 'fecha_limite',
                                 anterior=_fmt_dt_h(_snap['fecha_limite']),
                                 nuevo=_fmt_dt_h(tarea.fecha_limite),
                                 motivo=_motivo_payload)
        if 'asignado_a' in data and _snap['asignado_a_id'] != tarea.asignado_a_id:
            _log_tarea_historial(tarea, request.user, 'responsable',
                                 anterior=_resp_label_h(_snap['asignado_a_id']),
                                 nuevo=_resp_label_h(tarea.asignado_a_id),
                                 extra={'old_id': _snap['asignado_a_id'], 'new_id': tarea.asignado_a_id})
        if 'cliente_id' in data and _snap['cliente_id'] != tarea.cliente_id:
            _log_tarea_historial(tarea, request.user, 'cliente',
                                 anterior=str(_snap['cliente_id'] or ''),
                                 nuevo=(tarea.cliente.nombre_empresa if tarea.cliente_id else ''))
        if 'oportunidad_id' in data and _snap['oportunidad_id'] != tarea.oportunidad_id:
            _log_tarea_historial(tarea, request.user, 'oportunidad',
                                 anterior=str(_snap['oportunidad_id'] or ''),
                                 nuevo=(tarea.oportunidad.oportunidad if tarea.oportunidad_id else ''))

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

            # Responsable opcional: admins / supervisores / jefes de grupo
            # pueden agendar la actividad a nombre de otro usuario. Si llega
            # `responsable_id`, validamos contra los usuarios seleccionables
            # (misma regla que el calendario global) y luego usamos ese user
            # como creado_por de la Actividad — así aparece en SU calendario.
            responsable_id_raw = data.get('responsable_id')
            try:
                responsable_id = int(responsable_id_raw) if responsable_id_raw else None
            except (ValueError, TypeError):
                responsable_id = None

            actividad_owner = request.user
            if responsable_id and responsable_id != request.user.id:
                seleccionables_ids = set(
                    _usuarios_seleccionables_responsable(request.user).values_list('id', flat=True)
                )
                if responsable_id not in seleccionables_ids:
                    return JsonResponse(
                        {'success': False, 'error': 'No tienes permiso para asignar la actividad a ese usuario.'},
                        status=403,
                    )
                try:
                    actividad_owner = User.objects.get(id=responsable_id, is_active=True)
                except User.DoesNotExist:
                    return JsonResponse({'success': False, 'error': 'Usuario responsable no encontrado.'}, status=404)

            tarea = TareaOportunidad.objects.create(
                oportunidad=opp,
                titulo=titulo,
                descripcion=data.get('descripcion', ''),
                prioridad='alta' if data.get('alta_prioridad') else 'normal',
                fecha_limite=fecha_limite,
                creado_por=request.user,
                responsable_id=responsable_id,
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
                    creado_por=actividad_owner,
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


def _log_tarea_opp_historial(tarea, autor, tipo, anterior='', nuevo='', motivo='', extra=None):
    """Helper: crea una fila en TareaOportunidadHistorial. NO es vista."""
    from .models import TareaOportunidadHistorial
    try:
        TareaOportunidadHistorial.objects.create(
            tarea=tarea, autor=autor, tipo=tipo,
            valor_anterior=str(anterior or ''),
            valor_nuevo=str(nuevo or ''),
            motivo=motivo or '',
            extra=extra,
        )
    except Exception as e:
        # No bloquear el flujo si el log falla.
        print(f'[historial] No se pudo registrar cambio: {e}')


def _log_tarea_historial(tarea, autor, tipo, anterior='', nuevo='', motivo='', extra=None):
    """Helper: crea una fila en TareaHistorial (modelo Tarea de proyectos)."""
    from .models import TareaHistorial
    try:
        TareaHistorial.objects.create(
            tarea=tarea, autor=autor, tipo=tipo,
            valor_anterior=str(anterior or ''),
            valor_nuevo=str(nuevo or ''),
            motivo=motivo or '',
            extra=extra,
        )
    except Exception as e:
        print(f'[historial] No se pudo registrar cambio Tarea: {e}')


def _fmt_dt_for_history(dt):
    if not dt:
        return ''
    return dt.strftime('%Y-%m-%d %H:%M')


@login_required
def api_tarea_oportunidad_detail(request, tarea_id):
    """PUT actualizar / DELETE eliminar — una tarea de oportunidad.

    Versionado: cada cambio relevante genera una fila en
    TareaOportunidadHistorial. Los flujos donde el frontend puede mandar
    un 'motivo' (reabrir, cambiar fecha) lo asocian al registro
    correspondiente.
    """
    tarea = get_object_or_404(TareaOportunidad, pk=tarea_id)
    user = request.user

    if tarea.creado_por != user and tarea.responsable != user and not is_supervisor(user):
        from .views_grupos import comparten_grupo
        involucrados = [u for u in [tarea.responsable, tarea.creado_por] if u and u != user]
        if not any(comparten_grupo(user, u) for u in involucrados):
            return JsonResponse({'error': 'Sin permiso'}, status=403)

    if request.method == 'PUT':
        data = json.loads(request.body)
        motivo = (data.get('motivo') or '').strip()

        # Snapshot de campos escalares antes del save para detectar cambios.
        snap = {
            'titulo': tarea.titulo,
            'descripcion': tarea.descripcion,
            'prioridad': tarea.prioridad,
            'estado': tarea.estado,
            'fecha_limite': tarea.fecha_limite,
            'responsable_id': tarea.responsable_id,
        }

        if 'titulo' in data:
            tarea.titulo = data['titulo']
        if 'descripcion' in data:
            tarea.descripcion = data['descripcion']
        if 'estado' in data:
            tarea.estado = data['estado']
            # Si se completa, también completar la Actividad del calendario vinculada
            if data['estado'] == 'completada' and tarea.actividad_calendario_id:
                try:
                    tarea.actividad_calendario.completada = True
                    tarea.actividad_calendario.save(update_fields=['completada'])
                except Exception:
                    pass
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
            # Historial: cambio de responsable.
            if new_resp_id != old_resp_id:
                def _resp_label(uid):
                    if not uid:
                        return '— sin responsable —'
                    try:
                        u = User.objects.get(pk=uid)
                        return u.get_full_name() or u.username
                    except User.DoesNotExist:
                        return f'User #{uid}'
                _log_tarea_opp_historial(
                    tarea, user, 'responsable',
                    anterior=_resp_label(old_resp_id),
                    nuevo=_resp_label(new_resp_id),
                    extra={'old_id': old_resp_id, 'new_id': new_resp_id},
                )
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
                _log_tarea_opp_historial(
                    tarea, user, 'participante_add',
                    nuevo=u.get_full_name() or u.username,
                    extra={'user_id': u.id},
                )
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
                _log_tarea_opp_historial(
                    tarea, user, 'participante_remove',
                    anterior=u.get_full_name() or u.username,
                    extra={'user_id': u.id},
                )
                return JsonResponse({'success': True})
            except User.DoesNotExist:
                return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
        if 'observador_add' in data:
            try:
                u = User.objects.get(pk=data['observador_add'])
                tarea.observadores.add(u)
                _log_tarea_opp_historial(
                    tarea, user, 'observador_add',
                    nuevo=u.get_full_name() or u.username,
                    extra={'user_id': u.id},
                )
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
                _log_tarea_opp_historial(
                    tarea, user, 'observador_remove',
                    anterior=u.get_full_name() or u.username,
                    extra={'user_id': u.id},
                )
                return JsonResponse({'success': True})
            except User.DoesNotExist:
                return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
        tarea.save()

        # ─── Historial de cambios escalares (después del save) ───
        if 'titulo' in data and snap['titulo'] != tarea.titulo:
            _log_tarea_opp_historial(
                tarea, user, 'titulo',
                anterior=snap['titulo'], nuevo=tarea.titulo,
            )
        if 'descripcion' in data and snap['descripcion'] != tarea.descripcion:
            _log_tarea_opp_historial(
                tarea, user, 'descripcion',
                anterior=snap['descripcion'], nuevo=tarea.descripcion,
            )
        if 'prioridad' in data and snap['prioridad'] != tarea.prioridad:
            _log_tarea_opp_historial(
                tarea, user, 'prioridad',
                anterior=tarea._meta.get_field('prioridad').choices and dict(tarea._meta.get_field('prioridad').choices).get(snap['prioridad'], snap['prioridad']) or snap['prioridad'],
                nuevo=tarea.get_prioridad_display(),
            )
        if 'estado' in data and snap['estado'] != tarea.estado:
            # 'cerrada' al pasar a completada; 'reabierta' al volver a pendiente.
            if tarea.estado == 'completada':
                _log_tarea_opp_historial(tarea, user, 'cerrada', anterior=snap['estado'], nuevo=tarea.estado, motivo=motivo)
            elif snap['estado'] == 'completada' and tarea.estado == 'pendiente':
                _log_tarea_opp_historial(tarea, user, 'reabierta', anterior=snap['estado'], nuevo=tarea.estado, motivo=motivo)
            else:
                _log_tarea_opp_historial(tarea, user, 'cerrada' if tarea.estado == 'completada' else 'reabierta',
                                         anterior=snap['estado'], nuevo=tarea.estado, motivo=motivo)
        if 'fecha_limite' in data and snap['fecha_limite'] != tarea.fecha_limite:
            _log_tarea_opp_historial(
                tarea, user, 'fecha_limite',
                anterior=_fmt_dt_for_history(snap['fecha_limite']),
                nuevo=_fmt_dt_for_history(tarea.fecha_limite),
                motivo=motivo,
            )

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
def api_tarea_opp_historial(request, tarea_id):
    """GET lista de versiones de una TareaOportunidad ordenadas DESC por fecha.

    Cada item incluye el autor (nombre + avatar_url), el tipo de cambio
    con su label legible, valor anterior/nuevo, motivo (si aplica) y
    extra para datos auxiliares.
    """
    if request.method != 'GET':
        return JsonResponse({'success': False, 'error': 'Solo GET'}, status=405)

    tarea = get_object_or_404(TareaOportunidad, pk=tarea_id)
    qs = (
        tarea.historial
        .select_related('autor')
        .order_by('-fecha')
    )

    def _avatar_url(u):
        if not u:
            return None
        try:
            if hasattr(u, 'userprofile'):
                return u.userprofile.get_avatar_url()
        except Exception:
            pass
        return None

    items = []
    for h in qs:
        autor_nombre = ''
        autor_iniciales = '?'
        if h.autor:
            autor_nombre = h.autor.get_full_name() or h.autor.username
            partes = [p for p in autor_nombre.split() if p]
            autor_iniciales = (partes[0][0] + partes[-1][0]).upper() if len(partes) >= 2 else autor_nombre[:2].upper()
        items.append({
            'id': h.id,
            'fecha': h.fecha.isoformat(),
            'tipo': h.tipo,
            'tipo_label': h.get_tipo_display(),
            'autor': {
                'id': h.autor_id,
                'nombre': autor_nombre,
                'iniciales': autor_iniciales,
                'avatar_url': _avatar_url(h.autor),
            } if h.autor_id else None,
            'valor_anterior': h.valor_anterior,
            'valor_nuevo': h.valor_nuevo,
            'motivo': h.motivo,
            'extra': h.extra,
        })

    return JsonResponse({'success': True, 'historial': items, 'total': len(items)})


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


# ═══════════════════════════════════════════════════
# TAREA — compartir vista previa pública + eliminar
# ═══════════════════════════════════════════════════

@login_required
def api_tarea_share_link(request, tarea_id):
    """Genera un enlace firmado (sin expiración) para vista previa pública de la tarea."""
    from django.core import signing
    if request.method != 'GET':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)
    tarea = get_object_or_404(Tarea, id=tarea_id)
    # Cualquier usuario autenticado que pueda ver la tarea puede compartirla
    token = signing.dumps({'t': tarea.id}, salt='tarea-preview')
    from django.urls import reverse
    url = reverse('ver_tarea_compartida', args=[token])
    return JsonResponse({'success': True, 'url': url, 'token': token})


def ver_tarea_compartida(request, token):
    """Vista pública read-only de una tarea a partir de un token firmado.
    No requiere login. Renderiza el template tarea_compartida.html.

    Si el usuario YA tiene sesión activa, redirigimos SERVER-SIDE directo
    al home del CRM con ?open_task=<id> — el redirect JS de antes era
    flakey (algunos browsers in-app no lo ejecutaban y dejaban al usuario
    atascado en la vista previa). Los crawlers de Open Graph (WhatsApp,
    Slack, etc.) NO están autenticados, así que ellos siguen recibiendo
    el HTML con meta tags para el preview enriquecido.
    """
    from django.core import signing
    from django.http import Http404
    from django.shortcuts import redirect
    try:
        data = signing.loads(token, salt='tarea-preview')
    except signing.BadSignature:
        raise Http404('Enlace inválido o expirado')
    tarea_id = data.get('t')
    tarea = get_object_or_404(Tarea, id=tarea_id)

    # Redirect server-side para usuarios autenticados: nada de vista previa.
    if request.user.is_authenticated:
        return redirect(f'/app/home/?tab=tareas&open_task={tarea.id}')

    creador_nombre = (tarea.creado_por.get_full_name() or tarea.creado_por.username) if tarea.creado_por else '—'
    responsable_nombre = None
    if tarea.asignado_a:
        responsable_nombre = tarea.asignado_a.get_full_name() or tarea.asignado_a.username

    subtareas = [{
        'id': st.id,
        'titulo': st.titulo,
        'estado': st.estado,
    } for st in tarea.subtareas.all()] if hasattr(tarea, 'subtareas') else []

    ctx = {
        'tarea': tarea,
        'creador_nombre': creador_nombre,
        'responsable_nombre': responsable_nombre,
        'subtareas': subtareas,
        'total_subtareas': len(subtareas),
        'subtareas_done': sum(1 for s in subtareas if s['estado'] == 'completada'),
        'autenticado': request.user.is_authenticated,
        'preview_token': token,
    }
    return render(request, 'crm/tarea_compartida.html', ctx)


def og_image_tarea(request, token):
    """Genera un PNG 1200×630 que recrea el widget de detalle de tarea
    para preview en WhatsApp/Slack. Layout 2-cols como el real:
    izquierda título + botón verde + descripción; derecha sidebar con
    estado, responsable, creador, fecha límite (con subtítulo "vence
    en X"), prioridad, participantes y observadores (con avatars).
    """
    from django.core import signing
    from django.http import HttpResponse, Http404
    from django.utils import timezone as _tz
    from io import BytesIO
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        raise Http404('Pillow no instalado')

    try:
        data = signing.loads(token, salt='tarea-preview')
    except signing.BadSignature:
        raise Http404('Token inválido')
    tarea = get_object_or_404(Tarea, id=data.get('t'))

    W, H = 1200, 630
    img = Image.new('RGB', (W, H), color='#F4F6F8')
    draw = ImageDraw.Draw(img)

    def _load(size, bold=False):
        path = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        try:
            return ImageFont.truetype(path, size)
        except (IOError, OSError):
            return ImageFont.load_default()
    f_crumb = _load(13)
    f_title = _load(34, bold=True)
    f_btn = _load(14, bold=True)
    f_section = _load(11, bold=True)
    f_body = _load(17)
    f_sb_label = _load(10, bold=True)
    f_sb_value = _load(15, bold=True)
    f_sb_sub = _load(12)
    f_avatar = _load(11, bold=True)
    f_footer = _load(13)

    # Card blanca
    M = 30
    draw.rounded_rectangle([M, M, W - M, H - M], radius=18, fill='#FFFFFF', outline='#E2E8F0', width=1)

    # ── Sidebar separator vertical ────────────────────────────────
    SB_W = 360
    sb_x = W - M - SB_W
    draw.line([(sb_x, M + 20), (sb_x, H - M - 20)], fill='#E2E8F0', width=1)

    # Wrap helper
    def _wrap(text, max_chars):
        words = (text or '').split()
        lines, cur = [], ''
        for w in words:
            test = (cur + ' ' + w).strip()
            if len(test) > max_chars and cur:
                lines.append(cur)
                cur = w
            else:
                cur = test
        if cur:
            lines.append(cur)
        return lines

    # Color por usuario (hash → paleta)
    _palette = ['#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#10B981', '#6366F1', '#14B8A6', '#F59E0B']

    def _color_for(name):
        return _palette[sum(ord(c) for c in (name or '?')) % len(_palette)]

    def _initials(name):
        parts = (name or '?').split()
        return ''.join([p[0].upper() for p in parts[:2]]) if parts else '?'

    def _draw_avatar(cx, cy, size, name, color=None):
        col = color or _color_for(name)
        draw.ellipse([cx, cy, cx + size, cy + size], fill=col)
        ini = _initials(name)
        bbox = draw.textbbox((0, 0), ini, font=f_avatar)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((cx + size / 2 - tw / 2, cy + size / 2 - th / 2 - 1), ini, fill='#FFFFFF', font=f_avatar)

    # ═══════════════════════════════════════════════════════════════
    # LADO IZQUIERDO — título, botón completar, descripción
    # ═══════════════════════════════════════════════════════════════
    PAD = 38
    lx = M + PAD
    ly = M + 32
    l_right = sb_x - PAD

    # Pill: oportunidad o cliente
    crumb_text = None
    if getattr(tarea, 'oportunidad', None) and getattr(tarea.oportunidad, 'titulo', None):
        crumb_text = tarea.oportunidad.titulo
    elif getattr(tarea, 'cliente', None) and getattr(tarea.cliente, 'nombre_empresa', None):
        crumb_text = tarea.cliente.nombre_empresa
    if crumb_text:
        crumb_text = crumb_text[:34]
        bb = draw.textbbox((0, 0), crumb_text, font=f_crumb)
        pw = bb[2] - bb[0] + 22
        draw.rounded_rectangle([lx, ly, lx + pw, ly + 26], radius=13, fill='#F1F5F9')
        draw.text((lx + 11, ly + 6), crumb_text, fill='#64748B', font=f_crumb)
        ly += 40

    # Título (2 líneas, wrap a ~24 chars con 34pt en col izquierda ~720px)
    titulo_lines = _wrap(tarea.titulo or 'Tarea', 30)[:2]
    for line in titulo_lines:
        draw.text((lx, ly), line, fill='#0F172A', font=f_title)
        ly += 42
    ly += 12

    # Botón "Completar tarea" (visual, verde como el widget real)
    btn_text = '✓ Completar tarea' if tarea.estado != 'completada' else '✓ Completada'
    btn_color = '#10B981' if tarea.estado != 'completada' else '#94A3B8'
    bb = draw.textbbox((0, 0), btn_text, font=f_btn)
    bw = bb[2] - bb[0] + 36
    draw.rounded_rectangle([lx, ly, lx + bw, ly + 38], radius=10, fill=btn_color)
    draw.text((lx + 18, ly + 11), btn_text, fill='#FFFFFF', font=f_btn)
    ly += 56

    # Section header "DESCRIPCIÓN"
    draw.text((lx, ly), 'DESCRIPCIÓN', fill='#94A3B8', font=f_section)
    ly += 22

    # Descripción
    desc = (tarea.descripcion or '').strip()
    if desc:
        import re as _re
        desc = _re.sub(r'[*_`#>\[\]]+', '', desc).replace('\n', ' ').strip()
        # Ancho ≈ 700px, 17pt ≈ 10px/char → 65 chars
        max_lines = 5
        desc_lines = _wrap(desc, 62)[:max_lines]
        for line in desc_lines:
            draw.text((lx, ly), line, fill='#1E293B', font=f_body)
            ly += 26
    else:
        draw.text((lx, ly), 'Sin descripción.', fill='#94A3B8', font=f_body)

    # Footer en el extremo inferior izquierdo
    draw.text((lx, H - M - 32), 'Abre el link para ver la tarea completa →', fill='#94A3B8', font=f_footer)

    # ═══════════════════════════════════════════════════════════════
    # SIDEBAR DERECHO — meta rich (estado, responsable, creador,
    # fecha + vence en X, prioridad, participantes, observadores)
    # ═══════════════════════════════════════════════════════════════
    SB_PAD = 28
    sx = sb_x + SB_PAD
    sw = SB_W - SB_PAD * 2
    sy = M + 24

    # Helper para sección "LABEL" + valor (devuelve la nueva y)
    def _section_label(text, top_y):
        draw.text((sx, top_y), text, fill='#94A3B8', font=f_sb_label)
        return top_y + 16

    SECTION_GAP = 16

    # ESTADO
    estado_map = {
        'pendiente':    ('Pendiente',   '#F59E0B'),
        'iniciada':     ('Iniciada',    '#8B5CF6'),
        'en_progreso':  ('En progreso', '#3B82F6'),
        'completada':   ('Completada',  '#10B981'),
        'cancelada':    ('Cancelada',   '#94A3B8'),
    }
    e_label, e_color = estado_map.get(tarea.estado, ('Pendiente', '#F59E0B'))
    sy = _section_label('ESTADO', sy)
    draw.ellipse([sx, sy + 6, sx + 10, sy + 16], fill=e_color)
    draw.text((sx + 18, sy + 1), e_label, fill='#1E293B', font=f_sb_value)
    sy += 26 + SECTION_GAP

    # RESPONSABLE
    sy = _section_label('RESPONSABLE', sy)
    if tarea.asignado_a_id:
        resp = tarea.asignado_a
        resp_name = (resp.get_full_name() or resp.username) if resp else '—'
    else:
        resp_name = 'Sin asignar'
    _draw_avatar(sx, sy, 26, resp_name)
    draw.text((sx + 34, sy + 5), resp_name[:24], fill='#1E293B', font=f_sb_value)
    sy += 32 + SECTION_GAP

    # CREADOR
    sy = _section_label('CREADOR', sy)
    if tarea.creado_por_id:
        cr = tarea.creado_por
        cr_name = (cr.get_full_name() or cr.username) if cr else '—'
    else:
        cr_name = '—'
    _draw_avatar(sx, sy, 26, cr_name)
    draw.text((sx + 34, sy + 5), cr_name[:24], fill='#1E293B', font=f_sb_value)
    sy += 32 + SECTION_GAP

    # FECHA LÍMITE + subtítulo "Vence en X"
    if tarea.fecha_limite:
        sy = _section_label('FECHA LÍMITE', sy)
        fl = tarea.fecha_limite
        meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
        fecha_str = f'{fl.day} {meses[fl.month - 1]}, {fl.hour:02d}:{fl.minute:02d}'
        now = _tz.now()
        delta = fl - now
        secs = delta.total_seconds()
        completada = tarea.estado in ('completada', 'cancelada')
        # Colores: rojo si vencida, naranja si <24h, verde >=24h, gris si completada
        if completada:
            box_bg, txt_color, sub_text, sub_color = '#F1F5F9', '#64748B', 'Completada', '#64748B'
        elif secs < 0:
            box_bg, txt_color = '#FEE2E2', '#B91C1C'
            hrs = int(abs(secs) // 3600)
            days = hrs // 24
            sub_text = f'Vencida hace {days} día{"s" if days != 1 else ""}' if days >= 1 else f'Vencida hace {hrs} h'
            sub_color = '#B91C1C'
        elif secs < 86400:
            box_bg, txt_color = '#FEF3C7', '#B45309'
            hrs = int(secs // 3600)
            sub_text = f'Vence en {hrs} hora{"s" if hrs != 1 else ""}'
            sub_color = '#B45309'
        else:
            box_bg, txt_color = '#F1F5F9', '#1E293B'
            days = int(secs // 86400)
            sub_text = f'Vence en {days} día{"s" if days != 1 else ""}'
            sub_color = '#64748B'
        # Box pill alrededor
        draw.rounded_rectangle([sx, sy, sx + sw, sy + 48], radius=10, fill=box_bg)
        draw.text((sx + 12, sy + 5), fecha_str, fill=txt_color, font=f_sb_value)
        draw.text((sx + 12, sy + 28), sub_text, fill=sub_color, font=f_sb_sub)
        sy += 48 + SECTION_GAP

    # PRIORIDAD
    sy = _section_label('PRIORIDAD', sy)
    prio_map = {'alta': ('Alta', '#DC2626'), 'media': ('Normal', '#F59E0B'), 'baja': ('Baja', '#94A3B8')}
    p_label, p_color = prio_map.get(tarea.prioridad, ('Normal', '#F59E0B'))
    # Pill outlined
    draw.rounded_rectangle([sx, sy, sx + 90, sy + 26], radius=13, outline='#E2E8F0', width=1)
    # Flag mini
    draw.line([(sx + 10, sy + 7), (sx + 10, sy + 21)], fill=p_color, width=2)
    draw.polygon([(sx + 10, sy + 8), (sx + 22, sy + 12), (sx + 10, sy + 16)], fill=p_color)
    draw.text((sx + 30, sy + 5), p_label, fill='#1E293B', font=f_sb_value)
    sy += 26 + SECTION_GAP

    # PARTICIPANTES
    parts = list(tarea.participantes.all()[:5]) if hasattr(tarea, 'participantes') else []
    parts_total = tarea.participantes.count() if hasattr(tarea, 'participantes') else 0
    sy = _section_label('PARTICIPANTES', sy)
    if parts:
        # Avatars en fila + "+N"
        av_size = 24
        ax = sx
        for p in parts[:4]:
            pn = p.get_full_name() or p.username
            _draw_avatar(ax, sy, av_size, pn)
            ax += av_size + 6
        if parts_total > 4:
            # +N badge
            draw.ellipse([ax, sy, ax + av_size, sy + av_size], outline='#CBD5E1', width=1, fill='#F8FAFC')
            extra = f'+{parts_total - 4}'
            bb = draw.textbbox((0, 0), extra, font=f_avatar)
            ew, eh = bb[2] - bb[0], bb[3] - bb[1]
            draw.text((ax + av_size / 2 - ew / 2, sy + av_size / 2 - eh / 2 - 1), extra, fill='#64748B', font=f_avatar)
        sy += 28
    else:
        draw.text((sx, sy + 2), 'Ninguno', fill='#94A3B8', font=f_sb_sub)
        sy += 22
    sy += SECTION_GAP - 4

    # OBSERVADORES
    obs = list(tarea.observadores.all()[:5]) if hasattr(tarea, 'observadores') else []
    obs_total = tarea.observadores.count() if hasattr(tarea, 'observadores') else 0
    sy = _section_label('OBSERVADORES', sy)
    if obs:
        av_size = 24
        ax = sx
        for o in obs[:4]:
            on = o.get_full_name() or o.username
            _draw_avatar(ax, sy, av_size, on)
            ax += av_size + 6
        if obs_total > 4:
            draw.ellipse([ax, sy, ax + av_size, sy + av_size], outline='#CBD5E1', width=1, fill='#F8FAFC')
            extra = f'+{obs_total - 4}'
            bb = draw.textbbox((0, 0), extra, font=f_avatar)
            ew, eh = bb[2] - bb[0], bb[3] - bb[1]
            draw.text((ax + av_size / 2 - ew / 2, sy + av_size / 2 - eh / 2 - 1), extra, fill='#64748B', font=f_avatar)
    else:
        draw.text((sx, sy + 2), 'Ninguno', fill='#94A3B8', font=f_sb_sub)

    # Serialize PNG
    buf = BytesIO()
    img.save(buf, format='PNG', optimize=True)
    response = HttpResponse(buf.getvalue(), content_type='image/png')
    response['Cache-Control'] = 'public, max-age=3600'
    return response


@login_required
def api_eliminar_tarea(request, tarea_id):
    """Elimina una tarea. Solo el creador o un superuser pueden hacerlo."""
    if request.method != 'POST':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)
    tarea = get_object_or_404(Tarea, id=tarea_id)
    es_creador = (tarea.creado_por_id == request.user.id)
    if not (es_creador or request.user.is_superuser):
        return JsonResponse({'error': 'Solo el creador puede eliminar esta tarea'}, status=403)
    # Si es subtarea, loguear el remove en la padre ANTES del delete (después
    # del delete la tarea_padre sigue válida porque es FK CASCADE inversa).
    if tarea.tarea_padre_id:
        _log_tarea_historial(
            tarea.tarea_padre, request.user, 'subtarea_remove',
            anterior=tarea.titulo,
            extra={'subtarea_id': tarea.id},
        )
    tarea.delete()
    return JsonResponse({'success': True})


# ── Programa de Obra — Gantt API ─────────────────────────────────────────

def _serializar_actividad(act):
    """Serializa una GanttActividad a diccionario."""
    return {
        'id': act.id,
        'fase_id': act.fase_id,
        'fase_nombre': act.fase.nombre if act.fase_id else '',
        'nombre': act.nombre,
        'descripcion': act.descripcion or '',
        'fecha_inicio': act.fecha_inicio.isoformat(),
        'fecha_fin': act.fecha_fin.isoformat(),
        'duracion_dias': act.duracion_dias,
        'progreso': act.progreso,
        'costo_estimado': str(act.costo_estimado),
        'ingreso_estimado': str(act.ingreso_estimado),
        'dependencias': list(act.dependencias.values_list('id', flat=True)),
        'recursos': [
            {
                'id': u.id,
                'nombre': u.get_full_name() or u.username,
                'username': u.username,
            }
            for u in act.recursos.all()
        ],
        'recursos_materiales': [
            {
                'id': r.id,
                'nombre': r.nombre,
                'tipo': r.tipo,
                'tipo_label': r.get_tipo_display(),
            }
            for r in act.recursos_materiales.all()
        ],
        'actividad_calendario_id': act.actividad_calendario_id,
        'orden': act.orden,
        'created_at': act.created_at.isoformat() if act.created_at else None,
        'updated_at': act.updated_at.isoformat() if act.updated_at else None,
    }


def _sync_actividad_calendario(act, creado_por):
    """Sincroniza (crea o actualiza) el evento del calendario global vinculado
    a una GanttActividad. Idempotente: si ya hay un Actividad ligado, lo
    actualiza; si no, lo crea y deja el FK seteado.

    Reglas:
      titulo            <- act.nombre
      descripcion       <- act.descripcion or ''
      tipo_actividad    <- 'tarea'
      fecha_inicio      <- act.fecha_inicio @ 09:00 (zona del proyecto)
      fecha_fin         <- act.fecha_fin @ 17:00
      participantes     <- act.recursos (mismos users)
      creado_por        <- creado_por (user de la request) cuando se crea
    """
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo('America/Tijuana')
    except Exception:
        tz = None

    fi = datetime.combine(act.fecha_inicio, time(9, 0), tzinfo=tz) if tz else datetime.combine(act.fecha_inicio, time(9, 0))
    ff = datetime.combine(act.fecha_fin, time(17, 0), tzinfo=tz) if tz else datetime.combine(act.fecha_fin, time(17, 0))

    cal = act.actividad_calendario
    if cal:
        cal.titulo = act.nombre
        cal.descripcion = act.descripcion or ''
        cal.fecha_inicio = fi
        cal.fecha_fin = ff
        cal.tipo_actividad = 'tarea'
        cal.save()
    else:
        cal = Actividad.objects.create(
            titulo=act.nombre,
            descripcion=act.descripcion or '',
            tipo_actividad='tarea',
            fecha_inicio=fi,
            fecha_fin=ff,
            creado_por=creado_por,
            color='#3B82F6',
        )
        act.actividad_calendario = cal
        act.save(update_fields=['actividad_calendario'])

    # Sincronizar participantes con los recursos (users) de la actividad Gantt.
    try:
        cal.participantes.set(list(act.recursos.all()))
    except Exception:
        pass

    return cal


def _serializar_fase(fase):
    """Serializa una GanttFase a diccionario."""
    return {
        'id': fase.id,
        'nombre': fase.nombre,
        'orden': fase.orden,
        'collapsed': fase.collapsed,
    }


@login_required
def api_gantt_proyecto(request, proyecto_id):
    """
    GET  — Lista fases y actividades del Gantt de un proyecto.
    POST — Crea una nueva actividad Gantt.
    """
    proyecto = get_object_or_404(ProyectoIAMET, id=proyecto_id)

    # ── GET: listar todo ────────────────────────────────────────────────
    if request.method == 'GET':
        fases = [_serializar_fase(f) for f in proyecto.gantt_fases.all()]
        actividades = [
            _serializar_actividad(a)
            for a in proyecto.gantt_actividades.select_related('fase')
                                               .prefetch_related('dependencias', 'recursos')
        ]
        return JsonResponse({
            'fases': fases,
            'actividades': actividades,
            'proyecto_inicio': proyecto.fecha_inicio.isoformat() if proyecto.fecha_inicio else None,
        })

    # ── POST: crear actividad ───────────────────────────────────────────
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'error': 'JSON invalido'}, status=400)

        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            return JsonResponse({'error': 'El nombre es obligatorio'}, status=400)

        fecha_inicio_str = data.get('fecha_inicio')
        if not fecha_inicio_str:
            return JsonResponse({'error': 'fecha_inicio es obligatorio'}, status=400)
        try:
            fecha_inicio = date.fromisoformat(fecha_inicio_str)
        except (ValueError, TypeError):
            return JsonResponse({'error': 'fecha_inicio invalida (YYYY-MM-DD)'}, status=400)

        duracion_dias = data.get('duracion_dias', 1)
        try:
            duracion_dias = int(duracion_dias)
            if duracion_dias < 1:
                raise ValueError
        except (ValueError, TypeError):
            return JsonResponse({'error': 'duracion_dias debe ser >= 1'}, status=400)

        costo_estimado = data.get('costo_estimado', 0)
        ingreso_estimado = data.get('ingreso_estimado', 0)
        try:
            from decimal import Decimal as D, InvalidOperation
            costo_estimado = D(str(costo_estimado))
            ingreso_estimado = D(str(ingreso_estimado))
            if costo_estimado < 0 or ingreso_estimado < 0:
                raise ValueError
        except (ValueError, TypeError, InvalidOperation):
            return JsonResponse({'error': 'costo/ingreso deben ser numeros >= 0'}, status=400)

        fase_id = data.get('fase_id')
        fase = None
        if fase_id:
            fase = GanttFase.objects.filter(id=fase_id, proyecto=proyecto).first()
            if not fase:
                return JsonResponse({'error': 'Fase no encontrada en este proyecto'}, status=404)

        # Progreso (opcional al crear)
        progreso = data.get('progreso', 0)
        try:
            progreso = int(progreso)
            if progreso < 0 or progreso > 100:
                raise ValueError
        except (ValueError, TypeError):
            return JsonResponse({'error': 'progreso debe ser 0-100'}, status=400)

        act = GanttActividad.objects.create(
            proyecto=proyecto,
            fase=fase,
            nombre=nombre,
            descripcion=(data.get('descripcion') or '').strip(),
            fecha_inicio=fecha_inicio,
            duracion_dias=duracion_dias,
            progreso=progreso,
            costo_estimado=costo_estimado,
            ingreso_estimado=ingreso_estimado,
            orden=data.get('orden', 0),
        )

        # ── Recursos (users) inline al crear (opcional) ─────────────────
        rec_ids = data.get('recursos')
        if isinstance(rec_ids, list):
            try:
                act.recursos.set(User.objects.filter(id__in=[int(x) for x in rec_ids]))
            except (ValueError, TypeError):
                pass

        # ── Recursos materiales inline al crear (opcional) ──────────────
        rec_mat_ids = data.get('recursos_materiales')
        if isinstance(rec_mat_ids, list):
            try:
                act.recursos_materiales.set(
                    RecursoMaterial.objects.filter(id__in=[int(x) for x in rec_mat_ids])
                )
            except (ValueError, TypeError):
                pass

        # ── Dependencias inline al crear (opcional) ─────────────────────
        dep_ids = data.get('dependencias')
        if isinstance(dep_ids, list):
            try:
                deps = GanttActividad.objects.filter(
                    id__in=[int(x) for x in dep_ids], proyecto=proyecto,
                )
                act.dependencias.set(deps)
            except (ValueError, TypeError):
                pass

        # ── Crear / sincronizar actividad de calendario ─────────────────
        try:
            _sync_actividad_calendario(act, request.user)
        except Exception as e:
            logging.getLogger(__name__).warning('Gantt: error creando actividad calendario: %s', e)

        return JsonResponse({'success': True, 'actividad': _serializar_actividad(act)}, status=201)

    return JsonResponse({'error': 'Metodo no permitido'}, status=405)


@login_required
def api_gantt_actividad(request, actividad_id):
    """
    PUT    — Actualiza una actividad Gantt.
    DELETE — Elimina una actividad Gantt.
    """
    act = get_object_or_404(GanttActividad, id=actividad_id)

    # ── PUT ─────────────────────────────────────────────────────────────
    if request.method == 'PUT':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'error': 'JSON invalido'}, status=400)

        # Nombre
        if 'nombre' in data:
            nombre = (data['nombre'] or '').strip()
            if not nombre:
                return JsonResponse({'error': 'El nombre no puede estar vacio'}, status=400)
            act.nombre = nombre

        # Descripcion
        if 'descripcion' in data:
            act.descripcion = (data['descripcion'] or '').strip()

        # Fecha inicio
        if 'fecha_inicio' in data:
            try:
                act.fecha_inicio = date.fromisoformat(data['fecha_inicio'])
            except (ValueError, TypeError):
                return JsonResponse({'error': 'fecha_inicio invalida'}, status=400)

        # Duracion
        if 'duracion_dias' in data:
            try:
                d = int(data['duracion_dias'])
                if d < 1:
                    raise ValueError
                act.duracion_dias = d
            except (ValueError, TypeError):
                return JsonResponse({'error': 'duracion_dias debe ser >= 1'}, status=400)

        # Progreso
        if 'progreso' in data:
            try:
                p = int(data['progreso'])
                if p < 0 or p > 100:
                    raise ValueError
                act.progreso = p
            except (ValueError, TypeError):
                return JsonResponse({'error': 'progreso debe ser 0-100'}, status=400)

        # Fase
        if 'fase_id' in data:
            fid = data['fase_id']
            if fid is None:
                act.fase = None
            else:
                fase = GanttFase.objects.filter(id=fid, proyecto=act.proyecto).first()
                if not fase:
                    return JsonResponse({'error': 'Fase no encontrada'}, status=404)
                act.fase = fase

        # Costo / Ingreso
        from decimal import Decimal as D, InvalidOperation
        if 'costo_estimado' in data:
            try:
                val = D(str(data['costo_estimado']))
                if val < 0:
                    raise ValueError
                act.costo_estimado = val
            except (ValueError, TypeError, InvalidOperation):
                return JsonResponse({'error': 'costo_estimado invalido'}, status=400)

        if 'ingreso_estimado' in data:
            try:
                val = D(str(data['ingreso_estimado']))
                if val < 0:
                    raise ValueError
                act.ingreso_estimado = val
            except (ValueError, TypeError, InvalidOperation):
                return JsonResponse({'error': 'ingreso_estimado invalido'}, status=400)

        # Orden
        if 'orden' in data:
            try:
                act.orden = int(data['orden'])
            except (ValueError, TypeError):
                return JsonResponse({'error': 'orden invalido'}, status=400)

        # Actividad calendario
        if 'actividad_calendario_id' in data:
            ac_id = data['actividad_calendario_id']
            if ac_id is None:
                act.actividad_calendario = None
            else:
                act.actividad_calendario = get_object_or_404(Actividad, id=ac_id)

        act.save()

        # M2M: dependencias
        if 'dependencias' in data:
            dep_ids = data['dependencias']
            if not isinstance(dep_ids, list):
                return JsonResponse({'error': 'dependencias debe ser una lista de ids'}, status=400)
            deps = GanttActividad.objects.filter(id__in=dep_ids, proyecto=act.proyecto)
            act.dependencias.set(deps)

        # M2M: recursos (users)
        if 'recursos' in data:
            rec_ids = data['recursos']
            if not isinstance(rec_ids, list):
                return JsonResponse({'error': 'recursos debe ser una lista de ids'}, status=400)
            act.recursos.set(User.objects.filter(id__in=rec_ids))

        # M2M: recursos_materiales (RecursoMaterial)
        if 'recursos_materiales' in data:
            rec_mat_ids = data['recursos_materiales']
            if not isinstance(rec_mat_ids, list):
                return JsonResponse({'error': 'recursos_materiales debe ser una lista de ids'}, status=400)
            act.recursos_materiales.set(
                RecursoMaterial.objects.filter(id__in=rec_mat_ids)
            )

        # ── Sincronizar con calendario ──────────────────────────────────
        # Idempotente: actualiza si ya existe el ligado, o crea uno nuevo.
        try:
            _sync_actividad_calendario(act, request.user)
        except Exception as e:
            logging.getLogger(__name__).warning('Gantt: error sincronizando calendario: %s', e)

        return JsonResponse({'success': True, 'actividad': _serializar_actividad(act)})

    # ── DELETE ──────────────────────────────────────────────────────────
    if request.method == 'DELETE':
        # Eliminar tambien el evento de calendario ligado (si existe).
        cal = act.actividad_calendario
        act.delete()
        if cal:
            try:
                cal.delete()
            except Exception as e:
                logging.getLogger(__name__).warning(
                    'Gantt: error eliminando actividad calendario ligada: %s', e
                )
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Metodo no permitido'}, status=405)


@login_required
def api_gantt_fase_crear(request, proyecto_id):
    """POST — Crea una nueva fase Gantt."""
    if request.method != 'POST':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)

    proyecto = get_object_or_404(ProyectoIAMET, id=proyecto_id)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'JSON invalido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return JsonResponse({'error': 'El nombre es obligatorio'}, status=400)

    # Orden automatico: poner al final
    max_orden = proyecto.gantt_fases.aggregate(m=models.Max('orden'))['m'] or 0
    fase = GanttFase.objects.create(
        proyecto=proyecto,
        nombre=nombre,
        orden=max_orden + 1,
    )
    return JsonResponse({'success': True, 'fase': _serializar_fase(fase)}, status=201)


@login_required
def api_gantt_fase(request, fase_id):
    """
    PUT    — Actualiza una fase Gantt (nombre, orden, collapsed).
    DELETE — Elimina una fase Y todas sus actividades.
    """
    fase = get_object_or_404(GanttFase, id=fase_id)

    # ── PUT ─────────────────────────────────────────────────────────────
    if request.method == 'PUT':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'error': 'JSON invalido'}, status=400)

        if 'nombre' in data:
            nombre = (data['nombre'] or '').strip()
            if not nombre:
                return JsonResponse({'error': 'El nombre no puede estar vacio'}, status=400)
            fase.nombre = nombre

        if 'orden' in data:
            try:
                fase.orden = int(data['orden'])
            except (ValueError, TypeError):
                return JsonResponse({'error': 'orden invalido'}, status=400)

        if 'collapsed' in data:
            fase.collapsed = bool(data['collapsed'])

        fase.save()
        return JsonResponse({'success': True, 'fase': _serializar_fase(fase)})

    # ── DELETE ──────────────────────────────────────────────────────────
    if request.method == 'DELETE':
        # Cascade eliminara las actividades vinculadas a esta fase
        fase.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Metodo no permitido'}, status=405)


@login_required
def api_gantt_cascada(request, actividad_id):
    """
    POST — Ejecuta cascada Finish-to-Start desde una actividad.
    Empuja dependientes cuya fecha_inicio < fecha_fin de esta actividad.
    Recursivo con proteccion contra ciclos (max 100 iteraciones).
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)

    act = get_object_or_404(GanttActividad, id=actividad_id)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'JSON invalido'}, status=400)

    # Actualizar la actividad origen si se proporcionan nuevos valores
    if 'nueva_fecha_inicio' in data:
        try:
            act.fecha_inicio = date.fromisoformat(data['nueva_fecha_inicio'])
        except (ValueError, TypeError):
            return JsonResponse({'error': 'nueva_fecha_inicio invalida'}, status=400)

    if 'nueva_duracion' in data:
        try:
            d = int(data['nueva_duracion'])
            if d < 1:
                raise ValueError
            act.duracion_dias = d
        except (ValueError, TypeError):
            return JsonResponse({'error': 'nueva_duracion debe ser >= 1'}, status=400)

    act.save()

    # ── Cascada Finish-to-Start ─────────────────────────────────────────
    actualizadas = []
    cola = [act]
    visitados = set()
    iteraciones = 0

    while cola and iteraciones < 100:
        iteraciones += 1
        actual = cola.pop(0)

        if actual.id in visitados:
            continue
        visitados.add(actual.id)

        fecha_fin_actual = actual.fecha_fin  # fecha_inicio + duracion_dias

        # Buscar dependientes (actividades que dependen de 'actual')
        dependientes = actual.dependientes.filter(
            proyecto=act.proyecto
        ).select_related('fase')

        for dep in dependientes:
            if dep.id in visitados:
                continue
            if dep.fecha_inicio < fecha_fin_actual:
                dep.fecha_inicio = fecha_fin_actual
                dep.save(update_fields=['fecha_inicio', 'updated_at'])
                actualizadas.append({
                    'id': dep.id,
                    'fecha_inicio': dep.fecha_inicio.isoformat(),
                    'duracion_dias': dep.duracion_dias,
                })
                cola.append(dep)

    return JsonResponse({
        'success': True,
        'actualizadas': actualizadas,
    })


# ── Comentarios y archivos de actividad Gantt (drawer + fullscreen) ─────

def _serializar_comentario_gantt(c):
    autor = c.autor
    if autor:
        nombre = autor.get_full_name() or autor.username
        username = autor.username
        autor_id = autor.id
    else:
        nombre = '—'
        username = ''
        autor_id = None
    return {
        'id': c.id,
        'texto': c.texto,
        'autor_id': autor_id,
        'autor_nombre': nombre,
        'autor_username': username,
        'created_at': c.created_at.isoformat() if c.created_at else None,
    }


def _serializar_archivo_gantt(f):
    autor = f.autor
    nombre_autor = (autor.get_full_name() or autor.username) if autor else '—'
    return {
        'id': f.id,
        'nombre': f.nombre or (f.archivo.name.rsplit('/', 1)[-1] if f.archivo else ''),
        'url': f.archivo.url if f.archivo else '',
        'autor_id': autor.id if autor else None,
        'autor_nombre': nombre_autor,
        'created_at': f.created_at.isoformat() if f.created_at else None,
    }


@login_required
def api_gantt_actividad_comentarios(request, actividad_id):
    """GET — lista comentarios de una actividad. POST — crea uno nuevo."""
    act = get_object_or_404(GanttActividad, id=actividad_id)

    if request.method == 'GET':
        items = [
            _serializar_comentario_gantt(c)
            for c in act.comentarios.select_related('autor').all()
        ]
        return JsonResponse({'success': True, 'items': items})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'error': 'JSON invalido'}, status=400)

        texto = (data.get('texto') or '').strip()
        if not texto:
            return JsonResponse({'error': 'El texto es obligatorio'}, status=400)

        c = GanttActividadComentario.objects.create(
            actividad=act,
            autor=request.user,
            texto=texto,
        )
        return JsonResponse(
            {'success': True, 'comentario': _serializar_comentario_gantt(c)},
            status=201,
        )

    return JsonResponse({'error': 'Metodo no permitido'}, status=405)


@login_required
def api_gantt_actividad_comentario_detalle(request, comentario_id):
    """DELETE — elimina un comentario (solo el autor o staff)."""
    c = get_object_or_404(GanttActividadComentario, id=comentario_id)
    if request.method != 'DELETE':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)

    if not (request.user.is_staff or (c.autor_id == request.user.id)):
        return JsonResponse({'error': 'No autorizado'}, status=403)

    c.delete()
    return JsonResponse({'success': True})


@login_required
def api_gantt_actividad_archivos(request, actividad_id):
    """GET — lista archivos. POST (multipart) — sube uno nuevo."""
    act = get_object_or_404(GanttActividad, id=actividad_id)

    if request.method == 'GET':
        items = [
            _serializar_archivo_gantt(f)
            for f in act.archivos.select_related('autor').all()
        ]
        return JsonResponse({'success': True, 'items': items})

    if request.method == 'POST':
        upload = request.FILES.get('archivo')
        if not upload:
            return JsonResponse({'error': 'archivo es obligatorio'}, status=400)

        nombre = (request.POST.get('nombre') or upload.name).strip()
        f = GanttActividadArchivo.objects.create(
            actividad=act,
            autor=request.user,
            archivo=upload,
            nombre=nombre,
        )
        return JsonResponse(
            {'success': True, 'archivo': _serializar_archivo_gantt(f)},
            status=201,
        )

    return JsonResponse({'error': 'Metodo no permitido'}, status=405)


@login_required
def api_gantt_actividad_archivo_detalle(request, archivo_id):
    """DELETE — elimina un archivo (solo el autor o staff)."""
    f = get_object_or_404(GanttActividadArchivo, id=archivo_id)
    if request.method != 'DELETE':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)

    if not (request.user.is_staff or (f.autor_id == request.user.id)):
        return JsonResponse({'error': 'No autorizado'}, status=403)

    try:
        if f.archivo:
            f.archivo.delete(save=False)
    except Exception:
        pass
    f.delete()
    return JsonResponse({'success': True})



# ═══════════════════════════════════════════════════════════════════════════
# INSTALACIONES (Plan de Trabajo Bajanet) — calendario alternativo
# ═══════════════════════════════════════════════════════════════════════════

from .models import Instalacion, Tecnico, InstalacionAsignacion


def _instalacion_dias_asignados(inst):
    """Lista de fechas (date) que ocupa una instalación en el calendario,
    según su duración (jornadas_count) y tipo de jornada:
      - tipo 'sabado'/'domingo'  → días corridos (incluye fin de semana).
      - 'normal'/'noche'/'extraordinaria' → solo días hábiles (lun–vie).
    Devuelve [] si no tiene fecha programada.

    Si la instalación tiene `dias_personalizados` (modo "Elegir días"), esa
    lista manda: se parsea, se ordena y se devuelve tal cual, ignorando la
    lógica de días consecutivos."""
    from datetime import timedelta, date as _date
    personalizados = getattr(inst, 'dias_personalizados', None)
    if personalizados and isinstance(personalizados, (list, tuple)):
        parsed = []
        for d in personalizados:
            try:
                parsed.append(_date.fromisoformat(str(d)[:10]))
            except (ValueError, TypeError):
                continue
        if parsed:
            return sorted(parsed)
    if not inst.fecha_programada:
        return []
    total = max(1, inst.jornadas_count or 1)
    incluir_finde = inst.jornadas_tipo in ('sabado', 'domingo')
    dias = []
    cursor = inst.fecha_programada
    guard = 0  # tope de seguridad por si jornadas_count es absurdo
    while len(dias) < total and guard < 400:
        guard += 1
        es_finde = cursor.weekday() >= 5  # 5=sáb, 6=dom
        if (not incluir_finde) and es_finde:
            cursor += timedelta(days=1)
            continue
        dias.append(cursor)
        cursor += timedelta(days=1)
    return dias


def _instalacion_to_dict(inst):
    """Serializa una Instalacion al formato que entiende el calendario.
    Casi idéntico al shape de Actividad — el JS lo renderiza con
    `data-source="instalacion"` para pintarla con color distinto."""
    fecha = inst.fecha_programada.isoformat() if inst.fecha_programada else None
    _dias = _instalacion_dias_asignados(inst)
    dias_iso = [d.isoformat() for d in _dias]
    return {
        'id': inst.id,
        'source': 'instalacion',
        'titulo': f'{inst.cliente_nombre} — {(inst.proyecto or "")[:80]}',
        'cliente': inst.cliente_nombre,
        'po': inst.po,
        'proyecto': inst.proyecto,
        'fecha': fecha,
        'hora_inicio': inst.hora_inicio.strftime('%H:%M') if inst.hora_inicio else None,
        'hora_fin': inst.hora_fin.strftime('%H:%M') if inst.hora_fin else None,
        'dias_personalizados': inst.dias_personalizados or None,
        # Todos los días que ocupa la instalación (duración completa).
        'dias': dias_iso,
        'fecha_inicio': fecha,
        'fecha_fin': dias_iso[-1] if dias_iso else fecha,
        'all_day': True,
        'jornadas_count': inst.jornadas_count,
        'jornadas_tipo': inst.jornadas_tipo,
        'jornadas_tipo_label': inst.get_jornadas_tipo_display(),
        'personal': inst.personal_descripcion,
        'fecha_tentativa_texto': inst.fecha_tentativa_texto,
        'monto_po': float(inst.monto_po or 0),
        'utilidad': float(inst.utilidad or 0),
        'observaciones': inst.observaciones,
        'notas': inst.notas,
        'estado': inst.estado,
        'estado_label': inst.get_estado_display(),
        'oportunidad_id': inst.oportunidad_id,
        'cliente_id': inst.cliente_id,
        'color': '#FF9500',  # naranja Apple (diferenciar de actividades azules)
    }


@login_required
def api_instalaciones_calendario(request):
    """GET /app/api/calendario/instalaciones/

    Lista las instalaciones del calendario en un rango. Params:
        ?start=YYYY-MM-DD&end=YYYY-MM-DD  (rango exacto)
        ?mes=05&anio=2026                  (alternativa: un mes completo)

    Sin parámetros → instalaciones del mes en curso.
    """
    if request.method != 'GET':
        return JsonResponse({'success': False, 'error': 'Solo GET'}, status=405)

    qs = Instalacion.objects.all()

    # Visibilidad base: la instalación se le muestra al CREADOR del programa de
    # obra y a los TÉCNICOS ASIGNADOS. Supervisores/superuser ven todas (para
    # coordinar). Esto evita que le salga a gente no involucrada.
    if not (request.user.is_superuser or is_supervisor(request.user)):
        qs = qs.filter(
            Q(creado_por=request.user) | Q(asignaciones__tecnico__usuario=request.user)
        ).distinct()

    # Filtro por usuario(s) seleccionado(s) en el picker del calendario: al
    # elegir a una persona, solo se muestran SUS instalaciones (donde es
    # creador O técnico asignado). Necesario porque en el cliente las
    # instalaciones no se filtran por el selector de usuario (son org-wide),
    # así que sin esto un supervisor que elige a alguien veía TODAS.
    user_ids_raw = (request.GET.get('user_ids') or request.GET.get('user_id') or '').strip()
    sel_ids = [int(x) for x in user_ids_raw.split(',') if x.strip().isdigit()]
    if sel_ids:
        qs = qs.filter(
            Q(creado_por_id__in=sel_ids) | Q(asignaciones__tecnico__usuario_id__in=sel_ids)
        ).distinct()

    start_raw = (request.GET.get('start') or '').strip()
    end_raw = (request.GET.get('end') or '').strip()
    mes_raw = (request.GET.get('mes') or '').strip()
    anio_raw = (request.GET.get('anio') or '').strip()

    from datetime import date, timedelta
    rango_start = None
    rango_end = None
    if start_raw and end_raw:
        try:
            rango_start = date.fromisoformat(start_raw)
            rango_end = date.fromisoformat(end_raw)
        except ValueError:
            pass
    elif mes_raw and anio_raw:
        try:
            mes = int(mes_raw)
            anio = int(anio_raw)
            rango_start = date(anio, mes, 1)
            if mes == 12:
                rango_end = date(anio + 1, 1, 1) - timedelta(days=1)
            else:
                rango_end = date(anio, mes + 1, 1) - timedelta(days=1)
        except (ValueError, TypeError):
            pass

    if rango_start and rango_end:
        # Ampliamos el límite inferior: una instalación que inició antes del
        # rango puede extenderse hasta dentro de él por su duración. 400 días
        # cubre la duración máxima de un programa (antes 45, que dejaban fuera
        # programas largos). El post-filtro de abajo descarta las que no tocan
        # el rango.
        qs = qs.filter(fecha_programada__range=(rango_start - timedelta(days=400), rango_end))

    # Filtros opcionales adicionales.
    estado = (request.GET.get('estado') or '').strip()
    if estado:
        qs = qs.filter(estado=estado)
    cliente_q = (request.GET.get('q') or '').strip()
    if cliente_q:
        qs = qs.filter(
            Q(cliente_nombre__icontains=cliente_q)
            | Q(proyecto__icontains=cliente_q)
            | Q(po__icontains=cliente_q)
        )

    qs = qs.select_related('cliente', 'oportunidad', 'creado_por').order_by('fecha_programada', 'cliente_nombre')

    items = [_instalacion_to_dict(i) for i in qs]
    # Si hay rango, conservar solo las instalaciones cuya duración toca el
    # rango visible (alguno de sus días cae dentro de [start, end]).
    if rango_start and rango_end:
        s_iso = rango_start.isoformat()
        e_iso = rango_end.isoformat()
        items = [it for it in items
                 if any(s_iso <= d <= e_iso for d in (it.get('dias') or []))]

    return JsonResponse({
        'success': True,
        'instalaciones': items,
    })


@login_required
def api_grid_tecnicos(request):
    """GET /app/api/calendario/instalaciones/grid/

    Devuelve la matriz Técnico × Día para el rango pedido. Params:
        ?start=YYYY-MM-DD&end=YYYY-MM-DD  (rango inclusivo)
        ?solo_activos=1                    (default: 1, incluye solo
                                            técnicos con activo=True)

    Sin start/end → semana en curso (lunes a domingo).

    Respuesta:
      {
        "success": true,
        "rango": {"start": "...", "end": "..."},
        "dias": ["2026-05-25", "2026-05-26", ...],
        "tecnicos": [
          {"id": 1, "nombre": "URIEL", "rol": "tecnico", "color": ""}
        ],
        "celdas": [
          {
            "tecnico_id": 1, "fecha": "2026-05-25",
            "instalacion_id": 12, "cliente_nombre": "VOLVO",
            "proyecto": "60 NODOS EN VOLVO", "po": "4517218663",
            "estado": "programada", "estado_label": "Programada",
            "hora_inicio": "08:00", "hora_fin": "17:00",
            "notas": ""
          }
        ]
      }

    Una celda (tecnico_id, fecha) puede aparecer múltiples veces si el
    técnico está asignado a más de una instalación ese día — el frontend
    decide cómo mostrarlas (stack vertical, abreviar, etc.).
    """
    from datetime import date, timedelta

    if request.method != 'GET':
        return JsonResponse({'success': False, 'error': 'Solo GET'}, status=405)

    start_raw = (request.GET.get('start') or '').strip()
    end_raw = (request.GET.get('end') or '').strip()

    if start_raw and end_raw:
        try:
            start = date.fromisoformat(start_raw)
            end = date.fromisoformat(end_raw)
        except ValueError:
            return JsonResponse({'success': False, 'error': 'Fechas inválidas'}, status=400)
    else:
        hoy = date.today()
        start = hoy - timedelta(days=hoy.weekday())  # lunes de esta semana
        end = start + timedelta(days=6)              # domingo

    if end < start:
        return JsonResponse({'success': False, 'error': 'end < start'}, status=400)

    dias = []
    cursor = start
    while cursor <= end:
        dias.append(cursor.isoformat())
        cursor += timedelta(days=1)

    solo_activos = request.GET.get('solo_activos', '1') != '0'
    tecnicos_qs = Tecnico.objects.all()
    if solo_activos:
        tecnicos_qs = tecnicos_qs.filter(activo=True)
    tecnicos_qs = tecnicos_qs.order_by('nombre')

    tecnicos_data = [{
        'id': t.id,
        'nombre': t.nombre,
        'rol': t.rol,
        'rol_label': t.get_rol_display(),
        'color': t.color or '',
    } for t in tecnicos_qs]

    tecnico_ids_visibles = set(t['id'] for t in tecnicos_data)

    # Derivamos las celdas de las INSTALACIONES (no de asignaciones sueltas):
    # cada instalación ocupa TODOS sus días (duración completa) con SUS horas,
    # para que el técnico aparezca en todas las jornadas del programa.
    # Buffer en el límite inferior por instalaciones que iniciaron antes pero
    # se extienden al rango visible. 400 días cubre la duración máxima de un
    # programa (el guard de _instalacion_dias_asignados corta en 400). Antes
    # eran 45 días, que dejaban fuera programas largos cuyo inicio quedaba
    # más atrás aunque sus jornadas cayeran en la semana visible.
    inst_qs = (
        Instalacion.objects
        .filter(fecha_programada__range=(start - timedelta(days=400), end))
        .prefetch_related('asignaciones')
    )

    celdas = []
    for inst in inst_qs:
        dias_inst = [d for d in _instalacion_dias_asignados(inst) if start <= d <= end]
        if not dias_inst:
            continue
        # Técnicos asignados a esta instalación (visibles en el grid).
        tec_ids = set(a.tecnico_id for a in inst.asignaciones.all()) & tecnico_ids_visibles
        if not tec_ids:
            continue
        hi = inst.hora_inicio.strftime('%H:%M') if inst.hora_inicio else '08:00'
        hf = inst.hora_fin.strftime('%H:%M') if inst.hora_fin else '17:00'
        estado_label = inst.get_estado_display()
        for d in dias_inst:
            d_iso = d.isoformat()
            for tid in tec_ids:
                celdas.append({
                    'tecnico_id': tid,
                    'fecha': d_iso,
                    'instalacion_id': inst.id,
                    'cliente_nombre': inst.cliente_nombre,
                    'proyecto': inst.proyecto,
                    'po': inst.po,
                    'estado': inst.estado,
                    'estado_label': estado_label,
                    'hora_inicio': hi,
                    'hora_fin': hf,
                    'notas': '',
                })

    return JsonResponse({
        'success': True,
        'rango': {'start': start.isoformat(), 'end': end.isoformat()},
        'dias': dias,
        'tecnicos': tecnicos_data,
        'celdas': celdas,
    })


def _equipo_estado_color(estado):
    """Color por ESTADO de instalación — mismo mapa que el frontend
    `_calEstadoColor` (mantener sincronizado)."""
    return {
        'completada': '#16A34A',
        'cancelada': '#EF4444',
        'en_curso': '#1D1D1F',
        'tentativa': '#EC4899',
    }.get(estado, '#7C3AED')  # programada / else → morado


@login_required
def api_grid_equipo(request):
    """GET /app/api/calendario/equipo/grid/

    Matriz Persona (User) × Día. A diferencia del grid de Técnicos (solo
    instalaciones), cada celda agrega TODO lo que esa persona tiene ese día
    en su calendario: Actividades + Tareas + Instalaciones del Programa de
    Obra. Pensado para ver de un vistazo la semana de 5–8 empleados.

    Params:
        ?start=YYYY-MM-DD&end=YYYY-MM-DD  (rango inclusivo; default: semana
                                           en curso lunes–domingo)
        ?user_ids=1,2,3                   (opcional; si viene, esas son las
                                           filas. Si no, se derivan los Users
                                           con alguna actividad/tarea/
                                           instalación en el rango).

    Respuesta:
      {
        "success": true,
        "rango": {"start": "...", "end": "..."},
        "dias": ["2026-06-15", ...],
        "usuarios": [{"id", "nombre", "avatar_url"|null, "rol_label"}],
        "celdas": [{
          "user_id", "fecha", "tipo": "actividad"|"tarea"|"instalacion",
          "titulo", "hora_inicio", "hora_fin", "color",
          "actividad_id"?, "tarea_id"?, "instalacion_id"?,
          "cliente_nombre"?, "po"?, "proyecto"?, "estado"?, "completada"?
        }]
      }
    """
    from datetime import date, timedelta

    if request.method != 'GET':
        return JsonResponse({'success': False, 'error': 'Solo GET'}, status=405)

    start_raw = (request.GET.get('start') or '').strip()
    end_raw = (request.GET.get('end') or '').strip()

    if start_raw and end_raw:
        try:
            start = date.fromisoformat(start_raw)
            end = date.fromisoformat(end_raw)
        except ValueError:
            return JsonResponse({'success': False, 'error': 'Fechas inválidas'}, status=400)
    else:
        hoy = date.today()
        start = hoy - timedelta(days=hoy.weekday())  # lunes
        end = start + timedelta(days=6)              # domingo

    if end < start:
        return JsonResponse({'success': False, 'error': 'end < start'}, status=400)

    dias = []
    cursor = start
    while cursor <= end:
        dias.append(cursor.isoformat())
        cursor += timedelta(days=1)
    dias_set = set(dias)

    # ── Filas pedidas explícitamente (user_ids) ──
    user_ids_raw = (request.GET.get('user_ids') or '').strip()
    requested_ids = None
    if user_ids_raw:
        requested_ids = set()
        for tok in user_ids_raw.split(','):
            tok = tok.strip()
            if tok.isdigit():
                requested_ids.add(int(tok))
        if not requested_ids:
            requested_ids = None

    # ── 1) ACTIVIDADES en el rango (participante O creador) ──
    # Filtramos por la fecha (date) de fecha_inicio dentro del rango.
    acts_qs = (
        Actividad.objects
        .filter(fecha_inicio__date__range=(start, end))
        .select_related('oportunidad', 'creado_por')
        .prefetch_related('participantes')
    )

    # ── 2) TAREAS en el rango (asignado_a / participantes / observadores) ──
    tareas_qs = (
        Tarea.objects
        .filter(fecha_limite__date__range=(start, end))
        .select_related('asignado_a')
        .prefetch_related('participantes', 'observadores')
    )

    # ── 3) INSTALACIONES (buffer inferior por multi-día) ──
    # 400 días = duración máxima de un programa; 45 días dejaban fuera
    # programas largos cuyas jornadas caen en la semana visible.
    inst_qs = (
        Instalacion.objects
        .filter(fecha_programada__range=(start - timedelta(days=400), end))
        .prefetch_related('asignaciones__tecnico')
    )

    # Cada celda se acumula por user_id; los users involucrados se descubren
    # aquí para el caso "Todos" (sin user_ids).
    celdas = []
    involved_user_ids = set()

    def _emit(uid, cell):
        if requested_ids is not None and uid not in requested_ids:
            return
        cell['user_id'] = uid
        celdas.append(cell)
        involved_user_ids.add(uid)

    # ── Actividades ──
    for act in acts_qs:
        d_iso = act.fecha_inicio.date().isoformat()
        hi = act.fecha_inicio.strftime('%H:%M') if act.fecha_inicio else ''
        hf = act.fecha_fin.strftime('%H:%M') if act.fecha_fin else ''
        color = act.color or ('#0052D4' if act.oportunidad_id else '#1D1D1F')
        # Users a los que aplica: participantes ∪ {creador}.
        uids = set(p.id for p in act.participantes.all())
        if act.creado_por_id:
            uids.add(act.creado_por_id)
        base = {
            'fecha': d_iso,
            'tipo': 'actividad',
            'titulo': act.titulo or '(sin título)',
            'hora_inicio': hi,
            'hora_fin': hf,
            'color': color,
            'actividad_id': act.id,
            'completada': bool(act.completada),
            'evento': bool(act.evento_id),
            'curso': bool(act.curso_id),
        }
        for uid in uids:
            _emit(uid, dict(base))

    # ── Tareas ──
    for t in tareas_qs:
        if not t.fecha_limite:
            continue
        d_iso = t.fecha_limite.date().isoformat()
        # Si quedó en 00:00 (deadline sin hora real), tratarla como fin de día.
        if t.fecha_limite.hour == 0 and t.fecha_limite.minute == 0:
            hi = hf = '23:59'
        else:
            hi = hf = t.fecha_limite.strftime('%H:%M')
        uids = set()
        if t.asignado_a_id:
            uids.add(t.asignado_a_id)
        for p in t.participantes.all():
            uids.add(p.id)
        for o in t.observadores.all():
            uids.add(o.id)
        base = {
            'fecha': d_iso,
            'tipo': 'tarea',
            'titulo': t.titulo or '(sin título)',
            'hora_inicio': hi,
            'hora_fin': hf,
            'color': '#FF9500',
            'tarea_id': t.id,
            'estado': t.estado,
            'completada': t.estado == 'completada',
        }
        for uid in uids:
            _emit(uid, dict(base))

    # ── Instalaciones (vía Tecnico.usuario asignado) ──
    for inst in inst_qs:
        dias_inst = [d for d in _instalacion_dias_asignados(inst)
                     if d.isoformat() in dias_set]
        if not dias_inst:
            continue
        # Users ligados: cada asignación → tecnico → usuario (si existe).
        uids = set()
        for a in inst.asignaciones.all():
            tec = a.tecnico
            if tec and tec.usuario_id:
                uids.add(tec.usuario_id)
        if not uids:
            continue
        hi = inst.hora_inicio.strftime('%H:%M') if inst.hora_inicio else '08:00'
        hf = inst.hora_fin.strftime('%H:%M') if inst.hora_fin else '17:00'
        color = _equipo_estado_color(inst.estado)
        titulo = inst.proyecto or inst.cliente_nombre or 'Instalación'
        for d in dias_inst:
            d_iso = d.isoformat()
            base = {
                'fecha': d_iso,
                'tipo': 'instalacion',
                'titulo': titulo,
                'hora_inicio': hi,
                'hora_fin': hf,
                'color': color,
                'instalacion_id': inst.id,
                'estado': inst.estado,
                'cliente_nombre': inst.cliente_nombre,
                'po': inst.po,
                'proyecto': inst.proyecto,
            }
            for uid in uids:
                _emit(uid, dict(base))

    # ── Construir la lista de filas (usuarios) ──
    if requested_ids is not None:
        row_ids = requested_ids
    else:
        row_ids = involved_user_ids

    usuarios = []
    if row_ids:
        users_qs = User.objects.filter(id__in=row_ids).select_related('userprofile')
        for u in users_qs:
            nombre = u.get_full_name() or u.username
            avatar_url = None
            rol_label = ''
            perfil = getattr(u, 'userprofile', None)
            if perfil is not None:
                try:
                    avatar_url = perfil.get_avatar_url()
                except Exception:
                    avatar_url = None
                rol_label = (getattr(perfil, 'puesto', '') or '').strip()
            usuarios.append({
                'id': u.id,
                'nombre': nombre,
                'avatar_url': avatar_url,
                'rol_label': rol_label,
            })
        usuarios.sort(key=lambda x: (x['nombre'] or '').lower())

    return JsonResponse({
        'success': True,
        'rango': {'start': start.isoformat(), 'end': end.isoformat()},
        'dias': dias,
        'usuarios': usuarios,
        'celdas': celdas,
    })


# ─────────────────────────────────────────────────────────────────────
# Endpoints para el widget de oportunidad pipeline Proyecto:
# bloque "Proyecto ligado" + bloque "Programa de Obra (Instalaciones)".
# ─────────────────────────────────────────────────────────────────────

def _parse_hora(raw):
    """Convierte 'HH:MM' (o 'HH:MM:SS') → datetime.time. None si vacío/inválido.
    Tolerante: nunca levanta excepción."""
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        from datetime import time as _time
        parts = s.split(':')
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        if 0 <= h <= 23 and 0 <= m <= 59:
            return _time(hour=h, minute=m)
    except (ValueError, IndexError, TypeError):
        pass
    return None


def _parse_dias_personalizados(raw):
    """Convierte una lista de strings ISO de fechas → lista de strings ISO
    normalizada y ordenada, o None si vacío/no-lista. Tolerante."""
    if not raw or not isinstance(raw, (list, tuple)):
        return None
    from datetime import date as _date
    fechas = []
    for d in raw:
        try:
            fechas.append(_date.fromisoformat(str(d)[:10]))
        except (ValueError, TypeError):
            continue
    if not fechas:
        return None
    return [d.isoformat() for d in sorted(fechas)]


def _instalacion_payload_to_kwargs(data, cliente_default=None, po_default=''):
    """Helper (NO es view, NO va con @login_required): convierte un body
    JSON del modal en kwargs para Instalacion.

    Devuelve (kwargs, error_text). Si error_text no es None, hubo un
    problema de validación y se debe devolver 400. Tolerante con strings
    vacíos para Decimal y fecha.
    """
    descripcion = (data.get('descripcion') or '').strip()
    if not descripcion:
        return None, 'La descripción es obligatoria.'

    fecha_raw = (data.get('fecha') or '').strip()
    fecha_programada = None
    if fecha_raw:
        try:
            from datetime import date as _date
            fecha_programada = _date.fromisoformat(fecha_raw)
        except ValueError:
            return None, 'Fecha inválida (usa YYYY-MM-DD).'

    def _dec(v, default='0'):
        try:
            return Decimal(str(v if v not in (None, '') else default))
        except (InvalidOperation, ValueError):
            return Decimal(default)

    hora_inicio = _parse_hora(data.get('hora_inicio'))
    hora_fin = _parse_hora(data.get('hora_fin'))
    dias_personalizados = _parse_dias_personalizados(data.get('dias_personalizados'))

    kwargs = {
        'po': (data.get('po') or po_default or '').strip()[:80],
        'proyecto': descripcion[:400],
        'fecha_programada': fecha_programada,
        'hora_inicio': hora_inicio,
        'hora_fin': hora_fin,
        'dias_personalizados': dias_personalizados,
        'fecha_tentativa_texto': (data.get('fecha_tentativa_texto') or '').strip()[:120],
        'jornadas_count': int(data.get('jornadas_count') or 1),
        'jornadas_tipo': (data.get('jornadas_tipo') or 'normal'),
        'personal_descripcion': (data.get('personal') or '').strip()[:200],
        'monto_po': _dec(data.get('monto_po')),
        'utilidad': _dec(data.get('utilidad')),
        'observaciones': (data.get('observaciones') or '').strip(),
        'notas': (data.get('notas') or '').strip(),
        'estado': (data.get('estado') or 'programada'),
    }
    if cliente_default is not None:
        kwargs['cliente_nombre'] = data.get('cliente_nombre') or (cliente_default.nombre_empresa if cliente_default else '')
        kwargs['cliente'] = cliente_default
    else:
        kwargs['cliente_nombre'] = (data.get('cliente_nombre') or '').strip()[:200]
    return kwargs, None


def _instalacion_to_full_dict(inst):
    """Serialización completa para el modal detalle (incluye asignaciones)."""
    asignaciones = []
    for a in inst.asignaciones.select_related('tecnico').order_by('fecha', 'tecnico__nombre'):
        asignaciones.append({
            'id': a.id,
            'tecnico_id': a.tecnico_id,
            'tecnico_nombre': a.tecnico.nombre,
            'tecnico_rol': a.tecnico.get_rol_display(),
            'fecha': a.fecha.isoformat(),
            'hora_inicio': a.hora_inicio.strftime('%H:%M') if a.hora_inicio else '',
            'hora_fin': a.hora_fin.strftime('%H:%M') if a.hora_fin else '',
            'notas': a.notas,
        })
    return {
        'id': inst.id,
        'po': inst.po,
        'descripcion': inst.proyecto,
        'cliente_nombre': inst.cliente_nombre,
        'fecha': inst.fecha_programada.isoformat() if inst.fecha_programada else '',
        'hora_inicio': inst.hora_inicio.strftime('%H:%M') if inst.hora_inicio else '',
        'hora_fin': inst.hora_fin.strftime('%H:%M') if inst.hora_fin else '',
        'dias_personalizados': inst.dias_personalizados or None,
        # Lista de todos los días que ocupa (para el desglose de jornadas).
        'dias': [d.isoformat() for d in _instalacion_dias_asignados(inst)],
        'fecha_tentativa_texto': inst.fecha_tentativa_texto,
        'jornadas_count': inst.jornadas_count,
        'jornadas_tipo': inst.jornadas_tipo,
        'jornadas_tipo_label': inst.get_jornadas_tipo_display(),
        'personal': inst.personal_descripcion,
        'monto_po': str(inst.monto_po),
        'utilidad': str(inst.utilidad),
        'estado': inst.estado,
        'estado_label': inst.get_estado_display(),
        'observaciones': inst.observaciones,
        'notas': inst.notas,
        'proyecto_id': inst.proyecto_crm_id,
        'proyecto_nombre': inst.proyecto_crm.nombre if inst.proyecto_crm_id else '',
        'oportunidad_id': inst.oportunidad_id,
        'oportunidad_titulo': inst.oportunidad.oportunidad if inst.oportunidad_id else '',
        'creador': (inst.creado_por.get_full_name() or inst.creado_por.username) if inst.creado_por_id else '',
        'asignaciones': asignaciones,
    }


@login_required
def api_proyecto_instalaciones(request, proyecto_id):
    """GET/POST instalaciones ligadas a un Proyecto (Programa de Obra).

    GET → lista las instalaciones del proyecto ordenadas por fecha.
    POST → crea una nueva instalación pre-ligada al proyecto. Body JSON:
          {po, descripcion, fecha, jornadas_count, jornadas_tipo, personal,
           monto_po, utilidad, observaciones, notas, estado, cliente_nombre,
           oportunidad_id (opcional)}

    Nota: usa el modelo ProyectoIAMET (CRM moderno), no el legacy `Proyecto`.
    """
    proy = get_object_or_404(ProyectoIAMET, pk=proyecto_id)

    if request.method == 'GET':
        qs = (
            Instalacion.objects
            .filter(proyecto_crm=proy)
            .order_by(F('fecha_programada').asc(nulls_last=True), 'fecha_creacion')
            .prefetch_related('asignaciones__tecnico__usuario')
        )
        items = []
        for inst in qs:
            # Resumen de técnicos asignados (dedupe por tecnico_id; un
            # técnico con varias fechas aparece una sola vez en el avatar).
            tecnicos_resumen = {}
            for a in inst.asignaciones.all():
                t = a.tecnico
                if t.id in tecnicos_resumen:
                    continue
                avatar_url = None
                if t.usuario_id:
                    try:
                        if hasattr(t.usuario, 'userprofile'):
                            avatar_url = t.usuario.userprofile.get_avatar_url()
                    except Exception:
                        avatar_url = None
                nombre = t.nombre or ''
                partes = [p for p in nombre.split() if p]
                iniciales = (partes[0][0] + partes[-1][0]).upper() if len(partes) >= 2 else (nombre[:2].upper() if nombre else '?')
                tecnicos_resumen[t.id] = {
                    'id': t.id,
                    'nombre': nombre,
                    'avatar_url': avatar_url,
                    'iniciales': iniciales,
                }
            items.append({
                'id': inst.id,
                'po': inst.po,
                'descripcion': inst.proyecto,
                'cliente_nombre': inst.cliente_nombre,
                'fecha': inst.fecha_programada.isoformat() if inst.fecha_programada else '',
                'fecha_tentativa_texto': inst.fecha_tentativa_texto,
                'jornadas_count': inst.jornadas_count,
                'jornadas_tipo_label': inst.get_jornadas_tipo_display(),
                'personal': inst.personal_descripcion,
                'monto_po': str(inst.monto_po),
                'estado': inst.estado,
                'estado_label': inst.get_estado_display(),
                'asignaciones_count': len(tecnicos_resumen),
                'tecnicos_asignados': list(tecnicos_resumen.values()),
            })
        return JsonResponse({'success': True, 'instalaciones': items})

    if request.method == 'POST':
        try:
            data = json.loads(request.body.decode('utf-8') or '{}')
        except (ValueError, AttributeError):
            data = {}
        kwargs, err = _instalacion_payload_to_kwargs(data, cliente_default=None)
        if err:
            return JsonResponse({'success': False, 'error': err}, status=400)

        # Opp opcional.
        opp = None
        if data.get('oportunidad_id'):
            try:
                opp = TodoItem.objects.get(pk=int(data['oportunidad_id']))
            except (TodoItem.DoesNotExist, ValueError, TypeError):
                opp = None
        # Si no se mandó opp_id explícitamente, usar la del ProyectoIAMET.
        if opp is None and getattr(proy, 'oportunidad_id', None):
            try:
                opp = proy.oportunidad
            except Exception:
                opp = None

        try:
            inst = Instalacion.objects.create(
                proyecto_crm=proy,
                oportunidad=opp,
                creado_por=request.user,
                **kwargs,
            )
        except Exception as e:
            import traceback
            return JsonResponse({
                'success': False,
                'error': 'Error al crear instalación: ' + str(e),
                'trace': traceback.format_exc()[-1500:],
            }, status=500)

        # Auto-asignar técnicos por user_id en la fecha programada.
        # Si la instalación no tiene fecha, no se crean asignaciones.
        asignaciones_creadas = 0
        asignaciones_error = None
        tecnico_user_ids = data.get('tecnico_user_ids') or []
        if tecnico_user_ids and inst.fecha_programada:
            for uid in tecnico_user_ids:
                try:
                    user = User.objects.get(pk=int(uid))
                except (User.DoesNotExist, ValueError, TypeError):
                    continue
                try:
                    tecnico = Tecnico.objects.filter(usuario=user).first()
                    if not tecnico:
                        nombre = (user.get_full_name() or user.username).strip()[:120]
                        tecnico = Tecnico.objects.create(
                            nombre=nombre, rol='tecnico', activo=True, usuario=user,
                        )
                    _, created = InstalacionAsignacion.objects.get_or_create(
                        instalacion=inst, tecnico=tecnico, fecha=inst.fecha_programada,
                    )
                    if created:
                        asignaciones_creadas += 1
                except Exception as e:
                    asignaciones_error = str(e)
                    continue

        # Asignación directa por ID de Tecnico (catálogo). El picker de "crear"
        # ahora elige del mismo catálogo que el select de "editar", así que
        # manda tecnico_ids (IDs de Tecnico), no user_ids.
        tecnico_ids = data.get('tecnico_ids') or []
        if tecnico_ids and inst.fecha_programada:
            for tid in tecnico_ids:
                try:
                    tecnico = Tecnico.objects.get(pk=int(tid))
                except (Tecnico.DoesNotExist, ValueError, TypeError):
                    continue
                try:
                    _, created = InstalacionAsignacion.objects.get_or_create(
                        instalacion=inst, tecnico=tecnico, fecha=inst.fecha_programada,
                    )
                    if created:
                        asignaciones_creadas += 1
                except Exception as e:
                    asignaciones_error = str(e)
                    continue

        resp = {'success': True, 'instalacion_id': inst.id, 'asignaciones_creadas': asignaciones_creadas}
        if asignaciones_error:
            resp['asignaciones_warning'] = asignaciones_error
        return JsonResponse(resp)

    return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)


@login_required
def api_proyecto_instalacion_defaults(request, proyecto_id):
    """GET → devuelve defaults para prellenar el modal "Nueva instalación".

    Lee la oportunidad ligada al ProyectoIAMET (proy.oportunidad) y
    extrae cliente_nombre + po. Si el proyecto no tiene opp ligada,
    devuelve vacíos.
    """
    if request.method != 'GET':
        return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)
    proy = get_object_or_404(ProyectoIAMET, pk=proyecto_id)
    opp = proy.oportunidad
    cliente_nombre = ''
    po = ''
    if opp:
        if opp.cliente_id:
            cliente_nombre = opp.cliente.nombre_empresa or ''
        po = (opp.po_number or '').strip()
    # Fallback: cliente_nombre directo del ProyectoIAMET si lo tiene.
    if not cliente_nombre:
        cliente_nombre = getattr(proy, 'cliente_nombre', '') or ''
    return JsonResponse({
        'success': True,
        'defaults': {
            'cliente_nombre': cliente_nombre,
            'po': po,
            'oportunidad_id': opp.id if opp else None,
            'oportunidad_titulo': opp.oportunidad if opp else '',
        },
    })


@login_required
def api_instalacion_detalle(request, instalacion_id):
    """GET/PATCH/DELETE detalle de una instalación.

    GET → datos completos para el modal (incluye asignaciones de técnicos).
    PATCH → actualiza campos del body (sólo los presentes).
    DELETE → elimina la instalación (las asignaciones caen por CASCADE).
    """
    inst = get_object_or_404(Instalacion, pk=instalacion_id)

    if request.method == 'GET':
        return JsonResponse({'success': True, 'instalacion': _instalacion_to_full_dict(inst)})

    if request.method == 'DELETE':
        inst.delete()
        return JsonResponse({'success': True})

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body.decode('utf-8') or '{}')
        except (ValueError, AttributeError):
            data = {}
        kwargs, err = _instalacion_payload_to_kwargs(data, cliente_default=None)
        if err:
            return JsonResponse({'success': False, 'error': err}, status=400)
        for field, value in kwargs.items():
            setattr(inst, field, value)
        inst.save()
        return JsonResponse({'success': True, 'instalacion': _instalacion_to_full_dict(inst)})

    return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)


@login_required
def api_instalacion_reagendar(request, instalacion_id):
    """PATCH /app/api/instalacion/<id>/reagendar/ — reagenda por drag&drop.

    Body JSON con CUALQUIERA de:
        {fecha (YYYY-MM-DD), hora_inicio ("HH:MM"), hora_fin ("HH:MM"),
         dias_personalizados (list|null)}
    Sólo actualiza los campos presentes en el body. A diferencia del PATCH
    completo (api_instalacion_detalle), NO exige descripción — es un movimiento
    ligero del calendario.
    """
    if request.method != 'PATCH':
        return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)

    inst = get_object_or_404(Instalacion, pk=instalacion_id)
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, AttributeError):
        data = {}

    from datetime import date as _date

    if 'fecha' in data:
        fecha_raw = (data.get('fecha') or '').strip()
        if fecha_raw:
            try:
                inst.fecha_programada = _date.fromisoformat(fecha_raw)
            except ValueError:
                return JsonResponse({'success': False, 'error': 'Fecha inválida (usa YYYY-MM-DD).'}, status=400)
        else:
            inst.fecha_programada = None

    if 'hora_inicio' in data:
        inst.hora_inicio = _parse_hora(data.get('hora_inicio'))

    if 'hora_fin' in data:
        inst.hora_fin = _parse_hora(data.get('hora_fin'))

    if 'dias_personalizados' in data:
        inst.dias_personalizados = _parse_dias_personalizados(data.get('dias_personalizados'))

    inst.save()
    return JsonResponse({'success': True, 'instalacion': _instalacion_to_full_dict(inst)})


@login_required
def api_instalacion_asignaciones(request, instalacion_id):
    """POST asigna un técnico a una instalación en una fecha.

    Body: {tecnico_id, fecha (YYYY-MM-DD), hora_inicio (opc), hora_fin (opc), notas (opc)}.
    Idempotente por UniqueConstraint(instalacion, tecnico, fecha): si ya
    existe, devuelve la existente con un flag 'created': False.
    """
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)

    inst = get_object_or_404(Instalacion, pk=instalacion_id)
    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, AttributeError):
        data = {}

    try:
        tecnico_id = int(data.get('tecnico_id'))
    except (TypeError, ValueError):
        return JsonResponse({'success': False, 'error': 'tecnico_id inválido'}, status=400)
    tecnico = get_object_or_404(Tecnico, pk=tecnico_id)

    from datetime import date as _date, time as _time
    fecha_raw = (data.get('fecha') or '').strip()
    if not fecha_raw:
        return JsonResponse({'success': False, 'error': 'fecha requerida'}, status=400)
    try:
        fecha = _date.fromisoformat(fecha_raw)
    except ValueError:
        return JsonResponse({'success': False, 'error': 'Fecha inválida (YYYY-MM-DD)'}, status=400)

    def _parse_time(s):
        if not s:
            return None
        try:
            h, m = s.split(':')
            return _time(int(h), int(m))
        except (ValueError, AttributeError):
            return None

    asig, created = InstalacionAsignacion.objects.get_or_create(
        instalacion=inst, tecnico=tecnico, fecha=fecha,
        defaults={
            'hora_inicio': _parse_time(data.get('hora_inicio')),
            'hora_fin': _parse_time(data.get('hora_fin')),
            'notas': (data.get('notas') or '').strip()[:200],
        },
    )
    return JsonResponse({
        'success': True,
        'created': created,
        'asignacion': {
            'id': asig.id,
            'tecnico_id': tecnico.id,
            'tecnico_nombre': tecnico.nombre,
            'tecnico_rol': tecnico.get_rol_display(),
            'fecha': asig.fecha.isoformat(),
            'hora_inicio': asig.hora_inicio.strftime('%H:%M') if asig.hora_inicio else '',
            'hora_fin': asig.hora_fin.strftime('%H:%M') if asig.hora_fin else '',
            'notas': asig.notas,
        },
    })


@login_required
def api_instalacion_asignacion_detalle(request, instalacion_id, asignacion_id):
    """DELETE → quita la asignación de técnico de la instalación."""
    if request.method != 'DELETE':
        return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)
    asig = get_object_or_404(InstalacionAsignacion, pk=asignacion_id, instalacion_id=instalacion_id)
    asig.delete()
    return JsonResponse({'success': True})


@login_required
def api_tecnicos_list(request):
    """GET → lista técnicos (por default solo activos). Usado por el
    picker de "Asignar técnico" del modal detalle. Param: ?incluir_inactivos=1.
    """
    if request.method != 'GET':
        return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)
    qs = Tecnico.objects.all()
    if request.GET.get('incluir_inactivos') != '1':
        qs = qs.filter(activo=True)
    qs = qs.order_by('nombre')
    return JsonResponse({
        'success': True,
        'tecnicos': [{
            'id': t.id,
            'nombre': t.nombre,
            'rol': t.rol,
            'rol_label': t.get_rol_display(),
            'color': t.color or '',
            'activo': t.activo,
        } for t in qs],
    })


@login_required
def api_oportunidad_proyectos_ligados(request, oportunidad_id):
    """GET/POST/DELETE proyectos ligados a una oportunidad vía el M2M
    plano Proyecto.oportunidades_ligadas.

    Nota: existe otro endpoint legacy `api_oportunidad_proyectos` (línea
    ~4640) que maneja `ProyectoOportunidadLink` (sugerencias con score
    + confirmar/rechazar). Son DOS sistemas paralelos; este es para el
    widget de Pipeline Proyecto donde el vendedor liga manualmente.

    GET → lista los proyectos ligados.
    POST → vincula un proyecto existente. Body: {proyecto_id}.
    DELETE → desvincula. Body: {proyecto_id}.
    """
    opp = get_object_or_404(TodoItem, pk=oportunidad_id)

    if request.method == 'GET':
        proyectos = (
            Proyecto.objects
            .filter(oportunidades_ligadas=opp)
            .order_by('-fecha_actualizacion')
        )
        items = [{
            'id': p.id,
            'nombre': p.nombre,
            'tipo': p.tipo,
            'tipo_label': p.get_tipo_display(),
            'privacidad': p.privacidad,
        } for p in proyectos]
        return JsonResponse({'success': True, 'proyectos': items})

    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, AttributeError):
        data = {}
    proy_id = data.get('proyecto_id')
    if not proy_id:
        return JsonResponse({'success': False, 'error': 'Falta proyecto_id'}, status=400)
    proy = get_object_or_404(Proyecto, pk=proy_id)

    if request.method == 'POST':
        proy.oportunidades_ligadas.add(opp)
        return JsonResponse({'success': True, 'proyecto_id': proy.id})

    if request.method == 'DELETE':
        proy.oportunidades_ligadas.remove(opp)
        return JsonResponse({'success': True})

    return JsonResponse({'success': False, 'error': 'Método no permitido'}, status=405)


@login_required
def api_proyectos_buscar(request):
    """GET ?q=… → busca proyectos por nombre (máximo 20). Usado por el
    picker de "Vincular proyecto existente" del widget de oportunidad.
    """
    q = (request.GET.get('q') or '').strip()
    qs = Proyecto.objects.all()
    if q:
        qs = qs.filter(nombre__icontains=q)
    qs = qs.order_by('-fecha_actualizacion')[:20]
    items = [{
        'id': p.id,
        'nombre': p.nombre,
        'tipo': p.tipo,
        'tipo_label': p.get_tipo_display(),
    } for p in qs]
    return JsonResponse({'success': True, 'proyectos': items})

# ----------------------------------------------------------------------
# views_api.py — Muro empresarial, jornadas, chat, notificaciones, navidad.
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
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo
from dateutil.relativedelta import relativedelta
from django.utils import timezone
from decimal import Decimal
import decimal
from django.utils.html import json_script

# Helper function to detect lost opportunities
from .views_utils import *
from .views_utils import _muro_post_dict

@login_required
def api_jornada_ayer(request):
    """Retorna la eficiencia del día anterior del usuario."""
    from datetime import timedelta
    ayer = timezone.localdate() - timedelta(days=1)
    jornada = AsistenciaJornada.objects.filter(usuario=request.user, fecha=ayer).first()
    if jornada:
        return JsonResponse({'eficiencia': float(jornada.eficiencia_dia), 'fecha': str(ayer)})
    return JsonResponse({'eficiencia': None, 'fecha': str(ayer)})


@login_required
def spotlight_search_api(request):
    """
    API Spotlight v2 — Búsqueda universal rica.

    Parámetros:
      q:     texto a buscar (mínimo 2 chars si no hay user_filter)
      scope: all | oportunidad | cotizacion | tarea | cliente | proyecto
      user:  username / nombre para filtrar por responsable
    """
    query = request.GET.get('q', '').strip()
    scope = request.GET.get('scope', 'all').strip().lower()
    user_filter = request.GET.get('user', '').strip()

    VALID_SCOPES = {'all', 'tarea', 'oportunidad', 'cotizacion', 'cliente', 'proyecto'}
    if scope not in VALID_SCOPES:
        scope = 'all'

    # ── Fase 2: search limitado para ingenieros ──────────
    # Cuando UserProfile.rol == 'ingeniero', el Spotlight solo busca en
    # Tareas y Proyectos. Los scopes no permitidos se degradan a 'all'
    # y más abajo solo se ejecutan los bloques de tarea/proyecto.
    try:
        _profile = getattr(request.user, 'userprofile', None)
        es_ingeniero_rol = bool(_profile and getattr(_profile, 'rol', 'vendedor') == 'ingeniero')
    except Exception:
        es_ingeniero_rol = False
    if es_ingeniero_rol and scope not in ('all', 'tarea', 'proyecto'):
        scope = 'all'

    # Si no hay query ni filtro de usuario, nada
    if len(query) < 2 and not user_filter:
        return JsonResponse({'results': [], 'query': query, 'scope': scope})

    # Resolver user_filter → User object
    filter_user_obj = None
    if user_filter:
        filter_user_obj = User.objects.filter(
            Q(username__iexact=user_filter) |
            Q(first_name__icontains=user_filter) |
            Q(last_name__icontains=user_filter)
        ).first()

    numeric_query = query.replace('#', '').strip() if query else ''
    is_numeric = numeric_query.isdigit() if numeric_query else False

    # ── Helpers ──────────────────────────────────────────
    def _user_dict(u):
        if not u:
            return None
        full = (u.get_full_name() or u.username or '').strip()
        parts = full.split()
        if parts:
            inic = (parts[0][:1] + (parts[1][:1] if len(parts) > 1 else '')).upper()
        else:
            inic = '?'
        avatar_url = None
        try:
            prof = getattr(u, 'userprofile', None)
            if prof and prof.avatar:
                avatar_url = prof.avatar.url
        except Exception:
            pass
        return {'id': u.id, 'nombre': full, 'iniciales': inic, 'avatar_url': avatar_url}

    def _fmt_monto(v):
        if v is None:
            return None
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
        if n == 0:
            return None
        if abs(n) >= 1_000_000:
            return f'${n/1_000_000:.1f}M'
        if abs(n) >= 1_000:
            return f'${n/1_000:.0f}k'
        return f'${n:.0f}'

    def _rel_date(dt):
        if not dt:
            return None
        try:
            now = timezone.now()
            diff = now - dt
            days = diff.days
        except Exception:
            return None
        if days == 0 and diff.total_seconds() >= 0:
            return 'hoy'
        if days == 1:
            return 'ayer'
        if 1 < days < 7:
            return f'hace {days}d'
        if 7 <= days < 30:
            return f'hace {days // 7}sem'
        if 30 <= days < 365:
            return f'hace {days // 30}m'
        if days >= 365:
            return f'hace {days // 365}a'
        # futuro
        fut = -days
        if fut == 0:
            return 'hoy'
        if fut == 1:
            return 'mañana'
        if fut < 7:
            return f'en {fut}d'
        if fut < 30:
            return f'en {fut // 7}sem'
        return f'en {fut // 30}m'

    def _opp_status(opp):
        """Devuelve (status_class, status_label)."""
        etapa = (opp.etapa_corta or '').strip()
        estado = (opp.estado_crm or '').strip().lower()
        src = (etapa or estado or '').lower()
        label = etapa or estado.title() or 'Sin estatus'
        if any(k in src for k in ['ganad', 'won', 'cerrad']):
            return ('success', label)
        if any(k in src for k in ['perdid', 'lost', 'cancel']):
            return ('danger', label)
        if any(k in src for k in ['captura', 'nueva', 'borrador', 'nuevo']):
            return ('info', label)
        if src:
            return ('warning', label)
        return ('neutral', 'Sin etapa')

    # Limits per scope
    limits = {
        'all': {'oportunidad': 6, 'cotizacion': 5, 'tarea': 5, 'cliente': 4, 'proyecto': 4},
    }
    for s in ('oportunidad', 'cotizacion', 'tarea', 'cliente', 'proyecto'):
        limits[s] = {s: 12}

    lim = limits.get(scope, limits['all'])
    results = []

    # ── Oportunidades ────────────────────────────────────
    if scope in ('all', 'oportunidad') and (query or filter_user_obj) and not es_ingeniero_rol:
        opp_qs = TodoItem.objects.all().select_related('cliente', 'usuario')
        if query:
            opp_filter = (
                Q(oportunidad__icontains=query) |
                Q(cliente__nombre_empresa__icontains=query) |
                Q(comentarios__icontains=query) |
                Q(po_number__icontains=query) |
                Q(factura_numero__icontains=query)
            )
            if is_numeric:
                opp_filter |= Q(id__icontains=numeric_query)
            opp_qs = opp_qs.filter(opp_filter)
        if filter_user_obj:
            opp_qs = opp_qs.filter(usuario=filter_user_obj)
        if not is_supervisor(request.user):
            from .views_grupos import get_usuarios_visibles_ids
            _gids = get_usuarios_visibles_ids(request.user)
            if _gids and len(_gids) > 1:
                opp_qs = opp_qs.filter(usuario_id__in=_gids)
            else:
                opp_qs = opp_qs.filter(usuario=request.user)
        opp_qs = opp_qs.order_by('-fecha_actualizacion')
        for opp in opp_qs[:lim.get('oportunidad', 6)]:
            anio = opp.anio_cierre or opp.fecha_creacion.year
            st_class, st_label = _opp_status(opp)
            results.append({
                'type': 'oportunidad',
                'id': opp.id,
                'opp_id': opp.id,
                'title': opp.oportunidad,
                'subtitle': opp.cliente.nombre_empresa if opp.cliente else 'Sin cliente',
                'url': f'/app/todos/?tab=crm&anio={anio}&mes=todos&open_opp={opp.id}',
                'status_class': st_class,
                'status_label': st_label,
                'monto_formatted': _fmt_monto(opp.monto),
                'responsable': _user_dict(opp.usuario),
                'fecha_iso': opp.fecha_actualizacion.isoformat() if opp.fecha_actualizacion else None,
                'fecha_relative': _rel_date(opp.fecha_actualizacion),
                'po_number': opp.po_number or '',
                'factura_numero': opp.factura_numero or '',
                'priority': 3,
            })

    # ── Cotizaciones ─────────────────────────────────────
    if scope in ('all', 'cotizacion') and (query or filter_user_obj) and not es_ingeniero_rol:
        base_q = Q()
        if query:
            base_q |= Q(nombre_cotizacion__icontains=query) | Q(cliente__nombre_empresa__icontains=query) | Q(descripcion__icontains=query)
            if is_numeric:
                # icontains sobre id permite que "119" matchee #1198, #1199, etc.
                base_q |= Q(id__icontains=numeric_query)
        cot_qs = Cotizacion.objects.filter(base_q) if query else Cotizacion.objects.all()
        cot_qs = cot_qs.filter(oportunidad__isnull=False).select_related('cliente', 'created_by', 'oportunidad')
        if filter_user_obj:
            cot_qs = cot_qs.filter(Q(created_by=filter_user_obj) | Q(oportunidad__usuario=filter_user_obj))
        if not is_supervisor(request.user):
            from .views_grupos import get_usuarios_visibles_ids
            _gids = get_usuarios_visibles_ids(request.user)
            if _gids and len(_gids) > 1:
                cot_qs = cot_qs.filter(Q(created_by_id__in=_gids) | Q(oportunidad__usuario_id__in=_gids))
            else:
                cot_qs = cot_qs.filter(created_by=request.user)
        cot_qs = cot_qs.order_by('-fecha_creacion')
        for cot in cot_qs[:lim.get('cotizacion', 5)]:
            is_exact = is_numeric and str(cot.id) == numeric_query
            opp = cot.oportunidad
            opp_id = opp.id if opp else None
            if opp_id:
                anio = opp.anio_cierre or opp.fecha_creacion.year
                url = f'/app/todos/?tab=crm&anio={anio}&mes=todos&open_opp={opp_id}'
            else:
                url = '/app/todos/?tab=crm'
            results.append({
                'type': 'cotizacion',
                'id': cot.id,
                'opp_id': opp_id,
                'title': cot.nombre_cotizacion or f'Cotización #{cot.id}',
                'subtitle': (cot.cliente.nombre_empresa if cot.cliente else 'Sin cliente') + f' · #{cot.id}',
                'url': url,
                'responsable': _user_dict(cot.created_by),
                'fecha_iso': cot.fecha_creacion.isoformat() if cot.fecha_creacion else None,
                'fecha_relative': _rel_date(cot.fecha_creacion),
                'priority': 1 if is_exact else 2,
            })

    # ── Tareas ───────────────────────────────────────────
    if scope in ('all', 'tarea') and (query or filter_user_obj):
        tareas_qs = Tarea.objects.all().select_related('proyecto', 'creado_por', 'asignado_a')
        if query:
            tareas_qs = tareas_qs.filter(Q(titulo__icontains=query) | Q(descripcion__icontains=query))
        if filter_user_obj:
            tareas_qs = tareas_qs.filter(Q(asignado_a=filter_user_obj) | Q(creado_por=filter_user_obj))
        if not is_supervisor(request.user):
            tareas_qs = tareas_qs.filter(Q(creado_por=request.user) | Q(asignado_a=request.user))
        tareas_qs = tareas_qs.order_by('-id').distinct()
        ESTADO_MAP = {
            'pendiente': 'warning', 'iniciada': 'info', 'en_progreso': 'warning',
            'completada': 'success', 'cancelada': 'danger',
        }
        for tarea in tareas_qs[:lim.get('tarea', 5)]:
            responsable_user = tarea.asignado_a or tarea.creado_por
            proyecto_nombre = tarea.proyecto.nombre if tarea.proyecto else 'Sin proyecto'
            results.append({
                'type': 'tarea',
                'id': tarea.id,
                'title': tarea.titulo,
                'subtitle': proyecto_nombre,
                'url': f'/app/todos/?tab=crm&open_task={tarea.id}',
                'status_class': ESTADO_MAP.get(tarea.estado, 'neutral'),
                'status_label': tarea.get_estado_display(),
                'responsable': _user_dict(responsable_user),
                'fecha_iso': tarea.fecha_limite.isoformat() if tarea.fecha_limite else None,
                'fecha_relative': _rel_date(tarea.fecha_limite),
                'priority': 4,
            })

    # ── Clientes ─────────────────────────────────────────
    if scope in ('all', 'cliente') and query and not es_ingeniero_rol:
        cli_qs = Cliente.objects.filter(
            Q(nombre_empresa__icontains=query) |
            Q(rfc__icontains=query) |
            Q(contacto_principal__icontains=query)
        ).select_related('asignado_a')
        if filter_user_obj:
            cli_qs = cli_qs.filter(asignado_a=filter_user_obj)
        if not is_supervisor(request.user):
            from .views_grupos import get_usuarios_visibles_ids
            _gids = get_usuarios_visibles_ids(request.user)
            if _gids:
                cli_qs = cli_qs.filter(Q(asignado_a_id__in=_gids) | Q(asignado_a__isnull=True))
        CAT_MAP = {'A': ('success', 'Cat. A'), 'B': ('info', 'Cat. B'), 'C': ('neutral', 'Cat. C')}
        for cli in cli_qs[:lim.get('cliente', 4)]:
            st_class, st_label = CAT_MAP.get(cli.categoria, ('neutral', ''))
            results.append({
                'type': 'cliente',
                'id': cli.id,
                'title': cli.nombre_empresa,
                'subtitle': cli.contacto_principal or cli.rfc or 'Sin contacto',
                'url': f'/app/oportunidades-cliente/{cli.id}/',
                'status_class': st_class,
                'status_label': st_label,
                'responsable': _user_dict(cli.asignado_a),
                'priority': 5,
            })

    # ── Proyectos ────────────────────────────────────────
    if scope in ('all', 'proyecto') and query:
        proy_qs = Proyecto.objects.filter(
            Q(nombre__icontains=query) | Q(descripcion__icontains=query)
        ).select_related('creado_por')
        if filter_user_obj:
            proy_qs = proy_qs.filter(Q(creado_por=filter_user_obj) | Q(miembros=filter_user_obj)).distinct()
        if not is_supervisor(request.user):
            proy_qs = proy_qs.filter(
                Q(privacidad='publico') | Q(creado_por=request.user) | Q(miembros=request.user)
            ).distinct()
        for proy in proy_qs[:lim.get('proyecto', 4)]:
            results.append({
                'type': 'proyecto',
                'id': proy.id,
                'title': proy.nombre,
                'subtitle': proy.get_tipo_display() or 'Proyecto',
                'url': f'/app/todos/?tab=crm',
                'status_class': 'info' if proy.privacidad == 'privado' else 'neutral',
                'status_label': proy.get_privacidad_display(),
                'responsable': _user_dict(proy.creado_por),
                'fecha_iso': proy.fecha_creacion.isoformat() if proy.fecha_creacion else None,
                'fecha_relative': _rel_date(proy.fecha_creacion),
                'priority': 6,
            })

    results.sort(key=lambda x: (x.get('priority', 5), x['title'].lower()))

    return JsonResponse({
        'results': results[:30],
        'query': query,
        'scope': scope,
        'user_filter': filter_user_obj.username if filter_user_obj else None,
        'total': len(results),
    })


@login_required
def obtener_notificaciones_api(request):
    """
    API para obtener las notificaciones del usuario actual
    """
    try:
        from .models import Notificacion
        user = request.user
        
        # --- Lógica para verificar tareas a punto de vencer y vencidas ---
        try:
            from django.utils import timezone
            from django.db.models import Q
            from datetime import timedelta
            from .models import Tarea, TareaOportunidad
            now = timezone.now()
            umbral_por_vencer = now + timedelta(minutes=10)
            
            # Buscar tareas generales del usuario
            mis_tareas = Tarea.objects.filter(
                Q(asignado_a=user) | Q(participantes=user),
                estado__in=['pendiente', 'iniciada', 'en_progreso'],
                fecha_limite__isnull=False
            ).distinct()
            
            for t in mis_tareas:
                if t.fecha_limite < now:
                    # Vencida
                    if not Notificacion.objects.filter(usuario_destinatario=user, tipo='tarea_vencida', tarea_id=t.id).exists():
                        crear_notificacion(user, 'tarea_vencida', 'Tarea Vencida', f'La tarea "{t.titulo}" ha vencido.', tarea_id=t.id)
                elif t.fecha_limite <= umbral_por_vencer:
                    # Por vencer
                    if not Notificacion.objects.filter(usuario_destinatario=user, tipo='tarea_por_vencer', tarea_id=t.id).exists():
                        crear_notificacion(user, 'tarea_por_vencer', 'Tarea por Vencer', f'La tarea "{t.titulo}" vence en menos de 10 minutos.', tarea_id=t.id)

            # Idem para tareas de oportunidad
            mis_tareas_opp = TareaOportunidad.objects.filter(
                responsable=user,
                estado__in=['pendiente', 'en_progreso'],
                fecha_limite__isnull=False
            )
            for t in mis_tareas_opp:
                if t.fecha_limite < now:
                    if not Notificacion.objects.filter(usuario_destinatario=user, tipo='actividad_vencida', tarea_opp=t).exists():
                        crear_notificacion(user, 'actividad_vencida', 'Actividad Vencida', f'La actividad "{t.titulo}" ha vencido.', tarea_opp=t, oportunidad=t.oportunidad)
                elif t.fecha_limite <= umbral_por_vencer:
                    if not Notificacion.objects.filter(usuario_destinatario=user, tipo='actividad_por_vencer', tarea_opp=t).exists():
                        crear_notificacion(user, 'actividad_por_vencer', 'Actividad por Vencer', f'La actividad "{t.titulo}" vence en menos de 10 minutos.', tarea_opp=t, oportunidad=t.oportunidad)
                        
        except Exception as ex_exp:
            print(f"Error verificando vencimientos: {ex_exp}")
        
        # Obtener notificaciones del usuario (últimas 50)
        notificaciones = Notificacion.objects.filter(
            usuario_destinatario=user
        ).select_related(
            'usuario_remitente', 'oportunidad', 'comentario', 'tarea_opp'
        ).order_by('-fecha_creacion')[:50]
        
        # Contar notificaciones no leídas
        unread_count = Notificacion.objects.filter(
            usuario_destinatario=user,
            leida=False
        ).count()
        
        # Serializar notificaciones
        notifications_data = []
        for notif in notificaciones:
            # Determinar URL basada en el tipo de notificación
            url = ''
            if notif.tarea_id:
                url = f'/app/tareas-proyectos/?task_id={notif.tarea_id}'
            elif notif.tarea_opp_id:
                if notif.oportunidad_id:
                    url = f'/app/cotizaciones/oportunidad/{notif.oportunidad_id}/?tab=actividades'
                else:
                    url = '/app/todos/'
            elif notif.oportunidad:
                url = f'/app/cotizaciones/oportunidad/{notif.oportunidad.id}/'
            elif notif.proyecto_id:
                url = f'/app/proyecto/{notif.proyecto_id}/'
            elif notif.tipo in ['muro_post', 'muro_mencion', 'mencion', 'respuesta']:
                url = '/app/home/?open_muro=1'
            elif notif.tipo == 'rendimiento_bajo' and notif.usuario_remitente:
                url = f'/app/perfil-usuario/{notif.usuario_remitente.id}/'
            notifications_data.append({
                'id': notif.id,
                'titulo': notif.titulo,
                'mensaje': notif.mensaje,
                'tipo': notif.tipo,
                'leida': notif.leida,
                'fecha': notif.fecha_creacion.strftime('%d/%m/%Y %H:%M'),
                'remitente': notif.usuario_remitente.get_full_name() if notif.usuario_remitente else 'Sistema',
                'url': url,
                'remitente_id': notif.usuario_remitente.id if notif.usuario_remitente else None,
                'tarea_id': notif.tarea_id,
                'proyecto_id': notif.proyecto_id,
                'tarea_opp_id': notif.tarea_opp_id,
                'oportunidad_id': notif.oportunidad_id,
                'solicitud_perfil_data': {
                    'id': notif.solicitud_perfil.id,
                    'first_name': notif.solicitud_perfil.first_name,
                    'last_name': notif.solicitud_perfil.last_name,
                    'email': notif.solicitud_perfil.email,
                    'language': notif.solicitud_perfil.language,
                    'avatar_url': notif.solicitud_perfil.avatar.url if notif.solicitud_perfil.avatar else None,
                    'old_first_name': notif.solicitud_perfil.old_first_name,
                    'old_last_name': notif.solicitud_perfil.old_last_name,
                    'old_email': notif.solicitud_perfil.old_email,
                    'old_language': notif.solicitud_perfil.old_language,
                } if notif.solicitud_perfil else None,
            })
        
        return JsonResponse({
            'success': True,
            'notifications': notifications_data,
            'unread_count': unread_count
        })
        
    except Exception as e:
        print(f"❌ Error obteniendo notificaciones: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e),
            'notifications': [],
            'unread_count': 0
        })


@login_required
@require_http_methods(["POST"])
def marcar_notificacion_leida_api(request, notificacion_id):
    """
    API para marcar una notificación específica como leída
    """
    try:
        from .models import Notificacion
        notificacion = get_object_or_404(
            Notificacion, 
            id=notificacion_id, 
            usuario_destinatario=request.user
        )
        
        notificacion.marcar_como_leida()
        
        return JsonResponse({
            'success': True,
            'message': 'Notificación marcada como leída'
        })
        
    except Exception as e:
        print(f"❌ Error marcando notificación como leída: {e}")
        return JsonResponse({
            'success': False,
            'error': 'Error al marcar notificación como leída'
        }, status=500)


@login_required
@require_http_methods(["POST"])
def marcar_todas_notificaciones_leidas_api(request):
    """
    API para marcar todas las notificaciones del usuario como leídas
    """
    try:
        from .models import Notificacion
        from django.utils import timezone
        import json
        
        filters = {'usuario_destinatario': request.user, 'leida': False}
        
        # Intentar leer filtros del body
        try:
            data = json.loads(request.body)
            if 'tarea_id' in data and data['tarea_id']:
                filters['tarea_id'] = data['tarea_id']
            if 'oportunidad_id' in data and data['oportunidad_id']:
                filters['oportunidad_id'] = data['oportunidad_id']
            if 'tarea_opp_id' in data and data['tarea_opp_id']:
                filters['tarea_opp_id'] = data['tarea_opp_id']
        except:
            pass

        # Marcar notificaciones filtradas
        notificaciones_no_leidas = Notificacion.objects.filter(**filters)
        
        count = notificaciones_no_leidas.update(
            leida=True,
            fecha_lectura=timezone.now()
        )
        
        return JsonResponse({
            'success': True,
            'message': f'{count} notificaciones marcadas como leídas',
            'count_marked': count
        })
        
    except Exception as e:
        print(f"❌ Error marcando todas las notificaciones como leídas: {e}")
        return JsonResponse({
            'success': False,
            'error': 'Error al marcar notificaciones como leídas'
        }, status=500)


@csrf_exempt
@login_required
def api_chat_oportunidad(request, opp_id):
    from .models import MensajeOportunidad
    opp = get_object_or_404(TodoItem, id=opp_id)

    import re as _re

    def serializar(m):
        u = m.usuario
        nombre = u.get_full_name() or u.username if u else 'Usuario'
        iniciales = ''.join([p[0].upper() for p in nombre.split()[:2]]) if nombre else '?'
        reply = None
        if m.reply_to:
            ru = m.reply_to.usuario
            rnombre = ru.get_full_name() or ru.username if ru else 'Usuario'
            reply = {
                'id': m.reply_to.id,
                'texto': m.reply_to.texto[:80],
                'nombre': rnombre,
                'tiene_imagen': bool(m.reply_to.imagen),
            }
        # Detectar y limpiar prefijo técnico de Bitrix
        texto = m.texto
        es_bitrix = False
        bitrix_tipo = None
        bitrix_match = _re.match(r'^\[BITRIX_(ACT|CMT):(\d+)\]\s*', texto)
        if bitrix_match:
            es_bitrix = True
            bitrix_tipo = 'actividad' if bitrix_match.group(1) == 'ACT' else 'comentario'
            texto = texto[bitrix_match.end():]
            # Comentarios de Bitrix: mostrar como mensaje normal del autor
        return {
            'id': m.id,
            'texto': texto,
            'imagen_url': f'/app/api/chat-media/{m.id}/' if m.imagen else None,
            'imagen_nombre': m.imagen.name.split('/')[-1] if m.imagen else None,
            'editado': m.editado,
            'reply_to': reply,
            'fecha': m.fecha.strftime('%d/%m/%Y %H:%M'),
            'usuario_id': u.id if u else None,
            'nombre': nombre,
            'iniciales': iniciales,
            'es_mio': (u.id == request.user.id) if u else False,
            'es_bitrix': es_bitrix,
            'bitrix_tipo': bitrix_tipo,
        }

    if request.method == 'GET':
        msgs = MensajeOportunidad.objects.filter(oportunidad=opp).select_related('usuario', 'reply_to', 'reply_to__usuario')
        return JsonResponse({'mensajes': [serializar(m) for m in msgs]})

    if request.method == 'POST':
        texto = (request.POST.get('texto') or '').strip()
        imagen = request.FILES.get('imagen')
        reply_to_id = request.POST.get('reply_to_id')
        if not texto and not imagen:
            return JsonResponse({'error': 'El mensaje no puede estar vacío'}, status=400)
        reply_obj = None
        if reply_to_id:
            try:
                reply_obj = MensajeOportunidad.objects.get(id=int(reply_to_id), oportunidad=opp)
            except MensajeOportunidad.DoesNotExist:
                pass
        m = MensajeOportunidad.objects.create(
            oportunidad=opp,
            usuario=request.user,
            texto=texto,
            imagen=imagen,
            reply_to=reply_obj,
        )

        remitente_nombre = request.user.get_full_name() or request.user.username
        preview = texto[:100] + ('…' if len(texto) > 100 else '') if texto else '📎 Archivo adjunto'

        # Notificar al dueño de la oportunidad si es distinto al que envió
        notificados = set()
        if opp.usuario and opp.usuario != request.user:
            crear_notificacion(
                usuario_destinatario=opp.usuario,
                tipo='oportunidad_mensaje',
                titulo=f'Mensaje en: {opp.oportunidad}',
                mensaje=f'{remitente_nombre}: {preview}',
                oportunidad=opp,
                usuario_remitente=request.user,
            )
            notificados.add(opp.usuario_id)

        # Notificar a usuarios etiquetados con @[Nombre] o @username
        if texto:
            import re
            from django.contrib.auth.models import User as _User

            def _buscar_mencionado(nombre):
                parts = nombre.strip().split()
                if len(parts) >= 2:
                    u = _User.objects.filter(
                        first_name__iexact=parts[0],
                        last_name__iexact=' '.join(parts[1:])
                    ).first()
                    if u:
                        return u
                return _User.objects.filter(username__iexact=nombre.strip()).first()

            mencionados = set()
            for nombre in re.findall(r'@\[([^\]]+)\]', texto):
                u = _buscar_mencionado(nombre)
                if u:
                    mencionados.add(u)
            for username in re.findall(r'@(\w+)', texto):
                try:
                    mencionados.add(_User.objects.get(username=username))
                except _User.DoesNotExist:
                    pass

            for mencionado in mencionados:
                if mencionado == request.user or mencionado.id in notificados:
                    continue
                crear_notificacion(
                    usuario_destinatario=mencionado,
                    tipo='oportunidad_mensaje',
                    titulo=f'Te mencionaron en: {opp.oportunidad}',
                    mensaje=f'{remitente_nombre}: {preview}',
                    oportunidad=opp,
                    usuario_remitente=request.user,
                )
                notificados.add(mencionado.id)

        return JsonResponse({'success': True, 'mensaje': serializar(m)})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@csrf_exempt
@login_required
def api_chat_mensaje(request, opp_id, msg_id):
    from .models import MensajeOportunidad
    opp = get_object_or_404(TodoItem, id=opp_id)
    msg = get_object_or_404(MensajeOportunidad, id=msg_id, oportunidad=opp)
    es_supervisor = request.user.groups.filter(name='Supervisores').exists() or request.user.is_superuser

    if request.method == 'PUT':
        if msg.usuario != request.user:
            return JsonResponse({'error': 'Sin permiso'}, status=403)
        try:
            data = json.loads(request.body)
        except Exception:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        nuevo = (data.get('texto') or '').strip()
        if not nuevo:
            return JsonResponse({'error': 'El texto no puede estar vacío'}, status=400)
        msg.texto = nuevo
        msg.editado = True
        msg.save()
        return JsonResponse({'success': True})

    if request.method == 'DELETE':
        if msg.usuario != request.user and not es_supervisor:
            return JsonResponse({'error': 'Sin permiso'}, status=403)
        if msg.imagen:
            msg.imagen.delete(save=False)
        msg.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_chat_media_file(request, msg_id):
    """Sirve el archivo adjunto de un mensaje de chat directamente desde Django.
    Bypassa el location /media/ de nginx (que apunta a un volumen Docker inaccesible)."""
    from .models import MensajeOportunidad
    from django.http import FileResponse, Http404
    msg = get_object_or_404(MensajeOportunidad, id=msg_id)
    if not msg.imagen:
        raise Http404
    try:
        f = msg.imagen.open('rb')
    except Exception:
        raise Http404
    content_type, _ = mimetypes.guess_type(msg.imagen.name)
    response = FileResponse(f, content_type=content_type or 'application/octet-stream')
    filename = msg.imagen.name.split('/')[-1]
    response['Content-Disposition'] = f'inline; filename="{filename}"'
    return response


@login_required
def intercambio_navidad(request):
    """Vista principal del intercambio navideño"""
    from datetime import datetime
    from .models import IntercambioNavidad, ParticipanteIntercambio
    
    # Obtener el intercambio del año actual
    año_actual = datetime.now().year
    intercambio = IntercambioNavidad.objects.filter(año=año_actual).first()
    
    # Variables para el template
    context = {
        'employees': User.objects.filter(is_active=True).order_by('first_name', 'last_name'),
        'sorteo_realizado': False,
        'persona_asignada': None,
        'fecha_intercambio': None,
    }
    
    # Si existe intercambio, obtener información
    if intercambio:
        context['intercambio'] = intercambio
        context['sorteo_realizado'] = intercambio.sorteo_realizado
        context['fecha_intercambio'] = intercambio.fecha_intercambio
        
        # Si el usuario no es superusuario y ya se realizó el sorteo
        if not request.user.is_superuser and intercambio.sorteo_realizado:
            # Buscar la asignación del usuario actual
            participante = ParticipanteIntercambio.objects.filter(
                intercambio=intercambio,
                usuario=request.user
            ).first()
            
            if participante and participante.regalo_para:
                context['persona_asignada'] = participante.regalo_para.get_full_name() or participante.regalo_para.username
    
    return render(request, 'intercambio_navidad.html', context)


@csrf_exempt
@login_required
def realizar_sorteo_navidad(request):
    """API para realizar el sorteo navideño (solo superusuarios)"""
    if not request.user.is_superuser:
        return JsonResponse({'error': 'No tienes permisos para realizar el sorteo'}, status=403)
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        import json
        import random
        from datetime import datetime
        from .models import IntercambioNavidad, ParticipanteIntercambio, HistorialIntercambio
        
        # Crear o obtener intercambio del año actual para verificar participantes
        año_actual = datetime.now().year
        intercambio = IntercambioNavidad.objects.filter(año=año_actual).first()
        
        if not intercambio:
            return JsonResponse({'error': 'No hay intercambio configurado para este año'}, status=400)
        
        # Obtener participantes existentes de la base de datos
        participantes_db = list(ParticipanteIntercambio.objects.filter(intercambio=intercambio))
        
        if len(participantes_db) < 2:
            return JsonResponse({'error': 'Se necesitan al menos 2 participantes'}, status=400)
        
        # Permitir repetir el sorteo (útil cuando se agregan más participantes)
        if intercambio.sorteo_realizado:
            # Solo mostrar una advertencia en consola, pero permitir continuar
            print(f"Repitiendo sorteo para intercambio {intercambio.año}")
        
        # Limpiar asignaciones anteriores (por si se vuelve a ejecutar)
        for participante in participantes_db:
            participante.regalo_para = None
            participante.save()
        
        # Los participantes ya están en la base de datos
        participantes = participantes_db
        
        # Realizar el algoritmo de sorteo (amigo invisible)
        usuarios = [p.usuario for p in participantes]
        usuarios_disponibles = usuarios.copy()
        
        # Mezclar para randomizar
        random.shuffle(usuarios_disponibles)
        
        asignaciones = []
        for i, participante in enumerate(participantes):
            # Filtrar usuarios disponibles (no puede regalarse a sí mismo)
            opciones = [u for u in usuarios_disponibles if u != participante.usuario]
            
            if not opciones:
                # Si no hay opciones, reiniciar el proceso
                return JsonResponse({'error': 'Error en el sorteo, intenta de nuevo'}, status=500)
            
            # Seleccionar usuario aleatorio
            usuario_asignado = random.choice(opciones)
            usuarios_disponibles.remove(usuario_asignado)
            
            # Guardar asignación
            participante.regalo_para = usuario_asignado
            participante.save()
            
            asignaciones.append({
                'participante': participante.usuario.get_full_name(),
                'regalo_para': usuario_asignado.get_full_name()
            })
        
        # Actualizar estado del intercambio
        intercambio.estado = 'sorteo_realizado'
        intercambio.fecha_sorteo = datetime.now()
        intercambio.save()
        
        # Registrar en historial
        HistorialIntercambio.objects.create(
            intercambio=intercambio,
            accion='sorteo_realizado',
            usuario=request.user,
            detalles={
                'total_participantes': len(participantes),
                'asignaciones': asignaciones
            }
        )
        
        return JsonResponse({
            'success': True,
            'message': 'Sorteo realizado exitosamente',
            'total_participantes': len(participantes),
            'intercambio_id': intercambio.id
        })
        
    except User.DoesNotExist:
        return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
    except Exception as e:
        print(f"Error en sorteo navideño: {e}")
        import traceback
        print(traceback.format_exc())
        return JsonResponse({'error': f'Error interno del servidor: {str(e)}'}, status=500)


@csrf_exempt
def agregar_participante_navidad(request):
    """Agregar participante al intercambio navideño"""
    import json
    from datetime import datetime
    from .models import IntercambioNavidad, ParticipanteIntercambio
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
        
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    try:
        data = json.loads(request.body)
        empleado_id = data.get('empleado_id')
        
        if not empleado_id:
            return JsonResponse({'error': 'ID de empleado requerido'}, status=400)
        
        # Obtener usuario
        empleado = User.objects.get(id=empleado_id)
        
        # Crear o obtener intercambio del año actual
        año_actual = datetime.now().year
        intercambio, created = IntercambioNavidad.objects.get_or_create(
            año=año_actual,
            defaults={
                'fecha_intercambio': datetime(año_actual, 12, 15).date(),
                'creado_por': request.user
            }
        )
        
        # Verificar si ya está participando
        if ParticipanteIntercambio.objects.filter(intercambio=intercambio, usuario=empleado).exists():
            return JsonResponse({'error': 'El empleado ya está participando'}, status=400)
        
        # Agregar participante
        participante = ParticipanteIntercambio.objects.create(
            intercambio=intercambio,
            usuario=empleado
        )
        
        return JsonResponse({
            'success': True,
            'participante': {
                'id': participante.id,
                'usuario': {
                    'id': empleado.id,
                    'first_name': empleado.first_name,
                    'last_name': empleado.last_name,
                    'username': empleado.username
                }
            }
        })
        
    except User.DoesNotExist:
        return JsonResponse({'error': 'Usuario no encontrado'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def eliminar_participante_navidad(request):
    """Eliminar participante del intercambio navideño"""
    import json
    from .models import ParticipanteIntercambio
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
        
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    try:
        data = json.loads(request.body)
        participante_id = data.get('participante_id')
        
        if not participante_id:
            return JsonResponse({'error': 'ID de participante requerido'}, status=400)
        
        # Eliminar participante
        participante = ParticipanteIntercambio.objects.get(id=participante_id)
        participante.delete()
        
        return JsonResponse({'success': True})
        
    except ParticipanteIntercambio.DoesNotExist:
        return JsonResponse({'error': 'Participante no encontrado'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def listar_participantes_navidad(request):
    """Listar participantes del intercambio navideño"""
    from datetime import datetime
    from .models import IntercambioNavidad, ParticipanteIntercambio
    
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        año_actual = datetime.now().year
        intercambio = IntercambioNavidad.objects.filter(año=año_actual).first()
        
        if not intercambio:
            return JsonResponse({'participantes': []})
        
        participantes = ParticipanteIntercambio.objects.filter(intercambio=intercambio)
        
        data = []
        for participante in participantes:
            regalo_para = None
            if participante.regalo_para:
                regalo_para = {
                    'id': participante.regalo_para.id,
                    'first_name': participante.regalo_para.first_name,
                    'last_name': participante.regalo_para.last_name,
                    'username': participante.regalo_para.username
                }
            
            data.append({
                'id': participante.id,
                'usuario': {
                    'id': participante.usuario.id,
                    'first_name': participante.usuario.first_name,
                    'last_name': participante.usuario.last_name,
                    'username': participante.usuario.username
                },
                'regalo_para': regalo_para
            })
        
        return JsonResponse({'participantes': data})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
def actualizar_evento_navidad(request):
    """Actualizar configuración del evento navideño"""
    import json
    from datetime import datetime
    from .models import IntercambioNavidad
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
        
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    try:
        data = json.loads(request.body)
        fecha_intercambio_str = data.get('fecha_intercambio')
        monto_sugerido = data.get('monto_sugerido', 500)
        descripcion = data.get('descripcion', '')
        
        if not fecha_intercambio_str:
            return JsonResponse({'error': 'Fecha del intercambio es requerida'}, status=400)
        
        # Convertir la fecha string a objeto date
        try:
            from datetime import datetime as dt
            fecha_intercambio = dt.strptime(fecha_intercambio_str, '%Y-%m-%d').date()
        except ValueError:
            return JsonResponse({'error': 'Formato de fecha inválido'}, status=400)
        
        # Crear o obtener intercambio del año actual
        año_actual = datetime.now().year
        intercambio, created = IntercambioNavidad.objects.get_or_create(
            año=año_actual,
            defaults={
                'fecha_intercambio': fecha_intercambio,
                'monto_sugerido': monto_sugerido,
                'descripcion': descripcion,
                'creado_por': request.user
            }
        )
        
        # Si ya existe, actualizar los valores
        if not created:
            intercambio.fecha_intercambio = fecha_intercambio
            intercambio.monto_sugerido = monto_sugerido
            intercambio.descripcion = descripcion
            intercambio.save()
        
        return JsonResponse({
            'success': True,
            'intercambio': {
                'id': intercambio.id,
                'fecha_intercambio': intercambio.fecha_intercambio.strftime('%Y-%m-%d'),
                'monto_sugerido': intercambio.monto_sugerido,
                'descripcion': intercambio.descripcion
            }
        })
        
    except Exception as e:
        print(f"Error en actualizar_evento_navidad: {e}")
        import traceback
        print(traceback.format_exc())
        return JsonResponse({'error': f'Error interno del servidor: {str(e)}'}, status=500)


@csrf_exempt
def estado_usuario_navidad(request):
    """Obtener estado del usuario en el intercambio navideño"""
    from datetime import datetime
    from .models import IntercambioNavidad, ParticipanteIntercambio
    
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        año_actual = datetime.now().year
        intercambio = IntercambioNavidad.objects.filter(año=año_actual).first()
        
        if not intercambio:
            return JsonResponse({
                'participa': False,
                'sorteo_realizado': False,
                'regalo_para': None,
                'monto_sugerido': 500,
                'fecha_intercambio': None
            })
        
        # Buscar si el usuario participa
        participante = ParticipanteIntercambio.objects.filter(
            intercambio=intercambio,
            usuario=request.user
        ).first()
        
        if not participante:
            return JsonResponse({
                'participa': False,
                'sorteo_realizado': intercambio.sorteo_realizado,
                'regalo_para': None,
                'monto_sugerido': float(intercambio.monto_sugerido) if intercambio.monto_sugerido else 500,
                'fecha_intercambio': intercambio.fecha_intercambio.strftime('%d de %B') if intercambio.fecha_intercambio else None
            })
        
        # El usuario participa
        regalo_para_data = None
        if participante.regalo_para:
            regalo_para_data = {
                'id': participante.regalo_para.id,
                'first_name': participante.regalo_para.first_name,
                'last_name': participante.regalo_para.last_name,
                'username': participante.regalo_para.username
            }
        
        return JsonResponse({
            'participa': True,
            'sorteo_realizado': intercambio.sorteo_realizado,
            'regalo_para': regalo_para_data,
            'monto_sugerido': float(intercambio.monto_sugerido) if intercambio.monto_sugerido else 500,
            'fecha_intercambio': intercambio.fecha_intercambio.strftime('%d de %B') if intercambio.fecha_intercambio else None
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_muro_posts(request):
    """GET lista de posts / POST crear post."""
    if request.method == 'GET':
        filtro = request.GET.get('filtro', 'todos')
        ahora = timezone.now()
        qs = PostMuro.objects.prefetch_related('likes', 'etiquetados', 'comentarios').select_related('autor').filter(
            Q(programado_para__isnull=True) | Q(programado_para__lte=ahora)
        )
        if filtro == 'anuncios':
            qs = qs.filter(es_anuncio=True)
        elif filtro == 'mios':
            qs = qs.filter(autor=request.user)
        posts = [_muro_post_dict(p, request.user) for p in qs]
        return JsonResponse({'success': True, 'posts': posts})

    if request.method == 'POST':
        contenido = ''
        imagen = None
        etiquetados_ids = []
        es_anuncio = False
        programado_para = None

        if request.content_type and 'multipart' in request.content_type:
            contenido = request.POST.get('contenido', '').strip()
            etiquetados_raw = request.POST.get('etiquetados', '[]')
            try:
                etiquetados_ids = json.loads(etiquetados_raw)
            except Exception:
                etiquetados_ids = []
            es_anuncio = request.POST.get('es_anuncio', 'false') == 'true'
            programado_str = request.POST.get('programado_para', '').strip()
            if programado_str:
                try:
                    from dateutil.parser import parse as parse_dt
                    programado_para = timezone.make_aware(parse_dt(programado_str).replace(tzinfo=None))
                except Exception:
                    programado_para = None
            imagen = request.FILES.get('imagen')
        else:
            data = json.loads(request.body)
            contenido = data.get('contenido', '').strip()
            etiquetados_ids = data.get('etiquetados', [])
            es_anuncio = data.get('es_anuncio', False)
            programado_str = data.get('programado_para', '').strip() if data.get('programado_para') else ''
            if programado_str:
                try:
                    from dateutil.parser import parse as parse_dt
                    programado_para = timezone.make_aware(parse_dt(programado_str).replace(tzinfo=None))
                except Exception:
                    programado_para = None

        if not contenido and not imagen:
            return JsonResponse({'success': False, 'error': 'El contenido no puede estar vacío'}, status=400)

        # Solo supervisores pueden publicar anuncios o programar posts
        if es_anuncio and not is_supervisor(request.user):
            es_anuncio = False
        if programado_para and not is_supervisor(request.user):
            programado_para = None

        post = PostMuro.objects.create(
            autor=request.user,
            contenido=contenido,
            imagen=imagen,
            es_anuncio=es_anuncio,
            programado_para=programado_para,
        )
        if etiquetados_ids:
            usuarios_etiq = User.objects.filter(pk__in=etiquetados_ids)
            post.etiquetados.set(usuarios_etiq)
            # Notificar a etiquetados
            remitente_nombre = request.user.get_full_name() or request.user.username
            for u in usuarios_etiq:
                crear_notificacion(
                    usuario_destinatario=u,
                    tipo='muro_mencion',
                    titulo=f'{remitente_nombre} te etiquetó en el muro',
                    mensaje=contenido[:120],
                    usuario_remitente=request.user,
                )

        if es_anuncio:
            # Notificar a todos los usuarios del sistema
            todos = User.objects.filter(is_active=True).exclude(pk=request.user.pk)
            remitente_nombre = request.user.get_full_name() or request.user.username
            for u in todos:
                crear_notificacion(
                    usuario_destinatario=u,
                    tipo='muro_post',
                    titulo=f'Anuncio de {remitente_nombre}',
                    mensaje=contenido[:120],
                    usuario_remitente=request.user,
                )

        return JsonResponse({'success': True, 'post': _muro_post_dict(post, request.user)})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_muro_post_detail(request, post_id):
    """PUT editar / DELETE eliminar un post del muro."""
    post = get_object_or_404(PostMuro, pk=post_id)

    if post.autor != request.user and not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permiso'}, status=403)

    if request.method == 'PUT':
        data = json.loads(request.body)
        contenido = data.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'success': False, 'error': 'Contenido vacío'}, status=400)
        post.contenido = contenido
        post.editado = True
        post.save()
        return JsonResponse({'success': True, 'post': _muro_post_dict(post, request.user)})

    if request.method == 'DELETE':
        post.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_muro_like(request, post_id):
    """POST toggle like en un post."""
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    post = get_object_or_404(PostMuro, pk=post_id)
    if post.likes.filter(pk=request.user.pk).exists():
        post.likes.remove(request.user)
        yo_like = False
    else:
        post.likes.add(request.user)
        yo_like = True
    return JsonResponse({'success': True, 'num_likes': post.likes.count(), 'yo_like': yo_like})


@login_required
def api_muro_comentarios(request, post_id):
    """GET lista de comentarios / POST crear comentario."""
    post = get_object_or_404(PostMuro, pk=post_id)

    if request.method == 'GET':
        comentarios = []
        for c in post.comentarios.select_related('autor').all():
            autor = c.autor
            profile = getattr(autor, 'userprofile', None)
            avatar_url = profile.get_avatar_url() if profile else None
            iniciales = profile.iniciales() if profile else (autor.first_name[:1] + autor.last_name[:1]).upper() if autor.first_name else autor.username[:2].upper()
            comentarios.append({
                'id': c.id,
                'autor_id': autor.id,
                'autor_nombre': autor.get_full_name() or autor.username,
                'autor_avatar': avatar_url,
                'autor_iniciales': iniciales,
                'contenido': c.contenido,
                'fecha': c.fecha_creacion.strftime('%d %b %Y %H:%M'),
                'editado': c.editado,
                'es_autor': c.autor_id == request.user.pk,
            })
        return JsonResponse({'success': True, 'comentarios': comentarios})

    if request.method == 'POST':
        data = json.loads(request.body)
        contenido = data.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'success': False, 'error': 'Contenido vacío'}, status=400)
        comentario = ComentarioMuro.objects.create(
            post=post,
            autor=request.user,
            contenido=contenido,
        )
        # Notificar al autor del post si es distinto
        if post.autor != request.user:
            remitente_nombre = request.user.get_full_name() or request.user.username
            crear_notificacion(
                usuario_destinatario=post.autor,
                tipo='muro_mencion',
                titulo=f'{remitente_nombre} comentó tu post',
                mensaje=contenido[:120],
                usuario_remitente=request.user,
            )
        autor = comentario.autor
        profile = getattr(autor, 'userprofile', None)
        avatar_url = profile.get_avatar_url() if profile else None
        iniciales = profile.iniciales() if profile else (autor.first_name[:1] + autor.last_name[:1]).upper() if autor.first_name else autor.username[:2].upper()
        return JsonResponse({
            'success': True,
            'comentario': {
                'id': comentario.id,
                'autor_id': autor.id,
                'autor_nombre': autor.get_full_name() or autor.username,
                'autor_avatar': avatar_url,
                'autor_iniciales': iniciales,
                'contenido': comentario.contenido,
                'fecha': comentario.fecha_creacion.strftime('%d %b %Y %H:%M'),
                'editado': False,
                'es_autor': True,
            }
        })

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_muro_comentario_detail(request, comentario_id):
    """PUT editar / DELETE eliminar un comentario del muro."""
    comentario = get_object_or_404(ComentarioMuro, pk=comentario_id)

    if comentario.autor != request.user and not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permiso'}, status=403)

    if request.method == 'PUT':
        data = json.loads(request.body)
        contenido = data.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'success': False, 'error': 'Contenido vacío'}, status=400)
        comentario.contenido = contenido
        comentario.editado = True
        comentario.save()
        return JsonResponse({'success': True})

    if request.method == 'DELETE':
        comentario.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
@csrf_exempt
def api_jornada_estado(request):
    """Retorna el estado actual de la jornada del usuario."""
    hoy = timezone.localdate()
    # Buscar jornada de hoy que no haya terminado o la más reciente terminada hoy
    jornada = AsistenciaJornada.objects.filter(usuario=request.user, fecha=hoy).first()
    
    if not jornada:
        return JsonResponse({'activo': False})
    
    # Calcular segundos laborados acumulados
    segundos = jornada.segundos_laborados
    if not jornada.pausado and not jornada.hora_fin:
        # Si está activo, sumar el tramo actual
        delta = timezone.now() - jornada.hora_inicio
        segundos += int(delta.total_seconds())

    return JsonResponse({
        'activo': True,
        'inicio': jornada.hora_inicio.isoformat() if jornada.hora_inicio else None,
        'fin': jornada.hora_fin.isoformat() if jornada.hora_fin else None,
        'pausado': jornada.pausado,
        'segundos': segundos,
        'eficiencia': float(jornada.eficiencia_dia)
    })


@login_required
@csrf_exempt
def api_jornada_iniciar(request):
    """Inicia la jornada laboral si no existe una hoy."""
    hoy = timezone.localdate()
    jornada, created = AsistenciaJornada.objects.get_or_create(
        usuario=request.user, 
        fecha=hoy,
        defaults={'hora_inicio': timezone.now()}
    )
    # Si ya existía y estaba terminada, podemos decidir si reabrirla o no.
    # Por ahora permitimos re-iniciar si estaba terminada hoy.
    if not created and jornada.hora_fin:
        jornada.hora_fin = None
        jornada.hora_inicio = timezone.now()
        jornada.save()

    return JsonResponse({'success': True, 'jornada_id': jornada.id})


@login_required
@csrf_exempt
def api_jornada_pausar(request):
    """Alterna el estado de pausa de la jornada laboral."""
    hoy = timezone.localdate()
    jornada = AsistenciaJornada.objects.filter(usuario=request.user, fecha=hoy, hora_fin__isnull=True).first()
    if not jornada:
        return JsonResponse({'error': 'No hay jornada activa'}, status=400)
    
    ahora = timezone.now()
    if not jornada.pausado:
        # Pausar: guardar segundos del tramo que termina ahora
        delta = ahora - jornada.hora_inicio
        jornada.segundos_laborados += int(delta.total_seconds())
        jornada.pausado = True
        jornada.ultima_pausa = ahora
    else:
        # Reanudar: actualizar hora_inicio para el nuevo tramo activo
        jornada.pausado = False
        jornada.hora_inicio = ahora
        if jornada.ultima_pausa:
            delta_p = ahora - jornada.ultima_pausa
            jornada.segundos_pausa += int(delta_p.total_seconds())
    
    jornada.save()
    return JsonResponse({'success': True, 'pausado': jornada.pausado})


@login_required
@require_http_methods(["POST"])
@csrf_exempt
def api_jornada_terminar(request):
    """Termina la jornada laboral y calcula la eficiencia del día."""
    hoy = timezone.localdate()
    jornada = AsistenciaJornada.objects.filter(usuario=request.user, fecha=hoy, hora_fin__isnull=True).first()
    if not jornada:
        return JsonResponse({'error': 'No hay jornada activa que terminar'}, status=400)
    
    ahora = timezone.now()
    if not jornada.pausado:
        delta = ahora - jornada.hora_inicio
        jornada.segundos_laborados += int(delta.total_seconds())
    
    jornada.hora_fin = ahora
    
    # --- CÁLCULO DE EFICIENCIA (Algoritmo solicitado) ---
    # Prioridades: 1. Tareas, 2. Actividades, 3. Ventas cobradas
    
    # Tareas (Highest Priority)
    tareas = Tarea.objects.filter(asignado_a=request.user).exclude(estado='cancelada')
    # Tareas que vencen hoy o fueron completadas hoy
    tareas_totales = tareas.filter(Q(fecha_limite__date=hoy) | Q(estado='completada', fecha_completada__date=hoy)).count()
    tareas_completadas_hoy = tareas.filter(estado='completada', fecha_completada__date=hoy).count()
    tareas_vencidas = tareas.filter(fecha_limite__lt=ahora).exclude(estado='completada').count()
    
    # Actividades / Tareas de Oportunidad (Medium Priority)
    acts = TareaOportunidad.objects.filter(responsable=request.user)
    # Como TareaOportunidad no tiene fecha_completada, usamos la lógica de estado y fecha_limite
    act_totales = acts.filter(Q(fecha_limite__date=hoy) | Q(estado='completada', fecha_limite__date=hoy)).count()
    act_completadas_hoy = acts.filter(estado='completada', fecha_limite__date=hoy).count()
    act_vencidas = acts.filter(fecha_limite__lt=ahora, estado='pendiente').count()
    
    # Oportunidades Cobradas (High Impact / Bonus)
    # Nota: TodoItem SI tiene fecha_actualizacion
    opps_cobradas_hoy = TodoItem.objects.filter(usuario=request.user, estado_crm='pagada', fecha_actualizacion__date=hoy).count()

    # Cálculo por puntos:
    puntos_obtenidos = 0
    puntos_posibles = 0
    
    if tareas_totales > 0:
        puntos_posibles += (tareas_totales * 10)
        puntos_obtenidos += (tareas_completadas_hoy * 10)
        puntos_obtenidos -= (tareas_vencidas * 5) # Penalización
        
    if act_totales > 0:
        puntos_posibles += (act_totales * 6)
        puntos_obtenidos += (act_completadas_hoy * 6)
        puntos_obtenidos -= (act_vencidas * 3) # Penalización
    
    # Bonus por cada venta cerrada hoy
    puntos_obtenidos += (opps_cobradas_hoy * 20)
    
    eficiencia = 0
    if puntos_posibles > 0:
        eficiencia = (puntos_obtenidos / puntos_posibles) * 100
    elif opps_cobradas_hoy > 0:
        eficiencia = 100
    
    # Limitar entre 0 y 100
    eficiencia = max(0, min(100, eficiencia))
    
    jornada.eficiencia_dia = Decimal(str(round(eficiencia, 2)))
    jornada.save()
    
    # Actualizar registro mensual
    em, created = EficienciaMensual.objects.get_or_create(
        usuario=request.user, 
        mes=hoy.month, 
        anio=hoy.year,
        defaults={'promedio_eficiencia': eficiencia}
    )
    
    # Recalcular promedio mensual basado en todas las jornadas del mes
    jornadas_mes = AsistenciaJornada.objects.filter(
        usuario=request.user, 
        fecha__month=hoy.month, 
        fecha__year=hoy.year, 
        hora_fin__isnull=False
    )
    stats_mes = jornadas_mes.aggregate(avg_ef=models.Avg('eficiencia_dia'))
    em.promedio_eficiencia = stats_mes['avg_ef'] or eficiencia
    
    # Acumular hitos
    em.tareas_completadas += tareas_completadas_hoy
    em.actividades_completadas += act_completadas_hoy
    em.oportunidades_cobradas += opps_cobradas_hoy
    em.save()

    # --- NOTIFICACIÓN PARA ADMINISTRADORES (Nivel de Alerta) ---
    horas_totales = jornada.segundos_laborados / 3600
    if eficiencia < 80 or horas_totales < 9:
        admins = User.objects.filter(is_superuser=True)
        nombre_usuario = request.user.get_full_name() or request.user.username
        
        razones = []
        if eficiencia < 80:
            razones.append(f"Eficiencia baja ({round(eficiencia, 1)}%)")
        if horas_totales < 9:
            razones.append(f"Jornada incompleta ({round(horas_totales, 1)} horas)")
        
        # Detalle estructurado para el administrador
        mensaje_html = f"<div class='notif-alerta-rendimiento'>"
        mensaje_html += f"<p style='margin:0 0 8px;'><b>Alertas:</b> {', '.join(razones)}</p>"
        
        tareas_pendientes = tareas.exclude(estado='completada').order_by('fecha_limite')[:4]
        if tareas_pendientes:
            mensaje_html += "<div style='background:rgba(0,0,0,0.03); border-radius:8px; padding:8px; margin-bottom:8px;'>"
            mensaje_html += "<b style='font-size:0.75rem; color:#4B5563; text-transform:uppercase;'>Tareas no completadas:</b>"
            mensaje_html += "<ul style='margin:5px 0 0; padding-left:15px; font-size:0.8rem;'>"
            for t in tareas_pendientes:
                fecha_venc = t.fecha_limite.strftime('%d/%m/%Y') if t.fecha_limite else "Sin fecha"
                mensaje_html += f"<li style='margin-bottom:4px;'><a href='#' onclick='event.stopPropagation(); window.crmTaskVerDetalle({t.id})' style='color:#007AFF; text-decoration:none; font-weight:600;'>{t.titulo}</a> <span style='color:#EF4444; font-size:0.7rem;'>(Venció: {fecha_venc})</span></li>"
            mensaje_html += "</ul></div>"
            
        acts_pendientes = acts.exclude(estado='completada').order_by('fecha_limite')[:4]
        if acts_pendientes:
            mensaje_html += "<div style='background:rgba(0,122,255,0.03); border-radius:8px; padding:8px;'>"
            mensaje_html += "<b style='font-size:0.75rem; color:#4B5563; text-transform:uppercase;'>Actividades en Oportunidades:</b>"
            mensaje_html += "<ul style='margin:5px 0 0; padding-left:15px; font-size:0.8rem;'>"
            for a in acts_pendientes:
                fecha_venc = a.fecha_limite.strftime('%d/%m/%Y') if a.fecha_limite else "Sin fecha"
                opp_id = a.oportunidad.id
                mensaje_html += f"<li style='margin-bottom:4px;'><a href='#' onclick='event.stopPropagation(); window.openDetalle({opp_id})' style='color:#007AFF; text-decoration:none; font-weight:600;'>{a.titulo}</a> <span style='color:#EF4444; font-size:0.7rem;'>(Venció: {fecha_venc})</span></li>"
            mensaje_html += "</ul></div>"
        
        mensaje_html += "</div>"

        for admin in admins:
            Notificacion.objects.create(
                usuario_destinatario=admin,
                usuario_remitente=request.user,
                tipo='rendimiento_bajo',
                titulo=f"Alerta Rendimiento: {nombre_usuario}",
                mensaje=mensaje_html
            )

    return JsonResponse({
        'success': True, 
        'eficiencia': float(jornada.eficiencia_dia),
        'segundos': jornada.segundos_laborados
    })


@login_required
def api_verificar_empleado_mes(request):
    """
    Verifica si ha concluido el mes previo y publica al ganador en el muro.
    Configurado para iniciar el 1 de Abril de 2026 a las 8:00 AM (Tijuana).
    """
    ahora = timezone.now()
    ahora_tj = convert_to_tijuana_time(ahora)
    
    # 1. Bloqueo hasta el inicio oficial: 1 de Abril 2026, 8 AM Tijuana
    inicio_oficial = datetime(2026, 4, 1, 8, 0, 0, tzinfo=ZoneInfo("America/Tijuana"))
    if ahora_tj < inicio_oficial:
        return JsonResponse({
            'status': 'scheduled', 
            'message': 'El primer anuncio oficial está programado para el 1 de Abril a las 8:00 AM (Tijuana).'
        })

    # 2. Regla de publicación mensual: Solo el día 1, a partir de las 8:00 AM
    if ahora_tj.day != 1:
        return JsonResponse({'status': 'not_ready', 'message': 'Las publicaciones automáticas ocurren el día 1 de cada mes.'})
        
    if ahora_tj.hour < 8:
        return JsonResponse({'status': 'too_morning', 'message': 'El anuncio se publicará hoy a las 8:00 AM.'})

    # Revisar mes anterior (ej: si es 1 de Abril, revisa Marzo)
    mes_target_date = ahora - relativedelta(months=1)
    m = mes_target_date.month
    y = mes_target_date.year
    
    # Si ya se publicó este mes, salir
    if EficienciaMensual.objects.filter(mes=m, anio=y, anuncio_publicado=True).exists():
        return JsonResponse({'status': 'period_already_announced'})
    
    # Obtener el mejor del mes pasado
    ganador_em = EficienciaMensual.objects.filter(mes=m, anio=y).order_by('-promedio_eficiencia').first()
    
    if ganador_em and ganador_em.promedio_eficiencia > 0:
        ganador_em.empleado_del_mes = True
        ganador_em.anuncio_publicado = True
        ganador_em.save()
        
        # Muro Post (Anuncio automático)
        nombre_ganador = ganador_em.usuario.get_full_name() or ganador_em.usuario.username
        MESES_ES = {1:'Enero',2:'Febrero',3:'Marzo',4:'Abril',5:'Mayo',6:'Junio',
                    7:'Julio',8:'Agosto',9:'Septiembre',10:'Octubre',11:'Noviembre',12:'Diciembre'}
        mes_nombre = f"{MESES_ES.get(m, str(m))} {y}"

        mensaje = f"¡Es un honor anunciar que <b>@{ganador_em.usuario.username} ({nombre_ganador})</b> ha sido seleccionado como el empleado del mes de <b>{mes_nombre}</b>! 🎉\n\n"
        mensaje += f"Su compromiso ha sido pieza clave en nuestro éxito:\n\n"
        mensaje += f"✨ <b>Eficiencia General:</b> {ganador_em.promedio_eficiencia}%\n"
        mensaje += f"✅ <b>Tareas resueltas:</b> {ganador_em.tareas_completadas}\n"
        mensaje += f"🛠 <b>Actividades finalizadas:</b> {ganador_em.actividades_completadas}\n"
        mensaje += f"💰 <b>Ventas cobradas:</b> {ganador_em.oportunidades_cobradas}\n\n"
        mensaje += f"¡Gracias por dar siempre el 100%! 🚀🔥"

        # El autor es el ganador para que su avatar aparezca en el post
        ganador_profile = getattr(ganador_em.usuario, 'userprofile', None)
        foto_ganador = ganador_profile.avatar if ganador_profile and ganador_profile.avatar else None

        PostMuro.objects.create(
            autor=ganador_em.usuario,
            contenido=mensaje,
            es_anuncio=True,
            imagen=foto_ganador
        )
        return JsonResponse({'status': 'announced', 'winner': ganador_em.usuario.username})
    
    return JsonResponse({'status': 'no_eligible_data'})

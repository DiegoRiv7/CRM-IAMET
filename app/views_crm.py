# ══════════════════════════════════════════════════════════════════════
# views_crm.py — ARCHIVO LEGACY (congelado desde 2026-06-04)
#
# ~6,488 líneas mezclando oportunidades, cotizaciones, clientes,
# dashboard, reportes, admin. Marcado como LEGACY por Boy Scout Rule.
#
# NO agregar endpoints nuevos aquí. Para vistas nuevas del CRM:
#   → app/views_v2/crm_v2.py
#
# Modificar SOLO para bugs críticos. Ver app/views_v2/README.md y
# ESTRUCTURA.md (sección "Boy Scout Rule").
# ══════════════════════════════════════════════════════════════════════

# ----------------------------------------------------------------------
# views_crm.py — CRM home and oportunidades management.
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
from .models import TodoItem, Cliente, ClientePotencial, Cotizacion, DetalleCotizacion, UserProfile, Contacto, PendingFileUpload, OportunidadProyecto, Volumetria, DetalleVolumetria, CatalogoCableado, OportunidadActividad, OportunidadComentario, OportunidadArchivo, OportunidadEstado, Notificacion, Proyecto, ProyectoComentario, ProyectoArchivo, Tarea, TareaComentario, TareaArchivo, Actividad, CarpetaProyecto, ArchivoProyecto, CompartirArchivo, IntercambioNavidad, ParticipanteIntercambio, HistorialIntercambio, SolicitudAccesoProyecto, ArchivoFacturacion, ArchivoCobrado, AliasCliente, CarpetaOportunidad, ArchivoOportunidad, MensajeOportunidad, TareaOportunidad, ComentarioTareaOpp, PostMuro, ComentarioMuro, ProductoOportunidad, AsistenciaJornada, EficienciaMensual, SolicitudCambioPerfil, ProgramacionActividad, NovedadesConfig, EtapaPipeline
from . import views_exportar
from .views_tarea_comentarios import api_comentarios_tarea, api_agregar_comentario_tarea, api_editar_comentario_tarea, api_eliminar_comentario_tarea
from .forms import VentaForm, VentaFilterForm, CotizacionForm, ClienteForm, OportunidadModalForm, NuevaOportunidadForm
from django.db.models import Sum, Count, F, Q, Case, When, Value, Min
from django.db.models.functions import Upper, Coalesce
from django.db.models import Value
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from django.utils import timezone
from decimal import Decimal
import decimal
from django.utils.html import json_script

# Helper function to detect lost opportunities
from .views_utils import *
from .views_grupos import get_usuarios_visibles_ids, get_clientes_visibles_q

logger = logging.getLogger(__name__)


def _get_etapas_pipeline_json():
    """Retorna JSON con etapas agrupadas por pipeline y lista de pipelines."""
    import json as _json
    from .models import EtapaPipeline
    etapas = EtapaPipeline.objects.filter(activo=True).order_by('pipeline', 'orden')
    result = {}
    for e in etapas:
        if e.pipeline not in result:
            result[e.pipeline] = []
        result[e.pipeline].append({'nombre': e.nombre, 'color': e.color})
    return _json.dumps(result, ensure_ascii=False)


@login_required
def get_oportunidades_por_cliente(request):
    cliente_id = request.GET.get('cliente_id')
    oportunidad_inicial_id = request.GET.get('oportunidad_inicial_id')  # Nueva línea para oportunidad específica
    
    logger.debug(f"DEBUG: get_oportunidades_por_cliente - cliente_id: {cliente_id}, oportunidad_inicial_id: {oportunidad_inicial_id}")

    if is_supervisor(request.user):
        if cliente_id:
            # Solo las 10 oportunidades más recientes del cliente para supervisores
            oportunidades = TodoItem.objects.filter(cliente_id=cliente_id).order_by('-fecha_creacion')[:10]
        else:
            # If no client_id, return the 20 most recent opportunities for supervisors
            oportunidades = TodoItem.objects.all().order_by('-fecha_creacion')[:20]
    else:
        ids_visibles = get_usuarios_visibles_ids(request.user)
        if ids_visibles and len(ids_visibles) > 1:
            user_filter = Q(usuario_id__in=ids_visibles)
        else:
            user_filter = Q(usuario=request.user)
        if cliente_id:
            oportunidades = TodoItem.objects.filter(Q(cliente_id=cliente_id) & user_filter).order_by('-fecha_creacion')[:10]
        else:
            oportunidades = TodoItem.objects.filter(user_filter).order_by('-fecha_creacion')[:20]

    # Si hay una oportunidad inicial específica, asegurar que esté incluida
    if oportunidad_inicial_id:
        try:
            # Limpiar el ID eliminando comas y espacios
            clean_id = oportunidad_inicial_id.replace(',', '').replace(' ', '').strip()
            logger.debug(f"DEBUG: Buscando oportunidad inicial con ID: {clean_id}")
            oportunidad_inicial = TodoItem.objects.get(id=int(clean_id))
            logger.debug(f"DEBUG: Oportunidad inicial encontrada: {oportunidad_inicial.oportunidad}")
            
            # Convertir queryset a lista para manipulación
            oportunidades_list = list(oportunidades)
            oportunidades_ids = [op.id for op in oportunidades_list]
            
            # Verificar si ya está en la lista por ID
            if oportunidad_inicial.id not in oportunidades_ids:
                logger.debug(f"DEBUG: Oportunidad inicial NO estaba en la lista, agregándola al principio")
                # Agregar la oportunidad específica al principio de la lista
                oportunidades_list.insert(0, oportunidad_inicial)
                oportunidades = oportunidades_list
            else:
                logger.debug(f"DEBUG: Oportunidad inicial YA estaba en la lista")
                # Moverla al principio si ya estaba presente
                oportunidades_list = [op for op in oportunidades_list if op.id != oportunidad_inicial.id]
                oportunidades_list.insert(0, oportunidad_inicial)
                oportunidades = oportunidades_list
        except (TodoItem.DoesNotExist, ValueError, TypeError) as e:
            logger.debug(f"DEBUG: Error procesando oportunidad inicial {oportunidad_inicial_id}: {e}")
            pass  # Si no existe o hay error de conversión, continuar con la lista normal

    data = [{'id': op.id, 'nombre': op.oportunidad} for op in oportunidades]

    return JsonResponse(data, safe=False)


@login_required
def get_bitrix_contacts_api(request):
    query = request.GET.get('query', '')
    company_id = request.GET.get('company_id', None)

    contacts = get_all_bitrix_contacts(request=request, company_id=company_id)

    # Filter contacts by query if provided
    if query:
        contacts = [c for c in contacts if query.lower() in (c.get('NAME', '') + ' ' + c.get('LAST_NAME', '')).lower()]

    data = []
    for contact in contacts:
        full_name = f"{contact.get('NAME', '')} {contact.get('LAST_NAME', '')}".strip()
        data.append({
            'ID': contact['ID'],
            'NAME': full_name,
            'COMPANY_ID': contact.get('COMPANY_ID'),
        })
    return JsonResponse(data, safe=False)


def _get_empleado_mes_data():
    """Obtiene datos del empleado del mes más reciente para el widget."""
    try:
        ganador = EficienciaMensual.objects.filter(
            empleado_del_mes=True
        ).order_by('-anio', '-mes').first()
        if not ganador:
            return None

        from datetime import date
        MESES_ES = {1:'Enero',2:'Febrero',3:'Marzo',4:'Abril',5:'Mayo',6:'Junio',
                    7:'Julio',8:'Agosto',9:'Septiembre',10:'Octubre',11:'Noviembre',12:'Diciembre'}

        user = ganador.usuario
        nombre = user.get_full_name() or user.username
        initials = ''.join(w[0].upper() for w in nombre.split() if w)[:2]
        profile = getattr(user, 'userprofile', None)
        avatar_url = profile.get_avatar_url() if profile and hasattr(profile, 'get_avatar_url') else ''

        return {
            'nombre': nombre,
            'username': f'@{user.username}',
            'initials': initials,
            'avatar_url': avatar_url,
            'eficiencia': int(ganador.promedio_eficiencia),
            'tareas': ganador.tareas_completadas,
            'cobradas': ganador.oportunidades_cobradas,
            'mes_nombre': f"{MESES_ES.get(int(ganador.mes), str(ganador.mes))} {ganador.anio}",
        }
    except Exception:
        return None


def _calcular_total_desglose(mes, anio):
    """Calcula el total facturado sumando datos_json — misma lógica que api_desglose_facturacion.
    mes puede ser 'todos', un valor único ('04'), o comma-separated ('04,03').
    """
    total = Decimal('0')
    try:
        if mes == 'todos' or mes is None:
            afs = list(ArchivoFacturacion.objects.filter(anio=anio))
        elif ',' in str(mes):
            meses = [m.strip().zfill(2) for m in str(mes).split(',') if m.strip()]
            afs = list(ArchivoFacturacion.objects.filter(mes__in=meses, anio=anio))
        else:
            afs = [ArchivoFacturacion.objects.get(mes=mes, anio=anio)]
    except ArchivoFacturacion.DoesNotExist:
        return total
    for af in afs:
        raw = af.datos_json or {}
        for key, val in raw.items():
            if key == 'datos':
                continue
            try:
                if isinstance(val, dict) and 'monto' in val:
                    total += Decimal(str(val['monto']))
                else:
                    total += Decimal(str(val))
            except Exception:
                continue
    return total


@login_required
def crm_home(request):
    """
    Vista principal del CRM - tabla pivotada por cliente/producto.
    """
    from datetime import datetime
    user = request.user

    # Asegurar perfil
    profile, _ = UserProfile.objects.get_or_create(user=user)

    # Filtros mes/año — por defecto mes actual y año actual
    now = datetime.now()
    mes_filter = request.GET.get('mes', str(now.month).zfill(2))
    anio_filter = request.GET.get('anio', str(now.year))
    tab_activo = request.GET.get('tab', 'crm')

    # Mapeo de código mes a nombre en español (Bitrix guarda el nombre)
    MES_CODE_TO_NAME = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
        '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
    }
    MES_NAME_TO_CODE = {v: k for k, v in MES_CODE_TO_NAME.items()}

    # Parseo multi-valor: mes y año pueden ser 'todos', un valor, o lista comma-separated
    def _parse_multi(raw, is_int=False):
        if raw is None or raw == '' or raw == 'todos':
            return None  # None = todos
        items = [x.strip() for x in str(raw).split(',') if x.strip()]
        if not items:
            return None
        if is_int:
            out = []
            for x in items:
                try: out.append(int(x))
                except ValueError: pass
            return out or None
        return items

    meses_list = _parse_multi(mes_filter)
    anios_list = _parse_multi(anio_filter, is_int=True)

    # Legacy: anio_int (un solo valor) para funciones que aún no soportan multi.
    anio_todos = (anios_list is None)
    try:
        anio_int = anios_list[0] if anios_list else now.year
    except (ValueError, IndexError, TypeError):
        anio_int = now.year

    # MES_CHOICES para template (con opción "Todos" al inicio)
    mes_choices = [('todos', 'Todos')] + list(TodoItem.MES_CHOICES)
    mes_nombre = dict(mes_choices).get(mes_filter, '')
    mes_nombre_db = MES_CODE_TO_NAME.get(mes_filter, mes_filter)

    # ── Supervisor / Vendedor / Ingeniero logic ──
    es_supervisor = is_supervisor(user)
    es_ingeniero = (getattr(profile, 'rol', 'vendedor') == 'ingeniero')
    es_administrador = is_administrador(user)
    vendedores_filter = request.GET.get('vendedores', '')  # "1,2,3" or ""
    vendedores_ids = []
    if vendedores_filter:
        vendedores_ids = [int(x) for x in vendedores_filter.split(',') if x.strip().isdigit()]

    # Rango de fechas (desde/hasta) — cuando alguno está presente, IGNORA el filtro
    # de periodo (mes/año) y filtra por fecha_creacion.
    desde_raw = (request.GET.get('desde', '') or '').strip()
    hasta_raw = (request.GET.get('hasta', '') or '').strip()
    desde_date = hasta_date = None
    try:
        if desde_raw: desde_date = datetime.strptime(desde_raw, '%Y-%m-%d').date()
    except ValueError: desde_date = None
    try:
        if hasta_raw: hasta_date = datetime.strptime(hasta_raw, '%Y-%m-%d').date()
    except ValueError: hasta_date = None

    # Base queryset - oportunidades
    base_qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto', 'usuario__userprofile')
    if desde_date or hasta_date:
        # Rango de fechas activo → override del periodo
        if desde_date: base_qs = base_qs.filter(fecha_creacion__date__gte=desde_date)
        if hasta_date: base_qs = base_qs.filter(fecha_creacion__date__lte=hasta_date)
    else:
        # Filtro por periodo (multi-valor)
        if anios_list is not None:
            base_qs = base_qs.filter(anio_cierre__in=anios_list)
        if meses_list is not None:
            base_qs = base_qs.filter(mes_cierre__in=meses_list)

    # Filtrado por visibilidad: supervisor global ve todo, grupos de trabajo amplían visibilidad
    if not es_supervisor:
        usuarios_visibles = get_usuarios_visibles_ids(user)
        if usuarios_visibles is None:
            pass  # ve todo (no debería llegar aquí)
        elif len(usuarios_visibles) == 1:
            base_qs = base_qs.filter(usuario=user)
        else:
            base_qs = base_qs.filter(usuario_id__in=usuarios_visibles)

    # Guardar qs "antes del filtro de vendedor" para poblar el selector.
    # Así el picker muestra todos los vendedores CON oportunidades en el periodo,
    # independiente de qué vendedor esté filtrado actualmente.
    base_qs_sin_vendedor = base_qs

    if es_supervisor and vendedores_ids:
        # Supervisor con filtro de vendedores específicos
        base_qs = base_qs.filter(usuario_id__in=vendedores_ids)

    # Lista de vendedores para el filtro — SOLO los que tienen al menos una
    # oportunidad en el periodo filtrado (o rango de fechas).
    usuarios_con_opp = set(base_qs_sin_vendedor.values_list('usuario_id', flat=True))
    vendedores_list = []
    if es_supervisor:
        vendedores_list = User.objects.filter(
            is_active=True, id__in=usuarios_con_opp
        ).exclude(
            groups__name='Supervisores'
        ).order_by('first_name', 'last_name')
    else:
        # Usuarios de grupo visibles para el selector de vendedores
        usuarios_visibles_ids = get_usuarios_visibles_ids(user)
        if usuarios_visibles_ids and len(usuarios_visibles_ids) > 1:
            vendedores_list = User.objects.filter(
                id__in=usuarios_visibles_ids, is_active=True
            ).filter(id__in=usuarios_con_opp).order_by('first_name', 'last_name')

    # ── Meta (calculada antes para usar en running meta) ──
    # Determinar qué campo de meta usar según el tab activo
    meta_field = 'meta_mensual'  # Default (Facturado)
    if tab_activo == 'crm':
        meta_field = 'meta_oportunidades'
    elif tab_activo == 'cotizado':
        meta_field = 'meta_cotizado'
    elif tab_activo == 'cobrado':
        meta_field = 'meta_cobrado'

    if es_supervisor:
        if vendedores_ids:
            meta = UserProfile.objects.filter(user_id__in=vendedores_ids).aggregate(
                t=Coalesce(Sum(meta_field), Value(Decimal('0')))
            )['t'] or Decimal('0')
        else:
            # Suma de todos los vendedores activos para el supervisor
            all_sellers_profiles = UserProfile.objects.filter(user__is_active=True).exclude(user__groups__name='Supervisores')
            meta = all_sellers_profiles.aggregate(t=Coalesce(Sum(meta_field), Value(Decimal('0'))))['t'] or Decimal('0')
    else:
        meta = getattr(profile, meta_field, Decimal('0')) or Decimal('0')

    # Si se seleccionó "Todos" los meses, la meta es anual (mensual × 12)
    if mes_filter == 'todos':
        meta = meta * 12

    # ── Tab CRM: Lista de oportunidades individuales ──
    if tab_activo == 'crm':
        tabla_data_qs = base_qs.select_related('cliente', 'contacto', 'usuario').order_by('-fecha_actualizacion')
        # (2026-06-10, perf) Antes esto hacía 4 queries POR oportunidad
        # (vencida / próxima actividad / próxima fecha act / próxima fecha
        # tarea) — con 84-250 opps eran cientos de queries y los 5-7s de
        # render del CRM. Ahora son 4 queries batched (misma técnica que
        # api_crm_table_data), con semántica IDÉNTICA a la anterior:
        # sólo TareaOportunidad para vencidas (las Actividad del calendario
        # causan falsos positivos porque muchas nunca se cierran).
        from .models import Actividad, TareaOportunidad
        ahora_tz = timezone.now()
        tabla_data_list = list(tabla_data_qs)
        _ids = [i.id for i in tabla_data_list]

        # Mapa: opp_id -> fecha_limite MÁS ANTIGUA vencida (no completada)
        _vencida_min = dict(TareaOportunidad.objects.filter(
            oportunidad_id__in=_ids,
            fecha_limite__lt=ahora_tz,
        ).exclude(estado='completada').values_list('oportunidad_id').annotate(
            minf=Min('fecha_limite')
        ).values_list('oportunidad_id', 'minf'))

        # Mapa: opp_id -> título de la actividad no completada más próxima
        # (orden fecha_inicio ASC; el primer registro por opp gana)
        _act_titulo = {}
        for _oid, _titulo in Actividad.objects.filter(
            oportunidad_id__in=_ids, completada=False,
        ).order_by('fecha_inicio').values_list('oportunidad_id', 'titulo'):
            _act_titulo.setdefault(_oid, _titulo)

        # Mapas: opp_id -> fecha futura más cercana (actividad y tarea)
        _act_prox = dict(Actividad.objects.filter(
            oportunidad_id__in=_ids, completada=False, fecha_fin__gte=ahora_tz,
        ).values_list('oportunidad_id').annotate(
            minf=Min('fecha_fin')
        ).values_list('oportunidad_id', 'minf'))
        _tar_prox = dict(TareaOportunidad.objects.filter(
            oportunidad_id__in=_ids, fecha_limite__gte=ahora_tz,
        ).exclude(estado='completada').values_list('oportunidad_id').annotate(
            minf=Min('fecha_limite')
        ).values_list('oportunidad_id', 'minf'))

        for item in tabla_data_list:
            _venc = _vencida_min.get(item.id)
            item.tiene_actividad_vencida = bool(_venc)
            item.dias_vencida = max(0, (ahora_tz - _venc).days) if _venc else 0
            item.actividad_proxima = _act_titulo.get(item.id)
            # Días / minutos hasta la fecha futura más cercana (act o tarea)
            _candidatos = [f for f in (_act_prox.get(item.id), _tar_prox.get(item.id)) if f]
            if _candidatos:
                _delta = min(_candidatos) - ahora_tz
                item.dias_hasta_proxima = max(0, _delta.days)
                item.minutos_hasta_proxima = max(0, int(_delta.total_seconds() / 60))
            else:
                item.dias_hasta_proxima = None
                item.minutos_hasta_proxima = None
        # Obtener IDs ancladas del usuario
        ancladas_ids = set(profile.oportunidades_ancladas or [])
        for item in tabla_data_list:
            item.esta_anclada = item.id in ancladas_ids
        # Ordenar: ancladas primero, luego vencidas (más días vencidas arriba), luego el resto
        tabla_data_list.sort(key=lambda x: (not x.esta_anclada, not x.tiene_actividad_vencida, -getattr(x, 'dias_vencida', 0)))
        tabla_data = tabla_data_list

    # ── Tab Facturado: Datos del XLS por cliente + desglose por producto ──
    elif tab_activo == 'facturado':
        # Obtener datos de facturación del XLS subido
        facturado_por_cliente = {}  # {cliente_name: monto}
        if mes_filter == 'todos':
            # Sumar todos los meses del año
            for af in ArchivoFacturacion.objects.filter(anio=anio_int):
                for cname, monto_str in (af.datos_json or {}).items():
                    facturado_por_cliente[cname] = str(
                        Decimal(facturado_por_cliente.get(cname, '0')) + Decimal(str(monto_str))
                    )
        else:
            try:
                archivo_fact = ArchivoFacturacion.objects.get(mes=mes_filter, anio=anio_int)
                facturado_por_cliente = archivo_fact.datos_json or {}
            except ArchivoFacturacion.DoesNotExist:
                pass

        # Mapear nombres del XLS a objetos Cliente (matching flexible)
        facturado_por_cliente_obj = {}  # {cliente_id: monto}
        _all_clientes = list(Cliente.objects.all())
        for cliente_name, monto_str in facturado_por_cliente.items():
            monto_val = Decimal(str(monto_str))
            cn_upper = cliente_name.upper().strip()
            cliente_match = None
            # 1) Exact match
            for c in _all_clientes:
                if c.nombre_empresa and c.nombre_empresa.upper().strip() == cn_upper:
                    cliente_match = c
                    break
            # 2) XLS name contiene nombre CRM o viceversa
            if not cliente_match:
                for c in _all_clientes:
                    if not c.nombre_empresa:
                        continue
                    crm_upper = c.nombre_empresa.upper().strip()
                    if crm_upper in cn_upper or cn_upper in crm_upper:
                        cliente_match = c
                        break
            # 3) Match por primeras 2 palabras significativas
            if not cliente_match:
                palabras_xls = [w for w in cn_upper.split() if len(w) > 2 and w not in ('DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'SA', 'CV', 'SAS', 'INC', 'MEXICO')]
                if len(palabras_xls) >= 2:
                    for c in _all_clientes:
                        if not c.nombre_empresa:
                            continue
                        crm_upper = c.nombre_empresa.upper()
                        if palabras_xls[0] in crm_upper and palabras_xls[1] in crm_upper:
                            cliente_match = c
                            break
                elif len(palabras_xls) == 1 and len(palabras_xls[0]) >= 4:
                    for c in _all_clientes:
                        if not c.nombre_empresa:
                            continue
                        if palabras_xls[0] in c.nombre_empresa.upper():
                            cliente_match = c
                            break
            if cliente_match:
                facturado_por_cliente_obj[cliente_match.id] = (
                    facturado_por_cliente_obj.get(cliente_match.id, Decimal('0')) + monto_val
                )

        # Desglose por producto (de monto_facturacion en oportunidades)
        prod_data = base_qs.filter(monto_facturacion__gt=0).values('cliente').annotate(
            zebra=Coalesce(Sum('monto_facturacion', filter=Q(producto='ZEBRA')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            panduit=Coalesce(Sum('monto_facturacion', filter=Q(producto='PANDUIT')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            apc=Coalesce(Sum('monto_facturacion', filter=Q(producto='APC')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            avigilon=Coalesce(Sum('monto_facturacion', filter=Q(producto='AVIGILON') | Q(producto='AVIGILION')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            genetec=Coalesce(Sum('monto_facturacion', filter=Q(producto='GENETEC')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            axis=Coalesce(Sum('monto_facturacion', filter=Q(producto='AXIS')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            software=Coalesce(Sum('monto_facturacion', filter=Q(producto='SOFTWARE') | Q(producto='Desarrollo')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            runrate=Coalesce(Sum('monto_facturacion', filter=Q(producto='RUNRATE')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            poliza=Coalesce(Sum('monto_facturacion', filter=Q(producto='PÓLIZA') | Q(producto='POLIZA')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            total_prod=Coalesce(Sum('monto_facturacion'), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
        )
        prod_dict = {item['cliente']: item for item in prod_data}

        # Filtrar clientes según permisos
        if es_supervisor:
            if vendedores_ids:
                clientes_qs = Cliente.objects.filter(asignado_a_id__in=vendedores_ids).order_by('nombre_empresa')
            else:
                clientes_qs = Cliente.objects.all().order_by('nombre_empresa')
        else:
            clientes_qs = Cliente.objects.filter(get_clientes_visibles_q(user)).order_by('nombre_empresa')

        raw_data = []
        for c in clientes_qs:
            pdat = prod_dict.get(c.id, {})
            fact_monto = facturado_por_cliente_obj.get(c.id, Decimal('0'))
            zb = pdat.get('zebra', Decimal('0'))
            pa = pdat.get('panduit', Decimal('0'))
            ap = pdat.get('apc', Decimal('0'))
            av = pdat.get('avigilon', Decimal('0'))
            ge = pdat.get('genetec', Decimal('0'))
            ax = pdat.get('axis', Decimal('0'))
            so = pdat.get('software', Decimal('0'))
            rr = pdat.get('runrate', Decimal('0'))
            po = pdat.get('poliza', Decimal('0'))
            tp = pdat.get('total_prod', Decimal('0'))
            otros = tp - (zb + pa + ap + av + ge + ax + so + rr + po)
            raw_data.append({
                'cliente': c,
                'zebra': zb, 'panduit': pa, 'apc': ap, 'avigilon': av,
                'genetec': ge, 'axis': ax, 'software': so, 'runrate': rr,
                'poliza': po, 'otros': otros,
                'facturado': fact_monto,
            })

        # Ordenar por facturado descendente
        raw_data.sort(key=lambda x: x['facturado'], reverse=True)

        # Meta por cliente: meta individual del cliente - su facturado
        for item in raw_data:
            cliente_meta = item['cliente'].meta_mensual or Decimal('0')
            item['meta_cliente'] = cliente_meta
            item['meta_restante'] = cliente_meta - item['facturado']
            item['total'] = item['facturado'] # Para que el template use item.total
        tabla_data = raw_data

    # ── Tab Cotizado: Cotizaciones PDF generadas ──
    elif tab_activo == 'cotizado':
        opp_ids = base_qs.values_list('id', flat=True)
        cotizaciones_qs = (
            Cotizacion.objects
            .select_related('oportunidad', 'created_by', 'cliente')
            .filter(
                Q(oportunidad_id__in=opp_ids) |
                Q(oportunidad__isnull=True, fecha_creacion__year=anio_int)
            )
            .order_by('-fecha_creacion')
        )
        tabla_data = cotizaciones_qs

    # ── Tab Cobrado: Oportunidades con etapa Ganado/Pagado ──
    elif tab_activo == 'cobrado':
        tabla_data = base_qs.filter(etapa_corta__in=['Ganado', 'Pagado']).order_by('-monto')

    else:
        tabla_data = []

    # Stats generales
    total_general = base_qs.aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']
    num_clientes = Cliente.objects.count() if es_supervisor else base_qs.values('cliente').distinct().count()
    num_deals = base_qs.count()
    num_cobradas = base_qs.filter(etapa_corta__in=['Ganado', 'Pagado']).count()

    # ── Total facturado: usar misma lógica que api_desglose_facturacion ──
    total_facturado = _calcular_total_desglose(mes_filter, anio_int)

    progreso = min(int((total_facturado / meta * 100)) if meta > 0 else 0, 100)

    # Stats para tab Cobrado
    total_cobrado = Decimal('0')
    if tab_activo == 'cobrado':
        total_cobrado = base_qs.filter(etapa_corta__in=['Ganado', 'Pagado']).aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']

    # Stats para tab Cotizado
    num_cotizaciones = 0
    num_oportunidades_cotizadas = 0
    total_cotizado = Decimal('0')
    if tab_activo == 'cotizado':
        num_cotizaciones = cotizaciones_qs.count()
        num_oportunidades_cotizadas = cotizaciones_qs.exclude(oportunidad__isnull=True).values('oportunidad').distinct().count()
        total_cotizado = cotizaciones_qs.aggregate(t=Coalesce(Sum('total'), Value(Decimal('0'))))['t']

    # ── Widget Logic ──
    widget_label = 'Total Facturado'
    widget_metric = total_facturado 

    if tab_activo == 'crm':
        widget_label = 'Total Oportunidades'
        widget_metric = total_general
    elif tab_activo == 'clientes':
        widget_label = 'Total Facturado'
        widget_metric = total_facturado

    # Recalculate progress based on the correct metric vs correct meta (sin cap para mostrar > 100%)
    progreso = int((widget_metric / meta * 100)) if meta > 0 else 0

    # ── Prospectos kanban: cargar cuando el tab activo es 'prospectos' ──
    prospectos_por_etapa = None
    if tab_activo == 'prospectos':
        from .models import Prospecto
        ahora_local = timezone.now()
        ETAPA_PROB = {
            'identificado': 10, 'calificado': 25, 'reunion': 45,
            'en_progreso': 65, 'procesado': 85, 'cerrado_ganado': 100, 'cerrado_perdido': 0,
        }
        ETAPA_LBL = {
            'identificado': 'Identificado', 'calificado': 'Calificado',
            'reunion': 'Reunión', 'en_progreso': 'En Progreso', 'procesado': 'Procesado',
            'cerrado_ganado': 'Cerrado Ganado', 'cerrado_perdido': 'Cerrado Perdido',
        }
        # Orden visible en el kanban (cerrado_perdido no se muestra en columnas; se filtra)
        ETAPAS_ORDER = ['identificado', 'calificado', 'reunion', 'en_progreso', 'procesado', 'cerrado_ganado']

        # QuerySet base
        p_qs = Prospecto.objects.select_related('cliente', 'contacto', 'usuario').prefetch_related('actividades')

        # Filtro de periodo (por fecha_creacion)
        if desde_date or hasta_date:
            if desde_date:
                p_qs = p_qs.filter(fecha_creacion__date__gte=desde_date)
            if hasta_date:
                p_qs = p_qs.filter(fecha_creacion__date__lte=hasta_date)
        else:
            if anios_list is not None:
                p_qs = p_qs.filter(fecha_creacion__year__in=anios_list)
            if meses_list is not None:
                meses_int = []
                for m in meses_list:
                    try: meses_int.append(int(m))
                    except (ValueError, TypeError): pass
                if meses_int:
                    p_qs = p_qs.filter(fecha_creacion__month__in=meses_int)

        # Visibilidad
        if not es_supervisor:
            usuarios_visibles = get_usuarios_visibles_ids(user)
            if usuarios_visibles is None:
                pass
            elif len(usuarios_visibles) == 1:
                p_qs = p_qs.filter(usuario=user)
            else:
                p_qs = p_qs.filter(usuario_id__in=usuarios_visibles)
        elif vendedores_ids:
            p_qs = p_qs.filter(usuario_id__in=vendedores_ids)

        # Excluir perdidos (no se muestran en el kanban)
        p_qs = p_qs.exclude(etapa='cerrado_perdido')

        # Construir estructura por etapa con metadata de actividad
        prospectos_items = []
        for p in p_qs:
            acts_pend = [a for a in p.actividades.all() if (not a.completada) and a.fecha_programada]
            acts_pend.sort(key=lambda a: a.fecha_programada)

            tiene_venc = False
            dias_venc = 0
            minutos_prox = None
            dias_prox = None
            act_txt = ''

            if acts_pend:
                prox = acts_pend[0]
                delta = prox.fecha_programada - ahora_local
                total_sec = delta.total_seconds()
                act_txt = (prox.descripcion[:80] if prox.descripcion else prox.get_tipo_display())
                if total_sec < 0:
                    tiene_venc = True
                    dias_venc = max(0, int(abs(total_sec) / 86400))
                else:
                    minutos_prox = int(total_sec / 60)
                    dias_prox = int(total_sec / 86400)

            prospectos_items.append({
                'id': p.id,
                'nombre': p.nombre,
                'cliente': p.cliente,
                'contacto': p.contacto,
                'usuario': p.usuario,
                'usuario_nombre': (p.usuario.get_full_name() or p.usuario.username) if p.usuario else '',
                'producto': p.producto or '',
                'area': p.area or '',
                'tipo_pipeline': p.tipo_pipeline,
                'etapa': p.etapa,
                'etapa_label': ETAPA_LBL.get(p.etapa, p.etapa),
                'probabilidad': ETAPA_PROB.get(p.etapa, 0),
                'tiene_actividad_vencida': tiene_venc,
                'dias_vencida': dias_venc,
                'minutos_hasta_proxima': minutos_prox,
                'dias_hasta_proxima': dias_prox,
                'actividad_proxima': act_txt,
                'fecha_actualizacion': p.fecha_actualizacion,
                'fecha_creacion': p.fecha_creacion,
            })

        # Agrupar por etapa preservando orden
        prospectos_por_etapa = []
        for etapa_key in ETAPAS_ORDER:
            items = [x for x in prospectos_items if x['etapa'] == etapa_key]
            # Ordenar: vencidas primero (más días), luego por fecha desc
            items.sort(key=lambda x: (
                0 if x['tiene_actividad_vencida'] else 1,
                -(x['dias_vencida'] or 0),
                -int(x['fecha_actualizacion'].timestamp()) if x['fecha_actualizacion'] else 0,
            ))
            prospectos_por_etapa.append({
                'key': etapa_key,
                'label': ETAPA_LBL.get(etapa_key, etapa_key),
                'items': items,
                'count': len(items),
            })

    # ── Marketing KPIs (solo para pestaña Marketing) ─────────────────
    # Filtrado por el mismo mes/año o rango de fechas que rige la pestaña.
    marketing_kpis = None
    if tab_activo == 'prospeccion':
        from .models import CampanaTemplate, CampanaEnvio
        envios_qs = CampanaEnvio.objects.all()
        # Activas = templates de campaña activos creados en el periodo. El
        # usuario considera "una campaña activa" cuando sube el material
        # (la plantilla HTML), incluso si aún no se envía a nadie. La cuenta
        # de envíos efectivos vive aparte en "Enviadas".
        camps_qs = CampanaTemplate.objects.filter(activa=True)
        if desde_date or hasta_date:
            if desde_date:
                envios_qs = envios_qs.filter(fecha_envio__date__gte=desde_date)
                camps_qs = camps_qs.filter(fecha_creacion__date__gte=desde_date)
            if hasta_date:
                envios_qs = envios_qs.filter(fecha_envio__date__lte=hasta_date)
                camps_qs = camps_qs.filter(fecha_creacion__date__lte=hasta_date)
        else:
            if anios_list is not None:
                envios_qs = envios_qs.filter(fecha_envio__year__in=anios_list)
                camps_qs = camps_qs.filter(fecha_creacion__year__in=anios_list)
            if meses_list is not None:
                try:
                    meses_int = [int(m) for m in meses_list]
                except (TypeError, ValueError):
                    meses_int = []
                if meses_int:
                    envios_qs = envios_qs.filter(fecha_envio__month__in=meses_int)
                    camps_qs = camps_qs.filter(fecha_creacion__month__in=meses_int)
        total_enviadas = envios_qs.count()
        total_activas = camps_qs.count()
        total_respondidas = envios_qs.filter(respondido=True).count()
        if total_enviadas > 0:
            tasa_str = f'{round(total_respondidas / total_enviadas * 100)}%'
        else:
            tasa_str = '—'

        # Prospecciones por marca en el periodo — alimenta las mini-barras
        # debajo de los KPIs en la card de Campañas para llenar el espacio
        # vacío con algo útil: ¿qué marcas estamos trabajando más?
        from .models import Prospecto
        from django.db.models import Count
        MARCAS_MKT = [
            ('PANDUIT', 'Panduit'),
            ('ZEBRA', 'Zebra'),
            ('APC', 'APC'),
            ('AVIGILION', 'Avigilon'),
            ('GENETEC', 'Genetec'),
            ('AXIS', 'Axis'),
            ('CISCO', 'Cisco'),
        ]
        prosp_qs = Prospecto.objects.all()
        if desde_date or hasta_date:
            if desde_date:
                prosp_qs = prosp_qs.filter(fecha_creacion__date__gte=desde_date)
            if hasta_date:
                prosp_qs = prosp_qs.filter(fecha_creacion__date__lte=hasta_date)
        else:
            if anios_list is not None:
                prosp_qs = prosp_qs.filter(fecha_creacion__year__in=anios_list)
            if meses_list is not None:
                try:
                    meses_int_p = [int(m) for m in meses_list]
                except (TypeError, ValueError):
                    meses_int_p = []
                if meses_int_p:
                    prosp_qs = prosp_qs.filter(fecha_creacion__month__in=meses_int_p)
        conteo_marca = dict(
            prosp_qs.values_list('producto')
                    .annotate(c=Count('id'))
                    .values_list('producto', 'c')
        )
        max_count = max(conteo_marca.values()) if conteo_marca else 0
        prosp_por_marca = []
        for code, label in MARCAS_MKT:
            n = conteo_marca.get(code, 0)
            if n <= 0:
                continue
            pct = round((n / max_count) * 100) if max_count else 0
            prosp_por_marca.append({
                'code': code,
                'label': label,
                'letter': label[0],
                'count': n,
                'pct': pct,
            })

        marketing_kpis = {
            'activas': total_activas,
            'enviadas': total_enviadas,
            'tasa_contacto': tasa_str,
            'hay_actividad': total_enviadas > 0 or total_activas > 0,
            'prosp_por_marca': prosp_por_marca,
        }

    # ── Tab Clientes (vista consolidada cliente × marca) ──────────────
    clientes_tabla = None
    clientes_tabla_meta = None
    potenciales_lista = None
    # La tabla de clientes se carga también en el Dashboard (tab=clientes)
    # para que el modo "Clientes" funcione sin recargar.
    if tab_activo == 'clientes' or tab_activo == 'cli':
        # Catálogo de marcas (mismas columnas que en Campañas)
        MARCAS_COL = [
            ('ZEBRA',     'zebra',    'Zebra'),
            ('PANDUIT',   'panduit',  'Panduit'),
            ('APC',       'apc',      'APC'),
            ('AVIGILION', 'avigilon', 'Avigilon'),
            ('GENETEC',   'genetec',  'Genetec'),
            ('AXIS',      'axis',     'Axis'),
            ('CISCO',     'cisco',    'Cisco'),
            ('SERVICIO',  'servicio', 'Serv.'),
            ('SOFTWARE',  'software', 'Soft.'),
            ('RUNRATE',   'runrate',  'RR'),
            ('PÓLIZA',    'poliza',   'Pól.'),
        ]
        # Clientes visibles según rol/filtros
        if es_supervisor:
            if vendedores_ids:
                clientes_qs = Cliente.objects.filter(asignado_a_id__in=vendedores_ids)
            else:
                clientes_qs = Cliente.objects.all()
        else:
            usuarios_visibles = get_usuarios_visibles_ids(user)
            if usuarios_visibles and len(usuarios_visibles) > 1:
                clientes_qs = Cliente.objects.filter(asignado_a_id__in=usuarios_visibles)
            else:
                clientes_qs = Cliente.objects.filter(asignado_a=user)
        clientes_qs = clientes_qs.order_by('nombre_empresa')

        # Filtro de periodo aplicable a TodoItem y Prospecto.
        # Reutilizamos meses_list/anios_list/desde_date/hasta_date.
        cliente_ids = list(clientes_qs.values_list('id', flat=True))

        # ── Oportunidades activas por cliente y producto ──
        # Usamos fecha_creacion para que coincida con cómo se cuentan en Campañas.
        op_qs = TodoItem.objects.filter(cliente_id__in=cliente_ids)
        # Excluir oportunidades cerradas perdidas o ganadas (criterio: estado_oportunidad).
        # Aceptamos cualquier oportunidad creada en el periodo.
        if desde_date or hasta_date:
            if desde_date: op_qs = op_qs.filter(fecha_creacion__date__gte=desde_date)
            if hasta_date: op_qs = op_qs.filter(fecha_creacion__date__lte=hasta_date)
        else:
            if anios_list is not None:
                op_qs = op_qs.filter(fecha_creacion__year__in=anios_list)
            if meses_list is not None:
                try:
                    meses_int = [int(m) for m in meses_list]
                except (TypeError, ValueError):
                    meses_int = []
                if meses_int:
                    op_qs = op_qs.filter(fecha_creacion__month__in=meses_int)
        # ── Prospecciones (Prospecto) activas por cliente y producto ──
        from .models import Prospecto
        pr_qs = Prospecto.objects.filter(cliente_id__in=cliente_ids).exclude(
            etapa__in=['cerrado_ganado', 'cerrado_perdido']
        )
        if desde_date or hasta_date:
            if desde_date: pr_qs = pr_qs.filter(fecha_creacion__date__gte=desde_date)
            if hasta_date: pr_qs = pr_qs.filter(fecha_creacion__date__lte=hasta_date)
        else:
            if anios_list is not None:
                pr_qs = pr_qs.filter(fecha_creacion__year__in=anios_list)
            if meses_list is not None:
                try:
                    meses_int = [int(m) for m in meses_list]
                except (TypeError, ValueError):
                    meses_int = []
                if meses_int:
                    pr_qs = pr_qs.filter(fecha_creacion__month__in=meses_int)

        # Construye conteo por cliente. Estructura:
        # { cliente_id: { 'op': {marca_key: count}, 'pr': {marca_key: count}, 'op_total':N, 'pr_total':N } }
        def _bucket_marca(prod):
            prod = (prod or '').upper()
            for code, key, _label in MARCAS_COL:
                if code in prod or (code == 'AVIGILION' and 'AVIGILON' in prod):
                    return key
            return 'otros'

        counts = {}
        for o in op_qs.values('cliente_id', 'producto'):
            cid = o['cliente_id']
            b = counts.setdefault(cid, {'op': {}, 'pr': {}, 'op_total': 0, 'pr_total': 0})
            k = _bucket_marca(o['producto'])
            b['op'][k] = b['op'].get(k, 0) + 1
            b['op_total'] += 1
        for p in pr_qs.values('cliente_id', 'producto'):
            cid = p['cliente_id']
            b = counts.setdefault(cid, {'op': {}, 'pr': {}, 'op_total': 0, 'pr_total': 0})
            k = _bucket_marca(p['producto'])
            b['pr'][k] = b['pr'].get(k, 0) + 1
            b['pr_total'] += 1

        # Construir filas (cells como lista ordenada para iterar en el template)
        clientes_tabla = []
        keys = [k for _c, k, _l in MARCAS_COL] + ['otros']
        for c in clientes_qs:
            b = counts.get(c.id, {'op': {}, 'pr': {}, 'op_total': 0, 'pr_total': 0})
            cells = []
            for k in keys:
                op = b['op'].get(k, 0)
                pr = b['pr'].get(k, 0)
                cells.append({'key': k, 'op': op, 'pr': pr, 'total': op + pr})
            clientes_tabla.append({
                'id': c.id,
                'nombre': c.nombre_empresa or '—',
                'rfc': c.rfc or '',
                'cells': cells,
                'op_total': b['op_total'],
                'pr_total': b['pr_total'],
            })

        clientes_tabla_meta = {
            'marcas_col': [{'code': c, 'key': k, 'label': l} for c, k, l in MARCAS_COL],
            'total_clientes': len(clientes_tabla),
            'total_op': sum(r['op_total'] for r in clientes_tabla),
            'total_pr': sum(r['pr_total'] for r in clientes_tabla),
        }

        # ── ClientePotencial visibles (para el toggle "Solo Prospectos") ──
        from .models import ClientePotencial
        if es_supervisor:
            if vendedores_ids:
                pot_qs = ClientePotencial.objects.filter(asignado_a_id__in=vendedores_ids)
            else:
                pot_qs = ClientePotencial.objects.all()
        else:
            usuarios_visibles = get_usuarios_visibles_ids(user)
            if usuarios_visibles and len(usuarios_visibles) > 1:
                pot_qs = ClientePotencial.objects.filter(asignado_a_id__in=usuarios_visibles)
            else:
                pot_qs = ClientePotencial.objects.filter(asignado_a=user)
        pot_qs = pot_qs.select_related('asignado_a').order_by('-fecha_actualizacion')
        potenciales_lista = [
            {
                'id': p.id,
                'nombre': p.nombre,
                'asignado_nombre': (p.asignado_a.get_full_name() or p.asignado_a.username) if p.asignado_a_id else '—',
                'notas': p.notas or '',
                'fecha': p.fecha_creacion.strftime('%d %b %Y') if p.fecha_creacion else '',
            }
            for p in pot_qs
        ]

    # ── Certificaciones (sub-vista ?vista=certificaciones + widget) ─
    certificaciones_lista = None
    certificaciones_kpis = None
    certificaciones_filtros = None
    if tab_activo == 'prospeccion':
        from .models import Certificacion
        from datetime import date as _date
        from django.db.models import F
        # Orden: primero las certificaciones reordenadas manualmente desde
        # la pared (orden ascendente con nulls al final), después las que
        # no tienen orden manual ordenadas por fecha de obtención.
        cert_qs = (
            Certificacion.objects
            .select_related('usuario')
            .prefetch_related('archivos')
            .order_by(F('orden').asc(nulls_last=True), '-fecha_obtencion', '-fecha_creacion')
        )
        # ── Filtros para la sub-vista de Certificaciones ──
        cert_marca = (request.GET.get('cert_marca') or '').strip().upper()
        cert_nivel = (request.GET.get('cert_nivel') or '').strip()
        cert_estado_v = (request.GET.get('cert_estado') or '').strip()  # vigente|por_vencer|vencida|sin_vencimiento
        cert_q = (request.GET.get('cert_q') or '').strip()
        # Aplicamos el filtro global de Vendedores (selector arriba del CRM).
        if vendedores_ids:
            cert_qs = cert_qs.filter(usuario_id__in=vendedores_ids)
        if cert_marca:
            cert_qs = cert_qs.filter(marca__iexact=cert_marca)
        if cert_nivel:
            cert_qs = cert_qs.filter(nivel=cert_nivel)
        if cert_q:
            from django.db.models import Q as _Q
            cert_qs = cert_qs.filter(
                _Q(nombre__icontains=cert_q)
                | _Q(numero__icontains=cert_q)
                | _Q(marca__icontains=cert_q)
                | _Q(usuario__first_name__icontains=cert_q)
                | _Q(usuario__last_name__icontains=cert_q)
                | _Q(usuario__username__icontains=cert_q)
            )
        certificaciones_lista = list(cert_qs)
        # Filtro por estado (post-procesado porque depende de fecha de hoy).
        if cert_estado_v:
            hoy_e = _date.today()
            def _estado_de(c):
                if not c.fecha_vencimiento: return 'sin_vencimiento'
                if c.fecha_vencimiento < hoy_e: return 'vencida'
                if (c.fecha_vencimiento - hoy_e).days <= 60: return 'por_vencer'
                return 'vigente'
            certificaciones_lista = [c for c in certificaciones_lista if _estado_de(c) == cert_estado_v]
        # Catálogo de marcas/niveles activos en el universo (sin filtros) para
        # poblar los dropdowns. Limitado a marcas que tengan al menos 1 cert.
        _all_qs = Certificacion.objects.values_list('marca', 'nivel')
        if vendedores_ids:
            _all_qs = Certificacion.objects.filter(usuario_id__in=vendedores_ids).values_list('marca', 'nivel')
        marcas_set = set()
        niveles_set = set()
        for m, n in _all_qs:
            if m: marcas_set.add(m.upper())
            if n: niveles_set.add(n)
        NIVEL_ORDEN = ['basico', 'intermedio', 'avanzado', 'experto']
        certificaciones_filtros = {
            'marca': cert_marca,
            'nivel': cert_nivel,
            'estado': cert_estado_v,
            'q': cert_q,
            'marcas_disponibles': sorted(marcas_set),
            'niveles_disponibles': [n for n in NIVEL_ORDEN if n in niveles_set],
            'vista_cert': (request.GET.get('vista_cert') or 'pared').strip() or 'pared',
            'tiene_filtros_activos': bool(cert_marca or cert_nivel or cert_estado_v or cert_q or vendedores_ids),
        }
        # KPIs para la tarjeta del dashboard de Marketing.
        hoy_d = _date.today()
        cert_total = len(certificaciones_lista)
        cert_personas = len({c.usuario_id for c in certificaciones_lista})
        cert_por_vencer = 0
        cert_vencidas = 0
        cert_por_marca = {}
        for c in certificaciones_lista:
            m = (c.marca or '').upper() or 'OTROS'
            cert_por_marca[m] = cert_por_marca.get(m, 0) + 1
            if c.fecha_vencimiento:
                if c.fecha_vencimiento < hoy_d:
                    cert_vencidas += 1
                elif (c.fecha_vencimiento - hoy_d).days <= 60:
                    cert_por_vencer += 1
        # Top 3 marcas para mostrar barras en la tarjeta del dashboard.
        marcas_top = sorted(cert_por_marca.items(), key=lambda kv: kv[1], reverse=True)[:3]
        max_count = marcas_top[0][1] if marcas_top else 0
        certificaciones_kpis = {
            'total': cert_total,
            'personas': cert_personas,
            'por_vencer': cert_por_vencer,
            'vencidas': cert_vencidas,
            'marcas_top': [
                {
                    'marca': m,
                    'count': c,
                    'pct': int(round((c / max_count) * 100)) if max_count else 0,
                    'letra': m[0] if m else '?',
                }
                for m, c in marcas_top
            ],
        }

    # ── Cursos (sub-vista ?vista=cursos + tarjeta del dashboard) ────
    cursos_lista = None
    cursos_kpis = None
    cursos_filtros = None
    if tab_activo == 'prospeccion':
        from .models import Curso
        from datetime import date as _date, timedelta as _td
        cur_qs = (
            Curso.objects.select_related('usuario')
            .order_by('-fecha_actualizacion')
        )
        cur_marca = (request.GET.get('cur_marca') or '').strip().upper()
        cur_nivel = (request.GET.get('cur_nivel') or '').strip()
        cur_estado = (request.GET.get('cur_estado') or '').strip()
        cur_q = (request.GET.get('cur_q') or '').strip()
        if vendedores_ids:
            cur_qs = cur_qs.filter(usuario_id__in=vendedores_ids)
        if cur_marca:
            cur_qs = cur_qs.filter(marca__iexact=cur_marca)
        if cur_nivel:
            cur_qs = cur_qs.filter(nivel=cur_nivel)
        if cur_estado:
            cur_qs = cur_qs.filter(estado=cur_estado)
        if cur_q:
            from django.db.models import Q as _Q
            cur_qs = cur_qs.filter(
                _Q(nombre__icontains=cur_q)
                | _Q(plataforma__icontains=cur_q)
                | _Q(marca__icontains=cur_q)
                | _Q(usuario__first_name__icontains=cur_q)
                | _Q(usuario__last_name__icontains=cur_q)
                | _Q(usuario__username__icontains=cur_q)
            )
        cursos_lista = list(cur_qs)
        # KPIs para la tarjeta del dashboard
        hoy_c = _date.today()
        total_c = Curso.objects.count()
        en_prog = Curso.objects.filter(estado='en_progreso').count()
        compl = Curso.objects.filter(estado='completado').count()
        personas_c = Curso.objects.values('usuario_id').distinct().count()
        proximos_c = Curso.objects.filter(
            estado='en_progreso',
            fecha_compromiso__isnull=False,
            fecha_compromiso__lte=hoy_c + _td(days=14),
        ).count()
        cursos_kpis = {
            'total': total_c,
            'en_progreso': en_prog,
            'completados': compl,
            'personas': personas_c,
            'proximos': proximos_c,
        }
        # Catálogo de marcas/niveles del universo (para popovers)
        _all_q = Curso.objects.values_list('marca', 'nivel')
        if vendedores_ids:
            _all_q = Curso.objects.filter(usuario_id__in=vendedores_ids).values_list('marca', 'nivel')
        marcas_set_c = set()
        niveles_set_c = set()
        for m, n in _all_q:
            if m: marcas_set_c.add(m.upper())
            if n: niveles_set_c.add(n)
        NIVEL_ORDEN_C = ['basico', 'intermedio', 'avanzado', 'experto']
        cursos_filtros = {
            'marca': cur_marca,
            'nivel': cur_nivel,
            'estado': cur_estado,
            'q': cur_q,
            'marcas_disponibles': sorted(marcas_set_c),
            'niveles_disponibles': [n for n in NIVEL_ORDEN_C if n in niveles_set_c],
            'vista_curso': (request.GET.get('vista_curso') or 'tarjeta').strip() or 'tarjeta',
            'tiene_filtros_activos': bool(cur_marca or cur_nivel or cur_estado or cur_q or vendedores_ids),
        }

    # ── Eventos (widget Eventos + sub-vista ?vista=eventos) ──────────
    eventos_kpis = None
    eventos_lista = None
    techday_kpis = None
    demos_kpis = None
    if tab_activo == 'prospeccion':
        from .models import Evento
        evt_qs = Evento.objects.exclude(estado='cancelado').filter(fecha_evento__isnull=False)
        if desde_date or hasta_date:
            if desde_date: evt_qs = evt_qs.filter(fecha_evento__date__gte=desde_date)
            if hasta_date: evt_qs = evt_qs.filter(fecha_evento__date__lte=hasta_date)
        else:
            if anios_list is not None:
                evt_qs = evt_qs.filter(fecha_evento__year__in=anios_list)
            if meses_list is not None:
                try:
                    meses_int = [int(m) for m in meses_list]
                except (TypeError, ValueError):
                    meses_int = []
                if meses_int:
                    evt_qs = evt_qs.filter(fecha_evento__month__in=meses_int)
        eventos_periodo = list(
            evt_qs.select_related('organizador').prefetch_related('asistentes')
                  .order_by('fecha_evento')
        )
        dias_con_eventos = sorted({e.fecha_evento.day for e in eventos_periodo if e.fecha_evento})
        # Mapa día → lista de evento_ids, usado por el calendario clickable
        dia_to_eventos = {}
        for e in eventos_periodo:
            if not e.fecha_evento:
                continue
            dia_to_eventos.setdefault(e.fecha_evento.day, []).append(e.id)
        ahora = timezone.now()
        proximo = next((e for e in eventos_periodo if e.fecha_evento and e.fecha_evento >= ahora), None)
        # Etiqueta del mes para el header del calendario + día de hoy si aplica
        MES_NAMES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                          'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
        mes_label = None
        dia_hoy = None
        today = timezone.now().date()
        if meses_list and len(meses_list) == 1 and anios_list and len(anios_list) == 1:
            try:
                mes_idx = int(meses_list[0])
                if 1 <= mes_idx <= 12:
                    mes_label = f'{MES_NAMES_FULL[mes_idx-1]} {anios_list[0]}'
                    if anios_list[0] == today.year and mes_idx == today.month:
                        dia_hoy = today.day
            except (ValueError, IndexError, TypeError):
                pass
        elif anios_list and len(anios_list) == 1:
            mes_label = f'Año {anios_list[0]}'
        # Días 1..31 con flags para el grid del calendario. Si un día tiene
        # eventos, agregamos los ids para que el calendario sea clickable
        # (1 evento → abre detalle; N eventos → lista filtrada por día).
        dias_set = set(dias_con_eventos)
        dias_calendar = []
        for i in range(1, 32):
            ev_ids = dia_to_eventos.get(i, [])
            dias_calendar.append({
                'num': i,
                'has_event': i in dias_set,
                'is_today': dia_hoy == i,
                'evento_ids_str': ','.join(str(x) for x in ev_ids),
                'evento_count': len(ev_ids),
                'single_evento_id': ev_ids[0] if len(ev_ids) == 1 else None,
            })
        eventos_kpis = {
            'total': len(eventos_periodo),
            'mes_label': mes_label,
            'dia_hoy': dia_hoy,
            'dias_con_eventos': dias_con_eventos,
            'dias_calendar': dias_calendar,
            'proximo': {
                'id': proximo.id,
                'nombre': proximo.nombre,
                'fecha_display': proximo.fecha_evento.strftime('%d %b · %H:%M'),
                'marcas': proximo.marcas or [],
            } if proximo else None,
        }
        # Sub-vista filtrada por tipo (Techday, Demos, etc.) — si no viene
        # filter_tipo, la lista muestra todos los eventos del periodo.
        filter_tipo = (request.GET.get('filter_tipo') or '').strip()
        if filter_tipo:
            eventos_lista = [e for e in eventos_periodo if e.tipo == filter_tipo]
        else:
            eventos_lista = eventos_periodo
        # KPIs específicos por tipo — alimentan los widgets del bento (Techday,
        # Demos, etc.). Solo calculo Techday por ahora; los demás siguen igual.
        techday_periodo = [e for e in eventos_periodo if e.tipo == 'techday']
        techday_proximas = [
            {
                'id': e.id,
                'nombre': e.nombre,
                'fecha_display': e.fecha_evento.strftime('%d %b · %H:%M'),
                'marcas': e.marcas or [],
            }
            for e in techday_periodo if e.fecha_evento and e.fecha_evento >= ahora
        ][:3]
        # Métricas agregadas que llenan la card de Techday: asistentes únicos
        # confirmados, prospectos generados, top de marcas trabajadas, y la
        # última sesión realizada (para mostrar "Última: X" cuando no hay
        # próximas en el período).
        tech_asistentes = 0
        tech_prospectos = 0
        marca_count = {}
        for e in techday_periodo:
            tech_asistentes += sum(1 for a in e.asistentes.all() if a.confirmado)
            tech_prospectos += e.prospectos_generados.count()
            for m in (e.marcas or []):
                marca_count[m] = marca_count.get(m, 0) + 1
        # Top 3 marcas
        top_marcas = sorted(marca_count.items(), key=lambda kv: -kv[1])[:3]
        max_marca = top_marcas[0][1] if top_marcas else 0
        tech_marcas_top = [
            {
                'label': str(m).title(),
                'letter': str(m)[0].upper(),
                'count': c,
                'pct': round((c / max_marca) * 100) if max_marca else 0,
            }
            for m, c in top_marcas
        ]
        # Última sesión completada (más reciente, fecha < ahora)
        pasadas = [e for e in techday_periodo if e.fecha_evento and e.fecha_evento < ahora]
        ultima = max(pasadas, key=lambda e: e.fecha_evento) if pasadas else None
        techday_kpis = {
            'total': len(techday_periodo),
            'proximas': techday_proximas,
            'asistentes': tech_asistentes,
            'prospectos': tech_prospectos,
            'marcas_top': tech_marcas_top,
            'ultima': {
                'id': ultima.id,
                'nombre': ultima.nombre,
                'fecha_display': ultima.fecha_evento.strftime('%d %b · %H:%M'),
            } if ultima else None,
            'filter_tipo': filter_tipo,
        }

        # ── Demos KPIs ─────────────────────────────────────────────────
        # Demos = eventos con tipo 'demo_sitio'. Separamos por dirección:
        #   outbound = IAMET presenta a cliente/prospecto (genera oportunidades)
        #   inbound  = una marca capacita al equipo IAMET (asistencia interna)
        demos_periodo = [e for e in eventos_periodo if e.tipo == 'demo_sitio']
        outbound = [e for e in demos_periodo if (e.demo_direccion or 'outbound') == 'outbound']
        inbound  = [e for e in demos_periodo if e.demo_direccion == 'inbound']
        # Outbound: prospectos generados + monto $ pipeline (de la oportunidad ligada)
        out_prospectos = sum(e.prospectos_generados.count() for e in outbound)
        out_monto = 0
        for e in outbound:
            for p in e.prospectos_generados.all():
                if p.oportunidad_creada_id and p.oportunidad_creada.monto:
                    out_monto += float(p.oportunidad_creada.monto)
        # Inbound: asistentes IAMET totales + marcas únicas trabajadas
        in_asistentes = sum(1 for e in inbound for a in e.asistentes.all() if a.confirmado)
        in_marcas = set()
        for e in inbound:
            for m in (e.marcas or []):
                in_marcas.add(m)
        # Próxima demo (cualquier dirección)
        demos_prox = next(
            (e for e in sorted(demos_periodo, key=lambda x: x.fecha_evento or ahora)
             if e.fecha_evento and e.fecha_evento >= ahora),
            None,
        )
        demos_kpis = {
            'total': len(demos_periodo),
            'outbound_total': len(outbound),
            'outbound_prospectos': out_prospectos,
            'outbound_monto': int(out_monto),  # entero, sin centavos
            'inbound_total': len(inbound),
            'inbound_asistentes': in_asistentes,
            'inbound_marcas': len(in_marcas),
            'proxima': {
                'id': demos_prox.id,
                'nombre': demos_prox.nombre,
                'fecha_display': demos_prox.fecha_evento.strftime('%d %b · %H:%M'),
                'direccion': demos_prox.demo_direccion or 'outbound',
                'marcas': demos_prox.marcas or [],
            } if demos_prox else None,
            'filter_tipo': filter_tipo,
        }

    # ── Marketing Hub: server-side seed para que los logos de marca y
    #    las URLs de recursos viajen junto con el HTML inicial y no
    #    haya que esperar al fetch async para verlos. ─────────────────
    marketing_marcas_seed = []
    marketing_recursos_seed = []
    marketing_can_edit = False
    if tab_activo == 'marketing':
        try:
            from .models import MarcaMarketing, RecursoMarketing
            profile = getattr(user, 'userprofile', None)
            marketing_can_edit = bool(profile and getattr(profile, 'can_manage_marketing', False))
            for m in MarcaMarketing.objects.filter(visible=True).order_by('orden', 'nombre'):
                marketing_marcas_seed.append({
                    'id': m.id,
                    'slug': m.slug,
                    'nombre': m.nombre,
                    'logo_url': m.logo.url if m.logo else '',
                })
            for r in (RecursoMarketing.objects
                      .filter(visible=True)
                      .select_related('subido_por')
                      .order_by('orden', '-fecha_creacion')):
                usr = r.subido_por
                subido_por_nombre = ''
                if usr:
                    subido_por_nombre = (usr.get_full_name() or usr.username or '').strip() or usr.username
                marketing_recursos_seed.append({
                    'id': r.id,
                    'brand': r.brand,
                    'tipo': r.tipo,
                    'titulo': r.titulo,
                    'descripcion': r.descripcion or '',
                    'tags': list(r.tags or []),
                    'url_efectiva': r.url_efectiva,
                    'tamano_legible': r.tamano_legible,
                    'fecha_legible': r.fecha_creacion.strftime('%d %b %Y') if r.fecha_creacion else '',
                    'subido_por_nombre': subido_por_nombre,
                })
        except Exception:
            # Si MarcaMarketing/RecursoMarketing aún no migraron (rama vieja),
            # dejamos el seed vacío y el frontend hace fallback a mocks/fetch.
            marketing_marcas_seed = []
            marketing_recursos_seed = []

    context = {
        'widget_label': widget_label,
        'widget_metric': widget_metric,
        'tab_activo': tab_activo,
        'marketing_marcas_seed_json': json.dumps(marketing_marcas_seed),
        'marketing_recursos_seed_json': json.dumps(marketing_recursos_seed),
        'marketing_can_edit': marketing_can_edit,
        'marketing_kpis': marketing_kpis,
        'eventos_kpis': eventos_kpis,
        'eventos_lista': eventos_lista,
        'techday_kpis': techday_kpis,
        'demos_kpis': demos_kpis,
        'certificaciones_lista': certificaciones_lista,
        'certificaciones_kpis': certificaciones_kpis,
        'certificaciones_filtros': certificaciones_filtros,
        'cursos_lista': cursos_lista,
        'cursos_kpis': cursos_kpis,
        'cursos_filtros': cursos_filtros,
        'clientes_tabla': clientes_tabla,
        'clientes_tabla_meta': clientes_tabla_meta,
        'potenciales_lista': potenciales_lista,
        'tabla_data': tabla_data,
        'mes_filter': mes_filter,
        'anio_filter': anio_filter,
        'anio_int': anio_int,
        'mes_nombre': mes_nombre,
        'mes_choices': mes_choices,
        'total_general': total_general,
        'total_facturado': total_facturado,
        'num_clientes': num_clientes,
        'num_deals': num_deals,
        'num_cobradas': num_cobradas,
        'meta': meta,
        'progreso': progreso,
        'progreso_visual': min(progreso, 100),
        'usuario': user,
        'years_range': range(2024, now.year + 2),
        'num_cotizaciones': num_cotizaciones,
        'num_oportunidades_cotizadas': num_oportunidades_cotizadas,
        'total_cotizado': total_cotizado,
        'total_cobrado': total_cobrado,
        'es_supervisor': es_supervisor,
        'es_ingeniero': es_ingeniero,
        'es_administrador': es_administrador,
        'vendedores_list': vendedores_list,
        'vendedores_filter': vendedores_filter,
        'vendedores_json': [
            {'id': v.id, 'nombre': v.get_full_name() or v.username}
            for v in vendedores_list
        ],
        'years_range_list': list(range(2024, now.year + 2)),
        'meses_selected': meses_list if meses_list is not None else [],   # [] = todos
        'anios_selected': anios_list if anios_list is not None else [],   # [] = todos
        'novedades_config': NovedadesConfig.get(),
        'empleado_mes_data': _get_empleado_mes_data(),
        'mis_grupos': _get_mis_grupos_ctx(user),
        'es_supervisor_de_grupo': _es_supervisor_de_grupo(user),
        'etapas_pipeline_json': _get_etapas_pipeline_json(),
        'pipelines_list': list(EtapaPipeline.objects.values_list('pipeline', flat=True).distinct().order_by('pipeline')) if EtapaPipeline.objects.exists() else ['runrate', 'proyecto'],
        'prospectos_por_etapa': prospectos_por_etapa,
    }
    return render(request, 'crm_home.html', context)


def _get_mis_grupos_ctx(user):
    """Grupos activos del usuario para el contexto del template."""
    from .views_grupos import get_grupos_del_usuario
    from .views_utils import is_supervisor as _is_sup
    if _is_sup(user):
        from .models import GrupoTrabajo
        return list(GrupoTrabajo.objects.filter(activo=True).values('id', 'nombre', 'color'))
    grupos = get_grupos_del_usuario(user)
    return [{'id': g.id, 'nombre': g.nombre, 'color': g.color} for g in grupos]


def _es_supervisor_de_grupo(user):
    from .models import GrupoTrabajo
    return GrupoTrabajo.objects.filter(supervisor_grupo=user, activo=True).exists()


@login_required
def api_crm_table_data(request):
    """
    API endpoint que devuelve los datos de la tabla CRM en JSON
    para actualizar sin recargar la página.
    """
    from datetime import datetime
    user = request.user
    profile, _ = UserProfile.objects.get_or_create(user=user)

    now = datetime.now()
    mes_filter = request.GET.get('mes', str(now.month).zfill(2))
    anio_filter = request.GET.get('anio', str(now.year))
    tab_activo = request.GET.get('tab', 'crm')
    desde_filter = request.GET.get('desde', '').strip()
    hasta_filter = request.GET.get('hasta', '').strip()
    usando_periodo = bool(desde_filter and hasta_filter)

    MES_CODE_TO_NAME = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
        '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
    }

    # Helpers multi-valor — mes/anio pueden venir como 'todos', valor único, o comma-separated
    def _parse_ints(s):
        if not s or s == 'todos':
            return None  # None = todos / no filter
        parts = [p.strip() for p in str(s).split(',') if p.strip()]
        out = []
        for p in parts:
            try: out.append(int(p))
            except ValueError: pass
        return out or None
    def _first_int(s, default):
        lst = _parse_ints(s)
        return lst[0] if lst else default

    anios_list = _parse_ints(anio_filter)
    meses_list = _parse_ints(mes_filter)
    anio_int = anios_list[0] if anios_list else now.year
    # mes_filter queda como string (backward-compat). mes_int (primer mes) para casos single-value
    mes_int_primero = meses_list[0] if meses_list else None

    mes_nombre_db = MES_CODE_TO_NAME.get(mes_filter, mes_filter)

    # Supervisor / Vendedor logic
    es_supervisor = is_supervisor(user)
    vendedores_filter = request.GET.get('vendedores', '')
    vendedores_ids = [int(x) for x in vendedores_filter.split(',') if x.strip().isdigit()] if vendedores_filter else []

    q_search = request.GET.get('q', '').strip()

    if q_search:
        # Búsqueda global: ignora mes/año, busca en nombre de oportunidad y cliente
        base_qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto', 'usuario__userprofile').filter(
            Q(oportunidad__icontains=q_search) | Q(cliente__nombre_empresa__icontains=q_search)
        )
    elif usando_periodo:
        base_qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto', 'usuario__userprofile').filter(
            fecha_creacion__date__gte=desde_filter,
            fecha_creacion__date__lte=hasta_filter,
        )
    else:
        base_qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto', 'usuario__userprofile')
        if anios_list is not None:
            base_qs = base_qs.filter(anio_cierre__in=anios_list)
        if meses_list is not None:
            # meses_list son ints, pero mes_cierre es string con zero-padding. Convertir.
            base_qs = base_qs.filter(mes_cierre__in=[str(m).zfill(2) for m in meses_list])

    if not es_supervisor:
        usuarios_visibles_r = get_usuarios_visibles_ids(user)
        if usuarios_visibles_r and len(usuarios_visibles_r) > 1:
            base_qs = base_qs.filter(usuario_id__in=usuarios_visibles_r)
        else:
            base_qs = base_qs.filter(usuario=user)
    elif vendedores_ids:
        base_qs = base_qs.filter(usuario_id__in=vendedores_ids)

    def format_money(val):
        if val is None:
            return '0'
        try:
            return '{:,.0f}'.format(val)
        except (ValueError, TypeError):
            return '0'

    # ── Calcular meta según tab (aplica a todos los tabs) ──
    meta_field_api = 'meta_mensual'
    if tab_activo == 'crm':
        meta_field_api = 'meta_oportunidades'
    elif tab_activo == 'cotizado':
        meta_field_api = 'meta_cotizado'
    elif tab_activo == 'cobrado':
        meta_field_api = 'meta_cobrado'
    elif tab_activo == 'clientes':
        _vista_cl = request.GET.get('vista', 'facturado')
        if _vista_cl == 'cobrado':
            meta_field_api = 'meta_cobrado'
        elif _vista_cl == 'oportunidades':
            meta_field_api = 'meta_oportunidades'
        elif _vista_cl == 'cotizado':
            meta_field_api = 'meta_cotizado'
        # else: facturado → meta_mensual (default)

    if es_supervisor:
        if vendedores_ids:
            api_meta = UserProfile.objects.filter(user_id__in=vendedores_ids).aggregate(
                t=Coalesce(Sum(meta_field_api), Value(Decimal('0')))
            )['t'] or Decimal('0')
        else:
            all_sellers_profiles = UserProfile.objects.filter(user__is_active=True).exclude(user__groups__name='Supervisores')
            api_meta = all_sellers_profiles.aggregate(t=Coalesce(Sum(meta_field_api), Value(Decimal('0'))))['t'] or Decimal('0')
    else:
        api_meta = getattr(profile, meta_field_api, Decimal('0')) or Decimal('0')

    if mes_filter == 'todos' and not usando_periodo:
        api_meta = api_meta * 12

    if tab_activo == 'crm':
        from django.utils import timezone as _tz
        from django.db.models import OuterRef, Exists as _Exists
        _now = _tz.now()
        _now_naive = _now.replace(tzinfo=None)
        _ESTADOS_ACTIVOS = ('pendiente', 'iniciada', 'en_progreso')

        # EXISTS subqueries — MySQL evalúa con short-circuit, 0 queries adicionales por fila
        _vencida_opp_sq = TareaOportunidad.objects.filter(
            oportunidad=OuterRef('pk'),
            estado__in=['pendiente', 'en_progreso'],
            fecha_limite__isnull=False,
            fecha_limite__lte=_now,
        )
        _vencida_tarea_sq = Tarea.objects.filter(
            oportunidad=OuterRef('pk'),
            estado__in=_ESTADOS_ACTIVOS,
            fecha_limite__isnull=False,
            fecha_limite__lte=_now,
        )
        # NO se revisan Actividad del calendario — muchas nunca se cierran y causan
        # falsos positivos. Sólo TareaOportunidad y Tarea (las del widget ACTIVIDAD PROGRAMADA).
        _pendiente_opp_sq = TareaOportunidad.objects.filter(
            oportunidad=OuterRef('pk'),
        ).exclude(estado='completada')

        items = base_qs.select_related('cliente', 'contacto', 'usuario').annotate(
            _tiene_vencida=_Exists(_vencida_opp_sq) | _Exists(_vencida_tarea_sq),
            _tiene_pendiente=_Exists(_pendiente_opp_sq),
        ).order_by('-fecha_actualizacion')

        # Prefetch de fecha_limite mínima vencida y próxima — usadas para
        # calcular dias_vencida / dias_hasta_proxima (gradient heat/warm
        # sin tener que re-render todo desde SSR)
        _ids = [i.id for i in items]
        _vencidas_min_opp = dict(TareaOportunidad.objects.filter(
            oportunidad_id__in=_ids,
            estado__in=['pendiente', 'en_progreso'],
            fecha_limite__isnull=False,
            fecha_limite__lte=_now,
        ).values_list('oportunidad_id').annotate(
            minf=models.Min('fecha_limite')
        ).values_list('oportunidad_id', 'minf'))
        _vencidas_min_tarea = dict(Tarea.objects.filter(
            oportunidad_id__in=_ids,
            estado__in=_ESTADOS_ACTIVOS,
            fecha_limite__isnull=False,
            fecha_limite__lte=_now,
        ).values_list('oportunidad_id').annotate(
            minf=models.Min('fecha_limite')
        ).values_list('oportunidad_id', 'minf'))
        _proxima_opp = dict(TareaOportunidad.objects.filter(
            oportunidad_id__in=_ids,
            estado__in=['pendiente', 'en_progreso'],
            fecha_limite__isnull=False,
            fecha_limite__gt=_now,
        ).values_list('oportunidad_id').annotate(
            minf=models.Min('fecha_limite')
        ).values_list('oportunidad_id', 'minf'))
        _proxima_tarea = dict(Tarea.objects.filter(
            oportunidad_id__in=_ids,
            estado__in=_ESTADOS_ACTIVOS,
            fecha_limite__isnull=False,
            fecha_limite__gt=_now,
        ).values_list('oportunidad_id').annotate(
            minf=models.Min('fecha_limite')
        ).values_list('oportunidad_id', 'minf'))

        rows = []
        for item in items:
            tiene_vencida = item._tiene_vencida
            tiene_pendiente = item._tiene_pendiente
            es_bitrix = item.tipo_negociacion == 'bitrix_proyecto'

            # dias_vencida + minutos_vencida: granularidad fina (un heat que
            # acaba de vencer hace 5 min no es lo mismo que uno vencido hace 30 días)
            dias_vencida = 0
            minutos_vencida = 0
            if tiene_vencida:
                _candidatos = [x for x in [_vencidas_min_opp.get(item.id), _vencidas_min_tarea.get(item.id)] if x]
                if _candidatos:
                    _min_vencida = min(_candidatos)
                    _delta = _now - _min_vencida
                    dias_vencida = max(0, _delta.days)
                    minutos_vencida = max(0, int(_delta.total_seconds() / 60))

            # dias_hasta_proxima + minutos_hasta_proxima
            dias_hasta_proxima = None
            minutos_hasta_proxima = None
            _prox = [x for x in [_proxima_opp.get(item.id), _proxima_tarea.get(item.id)] if x]
            if _prox:
                _min_prox = min(_prox)
                _delta = _min_prox - _now
                dias_hasta_proxima = max(0, _delta.days)
                minutos_hasta_proxima = max(0, int(_delta.total_seconds() / 60))

            rows.append({
                'id': item.id,
                'oportunidad': (item.oportunidad or '')[:35],
                'cliente': (item.cliente.nombre_empresa if item.cliente else '- Sin Cliente -')[:35],
                'cliente_id': item.cliente.id if item.cliente else None,
                'contacto': (item.contacto.nombre[:18] if item.contacto else '-'),
                'area': item.area or '-',
                'producto': item.producto or '',
                'monto': '0' if es_bitrix else format_money(item.monto),
                'fecha_iso': item.fecha_creacion.strftime('%Y-%m-%d'),
                'fecha_ts': int(item.fecha_actualizacion.timestamp()) if item.fecha_actualizacion else 0,
                'etapa': item.etapa_corta or '',
                'etapa_color': item.etapa_color or '#6B7280',
                'tiene_actividad_vencida': tiene_vencida,
                'dias_vencida': dias_vencida,
                'minutos_vencida': minutos_vencida,
                'dias_hasta_proxima': dias_hasta_proxima,
                'minutos_hasta_proxima': minutos_hasta_proxima,
                'sin_actividad_pendiente': not tiene_pendiente,
                'tipo_negociacion': item.tipo_negociacion or 'runrate',
            })
        # Ordenar: vencidas primero, luego por fecha_actualizacion más reciente
        rows.sort(key=lambda x: (not x['tiene_actividad_vencida'], -x.get('fecha_ts', 0)))
        # Stats
        total_general = base_qs.aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']
        num_clientes = base_qs.values('cliente').distinct().count()
        num_deals = base_qs.count()

        api_progreso = int((total_general / api_meta * 100)) if api_meta > 0 else 0

        return JsonResponse({
            'tab': 'crm',
            'rows': rows,
            'footer': {
                'left': f'{num_clientes} clientes / {num_deals} Deals',
                'right': f'Total: ${format_money(total_general)}',
            },
            'total_facturado': format_money(total_general),
            'widget_label': 'Total Oportunidades',
            'vista_label': 'Oportunidades',
            'meta': format_money(api_meta),
            'progreso': api_progreso,
            'widget_left_stat': f'{num_deals} Oportunidades Creadas',
        })

    elif tab_activo == 'cotizado':
        opp_ids = base_qs.values_list('id', flat=True)
        if usando_periodo:
            cotizaciones_qs = (
                Cotizacion.objects
                .select_related('oportunidad', 'created_by', 'cliente')
                .filter(
                    Q(oportunidad_id__in=opp_ids) |
                    Q(oportunidad__isnull=True,
                      fecha_creacion__date__gte=desde_filter,
                      fecha_creacion__date__lte=hasta_filter)
                )
                .order_by('-fecha_creacion')
            )
        else:
            cotizaciones_qs = (
                Cotizacion.objects
                .select_related('oportunidad', 'created_by', 'cliente')
                .filter(
                    Q(oportunidad_id__in=opp_ids) |
                    Q(oportunidad__isnull=True, fecha_creacion__year=anio_int)
                )
                .order_by('-fecha_creacion')
            )
        rows = []
        for cot in cotizaciones_qs:
            rows.append({
                'id': cot.id,
                'oportunidad': (cot.oportunidad.oportunidad if cot.oportunidad else '—')[:35],
                'oportunidad_id': cot.oportunidad.id if cot.oportunidad else None,
                'cliente': (cot.cliente.nombre_empresa if cot.cliente else '- Sin Cliente -')[:35],
                'cliente_id': cot.cliente.id if cot.cliente else None,
                'usuario': (cot.created_by.get_full_name() or cot.created_by.username) if cot.created_by else '—',
                'subtotal': format_money(cot.subtotal),
                'total': format_money(cot.total),
                'pdf_url': f'/app/cotizacion/view/{cot.id}/',
                'fecha_iso': cot.fecha_creacion.strftime('%Y-%m-%d'),
            })
        num_cotizaciones = cotizaciones_qs.count()
        num_oportunidades_cotizadas = cotizaciones_qs.exclude(oportunidad__isnull=True).values('oportunidad').distinct().count()
        total_cotizado = cotizaciones_qs.aggregate(t=Coalesce(Sum('total'), Value(Decimal('0'))))['t']
        api_progreso_cot = int((total_cotizado / api_meta * 100)) if api_meta > 0 else 0
        return JsonResponse({
            'tab': 'cotizado',
            'rows': rows,
            'footer': {
                'left': f'{num_oportunidades_cotizadas} oportunidades / {num_cotizaciones} cotizaciones',
                'right': f'Total cotizado: ${format_money(total_cotizado)}',
            },
            'total_facturado': format_money(total_cotizado),
            'widget_label': 'Total Cotizado',
            'meta': format_money(api_meta),
            'progreso': api_progreso_cot,
            'widget_left_stat': f'{num_cotizaciones} Cotizaciones Creadas',
            'num_total_cotizaciones': num_cotizaciones,
        })

    elif tab_activo == 'cobrado':
        items = base_qs.filter(etapa_corta__in=['Ganado', 'Pagado']).order_by('-monto')
        rows = []
        for op in items:
            rows.append({
                'id': op.id,
                'oportunidad': (op.oportunidad or '')[:35],
                'cliente': (op.cliente.nombre_empresa if op.cliente else '- Sin Cliente -')[:35],
                'cliente_id': op.cliente.id if op.cliente else None,
                'producto_display': op.get_producto_display(),
                'usuario': (op.usuario.get_full_name() or op.usuario.username) if op.usuario else '—',
                'fecha': op.fecha_creacion.strftime('%d %b %Y'),
                'fecha_iso': op.fecha_creacion.strftime('%Y-%m-%d'),
                'monto': format_money(op.monto),
            })
        total_cobrado = items.aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t']
        num_deals = items.count()
        api_progreso_cob = int((total_cobrado / api_meta * 100)) if api_meta > 0 else 0
        return JsonResponse({
            'tab': 'cobrado',
            'rows': rows,
            'footer': {
                'left': f'{num_deals} Deals Cobrados',
                'right': f'Total cobrado: ${format_money(total_cobrado)}',
            },
            'total_facturado': format_money(total_cobrado),
            'widget_label': 'Total Cobrado',
            'meta': format_money(api_meta),
            'progreso': api_progreso_cob,
            'widget_left_stat': f'{num_deals} Oportunidades Cobradas',
        })

    elif tab_activo == 'facturado':
        # Reutilizamos la lógica del view principal para facturación
        facturado_por_cliente_obj = {}
        try:
            if usando_periodo:
                from datetime import date as _date
                cur = _date.fromisoformat(desde_filter).replace(day=1)
                end = _date.fromisoformat(hasta_filter).replace(day=1)
                while cur <= end:
                    mes_code = cur.strftime('%m')
                    try:
                        af = ArchivoFacturacion.objects.get(mes=mes_code, anio=cur.year)
                        data_af = af.datos_json.get('datos', {})
                        for c_name, val in data_af.items():
                            facturado_por_cliente_obj[c_name] = facturado_por_cliente_obj.get(c_name, Decimal('0')) + Decimal(str(val))
                    except ArchivoFacturacion.DoesNotExist:
                        pass
                    cur = (cur.replace(month=cur.month % 12 + 1, day=1) if cur.month < 12
                           else cur.replace(year=cur.year + 1, month=1, day=1))
            elif mes_filter == 'todos':
                for af in ArchivoFacturacion.objects.filter(anio=anio_int):
                    data_af = af.datos_json.get('datos', {})
                    for c_name, val in data_af.items():
                        facturado_por_cliente_obj[c_name] = facturado_por_cliente_obj.get(c_name, Decimal('0')) + Decimal(str(val))
            elif meses_list is not None and len(meses_list) > 1:
                for af in ArchivoFacturacion.objects.filter(mes__in=[str(m).zfill(2) for m in meses_list], anio=anio_int):
                    data_af = af.datos_json.get('datos', {})
                    for c_name, val in data_af.items():
                        facturado_por_cliente_obj[c_name] = facturado_por_cliente_obj.get(c_name, Decimal('0')) + Decimal(str(val))
            else:
                af = ArchivoFacturacion.objects.get(mes=mes_filter, anio=anio_int)
                data_af = af.datos_json.get('datos', {})
                for c_name, val in data_af.items():
                    facturado_por_cliente_obj[c_name] = Decimal(str(val))
        except ArchivoFacturacion.DoesNotExist:
            pass

        # Mapear nombres a IDs de clientes
        fact_by_id = {}
        for name, monto in facturado_por_cliente_obj.items():
            cliente = Cliente.objects.filter(nombre_empresa__icontains=name).first()
            if cliente:
                fact_by_id[cliente.id] = fact_by_id.get(cliente.id, Decimal('0')) + monto

        # Desglose prod
        prod_data = base_qs.filter(monto_facturacion__gt=0).values('cliente').annotate(
            zebra=Coalesce(Sum('monto_facturacion', filter=Q(producto='ZEBRA')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            panduit=Coalesce(Sum('monto_facturacion', filter=Q(producto='PANDUIT')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            apc=Coalesce(Sum('monto_facturacion', filter=Q(producto='APC')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            avigilon=Coalesce(Sum('monto_facturacion', filter=Q(producto='AVIGILON') | Q(producto='AVIGILION')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            genetec=Coalesce(Sum('monto_facturacion', filter=Q(producto='GENETEC')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            axis=Coalesce(Sum('monto_facturacion', filter=Q(producto='AXIS')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            software=Coalesce(Sum('monto_facturacion', filter=Q(producto='SOFTWARE') | Q(producto='Desarrollo')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            runrate=Coalesce(Sum('monto_facturacion', filter=Q(producto='RUNRATE')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            poliza=Coalesce(Sum('monto_facturacion', filter=Q(producto='PÓLIZA') | Q(producto='POLIZA')), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
            total_prod=Coalesce(Sum('monto_facturacion'), Value(0, output_field=models.DecimalField(max_digits=12, decimal_places=2))),
        )
        prod_dict = {item['cliente']: item for item in prod_data}

        if es_supervisor:
            clientes_qs = Cliente.objects.filter(asignado_a_id__in=vendedores_ids) if vendedores_ids else Cliente.objects.all()
        else:
            clientes_qs = Cliente.objects.filter(get_clientes_visibles_q(user))

        rows = []
        total_facturado_acum = _calcular_total_desglose(mes_filter, anio_int)

        for c in clientes_qs.order_by('nombre_empresa'):
            p = prod_dict.get(c.id, {})
            fact = fact_by_id.get(c.id, Decimal('0'))
            meta_c = c.meta_mensual or Decimal('0')
            if mes_filter == 'todos' and not usando_periodo:
                meta_c = meta_c * 12
            rows.append({
                'cliente_id': c.id,
                'cliente': c.nombre_empresa[:35],
                'zebra': format_money(p.get('zebra')),
                'panduit': format_money(p.get('panduit')),
                'apc': format_money(p.get('apc')),
                'avigilon': format_money(p.get('avigilon')),
                'genetec': format_money(p.get('genetec')),
                'axis': format_money(p.get('axis')),
                'software': format_money(p.get('software')),
                'runrate': format_money(p.get('runrate')),
                'poliza': format_money(p.get('poliza')),
                'otros': format_money(p.get('total_prod', Decimal('0')) - sum(p.get(k, 0) for k in ['zebra','panduit','apc','avigilon','genetec','axis','software','runrate','poliza'] if k in p)),
                'total': format_money(fact),
                'meta_cliente': format_money(meta_c),
                'meta_restante': format_money(meta_c - fact),
            })

        api_progreso_fact = int((total_facturado_acum / api_meta * 100)) if api_meta > 0 else 0
        num_clientes_fact = clientes_qs.count()
        return JsonResponse({
            'tab': 'facturado',
            'rows': rows,
            'footer': {
                'left': f'{num_clientes_fact} clientes',
                'right': f'Total facturado: ${format_money(total_facturado_acum)}',
            },
            'total_facturado': format_money(total_facturado_acum),
            'widget_label': 'Total Facturado',
            'meta': format_money(api_meta),
            'progreso': api_progreso_fact,
            'widget_left_stat': f'{num_clientes_fact} Clientes',
        })

    elif tab_activo == 'clientes':
        vista = request.GET.get('vista', 'facturado')
        _dec_field = models.DecimalField(max_digits=14, decimal_places=2)
        _zero = Value(Decimal('0'), output_field=_dec_field)

        if es_supervisor:
            clientes_qs = Cliente.objects.select_related('asignado_a').filter(asignado_a_id__in=vendedores_ids) if vendedores_ids else Cliente.objects.select_related('asignado_a').all()
        else:
            clientes_qs = Cliente.objects.select_related('asignado_a').filter(asignado_a=user)

        # Para oportunidades y cotizado en Clientes: filtrar por fecha_creacion
        # en vez de mes_cierre, así no muestra datos de meses futuros
        if vista in ('oportunidades', 'cotizado') and not q_search:
            if usando_periodo:
                base_qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto', 'usuario__userprofile').filter(
                    fecha_creacion__date__gte=desde_filter,
                    fecha_creacion__date__lte=hasta_filter,
                )
            else:
                base_qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto', 'usuario__userprofile')
                if anios_list is not None:
                    base_qs = base_qs.filter(fecha_creacion__year__in=anios_list)
                if meses_list is not None:
                    base_qs = base_qs.filter(fecha_creacion__month__in=meses_list)
            # Re-aplicar filtros de usuario/vendedor
            if not es_supervisor:
                usuarios_visibles_r = get_usuarios_visibles_ids(user)
                if usuarios_visibles_r and len(usuarios_visibles_r) > 1:
                    base_qs = base_qs.filter(usuario_id__in=usuarios_visibles_r)
                else:
                    base_qs = base_qs.filter(usuario=user)
            elif vendedores_ids:
                base_qs = base_qs.filter(usuario_id__in=vendedores_ids)

        def _prod_annotate(qs, monto_field):
            return qs.values('cliente').annotate(
                zebra=Coalesce(Sum(monto_field, filter=Q(producto='ZEBRA')), _zero),
                panduit=Coalesce(Sum(monto_field, filter=Q(producto='PANDUIT')), _zero),
                apc=Coalesce(Sum(monto_field, filter=Q(producto='APC')), _zero),
                avigilon=Coalesce(Sum(monto_field, filter=Q(producto='AVIGILON') | Q(producto='AVIGILION')), _zero),
                genetec=Coalesce(Sum(monto_field, filter=Q(producto='GENETEC')), _zero),
                axis=Coalesce(Sum(monto_field, filter=Q(producto='AXIS')), _zero),
                software=Coalesce(Sum(monto_field, filter=Q(producto='SOFTWARE') | Q(producto='Desarrollo')), _zero),
                runrate=Coalesce(Sum(monto_field, filter=Q(producto='RUNRATE')), _zero),
                poliza=Coalesce(Sum(monto_field, filter=Q(producto='PÓLIZA') | Q(producto='POLIZA')), _zero),
                total_prod=Coalesce(Sum(monto_field), _zero),
            )

        _prev_by_id_cl = {}  # previous month totals per client (oportunidades only)
        _prev_sum = Decimal('0')  # previous month global total for this vista

        # Helper: compute prev month params (solo aplica si hay UN solo mes seleccionado)
        def _get_prev_params():
            if mes_filter in ('todos',) or usando_periodo or q_search:
                return None, None
            if not meses_list or len(meses_list) != 1:
                return None, None
            try:
                pm = meses_list[0]
                return str(pm - 1 if pm > 1 else 12).zfill(2), anio_int if pm > 1 else anio_int - 1
            except (ValueError, TypeError):
                return None, None

        _total_facturado_excel = Decimal('0')
        _total_cobrado_csv = Decimal('0')

        if vista == 'facturado':
            # Total desde ArchivoFacturacion
            facturado_por_cliente_obj = {}

            def _extract_entries(datos_json):
                """Extrae lista de {nombre, rfc, monto} del datos_json (soporta 3 formatos)"""
                if not datos_json:
                    return []
                entries = []
                for key, val in datos_json.items():
                    if key == 'datos':
                        continue
                    if isinstance(val, dict) and 'monto' in val:
                        # Formato nuevo: {rfc_or_name: {nombre, rfc, monto}}
                        entries.append({
                            'nombre': val.get('nombre', key),
                            'rfc': val.get('rfc', ''),
                            'monto': Decimal(str(val['monto'])),
                        })
                    else:
                        # Formato viejo: {nombre: monto_str}
                        try:
                            entries.append({'nombre': key, 'rfc': '', 'monto': Decimal(str(val))})
                        except Exception:
                            pass
                return entries

            # Acumular facturado por RFC o nombre
            _facturado_entries = []  # [{nombre, rfc, monto}]
            try:
                def _load_af(af):
                    return _extract_entries(af.datos_json)
                if usando_periodo:
                    from datetime import date as _date
                    cur = _date.fromisoformat(desde_filter).replace(day=1)
                    end = _date.fromisoformat(hasta_filter).replace(day=1)
                    while cur <= end:
                        try:
                            af = ArchivoFacturacion.objects.get(mes=cur.strftime('%m'), anio=cur.year)
                            _facturado_entries.extend(_load_af(af))
                        except ArchivoFacturacion.DoesNotExist:
                            pass
                        cur = cur.replace(month=cur.month % 12 + 1, day=1) if cur.month < 12 else cur.replace(year=cur.year + 1, month=1, day=1)
                elif mes_filter == 'todos':
                    for af in ArchivoFacturacion.objects.filter(anio=anio_int):
                        _facturado_entries.extend(_load_af(af))
                elif meses_list is not None and len(meses_list) > 1:
                    for af in ArchivoFacturacion.objects.filter(mes__in=[str(m).zfill(2) for m in meses_list], anio=anio_int):
                        _facturado_entries.extend(_load_af(af))
                else:
                    af = ArchivoFacturacion.objects.get(mes=mes_filter, anio=anio_int)
                    _facturado_entries.extend(_load_af(af))
            except ArchivoFacturacion.DoesNotExist:
                pass

            # Match entries → Cliente: primero por RFC, luego por nombre
            _all_clientes_api = list(clientes_qs)
            _rfc_map = {c.rfc.upper().strip(): c for c in _all_clientes_api if c.rfc}
            # (2026-06-10, perf) Match exacto por dict O(1) — el scan lineal
            # solo queda para los fallbacks de substring/palabras.
            _nombre_map = {c.nombre_empresa.upper().strip(): c
                           for c in _all_clientes_api if c.nombre_empresa}
            total_by_id = {}
            for entry in _facturado_entries:
                c_obj = None
                rfc = entry['rfc'].upper().strip() if entry['rfc'] else ''
                nombre = entry['nombre']
                monto = entry['monto']
                # 1) Match por RFC (mas confiable)
                if rfc and rfc in _rfc_map:
                    c_obj = _rfc_map[rfc]
                # 2) Match por nombre (fallback)
                if not c_obj:
                    cn_upper = nombre.upper().strip()
                    c_obj = _nombre_map.get(cn_upper)
                    if not c_obj:
                        for c in _all_clientes_api:
                            if not c.nombre_empresa: continue
                            crm_u = c.nombre_empresa.upper().strip()
                            if crm_u in cn_upper or cn_upper in crm_u:
                                c_obj = c; break
                    if not c_obj:
                        pw = [w for w in cn_upper.split() if len(w) > 2 and w not in ('DE','DEL','LA','LAS','LOS','EL','SA','CV','SAS','INC','MEXICO')]
                        if len(pw) >= 2:
                            for c in _all_clientes_api:
                                if not c.nombre_empresa: continue
                                if pw[0] in c.nombre_empresa.upper() and pw[1] in c.nombre_empresa.upper():
                                    c_obj = c; break
                if c_obj:
                    total_by_id[c_obj.id] = total_by_id.get(c_obj.id, Decimal('0')) + monto
            # Total real del Excel (todos los entries, no solo los matcheados)
            _total_facturado_excel = sum(e['monto'] for e in _facturado_entries)
            prod_dict = {item['cliente']: item for item in _prod_annotate(base_qs.filter(monto_facturacion__gt=0), 'monto_facturacion')}
            meta_field_c = 'meta_mensual'
            vista_label = 'Facturado'
            # Prev month facturado sum
            _pm, _pa = _get_prev_params()
            if _pm:
                try:
                    _paf = ArchivoFacturacion.objects.get(mes=_pm, anio=_pa)
                    _prev_sum = sum(e['monto'] for e in _extract_entries(_paf.datos_json))
                except ArchivoFacturacion.DoesNotExist:
                    pass

        elif vista == 'cobrado':
            # Cobrado viene EXCLUSIVAMENTE del CSV (ArchivoCobrado), no de oportunidades
            _cobrado_entries = []  # [{nombre, monto}]
            _total_cobrado_csv = Decimal('0')
            try:
                def _extract_cobrado_entries(datos_json):
                    if not datos_json:
                        return []
                    entries = []
                    for key, val in datos_json.items():
                        if isinstance(val, dict) and 'monto' in val:
                            entries.append({
                                'nombre': val.get('nombre', key),
                                'monto': Decimal(str(val['monto'])),
                            })
                    return entries

                if usando_periodo:
                    from datetime import date as _date
                    cur = _date.fromisoformat(desde_filter).replace(day=1)
                    end = _date.fromisoformat(hasta_filter).replace(day=1)
                    while cur <= end:
                        try:
                            ac = ArchivoCobrado.objects.get(mes=cur.strftime('%m'), anio=cur.year)
                            _cobrado_entries.extend(_extract_cobrado_entries(ac.datos_json))
                        except ArchivoCobrado.DoesNotExist:
                            pass
                        cur = cur.replace(month=cur.month % 12 + 1, day=1) if cur.month < 12 else cur.replace(year=cur.year + 1, month=1, day=1)
                elif mes_filter == 'todos':
                    for ac in ArchivoCobrado.objects.filter(anio=anio_int):
                        _cobrado_entries.extend(_extract_cobrado_entries(ac.datos_json))
                elif meses_list is not None and len(meses_list) > 1:
                    for ac in ArchivoCobrado.objects.filter(mes__in=[str(m).zfill(2) for m in meses_list], anio=anio_int):
                        _cobrado_entries.extend(_extract_cobrado_entries(ac.datos_json))
                else:
                    ac = ArchivoCobrado.objects.get(mes=mes_filter, anio=anio_int)
                    _cobrado_entries.extend(_extract_cobrado_entries(ac.datos_json))
            except ArchivoCobrado.DoesNotExist:
                pass

            # Cargar alias manuales
            alias_map = {a.palabra_clave.upper().strip(): a.buscar_como.upper().strip()
                         for a in AliasCliente.objects.all()}

            # Match entries → Cliente por nombre (usando misma lógica que facturado)
            _all_clientes_cob = list(clientes_qs)
            # (2026-06-10, perf) Match exacto por dict O(1).
            _nombre_map_cob = {c.nombre_empresa.upper().strip(): c
                               for c in _all_clientes_cob if c.nombre_empresa}
            total_by_id = {}
            for entry in _cobrado_entries:
                c_obj = None
                nombre = entry['nombre']
                monto = entry['monto']
                cn_upper = nombre.upper().strip()
                # Aplicar alias si existe
                if cn_upper in alias_map:
                    cn_upper = alias_map[cn_upper]
                # Match por nombre
                c_obj = _nombre_map_cob.get(cn_upper)
                if not c_obj:
                    for c in _all_clientes_cob:
                        if not c.nombre_empresa: continue
                        crm_u = c.nombre_empresa.upper().strip()
                        if crm_u in cn_upper or cn_upper in crm_u:
                            c_obj = c; break
                if not c_obj:
                    pw = [w for w in cn_upper.split() if len(w) > 2 and w not in ('DE','DEL','LA','LAS','LOS','EL','SA','CV','SAS','INC','MEXICO')]
                    if len(pw) >= 2:
                        for c in _all_clientes_cob:
                            if not c.nombre_empresa: continue
                            if pw[0] in c.nombre_empresa.upper() and pw[1] in c.nombre_empresa.upper():
                                c_obj = c; break
                if c_obj:
                    total_by_id[c_obj.id] = total_by_id.get(c_obj.id, Decimal('0')) + monto
            _total_cobrado_csv = sum(e['monto'] for e in _cobrado_entries)
            prod_dict = {}
            meta_field_c = 'meta_cobrado'
            vista_label = 'Cobrado'
            # Prev month cobrado sum (también del CSV)
            _pm, _pa = _get_prev_params()
            if _pm:
                try:
                    _prev_ac = ArchivoCobrado.objects.get(mes=_pm, anio=_pa)
                    _prev_sum = sum(e['monto'] for e in _extract_cobrado_entries(_prev_ac.datos_json))
                except ArchivoCobrado.DoesNotExist:
                    pass

        elif vista == 'oportunidades':
            total_by_id = {item['cliente']: item['t'] for item in base_qs.values('cliente').annotate(t=Coalesce(Sum('monto'), _zero)) if item['cliente']}
            prod_dict = {item['cliente']: item for item in _prod_annotate(base_qs, 'monto')}
            meta_field_c = 'meta_oportunidades'
            vista_label = 'Oportunidades'
            # Previous month totals per client (for trend badge) — usa fecha_creacion
            _prev_by_id_cl = {}
            if mes_filter not in ('todos',) and not usando_periodo and not q_search and meses_list and len(meses_list) == 1:
                try:
                    _pm = meses_list[0]
                    _prev_mes = _pm - 1 if _pm > 1 else 12
                    _prev_anio = anio_int if _pm > 1 else anio_int - 1
                    _prev_qs = TodoItem.objects.filter(fecha_creacion__year=_prev_anio, fecha_creacion__month=_prev_mes)
                    if not es_supervisor:
                        _gids = get_usuarios_visibles_ids(user)
                        _prev_qs = _prev_qs.filter(usuario_id__in=_gids) if _gids and len(_gids) > 1 else _prev_qs.filter(usuario=user)
                    elif vendedores_ids:
                        _prev_qs = _prev_qs.filter(usuario_id__in=vendedores_ids)
                    _prev_by_id_cl = {
                        item['cliente']: item['t']
                        for item in _prev_qs.values('cliente').annotate(t=Coalesce(Sum('monto'), _zero))
                        if item['cliente']
                    }
                except (ValueError, TypeError):
                    pass
            _prev_sum = sum(_prev_by_id_cl.values()) if _prev_by_id_cl else Decimal('0')

        elif vista == 'cotizado':
            opp_ids = base_qs.values_list('id', flat=True)
            if usando_periodo:
                cot_qs = Cotizacion.objects.select_related('cliente', 'oportunidad').filter(
                    Q(oportunidad_id__in=opp_ids) | Q(oportunidad__isnull=True, fecha_creacion__date__gte=desde_filter, fecha_creacion__date__lte=hasta_filter)
                )
            else:
                _cot_sueltas_q = Q(oportunidad__isnull=True)
                if anios_list is not None:
                    _cot_sueltas_q &= Q(fecha_creacion__year__in=anios_list)
                if meses_list is not None:
                    _cot_sueltas_q &= Q(fecha_creacion__month__in=meses_list)
                cot_qs = Cotizacion.objects.select_related('cliente', 'oportunidad').filter(
                    Q(oportunidad_id__in=opp_ids) | _cot_sueltas_q
                )
            total_by_id = {}
            count_by_id = {}
            prod_dict_raw = {}
            PRODS = ['ZEBRA', 'PANDUIT', 'APC', 'AVIGILON', 'GENETEC', 'AXIS', 'SOFTWARE', 'RUNRATE', 'PÓLIZA']
            PROD_KEYS = ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza']
            for cot in cot_qs:
                if not cot.cliente_id:
                    continue
                cid = cot.cliente_id
                t = cot.total or Decimal('0')
                total_by_id[cid] = total_by_id.get(cid, Decimal('0')) + t
                count_by_id[cid] = count_by_id.get(cid, 0) + 1
                prod = (cot.oportunidad.producto if cot.oportunidad else '') or ''
                prod_upper = prod.upper()
                if cid not in prod_dict_raw:
                    prod_dict_raw[cid] = {k: Decimal('0') for k in PROD_KEYS + ['total_prod']}
                prod_dict_raw[cid]['total_prod'] += t
                if 'ZEBRA' in prod_upper: prod_dict_raw[cid]['zebra'] += t
                elif 'PANDUIT' in prod_upper: prod_dict_raw[cid]['panduit'] += t
                elif prod_upper == 'APC': prod_dict_raw[cid]['apc'] += t
                elif 'AVIGILON' in prod_upper or 'AVIGILION' in prod_upper: prod_dict_raw[cid]['avigilon'] += t
                elif 'GENETEC' in prod_upper: prod_dict_raw[cid]['genetec'] += t
                elif 'AXIS' in prod_upper: prod_dict_raw[cid]['axis'] += t
                elif 'SOFTWARE' in prod_upper or 'DESARROLLO' in prod_upper: prod_dict_raw[cid]['software'] += t
                elif 'RUNRATE' in prod_upper: prod_dict_raw[cid]['runrate'] += t
                elif 'PÓLIZA' in prod_upper or 'POLIZA' in prod_upper: prod_dict_raw[cid]['poliza'] += t
            prod_dict = prod_dict_raw
            meta_field_c = 'meta_cotizado'
            vista_label = 'Cotizado'
            # Prev month cotizado sum — usa fecha_creacion
            _pm, _pa = _get_prev_params()
            if _pm:
                try:
                    _prev_opp_ids = TodoItem.objects.filter(fecha_creacion__year=_pa, fecha_creacion__month=int(_pm))
                    if not es_supervisor:
                        _gids = get_usuarios_visibles_ids(user)
                        _prev_opp_ids = _prev_opp_ids.filter(usuario_id__in=_gids) if _gids and len(_gids) > 1 else _prev_opp_ids.filter(usuario=user)
                    elif vendedores_ids:
                        _prev_opp_ids = _prev_opp_ids.filter(usuario_id__in=vendedores_ids)
                    _prev_cot_qs = Cotizacion.objects.filter(
                        Q(oportunidad_id__in=_prev_opp_ids) |
                        Q(oportunidad__isnull=True, fecha_creacion__year=_pa, fecha_creacion__month=int(_pm))
                    )
                    _prev_sum = _prev_cot_qs.aggregate(t=Coalesce(Sum('total'), _zero))['t'] or _zero
                except Exception:
                    pass
        elif vista == 'prospeccion':
          try:
            from .models import Prospecto, CampanaEnvio

            # Define clientes queryset for this scope
            if es_supervisor:
                clientes_qs = Cliente.objects.filter(asignado_a_id__in=vendedores_ids) if vendedores_ids else Cliente.objects.all()
            else:
                clientes_qs = Cliente.objects.filter(get_clientes_visibles_q(user))

            prospectos_qs = Prospecto.objects.filter(fecha_creacion__year__in=anios_list) if anios_list is not None else Prospecto.objects.filter(fecha_creacion__year=anio_int)
            if meses_list is not None:
                prospectos_qs = prospectos_qs.filter(fecha_creacion__month__in=meses_list)
            if not es_supervisor:
                _gids = get_usuarios_visibles_ids(user)
                prospectos_qs = prospectos_qs.filter(usuario_id__in=_gids) if _gids and len(_gids) > 1 else prospectos_qs.filter(usuario=user)
            elif vendedores_ids:
                prospectos_qs = prospectos_qs.filter(usuario_id__in=vendedores_ids)

            prosp_by_client = {}
            ganados_by_client = {}
            for p in prospectos_qs.select_related('cliente'):
                cid = p.cliente_id
                if not cid:
                    continue
                prosp_by_client[cid] = prosp_by_client.get(cid, 0) + 1
                if p.etapa == 'cerrado_ganado':
                    ganados_by_client[cid] = ganados_by_client.get(cid, 0) + 1

            # Campañas enviadas por cliente (graceful if table doesn't exist yet)
            camp_by_client = {}
            total_envios = 0
            total_respondidos = 0
            total_favorables = 0
            try:
                envios_qs = CampanaEnvio.objects.filter(fecha_envio__year__in=anios_list) if anios_list is not None else CampanaEnvio.objects.filter(fecha_envio__year=anio_int)
                if meses_list is not None:
                    envios_qs = envios_qs.filter(fecha_envio__month__in=meses_list)
                if not es_supervisor:
                    envios_qs = envios_qs.filter(enviado_por=user)
                elif vendedores_ids:
                    envios_qs = envios_qs.filter(enviado_por_id__in=vendedores_ids)
                for env in envios_qs:
                    cid = env.cliente_id
                    if cid:
                        camp_by_client[cid] = camp_by_client.get(cid, 0) + 1
                total_envios = envios_qs.count()
                total_respondidos = envios_qs.filter(respondido=True).count()
                total_favorables = envios_qs.filter(respuesta_favorable=True).count()
            except Exception:
                pass  # Table may not exist yet

            # Ventas generadas desde prospeccion
            ventas_prosp = Decimal('0')
            try:
                opps_from_prosp = base_qs.filter(
                    Q(prospecto_origen_directo__isnull=False)
                    | Q(prospecto_origen__isnull=False)
                ).distinct()
                opps_vendidas = opps_from_prosp.filter(
                    Q(etapa_corta__icontains='vendido') | Q(etapa_corta__icontains='comprando') |
                    Q(etapa_corta__icontains='transito') | Q(etapa_corta__icontains='entregado') |
                    Q(etapa_corta__icontains='facturado') | Q(etapa_corta__icontains='cobrado') |
                    Q(probabilidad_cierre=100)
                )
                ventas_prosp = opps_vendidas.aggregate(t=Coalesce(Sum('monto'), Value(Decimal('0'))))['t'] or Decimal('0')
                total_opps_from_prosp_count = opps_from_prosp.count()
            except Exception:
                opps_from_prosp = TodoItem.objects.none()
                total_opps_from_prosp_count = 0

            # Chart data
            marca_counts = {}
            etapa_counts = {}
            for p in prospectos_qs:
                marca = (p.producto or 'OTRO').upper()
                marca_counts[marca] = marca_counts.get(marca, 0) + 1
                etapa_counts[p.etapa] = etapa_counts.get(p.etapa, 0) + 1

            all_client_ids = set(list(prosp_by_client.keys()) + list(camp_by_client.keys()))
            # Pre-load client names into dict for fast lookup
            client_map = {c.id: c for c in clientes_qs.filter(id__in=all_client_ids)}
            prosp_rows = []
            total_prosp = 0
            total_camp = 0
            total_ganados = 0
            for cid in sorted(all_client_ids, key=lambda x: (client_map.get(x).nombre_empresa if client_map.get(x) else '')):
                c_obj = client_map.get(cid)
                n_prosp = prosp_by_client.get(cid, 0)
                n_camp = camp_by_client.get(cid, 0)
                n_ganados = ganados_by_client.get(cid, 0)
                total_prosp += n_prosp
                total_camp += n_camp
                total_ganados += n_ganados
                prosp_rows.append({
                    'cliente_id': cid,
                    'cliente': (c_obj.nombre_empresa if c_obj else 'Sin nombre')[:35],
                    'vendedor': (c_obj.asignado_a.get_full_name() if c_obj and c_obj.asignado_a else ''),
                    'num_prospectos': n_prosp,
                    'num_campanas': n_camp,
                    'num_ganados': n_ganados,
                })

            num_clientes_prosp = len([r for r in prosp_rows if r['num_prospectos'] > 0])
            tasa_contacto = round(total_respondidos / total_envios * 100) if total_envios > 0 else 0

            return JsonResponse({
                'tab': 'clientes',
                'vista': 'prospeccion',
                'vista_label': 'Prospección',
                'rows': prosp_rows,
                'footer': {
                    'left': f'{num_clientes_prosp} clientes prospectados',
                    'right': f'{total_prosp} prospectos',
                },
                'total_prospectos': total_prosp,
                'total_campanas': total_camp,
                'total_ganados': total_ganados,
                'total_opps_from_prosp': total_opps_from_prosp_count,
                'ventas_generadas': format_money(ventas_prosp),
                'ventas_generadas_raw': float(ventas_prosp),
                'tasa_contacto': tasa_contacto,
                'total_envios': total_envios,
                'total_respondidos': total_respondidos,
                'total_favorables': total_favorables,
                'chart_marcas': marca_counts,
                'chart_etapas': etapa_counts,
                'meta': '0',
                'progreso': 0,
            })
          except Exception as e:
            import traceback
            traceback.print_exc()
            return JsonResponse({
                'tab': 'clientes', 'vista': 'prospeccion',
                'rows': [], 'footer': {'left': 'Error', 'right': str(e)},
                'total_prospectos': 0, 'total_campanas': 0, 'total_ganados': 0,
                'total_opps_from_prosp': 0, 'ventas_generadas': '0', 'ventas_generadas_raw': 0,
                'tasa_contacto': 0, 'total_envios': 0, 'total_respondidos': 0, 'total_favorables': 0,
                'chart_marcas': {}, 'chart_etapas': {}, 'meta': '0', 'progreso': 0,
            })

        else:
            return JsonResponse({'tab': 'clientes', 'rows': [], 'footer': {'left': '', 'right': ''}, 'vista': vista})

        rows = []
        total_acum = Decimal('0')
        for c in clientes_qs.order_by('nombre_empresa'):
            p = prod_dict.get(c.id, {})
            total_c = total_by_id.get(c.id, Decimal('0'))
            meta_c = getattr(c, meta_field_c, Decimal('0')) or Decimal('0')
            if mes_filter == 'todos' and not usando_periodo:
                meta_c = meta_c * 12
            faltante = meta_c - total_c
            vendedor_name = (c.asignado_a.get_full_name() or c.asignado_a.username) if c.asignado_a else ''
            rows.append({
                'cliente_id': c.id,
                'cliente': c.nombre_empresa[:35],
                'vendedor': vendedor_name,
                'zebra': format_money(p.get('zebra', 0)),
                'panduit': format_money(p.get('panduit', 0)),
                'apc': format_money(p.get('apc', 0)),
                'avigilon': format_money(p.get('avigilon', 0)),
                'genetec': format_money(p.get('genetec', 0)),
                'axis': format_money(p.get('axis', 0)),
                'software': format_money(p.get('software', 0)),
                'runrate': format_money(p.get('runrate', 0)),
                'poliza': format_money(p.get('poliza', 0)),
                'otros': format_money((p.get('total_prod', Decimal('0')) or Decimal('0')) - sum((p.get(k, Decimal('0')) or Decimal('0')) for k in ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza'])),
                'total': format_money(total_c),
                '_total_raw': float(total_c),
                'meta': format_money(meta_c),
                'faltante': format_money(faltante),
                'prev_total': format_money(_prev_by_id_cl.get(c.id, Decimal('0'))),
                'num_cotizaciones': count_by_id.get(c.id, 0) if vista == 'cotizado' else 0,
            })
            total_acum += total_c

        # Ordenar por total de mayor a menor
        rows.sort(key=lambda r: r.get('_total_raw', 0), reverse=True)

        num_clientes_c = clientes_qs.count()

        # For cotizado vista, return number-based KPI
        if vista == 'cotizado':
            total_num_cot = sum(count_by_id.values())
            return JsonResponse({
                'tab': 'clientes',
                'vista': vista,
                'vista_label': vista_label,
                'rows': rows,
                'footer': {
                    'left': f'{num_clientes_c} clientes',
                    'right': f'Total: {total_num_cot} cotizaciones',
                },
                'total_facturado': str(total_num_cot),
                'total_monto_cotizado': format_money(total_acum),
                'widget_label': 'Cotizaciones Creadas',
                'meta': format_money(api_meta),
                'progreso': int((total_num_cot / int(api_meta) * 100)) if api_meta > 0 else 0,
                'widget_left_stat': f'{num_clientes_c} Clientes',
                'prev_sum': format_money(_prev_sum),
                'num_total_cotizaciones': total_num_cot,
            })

        # Para vista facturado/cobrado, usar el total real del archivo (incluye clientes sin match)
        if vista == 'facturado':
            _kpi_total = _total_facturado_excel
        elif vista == 'cobrado':
            _kpi_total = _total_cobrado_csv
        else:
            _kpi_total = total_acum
        return JsonResponse({
            'tab': 'clientes',
            'vista': vista,
            'vista_label': vista_label,
            'rows': rows,
            'footer': {
                'left': f'{num_clientes_c} clientes',
                'right': f'Total {vista_label}: ${format_money(_kpi_total)}',
            },
            'total_facturado': format_money(_kpi_total),
            'widget_label': f'Total {vista_label}',
            'meta': format_money(api_meta),
            'progreso': int((_kpi_total / api_meta * 100)) if api_meta > 0 else 0,
            'widget_left_stat': f'{num_clientes_c} Clientes',
            'prev_sum': format_money(_prev_sum),
        })

    return JsonResponse({'tab': tab_activo, 'rows': [], 'footer': {'left': '', 'right': ''}})


@login_required
@require_http_methods(["GET"])
def api_tendencia_mensual(request):
    """Devuelve totales mensuales de Facturado, Cobrado, Oportunidades y Cotizado
    para los últimos 6 meses, usado por la gráfica de tendencia."""
    from datetime import datetime
    from decimal import Decimal

    user = request.user
    profile, _ = UserProfile.objects.get_or_create(user=user)
    from .views_utils import is_supervisor as _is_sup
    es_supervisor = _is_sup(user)

    # Determinar vendedores a filtrar
    vendedores_ids = None
    if es_supervisor:
        vf = request.GET.get('vendedores', '')
        if vf and vf != 'todos':
            vendedores_ids = [int(x) for x in vf.split(',') if x.isdigit()]

    now = datetime.now()
    meses = []
    for i in range(5, -1, -1):
        m = now.month - i
        a = now.year
        while m <= 0:
            m += 12
            a -= 1
        meses.append((str(m).zfill(2), a))

    _zero = Decimal('0')
    labels = []
    data_fact = []
    data_cob = []
    data_opp = []
    data_cot = []

    nombres_mes = {
        '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
        '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
        '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
    }

    for mes_str, anio in meses:
        labels.append(f"{nombres_mes[mes_str]} {anio}")

        # Facturado — desde ArchivoFacturacion
        fact_total = _zero
        try:
            af = ArchivoFacturacion.objects.get(mes=mes_str, anio=anio)
            datos = af.datos_json or {}
            for key, val in datos.items():
                if key == 'datos':
                    continue
                if isinstance(val, dict) and 'monto' in val:
                    fact_total += Decimal(str(val['monto']))
                else:
                    try:
                        fact_total += Decimal(str(val))
                    except Exception:
                        pass
        except ArchivoFacturacion.DoesNotExist:
            pass
        data_fact.append(float(fact_total))

        # Base queryset para oportunidades del mes
        opp_qs = TodoItem.objects.filter(anio_cierre=anio, mes_cierre=mes_str)
        if not es_supervisor:
            _gids = get_usuarios_visibles_ids(user)
            opp_qs = opp_qs.filter(usuario_id__in=_gids) if _gids and len(_gids) > 1 else opp_qs.filter(usuario=user)
        elif vendedores_ids:
            opp_qs = opp_qs.filter(usuario_id__in=vendedores_ids)

        # Cobrado — etapa Ganado/Pagado
        cob = opp_qs.filter(etapa_corta__in=['Ganado', 'Pagado']).aggregate(
            t=Coalesce(Sum('monto'), _zero))['t'] or _zero
        data_cob.append(float(cob))

        # Oportunidades — todas
        opp = opp_qs.aggregate(t=Coalesce(Sum('monto'), _zero))['t'] or _zero
        data_opp.append(float(opp))

        # Cotizado
        opp_ids = opp_qs.values_list('id', flat=True)
        cot = Cotizacion.objects.filter(
            Q(oportunidad_id__in=opp_ids) |
            Q(oportunidad__isnull=True, fecha_creacion__year=anio, fecha_creacion__month=int(mes_str))
        ).aggregate(t=Coalesce(Sum('total'), _zero))['t'] or _zero
        data_cot.append(float(cot))

    # Detectar puntos notables (cambios > 30% respecto al mes anterior)
    def find_annotations(data, label):
        annotations = []
        for i in range(1, len(data)):
            if data[i - 1] > 0:
                cambio = (data[i] - data[i - 1]) / data[i - 1] * 100
                if abs(cambio) >= 30:
                    annotations.append({
                        'index': i,
                        'cambio': round(cambio),
                        'label': label
                    })
        return annotations

    anotaciones = []
    anotaciones.extend(find_annotations(data_fact, 'Facturado'))
    anotaciones.extend(find_annotations(data_cob, 'Cobrado'))
    anotaciones.extend(find_annotations(data_opp, 'Oportunidades'))
    anotaciones.extend(find_annotations(data_cot, 'Cotizado'))

    return JsonResponse({
        'labels': labels,
        'facturado': data_fact,
        'cobrado': data_cob,
        'oportunidades': data_opp,
        'cotizado': data_cot,
        'anotaciones': anotaciones,
    })


@login_required
@require_http_methods(["GET"])
def api_desglose_facturacion(request):
    """Desglose completo de facturación del Excel por cliente (sin filtro de match)"""
    try:
        mes = request.GET.get('mes', 'todos')
        anio_raw = request.GET.get('anio', '2026')
        vendedores_raw = (request.GET.get('vendedores') or '').strip()
        vendedores_ids = set()
        if vendedores_raw:
            for v in vendedores_raw.split(','):
                v = v.strip()
                if v.isdigit():
                    vendedores_ids.add(int(v))

        def _parse_ints(s, default=None):
            if not s or s == 'todos':
                return None
            parts = [p.strip() for p in str(s).split(',') if p.strip()]
            out = []
            for p in parts:
                try: out.append(int(p))
                except ValueError: pass
            return out or default

        anios_list = _parse_ints(anio_raw, default=[2026])
        meses_list = _parse_ints(mes)
        acumulado = {}  # {key: {nombre, rfc, monto}}

        def _procesar_af(af):
            raw = af.datos_json or {}
            for key, val in raw.items():
                if key == 'datos':
                    continue
                if isinstance(val, dict) and 'monto' in val:
                    nombre = val.get('nombre', key)
                    rfc = val.get('rfc', '')
                    monto = float(Decimal(str(val['monto'])))
                else:
                    nombre = key
                    rfc = ''
                    try:
                        monto = float(Decimal(str(val)))
                    except Exception:
                        continue
                k = rfc if rfc else nombre
                if k in acumulado:
                    acumulado[k]['monto'] += monto
                else:
                    acumulado[k] = {'nombre': nombre, 'rfc': rfc, 'monto': monto}

        af_qs = ArchivoFacturacion.objects.filter(anio__in=anios_list) if anios_list else ArchivoFacturacion.objects.all()
        if meses_list is not None:
            af_qs = af_qs.filter(mes__in=[str(m).zfill(2) for m in meses_list])
        for af in af_qs:
            _procesar_af(af)

        rows = sorted(acumulado.values(), key=lambda x: -x['monto'])

        # Resolver el VENDEDOR de cada fila vía el cliente asignado en el sistema
        # (Cliente.asignado_a). El Excel de facturación no trae vendedor, así que
        # se deduce por match de nombre de cliente (con alias). Se hace para TODAS
        # las filas para poder mostrar la columna "Vendedor".
        all_clientes = list(Cliente.objects.select_related('asignado_a').all())
        alias_map = {a.palabra_clave.upper().strip(): a.buscar_como.upper().strip()
                     for a in AliasCliente.objects.all()}
        for row in rows:
            matches = _match_clientes_cobrado(row['nombre'], all_clientes, alias_map)
            vid = None
            vname = ''
            for m in matches:
                if m.asignado_a_id:
                    vid = m.asignado_a_id
                    vname = (m.asignado_a.get_full_name() or m.asignado_a.username) if m.asignado_a else ''
                    break
            row['vendedor_id'] = vid
            row['vendedor'] = vname or 'Sin asignar'

        # Filtro por vendedor: incluye a los COMPAÑEROS DE GRUPO del/los vendedor(es)
        # seleccionado(s). Ej.: si seleccionas a Roberto y Diego está en su grupo,
        # también aparecen los clientes asignados a Diego (y viceversa).
        if vendedores_ids:
            expanded = set()
            show_all = False
            for vid in vendedores_ids:
                try:
                    u = User.objects.get(id=vid)
                except User.DoesNotExist:
                    expanded.add(vid)
                    continue
                vis = get_usuarios_visibles_ids(u)  # None = supervisor global (ve todo)
                if vis is None:
                    show_all = True
                    break
                expanded |= set(vis)
            if not show_all:
                rows = [r for r in rows if r.get('vendedor_id') in expanded]

        total = sum(r['monto'] for r in rows)
        return JsonResponse({'ok': True, 'rows': rows, 'total': total})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_subir_facturacion(request):
    """
    API para subir archivo XLS de facturación.
    Solo supervisores pueden subir.
    Parsea el XLS y extrae total de pagos por cliente.
    """
    if not is_supervisor(request.user):
        return JsonResponse({'success': False, 'error': 'No autorizado'}, status=403)

    from datetime import datetime as dt_now
    archivo = request.FILES.get('archivo')
    mes = request.POST.get('mes', '')
    anio = request.POST.get('anio', '')

    if not archivo:
        return JsonResponse({'success': False, 'error': 'Falta el archivo'})

    # Defaults si no vienen mes/anio
    now = dt_now.now()
    if not mes:
        mes = str(now.month).zfill(2)

    try:
        anio_int = int(anio) if anio else now.year
    except (ValueError, TypeError):
        anio_int = now.year

    try:
        import xlrd
        from xlrd import xldate_as_datetime
        content = archivo.read()
        wb = xlrd.open_workbook(file_contents=content)
        sheet = wb.sheet_by_index(0)

        # Agrupar por mes de emisión: {(mes, anio): {cliente: monto}}
        datos_por_mes = {}  # { 'MM': { 'YYYY': { cliente_name: monto_str } } }
        totales_por_mes = {}  # { (mes, anio): Decimal }

        for row_idx in range(1, sheet.nrows):
            try:
                estatus = str(sheet.cell_value(row_idx, 40)).strip().lower()
                if estatus == 'cancelada':
                    continue

                cliente_name = str(sheet.cell_value(row_idx, 5)).strip()
                nombre_comercial = str(sheet.cell_value(row_idx, 6)).strip()
                if not cliente_name:
                    continue

                # Extraer mes/año de la fecha de emisión (col D, idx 3)
                try:
                    date_val = sheet.cell_value(row_idx, 3)
                    fecha = xldate_as_datetime(date_val, wb.datemode)
                    row_mes = str(fecha.month).zfill(2)
                    row_anio = fecha.year
                except Exception:
                    continue  # Sin fecha válida, saltar

                # Facturado = Col L Subtotal (idx 11) - Col O Descuento (idx 14)
                # Los importes ya vienen en pesos, no se multiplica por T.C.
                subtotal_str = str(sheet.cell_value(row_idx, 11)).replace(',', '').strip()
                descuento_str = str(sheet.cell_value(row_idx, 14)).replace(',', '').strip()
                try:
                    subtotal = Decimal(subtotal_str) if subtotal_str else Decimal('0')
                except Exception:
                    subtotal = Decimal('0')
                try:
                    descuento = Decimal(descuento_str) if descuento_str else Decimal('0')
                except Exception:
                    descuento = Decimal('0')
                monto = subtotal - descuento

                # RFC del cliente (col G, idx 7)
                rfc_raw = str(sheet.cell_value(row_idx, 7)).strip()
                rfc = rfc_raw if rfc_raw and rfc_raw != '0.0' else ''

                if monto > 0:
                    key = (row_mes, row_anio)
                    if key not in datos_por_mes:
                        datos_por_mes[key] = {}
                        totales_por_mes[key] = Decimal('0')

                    clientes_mes = datos_por_mes[key]
                    # Usar RFC como key si existe, sino nombre
                    nombre_final = nombre_comercial if nombre_comercial else cliente_name
                    # Guardar con RFC para match preciso
                    entry_key = rfc if rfc else nombre_final
                    if entry_key in clientes_mes:
                        existing = clientes_mes[entry_key]
                        existing['monto'] = str(Decimal(existing['monto']) + monto)
                    else:
                        clientes_mes[entry_key] = {
                            'nombre': nombre_final,
                            'rfc': rfc,
                            'monto': str(monto),
                        }
                    totales_por_mes[key] += monto
            except (IndexError, ValueError):
                continue

        # Guardar un ArchivoFacturacion por cada mes encontrado
        archivo.seek(0)
        meses_guardados = []
        for (m, a), clientes_data in datos_por_mes.items():
            obj, created = ArchivoFacturacion.objects.update_or_create(
                mes=m, anio=a,
                defaults={
                    'archivo': archivo,
                    'total_facturado': totales_por_mes[(m, a)],
                    'datos_json': clientes_data,
                    'subido_por': request.user,
                }
            )
            meses_guardados.append(f"{m}/{a}")

        total_general = sum(totales_por_mes.values())
        return JsonResponse({
            'success': True,
            'total_facturado': str(total_general),
            'num_clientes': sum(len(v) for v in datos_por_mes.values()),
            'meses': meses_guardados,
            'created': True,
        })

    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Error procesando archivo: {str(e)}'})


@login_required
@require_http_methods(["POST"])
def api_subir_cobrado(request):
    """
    API para subir CSV de ingresos (cobrado).
    Parsea el CSV y extrae cobros por cliente con detalle de facturas.
    datos_json: {cliente_name: {nombre, monto, facturas: [{factura, monto, fecha}]}}
    """
    if not is_supervisor(request.user):
        return JsonResponse({'success': False, 'error': 'No autorizado'}, status=403)

    from datetime import datetime as dt_now
    archivo = request.FILES.get('archivo')
    if not archivo:
        return JsonResponse({'success': False, 'error': 'Falta el archivo'})

    try:
        import io
        content = archivo.read().decode('utf-8-sig')
        reader = csv.DictReader(io.StringIO(content))

        datos_por_mes = {}   # {(mes, anio): {cliente: {nombre, monto, facturas:[]}}}
        totales_por_mes = {}

        for row in reader:
            try:
                cliente_name = (row.get('Cliente') or '').strip()
                if not cliente_name:
                    continue

                fecha_str = (row.get('Fecha') or '').strip()
                if not fecha_str:
                    continue
                # Probar varios formatos — el CSV puede venir con año 2 o 4 dígitos,
                # con o sin segundos, con o sin AM/PM.
                fecha = None
                _fecha_formats = [
                    '%d/%m/%Y %I:%M:%S %p',
                    '%d/%m/%Y %H:%M:%S',
                    '%d/%m/%Y %I:%M %p',
                    '%d/%m/%Y %H:%M',
                    '%d/%m/%y %I:%M:%S %p',
                    '%d/%m/%y %H:%M:%S',
                    '%d/%m/%y %I:%M %p',
                    '%d/%m/%y %H:%M',
                    '%d/%m/%Y',
                    '%d/%m/%y',
                ]
                for _fmt in _fecha_formats:
                    try:
                        fecha = dt_now.strptime(fecha_str, _fmt)
                        break
                    except ValueError:
                        continue
                if fecha is None:
                    continue

                row_mes = str(fecha.month).zfill(2)
                row_anio = fecha.year

                total_str = (row.get('Total') or '0').replace(',', '').strip()
                try:
                    monto = Decimal(total_str)
                except Exception:
                    continue
                if monto <= 0:
                    continue

                facturas_str = (row.get('Facturas') or '').strip()
                fecha_corta = fecha.strftime('%d/%m/%Y')

                key = (row_mes, row_anio)
                if key not in datos_por_mes:
                    datos_por_mes[key] = {}
                    totales_por_mes[key] = Decimal('0')

                clientes_mes = datos_por_mes[key]
                if cliente_name in clientes_mes:
                    existing = clientes_mes[cliente_name]
                    existing['monto'] = str(Decimal(existing['monto']) + monto)
                    existing['facturas'].append({
                        'factura': facturas_str,
                        'monto': str(monto),
                        'fecha': fecha_corta,
                    })
                else:
                    clientes_mes[cliente_name] = {
                        'nombre': cliente_name,
                        'monto': str(monto),
                        'facturas': [{
                            'factura': facturas_str,
                            'monto': str(monto),
                            'fecha': fecha_corta,
                        }],
                    }
                totales_por_mes[key] += monto
            except (IndexError, ValueError, KeyError):
                continue

        archivo.seek(0)
        meses_guardados = []
        for (m, a), clientes_data in datos_por_mes.items():
            obj, created = ArchivoCobrado.objects.update_or_create(
                mes=m, anio=a,
                defaults={
                    'archivo': archivo,
                    'total_cobrado': totales_por_mes[(m, a)],
                    'datos_json': clientes_data,
                    'subido_por': request.user,
                }
            )
            meses_guardados.append(f"{m}/{a}")

        total_general = sum(totales_por_mes.values())
        return JsonResponse({
            'success': True,
            'total_cobrado': str(total_general),
            'num_clientes': sum(len(v) for v in datos_por_mes.values()),
            'meses': meses_guardados,
        })

    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Error procesando archivo: {str(e)}'})


def _match_clientes_cobrado(nombre_csv, clientes_list, alias_map=None):
    """
    Match inteligente: devuelve TODOS los clientes de la BD que matchean.
    Primero revisa alias manuales, luego match por nombre.
    alias_map: {PALABRA_CLAVE_UPPER: BUSCAR_COMO_UPPER}
    """
    cn_upper = nombre_csv.upper().strip()
    stop = {'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'SA', 'CV', 'SAS', 'INC', 'MEXICO', 'S', 'RL', 'INDUSTRIES'}

    # 0) Alias manuales: si alguna palabra_clave está contenida en el nombre CSV, usar buscar_como
    if alias_map:
        for keyword, buscar in alias_map.items():
            if keyword in cn_upper:
                matches = []
                for c in clientes_list:
                    if not c.nombre_empresa:
                        continue
                    if buscar in c.nombre_empresa.upper():
                        matches.append(c)
                if matches:
                    return matches

    # 1) Exact match — devolver solo ese
    for c in clientes_list:
        if c.nombre_empresa and c.nombre_empresa.upper().strip() == cn_upper:
            return [c]

    # 2) Extraer palabra clave principal del CSV (primera palabra significativa de 4+ chars)
    palabras = [w for w in cn_upper.split() if len(w) >= 4 and w not in stop]
    if not palabras:
        palabras = [w for w in cn_upper.split() if len(w) >= 3 and w not in stop]

    # 3) Buscar TODOS los clientes que contengan la palabra clave principal
    matches = []
    if palabras:
        keyword = palabras[0]
        for c in clientes_list:
            if not c.nombre_empresa:
                continue
            if keyword in c.nombre_empresa.upper():
                matches.append(c)

    if matches:
        return matches

    # 4) Fallback: contiene o está contenido
    for c in clientes_list:
        if not c.nombre_empresa:
            continue
        crm_upper = c.nombre_empresa.upper().strip()
        if crm_upper in cn_upper or cn_upper in crm_upper:
            return [c]

    return []


@login_required
@require_http_methods(["GET"])
def api_desglose_cobrado(request):
    """Desglose de cobrado con match a clientes, vendedor, meta y facturas."""
    try:
        mes = request.GET.get('mes', 'todos')
        anio_raw = request.GET.get('anio', '2026')
        vendedores_raw = (request.GET.get('vendedores') or '').strip()
        vendedores_ids = set()
        if vendedores_raw:
            for v in vendedores_raw.split(','):
                v = v.strip()
                if v.isdigit():
                    vendedores_ids.add(int(v))

        def _parse_ints(s, default=None):
            if not s or s == 'todos':
                return None
            parts = [p.strip() for p in str(s).split(',') if p.strip()]
            out = []
            for p in parts:
                try: out.append(int(p))
                except ValueError: pass
            return out or default

        anios_list = _parse_ints(anio_raw, default=[2026])
        meses_list = _parse_ints(mes)
        anio = anios_list[0] if anios_list else 2026
        acumulado = {}  # {nombre: {nombre, monto, facturas[]}}

        def _procesar(ac):
            raw = ac.datos_json or {}
            for key, val in raw.items():
                if isinstance(val, dict) and 'monto' in val:
                    nombre = val.get('nombre', key)
                    monto = float(Decimal(str(val['monto'])))
                    facturas = val.get('facturas', [])
                else:
                    continue
                if nombre in acumulado:
                    acumulado[nombre]['monto'] += monto
                    acumulado[nombre]['facturas'].extend(facturas)
                else:
                    acumulado[nombre] = {'nombre': nombre, 'monto': monto, 'facturas': facturas}

        # Construir queryset sobre ArchivoCobrado con filtros multi-valor
        ac_qs = ArchivoCobrado.objects.filter(anio__in=anios_list) if anios_list else ArchivoCobrado.objects.all()
        if meses_list is not None:
            ac_qs = ac_qs.filter(mes__in=[str(m).zfill(2) for m in meses_list])
        for ac in ac_qs:
            _procesar(ac)

        # Cargar alias manuales
        alias_map = {a.palabra_clave.upper().strip(): a.buscar_como.upper().strip()
                     for a in AliasCliente.objects.all()}

        # Match con clientes de la BD — busca TODAS las variantes
        all_clientes = list(Cliente.objects.select_related('asignado_a').all())
        rows = []
        for entry in sorted(acumulado.values(), key=lambda x: -x['monto']):
            matches = _match_clientes_cobrado(entry['nombre'], all_clientes, alias_map)
            vendedor = ''
            vendedor_id = None
            meta_cobrado = 0
            if matches:
                # Vendedor: tomar del primer match que tenga asignado
                for m in matches:
                    if m.asignado_a:
                        vendedor = (m.asignado_a.get_full_name() or m.asignado_a.username)
                        vendedor_id = m.asignado_a_id
                        break
                # Meta: sumar meta_cobrado de TODAS las variantes.
                # Multiplicar por número de meses en el rango (12 si 'todos').
                meses_multiplier = 12 if meses_list is None else len(meses_list)
                for m in matches:
                    mc = float(m.meta_cobrado or 0)
                    mc = mc * meses_multiplier
                    meta_cobrado += mc
            # Si hay filtro de vendedor activo, dejar fuera los clientes que
            # no estén asignados a ninguno de los vendedores seleccionados.
            if vendedores_ids and vendedor_id not in vendedores_ids:
                continue
            faltante = meta_cobrado - entry['monto']
            rows.append({
                'nombre': entry['nombre'],
                'monto': entry['monto'],
                'vendedor': vendedor,
                'vendedor_id': vendedor_id,
                'meta': meta_cobrado,
                'faltante': faltante,
                'facturas': entry.get('facturas', []),
            })

        total = sum(r['monto'] for r in rows)
        return JsonResponse({'ok': True, 'rows': rows, 'total': total})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
def api_cliente_kpis(request, cliente_id):
    """KPIs del cliente en el periodo seleccionado: facturado, oportunidades,
    cotizaciones y prospecciones. Se usan en la fila flotante del tab Clientes.
    """
    from datetime import datetime
    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Cliente no encontrado'}, status=404)

    # Filtros mes/año/desde/hasta — replica el patrón del crm_home
    now = datetime.now()
    def _parse_multi(raw, is_int=False):
        if raw is None or raw == '' or raw == 'todos':
            return None
        items = [x.strip() for x in str(raw).split(',') if x.strip()]
        if not items:
            return None
        if is_int:
            out = []
            for x in items:
                try: out.append(int(x))
                except ValueError: pass
            return out or None
        return items
    meses_list = _parse_multi(request.GET.get('mes', str(now.month).zfill(2)))
    anios_list = _parse_multi(request.GET.get('anio', str(now.year)), is_int=True)
    desde_raw = (request.GET.get('desde', '') or '').strip()
    hasta_raw = (request.GET.get('hasta', '') or '').strip()
    desde_date = hasta_date = None
    try:
        if desde_raw: desde_date = datetime.strptime(desde_raw, '%Y-%m-%d').date()
        if hasta_raw: hasta_date = datetime.strptime(hasta_raw, '%Y-%m-%d').date()
    except ValueError:
        desde_date = hasta_date = None

    def _aplicar_periodo(qs, fecha_field='fecha_creacion'):
        if desde_date or hasta_date:
            if desde_date: qs = qs.filter(**{f'{fecha_field}__date__gte': desde_date})
            if hasta_date: qs = qs.filter(**{f'{fecha_field}__date__lte': hasta_date})
        else:
            if anios_list is not None:
                qs = qs.filter(**{f'{fecha_field}__year__in': anios_list})
            if meses_list is not None:
                try:
                    meses_int = [int(m) for m in meses_list]
                except (TypeError, ValueError):
                    meses_int = []
                if meses_int:
                    qs = qs.filter(**{f'{fecha_field}__month__in': meses_int})
        return qs

    from django.db.models import Sum
    from decimal import Decimal as _Dec

    # ── Facturado: misma fuente que el Dashboard (ArchivoFacturacion del XLS),
    #    mapeado por nombre como en tab_activo='facturado'. ──
    facturado_total = _Dec('0')
    try:
        afs_qs = ArchivoFacturacion.objects.all()
        if anios_list is not None:
            afs_qs = afs_qs.filter(anio__in=anios_list)
        if meses_list is not None:
            afs_qs = afs_qs.filter(mes__in=[str(m).zfill(2) for m in meses_list])
        c_upper = (cliente.nombre_empresa or '').upper().strip()
        c_palabras = [w for w in c_upper.split() if len(w) > 2 and w not in (
            'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'SA', 'CV', 'SAS', 'INC', 'MEXICO'
        )]
        for af in afs_qs:
            for cname_xls, val in (af.datos_json or {}).items():
                if cname_xls == 'datos':
                    continue
                try:
                    monto = _Dec(str(val['monto'])) if isinstance(val, dict) and 'monto' in val else _Dec(str(val))
                except Exception:
                    continue
                cn_upper = str(cname_xls).upper().strip()
                # 1) Exact match
                hit = (cn_upper == c_upper)
                # 2) Substring match (en cualquier dirección)
                if not hit and c_upper and (c_upper in cn_upper or cn_upper in c_upper):
                    hit = True
                # 3) Primeras 2 palabras significativas
                if not hit and len(c_palabras) >= 2:
                    if c_palabras[0] in cn_upper and c_palabras[1] in cn_upper:
                        hit = True
                elif not hit and len(c_palabras) == 1 and len(c_palabras[0]) >= 4:
                    if c_palabras[0] in cn_upper:
                        hit = True
                if hit:
                    facturado_total += monto
    except Exception:
        pass

    # ── Oportunidades: monto total ($) de oportunidades del cliente en el
    #    periodo. Igual que Dashboard: Sum(monto) de TodoItem. ──
    op_qs = _aplicar_periodo(TodoItem.objects.filter(cliente=cliente))
    op_monto = op_qs.aggregate(t=Sum('monto'))['t'] or _Dec('0')

    # ── Cotizaciones: count de Cotizacion del cliente en el periodo. ──
    cot_count = 0
    try:
        from .models import Cotizacion
        cot_qs = _aplicar_periodo(Cotizacion.objects.filter(cliente=cliente))
        cot_count = cot_qs.count()
    except Exception:
        pass

    # ── Prospecciones: total CREADAS en el periodo (mismo criterio que el
    #    Dashboard de Prospectos: data.total_prospectos, sin excluir cerrados). ──
    from .models import Prospecto
    pr_qs = _aplicar_periodo(Prospecto.objects.filter(cliente=cliente))
    pr_count = pr_qs.count()

    return JsonResponse({
        'ok': True,
        'cliente': {'id': cliente.id, 'nombre': cliente.nombre_empresa or '—'},
        'kpis': {
            'facturado': float(facturado_total or 0),
            'oportunidades': float(op_monto or 0),
            'cotizaciones': cot_count,
            'prospecciones': pr_count,
        },
    })


@login_required
def api_cliente_prospecciones(request, cliente_id):
    """Lista de prospecciones (Prospecto) de un cliente. Para mostrarlas
    como sub-tab en el modal widgetClienteOportunidades."""
    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Cliente no encontrado'}, status=404)
    from .models import Prospecto
    qs = (
        Prospecto.objects.select_related('contacto', 'usuario')
        .filter(cliente=cliente).order_by('-fecha_actualizacion')
    )
    # Filtros opcionales mes / año (por fecha_creacion)
    mes_p = (request.GET.get('mes') or '').strip()
    anio_p = (request.GET.get('anio') or '').strip()
    if mes_p and mes_p != 'todos':
        try: qs = qs.filter(fecha_creacion__month=int(mes_p))
        except ValueError: pass
    if anio_p and anio_p != 'todos':
        try: qs = qs.filter(fecha_creacion__year=int(anio_p))
        except ValueError: pass
    ETAPA_LBL = {
        'identificado': 'Identificado', 'calificado': 'Calificado',
        'reunion': 'Reunión', 'en_progreso': 'En Progreso', 'procesado': 'Procesado',
        'cerrado_ganado': 'Cerrado · Ganado', 'cerrado_perdido': 'Cerrado · Perdido',
    }
    rows = []
    for p in qs:
        rows.append({
            'id': p.id,
            'nombre': p.nombre,
            'contacto': p.contacto.nombre if p.contacto else '—',
            'area': p.area or '—',
            'producto': p.producto or '—',
            'etapa': p.etapa,
            'etapa_display': ETAPA_LBL.get(p.etapa, p.etapa),
            'tipo_pipeline': p.tipo_pipeline,
            'vendedor': p.usuario.get_full_name() or p.usuario.username,
            'fecha_creacion': p.fecha_creacion.strftime('%d %b %Y') if p.fecha_creacion else '',
        })
    return JsonResponse({'ok': True, 'rows': rows, 'total': len(rows)})


@login_required
def api_cliente_info(request, cliente_id):
    """GET → devuelve la carátula (logo + campos editables) del cliente.
    POST (multipart) → actualiza los campos y opcionalmente el logo.
    """
    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Cliente no encontrado'}, status=404)

    CAMPOS = [
        'ubicacion', 'mapa_url', 'dias_entrega', 'horarios_trabajo',
        'dias_facturacion', 'proceso_cobro', 'reglas_acceso', 'info_adicional',
    ]

    if request.method == 'POST':
        for f in CAMPOS:
            if f in request.POST:
                setattr(cliente, f, request.POST.get(f, '') or '')
        if 'logo' in request.FILES:
            cliente.logo = request.FILES['logo']
        if request.POST.get('logo_clear') in ('1', 'true', 'on'):
            if cliente.logo:
                try: cliente.logo.delete(save=False)
                except Exception: pass
            cliente.logo = None
        cliente.save()

    data = {f: getattr(cliente, f, '') or '' for f in CAMPOS}
    data['nombre'] = cliente.nombre_empresa or ''
    data['rfc'] = cliente.rfc or ''
    data['categoria'] = cliente.get_categoria_display() if cliente.categoria else ''
    data['logo_url'] = cliente.logo.url if cliente.logo else ''
    return JsonResponse({'ok': True, 'cliente': data})


@login_required
def api_cliente_contactos(request, cliente_id):
    """GET → lista los contactos del cliente. POST → crea uno nuevo."""
    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Cliente no encontrado'}, status=404)

    if request.method == 'POST':
        nombre = (request.POST.get('nombre', '') or '').strip()
        if not nombre:
            return JsonResponse({'ok': False, 'error': 'Nombre requerido'}, status=400)
        c = Contacto.objects.create(
            cliente=cliente,
            nombre=nombre,
            apellido=(request.POST.get('apellido', '') or '').strip(),
            email=(request.POST.get('email', '') or '').strip(),
            telefono=(request.POST.get('telefono', '') or '').strip(),
            puesto=(request.POST.get('puesto', '') or '').strip(),
        )
        return JsonResponse({'ok': True, 'contacto': {
            'id': c.id, 'nombre': c.nombre, 'apellido': c.apellido or '',
            'email': c.email or '', 'telefono': c.telefono or '', 'puesto': c.puesto or '',
        }})

    rows = []
    for c in cliente.contactos.all().order_by('nombre', 'apellido'):
        rows.append({
            'id': c.id,
            'nombre': c.nombre or '',
            'apellido': c.apellido or '',
            'email': c.email or '',
            'telefono': c.telefono or '',
            'puesto': c.puesto or '',
        })
    return JsonResponse({'ok': True, 'contactos': rows})


@login_required
def api_cliente_contacto_detail(request, contacto_id):
    """PUT/POST → actualiza un contacto. DELETE → lo elimina."""
    try:
        c = Contacto.objects.get(id=contacto_id)
    except Contacto.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'Contacto no encontrado'}, status=404)

    if request.method == 'DELETE':
        c.delete()
        return JsonResponse({'ok': True})

    if request.method == 'POST':
        for f in ('nombre', 'apellido', 'email', 'telefono', 'puesto'):
            if f in request.POST:
                setattr(c, f, (request.POST.get(f, '') or '').strip())
        c.save()
        return JsonResponse({'ok': True, 'contacto': {
            'id': c.id, 'nombre': c.nombre, 'apellido': c.apellido or '',
            'email': c.email or '', 'telefono': c.telefono or '', 'puesto': c.puesto or '',
        }})

    return JsonResponse({'ok': False, 'error': 'Método no permitido'}, status=405)


@login_required
def api_cliente_oportunidades(request, cliente_id):
    """
    API que devuelve las oportunidades de un cliente específico en JSON.
    Formato compatible con buildCrmRow() del frontend.
    """
    from datetime import datetime
    user = request.user
    es_supervisor = is_supervisor(user)

    # Por defecto mostrar todo el historial del cliente, no solo el mes actual
    mes_filter = request.GET.get('mes', 'todos')
    anio_filter = request.GET.get('anio', 'todos')

    MES_CODE_TO_NAME = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
        '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
    }

    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Cliente no encontrado'}, status=404)

    qs = TodoItem.objects.select_related('cliente', 'contacto', 'usuario').filter(cliente=cliente)

    # Filtrar por fecha_creacion si se indica (usado en tab Clientes)
    por_creacion = request.GET.get('por_creacion', '')

    # Aplicar filtros solo si no son 'todos' (soporta multi-valor comma-separado)
    def _parse_ints_local(s):
        if not s or s == 'todos':
            return None
        parts = [p.strip() for p in str(s).split(',') if p.strip()]
        out = []
        for p in parts:
            try:
                out.append(int(p))
            except ValueError:
                pass
        return out or None

    anios_local = _parse_ints_local(anio_filter)
    meses_local = _parse_ints_local(mes_filter)

    if anios_local is not None:
        if por_creacion:
            qs = qs.filter(fecha_creacion__year__in=anios_local)
        else:
            qs = qs.filter(anio_cierre__in=anios_local)

    if meses_local is not None:
        if por_creacion:
            qs = qs.filter(fecha_creacion__month__in=meses_local)
        else:
            qs = qs.filter(mes_cierre__in=[str(m).zfill(2) for m in meses_local])

    if not es_supervisor:
        _gids = get_usuarios_visibles_ids(user)
        qs = qs.filter(usuario_id__in=_gids) if _gids and len(_gids) > 1 else qs.filter(usuario=user)

    # Filtrar por tipo si se especifica
    tipo = request.GET.get('tipo', '')
    if tipo == 'cobrado':
        qs = qs.filter(etapa_corta__in=['Ganado', 'Pagado'])

    qs = qs.order_by('-fecha_actualizacion')

    def format_money(val):
        if val is None:
            return '0'
        try:
            return '{:,.0f}'.format(val)
        except (ValueError, TypeError):
            return '0'

    rows = []
    for item in qs:
        rows.append({
            'id': item.id,
            'oportunidad': (item.oportunidad or '')[:35],
            'cliente': (item.cliente.nombre_empresa if item.cliente else '- Sin Cliente -')[:35],
            'cliente_id': item.cliente_id,
            'contacto': {'nombre': (item.contacto.nombre[:18] if item.contacto else '-')},
            'area': item.area or '-',
            'producto': item.producto or '',
            'producto_display': item.get_producto_display() if hasattr(item, 'get_producto_display') else (item.producto or ''),
            'usuario': item.usuario.get_full_name() or item.usuario.username if item.usuario else '—',
            'fecha': item.fecha_actualizacion.strftime('%d/%m/%y') if item.fecha_actualizacion else '—',
            'fecha_iso': item.fecha_actualizacion.isoformat() if item.fecha_actualizacion else '',
            'monto': format_money(item.monto),
            'monto_raw': float(item.monto or 0),
            'probabilidad_cierre': item.probabilidad_cierre,
        })

    # All contacts for this client (for filter dropdown)
    contactos_cliente = list(
        Contacto.objects.filter(cliente=cliente)
        .values_list('nombre', flat=True)
        .order_by('nombre')
    )

    return JsonResponse({
        'success': True,
        'cliente_nombre': cliente.nombre_empresa,
        'rows': rows,
        'contactos': contactos_cliente,
    })


@login_required
def editar_venta_todoitem(request, pk):
    # Supervisor puede editar cualquier venta, vendedor solo las suyas
    if is_supervisor(request.user):
        todo_item = get_object_or_404(TodoItem, pk=pk)
    else:
        todo_item = get_object_or_404(TodoItem, pk=pk, usuario=request.user)

    if request.method == 'POST':
        if 'delete' in request.POST:
            # Solo permite borrar si el usuario es supervisor o dueño
            if is_supervisor(request.user) or todo_item.usuario == request.user:
                todo_item.delete()
                messages.success(request, "Oportunidad eliminada con éxito.")
            else:
                messages.error(request, "No tienes permiso para eliminar esta oportunidad.")
            return redirect('todos')
        
        # Si no es delete, entonces es edición:
        form = VentaForm(request.POST, instance=todo_item, user=request.user if not is_supervisor(request.user) else None)
        if form.is_valid():
            cliente_nombre = form.cleaned_data['cliente_nombre']
            bitrix_company_id_from_form = form.cleaned_data.get('bitrix_company_id')

            cliente = None
            # Try to get client by bitrix_company_id if provided
            if bitrix_company_id_from_form:
                try:
                    cliente = Cliente.objects.get(bitrix_company_id=bitrix_company_id_from_form)
                except Cliente.DoesNotExist:
                    # If client doesn't exist locally, create it with the provided Bitrix ID
                    cliente = Cliente.objects.create(
                        nombre_empresa=cliente_nombre,
                        bitrix_company_id=bitrix_company_id_from_form
                    )
                except Exception as e:
                    messages.error(request, f"ERROR: No se pudo obtener o crear el cliente local por Bitrix ID: {e}")
                    form.add_error('cliente_nombre', 'Hubo un error al procesar el cliente.')
                    return render(request, 'editar_venta.html', {'form': form, 'todo_item': todo_item})
            else:
                # If no bitrix_company_id from form, try to find by name or create a new one without Bitrix ID
                try:
                    cliente, created = Cliente.objects.get_or_create(
                        nombre_empresa=cliente_nombre,
                        defaults={'bitrix_company_id': None}
                    )
                except Exception as e:
                    messages.error(request, f"ERROR: No se pudo obtener o crear el cliente local por nombre: {e}")
                    form.add_error('cliente_nombre', 'Hubo un error al procesar el cliente.')
                    return render(request, 'editar_venta.html', {'form': form, 'todo_item': todo_item})

            venta = form.save(commit=False)
            venta.cliente = cliente
            if is_supervisor(request.user):
                venta.usuario = form.cleaned_data['usuario']
            else:
                venta.usuario = request.user
            venta.save()

            # Actualizar en Bitrix si existe un bitrix_deal_id
            if venta.bitrix_deal_id:
                opportunity_data = {
                    'oportunidad': venta.oportunidad,
                    'monto': float(venta.monto),
                    'cliente': cliente.nombre_empresa,
                    'bitrix_company_id': cliente.bitrix_company_id,
                    'producto': venta.producto,
                    'area': venta.area,
                    'mes_cierre': venta.mes_cierre,
                    'probabilidad_cierre': venta.probabilidad_cierre,
                    'comentarios': venta.comentarios,
                    'bitrix_stage_id': venta.bitrix_stage_id,
                }
                # Obtener el bitrix_user_id del usuario asignado
                bitrix_assigned_by_id = None
                if venta.usuario and hasattr(venta.usuario, 'userprofile') and venta.usuario.userprofile.bitrix_user_id:
                    bitrix_assigned_by_id = venta.usuario.userprofile.bitrix_user_id
                opportunity_data['bitrix_assigned_by_id'] = bitrix_assigned_by_id
                bitrix_updated = update_opportunity_in_bitrix(venta.bitrix_deal_id, opportunity_data, request=request)
                if bitrix_updated:
                    messages.success(request, "Oportunidad actualizada en Bitrix24 con éxito.")
                else:
                    messages.error(request, "Error al actualizar la oportunidad en Bitrix24.")
            else:
                messages.warning(request, "La oportunidad no tiene un ID de Bitrix24 asociado. No se pudo actualizar en Bitrix24.")

            return redirect('todos')
    else:
        form = VentaForm(instance=todo_item, user=request.user if not is_supervisor(request.user) else None)

    return render(request, 'editar_venta.html', {'form': form, 'todo_item': todo_item})


@login_required
def reporte_ventas_por_cliente(request):
    from django.contrib.auth.models import User
    if is_supervisor(request.user):
        reporte_data = Cliente.objects.annotate(
            total_monto=Coalesce(
                Sum('oportunidades__monto', filter=Q(oportunidades__etapa_corta__in=['Ganado', 'Pagado'])),
                Value(Decimal('0.00'))
            )
        ).values(
            'id',
            'nombre_empresa',
            'total_monto'
        ).order_by('nombre_empresa')
        total_general = TodoItem.objects.filter(etapa_corta__in=['Ganado', 'Pagado']).aggregate(
            sum_monto=Sum('monto')
        )['sum_monto'] or Decimal('0.00')
        usuarios = User.objects.filter(is_active=True)
    else:
        _visible_ids = get_usuarios_visibles_ids(request.user)
        reporte_data = Cliente.objects.filter(get_clientes_visibles_q(request.user)).annotate(
            total_monto=Coalesce(
                Sum('oportunidades__monto', filter=Q(oportunidades__etapa_corta__in=['Ganado', 'Pagado'], oportunidades__usuario__in=_visible_ids) if _visible_ids else Q(oportunidades__etapa_corta__in=['Ganado', 'Pagado'])),
                Value(Decimal('0.00'))
            )
        ).values(
            'id',
            'nombre_empresa',
            'total_monto'
        ).order_by('nombre_empresa')
        if _visible_ids:
            total_general = TodoItem.objects.filter(
                usuario__in=_visible_ids, etapa_corta__in=['Ganado', 'Pagado']
            ).aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
        else:
            total_general = TodoItem.objects.filter(
                etapa_corta__in=['Ganado', 'Pagado']
            ).aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
        usuarios = None
    context = {
        'reporte_data': reporte_data,
        'total_general': total_general,
        'is_supervisor': is_supervisor(request.user),
        'usuarios': usuarios,
    }
    return render(request, 'reporte_ventas_por_cliente.html', context)


@login_required
def oportunidades_por_cliente(request, cliente_id):
    # Determinar qué clientes pueden ser vistos por el usuario
    if is_supervisor(request.user):
        cliente_seleccionado = get_object_or_404(Cliente, pk=cliente_id) # No filtrar por usuario
        oportunidades = TodoItem.objects.filter(cliente=cliente_seleccionado) # Todas las oportunidades del cliente
    else:
        _visible_ids = get_usuarios_visibles_ids(request.user)
        _visible_q = get_clientes_visibles_q(request.user)
        cliente_seleccionado = get_object_or_404(Cliente, pk=cliente_id)
        # Verify the client is visible to this user
        if not Cliente.objects.filter(_visible_q, pk=cliente_id).exists():
            from django.http import Http404
            raise Http404
        oportunidades = TodoItem.objects.filter(cliente=cliente_seleccionado, usuario__in=_visible_ids) if _visible_ids else TodoItem.objects.filter(cliente=cliente_seleccionado)
        logger.debug(f"DEBUG: Vendedor {request.user.username} viendo oportunidades de grupo de cliente.")

    # El formulario de filtro no necesita el usuario para sus querysets de clientes en este contexto
    # ya que los clientes ya vienen filtrados por la vista o se obtienen todos.
    filter_form = VentaFilterForm(request.GET)

    if filter_form.is_valid():
        area = filter_form.cleaned_data.get('area')
        producto = filter_form.cleaned_data.get('producto')
        orden_monto = filter_form.cleaned_data.get('orden_monto')
        probabilidad_min = filter_form.cleaned_data.get('probabilidad_min')
        probabilidad_max = filter_form.cleaned_data.get('probabilidad_max')
        mes_cierre = filter_form.cleaned_data.get('mes_cierre')

        if area:
            oportunidades = oportunidades.filter(area=area)
        if producto:
            oportunidades = oportunidades.filter(producto=producto)
        if probabilidad_min is not None:
            oportunidades = oportunidades.filter(probabilidad_cierre__gte=probabilidad_min)
        if probabilidad_max is not None:
            oportunidades = oportunidades.filter(probabilidad_cierre__lte=probabilidad_max)
        if mes_cierre:
            oportunidades = oportunidades.filter(mes_cierre=mes_cierre)

        if orden_monto:
            if orden_monto == 'monto_asc':
                oportunidades = oportunidades.order_by('monto')
            elif orden_monto == 'monto_desc':
                oportunidades = oportunidades.order_by('-monto')
        else:
            oportunidades = oportunidades.order_by('-fecha_creacion')
    else:
        oportunidades = oportunidades.order_by('-fecha_creacion')


    context = {
        'cliente': cliente_seleccionado,
        'oportunidades': oportunidades,
        'filter_form': filter_form,
        'is_supervisor': is_supervisor(request.user),
    }
    return render(request, 'oportunidades_por_cliente.html', context)


@login_required
def producto_dashboard_detail(request, producto_val):
    logger.debug(f"DEBUG: producto_dashboard_detail - producto_val recibido RAW: {producto_val}")

    # Convertir a mayúsculas para asegurar que la comparación con PRODUCTO_CHOICES sea consistente
    producto_val_upper = producto_val.upper()
    logger.debug(f"DEBUG: producto_dashboard_detail - producto_val_upper: {producto_val_upper}")
    logger.debug(f"DEBUG: Keys de PRODUCTO_CHOICES: {list(dict(TodoItem.PRODUCTO_CHOICES).keys())}")

    # Verificar si el producto_val_upper es una clave válida en PRODUCTO_CHOICES
    if producto_val_upper not in dict(TodoItem.PRODUCTO_CHOICES):
        return redirect('dashboard')

    if is_supervisor(request.user):
        oportunidades = TodoItem.objects.filter(producto=producto_val_upper)
    else:
        oportunidades = TodoItem.objects.filter(producto=producto_val_upper, usuario=request.user)

    logger.debug(f"DEBUG: Oportunidades encontradas para {producto_val_upper} (antes de desglosar): {oportunidades.count()}")
    for op in oportunidades:
        logger.debug(f"DEBUG:   - ID: {op.id}, Oportunidad: {op.oportunidad}, Producto: {op.producto}, Usuario ID: {op.usuario.id}")

    # --- Ventas Cerradas (etapa Ganado/Pagado) para este producto ---
    ventas_cerradas = oportunidades.filter(etapa_corta__in=['Ganado', 'Pagado'])
    total_vendido_cerrado = ventas_cerradas.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
    total_vendido_cerrado_count = ventas_cerradas.count() # Conteo de oportunidades cerradas
    logger.debug(f"DEBUG: Ventas Cerradas (100%) para '{producto_val_upper}': {total_vendido_cerrado_count} oportunidades, Monto: {total_vendido_cerrado}")
    for venta in ventas_cerradas:
        logger.debug(f"DEBUG:   - Oportunidad: {venta.oportunidad}, Monto: {venta.monto}, Probabilidad: {venta.probabilidad_cierre}%")

    # --- Oportunidades Vigentes (probabilidad del 1% al 99%) para este producto ---
    oportunidades_vigentes = oportunidades.filter(
        probabilidad_cierre__gt=0, # Mayor que 0%
        probabilidad_cierre__lt=100 # Menor que 100%
    )
    total_monto_vigente = oportunidades_vigentes.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
    total_monto_vigente_count = oportunidades_vigentes.count() # Conteo de oportunidades vigentes
    logger.debug(f"DEBUG: Oportunidades Vigentes (0% < prob < 100%) para '{producto_val_upper}': {total_monto_vigente_count} oportunidades, Monto: {total_monto_vigente}")
    for op_vigente in oportunidades_vigentes:
        logger.debug(f"DEBUG:   - Oportunidad: {op_vigente.oportunidad}, Monto: {op_vigente.monto}, Probabilidad: {op_vigente.probabilidad_cierre}%")

    # --- Oportunidades Perdidas (probabilidad 0%) para este producto ---
    oportunidades_perdidas = oportunidades.filter(probabilidad_cierre=0)
    total_monto_perdido = oportunidades_perdidas.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
    total_monto_perdido_count = oportunidades_perdidas.count() # Conteo de oportunidades perdidas
    logger.debug(f"DEBUG: Oportunidades Perdidas (0%) para '{producto_val_upper}': {total_monto_perdido_count} oportunidades, Monto: {total_monto_perdido}")
    for op_perdida in oportunidades_perdidas:
        logger.debug(f"DEBUG:   - Oportunidad: {op_perdida.oportunidad}, Monto: {op_perdida.monto}, Probabilidad: {op_perdida.probabilidad_cierre}%")


    # Clientes involucrados en este producto
    clientes_involucrados = oportunidades.filter(cliente__isnull=False).values('cliente__id', 'cliente__nombre_empresa').distinct()

    # Meses involucrados en este producto (mes de cierre esperado)
    meses_involucrados = oportunidades.values('mes_cierre').distinct()

    # Mapear valores crudos de mes a sus nombres de visualización
    meses_display = []
    for m in meses_involucrados:
        # Aseguramos que la clave sea un string de dos dígitos para la búsqueda
        mes_key = str(m['mes_cierre']).zfill(2)
        meses_display.append(dict(TodoItem.MES_CHOICES).get(mes_key, mes_key))
    context = {
        'producto_val': producto_val_upper, # Aseguramos que la clave pasada sea la que usará el template
        'producto_display': dict(TodoItem.PRODUCTO_CHOICES).get(producto_val_upper, producto_val_upper),
        'total_vendido_cerrado': total_vendido_cerrado,
        'total_vendido_cerrado_count': total_vendido_cerrado_count, # AÑADIDO
        'total_monto_vigente': total_monto_vigente, # Nuevo: Monto oportunidades vigentes
        'total_monto_vigente_count': total_monto_vigente_count, # AÑADIDO
        'total_monto_perdido': total_monto_perdido, # Nuevo: Monto oportunidades perdidas
        'total_monto_perdido_count': total_monto_perdido_count, # AÑADIDO
        'clientes_involucrados': clientes_involucrados,
        'meses_involucrados_display': meses_display,
        'oportunidades': oportunidades, # Pasar todas las oportunidades para listarlas
        'is_supervisor': is_supervisor(request.user), # Pasamos si el usuario es supervisor al contexto
    }
    return redirect('/app/todos/')


@login_required
def mes_dashboard_detail(request, mes_val):
    # Asegúrate de que el mes_val recibido es uno de los choices válidos
    mes_val_padded = str(mes_val).zfill(2) # Asegurar que mes_val sea de dos dígitos para la validación
    if mes_val_padded not in dict(TodoItem.MES_CHOICES).keys():
        return redirect('home') # Redirige a home si el mes no es válido

    # Base queryset de oportunidades según el rol
    if is_supervisor(request.user):
        oportunidades_mes = TodoItem.objects.filter(mes_cierre=mes_val_padded)
    else:
        oportunidades_mes = TodoItem.objects.filter(usuario=request.user, mes_cierre=mes_val_padded)


    # Monto total esperado para este mes
    total_monto_esperado = oportunidades_mes.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')

    # Monto POR COBRAR: oportunidades con probabilidad entre 1 and 99%
    por_cobrar_monto = oportunidades_mes.filter(probabilidad_cierre__gte=1, probabilidad_cierre__lte=99).aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')

    # Clientes involucrados en oportunidades para este mes
    clientes_involucrados = oportunidades_mes.filter(cliente__isnull=False).values('cliente__id', 'cliente__nombre_empresa').distinct()

    # Datos para la gráfica: Probabilidad de cierre vs. Monto
    graph_data_raw = oportunidades_mes.values('id', 'oportunidad', 'producto', 'monto', 'probabilidad_cierre', 'cliente__nombre_empresa')

    # Añadir 'get_producto_display' a cada item en graph_data
    graph_data_with_display = []
    for item in graph_data_raw:
        item_copy = item.copy()
        item_copy['get_producto_display'] = dict(TodoItem.PRODUCTO_CHOICES).get(item_copy['producto'], item_copy['producto'])
        graph_data_with_display.append(item_copy)

    context = {
        'mes_val': mes_val_padded, # Aseguramos que la clave pasada sea la que usará el template
        'mes_display': dict(TodoItem.MES_CHOICES).get(mes_val_padded, mes_val_padded),
        'total_monto_esperado': total_monto_esperado,
        'por_cobrar_monto': por_cobrar_monto,
        'clientes_involucrados': clientes_involucrados,
        'oportunidades': oportunidades_mes, # Pasar todas las oportunidades para listarlas
        'graph_data_json': graph_data_with_display, # Pasa los datos procesados con display_value
        'is_supervisor': is_supervisor(request.user),
    }
    return redirect('/app/todos/')


@login_required
def oportunidades_perdidas_detail(request):
    """
    Vista para mostrar todas las oportunidades con 0% de probabilidad de cierre.
    Considera el rol de supervisor.
    """
    if is_supervisor(request.user):
        oportunidades_perdidas = TodoItem.objects.filter(probabilidad_cierre=0).order_by('-fecha_creacion')
    else:
        oportunidades_perdidas = TodoItem.objects.filter(usuario=request.user, probabilidad_cierre=0).order_by('-fecha_creacion')

    total_perdido_monto = oportunidades_perdidas.aggregate(
        sum_monto=Sum('monto')
    )['sum_monto'] or Decimal('0.00')

    context = {
        'oportunidades': oportunidades_perdidas,
        'titulo': "Oportunidades Perdidas (0% Probabilidad)",
        'total_perdido_monto': total_perdido_monto,
        'is_supervisor': is_supervisor(request.user),
    }
    return redirect('/app/todos/')


@login_required
def exportar_oportunidades_csv(request):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
        from datetime import date
        OPENPYXL_AVAILABLE = True
    except ImportError:
        # Fallback to CSV if openpyxl is not available
        OPENPYXL_AVAILABLE = False
        from datetime import date
    
    # 1. Get the base queryset with cotizations
    if is_supervisor(request.user):
        items = TodoItem.objects.select_related('usuario', 'cliente').prefetch_related('cotizaciones__detalles').all()
    else:
        _gids = get_usuarios_visibles_ids(request.user)
        if _gids and len(_gids) > 1:
            items = TodoItem.objects.select_related('usuario', 'cliente').prefetch_related('cotizaciones__detalles').filter(usuario_id__in=_gids)
        else:
            items = TodoItem.objects.select_related('usuario', 'cliente').prefetch_related('cotizaciones__detalles').filter(usuario=request.user)

    # 2. Apply filters (supporting multiple values)
    oportunidad_filter = request.GET.get('filterOportunidad', '').strip()
    if oportunidad_filter:
        items = items.filter(oportunidad__icontains=oportunidad_filter)
        
    cliente_filter = request.GET.get('filterCliente', '').strip()
    if cliente_filter:
        # Si es un número, buscar por ID; si no, buscar por nombre
        if cliente_filter.isdigit():
            items = items.filter(cliente__id=int(cliente_filter))
        else:
            items = items.filter(cliente__nombre_empresa__icontains=cliente_filter)
        
    # Filtro de tipo
    tipo_filter = request.GET.get('filterTipo', '').strip()
    if tipo_filter:
        items = items.filter(tipo_negociacion=tipo_filter)
        
    # Filtro de empleado múltiple
    empleado_filter = request.GET.get('empleado', '').strip()
    if empleado_filter:
        empleado_ids = [e.strip() for e in empleado_filter.split(',') if e.strip()]
        if empleado_ids:
            items = items.filter(usuario__id__in=empleado_ids)
            
    # Filtro de mes de cierre múltiple
    mes_cierre_filter = request.GET.get('filterMesCierre', '').strip()
    if mes_cierre_filter:
        meses = [m.strip() for m in mes_cierre_filter.split(',') if m.strip()]
        if meses:
            items = items.filter(mes_cierre__in=meses)
            
    # Filtro de etapa múltiple (estado)
    etapa_filter = request.GET.get('filterEtapa', '').strip()
    if etapa_filter:
        from django.db.models import Q
        etapas = [e.strip() for e in etapa_filter.split(',') if e.strip()]
        if etapas:
            etapa_conditions = Q()
            for etapa in etapas:
                if etapa == 'vigentes':
                    # Excluir cerradas (ganadas, perdidas y pagadas)
                    etapa_conditions |= ~Q(etapa_completa__icontains='ganado') & ~Q(etapa_completa__icontains='perdido') & ~Q(etapa_completa__icontains='pagado')
                elif etapa == 'ganadas':
                    # Solo cerradas ganadas, incluir pagado
                    etapa_conditions |= Q(etapa_completa__icontains='ganado') | Q(etapa_completa__icontains='pagado')
                elif etapa == 'perdidas':
                    # Solo cerradas perdidas
                    etapa_conditions |= Q(etapa_completa__icontains='perdido')
            items = items.filter(etapa_conditions)

    area_filter = request.GET.get('filterArea', '').strip()
    if area_filter:
        items = items.filter(area=area_filter)

    # 3. Apply sorting
    orden_monto = request.GET.get('orden_monto')
    if orden_monto:
        if orden_monto == 'monto_asc':
            items = items.order_by('monto')
        elif orden_monto == 'monto_desc':
            items = items.order_by('-monto')

    orden_probabilidad = request.GET.get('orden_probabilidad')
    if orden_probabilidad:
        if orden_probabilidad == 'prob_asc':
            items = items.order_by('probabilidad_cierre')
        elif orden_probabilidad == 'prob_desc':
            items = items.order_by('-probabilidad_cierre')

    # 4. Create report based on available libraries
    if OPENPYXL_AVAILABLE:
        # Create Excel workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Reporte Oportunidades"
        
        # --- START: Add Report Metadata ---
        bold_font = Font(bold=True)
        
        # Row 1: Report Author
        ws['A1'] = "Reporte generado por:"
        ws['A1'].font = bold_font
        ws['B1'] = request.user.get_full_name() or request.user.username
        
        # Row 2: Generation Date
        ws['A2'] = "Fecha de generación:"
        ws['A2'].font = bold_font
        ws['B2'] = date.today().strftime("%d/%m/%Y")
        
        # Row 3: Applied Filters
        ws['A3'] = "Filtros aplicados:"
        ws['A3'].font = bold_font
        
        filters_applied = []
        
        # Filtro de oportunidad
        if oportunidad_filter:
            filters_applied.append(f"Oportunidad: {oportunidad_filter}")
            
        # Filtro de cliente
        if cliente_filter:
            filters_applied.append(f"Cliente: {cliente_filter}")
            
        # Filtro de tipo
        if tipo_filter:
            tipo_display = "Runrate" if tipo_filter == "runrate" else "Proyecto"
            filters_applied.append(f"Tipo: {tipo_display}")
            
        # Filtro de empleado múltiple
        if empleado_filter:
            empleado_ids = [e.strip() for e in empleado_filter.split(',') if e.strip()]
            empleado_nombres = []
            for emp_id in empleado_ids:
                try:
                    from django.contrib.auth.models import User
                    empleado = User.objects.get(id=emp_id)
                    empleado_nombres.append(empleado.get_full_name() or empleado.username)
                except User.DoesNotExist:
                    empleado_nombres.append(f"ID:{emp_id}")
            if empleado_nombres:
                filters_applied.append(f"Empleado(s): {', '.join(empleado_nombres)}")
                
        # Filtro de mes de cierre múltiple
        if mes_cierre_filter:
            meses = [m.strip() for m in mes_cierre_filter.split(',') if m.strip()]
            mes_nombres = []
            mes_map = {
                '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
                '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
                '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
            }
            for mes in meses:
                mes_nombres.append(mes_map.get(mes, mes))
            if mes_nombres:
                filters_applied.append(f"Mes(es) de Cierre: {', '.join(mes_nombres)}")
                
        # Filtro de etapa múltiple
        if etapa_filter:
            etapas = [e.strip() for e in etapa_filter.split(',') if e.strip()]
            etapa_nombres = []
            etapa_map = {
                'vigentes': 'Solo vigentes',
                'ganadas': 'Solo cerradas ganadas', 
                'perdidas': 'Solo cerradas perdidas'
            }
            for etapa in etapas:
                etapa_nombres.append(etapa_map.get(etapa, etapa))
            if etapa_nombres:
                filters_applied.append(f"Estado(s): {', '.join(etapa_nombres)}")
                
        # Filtro de área
        if area_filter:
            filters_applied.append(f"Área: {area_filter}")
        
        if filters_applied:
            ws['B3'] = "; ".join(filters_applied)
        else:
            ws['B3'] = "Ninguno"
            
        # --- END: Add Report Metadata ---

        # Define styles
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        # Define all headers (brands + months)
        all_headers = [
            'OPORTUNIDAD', 'CLIENTE', 'AREA', 'CONTACTO', 'ZEBRA', 'PANDUIT', 'APC', 'AVIGILON', 
            'GENETEC', 'AXIS', 'SOFTWARE', 'RUNRATE', 'PÓLIZA', 'CISCO',
            'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEPT', 'OCT', 'NOV', 'DIC', 'ESTATUS', 'EMPLEADO'
        ]
        
        # Write all headers in a single row (starting at row 5)
        header_row_num = 5
        for col, header in enumerate(all_headers, 1):
            cell = ws.cell(row=header_row_num, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = border
    else:
        # Fallback to CSV - simplified structure
        headers = [
            'OPORTUNIDAD', 'CLIENTE', 'AREA', 'CONTACTO', 'ZEBRA', 'PANDUIT', 'APC', 'AVIGILON', 
            'GENETEC', 'AXIS', 'SOFTWARE', 'RUNRATE', 'PÓLIZA', 'CISCO',
            'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEPT', 'OCT', 'NOV', 'DIC', 'ESTATUS', 'EMPLEADO'
        ]
        
        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="reporte_cotizaciones_oportunidades.csv"'
        
        import csv
        writer = csv.writer(response)
        writer.writerow(headers)
        
    # Brand columns mapping - usar las marcas reales de PRODUCTO_CHOICES
    brand_columns = {
        'ZEBRA': 5, 'PANDUIT': 6, 'APC': 7, 'AVIGILON': 8,
        'GENETEC': 9, 'AXIS': 10, 'SOFTWARE': 11, 'RUNRATE': 12, 
        'PÓLIZA': 13, 'CISCO': 14
    }
        
    # Write data rows (start at row 6 for Excel since we now have metadata headers)
    row = 6
    for item in items:
        logger.debug(f"DEBUG: Processing item: {item.oportunidad}")
        # Get cotization details for this opportunity
        cotizaciones = item.cotizaciones.all()
        
        # Para cada oportunidad, el monto va en la columna del producto/área de la oportunidad
        # No en las cotizaciones, sino en el producto/área de la oportunidad misma
        oportunidad_producto = item.get_producto_display() if hasattr(item, 'get_producto_display') else ''
        oportunidad_monto = float(item.monto) if item.monto else 0
        
        # Mapear el producto de la oportunidad a las marcas disponibles
        brand_totals = {}
        if oportunidad_producto and oportunidad_monto > 0:
            # Detectar marca por el producto de la oportunidad
            producto_upper = oportunidad_producto.upper()
            marca_detectada = None
            
            for brand in brand_columns.keys():
                if brand.upper() in producto_upper:
                    marca_detectada = brand
                    break
            
            # Si no se detecta por nombre, usar mapeo específico
            if not marca_detectada:
                producto_mappings = {
                    'ZEBRA': ['ZEBRA'],
                    'PANDUIT': ['PANDUIT'],
                    'APC': ['APC', 'UPS'],
                    'AVIGILION': ['AVIGILION', 'CCTV', 'CAMARA'],
                    'GENETEC': ['GENETEC', 'SEGURIDAD'],
                    'AXIS': ['AXIS'],
                    'SOFTWARE': ['SOFTWARE', 'APP', 'DESARROLLO'],
                    'RUNRATE': ['RUNRATE', 'RUN RATE'],
                    'PÓLIZA': ['PÓLIZA', 'POLIZA', 'SEGURO'],
                    'CISCO': ['CISCO', 'NETWORKING', 'RED']
                }
                
                for brand, keywords in producto_mappings.items():
                    if any(keyword in producto_upper for keyword in keywords):
                        marca_detectada = brand
                        break
            
            # Si se detectó una marca, asignar el monto
            if marca_detectada:
                brand_totals[marca_detectada] = oportunidad_monto
        
        # Prepare row data
        row_data = [
            item.oportunidad,
            item.cliente.nombre_empresa if item.cliente else '',
            item.get_area_display(),
            str(item.contacto) if item.contacto else ''
        ]
        
        # Add brand amounts - usar las marcas correctas
        for brand in ['ZEBRA', 'PANDUIT', 'APC', 'AVIGILION', 'GENETEC', 'AXIS', 'SOFTWARE', 'RUNRATE', 'PÓLIZA', 'CISCO']:
            amount = brand_totals.get(brand, 0)
            row_data.append(f"${amount:,.2f}" if amount > 0 else '')
        
        # Add monthly data - LA PROBABILIDAD VA EN EL MES DE CIERRE
        months = [''] * 12
        
        # Extraer mes_cierre y probabilidad_cierre correctamente
        mes_cierre_valor = item.mes_cierre  # CharField con valores como '01', '02', etc.
        probabilidad_valor = item.probabilidad_cierre  # IntegerField
        
        logger.debug(f"DEBUG: Raw mes_cierre: '{mes_cierre_valor}' (type: {type(mes_cierre_valor)})")
        logger.debug(f"DEBUG: Raw probabilidad_cierre: {probabilidad_valor} (type: {type(probabilidad_valor)})")
        
        # Convertir mes_cierre a índice (0-11) para el array de meses
        if mes_cierre_valor and mes_cierre_valor.strip():
            # Crear mapeo de nombres de meses a números
            mes_nombres_a_numeros = {
                'Enero': 1, 'Febrero': 2, 'Marzo': 3, 'Abril': 4,
                'Mayo': 5, 'Junio': 6, 'Julio': 7, 'Agosto': 8,
                'Septiembre': 9, 'Octubre': 10, 'Noviembre': 11, 'Diciembre': 12
            }
            
            mes_str = mes_cierre_valor.strip()
            
            # Intentar convertir usando el mapeo de nombres
            if mes_str in mes_nombres_a_numeros:
                mes = mes_nombres_a_numeros[mes_str]
                logger.debug(f"DEBUG: mes_cierre '{mes_str}' mapped to int: {mes}")
                
                # Formatear la probabilidad
                if probabilidad_valor is not None:
                    probabilidad_str = f"{probabilidad_valor}%"
                else:
                    probabilidad_str = "0%"  # Default si no hay probabilidad
                
                # Asignar al mes correspondiente (mes-1 porque el array es 0-indexed)
                month_names = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEPT','OCT','NOV','DIC']
                months[mes - 1] = probabilidad_str
                logger.debug(f"DEBUG: Setting month {mes} ({month_names[mes-1]}) to {probabilidad_str}")
            else:
                # Intentar como número directo (fallback)
                try:
                    mes = int(mes_str)
                    if 1 <= mes <= 12:
                        if probabilidad_valor is not None:
                            probabilidad_str = f"{probabilidad_valor}%"
                        else:
                            probabilidad_str = "0%"
                        
                        month_names = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEPT','OCT','NOV','DIC']
                        months[mes - 1] = probabilidad_str
                        logger.debug(f"DEBUG: Setting month {mes} ({month_names[mes-1]}) to {probabilidad_str}")
                    else:
                        logger.debug(f"DEBUG: mes_cierre {mes} is out of range (1-12)")
                except (ValueError, TypeError):
                    logger.debug(f"DEBUG: Unable to convert mes_cierre '{mes_str}' - not a recognized month name or number")
        else:
            logger.debug(f"DEBUG: mes_cierre is None, empty or whitespace: '{mes_cierre_valor}'")
        
        logger.debug(f"DEBUG: Final months array: {months}")
        row_data.extend(months)
        
        # Add estatus (etapa_corta) before empleado
        estatus = getattr(item, 'etapa_corta', '') or ''
        row_data.append(estatus)
        
        row_data.append(item.usuario.get_full_name() or item.usuario.username if item.usuario else '')
        
        if OPENPYXL_AVAILABLE:
            # Excel version
            for col, value in enumerate(row_data, 1):
                cell = ws.cell(row=row, column=col, value=value)
                cell.border = border
                # Format currency columns (brand columns are 4-13)
                if col >= 4 and col <= 13 and value and value != '':
                    try:
                        numeric_value = float(value.replace('$', '').replace(',', ''))
                        cell.value = numeric_value
                        cell.number_format = '$#,##0.00'
                    except:
                        pass
        else:
            # CSV version
            writer.writerow(row_data)
        
        row += 1
    
    if OPENPYXL_AVAILABLE:
        # Auto-adjust column widths (14 main headers + 12 month columns + 1 estatus + 1 empleado = 28 total)
        total_columns = 14 + 12 + 1 + 1  # main headers + monthly columns + estatus + empleado
        for col in range(1, total_columns + 1):
            column_letter = get_column_letter(col)
            ws.column_dimensions[column_letter].width = 12
            
        # Make first column wider for opportunity names
        ws.column_dimensions['A'].width = 30

        # Create HTTP response
        response = HttpResponse(
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = 'attachment; filename="reporte_cotizaciones_oportunidades.xlsx"'
        
        wb.save(response)
    
    return response


@login_required
@require_http_methods(["POST"])
def editar_oportunidad_api(request, oportunidad_id):
    """
    API para editar información de una oportunidad
    """
    try:
        oportunidad = get_object_or_404(TodoItem, pk=oportunidad_id)
        
        # Verificar permisos - supervisores y compañeros de grupo pueden editar
        if not is_supervisor(request.user) and oportunidad.usuario != request.user:
            from .views_grupos import comparten_grupo
            if not (oportunidad.usuario and comparten_grupo(request.user, oportunidad.usuario)):
                return JsonResponse({'success': False, 'error': 'No tienes permisos para editar esta oportunidad'})
        
        updated_values = {}
        
        # Actualizar nombre (titulo) de la oportunidad
        if 'oportunidad' in request.POST and request.POST['oportunidad']:
            oportunidad.oportunidad = request.POST['oportunidad']
            updated_values['oportunidad'] = oportunidad.oportunidad

        # Actualizar cliente
        if 'cliente' in request.POST and request.POST['cliente']:
            try:
                cliente = Cliente.objects.get(id=request.POST['cliente'])
                oportunidad.cliente = cliente
                updated_values['cliente'] = cliente.nombre_empresa
            except Cliente.DoesNotExist:
                return JsonResponse({'success': False, 'error': 'Cliente no encontrado'})
        
        # Actualizar contacto (acepta ID de contacto)
        if 'contacto' in request.POST and request.POST['contacto']:
            try:
                contacto_obj = Contacto.objects.get(id=int(request.POST['contacto']))
                oportunidad.contacto = contacto_obj
                updated_values['contacto'] = f"{contacto_obj.nombre} {contacto_obj.apellido or ''}".strip()
            except (Contacto.DoesNotExist, ValueError):
                pass
        
        # Actualizar área
        if 'area' in request.POST and request.POST['area']:
            oportunidad.area = request.POST['area']
            updated_values['area'] = oportunidad.get_area_display()
        
        # Actualizar tipo de negociación
        if 'tipo_negociacion' in request.POST and request.POST['tipo_negociacion']:
            if request.POST['tipo_negociacion'] in ['runrate', 'proyecto']:
                oportunidad.tipo_negociacion = request.POST['tipo_negociacion']
                updated_values['tipo_negociacion'] = oportunidad.get_tipo_negociacion_display()
            else:
                return JsonResponse({'success': False, 'error': 'Tipo de negociación inválido'})
        
        # Actualizar producto
        if 'producto' in request.POST and request.POST['producto']:
            oportunidad.producto = request.POST['producto']
            updated_values['producto'] = oportunidad.get_producto_display()
        
        # Monto ya no es editable manualmente - se actualiza desde cotizaciones

        # Actualizar probabilidad
        if 'probabilidad' in request.POST:
            try:
                probabilidad = int(request.POST['probabilidad'])
                if 0 <= probabilidad <= 100:
                    oportunidad.probabilidad_cierre = probabilidad
                    updated_values['probabilidad'] = f"{probabilidad}%"
                else:
                    return JsonResponse({'success': False, 'error': 'Probabilidad debe estar entre 0 y 100'})
            except (ValueError, TypeError):
                return JsonResponse({'success': False, 'error': 'Probabilidad inválida'})
        
        # Actualizar mes de cierre
        if 'mes_cierre' in request.POST and request.POST['mes_cierre']:
            oportunidad.mes_cierre = request.POST['mes_cierre']
            updated_values['mes_cierre'] = oportunidad.get_mes_cierre_display()

        # Actualizar etapa (desde widget CRM)
        etapa_cambio = None
        if 'etapa_corta' in request.POST and request.POST['etapa_corta']:
            from .bitrix_integration import get_etapa_from_bitrix_stage
            nueva_etapa = request.POST['etapa_corta']
            etapa_cambio = nueva_etapa
            oportunidad.etapa_corta = nueva_etapa
            oportunidad.etapa_completa = nueva_etapa
            updated_values['etapa_corta'] = nueva_etapa

            # Automatización: Vendido s/PO o c/PO → probabilidad 100% + mes cierre 2 meses después
            if nueva_etapa in ('Vendido s/PO', 'Vendido c/PO'):
                from datetime import date as _date
                from dateutil.relativedelta import relativedelta
                oportunidad.probabilidad_cierre = 100
                updated_values['probabilidad_cierre'] = 100
                fecha_cierre = _date.today() + relativedelta(months=2)
                oportunidad.mes_cierre = str(fecha_cierre.month).zfill(2)
                oportunidad.anio_cierre = fecha_cierre.year
                updated_values['mes_cierre'] = oportunidad.mes_cierre

        # Actualizar usuario/vendedor
        if 'usuario' in request.POST and request.POST['usuario']:
            try:
                nuevo_usuario = User.objects.get(id=request.POST['usuario'])
                oportunidad.usuario = nuevo_usuario
                updated_values['usuario'] = nuevo_usuario.get_full_name() or nuevo_usuario.username
            except User.DoesNotExist:
                return JsonResponse({'success': False, 'error': 'Usuario no encontrado'})

        propietario_opp = oportunidad.usuario
        oportunidad.save()

        # Registrar en chat de grupo si es edición de oportunidad ajena
        try:
            if propietario_opp and propietario_opp != request.user:
                from .views_grupos import registrar_accion_grupo
                actor_nombre = request.user.get_full_name() or request.user.username
                prop_nombre = propietario_opp.get_full_name() or propietario_opp.username
                nombre_opp = oportunidad.oportunidad or 'oportunidad'
                if etapa_cambio:
                    msg = f'{actor_nombre} cambió la etapa de "{nombre_opp}" (de {prop_nombre}) a {etapa_cambio}'
                    accion = 'cambio_etapa'
                else:
                    msg = f'{actor_nombre} editó la oportunidad "{nombre_opp}" de {prop_nombre}'
                    accion = 'editar_oportunidad'
                registrar_accion_grupo(request.user, propietario_opp, accion, msg,
                                       objeto_tipo='oportunidad', objeto_id=oportunidad.id,
                                       objeto_titulo=nombre_opp)
        except Exception:
            pass

        # Ejecutar automatizaciones si hubo cambio de etapa
        tareas_auto = []
        if etapa_cambio:
            try:
                from .views_automatizacion import ejecutar_automatizaciones
                tareas_auto = ejecutar_automatizaciones(oportunidad, etapa_cambio, request.user)
            except Exception as e_auto:
                logger.debug(f'[Automatización] Error ejecutando reglas: {e_auto}')

        # Auto-crear ProyectoIAMET cuando un proyecto pasa a Levantamiento (o Vendido s/PO / c/PO como fallback)
        if etapa_cambio and etapa_cambio in ('Levantamiento', 'Vendido s/PO', 'Vendido c/PO') and oportunidad.tipo_negociacion in ('proyecto', 'bitrix_proyecto'):
            try:
                from .models import ProyectoIAMET, ProyectoConfiguracion
                from datetime import timedelta
                # Solo crear si no existe ya un proyecto vinculado a esta oportunidad
                if not ProyectoIAMET.objects.filter(oportunidad=oportunidad).exists():
                    from datetime import date
                    hoy = date.today()
                    proyecto = ProyectoIAMET.objects.create(
                        usuario=oportunidad.usuario,
                        oportunidad=oportunidad,
                        nombre=oportunidad.oportunidad,
                        cliente_nombre=oportunidad.cliente.nombre_empresa if oportunidad.cliente else '',
                        descripcion=oportunidad.comentarios or oportunidad.oportunidad,
                        utilidad_presupuestada=oportunidad.monto or 0,
                        status='active',
                        fecha_inicio=hoy,
                        fecha_fin=hoy + timedelta(days=30),
                    )
                    ProyectoConfiguracion.objects.create(proyecto=proyecto)
                    # Sync existing tasks from the opportunity
                    from .models import ProyectoTarea
                    tareas_opp = oportunidad.tareas_oportunidad.all()
                    for t in tareas_opp:
                        ProyectoTarea.objects.create(
                            proyecto=proyecto,
                            titulo=t.titulo,
                            descripcion=t.descripcion or '',
                            status='completed' if t.estado == 'completada' else 'pending',
                            prioridad='high' if t.prioridad == 'alta' else 'medium',
                            asignado_a=t.responsable,
                            fecha_limite=t.fecha_limite.date() if t.fecha_limite else None,
                        )
            except Exception as e_proy:
                logger.debug(f'[ProyectoIAMET] Error auto-creando proyecto: {e_proy}')

        return JsonResponse({
            'success': True,
            'message': 'Oportunidad actualizada correctamente',
            'updated_values': updated_values,
            'tareas_automaticas': tareas_auto,
        })
        
    except Exception as e:
        logger.debug(f"Error editando oportunidad: {e}")
        return JsonResponse({'success': False, 'error': str(e)})


@login_required
def oportunidad_detalle_api(request, id):
    """
    Devuelve los datos de una oportunidad en JSON para actualizar la fila tras edición.
    """
    try:
        todo = TodoItem.objects.get(pk=id)
        return JsonResponse({
            'id': todo.id,
            'oportunidad': todo.oportunidad,
            'monto': float(todo.monto),
            'probabilidad_cierre': todo.probabilidad_cierre,
            'cliente': str(todo.cliente) if todo.cliente else '',
            'mes_cierre': str(todo.get_mes_cierre_display()),
            'producto': str(todo.get_producto_display()),
            'area': str(todo.get_area_display()),
            'contacto': str(todo.contacto) if todo.contacto else '',
        })
    except TodoItem.DoesNotExist:
        return JsonResponse({'error': 'Oportunidad no encontrada'}, status=404)


@login_required
def actualizar_probabilidad(request, id):
    """
    API para actualizar la probabilidad_cierre de una oportunidad (TodoItem).
    URL: /api/oportunidad/<id>/probabilidad/
    """
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'No autenticado'}, status=401)
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    try:
        prob = int(request.POST.get('probabilidad', -1))
        if prob < 0 or prob > 100:
            return JsonResponse({'error': 'Probabilidad fuera de rango'}, status=400)
        todo = TodoItem.objects.get(pk=id)
        todo.probabilidad_cierre = prob
        todo.save(update_fields=['probabilidad_cierre'])
        return JsonResponse({'ok': True, 'probabilidad': prob})
    except TodoItem.DoesNotExist:
        return JsonResponse({'error': 'Oportunidad no encontrada'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@login_required
def actualizar_po(request, id):
    """API para actualizar los campos PO y Factura de una oportunidad."""
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'No autenticado'}, status=401)
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    try:
        todo = TodoItem.objects.get(pk=id)
        update_fields = []
        if 'po_number' in request.POST:
            todo.po_number = request.POST.get('po_number', '').strip()
            update_fields.append('po_number')
        if 'factura_numero' in request.POST:
            todo.factura_numero = request.POST.get('factura_numero', '').strip()
            update_fields.append('factura_numero')
        if update_fields:
            todo.save(update_fields=update_fields)
        return JsonResponse({'ok': True, 'po_number': todo.po_number, 'factura_numero': todo.factura_numero})
    except TodoItem.DoesNotExist:
        return JsonResponse({'error': 'Oportunidad no encontrada'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)


@csrf_exempt
@login_required

@login_required
def importar_oportunidades(request):
    clientes = Cliente.objects.all().order_by('nombre_empresa')

    if request.method == 'POST':
        cliente_id = request.POST.get('cliente')
        tabla_json = request.POST.get('tabla_json')

        if not cliente_id or not tabla_json:
            return JsonResponse({'error': 'Faltan datos obligatorios (cliente o tabla_json)'}, status=400)

        try:
            cliente = Cliente.objects.get(pk=cliente_id)
            oportunidades_data = json.loads(tabla_json)
        except Cliente.DoesNotExist:
            return JsonResponse({'error': 'Cliente no encontrado'}, status=404)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Formato JSON inválido para la tabla'}, status=400)

        created_count = 0
        errors = []

        # Mapeo de nombres de meses a números de dos dígitos
        MONTH_MAPPING = {
            "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
            "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
            "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12"
        }

        # Columnas de producto (deben coincidir con los choices de TodoItem.PRODUCTO_CHOICES)
        PRODUCT_COLUMNS = [
            "zebra", "panduit", "apc", "avigilon", "genetec", "axis",
            "desarrollo_app", "runrate", "poliza", "cisco"
        ]

        for row_data in oportunidades_data:
            try:
                oportunidad_nombre = row_data.get('oportunidad', '')
                area = row_data.get('area', '')
                contacto = row_data.get('contacto', '')

                # Encontrar el producto y el monto/mes de cierre
                producto = None
                monto = Decimal('0.00')
                mes_cierre = None

                # Buscar el producto en las columnas de producto
                for prod_col in PRODUCT_COLUMNS:
                    if row_data.get(prod_col) and row_data.get(prod_col).strip() != '':
                        producto = row_data[prod_col].strip().upper() # Convertir a mayúsculas para coincidir con choices
                        break
                
                # Buscar el monto y mes de cierre en las columnas de meses
                for month_name, month_num in MONTH_MAPPING.items():
                    if row_data.get(month_name) and row_data.get(month_name).strip() != '':
                        try:
                            monto = Decimal(row_data[month_name].strip())
                            mes_cierre = month_num
                            break
                        except (ValueError, TypeError):
                            pass # Ignorar si el monto no es un número válido

                # Validaciones básicas
                if not oportunidad_nombre:
                    errors.append(f"Fila con oportunidad vacía: {row_data}")
                    continue
                if not producto:
                    errors.append(f"Fila '{oportunidad_nombre}': Producto no especificado o inválido.")
                    continue
                if not mes_cierre or monto == Decimal('0.00'):
                    errors.append(f"Fila '{oportunidad_nombre}': Mes de cierre o monto no especificado/inválido.")
                    continue

                # Crear el TodoItem
                TodoItem.objects.create(
                    oportunidad=oportunidad_nombre,
                    cliente=cliente,
                    area=area,
                    contacto=contacto,
                    producto=producto,
                    monto=monto,
                    mes_cierre=mes_cierre,
                    usuario=request.user # Asignar al usuario que importa
                )
                created_count += 1
            except Exception as e:
                errors.append(f"Error procesando fila {row_data}: {e}")

        if errors:
            return JsonResponse({'success': False, 'errors': errors}, status=400)
        else:
            return JsonResponse({'success': True, 'message': f'{created_count} oportunidades importadas con éxito.'})

    context = {
        'clientes': clientes,
    }
    return render(request, 'importar_oportunidades.html', context)


@csrf_exempt
@login_required
def crear_oportunidad_api(request):
    if request.method != 'POST':
        return JsonResponse({'success': False, 'errors': 'Invalid request method'}, status=405)

    cliente_id = request.POST.get('cliente')
    oportunidad_nombre = request.POST.get('oportunidad') # Get opportunity name from POST
    monto = request.POST.get('monto')
    area = request.POST.get('area')
    mes_cierre = request.POST.get('mes_cierre')
    probabilidad_cierre = request.POST.get('probabilidad_cierre')
    
    # Set default values for fields not present in the simplified modal
    producto = request.POST.get('producto', '') # Default to empty string
    comentarios = request.POST.get('comentarios', '') # Default to empty string
    bitrix_stage_id = request.POST.get('bitrix_stage_id', 'UC_YUQKW6') # Default to 'Cotizando'

    if not cliente_id:
        return JsonResponse({'success': False, 'errors': {'cliente': 'ID de cliente es requerido.'}}, status=400)
    if not oportunidad_nombre:
        return JsonResponse({'success': False, 'errors': {'oportunidad': 'Nombre de oportunidad es requerido.'}}, status=400)
    if not monto:
        return JsonResponse({'success': False, 'errors': {'monto': 'Monto es requerido.'}}, status=400)
    if not area:
        return JsonResponse({'success': False, 'errors': {'area': 'Área es requerida.'}}, status=400)
    if not mes_cierre:
        return JsonResponse({'success': False, 'errors': {'mes_cierre': 'Mes de cierre es requerido.'}}, status=400)
    if not probabilidad_cierre:
        return JsonResponse({'success': False, 'errors': {'probabilidad_cierre': 'Probabilidad de cierre es requerida.'}}, status=400)

    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'success': False, 'errors': {'cliente': 'Cliente seleccionado no encontrado.'}}, status=404)

    # Ensure the client has a bitrix_company_id
    if not cliente.bitrix_company_id:
        bitrix_company_id = get_or_create_bitrix_company(cliente.nombre_empresa, request=request)
        if bitrix_company_id:
            cliente.bitrix_company_id = bitrix_company_id
            cliente.save()
        else:
            return JsonResponse({'success': False, 'errors': {'cliente': 'No se pudo obtener o crear el ID de compañía de Bitrix para el cliente.'}}, status=400)
    
    # Create a dictionary for the TodoItem data
    todo_item_data = {
        'oportunidad': oportunidad_nombre,
        'monto': float(monto),
        'cliente': cliente,
        'usuario': request.user, # Assign the current user
        'area': area,
        'mes_cierre': mes_cierre,
        'anio_cierre': timezone.localdate().year,
        'probabilidad_cierre': int(probabilidad_cierre),
        'producto': producto, # Use default or provided
        'comentarios': comentarios, # Use default or provided
        'bitrix_stage_id': bitrix_stage_id, # Use default or provided
        'po_number': '', # Ensure PO is empty on creation
    }

    try:
        venta = TodoItem.objects.create(**todo_item_data)
        
        opportunity_data = {
            'oportunidad': venta.oportunidad,
            'monto': float(venta.monto),
            'cliente': cliente.nombre_empresa,
            'bitrix_company_id': cliente.bitrix_company_id,
            'producto': venta.producto,
            'area': venta.area,
            'mes_cierre': venta.mes_cierre,
            'probabilidad_cierre': venta.probabilidad_cierre,
            'comentarios': venta.comentarios,
            'bitrix_stage_id': venta.bitrix_stage_id,
            'bitrix_contact_id': None, # No contact from simplified form
        }
        
        bitrix_assigned_by_id = None
        if venta.usuario and hasattr(venta.usuario, 'userprofile') and venta.usuario.userprofile.bitrix_user_id:
            bitrix_assigned_by_id = venta.usuario.userprofile.bitrix_user_id
        opportunity_data['bitrix_assigned_by_id'] = bitrix_assigned_by_id
        
        bitrix_response = send_opportunity_to_bitrix(opportunity_data, request=request)
        
        if bitrix_response and bitrix_response.get('result'):
            venta.bitrix_deal_id = bitrix_response.get('result')
            venta.save(update_fields=['bitrix_deal_id'])
            
        return JsonResponse({
            'success': True,
            'oportunidad': {
                'id': venta.id,
                'nombre': venta.oportunidad,
            }
        })

    except Exception as e:
        logger.debug(f"ERROR: Falló la sincronización con Bitrix24 para la oportunidad {oportunidad_nombre}: {e}")
        return JsonResponse({
            'success': True, # Still return success for local creation
            'oportunidad': {
                'id': venta.id if 'venta' in locals() else None, # Return ID if created locally
                'nombre': oportunidad_nombre,
            },
            'warning': f'Oportunidad creada localmente, pero falló la sincronización con Bitrix24: {e}'
        })


@login_required
def check_new_local_opportunities(request):
    """
    API endpoint para detectar nuevas oportunidades creadas en nuestro sistema.
    Esta función verifica si hay oportunidades creadas después del último timestamp de verificación.
    """
    try:
        # Obtener timestamp de la última verificación desde el parámetro GET
        last_check_timestamp = request.GET.get('last_check')
        
        if not last_check_timestamp:
            return JsonResponse({
                'success': False,
                'error': 'Falta el parámetro last_check'
            })
        
        # Convertir timestamp a datetime
        from datetime import datetime
        last_check = datetime.fromtimestamp(int(last_check_timestamp) / 1000, tz=timezone.utc)
        
        # Primero verificar si hay una alerta inmediata en la sesión (Crown Jewel Feature)
        opportunities_data = []
        session_key = f'new_opportunity_alert_{request.user.id}'
        
        if session_key in request.session:
            # Hay una oportunidad que se acaba de crear - procesarla inmediatamente
            alert_data = request.session.pop(session_key)  # Remover después de leer
            opportunities_data.append(alert_data)
            logger.debug(f"DEBUG: Detectada oportunidad inmediata desde sesión: {alert_data}")
        
        # También buscar oportunidades nuevas creadas después del último check
        # Solo buscar las del usuario actual o todas si es supervisor
        if is_supervisor(request.user):
            new_opportunities = TodoItem.objects.filter(
                created_at__gt=last_check
            ).select_related('cliente').order_by('-created_at')[:5]
        else:
            new_opportunities = TodoItem.objects.filter(
                user=request.user,
                created_at__gt=last_check
            ).select_related('cliente').order_by('-created_at')[:5]
        
        # Agregar oportunidades de base de datos a la lista existente
        for opp in new_opportunities:
            opportunities_data.append({
                'id': opp.id,
                'titulo': opp.oportunidad,
                'cliente_id': opp.cliente.id if opp.cliente else None,
                'cliente_nombre': opp.cliente.nombre_empresa if opp.cliente else 'Sin cliente',
                'monto_estimado': str(opp.precio_estimado) if opp.precio_estimado else 'N/A',
                'probabilidad': opp.probabilidad_exito,
                'created_at': opp.created_at.isoformat(),
                'user': opp.usuario.username if opp.usuario else 'Sin usuario'
            })
        
        return JsonResponse({
            'success': True,
            'new_opportunities': opportunities_data,
            'count': len(opportunities_data),
            'last_check': last_check.isoformat()
        })
        
    except ValueError as e:
        return JsonResponse({
            'success': False,
            'error': f'Error en el formato del timestamp: {e}'
        })
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Error interno del servidor: {e}'
        })


@login_required
def check_new_bitrix_opportunities(request):
    """
    API endpoint para detectar nuevas oportunidades directamente desde Bitrix24.
    Esta función consulta la API de Bitrix para detectar oportunidades creadas recientemente.
    """
    from .bitrix_integration import get_all_bitrix_deals
    from datetime import datetime, timedelta
    from django.utils import timezone, translation
    from django.utils.translation import gettext_lazy as _
    from django.http import JsonResponse
    from django.utils.translation import activate, get_language

    try:
        # Obtener timestamp de la última verificación desde el parámetro GET
        last_check_timestamp = request.GET.get('last_check')
        if not last_check_timestamp:
            return JsonResponse({
                'success': False,
                'error': 'Falta el parámetro last_check'
            })
        
        # Convertir timestamp a datetime
        last_check = datetime.fromtimestamp(int(last_check_timestamp) / 1000, tz=django_timezone.utc)
        
        # Obtener el ID de usuario de Bitrix24 para este usuario de Django
        try:
            user_profile = request.user.userprofile
            user_bitrix_id = str(user_profile.bitrix_user_id) if user_profile.bitrix_user_id else None
        except:
            user_bitrix_id = None
            
        if not user_bitrix_id:
            return JsonResponse({
                'success': True,
                'new_opportunities': [],
                'count': 0,
                'message': 'Usuario no tiene ID de Bitrix24 configurado'
            })
        
        # Consultar todas las oportunidades desde Bitrix24
        bitrix_deals = get_all_bitrix_deals(request)
        
        if not bitrix_deals:
            return JsonResponse({
                'success': True,
                'new_opportunities': [],
                'count': 0,
                'message': 'No se pudieron obtener oportunidades de Bitrix24'
            })
        
        # Filtrar solo oportunidades asignadas a este usuario en Bitrix24
        user_deals = [deal for deal in bitrix_deals if deal.get('ASSIGNED_BY_ID') == user_bitrix_id]
        
        logger.debug(f"DEBUG Bot: Usuario Django {request.user.username} → Bitrix ID {user_bitrix_id}")
        logger.debug(f"DEBUG Bot: Encontradas {len(user_deals)} oportunidades para este usuario de {len(bitrix_deals)} totales")
        
        # Filtrar oportunidades nuevas (que no existen en nuestro sistema)
        recent_deals = []
        
        for deal in user_deals[:10]:  # Solo las 10 más recientes del usuario
            # Verificar si esta oportunidad ya existe en nuestro sistema
            deal_id = deal.get('ID')
            if deal_id:
                existing_opportunity = TodoItem.objects.filter(
                    bitrix_deal_id=deal_id
                ).first()
                
                if not existing_opportunity:
                    # Esta es una nueva oportunidad que no tenemos en nuestro sistema
                    # Obtener datos de la compañía si existe
                    company_name = 'Cliente por definir'
                    if deal.get('COMPANY_ID'):
                        try:
                            from .bitrix_integration import get_bitrix_company_details
                            company_data = get_bitrix_company_details(deal.get('COMPANY_ID'), request)
                            if company_data and company_data.get('TITLE'):
                                company_name = company_data.get('TITLE')
                        except Exception as e:
                            logger.debug(f"Error obteniendo datos de compañía: {e}")
                    
                    recent_deals.append({
                        'id': deal_id,
                        'bitrix_id': deal_id,
                        'titulo': deal.get('TITLE', 'Sin título'),
                        'monto_estimado': deal.get('OPPORTUNITY', '0'),
                        'company_id': deal.get('COMPANY_ID'),
                        'company_name': company_name,
                        'contact_id': deal.get('CONTACT_ID'),
                        'stage_id': deal.get('STAGE_ID'),
                        'comentarios': deal.get('COMMENTS', ''),
                        'assigned_by_id': deal.get('ASSIGNED_BY_ID'),
                        # Mapear campos personalizados
                        'producto_bitrix_id': deal.get('UF_CRM_1752859685662'),
                        'area_bitrix_id': deal.get('UF_CRM_1752859525038'),
                        'mes_cierre_bitrix_id': deal.get('UF_CRM_1752859877756'),
                        'probabilidad_bitrix_id': deal.get('UF_CRM_1752855787179'),
                        'is_from_bitrix': True,
                        'detected_at': django_timezone.now().isoformat()
                    })
        
        logger.debug(f"DEBUG Bot: Encontradas {len(recent_deals)} nuevas oportunidades desde Bitrix24")
        
        return JsonResponse({
            'success': True,
            'new_opportunities': recent_deals,
            'count': len(recent_deals),
            'last_check': django_timezone.now().timestamp() * 1000  # Nuevo timestamp
        })
        
    except Exception as e:
        logger.debug(f"ERROR Bot: Error al verificar oportunidades desde Bitrix24: {e}")
        return JsonResponse({
            'success': False,
            'error': f'Error al verificar oportunidades desde Bitrix24: {str(e)}'
        }, status=500)


@login_required
def nueva_oportunidad(request):
    """
    Vista optimizada para crear nuevas oportunidades con mejor UX y automatización.
    """
    if request.method == 'POST':
        form = NuevaOportunidadForm(request.POST, user=request.user)
        if form.is_valid():
            try:
                oportunidad = form.save()
                messages.success(request, f'Oportunidad "{oportunidad.oportunidad}" creada exitosamente.')
                return redirect('todos')  # Redirigir a la lista de oportunidades
            except Exception as e:
                messages.error(request, f'Error al crear la oportunidad: {str(e)}')
        else:
            # Mostrar errores específicos del formulario
            for field, errors in form.errors.items():
                for error in errors:
                    messages.error(request, f'{field}: {error}')
    else:
        form = NuevaOportunidadForm(user=request.user)
    
    # Obtener lista de clientes para autocompletado
    clientes = Cliente.objects.all().order_by('nombre_empresa')
    
    context = {
        'form': form,
        'clientes': clientes,
        'title': 'Nueva Oportunidad'
    }
    
    return render(request, 'nueva_oportunidad.html', context)


@login_required
def api_crear_oportunidad(request):
    """
    API AJAX para crear oportunidad desde el widget CRM.

    Acepta cliente vía:
      - cliente_ref = 'c-<id>'  → Cliente existente
      - cliente_ref = 'p-<id>'  → ClientePotencial → se promueve a Cliente
                                    y el ClientePotencial se elimina
                                    (todo dentro de transaction.atomic).
      - cliente_nombre (legacy) → busca/crea Cliente por nombre_empresa.
    """
    if request.method != 'POST':
        return JsonResponse({'ok': False, 'error': 'Método no permitido'}, status=405)

    from django.db import transaction

    try:
        import json
        data = json.loads(request.body) if request.content_type == 'application/json' else request.POST

        cliente_ref = (data.get('cliente_ref') or '').strip()
        cliente_nombre = (data.get('cliente_nombre') or '').strip()

        oportunidad_nombre = data.get('oportunidad', '').strip()
        if not oportunidad_nombre:
            return JsonResponse({'ok': False, 'error': 'El nombre de la oportunidad es requerido.'})

        monto = data.get('monto', 0)
        try:
            monto = Decimal(str(monto))
        except Exception:
            monto = Decimal('0')

        # Resolver cliente desde cliente_ref con prefijo, o por nombre legacy.
        cliente = None
        promovido_desde_potencial = False
        with transaction.atomic():
            if cliente_ref.startswith('c-'):
                try:
                    cliente = Cliente.objects.get(id=int(cliente_ref[2:]))
                except (Cliente.DoesNotExist, ValueError):
                    return JsonResponse({'ok': False, 'error': 'Cliente no encontrado'}, status=404)
                if not cliente_nombre:
                    cliente_nombre = cliente.nombre_empresa
            elif cliente_ref.startswith('p-'):
                try:
                    potencial = ClientePotencial.objects.select_for_update().get(id=int(cliente_ref[2:]))
                except (ClientePotencial.DoesNotExist, ValueError):
                    return JsonResponse({'ok': False, 'error': 'Prospecto no encontrado'}, status=404)
                # Crear Cliente con datos del potencial
                cliente = Cliente.objects.create(
                    nombre_empresa=potencial.nombre,
                    asignado_a=potencial.asignado_a,
                    convertido_de_potencial_at=timezone.now(),
                )
                cliente_nombre = cliente.nombre_empresa
                promovido_desde_potencial = True
                # El ClientePotencial se elimina al final de la transacción
                # (después de crear la oportunidad para que la conversión sea
                # atómica).
                potencial_id_a_borrar = potencial.id
            else:
                # Legacy: buscar por nombre, crear si no existe
                if not cliente_nombre or len(cliente_nombre) < 2:
                    return JsonResponse({'ok': False, 'error': 'El nombre del cliente es requerido (mín. 2 caracteres).'})
                cliente = Cliente.objects.filter(nombre_empresa__iexact=cliente_nombre).order_by('id').first()
                if not cliente:
                    cliente = Cliente.objects.create(nombre_empresa=cliente_nombre, asignado_a=request.user)

            # Buscar o crear contacto (dentro de la transacción)
            contacto = None
            contacto_nombre = data.get('contacto_nombre', '').strip()
            if contacto_nombre:
                nombre_parts = contacto_nombre.split(' ', 1)
                contacto, _ = Contacto.objects.get_or_create(
                    nombre__iexact=nombre_parts[0],
                    cliente=cliente,
                    defaults={
                        'nombre': nombre_parts[0],
                        'apellido': nombre_parts[1] if len(nombre_parts) > 1 else '',
                        'cliente': cliente
                    }
                )

            tipo_neg = data.get('tipo_negociacion', 'runrate')
            # Asignar etapa inicial desde la BD (primera etapa activa del pipeline)
            primera_etapa = EtapaPipeline.objects.filter(pipeline=tipo_neg, activo=True).order_by('orden').first()
            if primera_etapa:
                etapa_corta_init = primera_etapa.nombre
                etapa_completa_init = primera_etapa.nombre
                etapa_color_init = primera_etapa.color
            elif tipo_neg == 'proyecto':
                etapa_corta_init = 'Oportunidad'
                etapa_completa_init = 'Oportunidad'
                etapa_color_init = '#FFFFFF'
            else:
                etapa_corta_init = 'En Solicitud'
                etapa_completa_init = 'Solicitud de Cotizacion'
                etapa_color_init = '#FFFFFF'

            from datetime import datetime as dt_create
            now_dt = dt_create.now()
            mes_actual = str(now_dt.month).zfill(2)

            raw_mes = (data.get('mes_cierre') or '').strip() if isinstance(data.get('mes_cierre'), str) else str(data.get('mes_cierre') or '').strip()
            if not raw_mes or raw_mes == 'todos':
                raw_mes = mes_actual
            mes_cierre_val = raw_mes

            todo = TodoItem(
                usuario=request.user,
                oportunidad=oportunidad_nombre,
                cliente=cliente,
                contacto=contacto,
                monto=monto,
                probabilidad_cierre=int(data.get('probabilidad_cierre', 25)),
                mes_cierre=mes_cierre_val,
                anio_cierre=now_dt.year,
                area=data.get('area', 'SISTEMAS'),
                producto=data.get('producto', 'SOFTWARE'),
                tipo_negociacion=tipo_neg,
                comentarios=data.get('comentarios', ''),
                etapa_corta=etapa_corta_init,
                etapa_completa=etapa_completa_init,
                etapa_color=etapa_color_init,
                po_number='', # Ensure PO is empty on creation
            )
            todo.save()

            # Eliminar el ClientePotencial al final de la transacción —
            # solo si todo lo anterior tuvo éxito. Si algo falla, el rollback
            # revierte la creación del Cliente y la oportunidad y el potencial
            # queda intacto.
            if promovido_desde_potencial:
                ClientePotencial.objects.filter(id=potencial_id_a_borrar).delete()

        # Ejecutar automatizaciones para la etapa inicial
        try:
            from .views_automatizacion import ejecutar_automatizaciones
            ejecutar_automatizaciones(todo, etapa_corta_init, request.user)
        except Exception:
            pass  # No bloquear la creación si falla la automatización

        # If there are comments, add them as a chat message
        if todo.comentarios:
            from .models import MensajeOportunidad
            MensajeOportunidad.objects.create(
                oportunidad=todo,
                usuario=request.user,
                texto=todo.comentarios
            )

        # Notificar al chat de grupo si el cliente está asignado a otro miembro
        try:
            if cliente and hasattr(cliente, 'asignado_a') and cliente.asignado_a and cliente.asignado_a != request.user:
                from .views_grupos import registrar_accion_grupo
                actor_nombre = request.user.get_full_name() or request.user.username
                registrar_accion_grupo(
                    request.user, cliente.asignado_a, 'crear_oportunidad',
                    f'{actor_nombre} creó la oportunidad "{oportunidad_nombre}" en el cliente {cliente.nombre_empresa}',
                    objeto_tipo='oportunidad', objeto_id=todo.id, objeto_titulo=oportunidad_nombre,
                )
        except Exception:
            pass

        return JsonResponse({
            'ok': True,
            'message': f'Oportunidad "{oportunidad_nombre}" creada exitosamente.',
            'id': todo.id
        })
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)})


@login_required
def api_oportunidad_detalle_crm(request, oportunidad_id):
    """
    API para obtener detalle completo de una oportunidad para el widget CRM.
    """
    try:
        todo = get_object_or_404(TodoItem, pk=oportunidad_id)

        # Obtener cotizaciones de esta oportunidad
        cotizaciones = Cotizacion.objects.filter(oportunidad=todo).order_by('-fecha_creacion')
        cots_list = []
        for cot in cotizaciones:
            cots_list.append({
                'id': cot.id,
                'titulo': cot.titulo or f'COT-{cot.id}',
                'fecha': cot.fecha_creacion.strftime('%d %b %Y') if cot.fecha_creacion else '',
                'total': float(cot.total) if cot.total else 0,
                'moneda': cot.moneda or 'MXN',
            })

        data = {
            'id': todo.id,
            'oportunidad': todo.oportunidad or '',
            'monto': float(todo.monto) if todo.monto else 0,
            'cliente': {
                'id': todo.cliente_id,
                'nombre': todo.cliente.nombre_empresa if todo.cliente else '',
            } if todo.cliente else None,
            'contacto': '',
            'contacto_id': todo.contacto_id,
            'producto': todo.producto or '',
            'area': todo.area or '',
            'probabilidad_cierre': todo.probabilidad_cierre or 0,
            'po_number': todo.po_number or '',
            'factura_numero': todo.factura_numero or '',
            'mes_cierre': todo.mes_cierre or '',
            'tipo_negociacion': todo.tipo_negociacion or 'runrate',
            'etapa_corta': todo.etapa_corta or '',
            'etapa_completa': todo.etapa_completa or '',
            'etapa_color': todo.etapa_color or '#FFFFFF',
            'usuario': todo.usuario.get_full_name() or todo.usuario.username if todo.usuario else '',
            'usuario_id': todo.usuario_id,
            'comentarios': todo.comentarios or '',
            'fecha_creacion': todo.fecha_creacion.strftime('%d/%m/%Y') if todo.fecha_creacion else '',
            # La barra de etapa reporta cuánto lleva sin moverse la oportunidad.
            'fecha_actualizacion': todo.fecha_actualizacion.isoformat() if todo.fecha_actualizacion else '',
            'cotizaciones': cots_list,
            'productos_adicionales': [
                {'id': p.id, 'producto': p.producto, 'notas': p.notas}
                for p in todo.productos_adicionales.all()
            ],
        }

        # Contacto
        if todo.contacto:
            if hasattr(todo.contacto, 'nombre'):
                data['contacto'] = f"{todo.contacto.nombre} {todo.contacto.apellido or ''}".strip()
            else:
                data['contacto'] = str(todo.contacto)

        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
def api_oportunidad_productos(request, oportunidad_id):
    """Lista y agrega productos adicionales a una oportunidad."""
    todo = get_object_or_404(TodoItem, pk=oportunidad_id)
    if request.method == 'GET':
        prods = [{'id': p.id, 'producto': p.producto, 'notas': p.notas}
                 for p in todo.productos_adicionales.all()]
        return JsonResponse({'productos': prods})
    elif request.method == 'POST':
        data = json.loads(request.body)
        producto = data.get('producto', '').strip()
        if not producto:
            return JsonResponse({'error': 'Producto requerido.'}, status=400)
        p = ProductoOportunidad.objects.create(
            oportunidad=todo,
            producto=producto,
            notas=data.get('notas', ''),
        )
        return JsonResponse({'id': p.id, 'producto': p.producto, 'notas': p.notas}, status=201)
    return JsonResponse({'error': 'Método no permitido.'}, status=405)


@login_required
@csrf_exempt
def api_oportunidad_producto_delete(request, oportunidad_id, producto_id):
    """Elimina un producto adicional de una oportunidad."""
    p = get_object_or_404(ProductoOportunidad, pk=producto_id, oportunidad_id=oportunidad_id)
    if request.method == 'DELETE':
        p.delete()
        return JsonResponse({'ok': True})
    return JsonResponse({'error': 'Método no permitido.'}, status=405)


@login_required
def api_buscar_clientes(request):
    """
    API para autocompletado de clientes en el formulario de nueva oportunidad.
    """
    query = request.GET.get('q', '').strip()
    
    if len(query) < 2:
        return JsonResponse({'clientes': []})
    
    # Buscar clientes que coincidan con el query (incluye grupo)
    from .views_grupos import get_clientes_visibles_q
    clientes = Cliente.objects.filter(
        Q(nombre_empresa__icontains=query) & get_clientes_visibles_q(request.user)
    ).order_by('nombre_empresa')[:10]
    
    clientes_data = []
    for cliente in clientes:
        clientes_data.append({
            'id': cliente.id,
            'nombre': cliente.nombre_empresa,
            'contacto_principal': cliente.contacto_principal or '',
            'email': cliente.email or '',
            'telefono': cliente.telefono or '',
            'tipo': 'cliente',
        })

    # ?potenciales=1 (modo prospecto del composer de prospección): incluir
    # también los ClientePotencial visibles — los creados desde el panel
    # admin o el mini-form, que antes NUNCA aparecían en la búsqueda.
    if request.GET.get('potenciales') == '1':
        from .models import ClientePotencial
        from .views_grupos import get_usuarios_visibles_ids
        pot_qs = ClientePotencial.objects.filter(nombre__icontains=query)
        visibles = get_usuarios_visibles_ids(request.user)
        if visibles is not None:
            pot_qs = pot_qs.filter(
                Q(asignado_a=request.user) | Q(asignado_a_id__in=visibles)
            )
        for pot in pot_qs.order_by('nombre')[:10]:
            clientes_data.append({
                'id': pot.id,
                'nombre': pot.nombre,
                'contacto_principal': '',
                'email': '',
                'telefono': '',
                'tipo': 'potencial',
            })

    return JsonResponse({'clientes': clientes_data})


@login_required  
def api_buscar_contactos(request):
    """
    API para autocompletado de contactos basado en el cliente seleccionado.
    """
    cliente_id = request.GET.get('cliente_id')
    query = request.GET.get('q', '').strip()
    
    if not cliente_id:
        return JsonResponse({'contactos': []})
    
    try:
        contactos = Contacto.objects.filter(cliente_id=cliente_id)
        
        if query:
            contactos = contactos.filter(
                Q(nombre__icontains=query) | Q(apellido__icontains=query)
            )
        
        contactos = contactos.order_by('nombre')[:10]
        
        contactos_data = []
        for contacto in contactos:
            contactos_data.append({
                'id': contacto.id,
                'nombre_completo': f"{contacto.nombre} {contacto.apellido or ''}".strip(),
                'nombre': contacto.nombre,
                'apellido': contacto.apellido or ''
            })
        
        return JsonResponse({'contactos': contactos_data})
        
    except Exception as e:
        return JsonResponse({'contactos': [], 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def cambiar_estado_oportunidad(request, oportunidad_id):
    """
    API para cambiar el estado CRM de una oportunidad
    """
    
    try:
        import json
        data = json.loads(request.body)
        estado = data.get('estado')
        
        if not estado:
            return JsonResponse({'error': 'Estado requerido'}, status=400)
        
        # Obtener la oportunidad
        oportunidad = get_object_or_404(TodoItem, id=oportunidad_id)

        # Validar que el usuario puede modificar esta oportunidad
        from .views_grupos import puede_actuar_sobre
        if not puede_actuar_sobre(request.user, oportunidad.usuario):
            return JsonResponse({'error': 'No tienes permisos para modificar esta oportunidad'}, status=403)

        # Guardar estado anterior para actividad
        estado_anterior = oportunidad.estado_crm
        
        # Actualizar estado
        oportunidad.estado_crm = estado
        oportunidad.save()
        
        # Crear actividad en el timeline
        actividad = OportunidadActividad.objects.create(
            oportunidad=oportunidad,
            tipo='cambio_estado',
            titulo='Cambio de Estado',
            descripcion=f'Estado cambiado de "{estado_anterior}" a "{estado}"',
            usuario=request.user,
            estado_anterior=estado_anterior,
            estado_nuevo=estado
        )
        
        logger.debug(f"🔄 Actividad creada: {actividad.id}, estado_anterior: {actividad.estado_anterior}, estado_nuevo: {actividad.estado_nuevo}")
        
        # Preparar datos del timeline item para el frontend
        usuario_nombre = request.user.get_full_name() or request.user.username
        timeline_item = {
            'id': actividad.id,
            'tipo': 'cambio_estado',
            'titulo': 'Cambio de Estado',
            'descripcion': f'Estado cambiado de "{estado_anterior}" a "{estado}"',
            'usuario': usuario_nombre,
            'fecha': convert_to_tijuana_time(actividad.fecha_creacion).strftime('%d/%m/%Y %H:%M'),
            'icono': '🔄 Cambio de Estado',
            'estado_anterior': estado_anterior,
            'estado_nuevo': estado
        }
        
        return JsonResponse({
            'success': True,
            'nuevo_estado': estado,
            'message': f'Estado actualizado a {estado}',
            'timeline_item': timeline_item
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def agregar_comentario_oportunidad(request, oportunidad_id):
    """
    API para agregar comentarios con archivos a una oportunidad
    """
    try:
        # Obtener contenido del comentario
        contenido = request.POST.get('contenido', '').strip()
        
        # Obtener la oportunidad
        oportunidad = get_object_or_404(TodoItem, id=oportunidad_id)

        # Verificar permisos: supervisores, dueño y compañeros de grupo
        from .views_grupos import puede_actuar_sobre
        if not puede_actuar_sobre(request.user, oportunidad.usuario):
            return JsonResponse({'error': 'No tienes permisos para comentar en esta oportunidad'}, status=403)

        # Verificar que hay contenido o archivos
        archivos_subidos = []
        archivos_keys = [key for key in request.FILES.keys() if key.startswith('archivo_')]
        
        if not contenido and not archivos_keys:
            return JsonResponse({'error': 'Debe proporcionar contenido o archivos'}, status=400)
        
        # Crear comentario (puede estar vacío si solo hay archivos)
        comentario = OportunidadComentario.objects.create(
            oportunidad=oportunidad,
            usuario=request.user,
            contenido=contenido or "Archivo adjunto"
        )
        
        # Procesar archivos adjuntos
        logger.debug(f"📁 Procesando {len(archivos_keys)} archivos: {archivos_keys}")
        for key in archivos_keys:
            archivo = request.FILES[key]
            logger.debug(f"📄 Procesando archivo: {archivo.name}, tamaño: {archivo.size}, tipo: {archivo.content_type}")
            
            # Determinar tipo de archivo
            content_type = archivo.content_type.lower()
            if content_type.startswith('image/'):
                tipo_archivo = 'imagen'
            elif content_type in ['application/pdf']:
                tipo_archivo = 'documento'
            elif content_type in ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']:
                tipo_archivo = 'documento'
            elif content_type in ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']:
                tipo_archivo = 'documento'
            else:
                tipo_archivo = 'otro'
            
            logger.debug(f"📋 Tipo determinado: {tipo_archivo}")
            
            try:
                # Crear registro de archivo
                archivo_obj = OportunidadArchivo.objects.create(
                    oportunidad=oportunidad,
                    usuario=request.user,
                    archivo=archivo,
                    nombre_original=archivo.name,
                    tipo=tipo_archivo,
                    tamaño=archivo.size,
                    descripcion=f"Adjuntado en comentario #{comentario.id}"
                )
                
                logger.debug(f"✅ Archivo guardado exitosamente: ID={archivo_obj.id}, URL={archivo_obj.archivo.url}")
                
                archivos_subidos.append({
                    'id': archivo_obj.id,
                    'nombre': archivo_obj.nombre_original,
                    'tipo': archivo_obj.tipo,
                    'tamaño': archivo_obj.tamaño,
                    'url': archivo_obj.archivo.url if archivo_obj.archivo else None
                })
                
            except Exception as e:
                logger.debug(f"❌ Error guardando archivo {archivo.name}: {e}")
                import traceback
                logger.debug(traceback.format_exc())
        
        # Crear actividad en el timeline con referencia al comentario
        descripcion_actividad = contenido[:200] + ('...' if len(contenido) > 200 else '')
        if archivos_subidos:
            if contenido:
                descripcion_actividad += f" ({len(archivos_subidos)} archivo{'s' if len(archivos_subidos) > 1 else ''} adjunto{'s' if len(archivos_subidos) > 1 else ''})"
            else:
                descripcion_actividad = f"Subió {len(archivos_subidos)} archivo{'s' if len(archivos_subidos) > 1 else ''}"
        
        # Agregar referencia al comentario en la descripción para linking directo
        descripcion_actividad += f" [COMENTARIO_ID:{comentario.id}]"
        
        logger.debug(f"🔥 Creando actividad - Usuario: {request.user}, Usuario ID: {request.user.id}, Nombre: {request.user.get_full_name()}")
        actividad_creada = OportunidadActividad.objects.create(
            oportunidad=oportunidad,
            tipo='comentario',
            titulo='Nuevo Comentario' + (' con archivos' if archivos_subidos else ''),
            descripcion=descripcion_actividad,
            usuario=request.user
        )
        logger.debug(f"💬 Actividad creada: ID={actividad_creada.id}, Usuario={actividad_creada.usuario}, Descripcion='{actividad_creada.descripcion}'")
        
        # ======================================
        # CREAR NOTIFICACIONES AUTOMÁTICAMENTE
        # ======================================
        
        # 1. Detectar menciones @usuario en el comentario
        if contenido:
            detectar_menciones_en_comentario(contenido, request.user, oportunidad, comentario)
        
        # 2. Notificar al dueño de la oportunidad (si no es el mismo que comenta)
        if oportunidad.usuario != request.user:
            mensaje_notif = f'{request.user.get_full_name() or request.user.username} comentó en tu oportunidad "{oportunidad.oportunidad}"'
            if contenido:
                mensaje_notif += f': {contenido[:100]}...' if len(contenido) > 100 else f': {contenido}'
            else:
                mensaje_notif += ' y adjuntó archivos'
                
            crear_notificacion(
                usuario_destinatario=oportunidad.usuario,
                tipo='comentario_oportunidad',
                titulo='Nuevo comentario en tu oportunidad',
                mensaje=mensaje_notif,
                oportunidad=oportunidad,
                comentario=comentario,
                usuario_remitente=request.user
            )
        
        # 3. Notificar a otros usuarios que han comentado en esta oportunidad (excepto el autor actual y el dueño)
        otros_comentaristas = User.objects.filter(
            oportunidadcomentario__oportunidad=oportunidad
        ).exclude(
            id__in=[request.user.id, oportunidad.usuario.id]
        ).distinct()
        
        for usuario in otros_comentaristas:
            mensaje_notif = f'{request.user.get_full_name() or request.user.username} también comentó en la oportunidad "{oportunidad.oportunidad}"'
            if contenido:
                mensaje_notif += f': {contenido[:100]}...' if len(contenido) > 100 else f': {contenido}'
            
            crear_notificacion(
                usuario_destinatario=usuario,
                tipo='comentario_oportunidad',
                titulo='Nuevo comentario en oportunidad que sigues',
                mensaje=mensaje_notif,
                oportunidad=oportunidad,
                comentario=comentario,
                usuario_remitente=request.user
            )
        
        return JsonResponse({
            'success': True,
            'comentario': {
                'id': comentario.id,
                'contenido': comentario.contenido,
                'usuario': request.user.get_full_name() or request.user.username,
                'fecha': convert_to_tijuana_time(comentario.fecha_creacion).strftime('%d/%m/%Y %H:%M'),
                'archivos': archivos_subidos
            }
        })
        
    except Exception as e:
        import traceback
        logger.debug(f"Error en agregar_comentario_oportunidad: {str(e)}")
        logger.debug(traceback.format_exc())
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def timeline_oportunidad(request, oportunidad_id):
    """
    API para obtener el timeline completo de una oportunidad
    """
    from datetime import timedelta
    
    oportunidad = get_object_or_404(TodoItem, id=oportunidad_id)

    # Verificar permisos: supervisores, dueño y compañeros de grupo
    from .views_grupos import puede_actuar_sobre
    if not puede_actuar_sobre(request.user, oportunidad.usuario):
        return JsonResponse({'error': 'No tienes permisos para ver este timeline'}, status=403)
    
    try:
        # Limpiar actividades huérfanas antes de generar el timeline
        try:
            limpiar_actividades_huerfanas(oportunidad)
        except Exception as e:
            logger.debug(f"Error limpiando actividades huérfanas: {e}")
            # Continuar sin limpiar si hay error
        
        # Obtener todas las actividades
        actividades = oportunidad.actividades_crm.all().order_by('-fecha_creacion')
        
        timeline_data = []
        for actividad in actividades:
            # Obtener información del usuario
            usuario_nombre = 'Sistema'
            if actividad.usuario:
                usuario_nombre = actividad.usuario.get_full_name() or actividad.usuario.username
            else:
                usuario_nombre = 'Sistema'
            
            # Convertir fecha a zona horaria de Tijuana (Pacific Time)
            fecha_tijuana = convert_to_tijuana_time(actividad.fecha_creacion)
            
            item_data = {
                'id': actividad.id,
                'tipo': actividad.tipo,
                'titulo': actividad.titulo,
                'descripcion': actividad.descripcion,
                'usuario': usuario_nombre,
                'fecha': fecha_tijuana.strftime('%d/%m/%Y %H:%M'),
                'icono': dict(OportunidadActividad.TIPO_ACTIVIDAD_CHOICES).get(actividad.tipo, '⚙️')
            }
            
            # Agregar campos específicos según el tipo de actividad
            if actividad.tipo == 'cambio_estado':
                item_data['estado_anterior'] = actividad.estado_anterior
                item_data['estado_nuevo'] = actividad.estado_nuevo
            elif actividad.tipo == 'comentario':
                # Para comentarios, buscar el contenido real del comentario
                try:
                    # Nueva estrategia: buscar por ID directo en la descripción
                    comentario = None
                    
                    # Estrategia 1: Buscar por ID directo en la descripción
                    import re
                    match = re.search(r'\[COMENTARIO_ID:(\d+)\]', actividad.descripcion or '')
                    if match:
                        comentario_id = int(match.group(1))
                        try:
                            comentario = OportunidadComentario.objects.get(id=comentario_id)
                        except OportunidadComentario.DoesNotExist:
                            comentario = None
                    
                    # Estrategia 2 (fallback): Buscar por rango de tiempo
                    if not comentario:
                        comentarios_candidatos = OportunidadComentario.objects.filter(
                            oportunidad=oportunidad,
                            fecha_creacion__gte=actividad.fecha_creacion - timedelta(minutes=1),
                            fecha_creacion__lte=actividad.fecha_creacion + timedelta(minutes=1)
                        ).order_by('-fecha_creacion')
                        
                        if comentarios_candidatos.exists():
                            comentario = comentarios_candidatos.first()
                    
                    # Estrategia 3 (último recurso): Buscar por usuario y fecha cercana
                    if not comentario and actividad.usuario:
                        comentarios_por_usuario = OportunidadComentario.objects.filter(
                            oportunidad=oportunidad,
                            usuario=actividad.usuario
                        ).order_by('-fecha_creacion')
                        
                        for c in comentarios_por_usuario:
                            diff = abs((c.fecha_creacion - actividad.fecha_creacion).total_seconds())
                            if diff <= 300:  # 5 minutos
                                comentario = c
                                break
                    
                    if comentario:
                        item_data['contenido'] = comentario.contenido
                        item_data['comentario_id'] = comentario.id
                        
                        # Limpiar la descripción para mostrar solo el contenido real (sin el ID)
                        descripcion_limpia = re.sub(r' \[COMENTARIO_ID:\d+\]', '', actividad.descripcion or '')
                        item_data['descripcion'] = descripcion_limpia
                        item_data['puede_editar'] = comentario.usuario == request.user or is_supervisor(request.user)
                        
                        # Buscar archivos asociados a este comentario específico
                        # Usar la descripción del archivo que contiene el ID del comentario
                        archivos_asociados = OportunidadArchivo.objects.filter(
                            oportunidad=oportunidad,
                            descripcion__contains=f"Adjuntado en comentario #{comentario.id}"
                        )
                        
                        # Buscar archivos asociados específicamente por descripción
                        
                        # Si no encuentra por descripción exacta, NO usar fallback para evitar contaminación cruzada
                        # (El fallback por tiempo era lo que causaba que todos los archivos aparecieran en todos los comentarios)
                        
                        if archivos_asociados.exists():
                            item_data['archivos'] = []
                            for archivo in archivos_asociados:
                                item_data['archivos'].append({
                                    'id': archivo.id,
                                    'nombre': archivo.nombre_original,
                                    'tipo': archivo.tipo,
                                    'tamaño': archivo.tamaño_legible,
                                    'fecha': convert_to_tijuana_time(archivo.fecha_subida).strftime('%d/%m/%Y %H:%M'),
                                    'url': archivo.archivo.url if archivo.archivo else None
                                })
                        
                        # Actualizar usuario con el del comentario si está disponible
                        if comentario.usuario:
                            usuario_comentario = comentario.usuario.get_full_name() or comentario.usuario.username
                            item_data['usuario'] = usuario_comentario
                            item_data['usuario_id'] = comentario.usuario.id
                    else:
                        # Si no se encuentra comentario, saltar esta actividad para evitar huérfanas
                        continue
                        
                except Exception as e:
                    # Si hay error, saltar esta actividad
                    continue
            
            timeline_data.append(item_data)
        
        return JsonResponse({
            'success': True,
            'timeline': timeline_data
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt
def editar_comentario_oportunidad(request, comentario_id):
    """
    API para editar un comentario específico de una oportunidad
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        # Obtener el comentario
        comentario = get_object_or_404(OportunidadComentario, id=comentario_id)
        
        # Verificar permisos: solo el autor del comentario o supervisores pueden editarlo
        if comentario.usuario != request.user and not is_supervisor(request.user):
            return JsonResponse({'error': 'No tienes permisos para editar este comentario'}, status=403)
        
        # Obtener el nuevo contenido
        nuevo_contenido = request.POST.get('contenido', '').strip()
        
        if not nuevo_contenido:
            return JsonResponse({'error': 'El contenido del comentario no puede estar vacío'}, status=400)
        
        # Actualizar el comentario
        comentario.contenido = nuevo_contenido
        comentario.save()
        
        return JsonResponse({
            'success': True,
            'message': 'Comentario actualizado exitosamente',
            'nuevo_contenido': nuevo_contenido,
            'fecha_actualizacion': convert_to_tijuana_time(comentario.fecha_actualizacion).strftime('%d/%m/%Y %H:%M')
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@csrf_exempt  
def eliminar_comentario_oportunidad(request, comentario_id):
    """
    API para eliminar un comentario específico de una oportunidad
    """
    if request.method != 'DELETE':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        # Obtener el comentario
        comentario = get_object_or_404(OportunidadComentario, id=comentario_id)
        
        # Verificar permisos: solo el autor del comentario o supervisores pueden eliminarlo
        if comentario.usuario != request.user and not is_supervisor(request.user):
            return JsonResponse({'error': 'No tienes permisos para eliminar este comentario'}, status=403)
        
        # Guardar información antes de eliminar
        oportunidad_id = comentario.oportunidad.id
        oportunidad = comentario.oportunidad
        usuario_comentario = comentario.usuario
        fecha_comentario = comentario.fecha_creacion
        
        logger.debug(f"🗑️ Eliminando comentario ID={comentario_id}, usuario={usuario_comentario}, fecha={fecha_comentario}")
        
        # Buscar y eliminar TODAS las actividades que podrían estar apuntando a este comentario
        try:
            # Estrategia más amplia: buscar todas las actividades de comentario que podrían estar relacionadas
            actividades_candidatas = OportunidadActividad.objects.filter(
                oportunidad=oportunidad,
                tipo='comentario'
            )
            
            actividades_eliminadas = 0
            for actividad in actividades_candidatas:
                # Verificar si esta actividad apunta al comentario que vamos a eliminar
                # usando el nuevo sistema de IDs
                deberia_eliminar = False
                
                # Estrategia 1: Buscar por ID directo en la descripción (nuevo sistema)
                import re
                match = re.search(r'\[COMENTARIO_ID:(\d+)\]', actividad.descripcion or '')
                if match:
                    comentario_referenciado = int(match.group(1))
                    if comentario_referenciado == comentario_id:
                        deberia_eliminar = True
                        logger.debug(f"🎯 Actividad {actividad.id} apunta al comentario que se va a eliminar: {comentario_id}")
                else:
                    # Estrategia 2: Fallback para actividades del sistema viejo
                    # Verificar por rango de tiempo
                    diff_tiempo = abs((actividad.fecha_creacion - fecha_comentario).total_seconds())
                    if diff_tiempo <= 300:  # 5 minutos
                        deberia_eliminar = True
                        logger.debug(f"⏱️ Actividad {actividad.id} encontrada por tiempo: diff={diff_tiempo}s")
                    
                    # Verificar por usuario y descripción similar
                    if (actividad.usuario == usuario_comentario and 
                        comentario.contenido in actividad.descripcion):
                        deberia_eliminar = True
                        logger.debug(f"📝 Actividad {actividad.id} encontrada por contenido")
                
                if deberia_eliminar:
                    logger.debug(f"🗑️ Eliminando actividad relacionada ID={actividad.id}")
                    actividad.delete()
                    actividades_eliminadas += 1
            
            logger.debug(f"✅ Eliminadas {actividades_eliminadas} actividades relacionadas")
            
        except Exception as e:
            logger.debug(f"⚠️ Error eliminando actividades relacionadas: {e}")
            # No fallar si no se pueden eliminar las actividades, el comentario sí se debe eliminar
        
        # Eliminar el comentario
        comentario.delete()
        logger.debug(f"✅ Comentario ID={comentario_id} eliminado exitosamente")
        
        return JsonResponse({
            'success': True,
            'message': 'Comentario eliminado exitosamente',
            'oportunidad_id': oportunidad_id
        })
        
    except Exception as e:
        logger.debug(f"❌ Error eliminando comentario: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def descargar_archivo_oportunidad(request, archivo_id):
    """
    Vista para descargar archivos adjuntos de oportunidades
    """
    try:
        archivo = get_object_or_404(OportunidadArchivo, id=archivo_id)

        # Verificar permisos: supervisores, dueño y compañeros de grupo
        from .views_grupos import puede_actuar_sobre
        if not puede_actuar_sobre(request.user, archivo.oportunidad.usuario):
            return JsonResponse({'error': 'No tienes permisos para descargar este archivo'}, status=403)

        # Verificar que el archivo existe
        if not archivo.archivo:
            return JsonResponse({'error': 'Archivo no encontrado'}, status=404)
        
        # Importar las clases necesarias para la respuesta
        from django.http import HttpResponse, Http404
        from django.utils.encoding import smart_str
        import os
        import mimetypes
        
        # Obtener la ruta del archivo
        file_path = archivo.archivo.path
        
        if not os.path.exists(file_path):
            raise Http404("El archivo no existe en el servidor")
        
        # Determinar el tipo MIME
        content_type, _ = mimetypes.guess_type(file_path)
        if content_type is None:
            content_type = 'application/octet-stream'
        
        # Leer el archivo
        with open(file_path, 'rb') as f:
            response = HttpResponse(f.read(), content_type=content_type)
        
        # Configurar headers para descarga
        filename = smart_str(archivo.nombre_original)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Content-Length'] = os.path.getsize(file_path)
        
        return response
        
    except Exception as e:
        logger.debug(f"❌ Error descargando archivo: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def vista_previa_archivo_oportunidad(request, archivo_id):
    """
    Vista para mostrar archivos en vista previa (inline)
    """
    try:
        archivo = get_object_or_404(OportunidadArchivo, id=archivo_id)

        # Verificar permisos: supervisores, dueño y compañeros de grupo
        from .views_grupos import puede_actuar_sobre
        if not puede_actuar_sobre(request.user, archivo.oportunidad.usuario):
            return HttpResponse('No tienes permisos para ver este archivo', status=403)

        # Verificar que el archivo existe
        if not archivo.archivo:
            return HttpResponse('Archivo no encontrado', status=404)
        
        # Importar las clases necesarias para la respuesta
        from django.http import HttpResponse, Http404
        from django.utils.encoding import smart_str
        import os
        import mimetypes
        
        # Obtener la ruta del archivo
        file_path = archivo.archivo.path
        
        if not os.path.exists(file_path):
            raise Http404("El archivo no existe en el servidor")
        
        # Determinar el tipo MIME
        content_type, _ = mimetypes.guess_type(file_path)
        if content_type is None:
            content_type = 'application/octet-stream'
        
        # Servir el archivo inline siempre (para vista previa en nueva pestaña)
        with open(file_path, 'rb') as f:
            response = HttpResponse(f.read(), content_type=content_type)
        
        # Configurar headers para vista inline (no descarga)
        filename = smart_str(archivo.nombre_original)
        response['Content-Disposition'] = f'inline; filename="{filename}"'
        response['Content-Length'] = os.path.getsize(file_path)
        
        return response
        
    except Exception as e:
        logger.debug(f"❌ Error en vista previa de archivo: {e}")
        return HttpResponse(f'Error al abrir archivo: {str(e)}', status=500)


# ── Novedades ──────────────────────────────────────────────────────────────

@login_required
def novedades_view(request):
    """Página de novedades estilo Apple Tips."""
    config = NovedadesConfig.get()
    return render(request, 'novedades.html', {
        'es_supervisor': is_supervisor(request.user),
        'novedades_config': config,
    })


@login_required
@require_http_methods(['POST'])
def api_toggle_novedades_widget(request):
    """Activa o desactiva el widget de novedades (solo supervisores)."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'No permitido'}, status=403)
    data = json.loads(request.body)
    config = NovedadesConfig.get()
    activando = bool(data.get('activo', False))
    config.widget_activo = activando
    if activando:
        config.activation_count += 1  # Nueva clave localStorage → todos vuelven a ver el widget
    config.save()
    return JsonResponse({
        'ok': True,
        'activo': config.widget_activo,
        'activation_count': config.activation_count,
    })


@login_required
@require_http_methods(['POST'])
def api_toggle_empleado_mes_widget(request):
    """Activa o desactiva el widget de empleado del mes (solo supervisores)."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'No permitido'}, status=403)
    data = json.loads(request.body)
    config = NovedadesConfig.get()
    activando = bool(data.get('activo', False))
    config.em_widget_activo = activando
    if activando:
        config.em_activation_count += 1
    config.save()
    return JsonResponse({
        'ok': True,
        'activo': config.em_widget_activo,
    })


@login_required
@require_http_methods(['POST'])
def api_quick_crear_cliente(request):
    """Crea un cliente rápido desde el formulario de nueva oportunidad."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = data.get('nombre_empresa', '').strip()
    if not nombre:
        return JsonResponse({'error': 'Nombre de empresa requerido'}, status=400)

    cliente, created = Cliente.objects.get_or_create(
        nombre_empresa__iexact=nombre,
        defaults={
            'nombre_empresa': nombre,
            'asignado_a': request.user,
        }
    )
    return JsonResponse({
        'success': True,
        'created': created,
        'id': cliente.id,
        'nombre': cliente.nombre_empresa,
    })


@login_required
@require_http_methods(['POST'])
def api_quick_crear_contacto(request):
    """Crea un contacto rápido desde el formulario de nueva oportunidad."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = data.get('nombre', '').strip()
    if not nombre:
        return JsonResponse({'error': 'Nombre requerido'}, status=400)

    empresa_id = data.get('empresa_id')
    empresa = None
    if empresa_id:
        try:
            empresa = Cliente.objects.get(id=empresa_id)
        except Cliente.DoesNotExist:
            pass

    contacto = Contacto.objects.create(
        nombre=nombre,
        apellido=data.get('apellido', '').strip(),
        cliente=empresa,
    )
    return JsonResponse({
        'success': True,
        'id': contacto.id,
        'nombre_completo': f"{contacto.nombre} {contacto.apellido}".strip(),
    })


@login_required
@require_http_methods(["GET"])
def api_desglose_cotizaciones(request):
    """Desglose de numero de cotizaciones por cliente."""
    from datetime import datetime
    from collections import Counter
    user = request.user
    profile, _ = UserProfile.objects.get_or_create(user=user)
    es_supervisor = is_supervisor(user)

    now = datetime.now()
    mes_filter = request.GET.get('mes', str(now.month).zfill(2))
    anio_filter = request.GET.get('anio', str(now.year))
    vendedores_filter = request.GET.get('vendedores', '')
    vendedores_ids = [int(x) for x in vendedores_filter.split(',') if x.strip().isdigit()] if vendedores_filter else []

    def _parse_ints_local(s):
        if not s or s == 'todos':
            return None
        parts = [p.strip() for p in str(s).split(',') if p.strip()]
        out = []
        for p in parts:
            try:
                out.append(int(p))
            except ValueError:
                pass
        return out or None

    anios_local = _parse_ints_local(anio_filter)
    meses_local = _parse_ints_local(mes_filter)
    anio_int = anios_local[0] if anios_local else now.year

    # Base queryset
    if anios_local is not None:
        base_qs = TodoItem.objects.filter(anio_cierre__in=anios_local)
    else:
        base_qs = TodoItem.objects.filter(anio_cierre=anio_int)
    if meses_local is not None:
        base_qs = base_qs.filter(mes_cierre__in=[str(m).zfill(2) for m in meses_local])
    if not es_supervisor:
        usuarios_visibles = get_usuarios_visibles_ids(user)
        if usuarios_visibles and len(usuarios_visibles) > 1:
            base_qs = base_qs.filter(usuario_id__in=usuarios_visibles)
        else:
            base_qs = base_qs.filter(usuario=user)
    elif vendedores_ids:
        base_qs = base_qs.filter(usuario_id__in=vendedores_ids)

    opp_ids = base_qs.values_list('id', flat=True)
    _sueltas_q = Q(oportunidad__isnull=True)
    if anios_local is not None:
        _sueltas_q &= Q(fecha_creacion__year__in=anios_local)
    else:
        _sueltas_q &= Q(fecha_creacion__year=anio_int)
    if meses_local is not None:
        _sueltas_q &= Q(fecha_creacion__month__in=meses_local)
    cot_qs = Cotizacion.objects.select_related('cliente').filter(
        Q(oportunidad_id__in=opp_ids) | _sueltas_q
    )

    # Contar por cliente
    count_by_client = Counter()
    monto_by_client = {}
    client_names = {}

    for cot in cot_qs:
        if not cot.cliente_id:
            continue
        count_by_client[cot.cliente_id] += 1
        monto_by_client[cot.cliente_id] = monto_by_client.get(cot.cliente_id, Decimal('0')) + (cot.total or Decimal('0'))
        if cot.cliente_id not in client_names:
            client_names[cot.cliente_id] = cot.cliente.nombre_empresa if cot.cliente else 'Sin Cliente'

    rows = []
    for cid, count in count_by_client.most_common():
        rows.append({
            'cliente': client_names.get(cid, 'Sin Cliente'),
            'cliente_id': cid,
            'num_cotizaciones': count,
            'monto_total': str(monto_by_client.get(cid, Decimal('0'))),
        })

    return JsonResponse({
        'ok': True,
        'rows': rows,
        'total': sum(count_by_client.values()),
    })


@login_required
@require_http_methods(["POST"])
def api_toggle_pin_oportunidad(request, opp_id):
    """Toggle anclar/desanclar una oportunidad para el usuario actual."""
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    ancladas = profile.oportunidades_ancladas or []
    if opp_id in ancladas:
        ancladas.remove(opp_id)
        anclada = False
    else:
        ancladas.append(opp_id)
        anclada = True
    profile.oportunidades_ancladas = ancladas
    profile.save(update_fields=["oportunidades_ancladas"])
    return JsonResponse({"success": True, "anclada": anclada})


# ──────────────────────────────────────────────────────────────────────
# Clientes Potenciales — endpoints para el flujo del vendedor
# ──────────────────────────────────────────────────────────────────────


@login_required
def api_clientes_potenciales(request):
    """GET: lista los ClientePotencial del usuario actual (o todos si supervisor).
    POST: crea uno (queda asignado al usuario actual; supervisores pueden pasar
          asignado_a_id explícito).
    """
    if request.method == 'GET':
        qs = ClientePotencial.objects.select_related('asignado_a')
        if not is_supervisor(request.user):
            qs = qs.filter(asignado_a=request.user)
        q = (request.GET.get('q') or '').strip()
        if q:
            qs = qs.filter(nombre__icontains=q)
        qs = qs.order_by('-fecha_actualizacion')
        data = []
        for p in qs:
            asig = p.asignado_a
            data.append({
                'id': p.id,
                'nombre': p.nombre,
                'asignado_a_id': asig.id if asig else None,
                'asignado_a_name': (asig.get_full_name() or asig.username) if asig else '',
                'notas': p.notas or '',
                'fecha_creacion': p.fecha_creacion.isoformat() if p.fecha_creacion else None,
                'fecha_actualizacion': p.fecha_actualizacion.isoformat() if p.fecha_actualizacion else None,
            })
        return JsonResponse({'prospectos': data})

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        nombre = (data.get('nombre') or '').strip()
        notas = (data.get('notas') or '').strip()
        if not nombre:
            return JsonResponse({'error': 'El nombre es requerido'}, status=400)
        asignado = request.user
        if is_supervisor(request.user) and data.get('asignado_a_id'):
            try:
                asignado = User.objects.get(id=int(data['asignado_a_id']))
            except (User.DoesNotExist, ValueError, TypeError):
                return JsonResponse({'error': 'Vendedor no encontrado'}, status=404)
        potencial = ClientePotencial.objects.create(
            nombre=nombre, asignado_a=asignado, notas=notas,
        )
        return JsonResponse({'success': True, 'id': potencial.id})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_cliente_potencial_detalle(request, potencial_id):
    """PUT: edita nombre/notas (asignado solo si supervisor).
       DELETE: elimina."""
    try:
        potencial = ClientePotencial.objects.select_related('asignado_a').get(id=potencial_id)
    except ClientePotencial.DoesNotExist:
        return JsonResponse({'error': 'Prospecto no encontrado'}, status=404)
    if not is_supervisor(request.user) and potencial.asignado_a_id != request.user.id:
        return JsonResponse({'error': 'No autorizado'}, status=403)

    if request.method == 'PUT':
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        if 'nombre' in data:
            nombre = (data.get('nombre') or '').strip()
            if not nombre:
                return JsonResponse({'error': 'El nombre no puede estar vacío'}, status=400)
            potencial.nombre = nombre
        if 'notas' in data:
            potencial.notas = (data.get('notas') or '').strip()
        if 'asignado_a_id' in data and is_supervisor(request.user):
            try:
                potencial.asignado_a = User.objects.get(id=int(data['asignado_a_id']))
            except (User.DoesNotExist, ValueError, TypeError):
                return JsonResponse({'error': 'Vendedor no encontrado'}, status=404)
        potencial.save()
        return JsonResponse({'success': True})

    if request.method == 'DELETE':
        potencial.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_seleccionables_oportunidad(request):
    """Endpoint unificado: devuelve Clientes (asignados al usuario o visibles)
    + ClientePotencial (asignados al usuario).

    Cada item lleva 'tipo' ('cliente' | 'potencial') y 'ref_key' con el
    formato 'c-<id>' o 'p-<id>' para que el frontend lo mande a
    api_crear_oportunidad. Permite filtrar con ?q=.
    """
    q = (request.GET.get('q') or '').strip()
    items = []

    # Clientes visibles (con la lógica existente del CRM)
    cli_qs = Cliente.objects.all()
    try:
        cli_qs = cli_qs.filter(get_clientes_visibles_q(request.user))
    except Exception:
        pass
    if q:
        cli_qs = cli_qs.filter(nombre_empresa__icontains=q)
    for c in cli_qs.order_by('nombre_empresa')[:25]:
        items.append({
            'id': c.id,
            'tipo': 'cliente',
            'ref_key': f'c-{c.id}',
            'nombre': c.nombre_empresa,
            'subtitulo': c.contacto_principal or '',
        })

    # ClientePotencial del usuario (o todos si supervisor)
    pot_qs = ClientePotencial.objects.select_related('asignado_a')
    if not is_supervisor(request.user):
        pot_qs = pot_qs.filter(asignado_a=request.user)
    if q:
        pot_qs = pot_qs.filter(nombre__icontains=q)
    for p in pot_qs.order_by('-fecha_actualizacion')[:25]:
        items.append({
            'id': p.id,
            'tipo': 'potencial',
            'ref_key': f'p-{p.id}',
            'nombre': p.nombre,
            'subtitulo': (p.notas or '')[:60],
        })

    # Ordenar: clientes primero (alfabético), después potenciales por recientes.
    return JsonResponse({'items': items})


@login_required
def api_dashboard_prospectos(request):
    """KPIs y tabla del dashboard de Prospectos.

    - total_asignados: # de ClientePotencial actuales del usuario (o todos si supervisor).
    - creados_este_mes: ClientePotencial creados este mes.
    - convertidos_este_mes: Cliente.convertido_de_potencial_at este mes.
    - top_vendedores: top 5 con más prospectos asignados.
    """
    now = timezone.now()
    mes_inicio = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    pot_qs = ClientePotencial.objects.all()
    cli_conv_qs = Cliente.objects.filter(convertido_de_potencial_at__isnull=False)
    if not is_supervisor(request.user):
        pot_qs = pot_qs.filter(asignado_a=request.user)
        cli_conv_qs = cli_conv_qs.filter(asignado_a=request.user)

    total_asignados = pot_qs.count()
    creados_este_mes = pot_qs.filter(fecha_creacion__gte=mes_inicio).count()
    convertidos_este_mes = cli_conv_qs.filter(convertido_de_potencial_at__gte=mes_inicio).count()

    # Top 5 vendedores por número de prospectos asignados.
    top = (
        ClientePotencial.objects.values('asignado_a__id', 'asignado_a__first_name',
                                        'asignado_a__last_name', 'asignado_a__username')
        .annotate(total=Count('id'))
        .order_by('-total')[:5]
    )
    top_vendedores = []
    for t in top:
        nombre = (f"{t['asignado_a__first_name']} {t['asignado_a__last_name']}").strip() or t['asignado_a__username']
        top_vendedores.append({'usuario_id': t['asignado_a__id'], 'nombre': nombre, 'total': t['total']})

    return JsonResponse({
        'total_asignados': total_asignados,
        'creados_este_mes': creados_este_mes,
        'convertidos_este_mes': convertidos_este_mes,
        'top_vendedores': top_vendedores,
    })


# ─────────────────────────────────────────────────────────────────────────
# Drill-down endpoints for Dashboard Prospectos (sub-tablas en cards)
# ─────────────────────────────────────────────────────────────────────────

def _dashboard_prosp_period_filters(request):
    """Lee mes/anio/vendedores como en _api_data y devuelve filtros aplicables.

    Retorna (anios_list, meses_list, vendedores_ids, es_supervisor, user).
    - anios_list/meses_list pueden ser None (todos), o lista de ints.
    """
    user = request.user
    es_supervisor = is_supervisor(user)
    mes_filter = (request.GET.get('mes') or '').strip()
    anio_filter = (request.GET.get('anio') or '').strip()

    def _parse_ints(s):
        if not s:
            return None
        try:
            out = [int(x) for x in s.split(',') if x.strip().lstrip('-').isdigit()]
            return out or None
        except Exception:
            return None

    anios_list = _parse_ints(anio_filter)
    meses_list = _parse_ints(mes_filter)
    if anios_list is None:
        from django.utils import timezone as _tz
        anios_list = [_tz.now().year]

    vendedores_filter = request.GET.get('vendedores', '')
    vendedores_ids = [int(x) for x in vendedores_filter.split(',') if x.strip().isdigit()] if vendedores_filter else []

    return anios_list, meses_list, vendedores_ids, es_supervisor, user


def _dashboard_prosp_qs(request):
    """Queryset de Prospecto con filtros mes/anio/vendedores aplicados."""
    from .models import Prospecto
    anios_list, meses_list, vendedores_ids, es_supervisor, user = _dashboard_prosp_period_filters(request)
    qs = Prospecto.objects.select_related('cliente', 'usuario').filter(fecha_creacion__year__in=anios_list)
    if meses_list is not None:
        qs = qs.filter(fecha_creacion__month__in=meses_list)
    if not es_supervisor:
        gids = get_usuarios_visibles_ids(user)
        if gids and len(gids) > 1:
            qs = qs.filter(usuario_id__in=gids)
        else:
            qs = qs.filter(usuario=user)
    elif vendedores_ids:
        qs = qs.filter(usuario_id__in=vendedores_ids)
    return qs


def _dashboard_prosp_opps_qs(request):
    """TodoItem queryset filtrado al periodo y origen prospección."""
    anios_list, meses_list, vendedores_ids, es_supervisor, user = _dashboard_prosp_period_filters(request)
    # Cuenta TODAS las opps que provengan de un prospecto, no solo la
    # primera (prospecto_origen__isnull es la reverse a Prospecto.oportunidad_creada
    # que solo apunta a UNA; prospecto_origen_directo es FK directo en cada opp).
    qs = TodoItem.objects.select_related('cliente', 'usuario').filter(
        Q(prospecto_origen_directo__isnull=False)
        | Q(prospecto_origen__isnull=False)
    ).distinct()
    if anios_list is not None:
        qs = qs.filter(anio_cierre__in=anios_list)
    if meses_list is not None:
        qs = qs.filter(mes_cierre__in=[str(m).zfill(2) for m in meses_list])
    if not es_supervisor:
        gids = get_usuarios_visibles_ids(user)
        if gids and len(gids) > 1:
            qs = qs.filter(usuario_id__in=gids)
        else:
            qs = qs.filter(usuario=user)
    elif vendedores_ids:
        qs = qs.filter(usuario_id__in=vendedores_ids)
    return qs.distinct()


_VENTA_ETAPAS = ('vendido', 'comprando', 'transito', 'entregado', 'facturado', 'cobrado')


def _q_oportunidad_vendida():
    cond = Q(probabilidad_cierre=100)
    for k in _VENTA_ETAPAS:
        cond |= Q(etapa_corta__icontains=k)
    return cond


_PROSP_ETAPA_LABEL = {
    'identificado': 'Identificado',
    'calificado': 'Calificado',
    'reunion': 'Reunión',
    'en_progreso': 'En Progreso',
    'procesado': 'Procesado',
    'cerrado_ganado': 'Ganado',
    'cerrado_perdido': 'Perdido',
}


def _prosp_to_dict(p):
    from django.utils import timezone as _tz
    fc = p.fecha_creacion
    fa = p.fecha_actualizacion
    vendedor = ''
    if p.usuario_id:
        vendedor = (p.usuario.get_full_name() or p.usuario.username) if hasattr(p, 'usuario') and p.usuario else ''
    return {
        'id': p.id,
        'nombre': p.nombre or '',
        'producto': p.producto or '',
        'etapa': p.etapa,
        'etapa_label': _PROSP_ETAPA_LABEL.get(p.etapa, p.etapa),
        'fecha_creacion': fc.strftime('%Y-%m-%d') if fc else '',
        'fecha_actualizacion': fa.strftime('%Y-%m-%d') if fa else '',
        'vendedor': vendedor,
        'oportunidad_creada_id': p.oportunidad_creada_id,
        'tipo_pipeline': p.tipo_pipeline or '',
    }


def _opp_to_dict(o):
    cliente_nombre = ''
    if o.cliente_id and o.cliente:
        cliente_nombre = o.cliente.nombre_empresa or ''
    vendedor = ''
    if o.usuario_id and o.usuario:
        vendedor = (o.usuario.get_full_name() or o.usuario.username) or ''
    monto = o.monto or Decimal('0')
    fc = o.fecha_creacion
    return {
        'id': o.id,
        'descripcion': o.oportunidad or '',
        'cliente': cliente_nombre,
        'cliente_id': o.cliente_id,
        'vendedor': vendedor,
        'monto': float(monto),
        'monto_fmt': '${:,.0f}'.format(monto),
        'etapa': o.etapa_corta or '',
        'producto': o.producto or '',
        'fecha_creacion': fc.strftime('%Y-%m-%d') if fc else '',
        'probabilidad_cierre': o.probabilidad_cierre or 0,
    }


@login_required
def api_dashboard_prospectos_cliente_prospecciones(request, cliente_id):
    """Lista de prospecciones de un cliente en el periodo (drill-down).

    Devuelve {'rows': [{id, nombre, etapa, etapa_label, fecha_creacion,
    fecha_actualizacion, vendedor, producto, oportunidad_creada_id}]}.
    """
    qs = _dashboard_prosp_qs(request).filter(cliente_id=cliente_id).order_by('-fecha_actualizacion')
    rows = [_prosp_to_dict(p) for p in qs]
    return JsonResponse({'rows': rows, 'count': len(rows)})


@login_required
def api_dashboard_prospectos_cliente_oportunidades(request, cliente_id):
    """Lista de oportunidades de un cliente que tienen prospecto_origen (drill-down).

    Solo devuelve las que provienen de prospección (Prospecto.oportunidad_creada).
    """
    qs = _dashboard_prosp_opps_qs(request).filter(cliente_id=cliente_id).order_by('-fecha_creacion')
    rows = [_opp_to_dict(o) for o in qs]
    return JsonResponse({'rows': rows, 'count': len(rows)})


@login_required
def api_dashboard_prospectos_ventas_detalle(request):
    """Lista de oportunidades VENDIDAS originadas de prospección.

    Para el card "Ventas Generadas". Devuelve listado plano con cliente.
    """
    qs = _dashboard_prosp_opps_qs(request).filter(_q_oportunidad_vendida()).order_by('-fecha_creacion')
    rows = [_opp_to_dict(o) for o in qs]
    total = sum((r['monto'] for r in rows), 0.0)
    return JsonResponse({
        'rows': rows,
        'count': len(rows),
        'total_monto': total,
        'total_fmt': '${:,.0f}'.format(total),
    })


@login_required
def api_dashboard_prospectos_convertidos_detalle(request):
    """Lista de clientes (con sus oportunidades) convertidos desde prospectos en el periodo.

    Un cliente "convertido" aquí = cliente con prospectos en el periodo y al menos
    un Prospecto.etapa = 'cerrado_ganado'. Para cada uno, listar sus oportunidades
    que provienen de prospecto.
    """
    qs_p = _dashboard_prosp_qs(request).filter(etapa='cerrado_ganado')
    # Agrupar por cliente
    by_cli = {}
    for p in qs_p:
        if not p.cliente_id:
            continue
        if p.cliente_id not in by_cli:
            by_cli[p.cliente_id] = {
                'cliente_id': p.cliente_id,
                'cliente': p.cliente.nombre_empresa if p.cliente else '',
                'num_ganados': 0,
                'oportunidades': [],
            }
        by_cli[p.cliente_id]['num_ganados'] += 1

    # Adjuntar oportunidades del cliente que vienen de prospección
    if by_cli:
        opps = _dashboard_prosp_opps_qs(request).filter(cliente_id__in=list(by_cli.keys())).order_by('-fecha_creacion')
        for o in opps:
            if o.cliente_id in by_cli:
                by_cli[o.cliente_id]['oportunidades'].append(_opp_to_dict(o))

    rows = sorted(by_cli.values(), key=lambda r: r['cliente'])
    return JsonResponse({'rows': rows, 'count': len(rows)})


# ═══════════════════════════════════════════════════════════════════════════
# WIDGET "PENDIENTES" — oportunidades por urgencia (Pendientes / Hoy / Próximamente)
# ═══════════════════════════════════════════════════════════════════════════

# Etapas terminales (cerradas) de etapa_corta — mismas que usa el reporte de
# oportunidades abiertas. Una oportunidad es "abierta" si su etapa NO está aquí.
_PEND_ETAPAS_TERMINALES = {
    'ganada', 'ganado', 'pagada', 'pagado',
    'perdida', 'perdido', 'cerrada', 'cerrado',
}


def _pend_briefing_ia(nombre, items):
    """Redacta con el asistente embebido (LLM) una frase motivadora + una acción
    por oportunidad, ANCLADA a los datos dados (no inventa). Devuelve
    {'frase': str, 'acciones': {str(opp_id): str}} o None si no se pudo.
    """
    if not items:
        return None
    try:
        from .asistente_provider import chat
        from .models import AsistenteConfig
    except Exception:
        return None
    try:
        cfg = AsistenteConfig.get_singleton()
        if cfg and not cfg.activo:
            return None
        modelo = cfg.modelo if cfg else None
    except Exception:
        modelo = None

    import json as _json
    top = items[:20]
    facts = [{
        'id': it['opp_id'], 'cliente': it['cliente'], 'proyecto': it['proyecto'],
        'valor': it['valor_fmt'], 'probabilidad': it['probabilidad'], 'riesgo': it['riesgo'],
        'etapa': it.get('etapa') or '', 'estado': it.get('tier') or '',
        'contacto': it.get('contacto') or '', 'hora': it.get('hora') or '',
        'accion_base': it['accion'],
    } for it in top]

    sys = (
        "Eres el asistente de ventas del CRM: cálido, cercano y también ESTRATÉGICO. Le hablas "
        f"de tú a {nombre} (vendedor). Con base EXCLUSIVAMENTE en los datos que te doy, para "
        "CADA oportunidad (clave = su id) escribe DOS textos en español:\n"
        "- 'mensaje': 1-2 frases cálidas y persuasivas que la vendan y den contexto (menciona "
        "de forma natural el valor y la probabilidad, y por qué vale la pena hoy).\n"
        "- 'accion': el siguiente paso MÁS ÚTIL para avanzar o cerrar HOY, en 1-2 frases, "
        "natural y directo. Considera la ETAPA ('etapa') y el ESTADO ('estado': overdue=está "
        "atrasada, today=vence hoy, sinagendar=no tiene actividad). Si hay tarea agendada úsala "
        "('accion_base', 'contacto', 'hora'). Si NO, propón el paso lógico según la etapa "
        "(ej.: Levantamiento → agenda el levantamiento; Cotización/Enviada → da seguimiento a la "
        "propuesta y resuelve dudas; Negociación/Seguimiento → empuja el cierre y la orden de "
        "compra). Sé concreto y accionable, no genérico.\n"
        "NO inventes nombres, montos, fechas ni datos que no aparezcan. Devuelve SOLO JSON "
        "válido: {\"items\": {\"<id>\": {\"mensaje\": \"...\", \"accion\": \"...\"}}}"
    )
    usr = "Vendedor: " + nombre + "\nOportunidades (JSON):\n" + _json.dumps(facts, ensure_ascii=False)

    try:
        res = chat(
            [{'role': 'system', 'content': sys}, {'role': 'user', 'content': usr}],
            model=modelo, temperature=0.6, max_tokens=2400,
        )
        txt = ((res or {}).get('text') or '').strip()
        a, b = txt.find('{'), txt.rfind('}')
        if a == -1 or b == -1:
            return None
        parsed = _json.loads(txt[a:b + 1])
        if not isinstance(parsed, dict):
            return None
        out = parsed.get('items') or {}
        return {'items': {str(k): v for k, v in out.items() if isinstance(v, dict)}}
    except Exception as exc:
        logger.warning(f"[Pendientes] Briefing IA no disponible: {exc}")
        return None


def _pend_briefing_cacheado(user, today, sel, nombre, items):
    """Briefing IA cacheado 1 vez al día por (usuario, fecha, selección). Lo genera
    y guarda si no existe. Devuelve el dict {frase, acciones} o None."""
    from .models import AsistenteResumenDiario
    key_sel = (sel or 'mias')
    try:
        row = AsistenteResumenDiario.objects.filter(usuario=user, fecha=today, seleccion=key_sel).first()
        if row and row.data:
            return row.data
    except Exception:
        pass
    data = _pend_briefing_ia(nombre, items)
    if data:
        try:
            AsistenteResumenDiario.objects.update_or_create(
                usuario=user, fecha=today, seleccion=key_sel, defaults={'data': data})
        except Exception:
            pass
    return data


def _pend_trabajadas_hoy(oportunidad_ids, today, user=None):
    """Conjunto de opp_ids que se 'trabajaron' HOY: una tarea/actividad de la
    oportunidad marcada COMPLETADA hoy, una tarea/actividad CREADA/agendada hoy, o
    marcada MANUALMENTE como trabajada hoy por el usuario.
    """
    from .models import (TareaOportunidad, TareaOportunidadHistorial,
                         Actividad, OportunidadActividad, PendienteCompletada)
    if not oportunidad_ids:
        return set()
    worked = set()
    # (C) Marcada manualmente como trabajada hoy por este usuario
    if user is not None:
        worked |= set(PendienteCompletada.objects.filter(
            usuario=user, fecha=today, oportunidad_id__in=oportunidad_ids
        ).values_list('oportunidad_id', flat=True))
    # (A) Tareas de oportunidad marcadas como completadas hoy (log de eventos)
    worked |= set(TareaOportunidadHistorial.objects.filter(
        tipo='cerrada', tarea__oportunidad_id__in=oportunidad_ids, fecha__date=today
    ).values_list('tarea__oportunidad_id', flat=True))
    # (A) Actividades de calendario completadas hoy (proxy: fecha_inicio hoy)
    worked |= set(Actividad.objects.filter(
        oportunidad_id__in=oportunidad_ids, completada=True, fecha_inicio__date=today
    ).values_list('oportunidad_id', flat=True))
    # (B) Tareas de oportunidad creadas/agendadas hoy
    worked |= set(TareaOportunidad.objects.filter(
        oportunidad_id__in=oportunidad_ids, fecha_creacion__date=today
    ).values_list('oportunidad_id', flat=True))
    # (B) Actividad real registrada hoy en el timeline (agendó/hizo algo)
    worked |= set(OportunidadActividad.objects.filter(
        oportunidad_id__in=oportunidad_ids,
        tipo__in=['tarea', 'seguimiento', 'llamada', 'reunion', 'email', 'propuesta'],
        fecha_creacion__date=today,
    ).values_list('oportunidad_id', flat=True))
    worked.discard(None)
    return worked


def _pend_resumen_stats(user, today):
    """(total, completadas) del RESUMEN del día del usuario (sus oportunidades):
    cuántas oportunidades entraban al resumen (vencidas / de hoy / sin agendar) y
    cuántas se trabajaron hoy. Sirve para el bono de eficiencia por seguir el resumen.
    """
    from django.utils import timezone
    from .models import TodoItem, TareaOportunidad, Tarea
    now = timezone.now()
    term_q = Q()
    for v in _PEND_ETAPAS_TERMINALES:
        term_q |= Q(etapa_corta__iexact=v)
    ids = list(TodoItem.objects.filter(usuario=user).exclude(term_q).values_list('id', flat=True))
    if not ids:
        return (0, 0)
    _ACT = ('pendiente', 'iniciada', 'en_progreso')

    def mm(model, estados, comp):
        f = {'oportunidad_id__in': ids, 'estado__in': estados, 'fecha_limite__isnull': False}
        f['fecha_limite__lte' if comp == 'lte' else 'fecha_limite__gt'] = now
        return dict(model.objects.filter(**f).values_list('oportunidad_id')
                    .annotate(m=Min('fecha_limite')).values_list('oportunidad_id', 'm'))

    venc_o = mm(TareaOportunidad, ['pendiente', 'en_progreso'], 'lte')
    venc_t = mm(Tarea, _ACT, 'lte')
    prox_o = mm(TareaOportunidad, ['pendiente', 'en_progreso'], 'gt')
    prox_t = mm(Tarea, _ACT, 'gt')

    def m2(a, b, o):
        va, vb = a.get(o), b.get(o)
        return (min(va, vb) if (va and vb) else (va or vb))

    candidatos = []
    for oid in ids:
        venc = m2(venc_o, venc_t, oid)
        prox = m2(prox_o, prox_t, oid)
        if venc:                       # vencida
            candidatos.append(oid)
        elif prox is None:             # sin nada agendado
            candidatos.append(oid)
        else:
            if timezone.localtime(prox).date() == today:   # para hoy
                candidatos.append(oid)
            # a futuro → no entra al resumen
    if not candidatos:
        return (0, 0)
    worked = _pend_trabajadas_hoy(candidatos, today, user)
    return (len(candidatos), len(worked & set(candidatos)))


def _pend_recap_msg(nombre, completadas, total):
    """Mensaje del asistente para el cierre del día (18:00) según el rendimiento."""
    if total <= 0:
        return f'{nombre}, hoy no tenías oportunidades urgentes. ¡A descansar! 🎉'
    if completadas <= 0:
        return f'{nombre}, hoy no marcaste avances. Mañana es una nueva oportunidad — arranca temprano. 💪'
    if completadas >= total:
        return f'¡Día redondo, {nombre}! Trabajaste tus {total} oportunidades del día. 🔥'
    if (completadas / total) >= 0.6:
        return f'Buen día, {nombre}: avanzaste {completadas} de {total}. Vas con buen ritmo. 👏'
    return f'{nombre}, trabajaste {completadas} de {total} hoy. Un empujón mañana y las sacas. 💪'


def _pend_recap_msg_tarea(nombre, completadas, total):
    """Mensaje de cierre del día para roles sin oportunidades (por tareas)."""
    if total <= 0:
        return f'{nombre}, hoy no tenías tareas asignadas. ¡A descansar! 🎉'
    if completadas <= 0:
        return f'{nombre}, hoy no cerraste tareas. Mañana es una nueva oportunidad — arranca temprano. 💪'
    if completadas >= total:
        return f'¡Día redondo, {nombre}! Completaste tus {total} tarea{"s" if total != 1 else ""}. 🔥'
    if (completadas / total) >= 0.6:
        return f'Buen día, {nombre}: cerraste {completadas} de {total} tareas. Vas con buen ritmo. 👏'
    return f'{nombre}, completaste {completadas} de {total} tareas hoy. Un empujón mañana. 💪'


def _pend_tareas_actividades(user, today):
    """Items de trabajo (Tareas asignadas + Actividades propias) para 'Mi día' y el
    cierre del día de roles SIN oportunidades. Devuelve (pendientes, completadas_hoy),
    con una forma común, ordenados por urgencia (atrasado → hoy → después).
    """
    from datetime import timedelta
    from django.db.models import Q
    from .models import Tarea, Actividad

    prio_lbl = {'urgente': 'Urgente', 'alta': 'Alta', 'media': 'Media', 'baja': 'Baja'}
    prio_riesgo = {'urgente': 'alto', 'alta': 'alto', 'media': 'medio', 'baja': 'bajo'}
    piso = today - timedelta(days=30)   # no arrastrar actividades muy viejas sin cerrar

    def _urg(fd):
        if fd is None:
            return 2, 'Sin fecha'
        if fd < today:
            return 0, 'Atrasada'
        if fd == today:
            return 1, 'Vence hoy'
        return 2, 'Programada'

    def _msg(kind, titulo, ctx, urg):
        c = f' para {ctx}' if ctx else ''
        if urg == 0:
            return (f'«{titulo}»{c} quedó atrasada. Retómala hoy para no acumular. 💪',
                    'Está atrasada — ciérrala hoy.')
        if urg == 1:
            verbo = 'toca' if kind == 'tarea' else 'tienes agendada'
            return (f'Hoy {verbo} «{titulo}»{c}. Buen momento para sacarla.',
                    'Es para hoy — dale prioridad.')
        base = 'Tienes pendiente' if kind == 'tarea' else 'Tienes agendada'
        return (f'{base} «{titulo}»{c}.', 'Avánzala hoy si te queda tiempo.')

    def _tctx(t):
        if t.oportunidad_id and t.oportunidad:
            return getattr(t.oportunidad, 'oportunidad', '') or ''
        if t.proyecto_id and t.proyecto:
            return getattr(t.proyecto, 'nombre', '') or getattr(t.proyecto, 'titulo', '') or ''
        if t.cliente_id and t.cliente:
            return getattr(t.cliente, 'nombre_empresa', '') or ''
        return ''

    def _adisplay(a):
        try:
            return a.get_tipo_actividad_display() or 'Actividad'
        except Exception:
            return 'Actividad'

    def _actx(a):
        if a.oportunidad_id and a.oportunidad:
            return getattr(a.oportunidad, 'oportunidad', '') or ''
        return ''

    pend, done = [], []

    # ── TAREAS asignadas ──
    tbase = (Tarea.objects.filter(asignado_a=user).exclude(estado='cancelada')
             .select_related('proyecto', 'cliente', 'oportunidad'))
    for t in tbase.exclude(estado='completada').order_by('fecha_limite', '-fecha_creacion')[:60]:
        fd = timezone.localtime(t.fecha_limite).date() if t.fecha_limite else None
        urg, estado_lbl = _urg(fd)
        pr = t.prioridad or 'media'
        mensaje, accion = _msg('tarea', t.titulo or 'Tarea', _tctx(t), urg)
        pend.append({
            'tipo': 'tarea', 'ref_id': t.id, 'url': '/app/?tarea=%d' % t.id, 'opp_id': None,
            'proyecto': t.titulo or '(sin título)', 'cliente': _tctx(t), 'valor_fmt': '',
            'prioridad_lbl': prio_lbl.get(pr, 'Media'), 'riesgo': prio_riesgo.get(pr, 'medio'),
            'vence': (timezone.localtime(t.fecha_limite).strftime('%d/%m %H:%M') if t.fecha_limite else ''),
            'estado_lbl': estado_lbl, 'mensaje': mensaje, 'accion': accion, '_ord': urg,
        })
    for t in tbase.filter(estado='completada', fecha_completada__date=today).order_by('-fecha_completada')[:60]:
        done.append({
            'tipo': 'tarea', 'ref_id': t.id, 'url': '/app/?tarea=%d' % t.id, 'opp_id': None,
            'proyecto': t.titulo or '(sin título)', 'cliente': _tctx(t), 'valor_fmt': '',
            'prioridad_lbl': '', 'riesgo': 'bajo', 'vence': '', 'estado_lbl': 'Completada',
            'mensaje': '', 'accion': '',
        })

    # ── ACTIVIDADES propias o donde participo ──
    abase = (Actividad.objects.filter(Q(creado_por=user) | Q(participantes=user))
             .distinct().select_related('oportunidad'))
    for a in abase.filter(completada=False, fecha_inicio__date__lte=today,
                          fecha_inicio__date__gte=piso).order_by('fecha_inicio')[:40]:
        fd = timezone.localtime(a.fecha_inicio).date()
        urg, estado_lbl = _urg(fd)
        mensaje, accion = _msg('actividad', a.titulo or 'Actividad', _actx(a), urg)
        pend.append({
            'tipo': 'actividad', 'ref_id': a.id, 'url': '/app/?tab=calendario', 'opp_id': None,
            'proyecto': a.titulo or '(sin título)', 'cliente': _actx(a), 'valor_fmt': '',
            'prioridad_lbl': _adisplay(a), 'riesgo': 'medio',
            'vence': timezone.localtime(a.fecha_inicio).strftime('%d/%m %H:%M'),
            'estado_lbl': estado_lbl, 'mensaje': mensaje, 'accion': accion, '_ord': urg,
        })
    for a in abase.filter(completada=True, fecha_inicio__date=today).order_by('-fecha_inicio')[:40]:
        done.append({
            'tipo': 'actividad', 'ref_id': a.id, 'url': '/app/?tab=calendario', 'opp_id': None,
            'proyecto': a.titulo or '(sin título)', 'cliente': _actx(a), 'valor_fmt': '',
            'prioridad_lbl': '', 'riesgo': 'bajo', 'vence': '', 'estado_lbl': 'Completada',
            'mensaje': '', 'accion': '',
        })

    pend.sort(key=lambda x: x.get('_ord', 2))
    for it in pend:
        it.pop('_ord', None)
    return pend, done


def _pend_buckets_tareas(user, today):
    """Buckets Pendientes/Hoy/Próximamente para roles SIN oportunidades, a partir de
    TAREAS asignadas + ACTIVIDADES propias PENDIENTES. Misma clasificación por
    urgencia que las oportunidades (atrasada/sin fecha → pendientes; hoy → hoy;
    futuro → próximamente). Los items traen 'url' para abrir la tarea/calendario.
    """
    from datetime import timedelta
    from django.db.models import Q
    from .models import Tarea, Actividad

    buckets = {'pendientes': [], 'hoy': [], 'proximamente': []}
    piso = today - timedelta(days=30)

    def _tctx(t):
        if t.oportunidad_id and t.oportunidad:
            return getattr(t.oportunidad, 'oportunidad', '') or ''
        if t.proyecto_id and t.proyecto:
            return getattr(t.proyecto, 'nombre', '') or getattr(t.proyecto, 'titulo', '') or ''
        if t.cliente_id and t.cliente:
            return getattr(t.cliente, 'nombre_empresa', '') or ''
        return ''

    def _actx(a):
        if a.oportunidad_id and a.oportunidad:
            return getattr(a.oportunidad, 'oportunidad', '') or ''
        return ''

    def _adisplay(a):
        try:
            return a.get_tipo_actividad_display() or 'Actividad'
        except Exception:
            return 'Actividad'

    def _place(item, dt):
        fd = dt.date() if dt else None
        if fd is None:
            item['motivo'] = 'Sin fecha'
            item['fecha'] = None
            buckets['pendientes'].append(item)
        elif fd < today:
            dias = (today - fd).days
            item['motivo'] = ('Vencida hoy' if dias <= 0
                              else 'Atrasada hace %d día%s' % (dias, 's' if dias != 1 else ''))
            item['fecha'] = dt.isoformat()
            buckets['pendientes'].append(item)
        elif fd == today:
            item['motivo'] = 'Para hoy ' + dt.strftime('%H:%M')
            item['fecha'] = dt.isoformat()
            buckets['hoy'].append(item)
        else:
            item['motivo'] = 'Programada ' + dt.strftime('%d/%m/%Y')
            item['fecha'] = dt.isoformat()
            buckets['proximamente'].append(item)

    # ── TAREAS asignadas y no cerradas ──
    tbase = (Tarea.objects.filter(asignado_a=user).exclude(estado__in=['cancelada', 'completada'])
             .select_related('proyecto', 'cliente', 'oportunidad'))
    for t in tbase[:120]:
        dt = timezone.localtime(t.fecha_limite) if t.fecha_limite else None
        _place({
            'id': t.id, 'tipo': 'tarea', 'url': '/app/?tarea=%d' % t.id,
            'nombre': t.titulo or '(sin título)', 'cliente': _tctx(t),
            'pipeline': '', 'etapa': 'Tarea', 'vendedor': '',
        }, dt)

    # ── ACTIVIDADES propias o donde participo, no completadas (últimos 30 días en adelante) ──
    abase = (Actividad.objects.filter(Q(creado_por=user) | Q(participantes=user))
             .distinct().filter(completada=False, fecha_inicio__date__gte=piso)
             .select_related('oportunidad'))
    for a in abase[:120]:
        dt = timezone.localtime(a.fecha_inicio)
        _place({
            'id': a.id, 'tipo': 'actividad', 'url': '/app/?tab=calendario',
            'nombre': a.titulo or '(sin título)', 'cliente': _actx(a),
            'pipeline': '', 'etapa': _adisplay(a), 'vendedor': '',
        }, dt)

    buckets['pendientes'].sort(key=lambda x: (x['fecha'] is None, x['fecha'] or ''))
    buckets['hoy'].sort(key=lambda x: x['fecha'] or '')
    buckets['proximamente'].sort(key=lambda x: x['fecha'] or '')
    return buckets


@login_required
def api_pendientes(request):
    """
    GET /app/api/pendientes/?vendedor=<id|todos|mias>

    Clasifica las oportunidades ABIERTAS del usuario (o del vendedor elegido,
    según permisos) en 3 grupos por urgencia. Cada oportunidad cae en UN solo
    grupo (la urgencia manda: vencida > hoy > próxima):
      - pendientes:   tiene tarea/actividad VENCIDA, o NO tiene nada agendado.
      - hoy:          su próxima tarea/actividad agendada cae hoy.
      - proximamente: su próxima tarea/actividad es a futuro.

    Misma lógica de "vencida/próxima" que la tabla CRM: TareaOportunidad + Tarea
    (la "Actividad Programada"); NO se usan las actividades de calendario porque
    muchas nunca se cierran y generan falsos positivos.

    Visibilidad idéntica al resto del CRM (get_usuarios_visibles_ids): un vendedor
    normal solo ve las suyas; supervisor/miembro de grupo puede elegir vendedor
    (limitado a su grupo). El default siempre es "las mías".
    """
    from datetime import timedelta
    from django.contrib.auth.models import User
    from django.utils import timezone
    from .models import TodoItem, TareaOportunidad, Tarea

    user = request.user
    now = timezone.now()
    today = timezone.localdate()

    visibles = get_usuarios_visibles_ids(user)  # None = supervisor global (ve todo)

    # ── Resolver selector de vendedor (con permisos) ──
    sel = (request.GET.get('vendedor', '') or '').strip().lower()
    if sel.isdigit():
        pedido = int(sel)
        # Solo si tiene permiso de ver a ese vendedor; si no, cae a las suyas.
        user_ids = [pedido] if (visibles is None or pedido in visibles) else [user.id]
    elif sel == 'todos':
        user_ids = None if visibles is None else list(visibles)
    else:  # '' o 'mias' → default: las mías
        user_ids = [user.id]

    # ── Oportunidades ABIERTAS (excluir etapas terminales, case-insensitive) ──
    term_q = Q()
    for v in _PEND_ETAPAS_TERMINALES:
        term_q |= Q(etapa_corta__iexact=v)
    qs = TodoItem.objects.select_related('cliente', 'usuario', 'contacto').exclude(term_q)
    if user_ids is not None:
        qs = qs.filter(usuario_id__in=user_ids)

    _ids = list(qs.values_list('id', flat=True))
    _ACTIVOS = ('pendiente', 'iniciada', 'en_progreso')

    def _min_map(model, estados, comp):
        f = {'oportunidad_id__in': _ids, 'estado__in': estados,
             'fecha_limite__isnull': False}
        f['fecha_limite__lte' if comp == 'lte' else 'fecha_limite__gt'] = now
        return dict(
            model.objects.filter(**f).values_list('oportunidad_id')
            .annotate(m=Min('fecha_limite')).values_list('oportunidad_id', 'm')
        )

    venc_opp = _min_map(TareaOportunidad, ['pendiente', 'en_progreso'], 'lte')
    venc_tar = _min_map(Tarea, _ACTIVOS, 'lte')
    prox_opp = _min_map(TareaOportunidad, ['pendiente', 'en_progreso'], 'gt')
    prox_tar = _min_map(Tarea, _ACTIVOS, 'gt')

    def _min2(a, b, oid):
        va, vb = a.get(oid), b.get(oid)
        if va and vb:
            return min(va, vb)
        return va or vb

    buckets = {'pendientes': [], 'hoy': [], 'proximamente': []}
    resumen_pool = []  # (opp, tier) para la pestaña Resumen: pendientes + hoy

    for opp in qs:
        oid = opp.id
        venc = _min2(venc_opp, venc_tar, oid)
        prox = _min2(prox_opp, prox_tar, oid)
        item = {
            'id': oid,
            'nombre': opp.oportunidad or '(sin nombre)',
            'cliente': (opp.cliente.nombre_empresa if opp.cliente_id and opp.cliente else ''),
            'pipeline': opp.get_tipo_negociacion_display() if opp.tipo_negociacion else '',
            'etapa': opp.etapa_corta or '',
            'vendedor': (opp.usuario.get_full_name() or opp.usuario.username) if opp.usuario_id else '',
        }
        if venc:
            dias = (today - timezone.localtime(venc).date()).days
            item['motivo'] = ('Vencida hoy' if dias <= 0 else f'Vencida hace {dias} día' + ('s' if dias != 1 else ''))
            item['fecha'] = venc.isoformat()
            buckets['pendientes'].append(item)
            resumen_pool.append((opp, 'overdue'))
        elif prox is None:
            item['motivo'] = 'Sin nada agendado'
            item['fecha'] = None
            buckets['pendientes'].append(item)
            resumen_pool.append((opp, 'sinagendar'))
        else:
            pl = timezone.localtime(prox)
            if pl.date() == today:
                item['motivo'] = 'Agendada hoy ' + pl.strftime('%H:%M')
                item['fecha'] = prox.isoformat()
                buckets['hoy'].append(item)
                resumen_pool.append((opp, 'today'))
            else:
                item['motivo'] = 'Agendada ' + pl.strftime('%d/%m/%Y')
                item['fecha'] = prox.isoformat()
                buckets['proximamente'].append(item)

    # Orden: pendientes → más vencida primero (fecha asc, sin-fecha al final);
    # hoy/próx → por fecha ascendente.
    buckets['pendientes'].sort(key=lambda x: (x['fecha'] is None, x['fecha'] or ''))
    buckets['hoy'].sort(key=lambda x: x['fecha'] or '')
    buckets['proximamente'].sort(key=lambda x: x['fecha'] or '')

    # ── Fallback por rol: si esta vista PROPIA no tiene ninguna oportunidad, las
    # pestañas Pendientes/Hoy/Próximamente muestran sus TAREAS + ACTIVIDADES. ──
    _vista_propia = (not sel) or sel in ('mias', str(user.id))
    buckets_tipo = 'oportunidad'
    if _vista_propia and not (buckets['pendientes'] or buckets['hoy'] or buckets['proximamente']):
        buckets = _pend_buckets_tareas(user, today)
        buckets_tipo = 'tarea'

    # ── Resumen del día: briefing priorizado (pendientes + hoy) ──
    # Prioridad = urgencia + valor + probabilidad. Acción = de la tarea real.
    _res_ids = [o.id for (o, _t) in resumen_pool]
    _near = {}
    for _t in TareaOportunidad.objects.filter(
            oportunidad_id__in=_res_ids, estado__in=['pendiente', 'en_progreso']
    ).exclude(fecha_limite=None).order_by('fecha_limite'):
        _near.setdefault(_t.oportunidad_id, _t)
    for _t in Tarea.objects.filter(
            oportunidad_id__in=_res_ids, estado__in=_ACTIVOS
    ).exclude(fecha_limite=None).order_by('fecha_limite'):
        _cur = _near.get(_t.oportunidad_id)
        if _cur is None or (_t.fecha_limite and _cur.fecha_limite and _t.fecha_limite < _cur.fecha_limite):
            _near[_t.oportunidad_id] = _t

    _TIER_PTS = {'overdue': 100, 'today': 70, 'sinagendar': 50}
    _scored = []
    for opp, tier in resumen_pool:
        monto = float(opp.monto or 0)
        prob = int(opp.probabilidad_cierre or 0)
        score = _TIER_PTS.get(tier, 40) + min(monto / 5000.0, 120) + prob * 0.5
        _scored.append((score, opp, tier))
    _scored.sort(key=lambda x: x[0], reverse=True)

    resumen_items = []
    for idx, (score, opp, tier) in enumerate(_scored):
        prob = int(opp.probabilidad_cierre or 0)
        overdue = (tier == 'overdue')
        if prob < 40 or (overdue and prob < 60):
            riesgo = 'Alto'
        elif prob < 70 or overdue:
            riesgo = 'Medio'
        else:
            riesgo = 'Bajo'
        contacto = str(opp.contacto).strip() if opp.contacto_id and opp.contacto else ''
        cliente_nom = (opp.cliente.nombre_empresa if opp.cliente_id and opp.cliente else '') or (opp.oportunidad or 'Esta oportunidad')
        tsk = _near.get(opp.id)
        hora = ''
        if tsk and tsk.fecha_limite:
            hora = timezone.localtime(tsk.fecha_limite).strftime('%H:%M')
            titulo = (getattr(tsk, 'titulo', '') or '').strip() or 'Dar seguimiento'
            accion = titulo
            if contacto:
                accion += f' con {contacto}'
            accion += f' antes de las {hora}.'
        elif tier == 'sinagendar':
            accion = (f'Contacta a {contacto} y agenda el siguiente paso.'
                      if contacto else 'Aún no tiene actividad agendada — agenda el siguiente paso.')
        else:
            accion = 'Dale seguimiento hoy.'
        monto = float(opp.monto or 0)
        val_fmt = '${:,.0f}'.format(monto)
        # Mensaje-narrativa de respaldo (la IA lo reescribe si está disponible).
        if prob >= 80:
            mensaje = f"{cliente_nom} está muy cerca de firmar ({prob}%). Un empujón hoy y cierras {val_fmt}."
        elif prob >= 50:
            mensaje = f"{cliente_nom} avanza bien ({prob}%). Vale la pena moverla hoy: {val_fmt} en la mesa."
        else:
            mensaje = f"{cliente_nom} necesita atención hoy — {val_fmt} en juego."
        resumen_items.append({
            'prioridad': idx + 1,
            'opp_id': opp.id,
            'cliente': (opp.cliente.nombre_empresa if opp.cliente_id and opp.cliente else '—'),
            'proyecto': opp.oportunidad or '(sin nombre)',
            'valor': monto,
            'valor_fmt': val_fmt,
            'probabilidad': prob,
            'riesgo': riesgo,
            'etapa': opp.etapa_corta or '',
            'tier': tier,
            'contacto': contacto,
            'hora': hora,
            'mensaje': mensaje,
            'accion': accion,
        })

    _hora = timezone.localtime(now).hour
    saludo = 'Buenos días' if _hora < 12 else ('Buenas tardes' if _hora < 19 else 'Buenas noches')
    nombre_corto = user.first_name or (user.get_full_name() or user.username).split(' ')[0]
    resumen = {
        'saludo': saludo,
        'nombre': nombre_corto,
        'total': len(resumen_items),
        'items': resumen_items,
    }
    if resumen_items:
        # ── Rol con OPORTUNIDADES (vendedores) ──
        resumen['tipo'] = 'oportunidad'
        # Enriquecer con el asistente (redacción cálida), cacheado 1 vez al día.
        # Los datos duros ya están calculados; la IA solo redacta mensaje + acción.
        try:
            _ia = _pend_briefing_cacheado(user, today, sel, nombre_corto, resumen_items)
        except Exception:
            _ia = None
        if _ia:
            _items = _ia.get('items') or {}
            for _it in resumen_items:
                _e = _items.get(str(_it['opp_id']))
                if isinstance(_e, dict):
                    if _e.get('mensaje'):
                        _it['mensaje'] = _e['mensaje']
                    if _e.get('accion'):
                        _it['accion'] = _e['accion']
        # ── Marcar las trabajadas HOY → van al final como completadas ──
        worked = _pend_trabajadas_hoy(_res_ids, today, user)
        pend = [it for it in resumen_items if it['opp_id'] not in worked]
        done = [it for it in resumen_items if it['opp_id'] in worked]
        for i, it in enumerate(pend):
            it['prioridad'] = i + 1
            it['completada'] = False
        for it in done:
            it['completada'] = True
        resumen_items = pend + done
        resumen['items'] = resumen_items
        resumen['pendientes'] = len(pend)     # lo que falta por trabajar (baja el contador)
        resumen['completadas'] = len(done)
        resumen['total'] = len(resumen_items)
    else:
        # ── Rol SIN oportunidades (ingenieros/administrativos): TAREAS + ACTIVIDADES ──
        resumen['tipo'] = 'tarea'
        pend_ta, done_ta = _pend_tareas_actividades(user, today)
        for i, it in enumerate(pend_ta):
            it['prioridad'] = i + 1
            it['completada'] = False
        for it in done_ta:
            it['completada'] = True
        resumen['items'] = pend_ta + done_ta
        resumen['pendientes'] = len(pend_ta)
        resumen['completadas'] = len(done_ta)
        resumen['total'] = len(pend_ta) + len(done_ta)

    # ── Modo cierre del día (recap) a partir de las 18:00 ──
    if _hora >= 18:
        resumen['modo'] = 'recap'
        resumen['recap_tipo'] = resumen['tipo']
        if resumen['tipo'] == 'tarea':
            resumen['recap_msg'] = _pend_recap_msg_tarea(
                nombre_corto, resumen['completadas'], resumen['total'])
        else:
            resumen['recap_msg'] = _pend_recap_msg(
                nombre_corto, resumen['completadas'], resumen['total'])
    else:
        resumen['modo'] = 'dia'

    # ── Lista de vendedores para el selector (según rol) ──
    # Solo se incluyen vendedores que TIENEN al menos una oportunidad abierta
    # (no tiene sentido poder filtrar por alguien sin oportunidades).
    puede_seleccionar = (visibles is None) or bool(visibles and len(visibles) > 1)
    vendedores = []
    if puede_seleccionar:
        if visibles is None:
            vqs = User.objects.filter(is_active=True).exclude(groups__name='Supervisores')
        else:
            vqs = User.objects.filter(is_active=True, id__in=visibles)
        con_opp = set(
            TodoItem.objects.exclude(term_q)
            .filter(usuario_id__in=vqs.values_list('id', flat=True))
            .values_list('usuario_id', flat=True)
        )
        vendedores = [
            {'id': u.id, 'nombre': u.get_full_name() or u.username}
            for u in vqs.order_by('first_name', 'last_name') if u.id in con_opp
        ]

    return JsonResponse({
        'success': True,
        'resumen': resumen,
        'buckets': buckets,
        'buckets_tipo': buckets_tipo,
        'counts': {k: len(v) for k, v in buckets.items()},
        'puede_seleccionar': puede_seleccionar,
        'vendedores': vendedores,
        'seleccion': sel or 'mias',
        'yo': {'id': user.id, 'nombre': user.get_full_name() or user.username},
    })


# ─────────────────────────────────────────────────────────────────────────────
# ASISTENTE · CLIENTES — clientes "en pausa" (sin oportunidad nueva hace tiempo)
# ─────────────────────────────────────────────────────────────────────────────
_CLI_TERM = {'ganada', 'ganado', 'pagada', 'pagado', 'perdida', 'perdido', 'cerrada', 'cerrado'}


def _cli_abierta(etapa, estado):
    e = (etapa or '').strip().lower()
    if e in _CLI_TERM:
        return False
    if (estado or '').strip().lower() == 'pagada':
        return False
    return True


def _cli_msg(tier, nombre_emp, contacto, dias, dias_contacto, n_opp, n_abiertas):
    quien = contacto or 'el cliente'
    if tier == 3:
        return (f'{nombre_emp} está por cumplir un mes sin una oportunidad nueva ({dias} días). Adelántate antes de que se enfríe.',
                f'Agenda un contacto con {quien} esta semana para no perder el ritmo.')
    if tier == 2:
        return (f'Le has dado seguimiento a {nombre_emp} hace poco (tarea o actividad), pero lleva {dias} días sin una oportunidad nueva. El contacto está — falta concretarlo.',
                f'Convierte ese contacto en una oportunidad concreta: propón una cotización a {quien}.')
    # tier 1 (crítico): sin oportunidad Y sin contacto reciente
    if n_opp == 0:
        return (f'{nombre_emp} es cliente tuyo pero aún no le has creado ninguna oportunidad ni le has dado seguimiento. Vale la pena explorar qué necesita.',
                f'Contacta a {quien} y detecta una oportunidad para crear.')
    return (f'{nombre_emp} lleva {dias} días sin una oportunidad nueva y sin contacto reciente. Se está enfriando — reactívalo hoy.',
            f'Llama a {quien} y propón una nueva cotización o proyecto.')


def _asistente_clientes_items(user, sel, today, umbral=30, prox_min=23, contacto_dias=30, limite=40):
    """Clientes 'en pausa' priorizados por niveles (cascada: se muestra el nivel más
    urgente que tenga pendientes):
      tier 1 (crítico): >= umbral días sin oportunidad nueva Y sin tarea/actividad reciente.
      tier 2 (baja): >= umbral días sin oportunidad pero CON contacto reciente (tarea/actividad)
                     — hubo contacto, falta concretar.
      tier 3 (próximo): entre prox_min y umbral días sin oportunidad nueva (por vencer).
    Crear una oportunidad hoy marca al cliente como trabajado (no lo saca). Devuelve
    dict {modo, tier, items, pendientes, completadas}; modo='todobien' si no hay nada.
    """
    from django.db.models import Max, Count, Q
    from .models import Cliente, TodoItem, Tarea, Actividad

    visibles = get_usuarios_visibles_ids(user)   # None = ve todo
    sel = (sel or '').strip().lower()
    if not sel or sel == 'mias':
        targets = [user.id]
    elif sel == 'todos':
        targets = None if visibles is None else list(visibles)
    elif sel.isdigit():
        tid = int(sel)
        targets = [tid] if (visibles is None or tid in visibles) else [user.id]
    else:
        targets = [user.id]

    qs = Cliente.objects.all()
    if targets is not None:
        qs = qs.filter(asignado_a_id__in=targets)
    qs = qs.select_related('asignado_a').annotate(
        _ultc_prev=Max('oportunidades__fecha_creacion', filter=Q(oportunidades__fecha_creacion__date__lt=today)),
        _nopp=Count('oportunidades', distinct=True),
        _hoy=Count('oportunidades', filter=Q(oportunidades__fecha_creacion__date=today), distinct=True),
    )

    cands = []   # (cliente, dias_sin_oportunidad, trabajado_hoy)
    for c in qs:
        ref = c._ultc_prev or c.fecha_creacion
        dias = (today - timezone.localtime(ref).date()).days if ref else 9999
        if dias < prox_min:
            continue
        cands.append((c, dias, c._hoy > 0))

    if not cands:
        return {'modo': 'todobien', 'tier': 0, 'items': [], 'pendientes': 0, 'completadas': 0}

    cids = [c.id for c, _, _ in cands]

    # Último contacto = tarea creada (Tarea.cliente) o actividad agendada (vía oportunidad).
    contacto_map = {}
    for r in Tarea.objects.filter(cliente_id__in=cids).values('cliente_id').annotate(m=Max('fecha_creacion')):
        if r['m']:
            contacto_map[r['cliente_id']] = r['m']
    for r in Actividad.objects.filter(oportunidad__cliente_id__in=cids).values('oportunidad__cliente_id').annotate(m=Max('fecha_inicio')):
        cid, mm = r['oportunidad__cliente_id'], r['m']
        if mm and (cid not in contacto_map or mm > contacto_map[cid]):
            contacto_map[cid] = mm

    # Oportunidades abiertas + última etapa por cliente.
    by_cli = {}
    rows = (TodoItem.objects.filter(cliente_id__in=cids)
            .values('cliente_id', 'etapa_corta', 'estado_crm')
            .order_by('cliente_id', '-fecha_actualizacion'))
    for r in rows:
        d = by_cli.setdefault(r['cliente_id'], {'abiertas': 0, 'ult_etapa': ''})
        if _cli_abierta(r['etapa_corta'], r['estado_crm']):
            d['abiertas'] += 1
        if not d['ult_etapa'] and r['etapa_corta']:
            d['ult_etapa'] = r['etapa_corta']

    def _build(c, dias, tier, completada, dias_contacto):
        info = by_cli.get(c.id, {'abiertas': 0, 'ult_etapa': ''})
        mensaje, accion = _cli_msg(tier, c.nombre_empresa, c.contacto_principal, dias, dias_contacto, c._nopp, info['abiertas'])
        return {
            'cliente_id': c.id, 'nombre': c.nombre_empresa or '(sin nombre)',
            'contacto': c.contacto_principal or '', 'telefono': c.telefono or '', 'email': c.email or '',
            'dias': dias, 'tier': tier, 'n_opp': c._nopp, 'n_abiertas': info['abiertas'],
            'ult_etapa': info['ult_etapa'],
            'vendedor': (c.asignado_a.get_full_name() or c.asignado_a.username) if c.asignado_a_id else '',
            'mensaje': mensaje, 'accion': accion, 'completada': completada,
            'dias_contacto': (9999 if dias_contacto >= 9999 else dias_contacto),
        }

    grupos = {1: [], 2: [], 3: []}
    for c, dias, worked in cands:
        ct = contacto_map.get(c.id)
        dias_contacto = (today - timezone.localtime(ct).date()).days if ct else 9999
        if dias >= umbral:
            tier = 2 if dias_contacto < contacto_dias else 1
        else:
            tier = 3
        grupos[tier].append(_build(c, dias, tier, worked, dias_contacto))

    def _pend(lst):
        return [x for x in lst if not x['completada']]

    active = 0
    for t in (1, 2, 3):
        if _pend(grupos[t]):
            active = t
            break

    if active == 0:
        completadas_all = [x for t in (1, 2, 3) for x in grupos[t] if x['completada']]
        if completadas_all:
            completadas_all.sort(key=lambda x: -x['dias'])
            completadas_all = completadas_all[:limite]
            return {'modo': 'lista', 'tier': completadas_all[0]['tier'], 'items': completadas_all,
                    'pendientes': 0, 'completadas': len(completadas_all)}
        return {'modo': 'todobien', 'tier': 0, 'items': [], 'pendientes': 0, 'completadas': 0}

    lst = grupos[active]
    pend = [x for x in lst if not x['completada']]
    done = [x for x in lst if x['completada']]
    pend.sort(key=lambda x: -x['dias'])
    done.sort(key=lambda x: -x['dias'])
    items = (pend + done)[:limite]
    return {'modo': 'lista', 'tier': active, 'items': items,
            'pendientes': sum(1 for x in items if not x['completada']),
            'completadas': sum(1 for x in items if x['completada'])}


def _clientes_ia(nombre, items):
    """Reescribe con la IA embebida (cálida y estratégica) mensaje + acción por cliente,
    ANCLADO a los datos. Devuelve {'items': {str(cliente_id): {mensaje, accion}}} o None.
    """
    if not items:
        return None
    try:
        from .asistente_provider import chat
        from .models import AsistenteConfig
    except Exception:
        return None
    try:
        cfg = AsistenteConfig.get_singleton()
        if cfg and not cfg.activo:
            return None
        modelo = cfg.modelo if cfg else None
    except Exception:
        modelo = None

    import json as _json
    facts = [{
        'id': it['cliente_id'], 'cliente': it['nombre'], 'contacto': it['contacto'],
        'dias_sin_oportunidad': it['dias'], 'oportunidades': it['n_opp'],
        'abiertas': it['n_abiertas'], 'ultima_etapa': it['ult_etapa'],
        'nivel': it.get('tier', 1), 'dias_sin_contacto': it.get('dias_contacto', 9999),
    } for it in items[:20]]

    sys = (
        "Eres el asistente comercial del CRM: cálido, cercano y estratégico. Le hablas de tú a "
        f"{nombre}. Con base EXCLUSIVAMENTE en los datos, para CADA cliente (clave = su id) escribe:\n"
        "Cada cliente trae 'nivel': 1 = sin oportunidad NI contacto reciente (crítico, reactivar ya); "
        "2 = sin oportunidad pero CON contacto reciente (tarea/actividad) — el contacto existe, falta "
        "concretarlo en una oportunidad; 3 = por cumplir un mes sin oportunidad (adelántate). Adapta el tono al nivel.\n"
        "- 'mensaje': 1-2 frases que expliquen por qué conviene actuar con ESTE cliente hoy, según su nivel "
        "(menciona de forma natural los días sin oportunidad y si hubo o no contacto reciente).\n"
        "- 'accion': el siguiente paso más útil y concreto (llamar, agendar visita, proponer "
        "cotización, detectar necesidad), en 1 frase, natural y directo.\n"
        "NO inventes datos que no aparezcan. Devuelve SOLO JSON válido: "
        "{\"items\": {\"<id>\": {\"mensaje\": \"...\", \"accion\": \"...\"}}}"
    )
    usr = "Vendedor: " + nombre + "\nClientes (JSON):\n" + _json.dumps(facts, ensure_ascii=False)
    try:
        res = chat([{'role': 'system', 'content': sys}, {'role': 'user', 'content': usr}],
                   model=modelo, temperature=0.6, max_tokens=1800)
        txt = ((res or {}).get('text') or '').strip()
        a, b = txt.find('{'), txt.rfind('}')
        if a == -1 or b == -1:
            return None
        parsed = _json.loads(txt[a:b + 1])
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


@login_required
def api_asistente_clientes(request):
    """GET /app/api/asistente/clientes/?vendedor=<id|todos|mias>
    Clientes 'en pausa' (sin oportunidad nueva hace tiempo) para el panel del asistente.
    """
    from django.utils import timezone
    user = request.user
    today = timezone.localdate()
    sel = (request.GET.get('vendedor', '') or '').strip().lower()

    data = _asistente_clientes_items(user, sel, today)
    items = data['items']

    # Enriquecer con IA (cacheado 1 vez al día por usuario + selección). Solo si hay lista.
    if items:
        try:
            from .models import AsistenteResumenDiario
            key = 'cli:' + (sel or 'mias')
            row = AsistenteResumenDiario.objects.filter(usuario=user, fecha=today, seleccion=key).first()
            ia = row.data if (row and row.data) else None
            if ia is None:
                nombre = user.first_name or (user.get_full_name() or user.username).split(' ')[0]
                ia = _clientes_ia(nombre, items)
                if ia:
                    AsistenteResumenDiario.objects.update_or_create(
                        usuario=user, fecha=today, seleccion=key, defaults={'data': ia})
            if ia:
                m = ia.get('items') or {}
                for it in items:
                    e = m.get(str(it['cliente_id']))
                    if isinstance(e, dict):
                        if e.get('mensaje'):
                            it['mensaje'] = e['mensaje']
                        if e.get('accion'):
                            it['accion'] = e['accion']
        except Exception:
            pass

    mensaje_ok = None
    if data['modo'] == 'todobien':
        mensaje_ok = ('¡Vas al día! No tienes clientes en pausa — mantienes tu cartera con buen '
                      'seguimiento. Sigue así. 👏')

    return JsonResponse({'success': True, 'modo': data['modo'], 'tier': data['tier'],
                         'items': items, 'total': len(items),
                         'pendientes': data['pendientes'], 'completadas': data['completadas'],
                         'mensaje_ok': mensaje_ok})


@login_required
def api_asistente_clientes_estado(request):
    """Ligero: dado ?ids=1,2,3 devuelve qué clientes se 'trabajaron' HOY (se les creó
    una oportunidad nueva hoy). Para el sondeo del panel, igual que en Mi día."""
    from django.utils import timezone
    from .models import TodoItem
    ids = [int(x) for x in (request.GET.get('ids', '') or '').split(',') if x.strip().isdigit()]
    today = timezone.localdate()
    worked = []
    if ids:
        worked = list(TodoItem.objects.filter(cliente_id__in=ids, fecha_creacion__date=today)
                      .values_list('cliente_id', flat=True).distinct())
    return JsonResponse({'success': True, 'worked_ids': worked})


# ─────────────────────────────────────────────────────────────────────────────
# ASISTENTE · CORREO — correos importantes de las últimas 24h SIN responder.
# Detección 100% por código (puntaje), sin IA en la lista → créditos ~0.
# ─────────────────────────────────────────────────────────────────────────────
def _cor_norm(s):
    import unicodedata
    s = (s or '').lower()
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


_COR_KW = ['requerimiento', 'levantamiento', 'cotizacion', 'cotizar', 'solicitud', 'propuesta', 'orden de compra',
           ' oc ', 'rfq', 'licitacion', 'presupuesto', 'factura', 'proyecto', 'reunion', 'visita',
           'disponibilidad', 'tiempo de entrega', 'precio', 'seguimiento', 'urgente', 'pendiente',
           'pedido', 'compra', 'instalacion', 'soporte', 'garantia', 'servicio']
_COR_ESPERA = ['quedo a la espera', 'en espera de su respuesta', 'en espera de tu respuesta', 'favor de',
               'me confirmas', 'quedo atento', 'quedamos atentos', 'esperamos su respuesta',
               'agradezco su pronta', 'me puedes', 'nos pueden', 'podrias', 'me apoyas']
# HITOS que cierran/avanzan una venta: si llega un correo LIGADO a una oportunidad con
# esto, no hay que esperar a responder — conviene ofrecer actualizar la opp de una vez.
_COR_HITO = ['factura', 'orden de compra', 'orden de compra firmada', 'oc firmada', 'orden firmada',
             'purchase order', 'po firmada', 'contrato firmado', 'pedido confirmado', 'pedido en firme',
             'anticipo', 'comprobante de pago', 'pago realizado', 'complemento de pago']


def _cor_es_hito(asunto, cuerpo=''):
    """True si el correo parece una factura / orden de compra firmada / pago (hito de cierre)."""
    t = _cor_norm((asunto or '') + ' ' + (cuerpo or ''))
    return any(k in t for k in _COR_HITO)


def _cor_extracto(texto, limite=150):
    """Extracto citable del cuerpo de un correo para el toast: quita líneas citadas
    (>, 'El ... escribió:'), firmas y despedidas, y devuelve el primer tramo con
    sustancia. '' si no hay nada útil."""
    import re as _re
    if not (texto or '').strip():
        return ''
    corte = ['saludos', 'atentamente', 'atte', 'gracias de antemano', 'enviado desde',
             'sent from', 'quedo atento', 'quedamos atentos', 'cordialmente']
    lineas = []
    for ln in (texto or '').splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith('>') or _re.match(r'^(el|on)\s.+(escribi[oó]|wrote)\s*:?\s*$', s, _re.IGNORECASE):
            break                      # empieza el hilo citado → lo de arriba es lo nuevo
        if _re.match(r'^[-_]{2,}\s*$', s):
            break                      # firma o separador de hilo citado (Outlook usa ____)
        if _re.match(r'^(from|de|sent|enviado(?:\sel)?|to|para|cc)\s*:', s, _re.IGNORECASE):
            break                      # encabezado del mensaje citado (From:/Sent:/To:)
        low = _cor_norm(s)
        if any(low.startswith(c) for c in corte):
            break
        lineas.append(s)
        if sum(len(x) for x in lineas) >= limite * 2:
            break
    out = ' '.join(lineas).strip()
    out = _re.sub(r'\s+', ' ', out)
    if len(out) > limite:
        out = out[:limite].rsplit(' ', 1)[0] + '…'
    return out


def _cor_extracto_parrafos(texto, limite=1400):
    """Como _cor_extracto pero CONSERVANDO los saltos de línea — para el nivel 2
    del toast, donde el cuerpo se muestra amplio y en bloque se lee horrible.
    Quita citas del hilo y firmas, respeta párrafos, corta sin partir palabras."""
    import re as _re
    if not (texto or '').strip():
        return ''
    corte = ['saludos', 'atentamente', 'atte', 'gracias de antemano', 'enviado desde',
             'sent from', 'quedo atento', 'quedamos atentos', 'cordialmente']
    lineas, total = [], 0
    for ln in (texto or '').splitlines():
        s = ln.rstrip()
        st = s.strip()
        if st.startswith('>') or _re.match(r'^(el|on)\s.+(escribi[oó]|wrote)\s*:?\s*$', st, _re.IGNORECASE):
            break                      # empieza el hilo citado → lo de arriba es lo nuevo
        if _re.match(r'^[-_]{2,}\s*$', st):
            break                      # firma o separador de hilo citado (Outlook usa ____)
        if _re.match(r'^(from|de|sent|enviado(?:\sel)?|to|para|cc)\s*:', st, _re.IGNORECASE):
            break                      # encabezado del mensaje citado (From:/Sent:/To:)
        low = _cor_norm(st)
        if any(low.startswith(c) for c in corte):
            break
        lineas.append(s)
        total += len(s)
        if total >= limite * 2:
            break
    out = '\n'.join(lineas)
    out = _re.sub(r'\n{3,}', '\n\n', out).strip()
    if len(out) > limite:
        out = out[:limite].rsplit(' ', 1)[0] + '…'
    return out
# Ventana para "importantes sin responder": no solo 24h — así el asistente sigue
# insistiendo con los que se te van pasando (hasta 7 días).
_COR_VENTANA_HORAS = 168

_COR_SPAM_SENDER = ['noreply', 'no-reply', 'no_reply', 'no.reply', 'notifica', 'notification', 'mailer',
                    'newsletter', 'marketing@', 'automat', 'mailchimp', 'sendgrid', 'bounce', 'postmaster',
                    'alert@', 'alerts@', '-alert', 'noreply-', 'donotreply', 'do-not-reply']
_COR_SPAM_BODY = ['unsubscribe', 'darse de baja', 'cancelar suscripcion', 'cancelar tu suscripcion',
                  'no deseas recibir', 'da clic para dejar de']
_COR_PROMO = ['oferta', 'descuento', 'promocion', 'gratis', 'sorteo', 'black friday', 'cyber', '2x1', 'envio gratis',
              'boletin', 'newsletter', 'webinar', 'novedades', 'catalogo', 'no te pierdas', 'aprovecha',
              'suscribete', 'proximo evento', 'ultimas horas']
_COR_AUTO = ['respuesta automatica', 'automatic reply', 'auto-reply', 'autoreply', 'out of office',
             'fuera de la oficina', 'fuera de oficina', 'notificacion de ausencia', 'ausencia de oficina',
             'delivery status', 'undeliverable', 'mailer-daemon', 'mailer daemon', 'correo no entregado',
             'devolucion de correo', 'read receipt', 'confirmacion de lectura', 'acuse de recibo']
_COR_PUBLIC_DOM = {'gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'yahoo.com',
                   'yahoo.com.mx', 'live.com', 'live.com.mx', 'icloud.com', 'me.com', 'aol.com'}


def _cor_conocidos():
    """Set de emails y dominios de clientes/contactos registrados (para 'remitente conocido')."""
    from .models import Cliente, Contacto
    emails, nombres = set(), []
    for em, nom in Cliente.objects.values_list('email', 'nombre_empresa'):
        if em:
            emails.add(_cor_norm(em).strip())
        if nom and len(nom.strip()) >= 5:
            nombres.append(_cor_norm(nom).strip())
    for em in Contacto.objects.exclude(email='').values_list('email', flat=True):
        if em:
            emails.add(_cor_norm(em).strip())
    doms = set(e.split('@')[-1] for e in emails if '@' in e) - _COR_PUBLIC_DOM
    return emails, doms, nombres


def _cor_score(rem_email, asunto, cuerpo, known_emails, known_domains, cliente_nombres):
    """Devuelve (score, motivos:set, kw:str). score<=0 => descartar."""
    rem = _cor_norm(rem_email).strip()
    for bad in _COR_SPAM_SENDER:
        if bad in rem:
            return 0, set(), ''
    asu = _cor_norm(asunto)
    for a in _COR_AUTO:               # auto-respuestas / fuera de oficina / rebotes → no son para responder
        if a in asu:
            return 0, set(), ''
    cue = _cor_norm(cuerpo)[:4000]
    for bad in _COR_SPAM_BODY:
        if bad in cue:
            return 0, set(), ''
    score = 0
    motivos = set()
    dom = rem.split('@')[-1] if '@' in rem else ''
    if rem and rem in known_emails:
        score += 3; motivos.add('cliente')
    elif dom and dom in known_domains:
        score += 2; motivos.add('cliente')
    for nom in cliente_nombres:
        if nom and nom in asu:
            score += 2; motivos.add('cliente'); break
        if nom and cue and nom in cue:
            score += 1; motivos.add('cliente'); break
    kw_hits, kw_score = [], 0
    for kw in _COR_KW:
        if kw in asu:
            kw_score += 2; kw_hits.append(kw.strip())
        elif cue and kw in cue:
            kw_score += 1; kw_hits.append(kw.strip())
    if kw_hits:
        score += min(kw_score, 4)
        motivos.add('negocio')
    if any(e in cue for e in _COR_ESPERA):
        score += 2; motivos.add('espera')
    if '?' in (asunto or '') or '?' in (cuerpo or '')[:1500]:
        score += 1
    if any(p in asu for p in _COR_PROMO):
        score -= 2
    kw = kw_hits[0] if kw_hits else ''
    return score, motivos, kw


def _cor_msg(remitente, motivos, kw):
    if 'cliente' in motivos and ('negocio' in motivos):
        return (f'Correo de {remitente} (cliente) sobre "{kw}". Podría ser una venta — no lo dejes esperando.',
                'Responde hoy y, si aplica, crea la oportunidad.')
    if 'cliente' in motivos:
        return (f'Te escribió {remitente} (cliente) y sigue sin respuesta.',
                'Responde antes de que se enfríe.')
    if 'espera' in motivos:
        return (f'{remitente} está esperando tu respuesta.', 'Contesta hoy, aunque sea para dar tiempos.')
    if 'negocio' in motivos:
        return (f'Correo con un tema de negocio ("{kw}") sin responder.', 'Revísalo y responde hoy.')
    return ('Correo importante sin responder.', 'Revísalo y responde.')


def _cor_hace(dt, now):
    if not dt:
        return ''
    secs = (now - dt).total_seconds()
    if secs < 3600:
        m = max(1, int(secs // 60)); return 'hace %d min' % m
    if secs < 86400:
        h = int(secs // 3600); return 'hace %d h' % h
    d = int(secs // 86400); return 'hace %d día%s' % (d, 's' if d != 1 else '')


# Cuántos correos "casi importantes" (borderline) leemos el cuerpo por IMAP en
# una misma carga. Tope para no encadenar decenas de FETCH y volver lenta la sección.
_COR_BODY_FETCH_CAP = 12


def _cor_fetch_cuerpos(user, correos):
    """Baja el cuerpo (texto) de varios correos por IMAP en modo readonly + PEEK,
    reusando UNA conexión por buzón (no marca \\Seen, no guarda nada en el modelo).
    Devuelve {mail_id: texto}. Los que fallen simplemente no aparecen en el dict."""
    import email as _email
    from .models import MailConexion
    out = {}
    if not correos:
        return out

    # Agrupar por conexión para abrir un solo IMAP por buzón.
    activa = MailConexion.objects.filter(usuario=user, activo=True).first()
    grupos = {}
    for m in correos:
        cx = m.conexion or activa
        if not cx:
            continue
        grupos.setdefault(cx, []).append(m)

    for cx, ms in grupos.items():
        imap = None
        try:
            from .views_mail import _get_imap
            imap = _get_imap(cx)
            carpeta_actual = None
            for m in ms:
                carpeta = m.carpeta_imap or 'INBOX'
                if not m.uid_imap:
                    continue
                try:
                    if carpeta != carpeta_actual:
                        imap.select(carpeta, readonly=True)      # readonly ⇒ NO marca \Seen
                        carpeta_actual = carpeta
                    typ, data = imap.uid('FETCH', m.uid_imap.encode(), '(BODY.PEEK[])')
                    raw = data[0][1] if (data and isinstance(data[0], tuple)) else None
                    if not raw:
                        continue
                    msg = _email.message_from_bytes(raw)
                    texto, html = '', ''
                    for part in msg.walk():
                        if part.get_filename():
                            continue
                        ct = part.get_content_type()
                        if ct == 'text/plain' and not texto:
                            cs = part.get_content_charset() or 'utf-8'
                            texto = (part.get_payload(decode=True) or b'').decode(cs, errors='replace')
                        elif ct == 'text/html' and not html:
                            cs = part.get_content_charset() or 'utf-8'
                            html = (part.get_payload(decode=True) or b'').decode(cs, errors='replace')[:120000]
                    if not texto and html:
                        import re as _re
                        texto = _re.sub(r'<[^>]+>', ' ', html)
                    if texto:
                        out[m.id] = texto
                except Exception:
                    continue
        except Exception:
            pass
        finally:
            if imap is not None:
                try:
                    imap.logout()
                except Exception:
                    pass
    return out


def _cor_limpiar_asunto(asunto):
    """Asunto sin ruido: quita etiquetas tipo [EXTERNAL]/[EXTERNO]/[SPAM] y
    prefijos Re:/RV:/Fw: aunque vengan encadenados ("[EXTERNAL]Re: RV: ...")."""
    import re as _re
    s = (asunto or '').strip()
    prev = None
    while s != prev:
        prev = s
        s = _re.sub(r'^\s*\[[^\]]{0,24}\]\s*', '', s)
        s = _re.sub(r'^\s*((re|rv|fw|fwd)\s*:\s*)+', '', s, flags=_re.IGNORECASE)
    return s.strip()


# ── Análisis persistente de correos (precisión del asistente) ─────────────────
# Pipeline de 3 etapas para que la IA NO queme créditos:
#   0. Filtros deterministas gratis (spam / auto-respuesta / promo) → 'ruido'.
#   1. Candidatos: se baja el cuerpo UNA vez (PEEK) y se guarda en cuerpo_texto.
#   2. UN solo llamado de IA por LOTE clasifica los candidatos; el veredicto se
#      persiste en CorreoAnalisis y ese correo no se vuelve a analizar jamás.
# Si la IA está apagada (AsistenteConfig.activo) o falla, cae a las reglas por
# keywords de siempre (fuente='reglas', confianza baja).

_COR_ANA_MAX_IA = 8          # correos nuevos que clasifica la IA por ciclo del feed


def _cor_clasificar_reglas(m, known_emails, known_domains, cliente_nombres):
    """Veredicto SOLO con reglas (fallback sin IA). Devuelve (categoria, requiere, conf)."""
    score, motivos, _kw = _cor_score(m.remitente_email, m.asunto, m.cuerpo_texto,
                                     known_emails, known_domains, cliente_nombres)
    if score <= 0:
        return 'ruido', False, 0.6
    if _cor_es_hito(m.asunto, m.cuerpo_texto):
        return 'hito', True, 0.5
    if score >= 3 and 'negocio' in motivos:
        return 'venta', True, 0.4
    if score >= 3:
        return 'respuesta', True, 0.4
    return 'info', False, 0.3


def _cor_analisis_ia(lote, modelo=None):
    """Clasifica un LOTE de correos en UNA sola llamada al LLM.
    lote = [{'id', 'de', 'asunto', 'cuerpo'}]. Devuelve {id: verdict} o {} si falla."""
    import json as _json
    if not lote:
        return {}
    try:
        from .asistente_provider import chat
    except Exception:
        return {}
    sys = (
        "Eres el clasificador de correos del asistente de un CRM. El usuario es un VENDEDOR "
        "que atiende a SUS clientes. Para CADA correo (clave = su id) decide UNA categoría:\n"
        "- 'venta': el remitente pide cotización, precios, disponibilidad o quiere comprarNOS "
        "algo NUEVO — amerita crear una oportunidad de venta. OJO con la dirección: si el "
        "remitente nos ENVÍA una cotización o propuesta (un PROVEEDOR cotizándonos algo que "
        "NOSOTROS pedimos, 'adjunto la cotización solicitada', 'favor de validar la propuesta') "
        "NO es venta — nosotros somos el comprador; eso es 'respuesta' (hay que validarla o "
        "contestar).\n"
        "- 'hito': un CLIENTE (persona real) nos manda factura, orden de compra (firmada o no), "
        "confirmación o liberación de un pedido, pago, anticipo o comprobante de una venta "
        "NUESTRA en curso. NO es venta nueva. Ej.: 'Confirmo la liberación de su pedido' es hito. "
        "OJO: las confirmaciones AUTOMÁTICAS de compras en línea, recibos de tiendas o "
        "plataformas y correos de remitentes no-reply NO son hito — son 'ruido'.\n"
        "- 'respuesta': correo legítimo de un cliente o socio que espera respuesta del vendedor, "
        "pero no es venta nueva ni hito (dudas, coordinación, información solicitada, quejas). "
        "AQUÍ va también el cliente que pide ESTATUS, avance o fecha de entrega/terminación de "
        "un pedido u orden EXISTENTE (aunque cite números de orden) — esa venta ya se hizo, "
        "NO es 'venta'.\n"
        "- 'info': legítimo pero solo informa; no requiere acción del vendedor.\n"
        "- 'ruido': promoción, newsletter, notificación automática, spam, y TAMBIÉN quien nos "
        "quiere vender algo a NOSOTROS (prospección de terceros, cold outreach, invitaciones a "
        "webinars/eventos/partnerships) — eso no es un cliente del vendedor.\n"
        "Además escribe 'resumen': UNA frase corta en español (máx 140 caracteres), natural, "
        "que diga qué pide o informa el remitente. Sin prefijos 'Re:' ni etiquetas "
        "'[EXTERNAL]'. No inventes nada que no esté en el correo.\n"
        "'confianza' es TU certeza real en la categoría, un número entre 0 y 1 (no copies el "
        "del ejemplo).\n"
        "Devuelve SOLO JSON válido: {\"items\": {\"<id>\": {\"categoria\": \"...\", "
        "\"resumen\": \"...\", \"requiere_respuesta\": true, \"confianza\": 0.85}}}"
    )
    facts = [{'id': d['id'], 'de': d['de'], 'asunto': d['asunto'], 'cuerpo': d['cuerpo']}
             for d in lote]
    usr = 'Correos (JSON):\n' + _json.dumps(facts, ensure_ascii=False)
    try:
        resp = chat(messages=[{'role': 'system', 'content': sys},
                              {'role': 'user', 'content': usr}],
                    model=modelo, temperature=0.1, max_tokens=1500)
        txt = (resp.get('text') or '').strip()
        if txt.startswith('```'):
            txt = txt.strip('`')
            if txt.lower().startswith('json'):
                txt = txt[4:]
        data = _json.loads(txt)
        items = data.get('items') or {}
    except Exception:
        return {}
    validas = {'venta', 'hito', 'respuesta', 'info', 'ruido'}
    out = {}
    for k, v in items.items():
        try:
            mid = int(k)
        except (TypeError, ValueError):
            continue
        cat = (v.get('categoria') or '').strip().lower()
        if cat not in validas:
            continue
        try:
            conf = max(0.0, min(1.0, float(v.get('confianza') or 0)))
        except (TypeError, ValueError):
            conf = 0.0
        out[mid] = {'categoria': cat, 'resumen': (v.get('resumen') or '').strip()[:200],
                    'requiere_respuesta': bool(v.get('requiere_respuesta')), 'confianza': conf}
    return out


def _cor_asegurar_analisis(user, correos, known, max_ia=_COR_ANA_MAX_IA):
    """Garantiza que los correos dados tengan CorreoAnalisis y devuelve {mail_id: analisis}.

    Solo trabaja sobre los que aún NO tienen análisis: filtros gratis primero, cuerpo
    por IMAP (con tope) para los candidatos, y UNA llamada de IA por lote. Los que no
    alcancen el cupo de IA en este ciclo quedan para el siguiente (el feed mientras
    tanto usa las reglas de siempre)."""
    from .models import CorreoAnalisis, AsistenteConfig
    known_emails, known_domains, cliente_nombres = known
    ids = [m.id for m in correos]
    if not ids:
        return {}
    res = {a.correo_id: a for a in CorreoAnalisis.objects.filter(correo_id__in=ids)}
    pendientes = [m for m in correos if m.id not in res]
    if not pendientes:
        return res

    def _guardar(m, cat, resumen, req, conf, fuente):
        try:
            a, _ = CorreoAnalisis.objects.get_or_create(
                correo=m, defaults={'usuario': user, 'categoria': cat, 'resumen': resumen,
                                    'requiere_respuesta': req, 'confianza': conf, 'fuente': fuente})
            res[m.id] = a
        except Exception:
            pass

    # Etapa 0 — filtros deterministas gratis: ruido evidente NO gasta cuerpo ni IA.
    candidatos = []
    for m in pendientes:
        rem = _cor_norm(m.remitente_email or '').strip()
        # El NOMBRE del remitente también delata ("Zebra (Do Not Reply)"): se
        # compacta sin espacios/guiones para cazar noreply/donotreply/no-reply.
        nom = _cor_norm(m.remitente_nombre or '')
        nom_c = nom.replace(' ', '').replace('-', '').replace('_', '').replace('.', '')
        asu = _cor_norm(m.asunto or '')
        if (any(bad in rem for bad in _COR_SPAM_SENDER)
                or 'noreply' in nom_c or 'donotreply' in nom_c
                or any(a in asu for a in _COR_AUTO)):
            _guardar(m, 'ruido', '', False, 0.9, 'reglas')
            continue
        candidatos.append(m)

    # Etapa 1 — cuerpo: bajar por IMAP (PEEK, con tope) los que no lo tengan y
    # PERSISTIRLO en cuerpo_texto (sin marcar cuerpo_cargado: al abrir el correo
    # se baja completo con HTML y adjuntos como siempre).
    sin_cuerpo = [m for m in candidatos if not (m.cuerpo_texto or '').strip()]
    con_intento = set(m.id for m in sin_cuerpo[:_COR_BODY_FETCH_CAP])
    if sin_cuerpo:
        cuerpos = _cor_fetch_cuerpos(user, sin_cuerpo[:_COR_BODY_FETCH_CAP])
        for m in sin_cuerpo:
            texto = cuerpos.get(m.id)
            if texto:
                m.cuerpo_texto = texto[:100000]
                try:
                    m.save(update_fields=['cuerpo_texto'])
                except Exception:
                    pass

    # Etapa 2 — IA por lote (solo si está activa). Fallback: reglas.
    ia_activa, modelo = False, None
    try:
        cfg = AsistenteConfig.get_singleton()
        ia_activa = bool(cfg and cfg.activo)
        modelo = cfg.modelo if cfg else None
    except Exception:
        ia_activa = False
    if ia_activa:
        lote_ms = candidatos[:max_ia]
        lote = []
        for m in lote_ms:
            cuerpo = _cor_extracto(m.cuerpo_texto or '', limite=600) or (m.cuerpo_texto or '')[:600]
            lote.append({'id': m.id,
                         'de': '%s <%s>' % (m.remitente_nombre or '', m.remitente_email or ''),
                         'asunto': _cor_limpiar_asunto(m.asunto), 'cuerpo': cuerpo})
        verdicts = _cor_analisis_ia(lote, modelo)
        for m in lote_ms:
            v = verdicts.get(m.id)
            if v:
                _guardar(m, v['categoria'], v['resumen'], v['requiere_respuesta'],
                         v['confianza'], 'ia')
            else:
                # La IA no contestó por este correo (o falló el lote) → reglas,
                # para no reintentar cada 60s y no dejar el feed colgado.
                cat, req, conf = _cor_clasificar_reglas(m, known_emails, known_domains, cliente_nombres)
                _guardar(m, cat, '', req, conf, 'reglas')
        # Los candidatos que no cupieron en el lote quedan SIN análisis: el feed
        # los muestra con reglas y la IA los alcanza en el siguiente ciclo.
    else:
        for m in candidatos:
            # Sin cuerpo y sin haberlo intentado bajar aún → dejarlo para el
            # siguiente ciclo (no fijar un veredicto a ciegas).
            if not (m.cuerpo_texto or '').strip() and m.id not in con_intento:
                continue
            cat, req, conf = _cor_clasificar_reglas(m, known_emails, known_domains, cliente_nombres)
            _guardar(m, cat, '', req, conf, 'reglas')
    return res


def analizar_correos_recientes(user, horas=_COR_VENTANA_HORAS, max_ia=_COR_ANA_MAX_IA):
    """Analiza (si falta) los correos recientes del usuario y devuelve cuántos quedaron
    con veredicto. La llama el worker de sync justo después de bajar correos nuevos,
    para que cuando el feed del asistente pregunte el análisis YA esté hecho."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import MailCorreo
    cutoff = timezone.now() - timedelta(hours=horas)
    inbox = list(MailCorreo.objects.filter(
        usuario=user, carpeta_display='INBOX', eliminado=False, archivado=False,
        fecha_envio__gte=cutoff, analisis__isnull=True).order_by('-fecha_envio')[:60])
    if not inbox:
        return 0
    res = _cor_asegurar_analisis(user, inbox, _cor_conocidos(), max_ia=max_ia)
    return sum(1 for m in inbox if m.id in res)


def _cor_item(m, score, motivos, kw, cuerpo, now, respondido_hoy, atendidos):
    """Construye el dict de un correo importante para el frontend.
    respondido_hoy: ya lo respondiste HOY (hay un SENT de hoy posterior a este correo)."""
    from django.utils import timezone
    remitente = (m.remitente_nombre or '').strip() or (m.remitente_email or '').split('@')[0]
    mensaje, accion = _cor_msg(remitente, motivos, kw)
    respondido = bool(respondido_hoy)
    listo = m.id in atendidos
    completada = respondido or listo
    dias = 0
    if m.fecha_envio:
        dias = (timezone.localtime(now).date() - timezone.localtime(m.fecha_envio).date()).days
    urgente = (not completada) and dias >= 2
    if urgente and not listo:
        mensaje = 'Lleva %d días esperando tu respuesta. %s' % (dias, mensaje)
    snippet = (cuerpo or m.cuerpo_texto or '').strip().replace('\n', ' ')[:200]
    return {
        'mail_id': m.id,
        'remitente': remitente,
        'remitente_email': m.remitente_email or '',
        'asunto': m.asunto or '(sin asunto)',
        'snippet': snippet,
        'hace': _cor_hace(timezone.localtime(m.fecha_envio), timezone.localtime(now)) if m.fecha_envio else '',
        'adjuntos': bool(m.tiene_adjuntos),
        'score': score,
        'motivos': sorted(motivos),
        'kw': kw,
        'mensaje': mensaje,
        'accion': accion,
        'completada': completada,
        'dias_espera': dias,
        'urgente': urgente,
        'motivo_done': ('respondido' if respondido else ('listo' if listo else '')),
    }, completada


@login_required
def api_asistente_correos(request):
    """GET /app/api/asistente/correos/ — correos importantes de las últimas 24h SIN responder."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import MailConexion, MailCorreo, CorreoAtendido

    user = request.user
    now = timezone.now()
    today = timezone.localdate()

    if not MailConexion.objects.filter(usuario=user, activo=True).exists():
        return JsonResponse({'success': True, 'conectado': False, 'items': [], 'total': 0,
                             'pendientes': 0, 'completadas': 0})

    cutoff = now - timedelta(hours=_COR_VENTANA_HORAS)
    inbox = list(MailCorreo.objects.filter(
        usuario=user, carpeta_display='INBOX', eliminado=False, archivado=False,
        fecha_envio__gte=cutoff).order_by('-fecha_envio')[:300])

    # Última respuesta (SENT) por hilo: "sin responder" = NO hay un enviado posterior
    # al último correo que te mandaron (aunque ya hubieras respondido antes en el hilo).
    hks = set(m.hilo_key for m in inbox if m.hilo_key)
    last_sent = {}
    if hks:
        for s in MailCorreo.objects.filter(usuario=user, carpeta_display='SENT', hilo_key__in=hks).values('hilo_key', 'fecha_envio'):
            f = s['fecha_envio']
            if not f:
                continue
            hk = s['hilo_key']
            if hk not in last_sent or f > last_sent[hk]:
                last_sent[hk] = f

    known_emails, known_domains, cliente_nombres = _cor_conocidos()

    # Marcados manualmente como "listo" (informativos sin respuesta).
    atendidos = set(CorreoAtendido.objects.filter(
        usuario=user, mail__in=[m.id for m in inbox]).values_list('mail_id', flat=True))

    def _estado_hilo(m):
        """(mostrar, respondido_hoy). inbox viene ordenado por -fecha_envio, así que el
        primero de cada hilo es el más reciente; los siguientes del mismo hilo se ocultan."""
        hk = m.hilo_key
        ls = last_sent.get(hk) if hk else None
        respondido = bool(ls and m.fecha_envio and ls >= m.fecha_envio)
        if respondido and timezone.localtime(ls).date() != today:
            return False, False   # ya resuelto en un día anterior → ocultar
        return True, respondido

    pend, done = [], []
    borderline = []   # (m, score_prelim): casi importantes SIN cuerpo aún → leerlo por IMAP
    considerar = []
    seen_hk = set()
    for m in inbox:
        hk = m.hilo_key
        if hk:
            if hk in seen_hk:
                continue   # ya consideramos el correo más reciente de este hilo
            seen_hk.add(hk)
        mostrar, respondido_hoy = _estado_hilo(m)
        if not mostrar:
            continue
        considerar.append((m, respondido_hoy))

    # Análisis persistente — el MISMO veredicto que usa el toast (1 vez por correo).
    ana = _cor_asegurar_analisis(user, [m for m, _r in considerar],
                                 (known_emails, known_domains, cliente_nombres))

    for m, respondido_hoy in considerar:
        a = ana.get(m.id)
        if a is not None:
            if a.categoria in ('ruido', 'info'):
                continue
            score, motivos, kw = _cor_score(m.remitente_email, m.asunto, m.cuerpo_texto,
                                            known_emails, known_domains, cliente_nombres)
            item, completada = _cor_item(m, max(score, 3), motivos, kw, m.cuerpo_texto,
                                         now, respondido_hoy, atendidos)
            # La redacción del análisis (IA leyó el correo) manda sobre la de keywords.
            if a.fuente == 'ia':
                msg = a.resumen or item['mensaje']
                if a.categoria == 'venta':
                    msg = ((a.resumen + ' ') if a.resumen else '') + 'Podría ser una venta — no la dejes esperando.'
                    item['accion'] = 'Responde hoy y, si aplica, crea la oportunidad.'
                elif a.categoria == 'hito':
                    msg = a.resumen or 'Llegó una factura u orden de compra.'
                    item['accion'] = 'Confírmale de recibido y actualiza la venta.'
                if item['urgente']:
                    msg = 'Lleva %d días esperando tu respuesta. %s' % (item['dias_espera'], msg)
                item['mensaje'] = msg
            (done if completada else pend).append(item)
            continue
        # Fallback (aún sin análisis — no alcanzó el cupo de IA): reglas de siempre.
        score, motivos, kw = _cor_score(m.remitente_email, m.asunto, m.cuerpo_texto,
                                        known_emails, known_domains, cliente_nombres)
        if score >= 3:
            item, completada = _cor_item(m, score, motivos, kw, m.cuerpo_texto, now, respondido_hoy, atendidos)
            (done if completada else pend).append(item)
        elif score >= 1 and not (m.cuerpo_texto or '').strip() and not m.cuerpo_cargado:
            # No alcanza con asunto/remitente/dominio y NO tenemos el cuerpo:
            # candidato a leerlo para confirmar o descartar.
            borderline.append((m, score))

    # Segundo paso: leer el cuerpo SOLO de los borderline con más potencial (tope),
    # re-evaluar con el cuerpo real y rescatar los que crucen el umbral.
    if borderline:
        borderline.sort(key=lambda t: -t[1])
        objetivo = [m for (m, _s) in borderline[:_COR_BODY_FETCH_CAP]]
        cuerpos = _cor_fetch_cuerpos(user, objetivo)
        for m in objetivo:
            cuerpo = cuerpos.get(m.id, '')
            if not cuerpo:
                continue
            score, motivos, kw = _cor_score(m.remitente_email, m.asunto, cuerpo,
                                            known_emails, known_domains, cliente_nombres)
            if score < 3:
                continue   # el cuerpo confirmó que no es importante → descartar
            _mostrar, respondido_hoy = _estado_hilo(m)
            item, completada = _cor_item(m, score, motivos, kw, cuerpo, now, respondido_hoy, atendidos)
            (done if completada else pend).append(item)

    # Orden por urgencia: mezcla importancia (score) + antigüedad (los que llevan
    # días sin responder suben, para que el asistente insista con lo que se te pasa).
    pend.sort(key=lambda x: -(x['score'] + min(x.get('dias_espera', 0), 7) * 0.6))
    items = pend + done
    return JsonResponse({'success': True, 'conectado': True, 'items': items, 'total': len(items),
                         'pendientes': len(pend), 'completadas': len(done)})


@login_required
def api_asistente_correos_estado(request):
    """Ligero: dado ?ids=1,2,3 (mail ids) devuelve cuáles ya están resueltos HOY:
    respondidos (SENT en su hilo hoy) o marcados manualmente como "listo"."""
    from django.utils import timezone
    from .models import MailCorreo, CorreoAtendido
    ids = [int(x) for x in (request.GET.get('ids', '') or '').split(',') if x.strip().isdigit()]
    today = timezone.localdate()
    worked = set()
    if ids:
        rows = MailCorreo.objects.filter(usuario=request.user, id__in=ids).values('id', 'hilo_key')
        hk_by_id = {r['id']: r['hilo_key'] for r in rows}
        hk_set = set(v for v in hk_by_id.values() if v)
        sent_hks = set()
        if hk_set:
            for s in MailCorreo.objects.filter(usuario=request.user, carpeta_display='SENT', hilo_key__in=hk_set).values('hilo_key', 'fecha_envio'):
                if s['fecha_envio'] and timezone.localtime(s['fecha_envio']).date() == today:
                    sent_hks.add(s['hilo_key'])
        for mid, hk in hk_by_id.items():
            if hk and hk in sent_hks:
                worked.add(mid)
        for mid in CorreoAtendido.objects.filter(usuario=request.user, mail_id__in=ids).values_list('mail_id', flat=True):
            worked.add(mid)
    return JsonResponse({'success': True, 'worked_ids': sorted(worked)})


@login_required
@require_http_methods(["POST"])
def api_asistente_correo_listo(request, correo_id):
    """Marca/desmarca un correo como "listo" (informativo, sin respuesta) desde el asistente."""
    import json as _json
    from django.utils import timezone
    from .models import MailCorreo, CorreoAtendido
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'no encontrado'}, status=404)
    try:
        body = _json.loads(request.body or '{}')
    except Exception:
        body = {}
    marcar = body.get('marcar', True)
    if marcar:
        CorreoAtendido.objects.get_or_create(
            usuario=request.user, mail=correo, defaults={'fecha': timezone.localdate()})
        _asis_log_accion(request.user, 'revisado',
                         _cor_limpiar_asunto(correo.asunto or '') or (correo.remitente_nombre or correo.remitente_email or 'Correo'),
                         'De %s' % (correo.remitente_nombre or correo.remitente_email or ''), mail=correo)
        return JsonResponse({'success': True, 'completada': True, 'motivo_done': 'listo'})
    CorreoAtendido.objects.filter(usuario=request.user, mail=correo).delete()
    return JsonResponse({'success': True, 'completada': False, 'motivo_done': ''})


@login_required
@require_http_methods(["POST"])
def api_asistente_correo_respuesta(request, correo_id):
    """Redacta con IA un borrador de respuesta para un correo importante.

    Reusa el mismo proveedor de IA del asistente (asistente_provider.chat). Baja el
    cuerpo del correo en readonly/PEEK (sin marcarlo leído) para dar contexto, y
    devuelve SOLO el texto del borrador — el usuario lo revisa y lo abre en Correo.
    """
    import email as _email
    from .models import MailCorreo, MailConexion, AsistenteConfig
    from .asistente_provider import chat, AsistenteError
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'no encontrado'}, status=404)

    cfg = AsistenteConfig.get_singleton()
    if not cfg.activo:
        return JsonResponse({'success': False, 'error': 'Asistente desactivado.'}, status=403)

    # Cuerpo para contexto: caché si ya se abrió, si no PEEK readonly (no marca leído).
    cuerpo = (correo.cuerpo_texto or '').strip()
    if not cuerpo and not correo.cuerpo_cargado:
        try:
            from .views_mail import _get_imap
            conexion = correo.conexion or MailConexion.objects.filter(usuario=request.user, activo=True).first()
            if conexion:
                imap = _get_imap(conexion)
                imap.select(correo.carpeta_imap, readonly=True)
                typ, data = imap.uid('FETCH', correo.uid_imap.encode(), '(BODY.PEEK[])')
                raw = data[0][1] if (data and isinstance(data[0], tuple)) else None
                if raw:
                    msg = _email.message_from_bytes(raw)
                    for part in msg.walk():
                        if part.get_filename():
                            continue
                        if part.get_content_type() == 'text/plain':
                            cs = part.get_content_charset() or 'utf-8'
                            cuerpo = (part.get_payload(decode=True) or b'').decode(cs, errors='replace').strip()
                            break
                try:
                    imap.logout()
                except Exception:
                    pass
        except Exception:
            pass
    cuerpo = cuerpo[:2500]

    remitente = (correo.remitente_nombre or '').strip() or (correo.remitente_email or '').split('@')[0]
    nombre_yo = (request.user.get_full_name() or request.user.username or '').strip()
    sys_msg = {
        'role': 'system',
        'content': (
            'Eres un asistente que redacta respuestas de correo profesionales en '
            'español para un vendedor/ingeniero de IAMET (integrador de tecnología). '
            'Escribe un borrador BREVE, claro y cordial, listo para enviar. Usa el '
            'nombre del remitente en el saludo si lo conoces. NO inventes datos, '
            'precios ni fechas que no estén en el correo original: si falta información '
            'para responder algo concreto, pídela amablemente. Cierra con una despedida '
            'y la firma del usuario. Devuelve SOLO el cuerpo del correo, sin asunto, '
            'sin comillas y sin explicaciones.'
        ),
    }
    user_msg = {
        'role': 'user',
        'content': (
            f'Correo recibido de {remitente} <{correo.remitente_email or ""}>.\n'
            f'Asunto: {correo.asunto or "(sin asunto)"}\n\n'
            f'Cuerpo:\n{cuerpo or "(sin cuerpo disponible)"}\n\n'
            f'Redacta la respuesta. Yo soy {nombre_yo or "el vendedor"}; '
            f'firma con mi nombre.'
        ),
    }
    try:
        resp = chat(messages=[sys_msg, user_msg], model=cfg.modelo,
                    temperature=0.5, max_tokens=700)
    except AsistenteError as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=502)
    except Exception as e:
        logger.exception('Error redactando respuesta de correo: %s', e)
        return JsonResponse({'success': False, 'error': 'Error inesperado al redactar.'}, status=500)

    borrador = (resp.get('text') or '').strip()
    if not borrador:
        return JsonResponse({'success': False, 'error': 'La IA no devolvió texto.'}, status=502)
    asunto = correo.asunto or ''
    if asunto and not asunto.lower().startswith('re:'):
        asunto = 'Re: ' + asunto
    return JsonResponse({
        'success': True,
        'borrador': borrador,
        'destinatario_email': correo.remitente_email or '',
        'asunto': asunto,
    })


def _correo_texto(correo, user, limite=2500):
    """Texto de un correo (caché si ya se abrió; si no, PEEK readonly sin marcar leído)."""
    import email as _email
    from .models import MailConexion
    txt = (correo.cuerpo_texto or '').strip()
    if txt or correo.cuerpo_cargado:
        return txt[:limite]
    try:
        from .views_mail import _get_imap
        conexion = correo.conexion or MailConexion.objects.filter(usuario=user, activo=True).first()
        if not conexion or not correo.uid_imap:
            return ''
        imap = _get_imap(conexion)
        imap.select(correo.carpeta_imap or 'INBOX', readonly=True)
        typ, data = imap.uid('FETCH', correo.uid_imap.encode(), '(BODY.PEEK[])')
        raw = data[0][1] if (data and isinstance(data[0], tuple)) else None
        if raw:
            msg = _email.message_from_bytes(raw)
            for part in msg.walk():
                if part.get_filename():
                    continue
                if part.get_content_type() == 'text/plain':
                    cs = part.get_content_charset() or 'utf-8'
                    txt = (part.get_payload(decode=True) or b'').decode(cs, errors='replace').strip()
                    break
        try:
            imap.logout()
        except Exception:
            pass
    except Exception:
        return (correo.cuerpo_texto or '').strip()[:limite]
    return txt[:limite]


# Horario laboral GLOBAL del asistente: lunes–viernes, 8:00–18:00. Todo lo que el
# asistente agenda o sugiere (seguimientos, actividades, huecos libres) vive aquí.
_HORA_LAB_INI = 8
_HORA_LAB_FIN = 18


def _mas_dias_habiles(fecha, n=2):
    """Suma n días HÁBILES (salta sábado y domingo). Jueves+2 → lunes; viernes+2 → martes."""
    from datetime import timedelta
    d, added = fecha, 0
    while added < n:
        d = d + timedelta(days=1)
        if d.weekday() < 5:   # 0-4 = lunes a viernes
            added += 1
    return d


def _en_horario_laboral(dt):
    """True si dt cae en horario laboral: lunes–viernes, 8:00–18:00."""
    return dt.weekday() < 5 and _HORA_LAB_INI <= dt.hour < _HORA_LAB_FIN


def _hueco_libre_ahora(user, now):
    """¿El usuario tiene un rato libre AHORA para atender algo?
    Libre = estamos en horario laboral (L–V 8–18) y no hay ninguna actividad
    ocupando la hora actual. Devuelve (libre: bool, hasta_hora: int|None) donde
    hasta_hora es la hora (0–24) hasta la que sigue libre (inicio de la próxima
    actividad de hoy o el fin de la jornada)."""
    from django.db.models import Q
    from django.utils import timezone
    from .models import Actividad
    local = timezone.localtime(now)
    if not _en_horario_laboral(local):
        return (False, None)
    hoy = local.date()
    h_now = local.hour
    ocupadas = set()
    prox = _HORA_LAB_FIN
    acts = (Actividad.objects.filter(fecha_inicio__date=hoy)
            .filter(Q(creado_por=user) | Q(participantes=user)).distinct()
            .values_list('fecha_inicio', 'fecha_fin'))
    for ini, fin in acts:
        if not ini:
            continue
        h0 = timezone.localtime(ini).hour
        h1 = timezone.localtime(fin).hour if fin else h0 + 1
        for h in range(h0, max(h0 + 1, h1 + 1)):
            ocupadas.add(h)
        if h0 > h_now:
            prox = min(prox, h0)          # próxima actividad que empieza después de ahora
    if h_now in ocupadas:
        return (False, None)              # está en una actividad ahora mismo
    return (True, prox)


def _cliente_por_correo(correo):
    """Detecta el Cliente a partir del remitente del correo: por email exacto
    (Cliente/Contacto) o por dominio (no público). Devuelve Cliente o None."""
    from .models import Cliente, Contacto
    rem = (correo.remitente_email or '').strip().lower()
    if not rem or '@' not in rem:
        return None
    dom = rem.split('@')[-1]
    # 1) Email exacto en Contacto → su cliente
    c = Contacto.objects.filter(email__iexact=rem, cliente__isnull=False).select_related('cliente').first()
    if c and c.cliente:
        return c.cliente
    # 2) Email exacto en Cliente
    cli = Cliente.objects.filter(email__iexact=rem).first()
    if cli:
        return cli
    # 3) Dominio (si no es público)
    if dom and dom not in _COR_PUBLIC_DOM:
        c = Contacto.objects.filter(email__iendswith='@' + dom, cliente__isnull=False).select_related('cliente').first()
        if c and c.cliente:
            return c.cliente
        cli = Cliente.objects.filter(email__iendswith='@' + dom).first()
        if cli:
            return cli
    return None


def _oportunidad_draft_ia(asunto, cuerpo):
    """(titulo, tipo) inferidos con IA a partir del correo. tipo ∈ {runrate, proyecto}.
    Con fallback por heurística si la IA no está disponible o falla."""
    import json as _json
    titulo, tipo = '', ''
    try:
        from .models import AsistenteConfig
        from .asistente_provider import chat
        cfg = AsistenteConfig.get_singleton()
        if cfg.activo:
            sys_msg = {'role': 'system', 'content': (
                'Eres un asistente que prepara el borrador de una OPORTUNIDAD de venta para '
                'IAMET (integrador de tecnología) a partir de un correo de un cliente. Devuelve '
                'SOLO un JSON válido, sin texto extra, con exactamente estas llaves:\n'
                '{"titulo": "<título breve y claro de lo que el cliente solicita, sin \'Re:\' ni '
                'corchetes, máx 8 palabras>", "tipo": "runrate" | "proyecto"}\n'
                'Usa "proyecto" si implica instalación, levantamiento, integración, obra o servicio '
                'con alcance; usa "runrate" si es compra/cotización de productos puntuales.')}
            user_msg = {'role': 'user', 'content': 'Asunto: %s\n\nCuerpo:\n%s' % (asunto or '(sin asunto)', (cuerpo or '')[:2000])}
            resp = chat(messages=[sys_msg, user_msg], model=cfg.modelo, temperature=0.2, max_tokens=200)
            raw = (resp.get('text') or '').strip()
            if raw.startswith('```'):
                raw = raw.strip('`')
                if raw.lower().startswith('json'):
                    raw = raw[4:]
            i, j = raw.find('{'), raw.rfind('}')
            if i >= 0 and j > i:
                d = _json.loads(raw[i:j + 1])
                titulo = (d.get('titulo') or '').strip()
                t = (d.get('tipo') or '').strip().lower()
                if t in ('runrate', 'proyecto'):
                    tipo = t
    except Exception:
        pass
    # Fallback heurístico
    if not tipo:
        base = _cor_norm((asunto or '') + ' ' + (cuerpo or '')[:600])
        tipo = 'proyecto' if any(w in base for w in (
            'proyecto', 'instalacion', 'levantamiento', 'integracion', 'obra', 'servicio')) else 'runrate'
    if not titulo:
        t = (asunto or 'Oportunidad').strip()
        for pref in ('re:', 'rv:', 'fwd:', 'fw:'):
            while t.lower().startswith(pref):
                t = t[len(pref):].strip()
        t = t.replace('[EXTERNAL]', '').replace('[EXTERNO]', '').strip(' -:').strip()
        titulo = t[:80] or 'Oportunidad'
    return titulo, tipo


@login_required
def api_asistente_oportunidad_draft(request, correo_id):
    """GET — borrador SEMI-AUTOMÁTICO de oportunidad a partir de un correo. NO crea nada:
    detecta cliente (código) e infiere título + proyecto/runrate (IA). El usuario aprueba."""
    from django.utils import timezone
    from datetime import timedelta
    from .models import MailCorreo, EtapaPipeline
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'no encontrado'}, status=404)

    cuerpo = _correo_texto(correo, request.user)
    titulo, tipo = _oportunidad_draft_ia(correo.asunto, cuerpo)

    cliente = _cliente_por_correo(correo)
    if cliente:
        cliente_id, cliente_nombre = cliente.id, cliente.nombre_empresa
    else:
        # Sugerir nombre a partir del remitente (nombre o dominio) para que el usuario confirme.
        rem_nom = (correo.remitente_nombre or '').strip()
        dom = (correo.remitente_email or '').split('@')[-1].split('.')[0]
        cliente_id, cliente_nombre = None, (rem_nom or dom.capitalize() or '')

    ep = EtapaPipeline.objects.filter(pipeline=tipo, activo=True).order_by('orden').first()
    etapa = ep.nombre if ep else ('Oportunidad' if tipo == 'proyecto' else 'En Solicitud')

    fecha_seg = _mas_dias_habiles(timezone.localdate(), 2)
    return JsonResponse({
        'success': True,
        'correo_id': correo.id,
        'titulo': titulo,
        'cliente_id': cliente_id,
        'cliente_nombre': cliente_nombre,
        'cliente_detectado': bool(cliente),
        'vendedor': (request.user.get_full_name() or request.user.username),
        'tipo': tipo,
        'etapa': etapa,
        'probabilidad': 10,
        'actividad_titulo': ('Actividad de seguimiento — %s' % (cliente_nombre or 'este correo'))[:120],
        'actividad_fecha': fecha_seg.isoformat(),
        'remitente': (correo.remitente_nombre or correo.remitente_email or ''),
        'asunto': correo.asunto or '',
    })


def _asis_log_accion(user, accion, titulo, detalle='', mail=None, opp=None):
    """Deja constancia en la bitácora "Atendido" del asistente (pestaña del panel).
    Nunca truena: perder una fila de bitácora no debe romper la acción original."""
    try:
        from .models import AsistenteAccion
        AsistenteAccion.objects.create(
            usuario=user, accion=accion, titulo=(titulo or '')[:200],
            detalle=(detalle or '')[:300], mail=mail, oportunidad=opp)
    except Exception:
        logger.exception('Asistente: no se pudo registrar la acción en la bitácora')


def _seg_espejo_expediente(user, opp, act):
    """La sección 'Actividades' del detalle de la oportunidad lee TareaOportunidad,
    no el calendario. Mismo doble registro que hace el '+Nueva' del detalle
    (api_tareas_oportunidad): TareaOportunidad ligada a la Actividad del calendario."""
    if not opp or not act:
        return None
    try:
        from .models import TareaOportunidad
        t = TareaOportunidad.objects.create(
            oportunidad=opp, titulo=act.titulo,
            descripcion=act.descripcion or '', prioridad='normal',
            fecha_limite=act.fecha_fin or act.fecha_inicio,
            creado_por=user, actividad_calendario=act,
        )
        t.participantes.set([user.id])
        return t
    except Exception:
        logger.exception('Asistente: no se pudo espejar el seguimiento en el expediente')
        return None


@login_required
@require_http_methods(["POST"])
def api_asistente_oportunidad_crear(request):
    """POST — crea la oportunidad ya aprobada por el usuario: TodoItem con defaults,
    liga el correo (y su hilo) a la oportunidad, y crea la actividad de seguimiento."""
    import json as _json
    from datetime import datetime, timedelta
    from django.utils import timezone
    from .models import (MailCorreo, Cliente, TodoItem, EtapaPipeline, Actividad)
    try:
        data = _json.loads(request.body or '{}')
    except Exception:
        data = {}
    user = request.user

    titulo = (data.get('titulo') or '').strip() or 'Oportunidad'
    tipo = (data.get('tipo') or 'runrate').strip().lower()
    if tipo not in ('runrate', 'proyecto'):
        tipo = 'runrate'
    try:
        prob = int(data.get('probabilidad', 10))
    except Exception:
        prob = 10

    # Cliente: por id, o por nombre (match / crear)
    cliente = None
    if data.get('cliente_id'):
        cliente = Cliente.objects.filter(id=data['cliente_id']).first()
    if not cliente:
        nombre = (data.get('cliente_nombre') or '').strip()
        if len(nombre) < 2:
            return JsonResponse({'success': False, 'error': 'Falta el cliente.'}, status=400)
        cliente = Cliente.objects.filter(nombre_empresa__iexact=nombre).order_by('id').first()
        if not cliente:
            cliente = Cliente.objects.create(nombre_empresa=nombre, asignado_a=user)

    ep = EtapaPipeline.objects.filter(pipeline=tipo, activo=True).order_by('orden').first()
    if ep:
        etapa_c, etapa_col = ep.nombre, ep.color
    elif tipo == 'proyecto':
        etapa_c, etapa_col = 'Oportunidad', '#FFFFFF'
    else:
        etapa_c, etapa_col = 'En Solicitud', '#FFFFFF'

    now_dt = timezone.localtime()
    todo = TodoItem.objects.create(
        usuario=user, oportunidad=titulo[:200], cliente=cliente,
        monto=0, probabilidad_cierre=prob,
        mes_cierre=str(now_dt.month).zfill(2), anio_cierre=now_dt.year,
        area='SISTEMAS', producto='SOFTWARE', tipo_negociacion=tipo,
        etapa_corta=etapa_c, etapa_completa=etapa_c, etapa_color=etapa_col, po_number='',
    )
    try:
        from .views_automatizacion import ejecutar_automatizaciones
        ejecutar_automatizaciones(todo, etapa_c, user)
    except Exception:
        pass

    # Ligar el correo (y todo su hilo) a la nueva oportunidad. Con la FK puesta, la
    # conversación de la opp pinta los correos sola (api_chat_oportunidad los inyecta).
    correo = MailCorreo.objects.filter(id=data.get('correo_id'), usuario=user).first()
    if correo:
        MailCorreo.objects.filter(
            usuario=user, hilo_key=correo.hilo_key, oportunidad__isnull=True
        ).update(oportunidad=todo) if correo.hilo_key else None
        if correo.oportunidad_id is None:
            correo.oportunidad = todo
            correo.save(update_fields=['oportunidad'])
        # Timeline de la oportunidad — mismo registro que el vinculado manual de Correo.
        try:
            from .models import OportunidadActividad
            OportunidadActividad.objects.create(
                oportunidad=todo, tipo='creacion', usuario=user,
                titulo='Oportunidad creada desde correo (asistente)',
                descripcion='Asunto del correo: %s  |  De: %s' % (
                    (correo.asunto or '')[:200], correo.remitente_email or ''),
            )
            OportunidadActividad.objects.create(
                oportunidad=todo, tipo='email', usuario=user,
                titulo=('Correo vinculado: %s' % (correo.asunto or ''))[:100],
                descripcion='De: %s <%s>' % (correo.remitente_nombre or '', correo.remitente_email or ''),
            )
        except Exception:
            pass

    # Actividad de seguimiento (para que no se le olvide). Mismo patrón que el
    # endpoint oficial de actividades. Si algo falla, se reporta en la respuesta.
    actividad_id, actividad_error = None, None
    if data.get('crear_actividad', True):
        try:
            fecha = (data.get('actividad_fecha') or '').strip()
            ini = None
            if fecha:
                try:
                    y, m, d = fecha.split('-')
                    f_obj = datetime(int(y), int(m), int(d)).date()
                    naive = datetime(int(y), int(m), int(d), _hora_disponible(user, f_obj), 0)
                    ini = timezone.make_aware(naive) if timezone.is_naive(naive) else naive
                except Exception:
                    ini = None
            if ini is None:
                f_obj = _mas_dias_habiles(timezone.localdate(), 2)
                naive = datetime(f_obj.year, f_obj.month, f_obj.day, _hora_disponible(user, f_obj), 0)
                ini = timezone.make_aware(naive) if timezone.is_naive(naive) else naive
            # Título y descripción que digan QUÉ se espera hacer, no solo "dar
            # seguimiento": el análisis del correo ya sabe qué pidió el cliente.
            ana_seg = getattr(correo, 'analisis', None) if correo else None
            resumen_seg = ((ana_seg.resumen if ana_seg else '') or '').strip()
            cat_seg = (ana_seg.categoria if ana_seg else '') or ''
            if cat_seg == 'venta':
                desc_seg = 'Enviar la cotización que pidió el cliente y confirmarle de recibido.'
            elif cat_seg == 'hito':
                desc_seg = 'Confirmar de recibido y actualizar la venta con el documento.'
            else:
                desc_seg = 'Retomar la conversación con el cliente y avanzar la oportunidad.'
            if resumen_seg:
                desc_seg += ' Del correo: %s' % resumen_seg
            act = Actividad.objects.create(
                titulo=(data.get('actividad_titulo') or ('Actividad de seguimiento — %s' % cliente.nombre_empresa))[:200],
                tipo_actividad='tarea', descripcion=desc_seg,
                fecha_inicio=ini, fecha_fin=ini + timedelta(hours=1),
                creado_por=user, color='#007AFF', oportunidad_id=todo.id,
                correo=correo,
            )
            act.participantes.set([user.id])
            _seg_espejo_expediente(user, todo, act)
            actividad_id = act.id
        except Exception as e:
            logger.exception('Asistente: no se pudo crear actividad de seguimiento: %s', e)
            actividad_error = str(e)

    _asis_log_accion(user, 'oportunidad', todo.oportunidad or 'Oportunidad',
                     'Cliente: %s%s' % (cliente.nombre_empresa,
                                        ' · con seguimiento agendado' if actividad_id else ''),
                     mail=correo, opp=todo)
    return JsonResponse({'success': True, 'opp_id': todo.id, 'opp_nombre': todo.oportunidad,
                         'actividad_id': actividad_id, 'actividad_error': actividad_error})


def _update_draft_ia(opp, etapas, asunto, cuerpo, respuesta=''):
    """(etapa, probabilidad, resumen) propuestos por IA para actualizar la oportunidad
    a partir del correo del cliente Y la respuesta del vendedor (contexto completo del
    intercambio). Fallback: deja etapa/prob igual y resume por heurística."""
    import json as _json
    etapa_out, prob_out, resumen_out = opp.etapa_corta, opp.probabilidad_cierre, ''
    try:
        from .models import AsistenteConfig
        from .asistente_provider import chat
        cfg = AsistenteConfig.get_singleton()
        if cfg.activo and etapas:
            sys_msg = {'role': 'system', 'content': (
                'Eres un asistente que ACTUALIZA una oportunidad de venta a partir del intercambio '
                'de correos entre el cliente y el vendedor (el correo del cliente y la respuesta que '
                'le dio el vendedor). Te doy la etapa actual, la probabilidad actual y la lista de '
                'etapas posibles EN ORDEN. Devuelve SOLO un JSON válido:\n'
                '{"etapa": "<exactamente una de la lista, la que mejor refleje el estado tras este '
                'intercambio>", "probabilidad": <entero 0-100>, "resumen": "<1-2 frases, en español, '
                'resumiendo el intercambio para la bitácora de la oportunidad>"}\n'
                'No inventes datos. Si el intercambio no implica avance, deja la etapa igual y ajusta '
                'la probabilidad solo si tiene sentido.')}
            intercambio = 'Correo del cliente — Asunto: %s\nCuerpo:\n%s' % (
                asunto or '(sin asunto)', (cuerpo or '')[:2000])
            if (respuesta or '').strip():
                intercambio += '\n\nRespuesta del vendedor:\n%s' % (respuesta or '')[:1500]
            user_msg = {'role': 'user', 'content': (
                'Oportunidad: %s\nEtapa actual: %s\nProbabilidad actual: %d%%\n'
                'Etapas posibles (en orden): %s\n\n%s'
            ) % (opp.oportunidad, opp.etapa_corta or '-', opp.probabilidad_cierre or 0,
                 ', '.join(etapas), intercambio)}
            resp = chat(messages=[sys_msg, user_msg], model=cfg.modelo, temperature=0.2, max_tokens=350)
            raw = (resp.get('text') or '').strip()
            if raw.startswith('```'):
                raw = raw.strip('`')
                if raw.lower().startswith('json'):
                    raw = raw[4:]
            i, j = raw.find('{'), raw.rfind('}')
            if i >= 0 and j > i:
                d = _json.loads(raw[i:j + 1])
                et = (d.get('etapa') or '').strip()
                if et:
                    # match flexible contra la lista real de etapas
                    for e in etapas:
                        if e.lower() == et.lower() or et.lower() in e.lower():
                            etapa_out = e
                            break
                try:
                    p = int(d.get('probabilidad'))
                    prob_out = max(0, min(100, p))
                except Exception:
                    pass
                resumen_out = (d.get('resumen') or '').strip()
    except Exception:
        pass
    if not resumen_out:
        base = (cuerpo or asunto or '').strip().replace('\n', ' ')
        resumen_out = ('Correo de seguimiento: ' + base[:200]) if base else 'Correo de seguimiento recibido.'
    return etapa_out, prob_out, resumen_out


@login_required
def api_asistente_oportunidad_update_draft(request, correo_id):
    """GET — borrador para ACTUALIZAR la oportunidad ligada a un correo. La IA analiza
    el correo del cliente Y la respuesta del vendedor, y propone etapa + probabilidad +
    resumen. Sugiere también un seguimiento (+2 días hábiles). NO aplica nada."""
    from django.utils import timezone
    from .models import MailCorreo, EtapaPipeline
    try:
        correo = MailCorreo.objects.select_related('oportunidad').get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'no encontrado'}, status=404)
    opp = correo.oportunidad
    if not opp and correo.hilo_key:
        # Resolver por hilo: hereda el vínculo de otro correo del mismo hilo.
        ligado = (MailCorreo.objects.filter(
            usuario=request.user, oportunidad__isnull=False, hilo_key=correo.hilo_key)
            .select_related('oportunidad').first())
        opp = ligado.oportunidad if ligado else None
    if not opp:
        return JsonResponse({'success': False, 'error': 'Este correo no está ligado a una oportunidad.'}, status=400)

    # Reunir el intercambio: correo del cliente (recibido) + respuesta del vendedor (enviado).
    if correo.carpeta_display == 'SENT':
        reply_correo = correo
        client_correo = (MailCorreo.objects.filter(
            usuario=request.user, carpeta_display='INBOX', hilo_key=correo.hilo_key)
            .order_by('-fecha_envio').first() if correo.hilo_key else None) or correo
    else:
        client_correo = correo
        reply_correo = (MailCorreo.objects.filter(
            usuario=request.user, carpeta_display='SENT', hilo_key=correo.hilo_key)
            .order_by('-fecha_envio').first() if correo.hilo_key else None)

    etapas = list(EtapaPipeline.objects.filter(
        pipeline=opp.tipo_negociacion, activo=True).order_by('orden').values_list('nombre', flat=True))
    cuerpo = _correo_texto(client_correo, request.user)
    respuesta = _correo_texto(reply_correo, request.user) if reply_correo else ''
    etapa_sug, prob_sug, resumen = _update_draft_ia(
        opp, etapas, client_correo.asunto, cuerpo, respuesta)

    fecha_seg = _mas_dias_habiles(timezone.localdate(), 2)
    hora_seg = _hora_disponible(request.user, fecha_seg)

    return JsonResponse({
        'success': True,
        'correo_id': correo.id,
        'opp_id': opp.id,
        'opp_nombre': opp.oportunidad,
        'etapa_actual': opp.etapa_corta or '',
        'etapa_sugerida': etapa_sug or (opp.etapa_corta or ''),
        'prob_actual': opp.probabilidad_cierre or 0,
        'prob_sugerida': prob_sug,
        'resumen': resumen,
        'etapas': etapas,
        'remitente': (client_correo.remitente_nombre or client_correo.remitente_email or ''),
        'seg_fecha': fecha_seg.isoformat(),
        'seg_hora': '%02d:00' % hora_seg,
    })


@login_required
@require_http_methods(["POST"])
def api_asistente_oportunidad_update_aplicar(request):
    """POST — aplica la actualización aprobada: cambia etapa + probabilidad de la
    oportunidad y deja el resumen del correo en su conversación (bitácora)."""
    import json as _json
    from .models import TodoItem, EtapaPipeline, MensajeOportunidad, MailCorreo
    try:
        data = _json.loads(request.body or '{}')
    except Exception:
        data = {}
    try:
        opp = TodoItem.objects.get(id=data.get('opp_id'), usuario=request.user)
    except TodoItem.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Oportunidad no encontrada.'}, status=404)

    campos = []
    etapa = (data.get('etapa') or '').strip()
    if etapa and etapa != opp.etapa_corta:
        ep = EtapaPipeline.objects.filter(pipeline=opp.tipo_negociacion, nombre=etapa).first()
        opp.etapa_corta = etapa
        opp.etapa_completa = etapa
        if ep:
            opp.etapa_color = ep.color
        campos += ['etapa_corta', 'etapa_completa', 'etapa_color']
    try:
        prob = int(data.get('probabilidad'))
        prob = max(0, min(100, prob))
        if prob != opp.probabilidad_cierre:
            opp.probabilidad_cierre = prob
            campos.append('probabilidad_cierre')
    except Exception:
        pass
    if campos:
        opp.save(update_fields=list(set(campos)))
        try:
            from .views_automatizacion import ejecutar_automatizaciones
            if 'etapa_corta' in campos:
                ejecutar_automatizaciones(opp, opp.etapa_corta, request.user)
        except Exception:
            pass

    resumen = (data.get('resumen') or '').strip()
    if resumen:
        try:
            MensajeOportunidad.objects.create(
                oportunidad=opp, usuario=request.user,
                texto='📩 Resumen del correo (asistente): ' + resumen)
        except Exception:
            pass

    # Marcar el correo como atendido (ya lo procesaste actualizando la oportunidad).
    correo = MailCorreo.objects.filter(id=data.get('correo_id'), usuario=request.user).first()
    if correo:
        from .models import CorreoAtendido
        from django.utils import timezone
        CorreoAtendido.objects.get_or_create(
            usuario=request.user, mail=correo, defaults={'fecha': timezone.localdate()})

    # El asistente lo hace todo: además de actualizar, agenda EN SILENCIO un seguimiento
    # estándar (+2 días hábiles, primer hueco libre). Solo se le avisa por texto.
    seg = {'creado': False}
    if data.get('crear_seguimiento', True):
        from datetime import datetime, timedelta
        from django.utils import timezone
        from .models import Actividad
        try:
            f = data.get('seg_fecha') or _mas_dias_habiles(timezone.localdate(), 2).isoformat()
            h = data.get('seg_hora') or ('%02d:00' % _hora_disponible(request.user, _mas_dias_habiles(timezone.localdate(), 2)))
            y, mo, d = f.split('-')
            hh, mm = h.split(':')
            naive = datetime(int(y), int(mo), int(d), int(hh), int(mm))
            ini = timezone.make_aware(naive) if timezone.is_naive(naive) else naive
            act = Actividad.objects.create(
                titulo=('Seguimiento: %s' % (opp.oportunidad or ''))[:120].rstrip(': '),
                descripcion='Realizar seguimiento de ' + (opp.oportunidad or ''),
                tipo_actividad='tarea', fecha_inicio=ini, fecha_fin=ini + timedelta(hours=1),
                creado_por=request.user, color='#007AFF', oportunidad_id=opp.id,
                correo=correo,
            )
            act.participantes.set([request.user.id])
            _seg_espejo_expediente(request.user, opp, act)
            seg = {'creado': True, 'actividad_id': act.id, 'fecha': f, 'hora': h}
        except Exception as e:
            logger.exception('Asistente: no se pudo agendar seguimiento al actualizar: %s', e)
            seg = {'creado': False, 'error': str(e)}

    _asis_log_accion(request.user, 'actualizada', opp.oportunidad or 'Oportunidad',
                     ('Etapa: %s · %s%%' % (opp.etapa_corta, opp.probabilidad_cierre))
                     + (' · con seguimiento' if seg.get('creado') else ''),
                     mail=correo, opp=opp)
    return JsonResponse({'success': True, 'opp_id': opp.id, 'seguimiento': seg})


def _hora_disponible(user, fecha):
    """Primera hora libre dentro del horario laboral (L–V 8:00–18:00) en el
    calendario del usuario para esa fecha."""
    from django.db.models import Q
    from django.utils import timezone
    from .models import Actividad
    busy = set()
    acts = (Actividad.objects.filter(fecha_inicio__date=fecha)
            .filter(Q(creado_por=user) | Q(participantes=user)).distinct()
            .values_list('fecha_inicio', 'fecha_fin'))
    for ini, fin in acts:
        if not ini:
            continue
        h0 = timezone.localtime(ini).hour
        h1 = timezone.localtime(fin).hour if fin else h0 + 1
        for h in range(h0, max(h0 + 1, h1 + 1)):
            busy.add(h)
    for h in range(_HORA_LAB_INI, _HORA_LAB_FIN):
        if h not in busy:
            return h
    return _HORA_LAB_INI


@login_required
def api_asistente_seguimiento_draft(request, opp_id):
    """GET — borrador de actividad de seguimiento para una oportunidad (sin IA):
    sugiere +2 días a la primera hora libre del calendario."""
    from django.utils import timezone
    from datetime import timedelta
    from .models import TodoItem
    opp = TodoItem.objects.filter(id=opp_id).first()
    if not opp:
        return JsonResponse({'success': False, 'error': 'Oportunidad no encontrada.'}, status=404)
    fecha = _mas_dias_habiles(timezone.localdate(), 2)
    hora = _hora_disponible(request.user, fecha)
    return JsonResponse({
        'success': True,
        'opp_id': opp.id,
        'opp_nombre': opp.oportunidad,
        'titulo': ('Seguimiento: %s' % (opp.oportunidad or ''))[:120].rstrip(': '),
        'descripcion': 'Realizar seguimiento de ' + (opp.oportunidad or ''),
        'fecha': fecha.isoformat(),
        'hora': '%02d:00' % hora,
    })


@login_required
@require_http_methods(["POST"])
def api_asistente_seguimiento_crear(request):
    """POST — crea la actividad de seguimiento ligada a la oportunidad."""
    import json as _json
    from datetime import datetime, timedelta
    from django.utils import timezone
    from .models import TodoItem, Actividad
    try:
        data = _json.loads(request.body or '{}')
    except Exception:
        data = {}
    opp = TodoItem.objects.filter(id=data.get('opp_id')).first()
    if not opp:
        return JsonResponse({'success': False, 'error': 'Oportunidad no encontrada.'}, status=404)
    try:
        y, m, d = (data.get('fecha') or '').split('-')
        hh, mm = (data.get('hora') or '09:00').split(':')
        naive = datetime(int(y), int(m), int(d), int(hh), int(mm))
        ini = timezone.make_aware(naive) if timezone.is_naive(naive) else naive
    except Exception:
        ini = timezone.now() + timedelta(days=2)
    try:
        act = Actividad.objects.create(
            titulo=(data.get('titulo') or 'Seguimiento')[:200],
            descripcion=(data.get('descripcion') or ('Realizar seguimiento de ' + (opp.oportunidad or ''))),
            tipo_actividad='tarea', fecha_inicio=ini, fecha_fin=ini + timedelta(hours=1),
            creado_por=request.user, color='#007AFF', oportunidad_id=opp.id,
        )
        act.participantes.set([request.user.id])
        _seg_espejo_expediente(request.user, opp, act)
        _asis_log_accion(request.user, 'agendado', act.titulo,
                         'Para el %s' % timezone.localtime(ini).strftime('%d/%m %H:%M'), opp=opp)
        return JsonResponse({'success': True, 'opp_id': opp.id, 'actividad_id': act.id})
    except Exception as e:
        logger.exception('Asistente: no se pudo agendar seguimiento: %s', e)
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
def api_asistente_correo_cuerpo(request, correo_id):
    """Cuerpo de un correo para PREVISUALIZAR en el asistente SIN marcarlo como leído.
    Usa IMAP en modo readonly + BODY.PEEK (no toca la bandera \\Seen) y NO guarda nada
    en el modelo, para no interferir con la carga normal (adjuntos + marcar leído) que
    hace la sección Correo cuando el usuario lo abre de verdad.
    """
    import email as _email
    from .models import MailCorreo, MailConexion
    try:
        correo = MailCorreo.objects.get(id=correo_id, usuario=request.user)
    except MailCorreo.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'no encontrado'}, status=404)

    # Ya en caché (se abrió antes): devolverlo sin tocar nada.
    if correo.cuerpo_cargado:
        return JsonResponse({'ok': True, 'cuerpo_texto': correo.cuerpo_texto or '',
                             'cuerpo_html': correo.cuerpo_html or ''})

    texto, html = '', ''
    try:
        from .views_mail import _get_imap
        conexion = correo.conexion or MailConexion.objects.filter(usuario=request.user, activo=True).first()
        if not conexion:
            return JsonResponse({'ok': True, 'cuerpo_texto': '', 'cuerpo_html': ''})
        imap = _get_imap(conexion)
        imap.select(correo.carpeta_imap, readonly=True)     # readonly ⇒ NO marca \Seen
        typ, data = imap.uid('FETCH', correo.uid_imap.encode(), '(BODY.PEEK[])')
        raw = data[0][1] if (data and isinstance(data[0], tuple)) else None
        if raw:
            msg = _email.message_from_bytes(raw)
            for part in msg.walk():
                if part.get_filename():
                    continue
                ct = part.get_content_type()
                if ct == 'text/plain' and not texto:
                    cs = part.get_content_charset() or 'utf-8'
                    texto = (part.get_payload(decode=True) or b'').decode(cs, errors='replace')
                elif ct == 'text/html' and not html:
                    cs = part.get_content_charset() or 'utf-8'
                    html = (part.get_payload(decode=True) or b'').decode(cs, errors='replace')[:200000]
        try:
            imap.logout()
        except Exception:
            pass
    except Exception:
        return JsonResponse({'ok': True, 'cuerpo_texto': correo.cuerpo_texto or '',
                             'cuerpo_html': correo.cuerpo_html or ''})

    return JsonResponse({'ok': True, 'cuerpo_texto': texto, 'cuerpo_html': html})


# ══════════════════════ Sección Reportes · "Mi desempeño" ══════════════════════

_DES_MESES_L = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
_DES_MESES_A = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul',
                'ago', 'sep', 'oct', 'nov', 'dic']


def _desempeno_periodo(gran, ref):
    """(inicio, fin, etiqueta, meses) del período que contiene ref.
    meses = lista de (mes_int, anio) que cubre el dinero (mensual) del período."""
    import calendar
    from datetime import timedelta
    if gran == 'dia':
        return ref, ref, '%d de %s, %d' % (ref.day, _DES_MESES_L[ref.month], ref.year), [(ref.month, ref.year)]
    if gran == 'semana':
        start = ref - timedelta(days=ref.weekday())
        end = start + timedelta(days=6)
        if start.month == end.month:
            label = '%d–%d %s %d' % (start.day, end.day, _DES_MESES_A[start.month], start.year)
        else:
            label = '%d %s – %d %s %d' % (start.day, _DES_MESES_A[start.month],
                                          end.day, _DES_MESES_A[end.month], end.year)
        return start, end, label, [(start.month, start.year)]
    if gran == 'anio':
        return (ref.replace(month=1, day=1), ref.replace(month=12, day=31),
                '%d' % ref.year, [(m, ref.year) for m in range(1, 13)])
    # mes
    last = calendar.monthrange(ref.year, ref.month)[1]
    return (ref.replace(day=1), ref.replace(day=last),
            '%s %d' % (_DES_MESES_L[ref.month].capitalize(), ref.year), [(ref.month, ref.year)])


def _desempeno_params(request):
    """Resuelve (user_ids, es_global, gran, ref, today) desde el request.
    user_ids None = toda la empresa (supervisor global con 'todos')."""
    from django.utils import timezone
    from datetime import date
    user = request.user
    today = timezone.localdate()
    sel = (request.GET.get('vendedor', '') or '').strip().lower()
    gran = (request.GET.get('gran', 'mes') or 'mes').strip().lower()
    if gran not in ('dia', 'semana', 'mes', 'anio'):
        gran = 'mes'
    ref = today
    rs = (request.GET.get('ref', '') or '').strip()
    if rs:
        try:
            y, m, d = rs.split('-')
            ref = date(int(y), int(m), int(d))
        except Exception:
            ref = today
    if ref > today:
        ref = today
    visibles = get_usuarios_visibles_ids(user)   # None = supervisor global
    if sel == 'todos':
        user_ids = None if visibles is None else list(visibles)
        es_global = True
    elif sel.isdigit():
        tid = int(sel)
        user_ids = [tid] if (visibles is None or tid in visibles) else [user.id]
        es_global = False
    else:
        user_ids = [user.id]
        es_global = False
    return user_ids, es_global, gran, ref, today


def _desempeno_dinero(user_ids, meses):
    """(facturado, cobrado) sumando los meses dados [(mes_int, anio), ...]. Son datos
    mensuales (archivos admin): para un vendedor se suman sus clientes (match difuso por
    nombre); user_ids None (toda la empresa) usa el total del archivo directo."""
    from decimal import Decimal
    from .models import ArchivoFacturacion, ArchivoCobrado, Cliente
    objetivo = None
    if user_ids is not None:
        objetivo = [(nm or '').upper().strip() for _cid, nm in
                    Cliente.objects.filter(asignado_a_id__in=user_ids).values_list('id', 'nombre_empresa')]
        objetivo = [n for n in objetivo if n]

    def _match_sum(datos):
        total = Decimal('0')
        if not datos:
            return total
        for cname, monto in datos.items():
            cu = (cname or '').upper().strip()
            if not cu:
                continue
            if objetivo is None:
                try:
                    total += Decimal(str(monto))
                except Exception:
                    pass
                continue
            for nm in objetivo:
                if nm == cu or (len(nm) >= 4 and (nm in cu or cu in nm)):
                    try:
                        total += Decimal(str(monto))
                    except Exception:
                        pass
                    break
        return total

    fact = Decimal('0')
    cob = Decimal('0')
    for (m, a) in meses:
        ms = '%02d' % m
        af = ArchivoFacturacion.objects.filter(mes=ms, anio=a).first()
        ac = ArchivoCobrado.objects.filter(mes=ms, anio=a).first()
        if objetivo is None:
            fact += (af.total_facturado if af else Decimal('0'))
            cob += (ac.total_cobrado if ac else Decimal('0'))
        else:
            fact += _match_sum(af.datos_json if af else None)
            cob += _match_sum(ac.datos_json if ac else None)
    return fact, cob


def _desempeno_metricas(user_ids, start, end):
    """Conteos de actividad en el rango [start, end] para los vendedores dados
    (user_ids None = toda la empresa)."""
    from django.db.models import Q
    from .models import (TodoItem, Cliente, Tarea, Actividad, MailCorreo,
                         PendienteCompletada, TareaOportunidadHistorial,
                         TareaOportunidad, OportunidadActividad)

    opps = TodoItem.objects.all()
    if user_ids is not None:
        opps = opps.filter(usuario_id__in=user_ids)
    opp_ids = list(opps.values_list('id', flat=True))

    # Oportunidades trabajadas (distintas) — mismas señales que _pend_trabajadas_hoy.
    worked = set()
    if opp_ids:
        pc = PendienteCompletada.objects.filter(oportunidad_id__in=opp_ids, fecha__gte=start, fecha__lte=end)
        if user_ids is not None:
            pc = pc.filter(usuario_id__in=user_ids)
        worked |= set(pc.values_list('oportunidad_id', flat=True))
        worked |= set(TareaOportunidadHistorial.objects.filter(
            tipo='cerrada', tarea__oportunidad_id__in=opp_ids,
            fecha__date__gte=start, fecha__date__lte=end).values_list('tarea__oportunidad_id', flat=True))
        worked |= set(Actividad.objects.filter(
            oportunidad_id__in=opp_ids, completada=True,
            fecha_inicio__date__gte=start, fecha_inicio__date__lte=end).values_list('oportunidad_id', flat=True))
        worked |= set(TareaOportunidad.objects.filter(
            oportunidad_id__in=opp_ids,
            fecha_creacion__date__gte=start, fecha_creacion__date__lte=end).values_list('oportunidad_id', flat=True))
        worked |= set(OportunidadActividad.objects.filter(
            oportunidad_id__in=opp_ids,
            fecha_creacion__date__gte=start, fecha_creacion__date__lte=end).values_list('oportunidad_id', flat=True))

    correos_qs = MailCorreo.objects.filter(
        carpeta_display='SENT', eliminado=False,
        fecha_envio__date__gte=start, fecha_envio__date__lte=end)
    if user_ids is not None:
        correos_qs = correos_qs.filter(usuario_id__in=user_ids)

    nuevas = TodoItem.objects.filter(fecha_creacion__date__gte=start, fecha_creacion__date__lte=end)
    if user_ids is not None:
        nuevas = nuevas.filter(usuario_id__in=user_ids)

    tareas_qs = Tarea.objects.filter(
        estado='completada', fecha_completada__date__gte=start, fecha_completada__date__lte=end)
    if user_ids is not None:
        tareas_qs = tareas_qs.filter(asignado_a_id__in=user_ids)

    act_qs = Actividad.objects.filter(
        completada=True, fecha_inicio__date__gte=start, fecha_inicio__date__lte=end)
    if user_ids is not None:
        act_qs = act_qs.filter(Q(creado_por_id__in=user_ids) | Q(participantes__id__in=user_ids)).distinct()

    return {
        'opps_trabajadas': len(worked),
        'correos': correos_qs.count(),
        'clientes': nuevas.values('cliente').distinct().count(),
        'tareas': tareas_qs.count(),
        'actividades': act_qs.count(),
        'tiene_opps': bool(opp_ids),
        'tiene_clientes': (Cliente.objects.filter(asignado_a_id__in=user_ids).exists()
                           if user_ids is not None else True),
    }


def _desempeno_fmt(v):
    try:
        return '${:,.0f}'.format(float(v))
    except Exception:
        return '$0'


def _desempeno_paquete(request):
    """Calcula todo el desempeño para el request → dict con título, período, dinero,
    tiles y metadatos. Compartido por el endpoint JSON y el de exportación."""
    user_ids, es_global, gran, ref, today = _desempeno_params(request)
    start, end, plabel, meses = _desempeno_periodo(gran, ref)
    met = _desempeno_metricas(user_ids, start, end)
    facturado, cobrado = _desempeno_dinero(user_ids, meses)

    hay_negocio = met['tiene_opps'] or met['tiene_clientes'] or es_global
    tiles = []
    if met['tiene_opps'] or es_global:
        tiles.append({'key': 'opps', 'valor': met['opps_trabajadas'], 'label': 'Oportunidades trabajadas'})
    tiles.append({'key': 'correos', 'valor': met['correos'], 'label': 'Correos enviados'})
    if met['tiene_clientes'] or es_global:
        tiles.append({'key': 'clientes', 'valor': met['clientes'], 'label': 'Clientes con oportunidad nueva'})
    tiles.append({'key': 'tareas', 'valor': met['tareas'], 'label': 'Tareas cerradas'})
    tiles.append({'key': 'actividades', 'valor': met['actividades'], 'label': 'Actividades completadas'})

    # A quién corresponde el reporte (para la exportación).
    if es_global:
        quien = 'Toda la empresa'
    elif user_ids and len(user_ids) == 1:
        from django.contrib.auth.models import User as _User
        u = _User.objects.filter(id=user_ids[0]).first()
        quien = (u.get_full_name() or u.username) if u else ''
    else:
        quien = ''

    return {
        'titulo': ('Desempeño del equipo' if es_global else 'Tu desempeño'),
        'quien': quien,
        'gran': gran,
        'ref': ref.isoformat(),
        'periodo_label': plabel,
        'puede_avanzar': end < today,
        'dinero': {
            'mostrar': bool(hay_negocio),
            'facturado': float(facturado),
            'cobrado': float(cobrado),
            'facturado_fmt': _desempeno_fmt(facturado),
            'cobrado_fmt': _desempeno_fmt(cobrado),
        },
        'tiles': tiles,
    }


@login_required
def api_asistente_desempeno(request):
    """GET /app/api/asistente/desempeno/?vendedor=<id|todos|mias>&gran=<dia|semana|mes|anio>&ref=YYYY-MM-DD
    Mosaico de KPIs de desempeño. El hero facturado/cobrado es mensual (dato de archivos
    admin); los tiles de actividad responden al período elegido. Oculta métricas que no
    aplican al rol. `ref` fija el período a mostrar (default hoy)."""
    pkg = _desempeno_paquete(request)
    return JsonResponse({
        'success': True,
        'titulo': pkg['titulo'],
        'gran': pkg['gran'],
        'ref': pkg['ref'],
        'periodo_label': pkg['periodo_label'],
        'puede_avanzar': pkg['puede_avanzar'],
        'dinero': {
            'mostrar': pkg['dinero']['mostrar'],
            'facturado_fmt': pkg['dinero']['facturado_fmt'],
            'cobrado_fmt': pkg['dinero']['cobrado_fmt'],
        },
        'tiles': pkg['tiles'],
    })


@login_required
def api_asistente_desempeno_export(request):
    """GET .../desempeno/export/?formato=<xlsx|pdf>&... — descarga el desempeño como
    tabla Excel o PDF, respetando vendedor/período."""
    formato = (request.GET.get('formato', 'xlsx') or 'xlsx').strip().lower()
    pkg = _desempeno_paquete(request)

    filas = []
    if pkg['dinero']['mostrar']:
        filas.append(('Facturado', pkg['dinero']['facturado_fmt']))
        filas.append(('Cobrado', pkg['dinero']['cobrado_fmt']))
    for t in pkg['tiles']:
        filas.append((t['label'], t['valor']))

    titulo = pkg['titulo']
    quien = pkg['quien']
    periodo = pkg['periodo_label']
    base_name = 'desempeno_%s_%s' % (pkg['gran'], pkg['ref'])

    if formato == 'pdf':
        from django.utils.html import escape as _esc
        filas_html = ''.join(
            '<tr><td class="k">%s</td><td class="v">%s</td></tr>' % (_esc(str(k)), _esc(str(v)))
            for k, v in filas)
        html = (
            '<html><head><meta charset="utf-8"><style>'
            '@page{size:A4;margin:2cm;}'
            'body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1d22;}'
            'h1{font-size:22px;margin:0 0 2px;} .sub{color:#6b6d76;font-size:13px;margin-bottom:2px;}'
            '.per{color:#0a84ff;font-weight:700;font-size:13px;margin-bottom:18px;}'
            'table{width:100%;border-collapse:collapse;} '
            'td{padding:11px 6px;border-bottom:1px solid #eceef1;font-size:14px;} '
            'td.k{color:#4b5563;} td.v{text-align:right;font-weight:700;font-size:16px;} '
            '.foot{margin-top:24px;color:#9a9ca3;font-size:11px;}'
            '</style></head><body>'
            '<h1>%s</h1>'
            '<div class="sub">%s</div>'
            '<div class="per">%s</div>'
            '<table>%s</table>'
            '<div class="foot">Generado desde el CRM IAMET · La facturación y cobranza son del período mensual correspondiente.</div>'
            '</body></html>'
        ) % (_esc(titulo), _esc(quien), _esc(periodo), filas_html)
        from weasyprint import HTML
        pdf = HTML(string=html).write_pdf()
        resp = HttpResponse(pdf, content_type='application/pdf')
        resp['Content-Disposition'] = 'attachment; filename="%s.pdf"' % base_name
        return resp

    # Excel (xlsx)
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = 'Desempeño'
    ws['A1'] = titulo
    ws['A1'].font = Font(bold=True, size=14)
    ws['A2'] = quien
    ws['A2'].font = Font(color='6B6D76', size=11)
    ws['A3'] = periodo
    ws['A3'].font = Font(bold=True, color='0A84FF', size=11)
    hrow = 5
    ws.cell(row=hrow, column=1, value='Métrica').font = Font(bold=True, color='FFFFFF')
    ws.cell(row=hrow, column=2, value='Valor').font = Font(bold=True, color='FFFFFF')
    fill = PatternFill('solid', fgColor='0A84FF')
    ws.cell(row=hrow, column=1).fill = fill
    ws.cell(row=hrow, column=2).fill = fill
    for i, (k, v) in enumerate(filas, start=hrow + 1):
        ws.cell(row=i, column=1, value=str(k))
        c = ws.cell(row=i, column=2, value=v)
        c.alignment = Alignment(horizontal='right')
    ws.column_dimensions['A'].width = 34
    ws.column_dimensions['B'].width = 18
    import io
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    resp = HttpResponse(
        buf.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    resp['Content-Disposition'] = 'attachment; filename="%s.xlsx"' % base_name
    return resp


# ══════════════ Asistente proactivo · feed liviano para el launcher ══════════════

def _feed_correos_items(user, limite=6):
    """Correos importantes sin responder (BARATO: asunto/remitente, sin IMAP) como
    ítems para el mini-panel, con categoría y acciones por tipo."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import (MailConexion, MailCorreo, CorreoAtendido, TodoItem,
                         AvisoPospuesto, Actividad, AsistenteEstado)
    out = []
    if not MailConexion.objects.filter(usuario=user, activo=True).exists():
        return out
    now = timezone.now()
    cutoff = now - timedelta(hours=_COR_VENTANA_HORAS)
    inbox = list(MailCorreo.objects.filter(
        usuario=user, carpeta_display='INBOX', eliminado=False, archivado=False,
        fecha_envio__gte=cutoff).select_related('oportunidad').order_by('-fecha_envio')[:300])
    # Nota: no retornamos aunque INBOX esté vacío — el Caso 3-B (respondiste) se detecta
    # desde los ENVIADOS y debe correr igual.
    # Última respuesta (SENT) por hilo → "sin responder" = NO hay enviado posterior
    # al último correo recibido (aunque ya hubieras respondido antes en el hilo).
    hks = set(m.hilo_key for m in inbox if m.hilo_key)
    last_sent = {}
    if hks:
        for s in MailCorreo.objects.filter(usuario=user, carpeta_display='SENT',
                                            hilo_key__in=hks).values('hilo_key', 'fecha_envio'):
            f = s['fecha_envio']
            if not f:
                continue
            hk = s['hilo_key']
            if hk not in last_sent or f > last_sent[hk]:
                last_sent[hk] = f
    atendidos = set(CorreoAtendido.objects.filter(
        usuario=user, mail__in=[m.id for m in inbox]).values_list('mail_id', flat=True))
    known_emails, known_domains, cliente_nombres = _cor_conocidos()
    # "Mañana" del toast: avisos pospuestos siguen dormidos hasta su fecha.
    hoy = timezone.localdate()
    pospuestos = set(AvisoPospuesto.objects.filter(
        usuario=user, tipo='correo', hasta__gt=hoy).values_list('ref_id', flat=True))
    # ¿Cuántas veces ha insistido? = correos del hilo llegados DESPUÉS de tu última respuesta.
    insiste = {}
    for m in inbox:
        hk = m.hilo_key
        if not hk:
            continue
        ls = last_sent.get(hk)
        if not ls or (m.fecha_envio and m.fecha_envio > ls):
            insiste[hk] = insiste.get(hk, 0) + 1

    def _dias(m):
        return (timezone.localtime(now).date() - timezone.localtime(m.fecha_envio).date()).days if m.fecha_envio else 0

    def _base_item(m):
        remitente = (m.remitente_nombre or '').strip() or (m.remitente_email or '').split('@')[0]
        asunto = _cor_limpiar_asunto(m.asunto)
        dias = _dias(m)
        return {
            'tipo': 'correo', 'grupo': 'correo',
            'mail_id': m.id, 'titulo': remitente, 'desc': (asunto[:140] if asunto else 'Sin asunto'),
            'hace': (_cor_hace(timezone.localtime(m.fecha_envio), timezone.localtime(now)) if m.fecha_envio else ''),
            'dias_espera': dias, 'urgente': dias >= 2,
            # Cuerpo extendido para el nivel 2 del toast (clic = expandir en el lugar).
            'quote_full': _cor_extracto_parrafos(m.cuerpo_texto or '', limite=1400),
        }

    # ── Redacción del toast: titular-oración + línea de contexto + cita del correo ──
    _ORDINAL = {2: 'segunda', 3: 'tercera', 4: 'cuarta', 5: 'quinta'}

    def _asunto_corto(m):
        return _cor_limpiar_asunto(m.asunto)[:60]

    def _ctx_insiste(m):
        n = insiste.get(m.hilo_key or '', 0)
        if n >= 2:
            return 'Es la %s vez que te escribe sin respuesta.' % _ORDINAL.get(n, '%dª' % n)
        return ''

    def _ctx_opp(opp):
        if not opp:
            return ''
        etapa = (opp.etapa_corta or '').strip()
        try:
            monto = float(opp.monto or 0)
        except Exception:
            monto = 0
        if monto and etapa:
            return 'La oportunidad de ${:,.0f} sigue en {}.'.format(monto, etapa)
        if etapa:
            return 'La oportunidad sigue en %s.' % etapa
        return ''

    def _quote(m):
        return _cor_extracto(m.cuerpo_texto or '')

    sueltos = []      # correos NO ligados sin responder (candidatos a analizar)
    llego = []        # Caso 3-A: correos ligados que LLEGARON y aún no respondes
    seen_hk = set()
    for m in inbox:
        hk = m.hilo_key
        if hk:
            if hk in seen_hk:
                continue   # solo el correo más reciente de cada hilo
            seen_hk.add(hk)
        if m.id in atendidos or m.id in pospuestos:
            continue
        ls = last_sent.get(hk) if hk else None
        respondido = bool(ls and m.fecha_envio and ls >= m.fecha_envio)
        # ── Caso 3-A: correo LIGADO que llegó y aún NO respondes ──
        if m.oportunidad_id:
            if not respondido:
                llego.append(m)   # → responder / agendar seguimiento
            # Si YA respondiste, no se maneja aquí sino desde los ENVIADOS (Caso 3-B),
            # así aplica aunque el correo del cliente sea viejo o de la cola pasada.
            continue
        # ── Correos NO ligados ──
        if respondido:
            continue
        sueltos.append(m)

    # Análisis persistente (IA una vez por correo; ver _cor_asegurar_analisis).
    ana = _cor_asegurar_analisis(user, llego + sueltos,
                                 (known_emails, known_domains, cliente_nombres))

    scored = []       # (prio, m, analisis|None, motivos)
    for m in sueltos:
        a = ana.get(m.id)
        if a is not None:
            if a.categoria in ('ruido', 'info'):
                continue
            prio = 4 if a.categoria in ('venta', 'hito') else 3
            scored.append((prio, m, a, set()))
        else:
            # Sin análisis todavía (no alcanzó el cupo de IA) → reglas de siempre.
            score, motivos, _kw = _cor_score(m.remitente_email, m.asunto, m.cuerpo_texto,
                                             known_emails, known_domains, cliente_nombres)
            if score >= 3:
                scored.append((min(score, 4), m, None, motivos))

    # ── Caso 3-B: RESPONDISTE un correo ligado a una oportunidad ──
    # Se detecta desde los ENVIADOS (no desde INBOX): siempre que respondas un correo
    # de una oportunidad ligada —sin importar la antigüedad del correo del cliente— el
    # asistente ofrece actualizar. La oportunidad se resuelve POR HILO (el enviado casi
    # nunca trae el vínculo directo; lo hereda del correo del cliente en el mismo hilo).
    # Se calla si ya actualizaste la opp tras responder o si la oportunidad ya está cerrada.
    respondiste = []           # (m_card, opp, reply_dt)
    respondiste_sueltos = []   # (m_card, reply_dt) — Caso 3-C: respondiste sin oportunidad
    sent_recientes = list(MailCorreo.objects.filter(
        usuario=user, carpeta_display='SENT', fecha_envio__gte=cutoff)
        .order_by('-fecha_envio')[:200])
    s_hks = set(s.hilo_key for s in sent_recientes if s.hilo_key)
    if s_hks:
        # Oportunidad por hilo: cualquier correo (INBOX o SENT) ya ligado marca el hilo.
        opp_por_hilo = {}
        for c in (MailCorreo.objects.filter(
                usuario=user, oportunidad__isnull=False, hilo_key__in=s_hks)
                .values('hilo_key', 'oportunidad_id')):
            opp_por_hilo.setdefault(c['hilo_key'], c['oportunidad_id'])
        opp_ids = set(opp_por_hilo.values()) | set(s.oportunidad_id for s in sent_recientes if s.oportunidad_id)
        opps = {o.id: o for o in TodoItem.objects.filter(id__in=opp_ids)} if opp_ids else {}
        recibidos = {}
        for r in (MailCorreo.objects.filter(
                usuario=user, carpeta_display='INBOX', hilo_key__in=s_hks)
                .order_by('fecha_envio')):
            recibidos[r.hilo_key] = r          # el último recibido de cada hilo
        vistos_opp = set()
        cand, cand_ids = [], []
        for s in sent_recientes:
            opp_id = s.oportunidad_id or opp_por_hilo.get(s.hilo_key)
            if not opp_id or opp_id in vistos_opp:
                continue                        # una tarjeta por oportunidad (la respuesta más reciente)
            opp = opps.get(opp_id)
            if not opp or not _cli_abierta(opp.etapa_corta, opp.estado_crm):
                continue                        # sin opp o ya cerrada → no molestar
            vistos_opp.add(opp_id)
            if opp.fecha_actualizacion and s.fecha_envio and opp.fecha_actualizacion >= s.fecha_envio:
                continue                        # ya actualizaste la opp después de responder
            m_card = recibidos.get(s.hilo_key) or s
            cand.append((m_card, opp, s.fecha_envio))
            cand_ids.append(m_card.id)
        at_b = set(CorreoAtendido.objects.filter(
            usuario=user, mail_id__in=cand_ids).values_list('mail_id', flat=True)) if cand_ids else set()
        respondiste = [(mc, opp, rt) for (mc, opp, rt) in cand
                       if mc.id not in at_b and mc.id not in pospuestos]

        # ── Caso 3-C: RESPONDISTE un correo SUELTO (sin oportunidad ligada) ──
        # Mismo detector desde los ENVIADOS, pero en hilos sin oportunidad: al
        # responder, el asistente ofrece agendar un seguimiento para que la
        # conversación no se pierda. Se calla si ya hay un seguimiento agendado
        # sobre ese correo, si descartaste el aviso, o si el hilo no tiene correo
        # RECIBIDO (un correo que iniciaste tú no es una respuesta).
        # Arranque limpio: la oferta solo aplica a respuestas ENVIADAS después de
        # que el asistente se activó para este usuario (la marca se crea sola la
        # primera vez). Lo respondido antes del lanzamiento no genera tarjetas.
        estado_asis, _creado = AsistenteEstado.objects.get_or_create(usuario=user)
        vistos_hilo_c = set()
        cand_c = []
        for s in sent_recientes:
            hk = s.hilo_key
            if not hk or hk in vistos_hilo_c:
                continue
            vistos_hilo_c.add(hk)
            if not s.fecha_envio or s.fecha_envio < estado_asis.activado_en:
                continue                        # respondido antes de activar el asistente
            if s.oportunidad_id or opp_por_hilo.get(hk):
                continue                        # ligado a oportunidad → es del 3-B
            m_card = recibidos.get(hk)
            if m_card is None:
                continue                        # sin recibido en el hilo: no es respuesta
            if s.fecha_envio and m_card.fecha_envio and s.fecha_envio < m_card.fecha_envio:
                continue                        # te volvieron a escribir después → pendiente normal
            cand_c.append((m_card, s.fecha_envio))
        ids_c = [mc.id for mc, _ in cand_c]
        at_c = set(CorreoAtendido.objects.filter(
            usuario=user, mail_id__in=ids_c).values_list('mail_id', flat=True)) if ids_c else set()
        ya_agendados = set(Actividad.objects.filter(
            creado_por=user, correo_id__in=ids_c).values_list('correo_id', flat=True)) if ids_c else set()
        respondiste_sueltos = [
            (mc, rt) for (mc, rt) in cand_c
            if mc.id not in at_c and mc.id not in pospuestos and mc.id not in ya_agendados][:6]

    # Orden: lo que ACABA de llegar va primero (el asistente avisa en cuanto llega);
    # después pesa la urgencia (prioridad + días esperando). Sin el bono de frescura,
    # los correos viejos acumulan puntos y entierran al recién llegado (visto en pruebas).
    def _frescura(m):
        if not m.fecha_envio:
            return 0.0
        horas = (now - m.fecha_envio).total_seconds() / 3600.0
        return 3.0 if horas <= 4 else (1.0 if horas <= 24 else 0.0)

    scored.sort(key=lambda t: -(t[0] + min(_dias(t[1]), 7) * 0.4 + _frescura(t[1])))
    llego.sort(key=_dias)

    # 1) Respondiste un correo ligado → ACTUALIZAR (con contexto de ambos correos).
    for m_card, opp, reply_dt in respondiste:
        item = _base_item(m_card)
        if reply_dt:
            item['hace'] = _cor_hace(timezone.localtime(reply_dt), timezone.localtime(now))
        item['opp_id'] = opp.id
        item['opp_nombre'] = opp.oportunidad or ''
        item['categoria'] = 'Respondiste — ¿actualizo?'
        item['acciones'] = ['actualizar_oportunidad', 'agendar_seguimiento', 'no_importa']
        item['headline'] = 'Respondiste a %s sobre %s' % (item['titulo'], opp.oportunidad or 'una oportunidad')
        item['contexto'] = ('¿Actualizo la oportunidad con este intercambio? ' + _ctx_opp(opp)).strip()
        item['quote'] = _quote(m_card)
        out.append(item)

    # 1-bis) Respondiste un correo suelto → ofrecer AGENDAR seguimiento (Caso 3-C).
    for m_card, reply_dt in respondiste_sueltos:
        item = _base_item(m_card)
        if reply_dt:
            item['hace'] = _cor_hace(timezone.localtime(reply_dt), timezone.localtime(now))
        a_c = getattr(m_card, 'analisis', None)
        resumen_c = ((a_c.resumen if a_c else '') or '').strip()
        item['categoria'] = 'Respondiste — ¿agendo seguimiento?'
        item['acciones'] = ['agendar_correo', 'no_importa']
        item['headline'] = 'Respondiste a %s — ¿le agendo un seguimiento?' % item['titulo']
        item['contexto'] = (' '.join(x for x in [
            resumen_c, 'Así no se te pierde si no te contesta.'] if x)).strip()
        item['quote'] = _quote(m_card)
        out.append(item)

    # 2) Correo ligado que llegó y no respondes → RESPONDER / agendar seguimiento.
    #    Excepción: si es un HITO (factura / OC firmada / pago), ofrecer actualizar de una
    #    vez (con seguimiento), sin esperar a que respondas.
    for m in llego:
        item = _base_item(m)
        item['opp_id'] = m.oportunidad_id
        opp = m.oportunidad
        item['opp_nombre'] = (opp.oportunidad if opp else '')
        a = ana.get(m.id)
        resumen = (a.resumen if a else '') or ''
        # ¿Es hito? La IA manda cuando ya leyó el correo; si no, keywords.
        es_hito = (a.categoria == 'hito') if (a and a.fuente == 'ia') else _cor_es_hito(m.asunto, m.cuerpo_texto)
        if es_hito:
            item['categoria'] = 'Factura / orden recibida'
            item['acciones'] = ['actualizar_oportunidad', 'agendar_seguimiento', 'no_importa']
            item['headline'] = 'Llegó factura u orden sobre %s' % (item['opp_nombre'] or 'una oportunidad')
            item['contexto'] = (' '.join(x for x in [
                resumen, 'Buen momento para actualizarla.', _ctx_opp(opp)] if x)).strip()
        else:
            item['categoria'] = 'Correo de una oportunidad'
            item['acciones'] = ['responder', 'agendar_seguimiento', 'no_importa']
            item['headline'] = '%s te escribió sobre %s' % (item['titulo'], item['opp_nombre'] or 'una oportunidad')
            item['contexto'] = (' '.join(x for x in [resumen, _ctx_insiste(m), _ctx_opp(opp)] if x)).strip()
        item['quote'] = _quote(m)
        out.append(item)

    # 3) Correos no ligados (Caso 1) — el análisis manda: venta / hito / respuesta.
    for _prio, m, a, motivos in scored:
        if len(out) >= limite:
            break
        item = _base_item(m)
        dias = item['dias_espera']
        asunto_c = _asunto_corto(m)
        resumen = (a.resumen if a else '') or ''
        cat = a.categoria if a else ('venta' if 'negocio' in motivos else 'respuesta')
        if cat == 'venta':                   # posible venta nueva → crear oportunidad
            item['categoria'] = 'Posible venta nueva'
            item['acciones'] = ['crear_oportunidad', 'responder', 'no_importa']
            item['headline'] = '%s trae una posible venta' % item['titulo']
            item['contexto'] = (' '.join(x for x in [
                resumen or (('Escribió sobre «%s».' % asunto_c) if asunto_c else ''),
                _ctx_insiste(m)] if x)).strip()
        elif cat == 'hito':                  # factura/orden/pago SIN oportunidad ligada
            item['categoria'] = 'Factura / orden recibida'
            item['acciones'] = ['responder', 'no_importa']
            item['headline'] = '%s te envió una factura u orden' % item['titulo']
            item['contexto'] = (' '.join(x for x in [resumen, _ctx_insiste(m)] if x)).strip()
        else:                                # correo importante sin responder → responder
            item['categoria'] = ('Lleva %d días sin responder' % dias) if item['urgente'] else 'Correo sin responder'
            item['acciones'] = ['responder', 'no_importa']
            item['headline'] = '%s espera tu respuesta' % item['titulo'] + ((' sobre %s' % asunto_c) if asunto_c else '')
            item['contexto'] = (' '.join(x for x in [resumen, _ctx_insiste(m)] if x)).strip()
        item['quote'] = _quote(m)
        out.append(item)
    return out[:limite]


def _etapa_avance_map():
    """Mapa nombre-de-etapa normalizado → avance 0..1 (0 = inicio del pipeline,
    1 = a punto de cerrar). Usa EtapaPipeline.orden dentro de cada pipeline."""
    from .models import EtapaPipeline
    por_pipe = {}
    for e in EtapaPipeline.objects.filter(activo=True).values('pipeline', 'nombre', 'orden'):
        por_pipe.setdefault(e['pipeline'], []).append((e['nombre'], e['orden']))
    out = {}
    for etapas in por_pipe.values():
        mx = max((o for _, o in etapas), default=0) or 1
        for nombre, orden in etapas:
            k = (nombre or '').strip().lower()
            if k:
                out[k] = max(out.get(k, 0.0), orden / mx)   # si repite en 2 pipelines, el más avanzado
    return out


def _feed_opps_estancadas(user, today, dias_min=7, limite=6):
    """Oportunidades ABIERTAS del usuario sin movimiento en >= dias_min (usa
    fecha_actualizacion como 'última vez que se tocó'). Se excluyen las que ya
    tienen una actividad reciente o futura agendada (ya no están 'sin moverse').

    Prioridad (para recordar primero lo que más importa): MONTO alto + ETAPA
    avanzada pesan como criterio principal; la antigüedad pesa como criterio
    menor (pero levanta las rezagadas cuando no hay nada más urgente)."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import TodoItem, Actividad, AvisoPospuesto
    corte = timezone.now() - timedelta(days=dias_min)
    cand = [o for o in (TodoItem.objects.filter(usuario=user, fecha_actualizacion__lt=corte)
                        .select_related('cliente').order_by('fecha_actualizacion')[:80])
            if _cli_abierta(o.etapa_corta, o.estado_crm)]
    con_actividad = set()
    if cand:
        con_actividad = set(Actividad.objects.filter(
            oportunidad_id__in=[o.id for o in cand], fecha_inicio__gte=corte
        ).values_list('oportunidad_id', flat=True))
    pospuestos = set(AvisoPospuesto.objects.filter(
        usuario=user, tipo='oportunidad', hasta__gt=today).values_list('ref_id', flat=True))
    cand = [o for o in cand if o.id not in con_actividad and o.id not in pospuestos]
    if not cand:
        return []
    avance = _etapa_avance_map()
    max_monto = max((float(o.monto or 0) for o in cand), default=0) or 1.0
    ranked = []
    for o in cand:
        dias = (today - timezone.localtime(o.fecha_actualizacion).date()).days
        monto = float(o.monto or 0)
        m_norm = monto / max_monto                                  # 0..1
        e_norm = avance.get((o.etapa_corta or '').strip().lower(), 0.35)  # 0..1 (default medio)
        a_norm = min(dias / 30.0, 1.0)                              # 0..1 (antigüedad, tope 30 días)
        # Monto y etapa = principal (0.4 c/u); antigüedad = menor (0.2).
        prioridad = 0.4 * m_norm + 0.4 * e_norm + 0.2 * a_norm
        ranked.append((prioridad, dias, o))
    ranked.sort(key=lambda t: (-t[0], -t[1]))
    out = []
    for prioridad, dias, o in ranked[:limite]:
        cliente = (o.cliente.nombre_empresa if o.cliente else '') or ''
        etapa = (o.etapa_corta or 'Sin etapa')
        monto = o.monto or 0
        piezas = [cliente, etapa]
        if monto:
            piezas.append('${:,.0f}'.format(float(monto)))
        piezas.append('sin avance %d días' % dias)
        out.append({
            'tipo': 'oportunidad', 'grupo': 'pipeline', 'categoria': 'Sin moverse',
            'opp_id': o.id, 'titulo': o.oportunidad or 'Oportunidad',
            'desc': ' · '.join([p for p in piezas if p]),
            'hace': '%d días' % dias, 'dias': dias,
            'acciones': ['agendar', 'abrir', 'no_importa'],
            'headline': '%s lleva %d días sin moverse' % (o.oportunidad or 'Una oportunidad', dias),
            'contexto': (' · '.join([p for p in [cliente, etapa, ('${:,.0f}'.format(float(monto)) if monto else '')] if p])),
        })
    return out


@login_required
def api_asistente_feed(request):
    """GET /app/api/asistente/feed/ — feed proactivo del asistente reducido: lo importante
    que necesita atención AHORA (correos importantes sin responder + oportunidades sin
    avance). 100% código, apto para sondeo. Devuelve resumen corto (launcher), brief
    (saludo del mini-panel), conteos por grupo e ítems con acciones."""
    from django.utils import timezone
    user = request.user
    now = timezone.now()
    today = timezone.localdate()

    correos_items = _feed_correos_items(user)
    opps_items = _feed_opps_estancadas(user, today)
    n_cor, n_opp = len(correos_items), len(opps_items)
    total = n_cor + n_opp

    # Caso 2: si el usuario tiene un rato libre AHORA (horario laboral, sin junta),
    # es buen momento para atender la oportunidad clave (la primera, ya rankeada por
    # monto + etapa avanzada). La elevamos con un marco de "aprovecha este hueco".
    libre, hasta = _hueco_libre_ahora(user, now)
    hueco = {'libre': bool(libre)}
    if libre and opps_items:
        top = opps_items[0]
        hasta_txt = ('%02d:00' % hasta) if hasta else 'fin del día'
        top['categoria'] = 'Buen momento — libre hasta las %s' % hasta_txt
        top['hueco'] = True
        hueco['hasta'] = hasta_txt
        hueco['opp'] = top.get('titulo', '')

    nombre = (user.first_name or '').strip() or (user.get_full_name() or user.username or '').split(' ')[0]
    hora = timezone.localtime().hour
    saludo = 'Buenos días' if hora < 12 else ('Buenas tardes' if hora < 19 else 'Buenas noches')

    partes = []
    if n_cor:
        partes.append('%d correo%s importante%s sin responder' % (
            n_cor, '' if n_cor == 1 else 's', '' if n_cor == 1 else 's'))
    if n_opp:
        partes.append('%d oportunidad%s sin avance' % (n_opp, '' if n_opp == 1 else 'es'))

    if partes:
        cuerpo = ' y '.join(partes)
        resumen = (('%s, ' % nombre) if nombre else '') + cuerpo + '.'
        resumen = resumen[0].upper() + resumen[1:]
        brief = '%s%s. Revisé tu correo y tu pipeline: %s. Lo demás puede esperar.' % (
            saludo, (', ' + nombre) if nombre else '', cuerpo)
        if libre and opps_items:
            brief += ' Tienes un rato libre hasta las %s: buen momento para mover «%s».' % (
                hueco.get('hasta', 'el fin del día'), hueco.get('opp', ''))
    else:
        resumen = 'Todo bajo control%s. Te aviso si algo necesita tu atención.' % (
            (', ' + nombre) if nombre else '')
        brief = '%s%s. Revisé tu correo y tu pipeline y no hay nada urgente por ahora. Sigue así.' % (
            saludo, (', ' + nombre) if nombre else '')

    return JsonResponse({
        'success': True,
        'total': total,
        'correos': n_cor,
        'pipeline': n_opp,
        'resumen': resumen,
        'brief': brief,
        'hueco': hueco,
        'items': correos_items + opps_items,
    })


@login_required
@require_http_methods(["POST"])
def api_asistente_aviso_posponer(request):
    """POST — "Mañana" del toast: pospone el aviso al siguiente día HÁBIL.
    A diferencia de "No importa" (descarte), esto es un snooze honesto: vuelve."""
    import json as _json
    from django.utils import timezone
    from .models import AvisoPospuesto
    try:
        data = _json.loads(request.body or '{}')
    except Exception:
        data = {}
    tipo = data.get('tipo')
    ref_id = data.get('ref_id')
    if tipo not in ('correo', 'oportunidad') or not ref_id:
        return JsonResponse({'success': False, 'error': 'tipo/ref_id inválidos'}, status=400)
    hasta = _mas_dias_habiles(timezone.localdate(), 1)
    AvisoPospuesto.objects.update_or_create(
        usuario=request.user, tipo=tipo, ref_id=int(ref_id), defaults={'hasta': hasta})
    return JsonResponse({'success': True, 'hasta': hasta.isoformat()})


@login_required
@require_http_methods(["POST"])
def api_asistente_aviso_agendar(request):
    """POST — "Agendar" del toast: crea DIRECTO (sin formularios) una actividad de
    seguimiento a +2 días hábiles en el primer hueco libre, y silencia el aviso hasta
    ese día (si sigue pendiente, vuelve justo cuando toca darle seguimiento)."""
    import json as _json
    from datetime import datetime, timedelta
    from django.utils import timezone
    from .models import AvisoPospuesto, MailCorreo, TodoItem, Actividad
    try:
        data = _json.loads(request.body or '{}')
    except Exception:
        data = {}
    tipo = data.get('tipo')
    ref_id = data.get('ref_id')
    if tipo not in ('correo', 'oportunidad') or not ref_id:
        return JsonResponse({'success': False, 'error': 'tipo/ref_id inválidos'}, status=400)
    fecha = _mas_dias_habiles(timezone.localdate(), 2)
    hora = _hora_disponible(request.user, fecha)
    opp, m = None, None
    if tipo == 'correo':
        m = MailCorreo.objects.filter(id=ref_id, usuario=request.user).select_related('oportunidad').first()
        if not m:
            return JsonResponse({'success': False, 'error': 'Correo no encontrado.'}, status=404)
        opp = m.oportunidad
        rem = (m.remitente_nombre or m.remitente_email or '').strip()
        asunto_l = _cor_limpiar_asunto(m.asunto or '') or 'correo sin asunto'
        titulo_act = ('Seguimiento: %s' % asunto_l)[:120]
        desc = ('Dar seguimiento al correo de %s: %s' % (rem, (m.asunto or '').strip()))[:500]
    else:
        opp = TodoItem.objects.filter(id=ref_id).first()
        if not opp:
            return JsonResponse({'success': False, 'error': 'Oportunidad no encontrada.'}, status=404)
        titulo_act = ('Seguimiento: %s' % (opp.oportunidad or 'oportunidad'))[:120]
        desc = 'Realizar seguimiento de ' + (opp.oportunidad or '')
    try:
        naive = datetime(fecha.year, fecha.month, fecha.day, hora, 0)
        ini = timezone.make_aware(naive) if timezone.is_naive(naive) else naive
        act = Actividad.objects.create(
            titulo=titulo_act, descripcion=desc, tipo_actividad='tarea',
            fecha_inicio=ini, fecha_fin=ini + timedelta(hours=1),
            creado_por=request.user, color='#007AFF',
            oportunidad_id=(opp.id if opp else None),
            correo=m,
        )
        act.participantes.set([request.user.id])
        _seg_espejo_expediente(request.user, opp, act)
    except Exception as e:
        logger.exception('Asistente: no se pudo agendar desde el toast: %s', e)
        return JsonResponse({'success': False, 'error': str(e)}, status=500)
    AvisoPospuesto.objects.update_or_create(
        usuario=request.user, tipo=tipo, ref_id=int(ref_id), defaults={'hasta': fecha})
    _asis_log_accion(request.user, 'agendado', titulo_act,
                     'Para el %s a las %02d:00' % (fecha.strftime('%d/%m'), hora),
                     mail=m, opp=opp)
    return JsonResponse({'success': True, 'actividad_id': act.id,
                         'fecha': fecha.isoformat(), 'hora': '%02d:00' % hora})


@login_required
@require_http_methods(["POST"])
def api_asistente_aviso_revisado(request):
    """POST — "Revisado" del toast: el usuario ya lo vio y no quiere ninguna acción.
    Correos: descarte definitivo (CorreoAtendido). Oportunidades: se silencia una
    semana hábil (la opp sigue abierta; si sigue estancada, reaparece)."""
    import json as _json
    from django.utils import timezone
    from .models import AvisoPospuesto, MailCorreo, CorreoAtendido, TodoItem
    try:
        data = _json.loads(request.body or '{}')
    except Exception:
        data = {}
    tipo = data.get('tipo')
    ref_id = data.get('ref_id')
    if tipo not in ('correo', 'oportunidad') or not ref_id:
        return JsonResponse({'success': False, 'error': 'tipo/ref_id inválidos'}, status=400)
    if tipo == 'correo':
        m = MailCorreo.objects.filter(id=ref_id, usuario=request.user).first()
        if not m:
            return JsonResponse({'success': False, 'error': 'Correo no encontrado.'}, status=404)
        CorreoAtendido.objects.get_or_create(
            usuario=request.user, mail=m, defaults={'fecha': timezone.localdate()})
        _asis_log_accion(request.user, 'revisado',
                         _cor_limpiar_asunto(m.asunto or '') or (m.remitente_nombre or m.remitente_email or 'Correo'),
                         'De %s' % (m.remitente_nombre or m.remitente_email or ''), mail=m)
    else:
        opp_r = TodoItem.objects.filter(id=ref_id).first()
        AvisoPospuesto.objects.update_or_create(
            usuario=request.user, tipo='oportunidad', ref_id=int(ref_id),
            defaults={'hasta': _mas_dias_habiles(timezone.localdate(), 5)})
        if opp_r:
            _asis_log_accion(request.user, 'revisado', opp_r.oportunidad or 'Oportunidad',
                             'Silenciada una semana', opp=opp_r)
    return JsonResponse({'success': True})


@login_required
def api_asistente_atendidos(request):
    """GET — pestaña "Atendido" del asistente: lo que ya atendiste HOY.

    La jornada corre de 8am a 8am: a las 8 de la mañana la pestaña amanece
    vacía y va acumulando el día en curso (las filas viejas se conservan en
    BD como historial, solo se deja de mostrarlas). Además de la bitácora,
    los correos que RESPONDISTE se detectan solos desde los enviados."""
    import json as _json
    from datetime import timedelta
    from django.utils import timezone
    from .models import AsistenteAccion, MailCorreo
    now = timezone.localtime()
    ini_dia = now.replace(hour=8, minute=0, second=0, microsecond=0)
    if now.hour < 8:
        ini_dia -= timedelta(days=1)

    _ETIQUETAS = {'respondido': 'Respondiste', 'agendado': 'Agendaste seguimiento',
                  'oportunidad': 'Creaste oportunidad', 'actualizada': 'Actualizaste oportunidad',
                  'revisado': 'Marcaste revisado'}
    items = []
    for a in (AsistenteAccion.objects.filter(usuario=request.user, created_at__gte=ini_dia)
              .order_by('-created_at')[:100]):
        t = timezone.localtime(a.created_at)
        items.append({
            'accion': a.accion, 'etiqueta': _ETIQUETAS.get(a.accion, a.accion),
            'titulo': a.titulo, 'detalle': a.detalle,
            'hora': t.strftime('%H:%M'), 'ts': t.isoformat(),
            'mail_id': a.mail_id, 'opp_id': a.oportunidad_id,
        })

    # Respondidos: cada enviado de la jornada cuenta como correo atendido,
    # sin importar desde dónde lo hayas contestado (asistente o Correo).
    for s in (MailCorreo.objects.filter(
            usuario=request.user, carpeta_display='SENT', fecha_envio__gte=ini_dia)
            .order_by('-fecha_envio')[:60]):
        dest = ''
        try:
            lst = _json.loads(s.destinatarios_json or '[]')
            dest = (lst[0] if isinstance(lst, list) and lst else '') or ''
            if isinstance(dest, dict):
                dest = dest.get('email') or dest.get('nombre') or ''
        except Exception:
            dest = ''
        t = timezone.localtime(s.fecha_envio)
        items.append({
            'accion': 'respondido', 'etiqueta': 'Respondiste',
            'titulo': _cor_limpiar_asunto(s.asunto or '') or 'Correo sin asunto',
            'detalle': ('A %s' % dest) if dest else '',
            'hora': t.strftime('%H:%M'), 'ts': t.isoformat(),
            'mail_id': s.id, 'opp_id': s.oportunidad_id,
        })

    items.sort(key=lambda x: x['ts'], reverse=True)
    return JsonResponse({'success': True, 'items': items, 'total': len(items),
                         'desde': timezone.localtime(ini_dia).strftime('%d/%m %H:%M')})


@login_required
def api_pendientes_estado(request):
    """Ligero: dado ?ids=1,2,3 devuelve qué oportunidades se trabajaron HOY.
    Sirve para refrescar el widget en el momento (sin recargar todo ni la IA)
    cuando el usuario completa una oportunidad desde el detalle."""
    from django.utils import timezone
    ids = [int(x) for x in request.GET.get('ids', '').split(',') if x.strip().isdigit()]
    worked = _pend_trabajadas_hoy(ids, timezone.localdate(), request.user) if ids else set()
    return JsonResponse({'success': True, 'worked_ids': sorted(worked)})


@login_required
@require_http_methods(["POST"])
def api_pendientes_completar(request):
    """Marca/desmarca manualmente una oportunidad como trabajada HOY (por usuario)."""
    import json as _json
    from django.utils import timezone
    from .models import TodoItem, PendienteCompletada
    try:
        data = _json.loads(request.body or b'{}')
    except (ValueError, TypeError):
        return JsonResponse({'success': False, 'error': 'JSON inválido'}, status=400)
    opp_id = data.get('opp_id')
    done = bool(data.get('done', True))
    if not opp_id or not TodoItem.objects.filter(id=opp_id).exists():
        return JsonResponse({'success': False, 'error': 'Oportunidad no encontrada'}, status=404)
    today = timezone.localdate()
    if done:
        PendienteCompletada.objects.get_or_create(usuario=request.user, oportunidad_id=opp_id, fecha=today)
    else:
        PendienteCompletada.objects.filter(usuario=request.user, oportunidad_id=opp_id, fecha=today).delete()
    return JsonResponse({'success': True, 'opp_id': opp_id, 'done': done})


# ═══════════════════════════════════════════════════════════════════════════
# REPLAY MENSUAL (tipo Wrapped) — recap del mes anterior, 1 vez al mes
# ═══════════════════════════════════════════════════════════════════════════

_MESES_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
             'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']


def _replay_money(v):
    try:
        return '${:,.0f}'.format(float(v or 0))
    except (ValueError, TypeError):
        return '$0'


def _replay_stats(user, mes, anio):
    """Todas las métricas del mes (usuario, mes, anio) para el Replay."""
    from django.db.models import Count, Sum, Q, Value, DecimalField
    from django.db.models.functions import Coalesce
    from decimal import Decimal
    from .models import (TodoItem, Cotizacion, EficienciaMensual, AsistenciaJornada,
                         TareaOportunidadHistorial, Tarea, Actividad)

    def _sum(qs, field):
        return qs.aggregate(s=Coalesce(Sum(field), Value(Decimal('0'), output_field=DecimalField())))['s']

    em = EficienciaMensual.objects.filter(usuario=user, mes=mes, anio=anio).first()
    ef = float(em.promedio_eficiencia) if em else 0.0
    empleado_mes = bool(em.empleado_del_mes) if em else False
    pmes, panio = (12, anio - 1) if mes == 1 else (mes - 1, anio)
    em_prev = EficienciaMensual.objects.filter(usuario=user, mes=pmes, anio=panio).first()
    ef_prev = float(em_prev.promedio_eficiencia) if em_prev else None

    ventas = TodoItem.objects.filter(
        usuario=user, fecha_actualizacion__month=mes, fecha_actualizacion__year=anio
    ).filter(Q(etapa_corta__in=['Ganado', 'Pagado']) | Q(estado_crm='pagada'))
    ventas_count = ventas.count()
    monto_vendido = _sum(ventas, 'monto')

    trabajadas = TodoItem.objects.filter(
        usuario=user, fecha_actualizacion__month=mes, fecha_actualizacion__year=anio
    ).count()

    cot = Cotizacion.objects.filter(created_by=user, fecha_creacion__month=mes, fecha_creacion__year=anio)
    cot_count = cot.count()
    cot_monto = _sum(cot, 'total')

    tareas_opp = TareaOportunidadHistorial.objects.filter(
        autor=user, tipo='cerrada', fecha__month=mes, fecha__year=anio
    ).values('tarea_id').distinct().count()
    tareas_proy = Tarea.objects.filter(
        asignado_a=user, estado='completada', fecha_completada__month=mes, fecha_completada__year=anio
    ).count()
    actividades = Actividad.objects.filter(
        creado_por=user, completada=True, fecha_inicio__month=mes, fecha_inicio__year=anio
    ).count()

    jornadas = AsistenciaJornada.objects.filter(
        usuario=user, fecha__month=mes, fecha__year=anio, hora_fin__isnull=False
    )
    dias_trabajados = jornadas.count()
    mejor = jornadas.order_by('-eficiencia_dia').first()
    mejor_dia = None
    if mejor and mejor.eficiencia_dia:
        mejor_dia = {'dia': mejor.fecha.day, 'eficiencia': float(mejor.eficiencia_dia)}
    top = (ventas.values('cliente__nombre_empresa')
           .annotate(t=Sum('monto'), c=Count('id')).order_by('-t').first())
    top_cliente = None
    if top and top.get('cliente__nombre_empresa'):
        top_cliente = {'nombre': top['cliente__nombre_empresa'], 'total_fmt': _replay_money(top['t']), 'count': top['c']}

    # Tendencias vs mes anterior (ventas y eficiencia)
    mes_prev_nombre = _MESES_ES[pmes]
    ventas_prev = TodoItem.objects.filter(
        usuario=user, fecha_actualizacion__month=pmes, fecha_actualizacion__year=panio
    ).filter(Q(etapa_corta__in=['Ganado', 'Pagado']) | Q(estado_crm='pagada'))
    monto_prev = _sum(ventas_prev, 'monto')

    def _trend(cur, prev):
        try:
            cur, prev = float(cur or 0), float(prev or 0)
        except (ValueError, TypeError):
            return ''
        if prev <= 0:
            return ''
        pct = round((cur - prev) / prev * 100)
        if pct == 0:
            return ''
        return ('▲ +' if pct > 0 else '▼ ') + str(pct) + '% vs ' + mes_prev_nombre.lower()

    return {
        'mes': mes, 'anio': anio, 'mes_nombre': _MESES_ES[mes], 'mes_prev_nombre': mes_prev_nombre,
        'eficiencia': round(ef, 1), 'eficiencia_prev': (round(ef_prev, 1) if ef_prev is not None else None),
        'eficiencia_trend': _trend(ef, ef_prev), 'ventas_trend': _trend(monto_vendido, monto_prev),
        'empleado_mes': empleado_mes,
        'ventas': ventas_count, 'monto_vendido_fmt': _replay_money(monto_vendido),
        'trabajadas': trabajadas,
        'cotizaciones': cot_count, 'cotizaciones_monto_fmt': _replay_money(cot_monto),
        'tareas': tareas_opp + tareas_proy, 'actividades': actividades,
        'dias_trabajados': dias_trabajados, 'mejor_dia': mejor_dia, 'top_cliente': top_cliente,
    }


def _replay_ia_msgs(nombre, stats):
    """Mensajes personalizados por tarjeta (asistente). Devuelve dict {clave: texto}."""
    try:
        from .asistente_provider import chat
        from .models import AsistenteConfig
    except Exception:
        return {}
    try:
        cfg = AsistenteConfig.get_singleton()
        if cfg and not cfg.activo:
            return {}
        modelo = cfg.modelo if cfg else None
    except Exception:
        modelo = None
    import json as _json
    sys = (
        "Eres el asistente del CRM. Redactas los TITULARES de un 'Replay mensual' estilo "
        f"Spotify Wrapped para {nombre}, sobre su mes de {stats.get('mes_nombre')}. Con base "
        "EXCLUSIVAMENTE en los datos, escribe TÍTULOS cortos y con gancho (estilo editorial de "
        "revista, 3-8 palabras, sin comillas), en español, tuteando. Devuelve SOLO JSON con "
        "estas claves (cada valor un string):\n"
        "'intro' (titular del mes, ej. 'Un junio lleno de oportunidades'), 'eficiencia', "
        "'ventas', 'cotizaciones', 'actividades', 'curioso' (usa mejor_dia/top_cliente/"
        "dias_trabajados), 'cierre' (motivador para el mes que empieza). NO inventes números "
        "ni nombres que no estén en los datos."
    )
    usr = "Datos del mes (JSON):\n" + _json.dumps(stats, ensure_ascii=False)
    try:
        res = chat([{'role': 'system', 'content': sys}, {'role': 'user', 'content': usr}],
                   model=modelo, temperature=0.7, max_tokens=1000)
        txt = ((res or {}).get('text') or '').strip()
        a, b = txt.find('{'), txt.rfind('}')
        if a == -1 or b == -1:
            return {}
        parsed = _json.loads(txt[a:b + 1])
        return {k: v for k, v in parsed.items() if isinstance(v, str)}
    except Exception as exc:
        logger.warning(f"[Replay] IA no disponible: {exc}")
        return {}


def _replay_build_cards(s, m):
    def hd(key, fb):
        return (m.get(key) or fb).strip()
    mesL = s['mes_nombre'].lower()
    cards = []
    # 1) Portada / resumen general
    cards.append({
        'theme': 0, 'kicker': 'Resumen del mes',
        'headline': hd('intro', 'Un ' + mesL + ' lleno de oportunidades.'),
        'badge': ('🏆 Empleado del mes' if s['empleado_mes'] else ''),
        'hero_label': 'Vendido este mes', 'hero_stat': s['monto_vendido_fmt'], 'hero_trend': s.get('ventas_trend', ''),
        'boxes': [
            {'v': str(s['ventas']), 'l': 'Oportunidades ganadas'},
            {'v': str(s['eficiencia']) + '%', 'l': 'Eficiencia'},
            {'v': str(s['tareas']), 'l': 'Tareas completadas'},
        ],
    })
    # 2) Eficiencia
    cards.append({
        'theme': 1, 'kicker': 'Tu eficiencia',
        'headline': hd('eficiencia', 'Tu constancia, en un número.'),
        'hero_label': 'Eficiencia del mes', 'hero_stat': str(s['eficiencia']) + '%', 'hero_trend': s.get('eficiencia_trend', ''),
        'boxes': ([{'v': 'Día ' + str(s['mejor_dia']['dia']), 'l': 'Tu mejor día · ' + str(s['mejor_dia']['eficiencia']) + '%'}] if s['mejor_dia'] else []),
    })
    # 3) Ventas
    v_boxes = [{'v': s['monto_vendido_fmt'], 'l': 'Monto vendido'}]
    if s['top_cliente']:
        v_boxes.append({'v': s['top_cliente']['nombre'], 'l': 'Cliente estrella · ' + s['top_cliente']['total_fmt']})
    cards.append({
        'theme': 2, 'kicker': 'Ventas', 'headline': hd('ventas', 'Cada cierre cuenta.'),
        'hero_label': 'Oportunidades cerradas', 'hero_stat': str(s['ventas']), 'hero_trend': '',
        'boxes': v_boxes,
    })
    # 4) Cotizaciones
    cards.append({
        'theme': 3, 'kicker': 'Cotizaciones', 'headline': hd('cotizaciones', 'Sembrando oportunidades.'),
        'hero_label': 'Cotizaciones hechas', 'hero_stat': str(s['cotizaciones']), 'hero_trend': '',
        'boxes': [{'v': s['cotizaciones_monto_fmt'], 'l': 'Monto cotizado'}],
    })
    # 5) Productividad
    cards.append({
        'theme': 4, 'kicker': 'Productividad', 'headline': hd('actividades', 'Constancia que se nota.'),
        'hero_label': 'Tareas y actividades', 'hero_stat': str(s['tareas'] + s['actividades']), 'hero_trend': '',
        'boxes': [
            {'v': str(s['tareas']), 'l': 'Tareas'},
            {'v': str(s['actividades']), 'l': 'Actividades'},
            {'v': str(s['dias_trabajados']), 'l': 'Días activos'},
        ],
    })
    # 6) Dato curioso
    if s['top_cliente']:
        cur_l, cur_v = 'Tu cliente estrella', s['top_cliente']['nombre']
    elif s['mejor_dia']:
        cur_l, cur_v = 'Tu mejor día', 'Día ' + str(s['mejor_dia']['dia'])
    else:
        cur_l, cur_v = 'Días activos', str(s['dias_trabajados'])
    cards.append({
        'theme': 5, 'kicker': 'Dato del mes', 'headline': hd('curioso', '¡Un logro para presumir!'),
        'hero_label': cur_l, 'hero_stat': cur_v, 'hero_trend': '', 'boxes': [],
    })
    # 7) Cierre
    cards.append({
        'theme': 6, 'kicker': '¡A por más!',
        'headline': hd('cierre', s['mes_nombre'] + ' quedó atrás. Este mes vas por más.'),
        'hero_label': '', 'hero_stat': '', 'hero_trend': '', 'boxes': [],
    })
    return cards


@login_required
def api_pendientes_replay(request):
    """Replay mensual (Wrapped) del MES ANTERIOR. Cacheado 1 vez por mes."""
    from django.utils import timezone
    from .models import ReplayMensual
    _VER = 3   # subir si cambia la estructura de las tarjetas → regenera el caché
    today = timezone.localdate()
    # Por defecto el mes anterior; o el mes pedido (?mes=&anio=) si es ANTERIOR al actual.
    mes, anio = (12, today.year - 1) if today.month == 1 else (today.month - 1, today.year)
    try:
        qmes, qanio = int(request.GET.get('mes', 0)), int(request.GET.get('anio', 0))
        if 1 <= qmes <= 12 and qanio >= 2000 and (qanio, qmes) < (today.year, today.month):
            mes, anio = qmes, qanio
    except (ValueError, TypeError):
        pass
    row = ReplayMensual.objects.filter(usuario=request.user, mes=mes, anio=anio).first()
    if row and row.data and row.data.get('_ver') == _VER:
        return JsonResponse({'success': True, **row.data})
    stats = _replay_stats(request.user, mes, anio)
    nombre = request.user.first_name or (request.user.get_full_name() or request.user.username).split(' ')[0]
    msgs = _replay_ia_msgs(nombre, stats)
    data = {
        '_ver': _VER, 'mes_nombre': stats['mes_nombre'], 'anio': anio, 'nombre': nombre,
        'cards': _replay_build_cards(stats, msgs),
    }
    try:
        ReplayMensual.objects.update_or_create(usuario=request.user, mes=mes, anio=anio, defaults={'data': data})
    except Exception:
        pass
    return JsonResponse({'success': True, **data})


# ═══════════════════════════════════════════════════════════════════════════════
# SIMULADOR DE CORREOS — banco de pruebas del asistente (solo datos del usuario).
# Inyecta correos realistas directo a MailCorreo (sin IMAP) para probar los 4
# casos del asistente y ver el veredicto del análisis en vivo. Los correos usan
# el dominio simulacion.iamet; api_mail_responder NO manda SMTP a ese dominio.
# Limpieza total con un botón. Nada de esto toca correos reales.
# ═══════════════════════════════════════════════════════════════════════════════

_SIM_DOMINIO = 'simulacion.iamet'   # mismo literal en views_mail.api_mail_responder


def _sim_cliente(user):
    """Cliente demo (remitente 'conocido' para el análisis). Se crea una vez."""
    from .models import Cliente
    c = Cliente.objects.filter(nombre_empresa='[DEMO] Aceros del Norte').first()
    if not c:
        c = Cliente.objects.create(
            nombre_empresa='[DEMO] Aceros del Norte', asignado_a=user,
            email='compras@%s' % _SIM_DOMINIO)
    return c


def _sim_correo(user, nombre, email, asunto, cuerpo, opp=None, minutos_atras=0):
    """Inyecta un correo 'recibido' con cuerpo listo (no requiere IMAP)."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import MailCorreo, MailConexion
    cx = MailConexion.objects.filter(usuario=user, activo=True).first()
    now = timezone.now() - timedelta(minutes=minutos_atras)
    stamp = int(now.timestamp() * 1000)
    return MailCorreo.objects.create(
        usuario=user, conexion=cx,
        uid_imap='sim_%d' % stamp,                      # no numérico → el worker lo ignora
        message_id='<sim-%d@%s>' % (stamp, _SIM_DOMINIO),
        carpeta_imap='INBOX', carpeta_display='INBOX',
        remitente_nombre=nombre, remitente_email=email,
        destinatarios_json='[]', asunto=asunto,
        cuerpo_texto=cuerpo, cuerpo_html='', cuerpo_cargado=True,
        leido=False, fecha_envio=now, oportunidad=opp,
    )


def _sim_opp(user, titulo, monto=185000, prob=60):
    """Oportunidad demo en etapa avanzada (para escenarios ligados)."""
    from django.utils import timezone
    from .models import TodoItem, EtapaPipeline
    existente = TodoItem.objects.filter(usuario=user, oportunidad=titulo).first()
    if existente:
        return existente
    etapas = list(EtapaPipeline.objects.filter(pipeline='runrate', activo=True).order_by('orden'))
    if etapas:
        ep = etapas[len(etapas) // 2]           # etapa intermedia-avanzada
        etapa_c, etapa_col = ep.nombre, ep.color
    else:
        etapa_c, etapa_col = 'Cotización', '#FFFFFF'
    now_dt = timezone.localtime()
    return TodoItem.objects.create(
        usuario=user, oportunidad=titulo, cliente=_sim_cliente(user),
        monto=monto, probabilidad_cierre=prob,
        mes_cierre=str(now_dt.month).zfill(2), anio_cierre=now_dt.year,
        area='SISTEMAS', producto='SOFTWARE', tipo_negociacion='runrate',
        etapa_corta=etapa_c, etapa_completa=etapa_c, etapa_color=etapa_col, po_number='',
    )


# Escenarios: cada uno inyecta datos y declara qué DEBERÍA hacer el asistente,
# para comparar contra lo que realmente haga.
_SIM_ESCENARIOS = {
    'venta': {
        'nombre': 'Posible venta nueva',
        'esperado': "Toast 'Posible venta nueva' con botón Crear oportunidad. Veredicto IA: venta.",
    },
    'duda': {
        'nombre': 'Cliente con duda (menciona "pedido")',
        'esperado': "Toast 'espera tu respuesta' (Responder). Veredicto: respuesta — NO venta ni hito aunque diga 'pedido'.",
    },
    'liberacion': {
        'nombre': 'Liberación de pedido (el caso real)',
        'esperado': "Veredicto: hito ('Factura / orden recibida'), NO 'Posible venta nueva'. Antes fallaba.",
    },
    'ligado': {
        'nombre': 'Correo ligado a oportunidad (caso 3-A)',
        'esperado': "Toast 'X te escribió sobre [opp]' con Responder. Al RESPONDERLO desde Correo → 'Respondiste — ¿actualizo?' (3-B).",
    },
    'hito_ligado': {
        'nombre': 'OC firmada ligada a oportunidad',
        'esperado': "Toast 'Factura / orden recibida' con Actualizar oportunidad de inmediato (sin esperar respuesta).",
    },
    'insiste': {
        'nombre': 'Cliente insiste (2do correo del hilo)',
        'esperado': "Toast con contexto 'Es la segunda vez que te escribe sin respuesta.'",
    },
    'ruido': {
        'nombre': 'Promoción / newsletter',
        'esperado': "NADA: veredicto ruido, no debe salir notificación. Si sale, hay fuga de precisión.",
    },
}


def _sim_ejecutar(user, esc):
    """Crea los datos del escenario. Devuelve descripción de lo inyectado."""
    dom = _SIM_DOMINIO
    _sim_cliente(user)   # asegura remitente conocido
    if esc == 'venta':
        m = _sim_correo(
            user, 'Laura Mendoza', 'compras@%s' % dom,
            'Solicitud de cotización — refacciones prensa hidráulica',
            'Buenas tardes:\n\nPor este medio le solicito cotización de 12 pzas de sellos '
            'hidráulicos serie HD-220 y 4 juegos de empaques para nuestra prensa Schuler. '
            '¿Podría indicarnos precio, tiempo de entrega y condiciones de pago?\n\n'
            'Quedo pendiente de su pronta respuesta.\n\nLaura Mendoza\nCompras — Aceros del Norte')
        return {'correo_id': m.id, 'detalle': 'Correo de cotización inyectado (remitente conocido).'}
    if esc == 'duda':
        m = _sim_correo(
            user, 'Jorge Salas', 'jsalas@%s' % dom,
            'Duda sobre nuestro pedido en curso',
            'Estimado proveedor:\n\nSobre el pedido que levantamos la semana pasada, '
            '¿me confirma si la entrega sigue programada para el viernes? Necesitamos '
            'coordinar al personal de recibo en planta.\n\nSaludos,\nJorge Salas')
        return {'correo_id': m.id, 'detalle': 'Duda de cliente inyectada (dice "pedido" pero NO es venta ni hito).'}
    if esc == 'liberacion':
        m = _sim_correo(
            user, 'Patricia Núñez', 'pnunez@%s' % dom,
            'Confirmo la liberación de su pedido',
            'Buen día:\n\nLe confirmo que su pedido No. 88412 quedó liberado por nuestro '
            'departamento de calidad y ya puede programar el embarque. El material fue '
            'aprobado sin observaciones.\n\nSaludos cordiales,\nPatricia Núñez')
        return {'correo_id': m.id, 'detalle': 'El caso real que antes salía como "posible venta". A ver qué dice ahora.'}
    if esc == 'ligado':
        opp = _sim_opp(user, '[DEMO] Suministro de rodamientos SKF')
        m = _sim_correo(
            user, 'Laura Mendoza', 'compras@%s' % dom,
            'Cotización rodamientos SKF — comentarios',
            'Buenas tardes:\n\nRevisamos su cotización de los rodamientos SKF. El precio nos '
            'parece competitivo pero necesitamos confirmar si el tiempo de entrega puede '
            'bajar a 3 semanas; es condición de nuestra gerencia para autorizar.\n\n'
            '¿Lo ve factible?\n\nLaura Mendoza', opp=opp)
        return {'correo_id': m.id, 'opp_id': opp.id,
                'detalle': 'Oportunidad demo + correo ligado. Respóndelo desde Correo para disparar el 3-B.'}
    if esc == 'hito_ligado':
        opp = _sim_opp(user, '[DEMO] Bandas transportadoras L4', monto=420000, prob=80)
        m = _sim_correo(
            user, 'Laura Mendoza', 'compras@%s' % dom,
            'Orden de compra OC-4512 firmada',
            'Estimado proveedor:\n\nAdjunto encontrará la orden de compra OC-4512 debidamente '
            'firmada por nuestra dirección, correspondiente a las bandas transportadoras de la '
            'línea 4. Favor de confirmar recepción y fecha estimada de entrega.\n\n'
            'Saludos,\nLaura Mendoza', opp=opp)
        return {'correo_id': m.id, 'opp_id': opp.id,
                'detalle': 'OC firmada ligada a oportunidad de $420,000. Debe ofrecer actualizar YA.'}
    if esc == 'insiste':
        asunto = 'Seguimiento a muestra de material'
        _sim_correo(
            user, 'Marco Treviño', 'mtrevino@%s' % dom, asunto,
            'Buen día:\n\n¿Tuvo oportunidad de revisar lo de la muestra de material que le '
            'comenté? Nos urge definir para arrancar pruebas.\n\nMarco Treviño',
            minutos_atras=60 * 24 * 3)
        m = _sim_correo(
            user, 'Marco Treviño', 'mtrevino@%s' % dom, 'Re: ' + asunto,
            'Estimado:\n\nLe reitero el correo anterior sobre la muestra de material. '
            'Seguimos sin respuesta y el proyecto está detenido por este tema. '
            'Agradezco me confirme cualquier avance.\n\nMarco Treviño')
        return {'correo_id': m.id, 'detalle': 'Hilo con 2 correos sin responder (el 1º hace 3 días).'}
    if esc == 'ruido':
        m = _sim_correo(
            user, 'Boletín Industrial MX', 'newsletter@promo-%s' % dom,
            'Webinar gratuito: ahorre 30% en mantenimiento predictivo',
            'No te pierdas nuestro próximo evento. Aprovecha esta oferta exclusiva y '
            'regístrate gratis. Da clic para dejar de recibir estos correos o darse de baja.')
        return {'correo_id': m.id, 'detalle': 'Promo inyectada. NO debería generar notificación.'}
    return None


@login_required
def vista_simulador_correo(request):
    """GET /app/simulador-correo/ — banco de pruebas del asistente."""
    return render(request, 'simulador_correo.html', {})


@login_required
@require_http_methods(["POST"])
def api_sim_inyectar(request):
    """POST {escenario} — inyecta el escenario y analiza al instante."""
    import json as _json
    try:
        esc = (_json.loads(request.body or '{}').get('escenario') or '').strip()
    except Exception:
        esc = ''
    if esc not in _SIM_ESCENARIOS:
        return JsonResponse({'success': False, 'error': 'Escenario desconocido.'}, status=400)
    r = _sim_ejecutar(request.user, esc)
    # Análisis inmediato (mismo pipeline que el worker) para no esperar 3 min.
    try:
        analizar_correos_recientes(request.user)
    except Exception:
        pass
    return JsonResponse({'success': True, 'escenario': esc,
                         'esperado': _SIM_ESCENARIOS[esc]['esperado'], **(r or {})})


@login_required
def api_sim_estado(request):
    """GET — correos con su veredicto (auditoría en vivo). Por default solo los
    simulados; con ?todos=1 audita TODA la bandeja reciente (últimos 7 días)."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import MailCorreo
    rows = []
    qs = MailCorreo.objects.filter(
        usuario=request.user, carpeta_display='INBOX', eliminado=False)
    if request.GET.get('todos') == '1':
        qs = qs.filter(fecha_envio__gte=timezone.now() - timedelta(hours=_COR_VENTANA_HORAS))
    else:
        qs = qs.filter(remitente_email__icontains=_SIM_DOMINIO)
    qs = qs.select_related('analisis', 'oportunidad').order_by('-fecha_envio')[:50]
    for m in qs:
        a = getattr(m, 'analisis', None)
        rows.append({
            'mail_id': m.id, 'de': m.remitente_nombre or m.remitente_email,
            'asunto': m.asunto, 'ligado': (m.oportunidad.oportunidad if m.oportunidad_id else ''),
            'veredicto': (a.categoria if a else '— pendiente —'),
            'resumen': (a.resumen if a else ''),
            'fuente': (a.fuente if a else ''),
            'confianza': (round(a.confianza, 2) if a else None),
        })
    return JsonResponse({'success': True, 'items': rows})


@login_required
@require_http_methods(["POST"])
def api_sim_limpiar(request):
    """POST — borra TODO lo simulado del usuario (correos, análisis, opps y cliente demo)."""
    from django.db.models import Q
    from .models import MailCorreo, TodoItem, Cliente, Actividad
    user = request.user
    correos = MailCorreo.objects.filter(usuario=user).filter(
        Q(remitente_email__icontains=_SIM_DOMINIO) |
        Q(uid_imap__startswith='sim_') |
        Q(destinatarios_json__icontains=_SIM_DOMINIO))
    n_correos = correos.count()
    correos.delete()                     # CorreoAnalisis y adjuntos caen en cascada
    opps = TodoItem.objects.filter(usuario=user, oportunidad__startswith='[DEMO]')
    opp_ids = list(opps.values_list('id', flat=True))
    n_acts = 0
    if opp_ids:
        n_acts = Actividad.objects.filter(oportunidad_id__in=opp_ids).count()
        Actividad.objects.filter(oportunidad_id__in=opp_ids).delete()
    n_opps = len(opp_ids)
    opps.delete()
    n_cli = Cliente.objects.filter(nombre_empresa__startswith='[DEMO]').count()
    Cliente.objects.filter(nombre_empresa__startswith='[DEMO]').delete()
    return JsonResponse({'success': True, 'correos': n_correos, 'oportunidades': n_opps,
                         'actividades': n_acts, 'clientes': n_cli})

@login_required
@require_http_methods(["POST"])
def api_sim_reanalizar(request):
    """POST — borra los veredictos de la última semana (INBOX) y re-clasifica todo
    con el prompt vigente. Es el ciclo de corrección: se afina el prompt → se
    re-analiza → se comparan veredictos. Solo toca los análisis del usuario."""
    from datetime import timedelta
    from django.utils import timezone
    from .models import CorreoAnalisis
    cutoff = timezone.now() - timedelta(hours=_COR_VENTANA_HORAS)
    borrados = CorreoAnalisis.objects.filter(
        usuario=request.user, correo__carpeta_display='INBOX',
        correo__fecha_envio__gte=cutoff).delete()[0]
    total = 0
    for _ in range(8):        # drena por lotes de IA; tope de seguridad
        hechos = analizar_correos_recientes(request.user)
        total += hechos
        if not hechos:
            break
    return JsonResponse({'success': True, 'borrados': borrados, 'reanalizados': total})

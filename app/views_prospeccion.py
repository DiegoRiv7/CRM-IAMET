# ----------------------------------------------------------------------
# views_prospeccion.py -- Prospeccion module views.
# ----------------------------------------------------------------------

import json
import logging
from datetime import datetime

from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from decimal import Decimal

from .views_utils import is_supervisor
from .views_grupos import get_usuarios_visibles_ids
from .models import (
    Prospecto, ProspectoComentario, ProspectoActividad,
    TodoItem, Cliente, Contacto, UserProfile,
)

logger = logging.getLogger(__name__)


@login_required
def api_prospectos_lista(request):
    """GET: devuelve lista de prospectos como JSON para la tabla."""
    user = request.user
    now = datetime.now()

    mes_filter = request.GET.get('mes', str(now.month).zfill(2))
    anio_filter = request.GET.get('anio', str(now.year))
    vendedores_filter = request.GET.get('vendedores', '')
    vendedores_ids = [
        int(x) for x in vendedores_filter.split(',') if x.strip().isdigit()
    ] if vendedores_filter else []

    try:
        anio_int = int(anio_filter)
    except ValueError:
        anio_int = now.year

    qs = Prospecto.objects.select_related('cliente', 'contacto', 'usuario')

    # Filtro por fecha de creacion (ano, mes)
    qs = qs.filter(fecha_creacion__year=anio_int)
    if mes_filter and mes_filter != 'todos':
        try:
            mes_int = int(mes_filter)
            qs = qs.filter(fecha_creacion__month=mes_int)
        except ValueError:
            pass

    # Visibilidad
    es_sup = is_supervisor(user)
    if not es_sup:
        usuarios_visibles = get_usuarios_visibles_ids(user)
        if usuarios_visibles and len(usuarios_visibles) > 1:
            qs = qs.filter(usuario_id__in=usuarios_visibles)
        else:
            qs = qs.filter(usuario=user)
    elif vendedores_ids:
        qs = qs.filter(usuario_id__in=vendedores_ids)

    rows = []
    for p in qs:
        rows.append({
            'id': p.id,
            'nombre': p.nombre,
            'cliente': p.cliente.nombre_empresa if p.cliente else '-',
            'cliente_id': p.cliente_id,
            'contacto': p.contacto.nombre if p.contacto else '',
            'area': p.area or '-',
            'producto': p.producto or '-',
            'tipo_pipeline': p.tipo_pipeline,
            'etapa': p.etapa,
            'fecha_actualizacion': int(p.fecha_actualizacion.timestamp()) if p.fecha_actualizacion else 0,
            'fecha_iso': p.fecha_actualizacion.strftime('%d/%m/%Y') if p.fecha_actualizacion else '',
        })

    total = len(rows)
    return JsonResponse({
        'rows': rows,
        'footer': {
            'left': f'{total} prospectos',
            'right': '',
        }
    })


@login_required
def api_crear_prospecto(request):
    """POST: crea un nuevo prospecto."""
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST requerido'}, status=405)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    nombre = data.get('nombre', '').strip()
    cliente_id = data.get('cliente_id')
    contacto_id = data.get('contacto_id')
    producto = data.get('producto', 'ZEBRA')
    area = data.get('area', 'SISTEMAS')
    tipo_pipeline = data.get('tipo_pipeline', 'runrate')
    comentarios = data.get('comentarios', '')

    if not nombre:
        return JsonResponse({'success': False, 'error': 'Nombre requerido'}, status=400)
    if not cliente_id:
        return JsonResponse({'success': False, 'error': 'Cliente requerido'}, status=400)

    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Cliente no encontrado'}, status=404)

    contacto = None
    if contacto_id:
        try:
            contacto = Contacto.objects.get(id=contacto_id)
        except Contacto.DoesNotExist:
            pass

    prospecto = Prospecto.objects.create(
        usuario=request.user,
        nombre=nombre,
        cliente=cliente,
        contacto=contacto,
        producto=producto,
        area=area,
        tipo_pipeline=tipo_pipeline,
        comentarios=comentarios,
    )

    return JsonResponse({
        'success': True,
        'id': prospecto.id,
        'nombre': prospecto.nombre,
    })


@login_required
def api_prospecto_detalle(request, prospecto_id):
    """GET: devuelve toda la info del prospecto para el widget."""
    try:
        p = Prospecto.objects.select_related('cliente', 'contacto', 'usuario', 'oportunidad_creada').get(id=prospecto_id)
    except Prospecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Prospecto no encontrado'}, status=404)

    return JsonResponse({
        'id': p.id,
        'nombre': p.nombre,
        'cliente': p.cliente.nombre_empresa if p.cliente else '-',
        'cliente_id': p.cliente_id,
        'contacto': p.contacto.nombre if p.contacto else '-',
        'contacto_id': p.contacto_id,
        'producto': p.producto,
        'area': p.area,
        'tipo_pipeline': p.tipo_pipeline,
        'comentarios': p.comentarios,
        'etapa': p.etapa,
        'reunion_tipo': p.reunion_tipo,
        'oportunidad_creada_id': p.oportunidad_creada_id,
        'fecha_creacion': p.fecha_creacion.strftime('%d/%m/%Y %H:%M') if p.fecha_creacion else '',
        'fecha_actualizacion': p.fecha_actualizacion.strftime('%d/%m/%Y %H:%M') if p.fecha_actualizacion else '',
        'usuario': p.usuario.get_full_name() or p.usuario.username,
    })


@login_required
def api_prospecto_etapa(request, prospecto_id):
    """POST: cambia etapa del prospecto. Si cerrado_ganado, crea oportunidad."""
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST requerido'}, status=405)

    try:
        prospecto = Prospecto.objects.select_related('cliente', 'contacto').get(id=prospecto_id)
    except Prospecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Prospecto no encontrado'}, status=404)

    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

    nueva_etapa = data.get('etapa', '')
    reunion_tipo = data.get('reunion_tipo', '')

    etapas_validas = [e[0] for e in Prospecto.ETAPA_CHOICES]
    if nueva_etapa not in etapas_validas:
        return JsonResponse({'success': False, 'error': 'Etapa invalida'}, status=400)

    if nueva_etapa == 'reunion' and not reunion_tipo:
        return JsonResponse({'success': False, 'error': 'Tipo de reunion requerido'}, status=400)

    prospecto.etapa = nueva_etapa
    if nueva_etapa == 'reunion':
        prospecto.reunion_tipo = reunion_tipo

    oportunidad_id = None

    if nueva_etapa == 'cerrado_ganado':
        # Crear oportunidad (TodoItem) con datos del prospecto
        opp = TodoItem.objects.create(
            usuario=prospecto.usuario,
            oportunidad=prospecto.nombre,
            cliente=prospecto.cliente,
            contacto=prospecto.contacto,
            producto=prospecto.producto,
            area=prospecto.area,
            tipo_negociacion=prospecto.tipo_pipeline,
            monto=Decimal('0.00'),
            probabilidad_cierre=5,
            mes_cierre=str(timezone.now().month).zfill(2),
            anio_cierre=timezone.now().year,
            comentarios=prospecto.comentarios,
            estado_crm='nueva',
        )
        prospecto.oportunidad_creada = opp
        oportunidad_id = opp.id

    prospecto.save()

    return JsonResponse({
        'success': True,
        'etapa': prospecto.etapa,
        'oportunidad_id': oportunidad_id,
    })


@login_required
def api_prospecto_comentarios(request, prospecto_id):
    """GET: listar comentarios. POST: agregar comentario."""
    try:
        prospecto = Prospecto.objects.get(id=prospecto_id)
    except Prospecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Prospecto no encontrado'}, status=404)

    if request.method == 'GET':
        comentarios = ProspectoComentario.objects.filter(prospecto=prospecto).select_related('usuario')
        return JsonResponse({
            'comentarios': [
                {
                    'id': c.id,
                    'usuario': c.usuario.get_full_name() or c.usuario.username,
                    'texto': c.texto,
                    'fecha': c.fecha_creacion.strftime('%d/%m/%Y %H:%M'),
                }
                for c in comentarios
            ]
        })

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

        texto = data.get('texto', '').strip()
        if not texto:
            return JsonResponse({'success': False, 'error': 'Texto requerido'}, status=400)

        ProspectoComentario.objects.create(
            prospecto=prospecto,
            usuario=request.user,
            texto=texto,
        )
        return JsonResponse({'success': True})

    return JsonResponse({'success': False, 'error': 'Metodo no permitido'}, status=405)


@login_required
def api_prospecto_actividades(request, prospecto_id):
    """GET: listar actividades. POST: agregar actividad."""
    try:
        prospecto = Prospecto.objects.get(id=prospecto_id)
    except Prospecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Prospecto no encontrado'}, status=404)

    if request.method == 'GET':
        actividades = ProspectoActividad.objects.filter(prospecto=prospecto).select_related('usuario')
        return JsonResponse({
            'actividades': [
                {
                    'id': a.id,
                    'tipo': a.tipo,
                    'descripcion': a.descripcion,
                    'fecha_programada': a.fecha_programada.strftime('%d/%m/%Y %H:%M'),
                    'completada': a.completada,
                    'usuario': a.usuario.get_full_name() or a.usuario.username,
                }
                for a in actividades
            ]
        })

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'success': False, 'error': 'JSON invalido'}, status=400)

        tipo = data.get('tipo', 'tarea')
        descripcion = data.get('descripcion', '').strip()
        fecha_programada = data.get('fecha_programada', '')

        if not descripcion:
            return JsonResponse({'success': False, 'error': 'Descripcion requerida'}, status=400)
        if not fecha_programada:
            return JsonResponse({'success': False, 'error': 'Fecha requerida'}, status=400)

        try:
            fecha_dt = timezone.datetime.fromisoformat(fecha_programada)
            if timezone.is_naive(fecha_dt):
                fecha_dt = timezone.make_aware(fecha_dt)
        except (ValueError, TypeError):
            return JsonResponse({'success': False, 'error': 'Formato de fecha invalido'}, status=400)

        ProspectoActividad.objects.create(
            prospecto=prospecto,
            usuario=request.user,
            tipo=tipo,
            descripcion=descripcion,
            fecha_programada=fecha_dt,
        )
        return JsonResponse({'success': True})

    return JsonResponse({'success': False, 'error': 'Metodo no permitido'}, status=405)


@login_required
def api_prospecto_actividad_toggle(request, actividad_id):
    """POST: marcar actividad como completada/no completada."""
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST requerido'}, status=405)

    try:
        actividad = ProspectoActividad.objects.get(id=actividad_id)
    except ProspectoActividad.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Actividad no encontrada'}, status=404)

    actividad.completada = not actividad.completada
    actividad.save()

    return JsonResponse({
        'success': True,
        'completada': actividad.completada,
    })

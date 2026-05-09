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

from .views_utils import is_supervisor, is_administrador
from .views_grupos import get_usuarios_visibles_ids
from .models import (
    Prospecto, ProspectoComentario, ProspectoActividad,
    TodoItem, Cliente, Contacto, UserProfile,
    MensajeOportunidad, Actividad, Notificacion,
)

logger = logging.getLogger(__name__)


@login_required
def api_prospeccion_clientes(request):
    """GET: devuelve clientes con conteo de prospectos por producto."""
    user = request.user
    now = datetime.now()

    mes_filter = request.GET.get('mes', str(now.month).zfill(2))
    anio_filter = request.GET.get('anio', str(now.year))
    vendedores_filter = request.GET.get('vendedores', '')
    vendedores_ids = [int(x) for x in vendedores_filter.split(',') if x.strip().isdigit()] if vendedores_filter else []

    try:
        anio_int = int(anio_filter)
    except ValueError:
        anio_int = now.year

    es_sup = is_supervisor(user)

    # Get clients visible to this user
    if es_sup:
        if vendedores_ids:
            clientes = Cliente.objects.filter(asignado_a_id__in=vendedores_ids)
        else:
            clientes = Cliente.objects.all()
    else:
        usuarios_visibles = get_usuarios_visibles_ids(user)
        if usuarios_visibles and len(usuarios_visibles) > 1:
            clientes = Cliente.objects.filter(asignado_a_id__in=usuarios_visibles)
        else:
            clientes = Cliente.objects.filter(asignado_a=user)

    # Count prospectos per client per product
    # Only count active (non-cerrado) prospectos
    prospectos_qs = Prospecto.objects.filter(
        fecha_creacion__year=anio_int,
        cliente__in=clientes,
    ).exclude(etapa__in=['cerrado_ganado', 'cerrado_perdido'])

    if mes_filter and mes_filter != 'todos':
        try:
            prospectos_qs = prospectos_qs.filter(fecha_creacion__month=int(mes_filter))
        except ValueError:
            pass

    PRODUCTS = ['ZEBRA', 'PANDUIT', 'APC', 'AVIGILION', 'GENETEC', 'AXIS', 'SOFTWARE', 'RUNRATE', 'POLIZA']
    PROD_KEYS = ['zebra', 'panduit', 'apc', 'avigilon', 'genetec', 'axis', 'software', 'runrate', 'poliza']

    # Build counts dict: {client_id: {zebra: N, panduit: N, ...}}
    counts = {}
    for p in prospectos_qs:
        cid = p.cliente_id
        if cid not in counts:
            counts[cid] = {k: 0 for k in PROD_KEYS + ['otros', 'total']}

        prod = (p.producto or '').upper()
        matched = False
        for i, pname in enumerate(PRODUCTS):
            if pname in prod or (pname == 'AVIGILION' and 'AVIGILON' in prod):
                counts[cid][PROD_KEYS[i]] += 1
                matched = True
                break
        if not matched:
            counts[cid]['otros'] += 1
        counts[cid]['total'] += 1

    rows = []
    for c in clientes.order_by('nombre_empresa'):
        ct = counts.get(c.id, {})
        total = ct.get('total', 0)
        rows.append({
            'cliente_id': c.id,
            'cliente': c.nombre_empresa,
            'rfc': c.rfc or '',
            'zebra': ct.get('zebra', 0),
            'panduit': ct.get('panduit', 0),
            'apc': ct.get('apc', 0),
            'avigilon': ct.get('avigilon', 0),
            'genetec': ct.get('genetec', 0),
            'axis': ct.get('axis', 0),
            'software': ct.get('software', 0),
            'runrate': ct.get('runrate', 0),
            'poliza': ct.get('poliza', 0),
            'otros': ct.get('otros', 0),
            'total': total,
        })

    num_clientes = len(rows)
    total_prospectos = sum(r['total'] for r in rows)

    return JsonResponse({
        'rows': rows,
        'footer': {
            'left': f'{num_clientes} clientes',
            'right': f'{total_prospectos} prospectos activos',
        }
    })


@login_required
def api_prospectos_por_cliente(request, cliente_id):
    """GET: prospectos de un cliente especifico."""
    prospectos = Prospecto.objects.filter(cliente_id=cliente_id).select_related('contacto', 'usuario').order_by('-fecha_actualizacion')
    rows = []
    for p in prospectos:
        rows.append({
            'id': p.id,
            'nombre': p.nombre,
            'contacto': p.contacto.nombre if p.contacto else '-',
            'producto': p.producto,
            'area': p.area,
            'tipo_pipeline': p.tipo_pipeline,
            'etapa': p.etapa,
            'reunion_tipo': p.reunion_tipo,
            'fecha_iso': p.fecha_creacion.strftime('%d/%m/%Y'),
            'oportunidad_creada_id': p.oportunidad_creada_id,
        })
    return JsonResponse({'rows': rows})


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

    qs = Prospecto.objects.select_related('cliente', 'contacto', 'usuario').prefetch_related('actividades')

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

    # Probabilidad estimada por etapa (para pintar el círculo de progreso en kanban)
    ETAPA_PROBABILIDAD = {
        'identificado': 10,
        'calificado': 25,
        'reunion': 45,
        'en_progreso': 65,
        'procesado': 85,
        'cerrado_ganado': 100,
        'cerrado_perdido': 0,
    }
    ETAPA_LABEL_CORTO = {
        'identificado': 'Identificado',
        'calificado': 'Calificado',
        'reunion': 'Reunión',
        'en_progreso': 'En Progreso',
        'procesado': 'Procesado',
        'cerrado_ganado': 'Cerrado',
        'cerrado_perdido': 'Perdido',
    }

    ahora_ts = timezone.now()
    rows = []
    for p in qs:
        # Calcular actividad próxima y vencida a partir de ProspectoActividad
        acts_pend = [a for a in p.actividades.all() if not a.completada and a.fecha_programada]
        acts_pend.sort(key=lambda a: a.fecha_programada)

        tiene_venc = False
        dias_venc = 0
        minutos_hasta_prox = None
        dias_hasta_prox = None
        actividad_proxima_txt = ''

        if acts_pend:
            prox = acts_pend[0]
            delta = prox.fecha_programada - ahora_ts
            minutos = int(delta.total_seconds() / 60)
            actividad_proxima_txt = prox.descripcion[:80] if prox.descripcion else prox.get_tipo_display()

            if minutos < 0:
                tiene_venc = True
                dias_venc = max(0, int(abs(delta.total_seconds()) / 86400))
            else:
                minutos_hasta_prox = minutos
                dias_hasta_prox = int(delta.total_seconds() / 86400)

        probabilidad = ETAPA_PROBABILIDAD.get(p.etapa, 0)

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
            'etapa_label': ETAPA_LABEL_CORTO.get(p.etapa, p.etapa),
            'probabilidad': probabilidad,
            'usuario_id': p.usuario_id,
            'usuario_nombre': (p.usuario.get_full_name() or p.usuario.username) if p.usuario else '',
            'tiene_actividad_vencida': tiene_venc,
            'dias_vencida': dias_venc,
            'minutos_hasta_proxima': minutos_hasta_prox,
            'dias_hasta_proxima': dias_hasta_prox if dias_hasta_prox is not None else -1,
            'actividad_proxima': actividad_proxima_txt,
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
    etapa = data.get('etapa', '')

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

    # Asignación: por defecto el creador. Si viene `usuario_id` y el caller
    # es supervisor o administrador, se respeta esa asignación.
    asignar_a = request.user
    es_sup_o_admin = is_supervisor(request.user) or is_administrador(request.user)
    usuario_id = data.get('usuario_id')
    asignacion_externa = False  # supervisor/admin asigna a OTRO vendedor
    if usuario_id and es_sup_o_admin:
        from django.contrib.auth.models import User
        try:
            asignar_a = User.objects.get(id=int(usuario_id))
        except (User.DoesNotExist, ValueError, TypeError):
            return JsonResponse({'success': False, 'error': 'Usuario asignado no encontrado'}, status=400)
        if asignar_a.id != request.user.id:
            asignacion_externa = True

    # Si supervisor/admin asigna a otro vendedor, EXIGIR actividad inicial.
    # Solo requerimos TIPO + FECHA — el título usa el del prospecto y la
    # descripción usa los comentarios iniciales del prospecto.
    actividad_inicial = data.get('actividad_inicial') or {}
    tipos_validos = {c[0] for c in ProspectoActividad.TIPO_CHOICES}
    act_tipo = (actividad_inicial.get('tipo') or '').strip()
    act_fecha_raw = (actividad_inicial.get('fecha_programada') or '').strip()
    act_fecha_dt = None
    if asignacion_externa:
        if act_tipo not in tipos_validos:
            return JsonResponse({'success': False, 'error': 'Tipo de actividad inicial inválido'}, status=400)
        if not act_fecha_raw:
            return JsonResponse({'success': False, 'error': 'Fecha de la actividad inicial requerida'}, status=400)
        try:
            act_fecha_dt = timezone.datetime.fromisoformat(act_fecha_raw)
            if timezone.is_naive(act_fecha_dt):
                act_fecha_dt = timezone.make_aware(act_fecha_dt)
        except (ValueError, TypeError):
            return JsonResponse({'success': False, 'error': 'Formato de fecha inválido (usa YYYY-MM-DDTHH:MM)'}, status=400)

    # Etapa inicial: si viene del kanban (ej. click en "+" de "Reunión"),
    # respetar esa etapa; si no, el modelo usa 'identificado' por default.
    etapas_validas = {e[0] for e in Prospecto.ETAPA_CHOICES}
    create_kwargs = dict(
        usuario=asignar_a,
        nombre=nombre,
        cliente=cliente,
        contacto=contacto,
        producto=producto,
        area=area,
        tipo_pipeline=tipo_pipeline,
        comentarios=comentarios,
    )
    if asignacion_externa:
        create_kwargs['asignado_por'] = request.user
    if etapa and etapa in etapas_validas:
        create_kwargs['etapa'] = etapa
    prospecto = Prospecto.objects.create(**create_kwargs)

    # Si fue asignación externa, crear actividad inicial + evento de calendario
    # para el vendedor asignado, con metadata para enlazar de vuelta al prospecto.
    # Notificar también al vendedor para que lo vea al entrar al CRM.
    if asignacion_externa and act_fecha_dt is not None:
        # Descripción de la actividad: el título de la prospección + los
        # comentarios iniciales si los hay. Evita duplicar campos en la UI.
        act_titulo = prospecto.nombre
        act_descripcion_calc = (prospecto.comentarios or '').strip()

        ProspectoActividad.objects.create(
            prospecto=prospecto,
            usuario=asignar_a,
            tipo=act_tipo,
            descripcion=act_descripcion_calc or act_titulo,
            fecha_programada=act_fecha_dt,
        )
        try:
            from datetime import timedelta
            tipo_cal_map = {
                'llamada': 'llamada',
                'reunion': 'reunion',
                'reunion_virtual': 'reunion',
                'correo': 'email',
                'visita': 'tarea',
                'campana': 'tarea',
                'tarea': 'tarea',
            }
            cliente_nombre = prospecto.cliente.nombre_empresa if prospecto.cliente else 'Sin cliente'
            sup_nombre = (request.user.get_full_name() or request.user.username).strip()
            # Descripción visible: comentarios del prospecto + asignado_por + link.
            desc_visible = act_descripcion_calc + ('\n\n' if act_descripcion_calc else '')
            desc_cal = (
                desc_visible
                + f'Asignado por: {sup_nombre}'
                + f'\n[asignado_por_id:{request.user.id}]'
                + f'\n---prospecto_id:{prospecto.id}|{prospecto.nombre}|{cliente_nombre}'
            )
            evento = Actividad.objects.create(
                titulo=act_titulo[:200],
                tipo_actividad=tipo_cal_map.get(act_tipo, 'otro'),
                descripcion=desc_cal,
                fecha_inicio=act_fecha_dt,
                fecha_fin=act_fecha_dt + timedelta(hours=1),
                creado_por=asignar_a,
                # #B45309 = café (warm-modern). Mantiene la convención visual
                # de "actividad de prospecto" para que el calendario abra el
                # modal específico (con sección Relacionado a → prospecto).
                color='#B45309',
            )
            # Supervisor también ve la actividad en su calendario
            evento.participantes.add(request.user)
        except Exception as e:
            logging.getLogger(__name__).warning('Prospecto: no se pudo crear actividad calendario asignada: %s', e)

        # Notificación al vendedor: aparece en el icono de campana del CRM.
        try:
            tipo_legible = dict(ProspectoActividad.TIPO_CHOICES).get(act_tipo, act_tipo)
            fecha_legible = act_fecha_dt.strftime('%d/%m/%Y a las %H:%M')
            sup_nombre_n = (request.user.get_full_name() or request.user.username).strip()
            Notificacion.objects.create(
                usuario_destinatario=asignar_a,
                usuario_remitente=request.user,
                tipo='prospecto_asignado',
                titulo=f'{sup_nombre_n} te asignó un prospecto',
                mensaje=(
                    f'"{prospecto.nombre}" — primera actividad: {tipo_legible} '
                    f'el {fecha_legible}.'
                ),
            )
        except Exception as e:
            logging.getLogger(__name__).warning('Prospecto: no se pudo crear notificación de asignación: %s', e)

    return JsonResponse({
        'success': True,
        'id': prospecto.id,
        'nombre': prospecto.nombre,
    })


@login_required
def api_prospecto_detalle(request, prospecto_id):
    """GET: devuelve toda la info del prospecto para el widget."""
    try:
        p = Prospecto.objects.select_related(
            'cliente', 'contacto', 'usuario', 'oportunidad_creada', 'asignado_por',
        ).get(id=prospecto_id)
    except Prospecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Prospecto no encontrado'}, status=404)

    asig_por = p.asignado_por
    asignado_por_nombre = None
    if asig_por:
        asignado_por_nombre = (asig_por.get_full_name() or asig_por.username).strip()

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
        'asignado_por': asignado_por_nombre,
        'asignado_por_id': asig_por.id if asig_por else None,
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
def api_prospecto_convertir(request, prospecto_id):
    """POST: Convierte prospecto a oportunidad (sin importar etapa).
    Migra comentarios a la conversación de la oportunidad."""
    if request.method != 'POST':
        return JsonResponse({'success': False, 'error': 'POST requerido'}, status=405)

    try:
        prospecto = Prospecto.objects.select_related('cliente', 'contacto', 'usuario').get(id=prospecto_id)
    except Prospecto.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Prospecto no encontrado'}, status=404)

    # Si ya tiene oportunidad creada, devolver esa
    if prospecto.oportunidad_creada_id:
        return JsonResponse({
            'success': True,
            'oportunidad_id': prospecto.oportunidad_creada_id,
            'cliente_id': prospecto.cliente_id,
            'ya_existia': True,
        })

    # Crear oportunidad con datos del prospecto
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

    # Migrar comentarios del prospecto a la conversación de la oportunidad
    if prospecto.comentarios:
        MensajeOportunidad.objects.create(
            oportunidad=opp,
            usuario=prospecto.usuario,
            texto=f'[Comentario inicial del prospecto] {prospecto.comentarios}',
        )
    for com in ProspectoComentario.objects.filter(prospecto=prospecto).select_related('usuario').order_by('fecha_creacion'):
        MensajeOportunidad.objects.create(
            oportunidad=opp,
            usuario=com.usuario,
            texto=com.texto,
        )

    # Marcar prospecto como ganado y vincular
    prospecto.oportunidad_creada = opp
    prospecto.etapa = 'cerrado_ganado'
    prospecto.save()

    return JsonResponse({
        'success': True,
        'oportunidad_id': opp.id,
        'cliente_id': prospecto.cliente_id,
        'ya_existia': False,
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

        # Also create a calendar Actividad so it appears in the main calendar (purple)
        try:
            from datetime import timedelta
            tipo_map = {
                'llamada': 'llamada',
                'reunion': 'reunion',
                'correo': 'email',
                'tarea': 'tarea',
            }
            cliente_nombre = prospecto.cliente.nombre_empresa if prospecto.cliente else 'Sin cliente'
            desc_extra = data.get('desc_extra', '').strip()
            # Descripcion visible + metadata de link al prospecto al final
            desc_cal = desc_extra or ''
            desc_cal += f'\n---prospecto_id:{prospecto.id}|{prospecto.nombre}|{cliente_nombre}'
            Actividad.objects.create(
                titulo=descripcion,
                tipo_actividad=tipo_map.get(tipo, 'otro'),
                descripcion=desc_cal,
                fecha_inicio=fecha_dt,
                fecha_fin=fecha_dt + timedelta(hours=1),
                creado_por=request.user,
                color='#B45309',
            )
        except Exception as e:
            print(f'[Prospecto] Error creando actividad calendario: {e}')

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

    # También marcar la actividad del calendario correspondiente
    try:
        cal_acts = Actividad.objects.filter(
            color='#B45309',
            titulo=actividad.descripcion,
            creado_por=actividad.usuario,
        )
        cal_acts.update(completada=actividad.completada)
    except Exception:
        pass

    return JsonResponse({
        'success': True,
        'completada': actividad.completada,
    })

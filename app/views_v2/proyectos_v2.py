"""
proyectos_v2.py — Vistas NUEVAS del módulo Proyectos.

Aquí va TODA vista nueva relacionada con proyectos. NO modificar:
    - views_proyectos.py (6,861 líneas) — LEGACY
    - views_iamet.py (6,568 líneas) — LEGACY

Ambos están congelados por Boy Scout Rule (ver ESTRUCTURA.md).

IMPORTANTE — Modelos paralelos:
    El sistema tiene `Proyecto` legacy y `ProyectoIAMET` moderno. Para
    código NUEVO, usar SIEMPRE `ProyectoIAMET` (tiene estructura
    financiera con partidas, órdenes de compra, facturas).

    from app.models import ProyectoIAMET

Convenciones obligatorias:
    - @login_required en endpoints autenticados
    - try/except con logger.exception(...), nunca `pass`
    - select_related/prefetch_related al iterar relaciones
    - Importar helpers desde views_utils
"""
import json
import logging

from django.contrib.auth.decorators import login_required
from django.db.models import Prefetch
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.http import require_http_methods

from app.models import MaterialEsperado, ProyectoIAMET, ProyectoLevantamiento
from app.views_utils import is_supervisor
from app.views_grupos import get_usuarios_visibles_ids

logger = logging.getLogger(__name__)


# ── Materiales esperados (sección "Control") ──────────────────────────
# Colores del frontend según estado del material. Se devuelven en cada
# serialización para mantener la fuente única en el backend (si cambia el
# color, no hay que actualizar también el JS / CSS).
MATERIAL_ESTADO_COLOR = {
    'pendiente_compra': '#FB923C',
    'en_transito': '#7DD3FC',
    'material_listo': '#22C55E',
    'en_espera_cliente': '#F9A8D4',
    'recibido': '#16A34A',
}
MATERIAL_ESTADO_VALIDOS = set(dict(MaterialEsperado.ESTADO_CHOICES).keys())


def _proyectos_visibles_qs(user):
    """QuerySet de ProyectoIAMET visibles para el usuario (mismo criterio
    que api_control_proyectos)."""
    qs = ProyectoIAMET.objects.all()
    if is_supervisor(user):
        return qs
    visibles = get_usuarios_visibles_ids(user)
    if visibles is None:
        return qs.none()
    return qs.filter(usuario_id__in=visibles)


def _proyecto_visible_o_none(user, proyecto_id):
    try:
        return _proyectos_visibles_qs(user).get(id=proyecto_id)
    except ProyectoIAMET.DoesNotExist:
        return None


def _puede_editar_material(user, material):
    """Solo el creador o un supervisor puede modificar/eliminar.
    El propietario del proyecto también puede (es responsable de la opp)."""
    if is_supervisor(user):
        return True
    if material.creado_por_id and material.creado_por_id == user.id:
        return True
    if material.proyecto and material.proyecto.usuario_id == user.id:
        return True
    return False


def _material_to_dict(m):
    estado = m.estado or 'pendiente_compra'
    return {
        'id': m.id,
        'proyecto_id': m.proyecto_id,
        'titulo': m.titulo,
        'fecha_inicio': m.fecha_inicio.isoformat() if m.fecha_inicio else None,
        'fecha_fin': m.fecha_fin.isoformat() if m.fecha_fin else None,
        'estado': estado,
        'estado_display': dict(MaterialEsperado.ESTADO_CHOICES).get(estado, estado),
        'color': MATERIAL_ESTADO_COLOR.get(estado, '#9CA3AF'),
        'confirmado_recepcion': bool(m.confirmado_recepcion),
        'fecha_confirmacion': (
            timezone.localtime(m.fecha_confirmacion).strftime('%d/%m/%Y %H:%M')
            if m.fecha_confirmacion else ''
        ),
        'confirmado_por_id': m.confirmado_por_id,
        'confirmado_por_nombre': (
            (m.confirmado_por.get_full_name() or m.confirmado_por.username)
            if m.confirmado_por_id and m.confirmado_por else ''
        ),
        'comentarios_raw': m.comentarios or '',
        'comentarios': _parsear_comentarios(m.comentarios or ''),
        'creado_por_id': m.creado_por_id,
        'creado_por_nombre': (
            (m.creado_por.get_full_name() or m.creado_por.username)
            if m.creado_por_id and m.creado_por else ''
        ),
        'created_at': (
            timezone.localtime(m.created_at).strftime('%d/%m/%Y %H:%M')
            if m.created_at else ''
        ),
        'proyecto_nombre': m.proyecto.nombre if m.proyecto_id else '',
        'proyecto_cliente': m.proyecto.cliente_nombre if m.proyecto_id else '',
    }


def _parsear_comentarios(raw):
    """Parsea el TextField `comentarios` en una lista de dicts.

    Formato esperado de cada bloque (separados por '\\n---\\n'):
        [YYYY-MM-DD HH:MM] Usuario Apellido
        Texto del comentario (puede ser multilínea)
    Si un bloque no tiene cabecera, se devuelve como anónimo / sin fecha.
    """
    if not raw or not raw.strip():
        return []
    out = []
    bloques = raw.split('\n---\n')
    for i, bl in enumerate(bloques):
        bl = bl.strip('\n')
        if not bl.strip():
            continue
        lineas = bl.split('\n', 1)
        cabecera = lineas[0].strip()
        cuerpo = lineas[1] if len(lineas) > 1 else ''
        fecha = ''
        autor = ''
        texto = bl
        # Cabecera estilo "[2026-06-08 14:32] Pepe Pérez"
        if cabecera.startswith('[') and ']' in cabecera:
            try:
                fin = cabecera.index(']')
                fecha = cabecera[1:fin].strip()
                autor = cabecera[fin + 1:].strip()
                texto = cuerpo.strip() or cabecera
            except ValueError:
                pass
        out.append({
            'idx': i,
            'fecha': fecha,
            'autor': autor,
            'texto': texto,
        })
    return out


def _formatear_comentario_nuevo(user, texto):
    """Convierte (user, texto) en el bloque canónico que se concatena
    a `comentarios`. Si user es None usa 'Sistema'."""
    autor = (user.get_full_name() or user.username) if user else 'Sistema'
    ts = timezone.localtime(timezone.now()).strftime('%Y-%m-%d %H:%M')
    return '[{ts}] {autor}\n{texto}'.format(ts=ts, autor=autor, texto=(texto or '').strip())


def _extraer_duracion(levantamiento):
    """
    Extrae la duración (jornadas) del último levantamiento.
    La duración vive en fase2_data['programa']['duracion'] como texto libre
    ('10 días', '5 jornadas normales', etc.). Si no existe, retorna ''.
    """
    if not levantamiento:
        return ''
    f2 = levantamiento.fase2_data or {}
    programa = f2.get('programa') or {}
    val = programa.get('duracion')
    if not val:
        # Fallback: a veces se guarda en fase1
        f1 = levantamiento.fase1_data or {}
        val = f1.get('duracion')
    return (val or '').strip()


@login_required
@require_http_methods(["GET"])
def api_control_proyectos(request):
    """
    Lista de proyectos para la sección "Control" del dashboard (logística
    de compra de materiales).

    Query params soportados:
        mes        — '01'..'12' o 'todos' (filtra ProyectoIAMET.created_at__month)
        anio       — YYYY o 'todos'
        vendedores — CSV de user IDs (solo aplica si el usuario es supervisor)

    Lógica de visibilidad:
        - Supervisor / superuser → ve todo (o filtra por `vendedores` si vino)
        - Resto → solo proyectos cuyo `usuario_id` esté en sus visibles
                  (sí mismo + miembros/supervisor de sus grupos).

    Respuesta:
        { ok: true, data: [
            {
              proyecto_id, nombre, cliente, status,
              po, oportunidad_id, oportunidad_nombre,
              jornadas, levantamiento_id,
            }, ...
        ] }
    """
    try:
        user = request.user
        es_super = is_supervisor(user)

        # --- Visibilidad ----------------------------------------------------
        qs = ProyectoIAMET.objects.all()

        if es_super:
            # Supervisor puede filtrar por vendedores específicos.
            vf = (request.GET.get('vendedores') or '').strip()
            if vf and vf.lower() != 'todos':
                ids = [int(x) for x in vf.split(',') if x.strip().isdigit()]
                if ids:
                    qs = qs.filter(usuario_id__in=ids)
        else:
            # No-supervisor: solo proyectos de personas visibles para él
            # (sí mismo + miembros de sus grupos). Ignoramos el query param
            # `vendedores` — un no-supervisor no puede expandir su scope.
            visibles = get_usuarios_visibles_ids(user)
            if visibles is None:
                # Por seguridad: si get_usuarios_visibles_ids retorna None
                # para un no-supervisor (inesperado), no exponemos nada.
                qs = qs.none()
            else:
                qs = qs.filter(usuario_id__in=visibles)

        # --- Filtro mes/año (sobre created_at) ------------------------------
        mes = (request.GET.get('mes') or '').strip()
        anio = (request.GET.get('anio') or '').strip()
        if anio and anio.lower() != 'todos':
            try:
                qs = qs.filter(created_at__year=int(anio))
            except (ValueError, TypeError):
                pass
        if mes and mes.lower() != 'todos':
            try:
                qs = qs.filter(created_at__month=int(mes))
            except (ValueError, TypeError):
                pass

        # --- Prefetch para no hacer N+1 -------------------------------------
        # Cada proyecto: oportunidad (FK) + último levantamiento (related) +
        # miembros (M2M, para contar técnicos) + materiales esperados
        # (barras del timeline de Control).
        ultimos_lev = ProyectoLevantamiento.objects.order_by('-fecha_creacion')
        materiales_qs = MaterialEsperado.objects.order_by('fecha_inicio')
        qs = (
            qs.select_related('oportunidad', 'usuario')
              .prefetch_related(
                  Prefetch('levantamientos', queryset=ultimos_lev),
                  'miembros',
                  Prefetch('materiales_esperados', queryset=materiales_qs),
              )
        )

        # --- Serializar -----------------------------------------------------
        data = []
        for p in qs:
            opp = p.oportunidad if p.oportunidad_id else None
            # Último levantamiento (ya prefetched ordenado desc por fecha)
            ult_lev = None
            for lev in p.levantamientos.all():
                ult_lev = lev
                break
            jornadas = _extraer_duracion(ult_lev)

            # Días ejecución: si hay fecha_inicio y fecha_fin, los días
            # calendario entre ambas (inclusivo). Si no, 0.
            dias = 0
            if p.fecha_inicio and p.fecha_fin and p.fecha_fin >= p.fecha_inicio:
                dias = (p.fecha_fin - p.fecha_inicio).days + 1

            # Técnicos: cantidad de miembros del proyecto (no incluye al usuario
            # propietario, que ya tiene acceso por defecto via `usuario` FK).
            tecnicos = len(list(p.miembros.all()))

            # Materiales esperados: lista compacta (id, fechas, color) para
            # que el JS arme las barras del timeline sin segundo fetch.
            materiales = []
            for m in p.materiales_esperados.all():
                est = m.estado or 'pendiente_compra'
                materiales.append({
                    'id': m.id,
                    'titulo': m.titulo,
                    'fecha_inicio': m.fecha_inicio.isoformat() if m.fecha_inicio else None,
                    'fecha_fin': m.fecha_fin.isoformat() if m.fecha_fin else None,
                    'estado': est,
                    'color': MATERIAL_ESTADO_COLOR.get(est, '#9CA3AF'),
                    'confirmado_recepcion': bool(m.confirmado_recepcion),
                })

            data.append({
                'proyecto_id': p.id,
                'nombre': p.nombre,
                'cliente': p.cliente_nombre or (opp.cliente.nombre if opp and opp.cliente_id else ''),
                'status': p.status,
                'po': (opp.po_number or '').strip() if opp else '',
                'oportunidad_id': opp.id if opp else None,
                'oportunidad_nombre': opp.oportunidad if opp else '',
                'jornadas': jornadas,
                'levantamiento_id': ult_lev.id if ult_lev else None,
                'usuario_id': p.usuario_id,
                # Datos que arman los KPIs al seleccionar un proyecto.
                # `monto_po` por ahora es el monto de la oportunidad — cuando
                # conectemos OCs reales se reemplaza por suma de OCs.
                'monto_po': float(opp.monto) if opp and opp.monto is not None else 0.0,
                'utilidad': float(p.utilidad_presupuestada or 0),
                'dias_ejecucion': dias,
                'tecnicos': tecnicos,
                'materiales': materiales,
            })

        return JsonResponse({'ok': True, 'data': data})

    except Exception as e:
        logger.exception('api_control_proyectos failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


# ════════════════════════════════════════════════════════════════════════
# CRUD de MaterialEsperado (sección "Control" → barras del timeline)
#
# Todos los endpoints respetan la visibilidad de ProyectoIAMET vía
# `_proyectos_visibles_qs` (mismo criterio que api_control_proyectos).
# Permisos de edición/eliminación: solo creador, dueño del proyecto o
# supervisor (ver `_puede_editar_material`).
# ════════════════════════════════════════════════════════════════════════


@login_required
@require_http_methods(["GET"])
def api_material_lista(request):
    """GET /app/api/control/materiales/?proyecto_id=<id>

    Lista los materiales esperados de un proyecto. Si el usuario no puede
    ver el proyecto, devuelve 403.
    """
    try:
        proyecto_id = request.GET.get('proyecto_id')
        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'Falta proyecto_id.'}, status=400)
        try:
            proyecto_id = int(proyecto_id)
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'proyecto_id inválido.'}, status=400)

        proyecto = _proyecto_visible_o_none(request.user, proyecto_id)
        if not proyecto:
            return JsonResponse({'ok': False, 'error': 'Proyecto no visible.'}, status=403)

        qs = (
            MaterialEsperado.objects
            .filter(proyecto=proyecto)
            .select_related('proyecto', 'creado_por', 'confirmado_por')
            .order_by('fecha_inicio')
        )
        data = [_material_to_dict(m) for m in qs]
        return JsonResponse({'ok': True, 'data': data})
    except Exception as e:
        logger.exception('api_material_lista failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_material_crear(request):
    """POST /app/api/control/materiales/crear/

    Body JSON: {proyecto_id, titulo, fecha_inicio, fecha_fin, estado?}
    Crea el material y devuelve su serialización completa.
    """
    try:
        try:
            data = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'ok': False, 'error': 'JSON inválido.'}, status=400)

        proyecto_id = data.get('proyecto_id')
        titulo = (data.get('titulo') or '').strip()
        f_ini_raw = (data.get('fecha_inicio') or '').strip()
        f_fin_raw = (data.get('fecha_fin') or '').strip()
        estado = (data.get('estado') or 'pendiente_compra').strip()

        if not proyecto_id:
            return JsonResponse({'ok': False, 'error': 'Falta proyecto_id.'}, status=400)
        try:
            proyecto_id = int(proyecto_id)
        except (TypeError, ValueError):
            return JsonResponse({'ok': False, 'error': 'proyecto_id inválido.'}, status=400)

        if not titulo:
            return JsonResponse({'ok': False, 'error': 'El título es obligatorio.'}, status=400)
        if len(titulo) > 200:
            return JsonResponse({'ok': False, 'error': 'El título excede 200 caracteres.'}, status=400)

        f_ini = parse_date(f_ini_raw) if f_ini_raw else None
        f_fin = parse_date(f_fin_raw) if f_fin_raw else None
        if not f_ini:
            return JsonResponse({'ok': False, 'error': 'Fecha de inicio inválida.'}, status=400)
        if not f_fin:
            return JsonResponse({'ok': False, 'error': 'Fecha de fin inválida.'}, status=400)
        if f_fin < f_ini:
            return JsonResponse(
                {'ok': False, 'error': 'La fecha fin no puede ser anterior a la de inicio.'},
                status=400,
            )

        if estado not in MATERIAL_ESTADO_VALIDOS:
            estado = 'pendiente_compra'

        proyecto = _proyecto_visible_o_none(request.user, proyecto_id)
        if not proyecto:
            return JsonResponse({'ok': False, 'error': 'Proyecto no visible.'}, status=403)

        m = MaterialEsperado.objects.create(
            proyecto=proyecto,
            titulo=titulo,
            fecha_inicio=f_ini,
            fecha_fin=f_fin,
            estado=estado,
            creado_por=request.user,
        )
        return JsonResponse({'ok': True, 'material': _material_to_dict(m)})
    except Exception as e:
        logger.exception('api_material_crear failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["GET"])
def api_material_detalle(request, material_id):
    """GET /app/api/control/materiales/<id>/"""
    try:
        m = get_object_or_404(
            MaterialEsperado.objects.select_related('proyecto', 'creado_por', 'confirmado_por'),
            id=material_id,
        )
        if not _proyecto_visible_o_none(request.user, m.proyecto_id):
            return JsonResponse({'ok': False, 'error': 'No visible.'}, status=403)
        return JsonResponse({'ok': True, 'material': _material_to_dict(m)})
    except Exception as e:
        logger.exception('api_material_detalle failed (id=%s)', material_id)
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST", "PATCH"])
def api_material_actualizar(request, material_id):
    """PATCH /app/api/control/materiales/<id>/actualizar/

    Acepta también POST por compatibilidad con Django CSRF (algunos navegadores
    + middlewares manejan PATCH peor que POST). Campos opcionales:
        titulo, fecha_inicio, fecha_fin, estado, comentario_nuevo
    """
    try:
        m = get_object_or_404(
            MaterialEsperado.objects.select_related('proyecto', 'creado_por'),
            id=material_id,
        )
        if not _proyecto_visible_o_none(request.user, m.proyecto_id):
            return JsonResponse({'ok': False, 'error': 'No visible.'}, status=403)
        if not _puede_editar_material(request.user, m):
            return JsonResponse(
                {'ok': False, 'error': 'No tienes permisos para editar este material.'},
                status=403,
            )

        try:
            data = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'ok': False, 'error': 'JSON inválido.'}, status=400)

        # --- Campos simples ----------------------------------------------
        if 'titulo' in data:
            v = (data.get('titulo') or '').strip()
            if not v:
                return JsonResponse({'ok': False, 'error': 'El título no puede estar vacío.'}, status=400)
            if len(v) > 200:
                return JsonResponse({'ok': False, 'error': 'El título excede 200 caracteres.'}, status=400)
            m.titulo = v

        nueva_ini = m.fecha_inicio
        nueva_fin = m.fecha_fin
        if 'fecha_inicio' in data:
            raw = (data.get('fecha_inicio') or '').strip()
            d = parse_date(raw) if raw else None
            if not d:
                return JsonResponse({'ok': False, 'error': 'Fecha inicio inválida.'}, status=400)
            nueva_ini = d
        if 'fecha_fin' in data:
            raw = (data.get('fecha_fin') or '').strip()
            d = parse_date(raw) if raw else None
            if not d:
                return JsonResponse({'ok': False, 'error': 'Fecha fin inválida.'}, status=400)
            nueva_fin = d
        if nueva_ini and nueva_fin and nueva_fin < nueva_ini:
            return JsonResponse(
                {'ok': False, 'error': 'La fecha fin no puede ser anterior a la de inicio.'},
                status=400,
            )
        m.fecha_inicio = nueva_ini
        m.fecha_fin = nueva_fin

        if 'estado' in data:
            v = (data.get('estado') or '').strip()
            if v and v not in MATERIAL_ESTADO_VALIDOS:
                return JsonResponse({'ok': False, 'error': 'Estado inválido.'}, status=400)
            if v:
                m.estado = v

        # --- Comentario nuevo: se concatena, no se reescribe ----------------
        comentario_nuevo = (data.get('comentario_nuevo') or '').strip()
        if comentario_nuevo:
            bloque = _formatear_comentario_nuevo(request.user, comentario_nuevo)
            if m.comentarios:
                m.comentarios = m.comentarios.rstrip() + '\n---\n' + bloque
            else:
                m.comentarios = bloque

        m.save()
        # Recargar joins para el dict final
        m = MaterialEsperado.objects.select_related(
            'proyecto', 'creado_por', 'confirmado_por'
        ).get(id=m.id)
        return JsonResponse({'ok': True, 'material': _material_to_dict(m)})
    except Exception as e:
        logger.exception('api_material_actualizar failed (id=%s)', material_id)
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST", "DELETE"])
def api_material_eliminar(request, material_id):
    """DELETE /app/api/control/materiales/<id>/eliminar/

    Acepta POST también por consistencia con el patrón del proyecto.
    """
    try:
        m = get_object_or_404(
            MaterialEsperado.objects.select_related('proyecto', 'creado_por'),
            id=material_id,
        )
        if not _proyecto_visible_o_none(request.user, m.proyecto_id):
            return JsonResponse({'ok': False, 'error': 'No visible.'}, status=403)
        if not _puede_editar_material(request.user, m):
            return JsonResponse(
                {'ok': False, 'error': 'No tienes permisos para eliminar este material.'},
                status=403,
            )
        m.delete()
        return JsonResponse({'ok': True})
    except Exception as e:
        logger.exception('api_material_eliminar failed (id=%s)', material_id)
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)


@login_required
@require_http_methods(["POST"])
def api_material_confirmar_recepcion(request, material_id):
    """POST /app/api/control/materiales/<id>/confirmar-recepcion/

    Marca confirmado=True, fecha_confirmacion=now, confirmado_por=user,
    estado='recibido'. Cualquier usuario que vea el proyecto puede
    confirmar — confirmar recepción es una operación de campo, no de
    edición administrativa.
    """
    try:
        m = get_object_or_404(
            MaterialEsperado.objects.select_related('proyecto'),
            id=material_id,
        )
        if not _proyecto_visible_o_none(request.user, m.proyecto_id):
            return JsonResponse({'ok': False, 'error': 'No visible.'}, status=403)

        m.confirmado_recepcion = True
        m.fecha_confirmacion = timezone.now()
        m.confirmado_por = request.user
        m.estado = 'recibido'
        m.save()
        m = MaterialEsperado.objects.select_related(
            'proyecto', 'creado_por', 'confirmado_por'
        ).get(id=m.id)
        return JsonResponse({'ok': True, 'material': _material_to_dict(m)})
    except Exception as e:
        logger.exception('api_material_confirmar_recepcion failed (id=%s)', material_id)
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

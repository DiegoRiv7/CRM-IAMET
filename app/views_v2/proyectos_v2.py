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
import logging

from django.contrib.auth.decorators import login_required
from django.db.models import Prefetch
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from app.models import ProyectoIAMET, ProyectoLevantamiento
from app.views_utils import is_supervisor
from app.views_grupos import get_usuarios_visibles_ids

logger = logging.getLogger(__name__)


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
        # Cada proyecto: oportunidad (FK) + último levantamiento (related).
        ultimos_lev = ProyectoLevantamiento.objects.order_by('-fecha_creacion')
        qs = (
            qs.select_related('oportunidad', 'usuario')
              .prefetch_related(Prefetch('levantamientos', queryset=ultimos_lev))
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
            })

        return JsonResponse({'ok': True, 'data': data})

    except Exception as e:
        logger.exception('api_control_proyectos failed')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

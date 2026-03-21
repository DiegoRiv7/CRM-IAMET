"""
views_grupos.py — APIs para el sistema de Grupos de Trabajo.

Endpoints:
  GET  /api/grupos/                    → listar grupos
  POST /api/grupos/crear/              → crear grupo
  PUT  /api/grupos/<id>/               → editar grupo
  DELETE /api/grupos/<id>/eliminar/    → eliminar grupo
  POST /api/grupos/<id>/toggle/        → activar/desactivar
"""
import json
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.models import User

from app.models import GrupoTrabajo
from app.views_utils import is_supervisor


def _usuario_a_dict(u):
    """Serializa un User a dict compacto."""
    nombre = (u.first_name + ' ' + u.last_name).strip() or u.username
    return {'id': u.id, 'nombre': nombre, 'username': u.username}


def _grupo_a_dict(g):
    """Serializa un GrupoTrabajo a dict completo."""
    return {
        'id': g.id,
        'nombre': g.nombre,
        'descripcion': g.descripcion,
        'color': g.color,
        'activo': g.activo,
        'supervisor': _usuario_a_dict(g.supervisor_grupo) if g.supervisor_grupo else None,
        'miembros': [_usuario_a_dict(m) for m in g.miembros.all().order_by('first_name', 'last_name')],
        'fecha_creacion': g.fecha_creacion.strftime('%d/%m/%Y') if g.fecha_creacion else '',
    }


@login_required
@require_http_methods(['GET'])
def api_grupos_listar(request):
    """Lista todos los grupos de trabajo."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    grupos = GrupoTrabajo.objects.prefetch_related('miembros').select_related('supervisor_grupo').all()
    return JsonResponse({'grupos': [_grupo_a_dict(g) for g in grupos]})


@login_required
@require_http_methods(['POST'])
def api_grupos_crear(request):
    """Crea un nuevo grupo de trabajo."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return JsonResponse({'error': 'El nombre del grupo es requerido'}, status=400)

    grupo = GrupoTrabajo.objects.create(
        nombre=nombre,
        descripcion=(data.get('descripcion') or '').strip(),
        color=data.get('color') or '#007AFF',
        activo=True,
    )

    # Supervisor del grupo
    supervisor_id = data.get('supervisor_id')
    if supervisor_id:
        try:
            grupo.supervisor_grupo = User.objects.get(id=int(supervisor_id))
            grupo.save()
        except User.DoesNotExist:
            pass

    # Miembros
    miembros_ids = data.get('miembros_ids') or []
    if miembros_ids:
        grupo.miembros.set(User.objects.filter(id__in=miembros_ids))

    return JsonResponse({'success': True, 'grupo': _grupo_a_dict(grupo)})


@login_required
@require_http_methods(['PUT'])
def api_grupos_editar(request, grupo_id):
    """Edita un grupo de trabajo existente."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)

    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return JsonResponse({'error': 'El nombre del grupo es requerido'}, status=400)

    grupo.nombre = nombre
    grupo.descripcion = (data.get('descripcion') or '').strip()
    grupo.color = data.get('color') or grupo.color

    supervisor_id = data.get('supervisor_id')
    if supervisor_id:
        try:
            grupo.supervisor_grupo = User.objects.get(id=int(supervisor_id))
        except User.DoesNotExist:
            grupo.supervisor_grupo = None
    else:
        grupo.supervisor_grupo = None

    grupo.save()

    miembros_ids = data.get('miembros_ids') or []
    grupo.miembros.set(User.objects.filter(id__in=miembros_ids))

    return JsonResponse({'success': True, 'grupo': _grupo_a_dict(grupo)})


@login_required
@require_http_methods(['DELETE'])
def api_grupos_eliminar(request, grupo_id):
    """Elimina un grupo de trabajo."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)

    grupo.delete()
    return JsonResponse({'success': True})


@login_required
@require_http_methods(['POST'])
def api_grupos_toggle(request, grupo_id):
    """Activa o desactiva un grupo."""
    if not is_supervisor(request.user):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)

    grupo.activo = not grupo.activo
    grupo.save()
    return JsonResponse({'success': True, 'activo': grupo.activo})


# ─────────────────────────────────────────────────────────────────────────────
# Helper: obtener IDs de usuarios visibles para un usuario dado
# ─────────────────────────────────────────────────────────────────────────────

def get_usuarios_visibles_ids(user):
    """
    Retorna un conjunto de IDs de usuarios cuyas oportunidades puede ver `user`.

    Reglas:
    - Si es supervisor global → None (ve todo, sin filtro)
    - Si es supervisor de grupo → ve a sus miembros + a sí mismo
    - Si es miembro de un grupo → ve a sus compañeros de grupo + a sí mismo
    - Si no pertenece a ningún grupo → solo ve sus propias oportunidades
    """
    if is_supervisor(user):
        return None  # Sin restricción

    ids = {user.id}

    # Grupos donde el usuario es supervisor de grupo
    grupos_supervisados = GrupoTrabajo.objects.filter(
        supervisor_grupo=user, activo=True
    ).prefetch_related('miembros')
    for g in grupos_supervisados:
        ids.update(g.miembros.values_list('id', flat=True))
        if g.supervisor_grupo_id:
            ids.add(g.supervisor_grupo_id)

    # Grupos donde el usuario es miembro
    grupos_miembro = GrupoTrabajo.objects.filter(
        miembros=user, activo=True
    ).prefetch_related('miembros')
    for g in grupos_miembro:
        ids.update(g.miembros.values_list('id', flat=True))
        if g.supervisor_grupo_id:
            ids.add(g.supervisor_grupo_id)

    return ids

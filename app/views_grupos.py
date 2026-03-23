"""
views_grupos.py — APIs para el sistema de Grupos de Trabajo.

Endpoints (admin/supervisor global):
  GET    /api/grupos/                       → listar grupos
  POST   /api/grupos/crear/                 → crear grupo
  PUT    /api/grupos/<id>/                  → editar grupo
  DELETE /api/grupos/<id>/eliminar/         → eliminar grupo
  POST   /api/grupos/<id>/toggle/           → activar/desactivar

Endpoints (supervisor de grupo):
  POST   /api/grupos/<id>/miembros/agregar/ → agregar miembro
  DELETE /api/grupos/<id>/miembros/<uid>/   → quitar miembro
  PATCH  /api/grupos/<id>/renombrar/        → renombrar grupo

Endpoints (miembros + supervisores):
  GET    /api/grupos/mis-grupos/            → grupos del usuario actual
  GET    /api/grupos/<id>/chat/             → mensajes del grupo
  POST   /api/grupos/<id>/chat/enviar/      → enviar mensaje
  POST   /api/grupos/<id>/chat/leer/        → marcar leído
  GET    /api/grupos/<id>/no-leidos/        → conteo de no leídos
"""
import json
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.models import User
from django.db.models import Q

from app.models import GrupoTrabajo, MensajeGrupo, LecturaGrupo
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


def comparten_grupo(user1, user2):
    """True si user1 puede actuar sobre contenido de user2 por ser del mismo grupo activo."""
    if user1.id == user2.id:
        print(f"[comparten_grupo] mismo usuario ({user1.id}), False")
        return False
    if is_supervisor(user1):
        print(f"[comparten_grupo] {user1} es supervisor global, True")
        return True
    # Query directa: busca un grupo activo que contenga a ambos
    grupos_user1 = list(GrupoTrabajo.objects.filter(
        Q(miembros=user1) | Q(supervisor_grupo=user1), activo=True
    ).values_list('id', flat=True))
    print(f"[comparten_grupo] {user1} grupos activos: {grupos_user1}")
    if not grupos_user1:
        print(f"[comparten_grupo] {user1} no tiene grupos, False")
        return False
    resultado = GrupoTrabajo.objects.filter(
        id__in=grupos_user1
    ).filter(
        Q(miembros=user2) | Q(supervisor_grupo=user2)
    ).exists()
    print(f"[comparten_grupo] {user1} + {user2} comparten grupo: {resultado}")
    return resultado


def usuario_puede_acceder_grupo(user, grupo):
    """True si el usuario es miembro, supervisor del grupo, o supervisor global."""
    if is_supervisor(user):
        return True
    if grupo.supervisor_grupo_id == user.id:
        return True
    return grupo.miembros.filter(id=user.id).exists()


def get_grupos_del_usuario(user):
    """Devuelve los grupos activos donde participa el usuario (como miembro o supervisor de grupo)."""
    if is_supervisor(user):
        return GrupoTrabajo.objects.filter(activo=True).prefetch_related('miembros').select_related('supervisor_grupo')
    return GrupoTrabajo.objects.filter(
        Q(miembros=user) | Q(supervisor_grupo=user), activo=True
    ).distinct().prefetch_related('miembros').select_related('supervisor_grupo')


def puede_gestionar_grupo(user, grupo):
    """True si puede agregar/quitar miembros y renombrar el grupo."""
    return is_supervisor(user) or grupo.supervisor_grupo_id == user.id


def _no_leidos_grupo(user, grupo):
    """Cuántos mensajes no leídos tiene el usuario en este grupo."""
    try:
        lectura = LecturaGrupo.objects.get(usuario=user, grupo=grupo)
        ultimo_id = lectura.ultimo_leido_id or 0
    except LecturaGrupo.DoesNotExist:
        ultimo_id = 0
    return MensajeGrupo.objects.filter(grupo=grupo, id__gt=ultimo_id).exclude(autor=user).count()


def _serializar_mensaje(msg, request_user=None):
    autor_nombre = None
    autor_username = None
    if msg.autor:
        autor_nombre = (msg.autor.first_name + ' ' + msg.autor.last_name).strip() or msg.autor.username
        autor_username = msg.autor.username
    return {
        'id': msg.id,
        'tipo': msg.tipo,
        'contenido': msg.contenido,
        'autor_nombre': autor_nombre,
        'autor_username': autor_username,
        'es_mio': request_user and msg.autor_id == request_user.id,
        'accion': msg.accion,
        'objeto_tipo': msg.objeto_tipo,
        'objeto_id': msg.objeto_id,
        'objeto_titulo': msg.objeto_titulo,
        'fecha': msg.fecha.strftime('%d/%m/%Y %H:%M'),
        'fecha_iso': msg.fecha.isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helper público: crear mensaje de sistema en todos los grupos compartidos
# ─────────────────────────────────────────────────────────────────────────────

def registrar_accion_grupo(actor, propietario, accion, contenido, objeto_tipo='', objeto_id=None, objeto_titulo=''):
    """
    Crea un mensaje de sistema en todos los grupos activos que contengan
    tanto a `actor` como a `propietario`. Si son la misma persona, no registra.
    """
    if actor.id == propietario.id:
        return
    grupos = GrupoTrabajo.objects.filter(activo=True).prefetch_related('miembros')
    for g in grupos:
        todos_ids = set(g.miembros.values_list('id', flat=True))
        if g.supervisor_grupo_id:
            todos_ids.add(g.supervisor_grupo_id)
        if actor.id in todos_ids and propietario.id in todos_ids:
            MensajeGrupo.objects.create(
                grupo=g,
                autor=actor,
                tipo='sistema',
                contenido=contenido,
                accion=accion,
                objeto_tipo=objeto_tipo,
                objeto_id=objeto_id,
                objeto_titulo=objeto_titulo,
            )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints: mis grupos + chat
# ─────────────────────────────────────────────────────────────────────────────

@login_required
@require_http_methods(['GET'])
def api_mis_grupos(request):
    """Devuelve los grupos del usuario actual con conteo de no leídos."""
    grupos = get_grupos_del_usuario(request.user)
    resultado = []
    for g in grupos:
        no_leidos = _no_leidos_grupo(request.user, g)
        resultado.append({**_grupo_a_dict(g), 'no_leidos': no_leidos})
    return JsonResponse({'grupos': resultado})


@login_required
@require_http_methods(['GET'])
def api_grupo_chat(request, grupo_id):
    """Lista los mensajes de un grupo. Solo accesible a miembros."""
    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)
    if not usuario_puede_acceder_grupo(request.user, grupo):
        return JsonResponse({'error': 'Sin acceso'}, status=403)

    desde_id = request.GET.get('desde_id')
    qs = MensajeGrupo.objects.filter(grupo=grupo).select_related('autor').order_by('fecha')
    if desde_id:
        qs = qs.filter(id__gt=int(desde_id))
    else:
        qs = qs.order_by('-fecha')[:60]
        qs = list(reversed(list(qs)))

    mensajes = [_serializar_mensaje(m, request.user) for m in qs]
    return JsonResponse({'mensajes': mensajes, 'grupo': _grupo_a_dict(grupo)})


@login_required
@require_http_methods(['POST'])
def api_grupo_chat_enviar(request, grupo_id):
    """Envía un mensaje al chat del grupo."""
    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)
    if not usuario_puede_acceder_grupo(request.user, grupo):
        return JsonResponse({'error': 'Sin acceso'}, status=403)

    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    contenido = (data.get('contenido') or '').strip()
    if not contenido:
        return JsonResponse({'error': 'Mensaje vacío'}, status=400)

    msg = MensajeGrupo.objects.create(
        grupo=grupo,
        autor=request.user,
        tipo='mensaje',
        contenido=contenido,
    )

    # Notificar a los demás miembros del grupo
    try:
        from .models import Notificacion
        autor_nombre = (request.user.get_full_name() or request.user.username)
        todos_ids = set(grupo.miembros.values_list('id', flat=True))
        if grupo.supervisor_grupo_id:
            todos_ids.add(grupo.supervisor_grupo_id)
        todos_ids.discard(request.user.id)
        for uid in todos_ids:
            try:
                dest = User.objects.get(id=uid)
                Notificacion.objects.create(
                    usuario_destinatario=dest,
                    usuario_remitente=request.user,
                    tipo='mensaje_grupo',
                    titulo=f'{autor_nombre} en {grupo.nombre}',
                    mensaje=contenido[:120],
                )
            except Exception:
                pass
    except Exception:
        pass

    return JsonResponse({'success': True, 'mensaje': _serializar_mensaje(msg, request.user)})


@login_required
@require_http_methods(['POST'])
def api_grupo_chat_leer(request, grupo_id):
    """Marca todos los mensajes del grupo como leídos por el usuario."""
    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)
    if not usuario_puede_acceder_grupo(request.user, grupo):
        return JsonResponse({'error': 'Sin acceso'}, status=403)

    ultimo = MensajeGrupo.objects.filter(grupo=grupo).order_by('-fecha').first()
    if ultimo:
        LecturaGrupo.objects.update_or_create(
            usuario=request.user, grupo=grupo,
            defaults={'ultimo_leido': ultimo}
        )
    return JsonResponse({'success': True})


@login_required
@require_http_methods(['GET'])
def api_grupo_no_leidos(request, grupo_id):
    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)
    if not usuario_puede_acceder_grupo(request.user, grupo):
        return JsonResponse({'error': 'Sin acceso'}, status=403)
    return JsonResponse({'no_leidos': _no_leidos_grupo(request.user, grupo)})


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints: gestión de miembros (supervisor de grupo + supervisor global)
# ─────────────────────────────────────────────────────────────────────────────

@login_required
@require_http_methods(['POST'])
def api_grupo_agregar_miembro(request, grupo_id):
    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)
    if not puede_gestionar_grupo(request.user, grupo):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = int(data.get('user_id'))
        usuario = User.objects.get(id=user_id)
    except Exception:
        return JsonResponse({'error': 'Usuario inválido'}, status=400)

    grupo.miembros.add(usuario)
    return JsonResponse({'success': True, 'grupo': _grupo_a_dict(grupo)})


@login_required
@require_http_methods(['DELETE'])
def api_grupo_quitar_miembro(request, grupo_id, user_id):
    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)
    if not puede_gestionar_grupo(request.user, grupo):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    try:
        usuario = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return JsonResponse({'error': 'Usuario no encontrado'}, status=404)

    grupo.miembros.remove(usuario)
    return JsonResponse({'success': True, 'grupo': _grupo_a_dict(grupo)})


@login_required
@require_http_methods(['PATCH'])
def api_grupo_renombrar(request, grupo_id):
    try:
        grupo = GrupoTrabajo.objects.get(id=grupo_id)
    except GrupoTrabajo.DoesNotExist:
        return JsonResponse({'error': 'Grupo no encontrado'}, status=404)
    if not puede_gestionar_grupo(request.user, grupo):
        return JsonResponse({'error': 'Sin permisos'}, status=403)

    try:
        data = json.loads(request.body)
    except Exception:
        return JsonResponse({'error': 'JSON inválido'}, status=400)

    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return JsonResponse({'error': 'Nombre requerido'}, status=400)

    grupo.nombre = nombre
    grupo.save(update_fields=['nombre'])
    return JsonResponse({'success': True, 'grupo': _grupo_a_dict(grupo)})

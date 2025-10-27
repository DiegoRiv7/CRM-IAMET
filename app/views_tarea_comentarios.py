# ======= APIs PARA COMENTARIOS DE TAREAS =======

from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from .models import Tarea, TareaComentario, TareaArchivo, Notificacion


def crear_notificacion(usuario_destinatario, tipo, titulo, mensaje, tarea_id=None, tarea_titulo=None, usuario_remitente=None):
    """
    Función de utilidad para crear notificaciones
    """
    try:
        notificacion = Notificacion.objects.create(
            usuario_destinatario=usuario_destinatario,
            usuario_remitente=usuario_remitente,
            tipo=tipo,
            titulo=titulo,
            mensaje=mensaje,
            tarea_id=tarea_id,
            tarea_titulo=tarea_titulo
        )
        return notificacion
    except Exception as e:
        print(f"Error creando notificación: {e}")
        return None


def api_comentarios_tarea(request, tarea_id):
    """
    API para obtener comentarios de una tarea
    """
    try:
        print(f"🔍 === API COMENTARIOS TAREA ===")
        print(f"🔍 Tarea ID: {tarea_id}")
        print(f"🔍 Usuario: {request.user}")
        print(f"🔍 Método: {request.method}")
        
        tarea = get_object_or_404(Tarea, id=tarea_id)
        print(f"🔍 Tarea encontrada: {tarea.titulo}")
        
        # Verificar permisos - el usuario debe ser participante, creador o asignado
        print(f"🔍 Verificando permisos para usuario: {request.user}")
        print(f"🔍 Creado por: {tarea.creado_por}")
        print(f"🔍 Asignado a: {tarea.asignado_a}")
        print(f"🔍 Es superuser: {request.user.is_superuser}")
        
        user_can_view = (
            request.user == tarea.creado_por or
            request.user == tarea.asignado_a or
            request.user in tarea.participantes.all() or
            request.user in tarea.observadores.all() or
            request.user.is_superuser
        )
        
        print(f"🔍 Puede ver tarea: {user_can_view}")
        
        if not user_can_view:
            print(f"❌ Usuario sin permisos: {request.user}")
            return JsonResponse({'error': 'Sin permisos para ver esta tarea'}, status=403)
        
        # Obtener comentarios ordenados por fecha
        print(f"🔍 Obteniendo comentarios para tarea {tarea_id}")
        comentarios = TareaComentario.objects.filter(tarea=tarea).order_by('fecha_creacion')
        print(f"🔍 Comentarios encontrados: {comentarios.count()}")
        
        comentarios_data = []
        for comentario in comentarios:
            # Obtener datos del usuario
            user_profile = getattr(comentario.usuario, 'userprofile', None)
            avatar_url = user_profile.get_avatar_url() if user_profile else None
            
            comentarios_data.append({
                'id': comentario.id,
                'contenido': comentario.contenido,
                'contenido_con_menciones': comentario.get_contenido_con_menciones(),
                'fecha_creacion': comentario.fecha_creacion.isoformat(),
                'fecha_edicion': comentario.fecha_edicion.isoformat() if comentario.fecha_edicion else None,
                'editado': comentario.editado,
                'usuario': {
                    'id': comentario.usuario.id,
                    'username': comentario.usuario.username,
                    'nombre': comentario.usuario.get_full_name() or comentario.usuario.username,
                    'avatar_url': avatar_url
                },
                'archivos': [
                    {
                        'id': archivo.id,
                        'nombre_original': archivo.nombre_original,
                        'url': archivo.archivo.url,
                        'tamaño': archivo.tamaño,
                        'tipo_contenido': archivo.tipo_contenido
                    } for archivo in comentario.archivos.all()
                ]
            })
        
        print(f"🔍 Devolviendo {len(comentarios_data)} comentarios")
        return JsonResponse({
            'success': True,
            'comentarios': comentarios_data
        })
        
    except Exception as e:
        print(f"❌ ERROR en api_comentarios_tarea: {str(e)}")
        import traceback
        print(f"❌ Traceback: {traceback.format_exc()}")
        return JsonResponse({'error': str(e)}, status=500)


def api_agregar_comentario_tarea(request, tarea_id):
    """
    API para agregar un comentario a una tarea
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        tarea = get_object_or_404(Tarea, id=tarea_id)
        
        # Verificar permisos
        user_can_comment = (
            request.user == tarea.creado_por or
            request.user == tarea.asignado_a or
            request.user in tarea.participantes.all() or
            request.user in tarea.observadores.all() or
            request.user.is_superuser
        )
        
        if not user_can_comment:
            return JsonResponse({'error': 'Sin permisos para comentar en esta tarea'}, status=403)
        
        # Obtener contenido del comentario
        contenido = request.POST.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'error': 'El contenido del comentario es requerido'}, status=400)
        
        # Crear el comentario
        comentario = TareaComentario.objects.create(
            tarea=tarea,
            usuario=request.user,
            contenido=contenido
        )
        
        # Manejar archivos adjuntos si existen
        archivos_data = []
        for key, file in request.FILES.items():
            if key.startswith('archivo_'):
                archivo = TareaArchivo.objects.create(
                    comentario=comentario,
                    archivo=file,
                    nombre_original=file.name,
                    tamaño=file.size,
                    tipo_contenido=file.content_type or 'application/octet-stream'
                )
                archivos_data.append({
                    'id': archivo.id,
                    'nombre_original': archivo.nombre_original,
                    'url': archivo.archivo.url,
                    'tamaño': archivo.tamaño,
                    'tipo_contenido': archivo.tipo_contenido
                })
        
        # Crear notificaciones para usuarios mencionados
        usuarios_mencionados = comentario.extraer_menciones()
        for usuario_mencionado in usuarios_mencionados:
            if usuario_mencionado != request.user:  # No notificar al autor
                crear_notificacion(
                    usuario_destinatario=usuario_mencionado,
                    tipo='tarea_mencion',
                    titulo=f'Te mencionaron en {tarea.titulo}',
                    mensaje=f'{request.user.get_full_name() or request.user.username} te mencionó en un comentario',
                    tarea_id=tarea.id,
                    tarea_titulo=tarea.titulo,
                    usuario_remitente=request.user
                )
        
        # Notificar a otros participantes (excepto al autor del comentario)
        usuarios_a_notificar = set()
        if tarea.creado_por != request.user:
            usuarios_a_notificar.add(tarea.creado_por)
        if tarea.asignado_a and tarea.asignado_a != request.user:
            usuarios_a_notificar.add(tarea.asignado_a)
        for participante in tarea.participantes.all():
            if participante != request.user:
                usuarios_a_notificar.add(participante)
        for observador in tarea.observadores.all():
            if observador != request.user:
                usuarios_a_notificar.add(observador)
        
        for usuario in usuarios_a_notificar:
            crear_notificacion(
                usuario_destinatario=usuario,
                tipo='tarea_comentario',
                titulo=f'Nuevo comentario en {tarea.titulo}',
                mensaje=f'{request.user.get_full_name() or request.user.username} agregó un comentario',
                tarea_id=tarea.id,
                tarea_titulo=tarea.titulo,
                usuario_remitente=request.user
            )
        
        # Obtener datos del usuario para la respuesta
        user_profile = getattr(request.user, 'userprofile', None)
        avatar_url = user_profile.get_avatar_url() if user_profile else None
        
        return JsonResponse({
            'success': True,
            'comentario': {
                'id': comentario.id,
                'contenido': comentario.contenido,
                'contenido_con_menciones': comentario.get_contenido_con_menciones(),
                'fecha_creacion': comentario.fecha_creacion.isoformat(),
                'fecha_edicion': None,
                'editado': False,
                'usuario': {
                    'id': request.user.id,
                    'username': request.user.username,
                    'nombre': request.user.get_full_name() or request.user.username,
                    'avatar_url': avatar_url
                },
                'archivos': archivos_data
            }
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


def api_editar_comentario_tarea(request, comentario_id):
    """
    API para editar un comentario de tarea
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(TareaComentario, id=comentario_id)
        
        # Verificar permisos (solo el autor puede editar)
        if request.user != comentario.usuario and not request.user.is_superuser:
            return JsonResponse({'error': 'Sin permisos para editar este comentario'}, status=403)
        
        # Obtener nuevo contenido
        nuevo_contenido = request.POST.get('contenido', '').strip()
        if not nuevo_contenido:
            return JsonResponse({'error': 'El contenido del comentario es requerido'}, status=400)
        
        # Actualizar comentario
        comentario.contenido = nuevo_contenido
        comentario.save()  # Esto activará el método save() personalizado que marca como editado
        
        return JsonResponse({
            'success': True,
            'comentario': {
                'id': comentario.id,
                'contenido': comentario.contenido,
                'contenido_con_menciones': comentario.get_contenido_con_menciones(),
                'fecha_edicion': comentario.fecha_edicion.isoformat(),
                'editado': comentario.editado
            }
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


def api_eliminar_comentario_tarea(request, comentario_id):
    """
    API para eliminar un comentario de tarea
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(TareaComentario, id=comentario_id)
        
        # Verificar permisos (autor del comentario o creador de la tarea)
        if (request.user != comentario.usuario and 
            request.user != comentario.tarea.creado_por and 
            not request.user.is_superuser):
            return JsonResponse({'error': 'Sin permisos para eliminar este comentario'}, status=403)
        
        comentario.delete()
        
        return JsonResponse({'success': True, 'message': 'Comentario eliminado correctamente'})
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
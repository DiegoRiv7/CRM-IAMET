# ----------------------------------------------------------------------
# views_auth.py — Autenticación, perfil y configuración de usuario.
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
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from django.utils import timezone
from decimal import Decimal
import decimal
from django.utils.html import json_script

# Helper function to detect lost opportunities
from .views_utils import *

def register(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect('home') # Redirigir a 'home' después de registrar e iniciar sesión
    else:
        form = UserCreationForm()
    return render(request, 'register.html', {'form': form})


@csrf_exempt
def user_login(request):
    if request.method == 'POST':
        username_input = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')

        # Si el usuario escribió un correo, buscar el username asociado
        if '@' in username_input:
            from django.contrib.auth.models import User as AuthUser
            found_user = AuthUser.objects.filter(email__iexact=username_input).first()
            if found_user:
                username_input = found_user.username

        # Crear datos modificados con el username correcto
        post_data = request.POST.copy()
        post_data['username'] = username_input

        form = AuthenticationForm(request, data=post_data)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            if request.POST.get('remember'):
                request.session.set_expiry(1209600)  # 2 semanas
            else:
                request.session.set_expiry(0)  # Expira al cerrar el navegador
            return redirect(settings.LOGIN_REDIRECT_URL)
    else:
        form = AuthenticationForm()
    return render(request, 'login.html', {'form': form, 'hide_dock': True})


@require_POST
def solicitar_reset_password(request):
    try:
        import json
        data = json.loads(request.body)
        username = data.get('username', '').strip()
    except Exception:
        return JsonResponse({'status': 'error', 'message': 'Solicitud inválida.'}, status=400)

    if not username:
        return JsonResponse({'status': 'error', 'message': 'El nombre de usuario es requerido.'}, status=400)

    from django.contrib.auth.models import User as AuthUser
    from .models import Notificacion

    try:
        usuario = AuthUser.objects.get(username=username)
    except AuthUser.DoesNotExist:
        # Respuesta genérica para no revelar si el usuario existe
        return JsonResponse({'status': 'ok', 'message': 'Si el usuario existe, la solicitud fue enviada a los supervisores.'})

    supervisores = AuthUser.objects.filter(is_superuser=True)
    if not supervisores.exists():
        return JsonResponse({'status': 'error', 'message': 'No hay supervisores disponibles. Contacta al administrador.'}, status=500)

    titulo = f"Solicitud de restablecimiento de contraseña"
    mensaje = (
        f"El usuario '{usuario.username}' ha solicitado un restablecimiento de contraseña. "
        f"Por favor, autorice y gestione el cambio."
    )

    for supervisor in supervisores:
        Notificacion.objects.create(
            usuario_destinatario=supervisor,
            usuario_remitente=None,
            tipo='sistema',
            titulo=titulo,
            mensaje=mensaje,
        )

    return JsonResponse({'status': 'ok', 'message': 'Solicitud enviada. Un supervisor se pondrá en contacto contigo pronto.'})


@login_required
def user_logout(request):
    logout(request)
    return redirect('user_login')


def set_language(request):
    """
    Vista para cambiar el idioma de la aplicación
    Soporta tanto peticiones AJAX como formularios normales
    """
    logger = logging.getLogger(__name__)
    
    try:
        # Verificar método HTTP
        if request.method != 'POST':
            logger.warning('Intento de acceso con método no permitido: %s', request.method)
            return JsonResponse(
                {'status': 'error', 'message': 'Método no permitido'}, 
                status=405
            )
        
        # Obtener el idioma solicitado
        language = request.POST.get('language', 'es')
        logger.info('Solicitud de cambio de idioma a: %s', language)
        
        # Validar que el idioma esté en los idiomas configurados
        available_languages = [lang[0] for lang in settings.LANGUAGES]
        if language not in available_languages:
            logger.warning('Idioma no válido: %s. Idiomas disponibles: %s', language, available_languages)
            language = 'es'  # Valor por defecto
        
        # Activar el idioma para esta sesión
        translation.activate(language)
        logger.debug('Idioma activado: %s', language)
        
        # Configurar el idioma en la sesión
        if hasattr(request, 'session'):
            request.session[LANGUAGE_SESSION_KEY] = language
            request.session.modified = True
            logger.debug('Idioma guardado en la sesión')
        
        # Guardar en el perfil del usuario si está autenticado
        if request.user.is_authenticated:
            try:
                if hasattr(request.user, 'userprofile'):
                    request.user.userprofile.language = language
                    request.user.userprofile.save()
                    logger.debug('Idioma guardado en el perfil del usuario')
            except Exception as e:
                logger.error('Error al guardar el idioma en el perfil del usuario: %s', str(e), exc_info=True)
        
        # Determinar si es una petición AJAX
        is_ajax = request.headers.get('X-Requested-With') == 'XMLHttpRequest' or \
                 request.content_type == 'application/json' or \
                 request.META.get('HTTP_ACCEPT') == 'application/json'
        
        # Configurar la respuesta
        if is_ajax:
            response_data = {
                'status': 'success', 
                'language': language,
                'message': 'Idioma cambiado correctamente',
                'redirect': request.META.get('HTTP_REFERER', '/')
            }
            response = JsonResponse(response_data)
        else:
            # Para formularios normales, redirigir a la página anterior o a la raíz
            next_url = request.POST.get('next', request.META.get('HTTP_REFERER', '/'))
            response = redirect(next_url)
        
        # Configurar la cookie de idioma
        response.set_cookie(
            settings.LANGUAGE_COOKIE_NAME,
            language,
            max_age=365 * 24 * 60 * 60,  # 1 año
            path=settings.LANGUAGE_COOKIE_PATH or '/',
            domain=settings.LANGUAGE_COOKIE_DOMAIN or None,
            secure=request.is_secure(),
            httponly=True,
            samesite='Lax'
        )
        
        logger.info('Cambio de idioma exitoso a: %s', language)
        return response
    
    except Exception as e:
        # Registrar el error completo para depuración
        logger.error('Error al cambiar el idioma', exc_info=True)
        
        # Devolver un mensaje de error genérico al cliente
        return JsonResponse(
            {'status': 'error', 'message': 'Error interno del servidor'},
            status=500
        )

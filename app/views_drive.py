# ----------------------------------------------------------------------
# views_drive.py — Drive de archivos: carpetas y archivos de proyectos/oportunidades.
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

@csrf_exempt
@login_required
def api_carpetas_proyecto(request, proyecto_id):
    """API para listar carpetas de un proyecto y crear nuevas carpetas"""
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        
        if request.method == 'GET':
            parent_id = request.GET.get('parent')
            if parent_id:
                carpetas = CarpetaProyecto.objects.filter(
                    proyecto=proyecto,
                    carpeta_padre_id=parent_id
                ).order_by('nombre')
            else:
                # Carpetas raíz (sin padre)
                carpetas = CarpetaProyecto.objects.filter(
                    proyecto=proyecto,
                    carpeta_padre__isnull=True
                ).order_by('nombre')
            
            carpetas_data = []
            for carpeta in carpetas:
                carpetas_data.append({
                    'id': carpeta.id,
                    'nombre': carpeta.nombre,
                    'fecha_creacion': carpeta.fecha_creacion.isoformat(),
                    'fecha_modificacion': carpeta.fecha_modificacion.isoformat(),
                    'creado_por': carpeta.creado_por.get_full_name() or carpeta.creado_por.username,
                    'carpeta_padre_id': carpeta.carpeta_padre_id,
                    'tipo': 'carpeta'
                })
            
            # También incluir archivos en la carpeta actual
            if parent_id:
                archivos = ArchivoProyecto.objects.filter(
                    proyecto=proyecto,
                    carpeta_id=parent_id
                ).order_by('nombre_original')
            else:
                # Archivos en raíz (sin carpeta)
                archivos = ArchivoProyecto.objects.filter(
                    proyecto=proyecto,
                    carpeta__isnull=True
                ).order_by('nombre_original')
            
            archivos_data = []
            for archivo in archivos:
                archivos_data.append({
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'tipo_archivo': archivo.tipo_archivo,
                    'tamaño': archivo.tamaño,
                    'extension': archivo.extension,
                    'fecha_subida': archivo.fecha_subida.isoformat(),
                    'subido_por': archivo.subido_por.get_full_name() or archivo.subido_por.username,
                    'es_publico': archivo.es_publico,
                    'descripcion': archivo.descripcion,
                    'url': f'/app/api/proyecto/{proyecto_id}/archivo/{archivo.id}/stream/',
                    'tipo': 'archivo'
                })
            
            # Obtener información de la carpeta actual si estamos en una subcarpeta
            carpeta_actual = None
            if parent_id:
                try:
                    carpeta_obj = CarpetaProyecto.objects.get(id=parent_id)
                    carpeta_actual = {
                        'id': carpeta_obj.id,
                        'nombre': carpeta_obj.nombre
                    }
                except CarpetaProyecto.DoesNotExist:
                    pass
            
            return JsonResponse({
                'success': True,
                'carpetas': carpetas_data,
                'archivos': archivos_data,
                'carpeta_actual': carpeta_actual
            })
        
        elif request.method == 'POST':
            data = json.loads(request.body)
            nombre = data.get('nombre')
            parent_id = data.get('parent_id')
            
            print(f"📂 Creando carpeta: {nombre} en proyecto {proyecto_id}, parent: {parent_id}")
            
            if not nombre:
                return JsonResponse({'error': 'Nombre de carpeta requerido'}, status=400)
            
            # Verificar que no exista una carpeta con el mismo nombre en el mismo nivel
            carpeta_padre = None
            if parent_id:
                carpeta_padre = get_object_or_404(CarpetaProyecto, id=parent_id)
            
            if CarpetaProyecto.objects.filter(
                proyecto=proyecto,
                carpeta_padre=carpeta_padre,
                nombre=nombre
            ).exists():
                return JsonResponse({'error': 'Ya existe una carpeta con ese nombre'}, status=400)
            
            carpeta = CarpetaProyecto.objects.create(
                nombre=nombre,
                proyecto=proyecto,
                carpeta_padre=carpeta_padre,
                creado_por=request.user
            )
            
            print(f"✅ Carpeta creada exitosamente: ID={carpeta.id}, Nombre={carpeta.nombre}")
            
            return JsonResponse({
                'success': True,
                'carpeta': {
                    'id': carpeta.id,
                    'nombre': carpeta.nombre,
                    'fecha_creacion': carpeta.fecha_creacion.isoformat(),
                    'creado_por': carpeta.creado_por.get_full_name() or carpeta.creado_por.username,
                    'carpeta_padre_id': carpeta.carpeta_padre_id,
                    'tipo': 'carpeta'
                }
            })
            
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
def api_carpeta_detalle(request, proyecto_id, carpeta_id):
    """API para obtener, actualizar y eliminar una carpeta específica"""
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        carpeta = get_object_or_404(CarpetaProyecto, id=carpeta_id, proyecto=proyecto)
        
        if request.method == 'GET':
            return JsonResponse({
                'success': True,
                'carpeta': {
                    'id': carpeta.id,
                    'nombre': carpeta.nombre,
                    'fecha_creacion': carpeta.fecha_creacion.isoformat(),
                    'fecha_modificacion': carpeta.fecha_modificacion.isoformat(),
                    'creado_por': carpeta.creado_por.get_full_name() or carpeta.creado_por.username,
                    'carpeta_padre_id': carpeta.carpeta_padre_id
                }
            })
        
        elif request.method == 'PUT':
            data = json.loads(request.body)
            nuevo_nombre = data.get('nombre')
            
            if not nuevo_nombre:
                return JsonResponse({'error': 'Nombre requerido'}, status=400)
            
            # Verificar que no exista otra carpeta con el mismo nombre
            if CarpetaProyecto.objects.filter(
                proyecto=proyecto,
                carpeta_padre=carpeta.carpeta_padre,
                nombre=nuevo_nombre
            ).exclude(id=carpeta_id).exists():
                return JsonResponse({'error': 'Ya existe una carpeta con ese nombre'}, status=400)
            
            carpeta.nombre = nuevo_nombre
            carpeta.save()
            
            return JsonResponse({
                'success': True,
                'carpeta': {
                    'id': carpeta.id,
                    'nombre': carpeta.nombre,
                    'fecha_modificacion': carpeta.fecha_modificacion.isoformat()
                }
            })
        
        elif request.method == 'DELETE':
            force_delete = request.GET.get('force', 'false').lower() == 'true'
            
            # Si no es forzado, verificar que la carpeta esté vacía
            if not force_delete and (carpeta.subcarpetas.exists() or carpeta.archivos.exists()):
                return JsonResponse({'error': 'No se puede eliminar una carpeta que contiene archivos o subcarpetas'}, status=400)
            
            # Si es eliminación forzada, eliminar recursivamente todo el contenido
            if force_delete:
                # Eliminar todos los archivos de la carpeta
                for archivo in carpeta.archivos.all():
                    # Eliminar archivo físico
                    if archivo.archivo:
                        try:
                            archivo.archivo.delete(save=False)
                        except:
                            pass  # Ignorar errores al eliminar archivo físico
                    archivo.delete()
                
                # Eliminar subcarpetas recursivamente
                def eliminar_carpeta_recursiva(carpeta_obj):
                    # Eliminar archivos de esta carpeta
                    for archivo in carpeta_obj.archivos.all():
                        if archivo.archivo:
                            try:
                                archivo.archivo.delete(save=False)
                            except:
                                pass
                        archivo.delete()
                    
                    # Eliminar subcarpetas recursivamente
                    for subcarpeta in carpeta_obj.subcarpetas.all():
                        eliminar_carpeta_recursiva(subcarpeta)
                        subcarpeta.delete()
                
                eliminar_carpeta_recursiva(carpeta)
            
            carpeta.delete()
            return JsonResponse({'success': True, 'message': 'Carpeta eliminada' + (' forzadamente' if force_delete else '')})
            
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
def api_archivos_proyecto(request, proyecto_id):
    """API para subir archivos a un proyecto - Usando lógica exitosa de oportunidades"""
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        print(f"🏗️ Procesando archivos para proyecto: {proyecto.nombre} (ID: {proyecto_id})")
        
        if request.method == 'POST':
            carpeta_id = request.POST.get('carpeta_id')
            descripcion = request.POST.get('descripcion', '')
            es_publico = request.POST.get('es_publico', 'true').lower() == 'true'
            archivo_file = request.FILES.get('archivo')
            
            if not archivo_file:
                return JsonResponse({'error': 'Archivo requerido'}, status=400)
            
            carpeta = None
            if carpeta_id:
                carpeta = get_object_or_404(CarpetaProyecto, id=carpeta_id, proyecto=proyecto)
            
            # Usar lógica simplificada similar a OportunidadArchivo que funciona
            print(f"📁 Subiendo archivo: {archivo_file.name} (Tamaño: {archivo_file.size} bytes)")
            
            # Detectar tipo de archivo simplificado
            content_type = archivo_file.content_type or ''
            extension = archivo_file.name.split('.')[-1].lower() if '.' in archivo_file.name else ''
            
            # Determinar tipo basado en extensión (similar a oportunidades)
            if extension in ['pdf']:
                tipo_archivo = 'pdf'
            elif extension in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg']:
                tipo_archivo = 'imagen'
            elif extension in ['doc', 'docx', 'txt', 'rtf', 'odt']:
                tipo_archivo = 'documento'
            elif extension in ['xls', 'xlsx', 'csv', 'ods']:
                tipo_archivo = 'hoja_calculo'
            elif extension in ['ppt', 'pptx', 'odp']:
                tipo_archivo = 'presentacion'
            elif extension in ['mp4', 'avi', 'mov', 'wmv']:
                tipo_archivo = 'video'
            elif extension in ['mp3', 'wav', 'aac', 'flac']:
                tipo_archivo = 'audio'
            elif extension in ['zip', 'rar', '7z', 'tar', 'gz']:
                tipo_archivo = 'archivo_comprimido'
            else:
                tipo_archivo = 'otro'
            
            print(f"📋 Tipo determinado: {tipo_archivo}")
            
            try:
                # Crear registro de archivo siguiendo el patrón exitoso de oportunidades
                archivo = ArchivoProyecto.objects.create(
                    nombre_original=archivo_file.name,
                    archivo=archivo_file,
                    tipo_archivo=tipo_archivo,
                    tamaño=archivo_file.size,
                    proyecto=proyecto,
                    carpeta=carpeta,
                    subido_por=request.user,
                    descripcion=descripcion or f"Archivo subido a {'carpeta' if carpeta else 'raíz'}",
                    es_publico=es_publico,
                    extension=extension,
                    mime_type=content_type
                )
                
                print(f"✅ Archivo guardado exitosamente: ID={archivo.id}, URL={archivo.archivo.url}")
                
            except Exception as e:
                print(f"❌ Error guardando archivo {archivo_file.name}: {e}")
                import traceback
                print(traceback.format_exc())
                return JsonResponse({'error': f'Error guardando archivo: {str(e)}'}, status=500)
            
            return JsonResponse({
                'success': True,
                'archivo': {
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'tipo_archivo': archivo.tipo_archivo,
                    'tamaño': archivo.tamaño,
                    'extension': archivo.extension,
                    'fecha_subida': archivo.fecha_subida.isoformat(),
                    'subido_por': archivo.subido_por.get_full_name() or archivo.subido_por.username,
                    'es_publico': archivo.es_publico,
                    'descripcion': archivo.descripcion,
                    'url': f'/app/api/proyecto/{proyecto_id}/archivo/{archivo.id}/stream/',
                    'tipo': 'archivo'
                }
            })
            
    except Exception as e:
        print(f"❌ Error general en api_archivos_proyecto: {e}")
        import traceback
        print(traceback.format_exc())
        return JsonResponse({'error': f'Error en el servidor: {str(e)}'}, status=500)


@csrf_exempt
@login_required
def api_archivo_detalle(request, proyecto_id, archivo_id):
    """API para obtener, actualizar y eliminar un archivo específico"""
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        archivo = get_object_or_404(ArchivoProyecto, id=archivo_id, proyecto=proyecto)
        
        if request.method == 'GET':
            return JsonResponse({
                'success': True,
                'archivo': {
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'tipo_archivo': archivo.tipo_archivo,
                    'tamaño': archivo.tamaño,
                    'extension': archivo.extension,
                    'fecha_subida': archivo.fecha_subida.isoformat(),
                    'subido_por': archivo.subido_por.get_full_name() or archivo.subido_por.username,
                    'es_publico': archivo.es_publico,
                    'descripcion': archivo.descripcion,
                    'url': archivo.archivo.url,
                    'mime_type': archivo.mime_type
                }
            })
        
        elif request.method == 'PUT':
            data = json.loads(request.body)
            nuevo_nombre = data.get('nombre')
            nueva_descripcion = data.get('descripcion', archivo.descripcion)
            nuevo_es_publico = data.get('es_publico', archivo.es_publico)
            
            # Si se proporciona un nuevo nombre, actualizarlo
            if nuevo_nombre:
                archivo.nombre_original = nuevo_nombre
            
            archivo.descripcion = nueva_descripcion
            archivo.es_publico = nuevo_es_publico
            archivo.save()
            
            return JsonResponse({
                'success': True,
                'archivo': {
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'descripcion': archivo.descripcion,
                    'es_publico': archivo.es_publico
                }
            })
        
        elif request.method == 'DELETE':
            # Eliminar archivo físico
            if archivo.archivo:
                try:
                    archivo.archivo.delete(save=False)
                except:
                    pass  # Ignorar errores al eliminar archivo físico
            
            archivo.delete()
            return JsonResponse({'success': True, 'message': 'Archivo eliminado'})
            
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_archivo_proyecto_stream(request, proyecto_id, archivo_id):
    """
    Descarga/previsualización en tiempo real para archivos de proyecto.
    - Archivo local → FileResponse directo.
    - Solo bitrix_file_id → pide URL fresca a Bitrix y hace stream al cliente.
    Parámetro opcional: ?dl=1 para forzar descarga, sin él intenta inline.
    """
    import urllib.parse
    from django.http import StreamingHttpResponse, FileResponse

    proyecto = get_object_or_404(Proyecto, id=proyecto_id)
    archivo = get_object_or_404(ArchivoProyecto, id=archivo_id, proyecto=proyecto)

    # Caso 1: archivo físico local
    if archivo.archivo:
        try:
            content_type, _ = mimetypes.guess_type(archivo.nombre_original)
            if not content_type:
                content_type = 'application/octet-stream'

            response = FileResponse(
                archivo.archivo.open('rb'),
                content_type=content_type
            )

            nombre_encoded = urllib.parse.quote(archivo.nombre_original)
            if request.GET.get('dl') == '1':
                response['Content-Disposition'] = f"attachment; filename*=UTF-8''{nombre_encoded}"
            else:
                response['Content-Disposition'] = f"inline; filename*=UTF-8''{nombre_encoded}"

            return response
        except Exception as e:
            print(f"Error streaming local project file: {e}")
            pass  # fallback a Bitrix

    # Caso 2: archivo en Bitrix (streaming sin guardar)
    if not archivo.bitrix_file_id:
        return JsonResponse({'error': 'Archivo no disponible'}, status=404)

    bitrix_webhook = os.getenv(
        "BITRIX_PROJECTS_WEBHOOK_URL",
        "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
    )
    base = bitrix_webhook.rsplit("/", 1)[0] + "/"

    download_url = ""
    try:
        r = requests.post(base + "disk.file.get.json",
                          json={"id": archivo.bitrix_file_id}, timeout=15)
        r.raise_for_status()
        result = r.json().get("result") or {}
        download_url = result.get("DOWNLOAD_URL") or result.get("downloadUrl") or ""
    except Exception:
        download_url = archivo.bitrix_download_url  # fallback a URL guardada

    if not download_url:
        return JsonResponse({'error': 'No se pudo obtener URL del archivo en Bitrix'}, status=502)

    try:
        bitrix_resp = requests.get(download_url, stream=True, timeout=60)
        bitrix_resp.raise_for_status()

        content_type = bitrix_resp.headers.get("Content-Type", "")
        if not content_type or content_type == 'application/octet-stream':
            guessed_type, _ = mimetypes.guess_type(archivo.nombre_original)
            if guessed_type:
                content_type = guessed_type
            else:
                content_type = 'application/octet-stream'

        nombre_encoded = urllib.parse.quote(archivo.nombre_original)
        disposition = "attachment" if request.GET.get('dl') == '1' else "inline"

        streaming = StreamingHttpResponse(
            bitrix_resp.iter_content(chunk_size=32768),
            content_type=content_type,
        )
        streaming["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{nombre_encoded}"
        size = bitrix_resp.headers.get("Content-Length") or (archivo.tamaño if archivo.tamaño else None)
        if size:
            streaming["Content-Length"] = str(size)
        return streaming

    except Exception as e:
        return JsonResponse({'error': f'Error al obtener archivo: {str(e)}'}, status=502)


@csrf_exempt
@login_required
def api_drive_oportunidad(request, opp_id):
    """Lista carpetas + archivos en raíz (o en subcarpeta) de una oportunidad. POST crea carpeta."""
    opp = get_object_or_404(TodoItem, id=opp_id)

    if request.method == 'GET':
        parent_id = request.GET.get('parent')
        carpetas = CarpetaOportunidad.objects.filter(
            oportunidad=opp,
            carpeta_padre_id=parent_id  # None = raíz
        ).order_by('nombre')

        archivos = ArchivoOportunidad.objects.filter(
            oportunidad=opp,
            carpeta_id=parent_id
        ).order_by('nombre_original')

        carpeta_actual = None
        if parent_id:
            try:
                c = CarpetaOportunidad.objects.get(id=parent_id, oportunidad=opp)
                carpeta_actual = {'id': c.id, 'nombre': c.nombre, 'padre_id': c.carpeta_padre_id}
            except CarpetaOportunidad.DoesNotExist:
                pass

        carpetas_data = [{'id': c.id, 'nombre': c.nombre,
                          'carpeta_padre_id': c.carpeta_padre_id,
                          'fecha_creacion': c.fecha_creacion.isoformat(),
                          'tipo': 'carpeta'} for c in carpetas]
        archivos_data = [{'id': a.id, 'nombre': a.nombre_original,
                          'tipo_archivo': a.tipo_archivo,
                          'extension': a.extension,
                          'tamaño': a.tamaño,
                          'url': f'/app/api/oportunidad/{opp.id}/drive/archivo/{a.id}/stream/',
                          'es_bitrix': bool(not a.archivo and getattr(a, 'bitrix_file_id', None)),
                          'fecha_subida': a.fecha_subida.isoformat(),
                          'tipo': 'archivo'} for a in archivos]

        # Mezclar contenido del proyecto vinculado en la raíz
        if not parent_id:
            opp_proyecto = OportunidadProyecto.objects.filter(oportunidad=opp).first()
            if opp_proyecto:
                try:
                    proyecto_vinculado = Proyecto.objects.get(bitrix_group_id=int(opp_proyecto.bitrix_project_id))
                    for c in CarpetaProyecto.objects.filter(proyecto=proyecto_vinculado, carpeta_padre__isnull=True).order_by('nombre'):
                        carpetas_data.append({'id': c.id, 'nombre': c.nombre,
                                              'fecha_creacion': c.fecha_creacion.isoformat(),
                                              'tipo': 'carpeta_proyecto',
                                              'proyecto_id': proyecto_vinculado.id})
                    for a in ArchivoProyecto.objects.filter(proyecto=proyecto_vinculado, carpeta__isnull=True).order_by('nombre_original'):
                        archivos_data.append({'id': a.id, 'nombre': a.nombre_original,
                                              'tipo_archivo': a.tipo_archivo,
                                              'extension': a.extension,
                                              'tamaño': a.tamaño,
                                              'url': f'/app/api/proyecto/{proyecto_vinculado.id}/archivo/{a.id}/stream/',
                                              'tipo': 'archivo_proyecto'})
                except (Proyecto.DoesNotExist, ValueError):
                    pass

        return JsonResponse({
            'success': True,
            'carpeta_actual': carpeta_actual,
            'carpetas': carpetas_data,
            'archivos': archivos_data,
        })

    elif request.method == 'POST':
        try:
            data = json.loads(request.body)
        except Exception:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        nombre = (data.get('nombre') or '').strip()
        parent_id = data.get('parent_id')
        if not nombre:
            return JsonResponse({'error': 'Nombre requerido'}, status=400)
        carpeta_padre = None
        if parent_id:
            carpeta_padre = get_object_or_404(CarpetaOportunidad, id=parent_id, oportunidad=opp)
        if CarpetaOportunidad.objects.filter(oportunidad=opp, carpeta_padre=carpeta_padre, nombre=nombre).exists():
            return JsonResponse({'error': 'Ya existe una carpeta con ese nombre'}, status=400)
        c = CarpetaOportunidad.objects.create(
            nombre=nombre, oportunidad=opp, carpeta_padre=carpeta_padre, creado_por=request.user
        )
        return JsonResponse({'success': True, 'carpeta': {
            'id': c.id, 'nombre': c.nombre,
            'carpeta_padre_id': c.carpeta_padre_id,
            'fecha_creacion': c.fecha_creacion.isoformat(), 'tipo': 'carpeta'
        }})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@csrf_exempt
@login_required
def api_drive_oportunidad_carpeta(request, opp_id, carpeta_id):
    """Renombra o elimina una carpeta del drive de una oportunidad."""
    opp = get_object_or_404(TodoItem, id=opp_id)
    carpeta = get_object_or_404(CarpetaOportunidad, id=carpeta_id, oportunidad=opp)

    if request.method == 'PUT':
        try:
            data = json.loads(request.body)
        except Exception:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        nuevo = (data.get('nombre') or '').strip()
        if not nuevo:
            return JsonResponse({'error': 'Nombre requerido'}, status=400)
        if CarpetaOportunidad.objects.filter(
            oportunidad=opp, carpeta_padre=carpeta.carpeta_padre, nombre=nuevo
        ).exclude(id=carpeta_id).exists():
            return JsonResponse({'error': 'Ya existe una carpeta con ese nombre'}, status=400)
        carpeta.nombre = nuevo
        carpeta.save()
        return JsonResponse({'success': True, 'carpeta': {'id': carpeta.id, 'nombre': carpeta.nombre}})

    elif request.method == 'DELETE':
        force = request.GET.get('force', 'false').lower() == 'true'
        if not force and not carpeta.puede_eliminar():
            return JsonResponse({'error': 'La carpeta no está vacía'}, status=400)

        def borrar_recursivo(c):
            for sub in c.subcarpetas.all():
                borrar_recursivo(sub)
            for a in c.archivos.all():
                if a.archivo:
                    try:
                        a.archivo.delete(save=False)
                    except Exception:
                        pass
                a.delete()
            c.delete()

        borrar_recursivo(carpeta)
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@csrf_exempt
@login_required
def api_drive_oportunidad_archivo(request, opp_id):
    """Sube un archivo al drive de una oportunidad."""
    opp = get_object_or_404(TodoItem, id=opp_id)

    if request.method == 'POST':
        archivo_file = request.FILES.get('archivo')
        if not archivo_file:
            return JsonResponse({'error': 'Archivo requerido'}, status=400)
        carpeta_id = request.POST.get('carpeta_id')
        carpeta = None
        if carpeta_id:
            carpeta = get_object_or_404(CarpetaOportunidad, id=carpeta_id, oportunidad=opp)

        ext = archivo_file.name.rsplit('.', 1)[-1].lower() if '.' in archivo_file.name else ''
        tipo_map = {
            'pdf': 'pdf',
            **{e: 'imagen' for e in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp']},
            **{e: 'documento' for e in ['doc', 'docx', 'txt', 'rtf', 'odt']},
            **{e: 'hoja_calculo' for e in ['xls', 'xlsx', 'csv', 'ods']},
            **{e: 'presentacion' for e in ['ppt', 'pptx', 'odp']},
            **{e: 'video' for e in ['mp4', 'avi', 'mov', 'wmv', 'mkv']},
            **{e: 'audio' for e in ['mp3', 'wav', 'aac', 'flac']},
            **{e: 'archivo_comprimido' for e in ['zip', 'rar', '7z', 'tar', 'gz']},
        }
        tipo = tipo_map.get(ext, 'otro')

        try:
            a = ArchivoOportunidad.objects.create(
                nombre_original=archivo_file.name,
                archivo=archivo_file,
                tipo_archivo=tipo,
                tamaño=archivo_file.size,
                oportunidad=opp,
                carpeta=carpeta,
                subido_por=request.user,
                extension=ext,
                mime_type=archivo_file.content_type or '',
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            return JsonResponse({'error': f'Error al guardar archivo: {str(e)}'}, status=500)

        return JsonResponse({'success': True, 'archivo': {
            'id': a.id, 'nombre': a.nombre_original,
            'tipo_archivo': a.tipo_archivo, 'extension': a.extension,
            'tamaño': a.tamaño, 'url': f'/app/api/oportunidad/{opp.id}/drive/archivo/{a.id}/stream/',
            'fecha_subida': a.fecha_subida.isoformat(), 'tipo': 'archivo'
        }})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@csrf_exempt
@login_required
def api_drive_oportunidad_archivo_detalle(request, opp_id, archivo_id):
    """Renombra o elimina un archivo del drive de una oportunidad."""
    opp = get_object_or_404(TodoItem, id=opp_id)
    archivo = get_object_or_404(ArchivoOportunidad, id=archivo_id, oportunidad=opp)

    if request.method == 'PUT':
        try:
            data = json.loads(request.body)
        except Exception:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        nuevo = (data.get('nombre') or '').strip()
        if nuevo:
            archivo.nombre_original = nuevo
            archivo.save()
        return JsonResponse({'success': True, 'archivo': {'id': archivo.id, 'nombre': archivo.nombre_original}})

    elif request.method == 'DELETE':
        if archivo.archivo:
            try:
                archivo.archivo.delete(save=False)
            except Exception:
                pass
        archivo.delete()
        return JsonResponse({'success': True})

    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_drive_archivo_stream(request, opp_id, archivo_id):
    """
    Descarga/previsualización en tiempo real (proxy streaming).
    - Archivo local → FileResponse directo.
    - Solo bitrix_file_id → pide URL fresca a Bitrix y hace stream al cliente sin guardar nada.
    Parámetro opcional: ?dl=1 para forzar descarga, sin él intenta inline (previsualización).
    """
    import urllib.parse
    from django.http import StreamingHttpResponse, FileResponse

    opp = get_object_or_404(TodoItem, id=opp_id)
    archivo = get_object_or_404(ArchivoOportunidad, id=archivo_id, oportunidad=opp)

    # Caso 1: archivo físico local
    if archivo.archivo:
        try:
            content_type, _ = mimetypes.guess_type(archivo.nombre_original)
            if not content_type:
                content_type = 'application/octet-stream'

            response = FileResponse(
                archivo.archivo.open('rb'),
                content_type=content_type
            )
            
            nombre_encoded = urllib.parse.quote(archivo.nombre_original)
            if request.GET.get('dl') == '1':
                response['Content-Disposition'] = f"attachment; filename*=UTF-8''{nombre_encoded}"
            else:
                # IMPORTANTE: disposition='inline' para que el navegador lo muestre
                response['Content-Disposition'] = f"inline; filename*=UTF-8''{nombre_encoded}"
            
            return response
        except Exception as e:
            print(f"Error streaming local file: {e}")
            pass  # fallback a Bitrix si el físico no existe

    # Caso 2: archivo en Bitrix (streaming sin guardar)
    if not archivo.bitrix_file_id:
        return JsonResponse({'error': 'Archivo no disponible'}, status=404)

    bitrix_webhook = os.getenv(
        "BITRIX_PROJECTS_WEBHOOK_URL",
        "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
    )
    base = bitrix_webhook.rsplit("/", 1)[0] + "/"

    # Obtener URL de descarga fresca (expiran, por eso se pide cada vez)
    download_url = ""
    try:
        r = requests.post(base + "disk.file.get.json",
                          json={"id": archivo.bitrix_file_id}, timeout=15)
        r.raise_for_status()
        result = r.json().get("result") or {}
        download_url = result.get("DOWNLOAD_URL") or result.get("downloadUrl") or ""
    except Exception:
        download_url = archivo.bitrix_download_url  # fallback a URL guardada

    if not download_url:
        return JsonResponse({'error': 'No se pudo obtener URL del archivo en Bitrix'}, status=502)

    # Stream desde Bitrix → cliente (chunk de 32 KB, sin tocar disco)
    try:
        bitrix_resp = requests.get(download_url, stream=True, timeout=60)
        bitrix_resp.raise_for_status()

        content_type = bitrix_resp.headers.get("Content-Type", "")
        if not content_type or content_type == 'application/octet-stream':
             guessed_type, _ = mimetypes.guess_type(archivo.nombre_original)
             if guessed_type:
                 content_type = guessed_type
             else:
                 content_type = 'application/octet-stream'

        nombre_encoded = urllib.parse.quote(archivo.nombre_original)
        disposition = "attachment" if request.GET.get('dl') == '1' else "inline"

        streaming = StreamingHttpResponse(
            bitrix_resp.iter_content(chunk_size=32768),
            content_type=content_type,
        )
        streaming["Content-Disposition"] = f"{disposition}; filename*=UTF-8''{nombre_encoded}"
        size = bitrix_resp.headers.get("Content-Length") or (archivo.tamaño if archivo.tamaño else None)
        if size:
            streaming["Content-Length"] = str(size)
        return streaming

    except Exception as e:
        return JsonResponse({'error': f'Error al obtener archivo: {str(e)}'}, status=502)

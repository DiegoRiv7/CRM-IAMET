from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
import json
import logging
import requests
from django.conf import settings
import csv
from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse
from django.core.paginator import Paginator, EmptyPage, PageNotAnInteger
from django.contrib import messages
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required, user_passes_test
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion, UserProfile, Contacto, PendingFileUpload, OportunidadProyecto, Volumetria, DetalleVolumetria, CatalogoCableado, OportunidadActividad, OportunidadComentario, OportunidadArchivo, OportunidadEstado, Notificacion, Proyecto, ProyectoComentario, ProyectoArchivo
from . import views_exportar
from .forms import VentaForm, VentaFilterForm, CotizacionForm, ClienteForm, OportunidadModalForm, NuevaOportunidadForm
from django.db.models import Sum, Count, F, Q, Case, When, Value
from django.db.models.functions import Upper, Coalesce
from django.db.models import Value
from datetime import date
from dateutil.relativedelta import relativedelta
from django.utils import timezone
from decimal import Decimal
import decimal
from django.utils.html import json_script

# Helper function to detect lost opportunities
def is_lost_opportunity(stage_id):
    """
    Detecta si una oportunidad está marcada como "Cerrado Perdido" en Bitrix24
    Maneja múltiples formatos de stage_id:
    - '2': Formato simple
    - 'C2:11': Formato con prefijo numérico (perdido)
    - 'C2:LOSE': Formato "Cerrar negociación" -> "Cerrado perdido"
    - 'LOSE': Formato texto
    
    NOTA: C2:NEW no es perdido, es nuevo
    """
    if not stage_id:
        return False
    
    stage_id = str(stage_id)
    
    # Casos específicos de estado perdido
    if stage_id == '2':  # Formato simple
        return True
    elif stage_id == 'LOSE':  # Formato texto
        return True
    elif stage_id == 'C2:LOSE':  # Formato "Cerrar negociación" -> "Cerrado perdido"
        return True
    elif stage_id.startswith('C2:'):
        # Solo considerar perdido si después de C2: hay un número
        # C2:NEW = nuevo, C2:11 = perdido, C2:LOSE = perdido (ya manejado arriba)
        try:
            suffix = stage_id[3:]  # Obtener la parte después de 'C2:'
            int(suffix)  # Si es un número, es perdido
            return True
        except ValueError:
            # Si no es un número (ej: C2:NEW), no es perdido
            return False
    
    return False
import json
from zoneinfo import ZoneInfo


def convert_to_tijuana_time(utc_datetime):
    """Convierte una fecha UTC a tiempo de Tijuana"""
    try:
        # Usar zoneinfo que es parte de la biblioteca estándar de Python
        tijuana_tz = ZoneInfo('America/Tijuana')
        if utc_datetime.tzinfo is None:
            # Si no tiene timezone info, asumir UTC
            utc_datetime = timezone.make_aware(utc_datetime, timezone.utc)
        return utc_datetime.astimezone(tijuana_tz)
    except Exception:
        return utc_datetime
from django.urls import reverse
from django.utils import timezone, translation
from django.utils.translation import gettext_lazy as _
from datetime import datetime
from django.utils.translation import activate, get_language

# Definir la constante manualmente para compatibilidad
LANGUAGE_SESSION_KEY = 'django_language'
from django.http import JsonResponse

# Importaciones para generación de PDF
from weasyprint import HTML
from django.template.loader import render_to_string

# Asegúrate de importar tu modelo Cotizacion y DetalleCotizacion
from .models import Cotizacion, DetalleCotizacion

# Importaciones para el logo Base64
import base64
import os

logger = logging.getLogger(__name__)

# Función auxiliar para comprobar si el usuario es supervisor
def is_supervisor(user):
    return user.groups.filter(name='Supervisores').exists()

def is_engineer(user):
    return user.groups.filter(name='Ingenieros').exists()

# Función auxiliar para obtener el display de un valor de choice
def _get_display_for_value(value, choices_list):
    return dict(choices_list).get(value, value)

# Vistas principales y funcionales

@login_required
def get_oportunidades_por_cliente(request):
    cliente_id = request.GET.get('cliente_id')
    oportunidad_inicial_id = request.GET.get('oportunidad_inicial_id')  # Nueva línea para oportunidad específica
    
    print(f"DEBUG: get_oportunidades_por_cliente - cliente_id: {cliente_id}, oportunidad_inicial_id: {oportunidad_inicial_id}")

    if is_supervisor(request.user):
        if cliente_id:
            # Solo las 10 oportunidades más recientes del cliente para supervisores
            oportunidades = TodoItem.objects.filter(cliente_id=cliente_id).order_by('-fecha_creacion')[:10]
        else:
            # If no client_id, return the 20 most recent opportunities for supervisors
            oportunidades = TodoItem.objects.all().order_by('-fecha_creacion')[:20]
    else:
        if cliente_id:
            # Solo las 10 oportunidades más recientes del cliente del usuario actual
            oportunidades = TodoItem.objects.filter(cliente_id=cliente_id, usuario=request.user).order_by('-fecha_creacion')[:10]
        else:
            # If no client_id, return the 20 most recent opportunities for the current user
            oportunidades = TodoItem.objects.filter(usuario=request.user).order_by('-fecha_creacion')[:20]

    # Si hay una oportunidad inicial específica, asegurar que esté incluida
    if oportunidad_inicial_id:
        try:
            # Limpiar el ID eliminando comas y espacios
            clean_id = oportunidad_inicial_id.replace(',', '').replace(' ', '').strip()
            print(f"DEBUG: Buscando oportunidad inicial con ID: {clean_id}")
            oportunidad_inicial = TodoItem.objects.get(id=int(clean_id))
            print(f"DEBUG: Oportunidad inicial encontrada: {oportunidad_inicial.oportunidad}")
            
            # Convertir queryset a lista para manipulación
            oportunidades_list = list(oportunidades)
            oportunidades_ids = [op.id for op in oportunidades_list]
            
            # Verificar si ya está en la lista por ID
            if oportunidad_inicial.id not in oportunidades_ids:
                print(f"DEBUG: Oportunidad inicial NO estaba en la lista, agregándola al principio")
                # Agregar la oportunidad específica al principio de la lista
                oportunidades_list.insert(0, oportunidad_inicial)
                oportunidades = oportunidades_list
            else:
                print(f"DEBUG: Oportunidad inicial YA estaba en la lista")
                # Moverla al principio si ya estaba presente
                oportunidades_list = [op for op in oportunidades_list if op.id != oportunidad_inicial.id]
                oportunidades_list.insert(0, oportunidad_inicial)
                oportunidades = oportunidades_list
        except (TodoItem.DoesNotExist, ValueError, TypeError) as e:
            print(f"DEBUG: Error procesando oportunidad inicial {oportunidad_inicial_id}: {e}")
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

@login_required
def ventas_fullscreen(request):
    user = request.user
    is_super = hasattr(user, 'perfil') and getattr(user.perfil, 'es_supervisor', False)
    qs = TodoItem.objects.filter(probabilidad_cierre=100).exclude(mes_cierre__isnull=True).exclude(mes_cierre='')
    if not is_super:
        qs = qs.filter(usuario=user)
    ventas_por_mes = {str(i).zfill(2): 0 for i in range(1, 13)}
    for item in qs:
        mes = item.mes_cierre
        if mes in ventas_por_mes:
            ventas_por_mes[mes] += item.monto or 0
    meses = ['01','02','03','04','05','06','07','08','09','10','11','12']
    ventas_por_mes_list = [
        {'mes': m, 'monto': float(ventas_por_mes[m])} for m in meses
    ]
    return render(request, 'ventas_fullscreen.html', {'ventas_por_mes_list': ventas_por_mes_list})


@login_required
def oportunidades_mes_actual(request):
    hoy = date.today()
    mes_actual_val = str(hoy.month).zfill(2)
    mes_actual_nombre = dict(TodoItem.MES_CHOICES).get(mes_actual_val, f"Mes {hoy.month}")
    if is_supervisor(request.user):
        oportunidades = TodoItem.objects.filter(mes_cierre=mes_actual_val)
        meta_mensual = 400000
    else:
        oportunidades = TodoItem.objects.filter(mes_cierre=mes_actual_val, usuario=request.user)
        meta_mensual = 130000

    # Monto por cobrar: oportunidades con probabilidad entre 1 and 99%
    monto_por_cobrar = oportunidades.filter(probabilidad_cierre__gte=1, probabilidad_cierre__lte=99).aggregate(suma=Sum('monto'))['suma'] or 0

    return render(request, 'oportunidades_mes_actual.html', {
        'oportunidades': oportunidades,
        'mes_actual_nombre': mes_actual_nombre,
        'meta_mensual': meta_mensual,
        'monto_por_cobrar': monto_por_cobrar,
    })

@login_required
def bienvenida(request):
    """
    Vista de bienvenida que será la primera que vea el usuario al ingresar.
    """
    # Enviar notificación de cumpleaños de Stefanny automáticamente
    try:
        enviar_notificacion_cumpleanos()
    except Exception as e:
        print(f"Error enviando notificación de cumpleaños: {e}")
    
    # Asegurar que el usuario tenga un perfil
    profile, created = UserProfile.objects.get_or_create(user=request.user)
    
    # Determinar perfil
    perfil = "SUPERVISOR" if is_supervisor(request.user) else "VENDEDOR"
    # Fecha actual
    fecha_actual = timezone.localtime(timezone.now()).strftime('%A, %d de %B de %Y')

    # Usuario del mes: quien más oportunidades ha creado desde el 1 de septiembre 2025
    # Se calcula desde el 1 de septiembre hasta hoy
    today = date.today()
    inicio_mes_actual = date(2025, 9, 1)  # Fijado al 1 de septiembre 2025
    oportunidades_mes = (
        TodoItem.objects.filter(fecha_creacion__date__gte=inicio_mes_actual, fecha_creacion__date__lte=today)
        .exclude(usuario__groups__name='Supervisores')
        .values('usuario')
        .annotate(oportunidades_creadas=Count('id'))
        .order_by('-oportunidades_creadas')
    )
    usuario_mes = None
    
    # TEMPORAL: Forzar que Rivera sea empleado del mes para pruebas
    try:
        rivera_user = User.objects.get(username='Rivera')
        rivera_profile = UserProfile.objects.get(user=rivera_user)
        avatar_url = rivera_profile.get_avatar_url()
        if not avatar_url:
            avatar_url = f'https://ui-avatars.com/api/?name={rivera_user.get_full_name() or rivera_user.username}&background=38bdf8&color=fff'
        logger.info(f"DEBUG: URL del avatar del mes (Rivera): {avatar_url}")
        
        # Calcular oportunidades y monto para Rivera
        oportunidades_rivera = TodoItem.objects.filter(
            fecha_creacion__date__gte=inicio_mes_actual,
            fecha_creacion__date__lte=today,
            usuario=rivera_user
        ).count()
        
        monto_total_rivera = TodoItem.objects.filter(
            fecha_creacion__date__gte=inicio_mes_actual,
            fecha_creacion__date__lte=today,
            usuario=rivera_user
        ).aggregate(total=Sum('monto'))['total'] or 150000  # Valor ejemplo
        
        usuario_mes = {
            'nombre': rivera_user.get_full_name() or rivera_user.username,
            'avatar_url': avatar_url,
            'oportunidades_creadas': oportunidades_rivera if oportunidades_rivera > 0 else 25,  # Valor ejemplo
            'monto_total_mes': monto_total_rivera,
            'user': rivera_user  # Añadir el objeto user para el filtro
        }
    except User.DoesNotExist:
        # Si no existe Rivera, usar la lógica original
        if oportunidades_mes:
            user_id = oportunidades_mes[0]['usuario']
            user = User.objects.get(id=user_id)
            user_profile = UserProfile.objects.get(user=user)
            avatar_url = user_profile.get_avatar_url()
            if not avatar_url:
                avatar_url = f'https://ui-avatars.com/api/?name={user.get_full_name() or user.username}&background=38bdf8&color=fff'
            logger.info(f"DEBUG: URL del avatar del mes: {avatar_url}")

            # Calcular el monto total de oportunidades creadas por este usuario en el mes actual
            monto_total_mes = TodoItem.objects.filter(
                fecha_creacion__date__gte=inicio_mes_actual,
                fecha_creacion__date__lte=today,
                usuario=user
            ).aggregate(total=Sum('monto'))['total'] or 0
            usuario_mes = {
                'nombre': user.get_full_name() or user.username,
                'avatar_url': avatar_url,
                'oportunidades_creadas': oportunidades_mes[0]['oportunidades_creadas'],
                'monto_total_mes': monto_total_mes,
                'user': user  # Añadir el objeto user para el filtro
            }

    # Usuario del día: más oportunidades registradas hoy, solo vendedores
    hoy = date.today()
    usuario_dia = None
    oportunidades_hoy = (
        TodoItem.objects.filter(fecha_creacion__date=hoy)
        .exclude(usuario__groups__name='Supervisores')
        .values('usuario')
        .annotate(oportunidades_hoy=Count('id'))
        .order_by('-oportunidades_hoy')
    )
    if oportunidades_hoy and oportunidades_hoy[0]['oportunidades_hoy'] > 0:
        user_id = oportunidades_hoy[0]['usuario']
        user = User.objects.get(id=user_id)
        user_profile = UserProfile.objects.get(user=user)
        avatar_url = user_profile.get_avatar_url()
        if not avatar_url:
            avatar_url = f'https://ui-avatars.com/api/?name={user.get_full_name() or user.username}&background=f472b6&color=fff'
        logger.info(f"DEBUG: URL del avatar del día: {avatar_url}")

        usuario_dia = {
            'nombre': user.get_full_name() or user.username,
            'avatar_url': avatar_url,
            'oportunidades_hoy': oportunidades_hoy[0]['oportunidades_hoy'],
            'user': user  # Añadir el objeto user para el filtro
        }
    # Si no hay oportunidades hoy, usuario_dia queda en None

    # Últimas oportunidades (de todos)
    ultimas_oportunidades_qs = TodoItem.objects.select_related('cliente', 'usuario').order_by('-fecha_creacion')[:8]
    ultimas_oportunidades = [
        {
            'id': o.id,  # Add the ID here
            'nombre': o.oportunidad,
            'cliente': o.cliente.nombre_empresa if o.cliente else '',
            'monto': o.monto,
            'probabilidad': o.probabilidad_cierre,
            'usuario': o.usuario.get_full_name() or o.usuario.username if o.usuario else '',
        }
        for o in ultimas_oportunidades_qs
    ]

    # Clima: dejar None, preparado para integración futura
    clima = None

    context = {
        'perfil': perfil,
        'fecha_actual': fecha_actual,
        'usuario_mes': usuario_mes,
        'usuario_dia': usuario_dia,
        'ultimas_oportunidades': ultimas_oportunidades,
        'clima': clima,
    }
    return render(request, 'bienvenida.html', context)


@login_required
def feed(request):
    """
    Vista para el feed de actividad que muestra las actualizaciones recientes
    y publicaciones de los usuarios.
    """
    try:
        # Obtener el perfil del usuario actual
        user_profile = UserProfile.objects.get(user=request.user)
    except UserProfile.DoesNotExist:
        # Si no existe, crear uno con valores predeterminados
        user_profile = UserProfile.objects.create(
            user=request.user,
            language='es',
            avatar_tipo='dinosaur'
        )
    
    context = {
        'user_profile': user_profile,
    }
    
    return render(request, 'feed.html', context)


@login_required
def tareas_proyectos(request):
    """
    Vista para la sección de Tareas y Proyectos (solo superusuarios)
    """
    # Verificar que el usuario sea superusuario
    if not request.user.is_superuser:
        return redirect('home')
    
    context = {
        'user': request.user,
        'page_title': 'Tareas y Proyectos'
    }
    
    return render(request, 'tareas_proyectos.html', context)


@login_required
def api_proyectos(request):
    """
    API para obtener proyectos con paginación
    """
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    # Obtener parámetros de paginación
    page = int(request.GET.get('page', 1))
    per_page = int(request.GET.get('per_page', 30))
    search = request.GET.get('search', '').strip()
    
    # Obtener proyectos reales de la base de datos
    try:
        proyectos_query = Proyecto.objects.all()
        
        # Filtrar por búsqueda si hay término
        if search:
            proyectos_query = proyectos_query.filter(
                Q(nombre__icontains=search) | 
                Q(descripcion__icontains=search)
            )
        
        # Aplicar paginación
        from django.core.paginator import Paginator
        paginator = Paginator(proyectos_query, per_page)
        proyectos_pagina = paginator.get_page(page)
        
        # Convertir a formato JSON
        proyectos_data = []
        for proyecto in proyectos_pagina:
            proyectos_data.append({
                'id': proyecto.id,
                'nombre': proyecto.nombre,
                'descripcion': proyecto.descripcion or '',
                'avance': proyecto.get_avance_porcentaje(),
                'fecha_creacion': proyecto.fecha_creacion.strftime('%d de %b, %Y'),
                'creador': {
                    'id': proyecto.creado_por.id,
                    'nombre': proyecto.creado_por.get_full_name() or proyecto.creado_por.username,
                    'iniciales': ''.join([palabra[0].upper() for palabra in (proyecto.creado_por.get_full_name() or proyecto.creado_por.username).split()[:2]])
                },
                'miembros': proyecto.get_miembros_display(),
                'privacidad': proyecto.privacidad,
                'tipo': proyecto.tipo,
                'mi_rol': proyecto.get_rol_usuario(request.user)
            })

        return JsonResponse({
            'success': True,
            'proyectos': proyectos_data,
            'total': paginator.count,
            'page': page,
            'per_page': per_page,
            'total_pages': paginator.num_pages
        })
        
    except Exception as e:
        print(f"Error obteniendo proyectos: {e}")
        # Fallback a datos de ejemplo si hay error
        usuario_actual_id = request.user.id
    
    proyectos_ejemplo = [
        {
            'id': 1380,
            'nombre': 'RFQ-20250428-11 CONTROL DE ACCESO TORNIQUETE',
            'descripcion': 'Sistema de control de acceso con torniquetes inteligentes',
            'avance': 63,
            'fecha_creacion': '15 de Ago, 2024',
            'creador': {
                'id': 1,
                'nombre': 'Diego Rivera',
                'iniciales': 'DR'
            },
            'miembros': [
                {'id': 1, 'nombre': 'Diego Rivera', 'iniciales': 'DR'},
                {'id': 2, 'nombre': 'Juan García', 'iniciales': 'JG'},
                {'id': 3, 'nombre': 'María Pérez', 'iniciales': 'MP'},
                {'id': 4, 'nombre': 'Ana López', 'iniciales': 'AL'}
            ],
            'privacidad': 'publico',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 1 else ('Miembro' if usuario_actual_id in [2, 3, 4] else 'No te has unido al proyecto')
        },
        {
            'id': 2056,
            'nombre': 'CRM NetHive - Sistema de Gestión',
            'descripcion': 'Desarrollo del sistema CRM personalizado',
            'avance': 100,
            'fecha_creacion': '10 de Jul, 2024',
            'creador': {
                'id': 2,
                'nombre': 'Juan García',
                'iniciales': 'JG'
            },
            'miembros': [
                {'id': 2, 'nombre': 'Juan García', 'iniciales': 'JG'},
                {'id': 5, 'nombre': 'Luis Martínez', 'iniciales': 'LM'}
            ],
            'privacidad': 'privado',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 2 else ('Miembro' if usuario_actual_id == 5 else 'No te has unido al proyecto')
        },
        {
            'id': 774,
            'nombre': 'Telvista 34630 CH - Sistema Avigilon',
            'descripcion': 'Implementación de sistema de videovigilancia',
            'avance': 45,
            'fecha_creacion': '5 de Sep, 2024',
            'creador': {
                'id': 3,
                'nombre': 'María Pérez',
                'iniciales': 'MP'
            },
            'miembros': [
                {'id': 3, 'nombre': 'María Pérez', 'iniciales': 'MP'},
                {'id': 1, 'nombre': 'Diego Rivera', 'iniciales': 'DR'},
                {'id': 4, 'nombre': 'Ana López', 'iniciales': 'AL'},
                {'id': 6, 'nombre': 'Carlos Ruiz', 'iniciales': 'CR'}
            ],
            'privacidad': 'privado',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 3 else ('Miembro' if usuario_actual_id in [1, 4, 6] else 'No te has unido al proyecto')
        },
        {
            'id': 1560,
            'nombre': '8700053503 - Equipos ZEBRA PIMS',
            'descripcion': 'Instalación y configuración de equipos ZEBRA',
            'avance': 85,
            'fecha_creacion': '20 de Ago, 2024',
            'creador': {
                'id': 1,
                'nombre': 'Diego Rivera',
                'iniciales': 'DR'
            },
            'miembros': [
                {'id': 1, 'nombre': 'Diego Rivera', 'iniciales': 'DR'},
                {'id': 7, 'nombre': 'Ana Beltrán', 'iniciales': 'AB'},
                {'id': 8, 'nombre': 'Carlos Fuentes', 'iniciales': 'CF'}
            ],
            'privacidad': 'publico',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 1 else ('Miembro' if usuario_actual_id in [7, 8] else 'No te has unido al proyecto')
        },
        {
            'id': 1130,
            'nombre': 'PO 4201027104 - Instalación Access Point',
            'descripcion': 'Instalación de puntos de acceso inalámbricos',
            'avance': 92,
            'fecha_creacion': '1 de Sep, 2024',
            'creador': {
                'id': 4,
                'nombre': 'Ana López',
                'iniciales': 'AL'
            },
            'miembros': [
                {'id': 4, 'nombre': 'Ana López', 'iniciales': 'AL'},
                {'id': 9, 'nombre': 'José Morales', 'iniciales': 'JM'},
                {'id': 10, 'nombre': 'Teresa Ramírez', 'iniciales': 'TR'},
                {'id': 11, 'nombre': 'David López', 'iniciales': 'DL'}
            ],
            'privacidad': 'privado',
            'mi_rol': 'Jefe de proyecto' if usuario_actual_id == 4 else ('Miembro' if usuario_actual_id in [9, 10, 11] else 'No te has unido al proyecto')
        }
    ]
    
    # Filtrar por búsqueda si se proporciona
    if search:
        proyectos_filtrados = [
            p for p in proyectos_ejemplo 
            if search.lower() in p['nombre'].lower() or search.lower() in p['descripcion'].lower()
        ]
    else:
        proyectos_filtrados = proyectos_ejemplo
    
    # Simular paginación
    total_proyectos = len(proyectos_filtrados)
    start_index = (page - 1) * per_page
    end_index = start_index + per_page
    proyectos_pagina = proyectos_filtrados[start_index:end_index]
    
    return JsonResponse({
        'success': True,
        'proyectos': proyectos_pagina,
        'total': total_proyectos,
        'page': page,
        'per_page': per_page,
        'total_pages': (total_proyectos + per_page - 1) // per_page
    })


# Variable temporal para almacenar tareas creadas durante la sesión
# En un entorno real, esto se almacenaría en la base de datos
tareas_temporales = []

@login_required
def api_tareas(request):
    """
    API para obtener y crear tareas
    """
    global tareas_temporales
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    if request.method == 'GET':
        # Obtener tareas por proyecto si se especifica
        proyecto_id = request.GET.get('proyecto_id')
        
        if proyecto_id:
            try:
                from .models import Proyecto
                proyecto = Proyecto.objects.get(id=proyecto_id)
                
                # Filtrar tareas temporales por proyecto
                tareas_del_proyecto = [
                    tarea for tarea in tareas_temporales 
                    if str(tarea.get('proyecto_id')) == str(proyecto_id)
                ]
                
                # Agregar datos de ejemplo solo si no hay tareas creadas
                if not tareas_del_proyecto:
                    # Crear usuarios de ejemplo para participantes
                    from django.contrib.auth.models import User
                    usuarios_ejemplo = []
                    try:
                        # Intentar obtener usuarios reales
                        usuarios_ejemplo = list(User.objects.all()[:4])
                    except:
                        # Si hay error, usar datos estáticos
                        pass
                    
                    # Función para generar datos de participante
                    def generar_participante(user_id, nombre, username):
                        iniciales = ''.join([palabra[0].upper() for palabra in nombre.split()[:2]])
                        avatar_url = None
                        if usuarios_ejemplo:
                            try:
                                user = usuarios_ejemplo[user_id % len(usuarios_ejemplo)]
                                if hasattr(user, 'userprofile'):
                                    avatar_url = user.userprofile.get_avatar_url()
                                nombre = user.get_full_name() or user.username
                                iniciales = ''.join([palabra[0].upper() for palabra in nombre.split()[:2]])
                            except:
                                pass
                        
                        return {
                            'id': user_id,
                            'nombre': nombre,
                            'username': username,
                            'iniciales': iniciales,
                            'avatar_url': avatar_url,
                            'rol': 'Participante'
                        }
                    
                    tareas_del_proyecto = [
                        {
                            'id': 1,
                            'titulo': 'Diseñar interfaz de notificaciones',
                            'descripcion': 'Crear mockups y prototipos para el sistema de notificaciones',
                            'prioridad': 'alta',
                            'fecha_limite': '2025-01-25',
                            'fecha_creacion': '2025-01-20',
                            'creado_por': 'Rivera',
                            'responsable': generar_participante(1, 'Juan Rivera', 'rivera'),
                            'proyecto': proyecto.nombre,
                            'participantes': [
                                generar_participante(1, 'Juan Rivera', 'rivera'),
                                generar_participante(2, 'María García', 'mgarcia'),
                                generar_participante(3, 'Carlos López', 'clopez')
                            ]
                        },
                        {
                            'id': 2,
                            'titulo': 'Optimizar consultas SQL',
                            'descripcion': 'Revisar y optimizar las consultas más lentas del sistema',
                            'prioridad': 'media',
                            'fecha_limite': '2025-02-01',
                            'fecha_creacion': '2025-01-20',
                            'creado_por': 'Desarrollo',
                            'responsable': generar_participante(2, 'María García', 'mgarcia'),
                            'proyecto': proyecto.nombre,
                            'participantes': [
                                generar_participante(1, 'Juan Rivera', 'rivera'),
                                generar_participante(4, 'Ana Martínez', 'amartinez')
                            ]
                        }
                    ]
                
                return JsonResponse({
                    'success': True,
                    'tareas': tareas_del_proyecto
                })
            except:
                return JsonResponse({'error': 'Proyecto no encontrado'}, status=404)
        
        # Devolver todas las tareas (ejemplo)
        tareas_ejemplo = [
            {
                'id': 1,
                'titulo': 'Diseñar interfaz de notificaciones',
                'descripcion': 'Crear mockups y prototipos para el sistema de notificaciones',
                'prioridad': 'alta',
                'fecha_limite': '2025-01-25',
                'asignado_a': 'Rivera'
            },
            {
                'id': 2,
                'titulo': 'Optimizar consultas SQL',
                'descripcion': 'Revisar y optimizar las consultas más lentas del sistema',
                'prioridad': 'media',
                'fecha_limite': '2025-02-01',
                'asignado_a': 'Desarrollo'
            },
            {
                'id': 3,
                'titulo': 'Documentar API endpoints',
                'descripcion': 'Crear documentación completa de todos los endpoints de la API',
                'prioridad': 'baja',
                'fecha_limite': '2025-02-10',
                'asignado_a': 'Technical Writer'
            }
        ]
        
        return JsonResponse({
            'success': True,
            'tareas': tareas_ejemplo
        })
    
    elif request.method == 'POST':
        try:
            import json
            from datetime import datetime
            from django.contrib.auth.models import User
            from .models import Proyecto
            
            # Obtener datos del request
            titulo = request.POST.get('titulo', '').strip()
            descripcion = request.POST.get('descripcion', '').strip()
            proyecto_id = request.POST.get('proyecto_id')
            alta_prioridad = request.POST.get('alta_prioridad', 'false').lower() == 'true'
            prioridad = 'alta' if alta_prioridad else 'media'
            fecha_limite = request.POST.get('fecha_limite')
            responsable_id = request.POST.get('responsable_id')
            participantes_json = request.POST.get('participantes', '[]')
            observadores_json = request.POST.get('observadores', '[]')
            
            # Validaciones básicas
            if not titulo:
                return JsonResponse({'error': 'El título es requerido'}, status=400)
            
            if not proyecto_id:
                return JsonResponse({'error': 'El proyecto es requerido'}, status=400)
            
            try:
                proyecto = Proyecto.objects.get(id=proyecto_id)
            except Proyecto.DoesNotExist:
                return JsonResponse({'error': 'Proyecto no encontrado'}, status=404)
            
            # Obtener el nombre del responsable
            responsable_nombre = request.user.username  # Por defecto el creador
            if responsable_id:
                try:
                    responsable_user = User.objects.get(id=responsable_id)
                    responsable_nombre = responsable_user.username
                except User.DoesNotExist:
                    pass  # Mantener el valor por defecto
            
            # Crear la tarea y agregarla a la lista temporal
            nuevo_id = len(tareas_temporales) + 1000  # ID único
            nueva_tarea = {
                'id': nuevo_id,
                'titulo': titulo,
                'descripcion': descripcion,
                'proyecto': proyecto.nombre,
                'proyecto_id': proyecto_id,
                'prioridad': prioridad,
                'fecha_creacion': datetime.now().strftime('%Y-%m-%d'),
                'fecha_limite': fecha_limite,
                'creado_por': request.user.username,
                'creado_por_id': request.user.id,
                'responsable': responsable_nombre,
                'responsable_id': responsable_id or request.user.id,
                'estado': 'pendiente'
            }
            
            # Agregar a la lista temporal
            tareas_temporales.append(nueva_tarea)
            
            # Aquí se crearían las notificaciones para participantes y observadores
            # Por ahora simular que se envían las notificaciones
            
            return JsonResponse({
                'success': True,
                'message': 'Tarea creada exitosamente',
                'tarea': nueva_tarea
            })
            
        except Exception as e:
            return JsonResponse({
                'error': f'Error al crear la tarea: {str(e)}'
            }, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_actualizar_estado_tarea(request):
    """
    API para actualizar el estado de una tarea
    """
    global tareas_temporales
    
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    if request.method == 'POST':
        try:
            tarea_id = request.POST.get('tarea_id')
            nuevo_estado = request.POST.get('nuevo_estado')
            
            # Validaciones básicas
            if not tarea_id:
                return JsonResponse({'error': 'ID de tarea requerido'}, status=400)
            
            if not nuevo_estado:
                return JsonResponse({'error': 'Nuevo estado requerido'}, status=400)
            
            estados_validos = ['pendiente', 'en_progreso', 'completada', 'cancelada']
            if nuevo_estado not in estados_validos:
                return JsonResponse({'error': 'Estado no válido'}, status=400)
            
            # Buscar la tarea en la lista temporal
            tarea_encontrada = None
            for i, tarea in enumerate(tareas_temporales):
                if str(tarea['id']) == str(tarea_id):
                    tarea_encontrada = tarea
                    break
            
            if not tarea_encontrada:
                return JsonResponse({'error': 'Tarea no encontrada'}, status=404)
            
            # Verificar permisos: solo el responsable puede cambiar estados
            if tarea_encontrada['responsable_id'] != request.user.id:
                return JsonResponse({'error': 'Solo el responsable puede cambiar el estado de la tarea'}, status=403)
            
            # Actualizar el estado
            tarea_encontrada['estado'] = nuevo_estado
            
            return JsonResponse({
                'success': True,
                'message': 'Estado actualizado exitosamente',
                'tarea': tarea_encontrada
            })
            
        except Exception as e:
            return JsonResponse({
                'error': f'Error al actualizar estado: {str(e)}'
            }, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_actualizar_tarea(request):
    """
    API para actualizar una tarea completa (solo creadores)
    """
    global tareas_temporales
    
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    if request.method == 'POST':
        try:
            from datetime import datetime
            from django.contrib.auth.models import User
            from .models import Proyecto
            
            # Obtener datos del request
            tarea_id = request.POST.get('tarea_id')
            titulo = request.POST.get('titulo', '').strip()
            descripcion = request.POST.get('descripcion', '').strip()
            proyecto_id = request.POST.get('proyecto_id')
            alta_prioridad = request.POST.get('alta_prioridad', 'false').lower() == 'true'
            prioridad = 'alta' if alta_prioridad else 'media'
            fecha_limite = request.POST.get('fecha_limite')
            responsable_id = request.POST.get('responsable_id')
            participantes_json = request.POST.get('participantes', '[]')
            observadores_json = request.POST.get('observadores', '[]')
            
            # Validaciones básicas
            if not tarea_id:
                return JsonResponse({'error': 'ID de tarea requerido'}, status=400)
            
            if not titulo:
                return JsonResponse({'error': 'El título es requerido'}, status=400)
            
            # Buscar la tarea en la lista temporal
            tarea_encontrada = None
            for i, tarea in enumerate(tareas_temporales):
                if str(tarea['id']) == str(tarea_id):
                    tarea_encontrada = tarea
                    break
            
            if not tarea_encontrada:
                return JsonResponse({'error': 'Tarea no encontrada'}, status=404)
            
            # Verificar permisos: solo el creador puede editar
            if tarea_encontrada['creado_por_id'] != request.user.id:
                return JsonResponse({'error': 'Solo el creador puede editar la tarea'}, status=403)
            
            # Obtener el nombre del responsable
            responsable_nombre = tarea_encontrada['responsable']  # Mantener actual por defecto
            if responsable_id:
                try:
                    responsable_user = User.objects.get(id=responsable_id)
                    responsable_nombre = responsable_user.username
                except User.DoesNotExist:
                    pass  # Mantener el valor actual
            
            # Actualizar los campos de la tarea
            tarea_encontrada.update({
                'titulo': titulo,
                'descripcion': descripcion,
                'prioridad': prioridad,
                'fecha_limite': fecha_limite,
                'responsable': responsable_nombre,
                'responsable_id': responsable_id or tarea_encontrada['responsable_id'],
            })
            
            return JsonResponse({
                'success': True,
                'message': 'Tarea actualizada exitosamente',
                'tarea': tarea_encontrada
            })
            
        except Exception as e:
            return JsonResponse({
                'error': f'Error al actualizar la tarea: {str(e)}'
            }, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required  
def api_estadisticas_tareas_proyectos(request):
    """
    API para obtener estadísticas de tareas y proyectos
    """
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    # Por ahora, devolver estadísticas de ejemplo
    estadisticas = {
        'proyectos_activos': 2,
        'tareas_pendientes': 3,
        'tareas_completadas': 12,
        'progreso_general': 68
    }
    
    return JsonResponse({
        'success': True,
        **estadisticas
    })

@login_required
def api_buscar_usuarios(request):
    """
    API para buscar usuarios para agregar como miembros del proyecto
    """
    print(f"🔍 api_buscar_usuarios - Usuario: {request.user.username}, Autenticado: {request.user.is_authenticated}")
    
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)
    
    search_query = request.GET.get('q', '').strip()
    
    from django.contrib.auth.models import User
    
    if search_query and len(search_query) >= 2:
        # Buscar usuarios por nombre, apellido o username
        usuarios = User.objects.filter(
            Q(first_name__icontains=search_query) |
            Q(last_name__icontains=search_query) |
            Q(username__icontains=search_query)
        ).exclude(id=request.user.id)[:10]  # Excluir usuario actual y limitar a 10
    else:
        # Si no hay query, devolver todos los usuarios (para mostrar lista completa)
        usuarios = User.objects.exclude(id=request.user.id).order_by('first_name', 'last_name', 'username')[:15]
    
    usuarios_data = []
    for usuario in usuarios:
        # Generar iniciales
        if usuario.first_name and usuario.last_name:
            iniciales = f"{usuario.first_name[0]}{usuario.last_name[0]}".upper()
            nombre_completo = f"{usuario.first_name} {usuario.last_name}"
        elif usuario.first_name:
            iniciales = usuario.first_name[0].upper()
            nombre_completo = usuario.first_name
        else:
            iniciales = usuario.username[0].upper() if usuario.username else "?"
            nombre_completo = usuario.username
        
        # Determinar rol/cargo
        if usuario.is_superuser:
            rol = "Administrador"
        elif hasattr(usuario, 'groups') and usuario.groups.filter(name='Supervisores').exists():
            rol = "Supervisor"
        else:
            rol = "Usuario"
        
        # Obtener avatar_url del usuario
        avatar_url = None
        if hasattr(usuario, 'userprofile'):
            try:
                avatar_url = usuario.userprofile.get_avatar_url()
            except:
                avatar_url = None
        
        usuarios_data.append({
            'id': usuario.id,
            'nombre': nombre_completo,
            'username': usuario.username,
            'iniciales': iniciales,
            'rol': rol,
            'email': usuario.email or '',
            'avatar_url': avatar_url
        })
    
    return JsonResponse({
        'success': True,
        'usuarios': usuarios_data
    })

@login_required
def api_crear_proyecto(request):
    """
    API para crear un nuevo proyecto con miembros y enviar notificaciones
    """
    print(f"🔍 Usuario: {request.user.username}, Autenticado: {request.user.is_authenticated}, Superusuario: {request.user.is_superuser}")
    
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Usuario no autenticado'}, status=401)
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        import json
        data = json.loads(request.body)
        
        # Validar datos requeridos
        nombre = data.get('nombre', '').strip()
        if not nombre:
            return JsonResponse({'error': 'El nombre del proyecto es requerido'}, status=400)
        
        descripcion = data.get('descripcion', '').strip()
        privacidad = data.get('privacidad', 'publico')
        tipo = data.get('tipo', 'runrate')
        miembros_ids = data.get('miembros', [])
        
        # Crear el proyecto real en la base de datos
        proyecto = Proyecto.objects.create(
            nombre=nombre,
            descripcion=descripcion,
            tipo=tipo,
            privacidad=privacidad,
            creado_por=request.user
        )
        
        # Crear comentario inicial con la descripción del proyecto (si existe)
        if descripcion.strip():
            ProyectoComentario.objects.create(
                proyecto=proyecto,
                usuario=request.user,
                contenido=f"📝 Proyecto creado: {descripcion}"
            )
        
        # Agregar miembros al proyecto y enviar notificaciones
        from django.contrib.auth.models import User
        miembros_notificados = []
        
        for miembro_id in miembros_ids:
            try:
                usuario = User.objects.get(id=miembro_id)
                # Agregar como miembro del proyecto
                proyecto.miembros.add(usuario)
                
                # Enviar notificación
                notificacion = notificar_miembro_agregado_proyecto(
                    usuario_agregado=usuario,
                    proyecto_nombre=nombre,
                    proyecto_id=proyecto.id,
                    usuario_que_agrega=request.user
                )
                if notificacion:
                    miembros_notificados.append({
                        'id': usuario.id,
                        'nombre': usuario.get_full_name() or usuario.username,
                        'notificado': True
                    })
            except User.DoesNotExist:
                continue
        
        print(f"✅ Proyecto '{nombre}' creado. Notificaciones enviadas a {len(miembros_notificados)} miembros.")
        
        return JsonResponse({
            'success': True,
            'mensaje': 'Proyecto creado exitosamente',
            'proyecto': {
                'id': proyecto.id,
                'nombre': proyecto.nombre,
                'descripcion': proyecto.descripcion,
                'privacidad': proyecto.privacidad,
                'tipo': proyecto.tipo,
                'miembros_notificados': miembros_notificados,
                'creado_por': request.user.get_full_name() or request.user.username,
                'fecha_creacion': proyecto.fecha_creacion.strftime('%Y-%m-%d')
            }
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Datos JSON inválidos'}, status=400)
    except Exception as e:
        print(f"❌ Error creando proyecto: {e}")
        return JsonResponse({'error': 'Error interno del servidor'}, status=500)


@login_required
def proyecto_detalle(request, proyecto_id):
    """
    Vista para el detalle individual de un proyecto
    """
    try:
        # Obtener el proyecto real de la base de datos
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        
        # Verificar permisos - cualquier usuario autenticado puede ver proyectos públicos
        # Solo miembros o creador pueden ver proyectos privados
        if proyecto.privacidad == 'privado':
            if request.user != proyecto.creado_por and request.user not in proyecto.miembros.all():
                return redirect('tareas_proyectos')
        
        # Crear datos del proyecto para el template
        proyecto_data = {
            'id': proyecto.id,
            'nombre': proyecto.nombre,
            'descripcion': proyecto.descripcion,
            'tipo': proyecto.tipo,
            'privacidad': proyecto.privacidad,
            'fecha_creacion': proyecto.fecha_creacion.strftime('%d de %b, %Y'),
            'creado_por': proyecto.creado_por,
            'miembros': proyecto.get_miembros_display(),
            'mi_rol': proyecto.get_rol_usuario(request.user)
        }
        
        context = {
            'proyecto': proyecto_data,
            'user': request.user,
            'page_title': f'Proyecto: {proyecto.nombre}'
        }
        
        return render(request, 'proyecto_detalle.html', context)
        
    except Proyecto.DoesNotExist:
        return redirect('tareas_proyectos')


@login_required
def api_comentarios_proyecto(request, proyecto_id):
    """
    API para obtener comentarios de un proyecto
    """
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        
        # Verificar permisos
        if proyecto.privacidad == 'privado':
            if request.user != proyecto.creado_por and request.user not in proyecto.miembros.all():
                return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        comentarios = ProyectoComentario.objects.filter(proyecto=proyecto).order_by('-fecha_creacion')
        
        comentarios_data = []
        for comentario in comentarios:
            archivos_data = []
            for archivo in comentario.archivos.all():
                archivos_data.append({
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'tamaño': archivo.get_tamaño_legible(),
                    'icono': archivo.get_icono(),
                    'url': archivo.archivo.url,
                    'tipo': archivo.tipo_contenido
                })
            
            comentarios_data.append({
                'id': comentario.id,
                'contenido': getattr(comentario, 'get_contenido_con_menciones', lambda: comentario.contenido)(),
                'contenido_raw': comentario.contenido,
                'usuario': {
                    'id': comentario.usuario.id,
                    'nombre': comentario.usuario.get_full_name() or comentario.usuario.username,
                    'username': comentario.usuario.username,
                    'iniciales': ''.join([palabra[0].upper() for palabra in (comentario.usuario.get_full_name() or comentario.usuario.username).split()[:2]]),
                    'avatar_url': getattr(comentario.usuario.userprofile, 'get_avatar_url', lambda: None)() if hasattr(comentario.usuario, 'userprofile') else None
                },
                'fecha': comentario.fecha_creacion.strftime('%d de %b, %Y - %H:%M'),
                'fecha_edicion': comentario.fecha_edicion.strftime('%d de %b, %Y - %H:%M') if comentario.fecha_edicion else None,
                'editado': comentario.editado,
                'archivos': archivos_data,
                'puede_editar': comentario.usuario == request.user,
                'puede_eliminar': comentario.usuario == request.user or proyecto.creado_por == request.user
            })
        
        return JsonResponse({
            'success': True,
            'comentarios': comentarios_data
        })
        
    except Exception as e:
        print(f"Error obteniendo comentarios: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def debug_tarea(request, tarea_id):
    """Vista de debug para investigar problemas con tareas"""
    debug_info = []
    
    try:
        # Verificar si existen los modelos
        try:
            from .models import Tarea, TareaComentario
            debug_info.append("✅ Modelos importados correctamente")
        except Exception as e:
            debug_info.append(f"❌ Error importando modelos: {e}")
            return JsonResponse({'debug': debug_info}, status=500)
        
        # Verificar tareas existentes
        try:
            total_tareas = Tarea.objects.count()
            debug_info.append(f"📊 Total de tareas en BD: {total_tareas}")
            
            if total_tareas > 0:
                primeras_tareas = list(Tarea.objects.values('id', 'titulo')[:5])
                debug_info.append(f"📋 Primeras 5 tareas: {primeras_tareas}")
        except Exception as e:
            debug_info.append(f"❌ Error consultando tareas: {e}")
        
        # Verificar tarea específica
        try:
            tarea = Tarea.objects.get(id=tarea_id)
            debug_info.append(f"✅ Tarea {tarea_id} encontrada: {tarea.titulo}")
            debug_info.append(f"📍 Proyecto: {tarea.proyecto}")
            debug_info.append(f"👤 Creado por: {tarea.creado_por}")
            debug_info.append(f"👤 Asignado a: {tarea.asignado_a}")
        except Tarea.DoesNotExist:
            debug_info.append(f"❌ Tarea {tarea_id} NO EXISTE")
        except Exception as e:
            debug_info.append(f"❌ Error consultando tarea {tarea_id}: {e}")
        
        # Verificar comentarios
        try:
            total_comentarios = TareaComentario.objects.count()
            debug_info.append(f"💬 Total comentarios de tareas: {total_comentarios}")
        except Exception as e:
            debug_info.append(f"❌ Error consultando comentarios: {e}")
        
        return JsonResponse({
            'debug': debug_info,
            'user': str(request.user),
            'tarea_id_solicitada': tarea_id
        })
        
    except Exception as e:
        debug_info.append(f"❌ Error general: {e}")
        return JsonResponse({'debug': debug_info}, status=500)

@login_required
def crear_tarea_prueba(request):
    """Vista para crear una tarea de prueba"""
    try:
        from .models import Tarea, Proyecto
        
        # Buscar un proyecto existente (proyecto ID 4 basado en los logs)
        try:
            proyecto = Proyecto.objects.get(id=4)
        except Proyecto.DoesNotExist:
            # Si no existe el proyecto 4, tomar el primero disponible
            proyecto = Proyecto.objects.first()
            if not proyecto:
                return JsonResponse({'error': 'No hay proyectos en la base de datos'}, status=400)
        
        # Crear tarea de prueba
        tarea = Tarea.objects.create(
            titulo="Tarea de Prueba para Timeline",
            descripcion="Esta es una tarea creada automáticamente para probar el timeline de comentarios.",
            proyecto=proyecto,
            creado_por=request.user,
            asignado_a=request.user,
            estado='pendiente',
            prioridad='media'
        )
        
        # Crear un comentario de prueba
        from .models import TareaComentario
        comentario = TareaComentario.objects.create(
            tarea=tarea,
            usuario=request.user,
            contenido="Este es un comentario de prueba para verificar que el timeline funciona correctamente."
        )
        
        return JsonResponse({
            'success': True,
            'tarea_id': tarea.id,
            'tarea_titulo': tarea.titulo,
            'proyecto': proyecto.nombre,
            'comentario_id': comentario.id,
            'mensaje': f'Tarea creada exitosamente con ID: {tarea.id}'
        })
        
    except Exception as e:
        return JsonResponse({'error': f'Error creando tarea: {str(e)}'}, status=500)

def get_safe_file_info(archivo):
    """Helper function para obtener información segura de archivos"""
    try:
        tamaño = archivo.get_tamaño_legible() if hasattr(archivo, 'get_tamaño_legible') else f"{archivo.tamaño} bytes"
    except:
        tamaño = f"{archivo.tamaño} bytes"
    
    try:
        icono = archivo.get_icono() if hasattr(archivo, 'get_icono') else '📎'
    except:
        icono = '📎'
    
    return {
        'id': archivo.id,
        'nombre': archivo.nombre_original,
        'tamaño': tamaño,
        'icono': icono,
        'url': archivo.archivo.url,
        'tipo': archivo.tipo_contenido
    }

@login_required
def api_comentarios_tarea(request, tarea_id):
    """
    API para obtener comentarios de una tarea
    """
    try:
        # Debug paso por paso
        debug_info = []
        debug_info.append(f"Buscando tarea con ID: {tarea_id}")
        
        # Verificar si existe el modelo Tarea
        try:
            from .models import Tarea
            debug_info.append("Modelo Tarea importado correctamente")
        except Exception as e:
            debug_info.append(f"Error importando modelo Tarea: {e}")
            return JsonResponse({'error': 'Error en modelo Tarea', 'debug': debug_info}, status=500)
        
        # Buscar la tarea
        try:
            tarea = Tarea.objects.get(id=tarea_id)
            debug_info.append(f"Tarea encontrada: {tarea}")
        except Tarea.DoesNotExist:
            debug_info.append("Tarea no existe")
            return JsonResponse({'error': 'Tarea no encontrada', 'debug': debug_info}, status=404)
        except Exception as e:
            debug_info.append(f"Error buscando tarea: {e}")
            return JsonResponse({'error': 'Error en consulta de tarea', 'debug': debug_info}, status=500)
        
        # Verificar relación con proyecto
        try:
            proyecto = tarea.proyecto
            debug_info.append(f"Proyecto relacionado: {proyecto}")
        except Exception as e:
            debug_info.append(f"Error accediendo al proyecto: {e}")
            return JsonResponse({'error': 'Error en relación proyecto', 'debug': debug_info}, status=500)
        
        # Verificar permisos: solo miembros del proyecto o el creador/asignado de la tarea
        try:
            debug_info.append(f"Usuario actual: {request.user}")
            debug_info.append(f"Creado por: {tarea.creado_por}")
            debug_info.append(f"Asignado a: {tarea.asignado_a}")
            
            if request.user != tarea.creado_por and request.user != tarea.asignado_a and request.user not in tarea.proyecto.miembros.all():
                return JsonResponse({'error': 'Sin permisos'}, status=403)
            debug_info.append("Permisos verificados correctamente")
        except Exception as e:
            debug_info.append(f"Error verificando permisos: {e}")
            return JsonResponse({'error': 'Error en verificación de permisos', 'debug': debug_info}, status=500)
        
        # Buscar comentarios
        try:
            from .models import TareaComentario
            debug_info.append("Modelo TareaComentario importado correctamente")
            comentarios = TareaComentario.objects.filter(tarea=tarea).order_by('-fecha_creacion')
            debug_info.append(f"Comentarios encontrados: {comentarios.count()}")
        except Exception as e:
            debug_info.append(f"Error buscando comentarios: {e}")
            return JsonResponse({'error': 'Error en consulta de comentarios', 'debug': debug_info}, status=500)
        
        # Procesar comentarios con debug detallado
        try:
            comentarios_data = []
            debug_info.append(f"Procesando {comentarios.count()} comentarios")
            
            for i, comentario in enumerate(comentarios):
                debug_info.append(f"Procesando comentario {i+1}: {comentario.id}")
                
                try:
                    # Procesar archivos de forma segura
                    archivos_data = []
                    try:
                        for archivo in comentario.archivos.all():
                            archivos_data.append(get_safe_file_info(archivo))
                        debug_info.append(f"Archivos procesados para comentario {i+1}: {len(archivos_data)}")
                    except Exception as e:
                        debug_info.append(f"Error procesando archivos del comentario {i+1}: {e}")
                        archivos_data = []
                    
                    comentarios_data.append({
                        'id': comentario.id,
                        'contenido': getattr(comentario, 'get_contenido_con_menciones', lambda: comentario.contenido)(),
                        'contenido_raw': comentario.contenido,
                        'usuario': {
                            'id': comentario.usuario.id,
                            'nombre': comentario.usuario.get_full_name() or comentario.usuario.username,
                            'username': comentario.usuario.username,
                            'iniciales': ''.join([palabra[0].upper() for palabra in (comentario.usuario.get_full_name() or comentario.usuario.username).split()[:2]]),
                            'avatar_url': getattr(comentario.usuario.userprofile, 'get_avatar_url', lambda: None)() if hasattr(comentario.usuario, 'userprofile') else None
                        },
                        'fecha': comentario.fecha_creacion.strftime('%d de %b, %Y - %H:%M'),
                        'fecha_edicion': comentario.fecha_edicion.strftime('%d de %b, %Y - %H:%M') if comentario.fecha_edicion else None,
                        'editado': comentario.editado,
                        'archivos': archivos_data,
                        'puede_editar': comentario.usuario == request.user,
                        'puede_eliminar': comentario.usuario == request.user or tarea.creado_por == request.user or tarea.asignado_a == request.user
                    })
                    debug_info.append(f"Comentario {i+1} procesado correctamente")
                    
                except Exception as e:
                    debug_info.append(f"Error procesando comentario {i+1}: {e}")
                    # Continuar con el siguiente comentario
                    continue
            
            debug_info.append("Todos los comentarios procesados correctamente")
            
            return JsonResponse({
                'success': True,
                'comentarios': comentarios_data,
                'debug': debug_info
            })
            
        except Exception as e:
            debug_info.append(f"Error general procesando comentarios: {e}")
            return JsonResponse({'error': 'Error procesando comentarios', 'debug': debug_info}, status=500)
        
    except Exception as e:
        import traceback
        print(f"Error obteniendo comentarios de tarea: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        
        # Incluir debug_info si existe
        error_response = {'error': f'Error interno: {str(e)}'}
        if 'debug_info' in locals():
            error_response['debug'] = debug_info
            
        return JsonResponse(error_response, status=500)


@login_required
def api_agregar_comentario_proyecto(request, proyecto_id):
    """
    API para agregar un comentario a un proyecto
    """
    print(f"🔍 api_agregar_comentario_proyecto - Usuario: {request.user.username}, Proyecto ID: {proyecto_id}")
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        proyecto = get_object_or_404(Proyecto, id=proyecto_id)
        print(f"✅ Proyecto encontrado: {proyecto.nombre}")
        
        # Verificar permisos
        if proyecto.privacidad == 'privado':
            if request.user != proyecto.creado_por and request.user not in proyecto.miembros.all():
                return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        contenido = request.POST.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'error': 'El comentario no puede estar vacío'}, status=400)
        
        # Crear el comentario
        comentario = ProyectoComentario.objects.create(
            proyecto=proyecto,
            usuario=request.user,
            contenido=contenido
        )
        
        # Procesar archivos adjuntos
        archivos_data = []
        for key, file in request.FILES.items():
            if key.startswith('archivo_'):
                archivo = ProyectoArchivo.objects.create(
                    comentario=comentario,
                    archivo=file,
                    nombre_original=file.name,
                    tamaño=file.size,
                    tipo_contenido=file.content_type or ''
                )
                archivos_data.append({
                    'id': archivo.id,
                    'nombre': archivo.nombre_original,
                    'tamaño': archivo.get_tamaño_legible(),
                    'icono': archivo.get_icono(),
                    'url': archivo.archivo.url,
                    'tipo': archivo.tipo_contenido
                })
        
        # Enviar notificaciones a usuarios mencionados
        usuarios_mencionados = comentario.extraer_menciones()
        for usuario_mencionado in usuarios_mencionados:
            if usuario_mencionado != request.user:  # No notificar al autor
                crear_notificacion(
                    usuario_destinatario=usuario_mencionado,
                    tipo='proyecto_agregado',
                    titulo=f"Te mencionaron en {proyecto.nombre}",
                    mensaje=f"{request.user.get_full_name() or request.user.username} te mencionó en el proyecto '{proyecto.nombre}': {contenido[:100]}...",
                    usuario_remitente=request.user,
                    proyecto_id=proyecto.id,
                    proyecto_nombre=proyecto.nombre
                )
        
        return JsonResponse({
            'success': True,
            'comentario': {
                'id': comentario.id,
                'contenido': getattr(comentario, 'get_contenido_con_menciones', lambda: comentario.contenido)(),
                'contenido_raw': comentario.contenido,
                'usuario': {
                    'id': comentario.usuario.id,
                    'nombre': comentario.usuario.get_full_name() or comentario.usuario.username,
                    'username': comentario.usuario.username,
                    'iniciales': ''.join([palabra[0].upper() for palabra in (comentario.usuario.get_full_name() or comentario.usuario.username).split()[:2]])
                },
                'fecha': comentario.fecha_creacion.strftime('%d de %b, %Y - %H:%M'),
                'fecha_edicion': None,
                'editado': False,
                'archivos': archivos_data,
                'puede_editar': True,
                'puede_eliminar': True
            }
        })
        
    except Exception as e:
        print(f"Error agregando comentario: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_agregar_comentario_tarea(request, tarea_id):
    """
    API para agregar un comentario a una tarea
    """
    print(f"🔍 api_agregar_comentario_tarea - Usuario: {request.user.username}, Tarea ID: {tarea_id}")
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        tarea = get_object_or_404(Tarea, id=tarea_id)
        print(f"✅ Tarea encontrada: {tarea.titulo}")
        
        # Verificar permisos: solo miembros del proyecto o el creador/asignado de la tarea
        if request.user != tarea.creado_por and request.user != tarea.asignado_a and request.user not in tarea.proyecto.miembros.all():
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        contenido = request.POST.get('contenido', '').strip()
        
        # Procesar archivos adjuntos
        archivos_keys = [key for key in request.FILES.keys() if key.startswith('archivos')]
        
        if not contenido and not archivos_keys:
            return JsonResponse({'error': 'Debe proporcionar contenido o archivos'}, status=400)
        
        # Crear el comentario
        comentario = TareaComentario.objects.create(
            tarea=tarea,
            usuario=request.user,
            contenido=contenido
        )
        
        archivos_data = []
        for key in archivos_keys:
            file = request.FILES[key]
            archivo = TareaArchivo.objects.create(
                comentario=comentario,
                archivo=file,
                nombre_original=file.name,
                tamaño=file.size,
                tipo_contenido=file.content_type or ''
            )
            archivos_data.append({
                'id': archivo.id,
                'nombre': archivo.nombre_original,
                'tamaño': archivo.get_tamaño_legible(),
                'icono': archivo.get_icono(),
                'url': archivo.archivo.url,
                'tipo': archivo.tipo_contenido
            })
        
        # Enviar notificaciones a usuarios mencionados (si se implementa en TareaComentario)
        if hasattr(comentario, 'extraer_menciones'):
            usuarios_mencionados = comentario.extraer_menciones()
            for usuario_mencionado in usuarios_mencionados:
                if usuario_mencionado != request.user:
                    crear_notificacion(
                        usuario_destinatario=usuario_mencionado,
                        tipo='mencion',
                        titulo=f"Te mencionaron en la tarea: {tarea.titulo}",
                        mensaje=f"{request.user.get_full_name() or request.user.username} te mencionó en la tarea '{tarea.titulo}': {contenido[:100]}...",
                        usuario_remitente=request.user,
                        proyecto_id=tarea.proyecto.id,
                        proyecto_nombre=tarea.proyecto.nombre
                    )
        
        return JsonResponse({
            'success': True,
            'comentario': {
                'id': comentario.id,
                'contenido': getattr(comentario, 'get_contenido_con_menciones', lambda: comentario.contenido)(),
                'contenido_raw': comentario.contenido,
                'usuario': {
                    'id': comentario.usuario.id,
                    'nombre': comentario.usuario.get_full_name() or comentario.usuario.username,
                    'username': comentario.usuario.username,
                    'iniciales': ''.join([palabra[0].upper() for palabra in (comentario.usuario.get_full_name() or comentario.usuario.username).split()[:2]])
                },
                'fecha': comentario.fecha_creacion.strftime('%d de %b, %Y - %H:%M'),
                'fecha_edicion': None,
                'editado': False,
                'archivos': archivos_data,
                'puede_editar': True,
                'puede_eliminar': True
            }
        })
        
    except Exception as e:
        print(f"Error agregando comentario a tarea: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_editar_comentario_proyecto(request, comentario_id):
    """
    API para editar un comentario de proyecto
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(ProyectoComentario, id=comentario_id)
        
        # Verificar permisos
        if comentario.usuario != request.user:
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        contenido = request.POST.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'error': 'El comentario no puede estar vacío'}, status=400)
        
        comentario.contenido = contenido
        comentario.save()
        
        return JsonResponse({
            'success': True,
            'contenido': comentario.get_contenido_con_menciones(),
            'fecha_edicion': comentario.fecha_edicion.strftime('%d de %b, %Y - %H:%M')
        })
        
    except Exception as e:
        print(f"Error editando comentario: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_editar_comentario_tarea(request, comentario_id):
    """
    API para editar un comentario de tarea
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(TareaComentario, id=comentario_id)
        
        # Verificar permisos
        if comentario.usuario != request.user:
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        contenido = request.POST.get('contenido', '').strip()
        if not contenido:
            return JsonResponse({'error': 'El comentario no puede estar vacío'}, status=400)
        
        comentario.contenido = contenido
        comentario.save()
        
        return JsonResponse({
            'success': True,
            'contenido': comentario.get_contenido_con_menciones(),
            'fecha_edicion': comentario.fecha_edicion.strftime('%d de %b, %Y - %H:%M')
        })
        
    except Exception as e:
        print(f"Error editando comentario de tarea: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_eliminar_comentario_proyecto(request, comentario_id):
    """
    API para eliminar un comentario de proyecto
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(ProyectoComentario, id=comentario_id)
        
        # Verificar permisos (autor del comentario o creador del proyecto)
        if comentario.usuario != request.user and comentario.proyecto.creado_por != request.user:
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        comentario.delete()
        
        return JsonResponse({'success': True})
        
    except Exception as e:
        print(f"Error eliminando comentario: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_eliminar_comentario_proyecto(request, comentario_id):
    """
    API para eliminar un comentario de proyecto
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(ProyectoComentario, id=comentario_id)
        
        # Verificar permisos (autor del comentario o creador del proyecto)
        if comentario.usuario != request.user and comentario.proyecto.creado_por != request.user:
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        comentario.delete()
        
        return JsonResponse({'success': True})
        
    except Exception as e:
        print(f"Error eliminando comentario: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def api_eliminar_comentario_tarea(request, comentario_id):
    """
    API para eliminar un comentario de tarea
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        comentario = get_object_or_404(TareaComentario, id=comentario_id)
        
        # Verificar permisos (autor del comentario, creador de la tarea o asignado a la tarea)
        if comentario.usuario != request.user and comentario.tarea.creado_por != request.user and comentario.tarea.asignado_a != request.user:
            return JsonResponse({'error': 'Sin permisos'}, status=403)
        
        comentario.delete()
        
        return JsonResponse({'success': True})
        
    except Exception as e:
        print(f"Error eliminando comentario de tarea: {e}")
        return JsonResponse({'error': 'Error interno'}, status=500)


@login_required
def dashboard(request):
    # Base queryset for user-specific or all opportunities
    if is_supervisor(request.user):
        base_opportunities = TodoItem.objects.all()
    else:
        base_opportunities = TodoItem.objects.filter(usuario=request.user)

    # --- Key Metrics ---

    # 1. Top Client by total opportunity amount
    top_cliente = base_opportunities.filter(cliente__isnull=False).values(
        'cliente__id', 'cliente__nombre_empresa'
    ).annotate(
        total_monto=Sum('monto')
    ).order_by('-total_monto').first()

    # 2. Top Brand (Product) by total opportunity amount
    top_marca_data = base_opportunities.values('producto').annotate(
        total_monto=Sum('monto')
    ).order_by('-total_monto').first()
    
    top_marca = None
    if top_marca_data and top_marca_data['producto']:
        top_marca = {
            'nombre_marca': _get_display_for_value(top_marca_data['producto'], TodoItem.PRODUCTO_CHOICES),
            'total_monto': top_marca_data['total_monto'],
            'marca': top_marca_data['producto']
        }

    # --- Current Month ---
    today = date.today()
    mes_actual_val = str(today.month).zfill(2)
    mes_actual_nombre = dict(TodoItem.MES_CHOICES).get(mes_actual_val, f"Mes {today.month}")
    
    # Filtrar por fecha de creación del mes actual
    oportunidades_mes_actual = base_opportunities.filter(
        fecha_creacion__year=today.year,
        fecha_creacion__month=today.month
    )
    monto_total_mes_actual = oportunidades_mes_actual.aggregate(total=Sum('monto'))['total'] or Decimal('0.00')
    
    META_MENSUAL = Decimal('350000.00') if is_supervisor(request.user) else Decimal('130000.00')
    porcentaje_cobertura_mes_actual = min(100, int((monto_total_mes_actual / META_MENSUAL * 100) if META_MENSUAL > 0 else 0))

    # --- Next Month ---
    next_month_date = today + relativedelta(months=1)
    next_month_value = str(next_month_date.month).zfill(2)
    next_month_display = dict(TodoItem.MES_CHOICES).get(next_month_value, f"Mes {next_month_date.month}")
    
    # Filtrar por mes de cierre del próximo mes (búsqueda robusta)
    oportunidades_proximo_mes = base_opportunities.filter(
        Q(mes_cierre=next_month_value) |  # Formato con ceros (11)
        Q(mes_cierre=str(next_month_date.month)) |  # Formato sin ceros (11)
        Q(mes_cierre=next_month_display.upper()) |  # Nombre del mes
        Q(mes_cierre=next_month_display.lower())   # Nombre del mes en minúscula
    )
    total_oportunidades_proximo_mes = oportunidades_proximo_mes.count()
    total_monto_esperado_proximo_mes = oportunidades_proximo_mes.aggregate(total=Sum('monto'))['total'] or Decimal('0.00')

    # --- Chart Data: Opportunities per month by creation date ---
    ano_actual = today.year
    ventas_por_mes = base_opportunities.filter(
        fecha_creacion__year=ano_actual
    ).extra(
        select={'mes_creacion': 'EXTRACT(month FROM fecha_creacion)'}
    ).values('mes_creacion').annotate(
        total=Sum('monto')
    ).order_by('mes_creacion')
    
    ventas_por_mes_dict = {int(v['mes_creacion']): float(v['total'] or 0) for v in ventas_por_mes}
    ventas_por_mes_list = []
    for i in range(1, 13):
        ventas_por_mes_list.append({'mes': f'{ano_actual}-{str(i).zfill(2)}', 'total': ventas_por_mes_dict.get(i, 0)})

    # --- Additional Statistics ---
    total_oportunidades_count = base_opportunities.count()
    total_monto_general = base_opportunities.aggregate(total=Sum('monto'))['total'] or Decimal('0.00')
    promedio_oportunidad = total_monto_general / total_oportunidades_count if total_oportunidades_count > 0 else Decimal('0.00')
    oportunidades_ano_actual = base_opportunities.filter(fecha_creacion__year=ano_actual).count()

    context = {
        'is_supervisor': is_supervisor(request.user),
        
        # Key Widgets
        'top_cliente': top_cliente,
        'top_marca': top_marca,
        
        # Current Month
        'mes_actual_nombre': mes_actual_nombre,
        'monto_total_mes_actual': monto_total_mes_actual,
        'porcentaje_cobertura_mes_actual': porcentaje_cobertura_mes_actual,
        'mes_actual_val': mes_actual_val,

        # Next Month
        'next_month_display': next_month_display,
        'proximo_mes_val': next_month_value,
        'total_oportunidades_proximo_mes': total_oportunidades_proximo_mes,
        'total_monto_esperado_proximo_mes': total_monto_esperado_proximo_mes,
        
        # Chart
        'ventas_por_mes_list': ventas_por_mes_list,
        
        # Additional Statistics
        'total_oportunidades_count': total_oportunidades_count,
        'promedio_oportunidad': promedio_oportunidad,
        'oportunidades_ano_actual': oportunidades_ano_actual,
    }
    return render(request, "dashboard.html", context)


@login_required
def get_user_clients_api(request):
    """
    Vista API que devuelve los clientes asignados al usuario autenticado.
    Si el usuario es supervisor, devuelve todos los clientes.
    """
    try:
        if is_supervisor(request.user):
            # Si el usuario es supervisor, obtener todos los clientes
            clients_queryset = Cliente.objects.all()
            print("DEBUG: Usuario es supervisor. Obteniendo todos los clientes.")
        else:
            # Si no es supervisor, obtener solo los clientes asignados a este usuario
            # Usamos 'asignado_a' que es el campo correcto en tu modelo Cliente
            clients_queryset = Cliente.objects.filter(asignado_a=request.user)
            print(f"DEBUG: Usuario {request.user.username} es vendedor. Obteniendo sus clientes.")

        # Serializar los clientes a un formato que pueda ser convertido a JSON
        clients_data = []
        for client in clients_queryset:
            clients_data.append({
                'id': client.id, # Convertir ID a número para consistencia
                'name': client.nombre_empresa, # Mapear nombre_empresa a 'name'
                'nombre_empresa': client.nombre_empresa, # Mantener también el nombre original
                'address': client.direccion, # Mapear direccion a 'address'
                'taxId': client.email, # Mapear email a 'taxId' (o el campo que uses para ID Fiscal)
                'categoria': client.categoria, # Categoría del cliente (A, B, C)
                'porcentaje_utilidad': 15 if client.categoria == 'A' else 20 if client.categoria == 'B' else 25 # Porcentaje de utilidad según categoría
                # Puedes añadir más campos aquí si los necesitas en el frontend
            })
        return JsonResponse(clients_data, safe=False) # safe=False permite serializar listas directamente
    except Exception as e:
        print(f"ERROR en get_user_clients_api: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def view_cotizacion_pdf(request, cotizacion_id):
    """
    Vista para generar y mostrar el PDF de una cotización específica en el navegador.
    """
    print(f"DEBUG: Iniciando view_cotizacion_pdf para la cotización ID: {cotizacion_id}")
    cotizacion = get_object_or_404(Cotizacion, pk=cotizacion_id)
    
    if not is_supervisor(request.user) and cotizacion.created_by != request.user:
        return HttpResponse("Acceso denegado.", status=403)

    detalles_cotizacion = DetalleCotizacion.objects.filter(cotizacion=cotizacion).order_by('orden')
    iva_rate_percentage = (cotizacion.iva_rate * Decimal('100')).quantize(Decimal('1'))
    
    # Organizar productos en secciones basadas en títulos
    secciones = []
    seccion_actual = {'titulo': None, 'productos': []}
    
    for detalle in detalles_cotizacion:
        # Manejar productos existentes que no tienen el campo tipo definido
        tipo_detalle = getattr(detalle, 'tipo', 'producto') or 'producto'
        
        if tipo_detalle == 'titulo':
            # Si hay productos en la sección actual, guardarla ANTES de crear nueva sección
            if seccion_actual['productos']:
                secciones.append(seccion_actual)
            # Si hay una sección actual con título pero sin productos, también la guardamos
            elif seccion_actual['titulo']:
                secciones.append(seccion_actual)
                
            # Iniciar nueva sección
            seccion_actual = {'titulo': detalle.nombre_producto, 'productos': []}
        else:
            # Agregar producto a la sección actual
            seccion_actual['productos'].append(detalle)
    
    # Agregar la última sección (con o sin productos)
    if seccion_actual['titulo'] or seccion_actual['productos']:
        secciones.append(seccion_actual)
    
    # Si no hay títulos, crear una sección por defecto
    if not secciones:
        productos_sin_seccion = [d for d in detalles_cotizacion if getattr(d, 'tipo', 'producto') == 'producto']
        if productos_sin_seccion:
            secciones.append({'titulo': None, 'productos': productos_sin_seccion})
    
    print(f"DEBUG: Secciones organizadas en view_cotizacion_pdf: {len(secciones)} secciones encontradas")
    for i, seccion in enumerate(secciones):
        print(f"DEBUG: Sección {i+1}: titulo='{seccion['titulo']}', productos={len(seccion['productos'])}")
        for j, producto in enumerate(seccion['productos']):
            print(f"  Producto {j+1}: {producto.nombre_producto} (tipo: {getattr(producto, 'tipo', 'NO_DEFINIDO')})")

    pdf_name_raw = cotizacion.nombre_cotizacion or f"Cotizacion_{cotizacion.id}"
    pdf_name = "".join(c for c in pdf_name_raw if c.isalnum() or c in ('_', '-')).strip().replace(' ', '_')
    if not pdf_name:
        pdf_name = f"Cotizacion_{cotizacion.id}"

    tipo_cotizacion = cotizacion.tipo_cotizacion
    logo_base64 = ""
    company_name = ""
    company_address = ""
    company_phone = ""
    company_email = ""
    template_name = 'cotizacion_pdf_template.html' # Default template

    if tipo_cotizacion and tipo_cotizacion.lower() == 'iamet':
        template_name = 'iamet_cotizacion_pdf_template.html'
        company_name = 'IAMET S.A. de C.V.'
        company_address = 'Av. Principal #456, Col. Centro, Guadalajara, Jalisco'
        company_phone = '+52 33 9876 5432'
        company_email = 'contacto@iamet.com'
    elif tipo_cotizacion and tipo_cotizacion.lower() == 'bajanet':
        template_name = 'cotizacion_pdf_template.html'
        company_name = 'BAJANET S.A. de C.V.'
        company_address = 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México'
        company_phone = '+52 55 1234 5678'
        company_email = 'ventas@bajanet.com'
        try:
            logo_url = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRV1xCutWCicl-yXCjMjH5P5jTZA0R993cG9g&s"
            response = requests.get(logo_url)
            response.raise_for_status() # Raise an exception for HTTP errors
            logo_base64 = base64.b64encode(response.content).decode('utf-8')
        except requests.exceptions.RequestException as e:
            print(f"ERROR: Error fetching Bajanet logo from URL: {e}")
            logo_base64 = "" # Fallback to empty string if fetching fails
    else: # Fallback to Bajanet if type is not recognized or None
        template_name = 'cotizacion_pdf_template.html'
        company_name = 'BAJANET S.A. de C.V.'
        company_address = 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México'
        company_phone = '+52 55 1234 5678'
        company_email = 'ventas@bajanet.com'
        try:
            logo_url = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRV1xCutWCicl-yXCjMjH5P5jTZA0R993cG9g&s"
            response = requests.get(logo_url)
            response.raise_for_status() # Raise an exception for HTTP errors
            logo_base64 = base64.b64encode(response.content).decode('utf-8')
        except requests.exceptions.RequestException as e:
            print(f"ERROR: Error fetching Bajanet logo from URL: {e}")
            logo_base64 = "" # Fallback to empty string if fetching fails


    context = {
        'cotizacion': cotizacion,
        'detalles_cotizacion': detalles_cotizacion,
        'secciones': secciones,
        'request_user': request.user,
        'current_date': date.today(),
        'company_name': company_name,
        'company_address': company_address,
        'company_phone': company_phone,
        'company_email': company_email,
        'logo_base64': logo_base64,
        'iva_rate_percentage': iva_rate_percentage,
    }

    try:
        print(f"DEBUG: Attempting to render template: {template_name}")
        html_string = render_to_string(template_name, context)
        print("DEBUG: Template rendered to HTML string.")
    except Exception as e:
        print(f"ERROR: Error rendering template '{template_name}': {e}")
        return HttpResponse(f"Internal server error rendering PDF: {e}", status=500)

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{pdf_name}.pdf"'

    try:
        print("DEBUG: Attempting to generate PDF with WeasyPrint.")
        HTML(string=html_string).write_pdf(response)
        print("DEBUG: PDF generated successfully.")
    except Exception as e:
        print(f"ERROR: Error generating PDF with WeasyPrint: {e}")
        return HttpResponse(f"Internal server error generating PDF: {e}", status=500)
        
    return response





@login_required
def todos (request):
    # Determinar si el usuario es un supervisor - Optimizar consultas con select_related
    if is_supervisor(request.user):
        items = TodoItem.objects.select_related('usuario', 'cliente').all()
    else:
        items = TodoItem.objects.select_related('usuario', 'cliente').filter(usuario=request.user)

    filter_form = VentaFilterForm(request.GET)

    if filter_form.is_valid():
        area = filter_form.cleaned_data.get('area')
        producto = filter_form.cleaned_data.get('producto')
        orden_monto = filter_form.cleaned_data.get('orden_monto')
        empleado = filter_form.cleaned_data.get('empleado')
        mes_cierre = filter_form.cleaned_data.get('mes_cierre')

        if area:
            items = items.filter(area=area)
        if producto:
            # Modificación aquí: hacer la búsqueda del producto insensible a mayúsculas/minúsculas
            items = items.filter(producto__iexact=producto) # Usa icontains o iexact para insensibilidad
        if empleado:
            items = items.filter(usuario=empleado)
        if mes_cierre:
            items = items.filter(mes_cierre=mes_cierre)

        if orden_monto:
            if orden_monto == 'monto_asc':
                items = items.order_by('monto')
            elif orden_monto == 'monto_desc':
                items = items.order_by('-monto')
        else:
            items = items.order_by('-fecha_creacion')
    else:
        # Ordenar por fecha_creación con índice optimizado
        items = items.order_by('-fecha_creacion')

    # Manejar búsqueda global ANTES de la paginación
    search_query = request.GET.get('search', '').strip()
    if search_query:
        # Búsqueda global en todas las oportunidades
        items = items.filter(oportunidad__icontains=search_query)

    reporte_activo = request.GET.get('reporte', 'false').lower() == 'true'

    if reporte_activo:
        # Modo reporte: No paginar, mostrar todos los items
        page_obj = None
        context_items = items
    else:
        # Modo normal: Aplicar paginación
        paginator = Paginator(items, 20)
        page_number = request.GET.get('page', 1)
        try:
            page_obj = paginator.get_page(page_number)
        except PageNotAnInteger:
            page_obj = paginator.page(1)
        except EmptyPage:
            page_obj = paginator.page(paginator.num_pages)
        context_items = page_obj

    # Obtener lista de empleados para el filtro
    from django.contrib.auth.models import User
    empleados = User.objects.filter(is_active=True).order_by('first_name', 'last_name')
    
    context = {
        "items": context_items,
        "page_obj": page_obj,
        "filter_form": filter_form,
        "is_supervisor": is_supervisor(request.user),
        "search_query": search_query,
        "reporte_activo": reporte_activo,
        "empleados": empleados,
    }
    return render (request, "todos.html", context)




from .bitrix_integration import get_or_create_bitrix_company, send_opportunity_to_bitrix, update_opportunity_in_bitrix, get_all_bitrix_companies, get_all_bitrix_contacts

@login_required
def ingresar_venta_todoitem(request):
    # Asegurarse de que messages y las funciones de bitrix_integration estén disponibles
    

    if request.method == 'POST':
        form = VentaForm(request.POST, user=request.user if not is_supervisor(request.user) else None)
        if form.is_valid():
            cliente_nombre = form.cleaned_data['cliente_nombre']
            bitrix_company_id_from_form = form.cleaned_data.get('bitrix_company_id')

            cliente = None
            # Escenario 1: Se seleccionó un cliente existente de Bitrix
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
                    messages.error(request, f"ERROR: No se pudo obtener o crear el cliente local: {e}")
                    form.add_error('cliente_nombre', 'Hubo un error al procesar el cliente.')
                    return render(request, 'ingresar_venta.html', {'form': form})
            # Escenario 2: Se escribió un nombre de cliente nuevo (sin ID de Bitrix)
            else:
                # Primero, crea la compañía en Bitrix para obtener un ID
                new_bitrix_company_id = get_or_create_bitrix_company(cliente_nombre, request=request)
                if new_bitrix_company_id:
                    cliente, created = Cliente.objects.get_or_create(
                        bitrix_company_id=new_bitrix_company_id,
                        defaults={'nombre_empresa': cliente_nombre}
                    )
                else:
                    messages.error(request, 'No se pudo crear la compañía en Bitrix. Verifique la configuración del webhook.')
                    form.add_error('cliente_nombre', 'No se pudo crear la compañía en Bitrix.')
                    return render(request, 'ingresar_venta.html', {'form': form})

            if cliente:
                venta = form.save(commit=False)
                venta.cliente = cliente
                if is_supervisor(request.user):
                    venta.usuario = form.cleaned_data['usuario']
                else:
                    venta.usuario = request.user
                
                venta.save() # Guardar la instancia de venta para obtener un PK
                
                # Crown Jewel Feature: Trigger immediate opportunity detection
                trigger_immediate_opportunity_notification(venta, request)

                try:
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
                        'bitrix_contact_id': venta.contacto.bitrix_contact_id if venta.contacto else None,
                    }
                    # Obtener el bitrix_user_id del usuario asignado
                    bitrix_assigned_by_id = None
                    if venta.usuario and hasattr(venta.usuario, 'userprofile') and venta.usuario.userprofile.bitrix_user_id:
                        bitrix_assigned_by_id = venta.usuario.userprofile.bitrix_user_id
                    opportunity_data['bitrix_assigned_by_id'] = bitrix_assigned_by_id
                    
                    bitrix_response = send_opportunity_to_bitrix(opportunity_data, request=request)
                    
                    if bitrix_response and bitrix_response.get('result'):
                        venta.bitrix_deal_id = bitrix_response.get('result')
                        venta.save(update_fields=['bitrix_deal_id']) # Actualizar solo el campo bitrix_deal_id
                        messages.success(request, "Oportunidad creada y sincronizada con Bitrix24.")
                    else:
                        messages.warning(request, "Oportunidad creada, pero no se pudo sincronizar con Bitrix24. Verifique los logs.")

                except Exception as e:
                    messages.error(request, f"Oportunidad creada localmente, pero falló la sincronización con Bitrix24: {e}")
                    print(f"ERROR: Falló la sincronización con Bitrix24 para la oportunidad {venta.id}: {e}")

                return redirect('ingresar_venta_todoitem_exitosa')

    else:
        form = VentaForm(user=request.user if not is_supervisor(request.user) else None)
    
    return render(request, 'ingresar_venta.html', {'form': form})

def ingresar_venta_todoitem_exitosa(request):
    return render(request, 'ingresar_venta_exitosa.html')

# Vistas de autenticación
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

from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def user_login(request):
    print(f"DEBUG: user_login view called. Method: {request.method}")
    if request.method == 'POST':
        form = AuthenticationForm(request, data=request.POST)
        print(f"DEBUG: Form created. Is valid: {form.is_valid()}")
        if form.is_valid():
            user = form.get_user()
            print(f"DEBUG: User {user.username} authenticated. Attempting login.")
            login(request, user)
            print(f"DEBUG: User {user.username} logged in. Redirecting to {settings.LOGIN_REDIRECT_URL}")
            return redirect(settings.LOGIN_REDIRECT_URL) # Redirigir a 'home' después de iniciar sesión
        else:
            print(f"DEBUG: Form is NOT valid. Errors: {form.errors}")
    else:
        form = AuthenticationForm()
        print("DEBUG: GET request. Displaying login form.")
    return render(request, 'login.html', {'form': form, 'hide_dock': True}) # Pasar hide_dock=True para ocultar el dock

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
            {
                'status': 'error', 
                'message': 'Error interno del servidor al cambiar el idioma',
                'debug': str(e) if settings.DEBUG else None
            },
            status=500
        )

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
                Sum('oportunidades__monto', filter=Q(oportunidades__probabilidad_cierre=100)),
                Value(Decimal('0.00'))
            )
        ).values(
            'id',
            'nombre_empresa',
            'total_monto'
        ).order_by('nombre_empresa')
        total_general = TodoItem.objects.filter(probabilidad_cierre=100).aggregate(
            sum_monto=Sum('monto')
        )['sum_monto'] or Decimal('0.00')
        usuarios = User.objects.filter(is_active=True)
    else:
        reporte_data = Cliente.objects.filter(asignado_a=request.user).annotate(
            total_monto=Coalesce(
                Sum('oportunidades__monto', filter=Q(oportunidades__probabilidad_cierre=100, oportunidades__usuario=request.user)),
                Value(Decimal('0.00'))
            )
        ).values(
            'id',
            'nombre_empresa',
            'total_monto'
        ).order_by('nombre_empresa')
        total_general = TodoItem.objects.filter(
            usuario=request.user, probabilidad_cierre=100
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
        print("DEBUG: Supervisor viendo oportunidades de cliente.")
    else:
        cliente_seleccionado = get_object_or_404(Cliente, pk=cliente_id, asignado_a=request.user) # Usar asignado_a
        oportunidades = TodoItem.objects.filter(cliente=cliente_seleccionado, usuario=request.user)
        print(f"DEBUG: Vendedor {request.user.username} viendo sus propias oportunidades de cliente.")

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
    print(f"DEBUG: producto_dashboard_detail - producto_val recibido RAW: {producto_val}")

    # Convertir a mayúsculas para asegurar que la comparación con PRODUCTO_CHOICES sea consistente
    producto_val_upper = producto_val.upper()
    print(f"DEBUG: producto_dashboard_detail - producto_val_upper: {producto_val_upper}")
    print(f"DEBUG: Keys de PRODUCTO_CHOICES: {list(dict(TodoItem.PRODUCTO_CHOICES).keys())}")

    # Verificar si el producto_val_upper es una clave válida en PRODUCTO_CHOICES
    if producto_val_upper not in dict(TodoItem.PRODUCTO_CHOICES):
        return redirect('dashboard')

    if is_supervisor(request.user):
        oportunidades = TodoItem.objects.filter(producto=producto_val_upper)
    else:
        oportunidades = TodoItem.objects.filter(producto=producto_val_upper, usuario=request.user)

    print(f"DEBUG: Oportunidades encontradas para {producto_val_upper} (antes de desglosar): {oportunidades.count()}")
    for op in oportunidades:
        print(f"DEBUG:   - ID: {op.id}, Oportunidad: {op.oportunidad}, Producto: {op.producto}, Usuario ID: {op.usuario.id}")

    # --- Ventas Cerradas (probabilidad 100%) para este producto ---
    ventas_cerradas = oportunidades.filter(probabilidad_cierre=100)
    total_vendido_cerrado = ventas_cerradas.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
    total_vendido_cerrado_count = ventas_cerradas.count() # Conteo de oportunidades cerradas
    print(f"DEBUG: Ventas Cerradas (100%) para '{producto_val_upper}': {total_vendido_cerrado_count} oportunidades, Monto: {total_vendido_cerrado}")
    for venta in ventas_cerradas:
        print(f"DEBUG:   - Oportunidad: {venta.oportunidad}, Monto: {venta.monto}, Probabilidad: {venta.probabilidad_cierre}%")

    # --- Oportunidades Vigentes (probabilidad del 1% al 99%) para este producto ---
    oportunidades_vigentes = oportunidades.filter(
        probabilidad_cierre__gt=0, # Mayor que 0%
        probabilidad_cierre__lt=100 # Menor que 100%
    )
    total_monto_vigente = oportunidades_vigentes.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
    total_monto_vigente_count = oportunidades_vigentes.count() # Conteo de oportunidades vigentes
    print(f"DEBUG: Oportunidades Vigentes (0% < prob < 100%) para '{producto_val_upper}': {total_monto_vigente_count} oportunidades, Monto: {total_monto_vigente}")
    for op_vigente in oportunidades_vigentes:
        print(f"DEBUG:   - Oportunidad: {op_vigente.oportunidad}, Monto: {op_vigente.monto}, Probabilidad: {op_vigente.probabilidad_cierre}%")

    # --- Oportunidades Perdidas (probabilidad 0%) para este producto ---
    oportunidades_perdidas = oportunidades.filter(probabilidad_cierre=0)
    total_monto_perdido = oportunidades_perdidas.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
    total_monto_perdido_count = oportunidades_perdidas.count() # Conteo de oportunidades perdidas
    print(f"DEBUG: Oportunidades Perdidas (0%) para '{producto_val_upper}': {total_monto_perdido_count} oportunidades, Monto: {total_monto_perdido}")
    for op_perdida in oportunidades_perdidas:
        print(f"DEBUG:   - Oportunidad: {op_perdida.oportunidad}, Monto: {op_perdida.monto}, Probabilidad: {op_perdida.probabilidad_cierre}%")


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
    return render(request, 'producto_dashboard_detail.html', context)


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
    return render(request, 'mes_dashboard_detail.html', context)


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
    return render(request, 'oportunidades_perdidas_detail.html', context)


# VISTA DEPRECADA - MANTENIDA POR REFERENCIA
@login_required
def generate_quote_pdf(request, pk):
    """
    DEPRECATED: Esta vista generaba PDF para TodoItem.
    Now it will use generate_cotizacion_pdf for the Cotizacion model.
    """
    # Ensure that only the owner or a supervisor can generate the quote
    if is_supervisor(request.user):
        opportunity = get_object_or_404(TodoItem, pk=pk)
    else:
        opportunity = get_object_or_404(TodoItem, pk=pk, usuario=request.user)

    # Context for the PDF template
    context = {
        'opportunity': opportunity,
        'request_user': request.user, # To show the user generating the quote
        'current_date': date.today(),
        # You can add more company data here if you have it in the model or settings
        'company_name': 'Tu Empresa de Ventas S.A. de C.V.',
        'company_address': 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México',
        'company_phone': '+52 55 1234 5678',
        'company_email': 'ventas@tuempresa.com',
    }

    # Render the HTML template to a string
    html_string = render_to_string('quote_pdf.html', context)

    # Create the PDF from the HTML string
    # You can add a base_url if you have external images or CSS that WeasyPrint needs to load
    # Example: HTML(string=html_string, base_url=request.build_absolute_uri('/'))
    pdf_file = HTML(string=html_string).write_pdf()

    # Create the HTTP response with the PDF
    response = HttpResponse(pdf_file, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="cotizacion_{opportunity.oportunidad}.pdf"'
    return response



# --- NEW/CORRECTED VIEWS ADDED ---

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
        items = TodoItem.objects.select_related('usuario', 'cliente').prefetch_related('cotizaciones__detalles').filter(usuario=request.user)

    # 2. Apply filters (supporting multiple values)
    oportunidad_filter = request.GET.get('filterOportunidad', '').strip()
    if oportunidad_filter:
        items = items.filter(oportunidad__icontains=oportunidad_filter)
        
    cliente_filter = request.GET.get('filterCliente', '').strip()
    if cliente_filter:
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
        
    # Debug: Print item count and sample data
    items_count = items.count()
    print(f"DEBUG: Total items found: {items_count}")
    
    if items_count > 0:
        # Show first item fields for debugging
        first_item = items.first()
        print(f"DEBUG: First item fields:")
        print(f"  - oportunidad: '{first_item.oportunidad}'")
        print(f"  - mes_cierre: '{first_item.mes_cierre}' (type: {type(first_item.mes_cierre)})")
        print(f"  - probabilidad_cierre: {first_item.probabilidad_cierre} (type: {type(first_item.probabilidad_cierre)})")
        print(f"  - monto: {first_item.monto}")
        print(f"  - area: '{first_item.area}'")
        print(f"  - producto: '{first_item.producto}'")
    else:
        print("DEBUG: No items found - check your filters!")
    
    # Write data rows (start at row 6 for Excel since we now have metadata headers)
    row = 6
    for item in items:
        print(f"DEBUG: Processing item: {item.oportunidad}")
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
        
        print(f"DEBUG: Raw mes_cierre: '{mes_cierre_valor}' (type: {type(mes_cierre_valor)})")
        print(f"DEBUG: Raw probabilidad_cierre: {probabilidad_valor} (type: {type(probabilidad_valor)})")
        
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
                print(f"DEBUG: mes_cierre '{mes_str}' mapped to int: {mes}")
                
                # Formatear la probabilidad
                if probabilidad_valor is not None:
                    probabilidad_str = f"{probabilidad_valor}%"
                else:
                    probabilidad_str = "0%"  # Default si no hay probabilidad
                
                # Asignar al mes correspondiente (mes-1 porque el array es 0-indexed)
                month_names = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEPT','OCT','NOV','DIC']
                months[mes - 1] = probabilidad_str
                print(f"DEBUG: Setting month {mes} ({month_names[mes-1]}) to {probabilidad_str}")
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
                        print(f"DEBUG: Setting month {mes} ({month_names[mes-1]}) to {probabilidad_str}")
                    else:
                        print(f"DEBUG: mes_cierre {mes} is out of range (1-12)")
                except (ValueError, TypeError):
                    print(f"DEBUG: Unable to convert mes_cierre '{mes_str}' - not a recognized month name or number")
        else:
            print(f"DEBUG: mes_cierre is None, empty or whitespace: '{mes_cierre_valor}'")
        
        print(f"DEBUG: Final months array: {months}")
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
def oportunidades_por_cliente_view(request, cliente_id):
    """
    View to display sales opportunities for a specific client.
    """
    cliente = get_object_or_404(Cliente, pk=cliente_id)

    if is_supervisor(request.user):
        oportunidades = TodoItem.objects.filter(cliente=cliente).order_by('-fecha_creacion')
    else:
        oportunidades = TodoItem.objects.filter(cliente=cliente, usuario=request.user).order_by('-fecha_creacion')

    context = {
        'cliente_id': cliente_id,
        'cliente_nombre': cliente.nombre_empresa, # Use nombre_empresa
        'oportunidades': oportunidades,
    }
    return render(request, 'oportunidades_por_cliente.html', context)


from django.views.decorators.clickjacking import xframe_options_exempt

@xframe_options_exempt
@login_required
def bitrix_widget_launcher(request):
    return render(request, 'bitrix_widget_launcher.html')

from django.http import HttpResponseRedirect
from django.urls import reverse
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def bitrix_cotizador_redirect(request):
    """
    Renderiza una plantilla con JavaScript para redirigir al cotizador en una nueva pestaña.
    """
    cotizador_url = "https://nethive.mx/app/crear-cotizacion/"
    print(f"DEBUG: Renderizando plantilla de redirección para: {cotizador_url}", flush=True)
    return render(request, 'bitrix_redirect_cotizador.html', {'cotizador_url': cotizador_url})


@login_required
@csrf_exempt
def crear_cotizacion_view(request, cliente_id=None, oportunidad_id=None):
    cliente_seleccionado = None
    oportunidad_seleccionada = None
    
    # Detectar si viene de la detección automática de oportunidades (Crown Jewel Feature)
    is_auto_filled = request.GET.get('auto_filled') == 'true'
    auto_fill_data = {}
    
    if is_auto_filled:
        # Obtener datos de auto-llenado desde los parámetros GET
        auto_fill_data = {
            'titulo': request.GET.get('titulo', ''),
            'monto_estimado': request.GET.get('monto_estimado', ''),
            'oportunidad_id': request.GET.get('oportunidad_id', ''),
            'cliente_id': request.GET.get('cliente_id', '')
        }
        print(f"DEBUG: Auto-fill detectado desde notificación de oportunidad: {auto_fill_data}")
        
        # Si viene de auto-fill, usar los IDs de los parámetros
        if not oportunidad_id and auto_fill_data['oportunidad_id']:
            oportunidad_id = auto_fill_data['oportunidad_id']
        if not cliente_id and auto_fill_data['cliente_id']:
            cliente_id = auto_fill_data['cliente_id']

    print(f"DEBUG: crear_cotizacion_view - Request method: {request.method}")
    print(f"DEBUG: crear_cotizacion_view - GET parameters: {dict(request.GET)}")
    print(f"DEBUG: crear_cotizacion_view - oportunidad_id inicial: {oportunidad_id}")
    
    # Si no viene oportunidad_id como parámetro de URL, verificar en GET parameters
    if not oportunidad_id and request.GET.get('oportunidad_id'):
        oportunidad_id = request.GET.get('oportunidad_id')
        print(f"DEBUG: crear_cotizacion_view - oportunidad_id obtenido de GET params: {oportunidad_id}")
    
    if oportunidad_id:
        try:
            oportunidad_seleccionada = TodoItem.objects.get(id=oportunidad_id)
            # Si se selecciona una oportunidad, el cliente de la oportunidad es el cliente de la cotización
            if oportunidad_seleccionada.cliente:
                cliente_seleccionado = oportunidad_seleccionada.cliente
                cliente_id = str(oportunidad_seleccionada.cliente.id) # Asegurarse de que cliente_id se actualice
        except TodoItem.DoesNotExist:
            messages.error(request, f"La oportunidad con ID {oportunidad_id} no fue encontrada.")
            oportunidad_id = None # Reset para evitar errores posteriores

    # Si cliente_id fue pasado directamente (no a través de oportunidad_id) y no hay cliente_seleccionado aún
    if cliente_id and not cliente_seleccionado:
        try:
            # CORRECTO: La URL pasa el ID de Django, no el bitrix_company_id
            cliente_seleccionado = Cliente.objects.get(id=cliente_id)
            print(f"DEBUG: crear_cotizacion_view - Cliente encontrado por ID Django: {cliente_seleccionado.nombre_empresa}")
        except Cliente.DoesNotExist:
            print(f"DEBUG: crear_cotizacion_view - Cliente con ID Django {cliente_id} no encontrado")
            messages.error(request, f"El cliente con ID {cliente_id} no fue encontrado.")
            return redirect('crear_cotizacion')

    if cliente_seleccionado:
        print(f"DEBUG: crear_cotizacion_view - Cliente seleccionado: {cliente_seleccionado.nombre_empresa}")
    else:
        print("DEBUG: crear_cotizacion_view - No hay cliente seleccionado.")

    if request.method == 'POST':
        try:
            print(f"DEBUG: Procesando POST request para crear cotización")
            print(f"DEBUG: Usuario: {request.user}")
            print(f"DEBUG: POST data keys: {list(request.POST.keys())}")
            
            # Instantiate the form with POST data, and provide the user-specific queryset for the cliente field
            form = CotizacionForm(request.POST, user=request.user)
            print(f"DEBUG: Formulario creado exitosamente")
        except Exception as e:
            print(f"ERROR: Error general en POST request: {e}")
            import traceback
            traceback.print_exc()
            return JsonResponse({'success': False, 'errors': {'__all__': [{'message': f'Error al procesar solicitud: {str(e)}'}]}}, status=500)

        if form.is_valid():
            print(f"DEBUG: Formulario es válido")
            cotizacion = form.save(commit=False)
            cotizacion.created_by = request.user  # Asignar el usuario creador
            cotizacion.save()
            print(f"DEBUG: Quote saved with ID: {cotizacion.id}")

            # Obtener la oportunidad seleccionada del formulario
            oportunidad_seleccionada_form = form.cleaned_data.get('oportunidad')
            bitrix_deal_id_to_upload = None
            if oportunidad_seleccionada_form and oportunidad_seleccionada_form.bitrix_deal_id:
                bitrix_deal_id_to_upload = oportunidad_seleccionada_form.bitrix_deal_id

            # Collect product data sent from JavaScript
            productos_data = {}
            for key, value in request.POST.items():
                if key.startswith('productos['):
                    parts = key.split('[')
                    index = parts[1].split(']')[0]
                    field = parts[2].split(']')[0]

                    if index not in productos_data:
                        productos_data[index] = {}
                    productos_data[index][field] = value

            # También recopilar títulos para crear orden combinado
            titulos_data = {}
            for key, value in request.POST.items():
                if key.startswith('titulos['):
                    parts = key.split('[')
                    index = parts[1].split(']')[0]
                    field = parts[2].split(']')[0]
                    if index not in titulos_data:
                        titulos_data[index] = {}
                    titulos_data[index][field] = value
            
            # Para nuevas cotizaciones: crear lista combinada en orden del DOM
            # PROBLEMA: títulos y productos tienen sistemas de posición diferentes
            # SOLUCIÓN: usar un mapa de posición unificado
            elementos_combinados = []
            
            # Crear lista de todos los elementos con sus posiciones
            elementos_con_posicion = []
            
            # SOLUCIÓN SIMPLE: Intercalar títulos y productos según aparecen en el DOM
            # Los títulos ya tienen sus posiciones DOM reales, los productos deben ir donde corresponden
            
            # Obtener títulos con sus posiciones
            titulos_con_posicion = []
            for titulo_data in titulos_data.values():
                if titulo_data.get('type') == 'title' and titulo_data.get('texto'):
                    pos = int(titulo_data.get('position', 999))
                    titulos_con_posicion.append((pos, titulo_data))
            titulos_con_posicion.sort()  # Ordenar por posición
            
            # Productos en orden
            productos_lista = [(int(k), v) for k, v in productos_data.items()]
            productos_lista.sort()
            
            print(f"DEBUG INTERCALAR: {len(titulos_con_posicion)} títulos, {len(productos_lista)} productos")
            for pos, titulo in titulos_con_posicion:
                print(f"DEBUG INTERCALAR: Título '{titulo.get('texto')}' en posición DOM {pos}")
            
            # Nueva lógica: crear lista completa con títulos y productos en sus posiciones reales
            elementos_temporales = []
            
            # Agregar títulos con sus posiciones reales
            for pos_titulo, titulo_data in titulos_con_posicion:
                elementos_temporales.append({
                    'tipo': 'titulo',
                    'posicion_dom': pos_titulo,
                    'datos': titulo_data,
                    'nombre': titulo_data.get('texto', 'SIN_TITULO')
                })
                print(f"DEBUG INTERCALAR: Título '{titulo_data.get('texto')}' en posición DOM {pos_titulo}")
            
            # Agregar productos con posiciones secuenciales donde NO hay títulos
            producto_index = 0
            
            # Obtener todas las posiciones ocupadas por títulos
            posiciones_titulos = set(pos for pos, _ in titulos_con_posicion)
            
            # Recorrer todas las posiciones posibles y llenar con productos donde no hay títulos
            max_posicion = max(len(productos_lista) + len(titulos_con_posicion), max(posiciones_titulos, default=0) + 1)
            for pos in range(max_posicion):
                if pos not in posiciones_titulos and producto_index < len(productos_lista):
                    _, producto_data = productos_lista[producto_index]
                    elementos_temporales.append({
                        'tipo': 'producto',
                        'posicion_dom': pos,
                        'datos': producto_data,
                        'nombre': producto_data.get('nombre_producto', 'SIN_NOMBRE')
                    })
                    print(f"DEBUG INTERCALAR: Producto '{producto_data.get('nombre_producto')}' en posición DOM {pos}")
                    producto_index += 1
            
            # Ordenar por posición DOM y asignar posiciones finales secuenciales
            elementos_temporales.sort(key=lambda x: x['posicion_dom'])
            
            posicion_final = 0
            for elemento in elementos_temporales:
                elemento['posicion'] = posicion_final
                elementos_con_posicion.append({
                    'tipo': elemento['tipo'],
                    'posicion': posicion_final,
                    'datos': elemento['datos'],
                    'nombre': elemento['nombre']
                })
                print(f"DEBUG INTERCALAR: Agregado {elemento['tipo']} '{elemento['nombre']}' en posición final {posicion_final}")
                posicion_final += 1
            
            # Assign a new, sequential 'orden' value based on the sorted list
            # This loop modifies the dictionaries in elementos_con_posicion in place
            for i, elemento in enumerate(elementos_con_posicion):
                elemento['posicion_final'] = i 

            print(f"DEBUG POSITION: Total elementos encontrados: {len(elementos_con_posicion)}")
            print(f"DEBUG POSITION: Elementos ordenados y con posicion_final:")
            for i, elem in enumerate(elementos_con_posicion):
                print(f"  {i+1}. {elem['tipo'].upper()}: '{elem['nombre']}' (posición: {elem['posicion']}), posicion_final: {elem['posicion_final']}")
            
            # Crear lista final (now just copy the modified dictionaries)
            elementos_combinados = elementos_con_posicion # No need to create new dictionaries, just use the modified ones
            
            print(f"DEBUG ORDER: Elementos en orden: {len(elementos_combinados)} elementos")
            for i, elemento in enumerate(elementos_combinados):
                if elemento['tipo'] == 'titulo':
                    print(f"DEBUG ORDER: {i+1}. TÍTULO: '{elemento['datos'].get('texto', 'SIN_TEXTO')}' (posición: {elemento['posicion']}), posicion_final: {elemento['posicion_final']}")
                else:
                    print(f"DEBUG ORDER: {i+1}. PRODUCTO: '{elemento['datos'].get('nombre_producto', 'SIN_NOMBRE')}' (posición: {elemento['posicion']}), posicion_final: {elemento['posicion_final']}")
            
            # Mantener productos_list para compatibilidad con el cálculo de totales
            productos_list = [productos_data[key] for key in sorted(productos_data.keys(), key=int)]
            print(f"DEBUG: productos_list before saving details: {productos_list}")

            calculated_subtotal = Decimal('0.00')
            for item_data in productos_list:
                try:
                    cantidad = int(item_data.get('cantidad', 0))
                    
                    # Manejo seguro del precio
                    precio_str = str(item_data.get('precio', '0.00')).strip()
                    if not precio_str or precio_str == '':
                        precio_str = '0.00'
                    precio = Decimal(precio_str)
                    
                    # Manejo seguro del descuento
                    descuento_str = str(item_data.get('descuento', '0.00')).strip()
                    if not descuento_str or descuento_str == '':
                        descuento_str = '0.00'
                    descuento = Decimal(descuento_str)
                    
                    item_total = cantidad * precio
                    item_total -= item_total * (descuento / Decimal('100.00'))
                    calculated_subtotal += item_total.quantize(Decimal('0.01'))
                    print(f"DEBUG_CALC: Item: {item_data.get('nombre')}, Quantity: {cantidad}, Price: {precio}, Discount: {descuento}, Item Total (rounded): {item_total.quantize(Decimal('0.01'))}")
                except (ValueError, TypeError, decimal.InvalidOperation) as e:
                    print(f"DEBUG_ERROR: Error processing item {item_data}: {e}")
                    cotizacion.delete()
                    return JsonResponse({'success': False, 'errors': {'__all__': [{'message': f'Invalid product data in row. Error: {e}'}]}}, status=400)

            cotizacion.subtotal = calculated_subtotal.quantize(Decimal('0.01'))
            
            try:
                iva_rate_str = str(request.POST.get('iva_rate', '0.00')).strip()
                if not iva_rate_str or iva_rate_str == '':
                    iva_rate_str = '0.00'
                cotizacion.iva_rate = Decimal(iva_rate_str)
            except (ValueError, TypeError, decimal.InvalidOperation):
                cotizacion.iva_rate = Decimal('0.00')

            cotizacion.iva_amount = (cotizacion.subtotal * cotizacion.iva_rate).quantize(Decimal('0.01'))
            cotizacion.total = (cotizacion.subtotal + cotizacion.iva_amount).quantize(Decimal('0.01'))

            descuento_visible_str = request.POST.get('descuento_visible', 'true')
            cotizacion.descuento_visible = descuento_visible_str.lower() == 'true'
            cotizacion.tipo_cotizacion = request.POST.get('tipo_cotizacion')
            
            cotizacion.save(update_fields=['subtotal', 'iva_rate', 'iva_amount', 'total', 'descuento_visible', 'tipo_cotizacion', 'oportunidad'])
            print(f"DEBUG: Quote totals updated. Subtotal: {cotizacion.subtotal}, IVA: {cotizacion.iva_amount}, Total: {cotizacion.total}, Quote Type: {cotizacion.tipo_cotizacion}")
            
            # Guardar elementos en orden correcto (títulos Y productos)
            for elemento in elementos_combinados:
                if elemento['tipo'] == 'titulo':
                    titulo_data = elemento['datos']
                    try:
                        if titulo_data.get('type') == 'title' and titulo_data.get('texto'):
                            DetalleCotizacion.objects.create(
                                cotizacion=cotizacion,
                                nombre_producto=titulo_data.get('texto', ''),
                                descripcion=titulo_data.get('texto', ''),
                                cantidad=0,
                                precio_unitario=Decimal('0.00'),
                                descuento_porcentaje=Decimal('0.00'),
                                marca='',
                                no_parte='',
                                tipo='titulo',
                                orden=elemento['posicion_final']
                            )
                            print(f"DEBUG ORDER: Title created: {titulo_data.get('texto')} with orden {elemento['posicion_final']}")
                    except Exception as e:
                        print(f"WARNING: Error creating title {titulo_data}: {e}")
                        
                else:  # producto
                    item_data = elemento['datos']
                    try:
                        # Manejo seguro del precio unitario
                        precio_str = str(item_data.get('precio', '0.00')).strip()
                        if not precio_str or precio_str == '':
                            precio_str = '0.00'
                        precio_unitario = Decimal(precio_str)
                        
                        # Manejo seguro del descuento
                        descuento_str = str(item_data.get('descuento', '0.00')).strip()
                        if not descuento_str or descuento_str == '':
                            descuento_str = '0.00'
                        descuento_porcentaje = Decimal(descuento_str)
                        
                        DetalleCotizacion.objects.create(
                            cotizacion=cotizacion,
                            nombre_producto=item_data.get('nombre_producto', ''),
                            descripcion=item_data.get('descripcion', ''),
                            cantidad=int(item_data.get('cantidad', 1)),
                            precio_unitario=precio_unitario,
                            descuento_porcentaje=descuento_porcentaje,
                            marca=item_data.get('marca', ''),
                            no_parte=item_data.get('no_parte', ''),
                            tipo='producto',
                            orden=elemento['posicion_final']
                        )
                        print(f"DEBUG ORDER: Product created: {item_data.get('nombre_producto')} with orden {elemento['posicion_final']}")
                    except (ValueError, TypeError, decimal.InvalidOperation) as e:
                        cotizacion.delete()
                        return JsonResponse({'success': False, 'errors': {'__all__': [{'message': f'Invalid product data in row. Error: {e}'}]}}, status=400)

            # Los títulos ya se procesaron en orden combinado arriba
            print(f"DEBUG: Todos los elementos (productos y títulos) fueron guardados en orden correcto")
            
            from django.urls import reverse
            pdf_url = reverse('generate_cotizacion_pdf', args=[cotizacion.id])
            print(f"DEBUG: PDF URL generated: {pdf_url}")

            try:
                # Organizar productos en secciones para el PDF (excluir títulos de Bitrix24)
                detalles_todos = cotizacion.detalles.all().order_by('id')
                secciones_pdf = []
                seccion_actual_pdf = {'titulo': None, 'productos': []}
                
                for detalle in detalles_todos:
                    tipo_detalle = getattr(detalle, 'tipo', 'producto') or 'producto'
                    
                    if tipo_detalle == 'titulo':
                        # Si hay productos en la sección actual, guardarla ANTES de crear nueva sección
                        if seccion_actual_pdf['productos']:
                            secciones_pdf.append(seccion_actual_pdf)
                        # Si hay una sección actual con título pero sin productos, también la guardamos
                        elif seccion_actual_pdf['titulo']:
                            secciones_pdf.append(seccion_actual_pdf)
                        # Iniciar nueva sección
                        seccion_actual_pdf = {'titulo': detalle.nombre_producto, 'productos': []}
                    else:
                        # Agregar producto a la sección actual
                        seccion_actual_pdf['productos'].append(detalle)
                
                # Agregar la última sección (con o sin productos)
                if seccion_actual_pdf['titulo'] or seccion_actual_pdf['productos']:
                    secciones_pdf.append(seccion_actual_pdf)
                
                # Si no hay títulos, crear una sección por defecto con productos solamente
                if not secciones_pdf:
                    productos_sin_seccion = [d for d in detalles_todos if getattr(d, 'tipo', 'producto') == 'producto']
                    if productos_sin_seccion:
                        secciones_pdf.append({'titulo': None, 'productos': productos_sin_seccion})
                
                # DEBUG: Mostrar las secciones generadas
                print(f"DEBUG CREATE PDF: Secciones para Bitrix24: {len(secciones_pdf)} secciones encontradas")
                for i, seccion in enumerate(secciones_pdf):
                    print(f"DEBUG CREATE PDF: Sección {i+1}: titulo='{seccion['titulo']}', productos={len(seccion['productos'])}")
                    for j, producto in enumerate(seccion['productos']):
                        print(f"  Producto {j+1}: {producto.nombre_producto} (tipo: {getattr(producto, 'tipo', 'NO_DEFINIDO')})")

                # Determinar el template y configuración según el tipo de cotización
                tipo_cotizacion = cotizacion.tipo_cotizacion
                template_name = 'cotizacion_pdf_template.html'  # Default (Bajanet)
                company_name = 'BAJANET S.A. de C.V.'
                company_address = 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México'
                company_phone = '+52 55 1234 5678'
                company_email = 'ventas@bajanet.com'
                
                if tipo_cotizacion and tipo_cotizacion.lower() == 'iamet':
                    template_name = 'iamet_cotizacion_pdf_template.html'
                    company_name = 'IAMET S.A. de C.V.'
                    company_address = 'Av. Principal #456, Col. Centro, Guadalajara, Jalisco'
                    company_phone = '+52 33 9876 5432'
                    company_email = 'contacto@iamet.com'

                html_string = render_to_string(template_name, {
                    'cotizacion': cotizacion,
                    'detalles_cotizacion': cotizacion.detalles.all(),  # Para compatibilidad con fallback
                    'secciones': secciones_pdf,  # Para mostrar por secciones sin títulos como productos
                    'request_user': request.user,
                    'current_date': date.today(),
                    'company_name': company_name,
                    'company_address': company_address,
                    'company_phone': company_phone,
                    'company_email': company_email,
                    'logo_base64': '',
                    'iva_rate_percentage': (cotizacion.iva_rate * Decimal('100')).quantize(Decimal('1')),
                })
                pdf_file_content = HTML(string=html_string).write_pdf()
                pdf_base64 = base64.b64encode(pdf_file_content).decode('utf-8')

                if bitrix_deal_id_to_upload:
                    file_name_for_bitrix = f"{cotizacion.nombre_cotizacion or cotizacion.titulo}.pdf"
                    comment_text = f"Se ha creado una nueva cotización: {file_name_for_bitrix}"
                    from .bitrix_integration import add_comment_with_attachment_to_deal
                    upload_success = add_comment_with_attachment_to_deal(
                        bitrix_deal_id_to_upload, file_name_for_bitrix, pdf_base64, comment_text, request=request
                    )
                    if upload_success:
                        messages.success(request, "Cotización generada y PDF adjuntado como comentario en Bitrix24.")
                    else:
                        messages.warning(request, "Cotización generada, pero hubo un error al adjuntar el PDF en Bitrix24.")
                else:
                    messages.info("Cotización generada, pero no se pudo adjuntar a Bitrix24 (no hay ID de negociación).")

            except Exception as e:
                print(f"ERROR al generar o subir PDF a Bitrix24: {e}")
                messages.error(request, f"Error al generar o subir PDF a Bitrix24: {e}")
                return JsonResponse({'success': False, 'errors': {'__all__': [{'message': f'Error al generar o subir PDF a Bitrix24: {str(e)}'}]}}, status=500)
            
            # Si hay una oportunidad seleccionada, redirigir a página de descarga y luego a cotizaciones por oportunidad
            # sino, al PDF directo como antes
            oportunidad_para_redirect = form.cleaned_data.get('oportunidad')
            if oportunidad_para_redirect:
                # Crear URL que descarga PDF y luego redirige a cotizaciones por oportunidad
                from django.urls import reverse
                redirect_url = reverse('download_and_redirect_cotizacion', 
                                     args=[cotizacion.id, oportunidad_para_redirect.id])
                return redirect(redirect_url)
            else:
                # Flujo original para cotizaciones sin oportunidad
                return redirect('generate_cotizacion_pdf', cotizacion_id=cotizacion.id)

        else:
            errors_dict = {}
            for field, field_errors in form.errors.items():
                errors_dict[field] = [{'message': str(e), 'code': e.code if hasattr(e, 'code') else 'invalid'} for e in field_errors]
            
            # Enhanced debugging information
            print(f"DEBUG: Form validation failed for crear_cotizacion_view")
            print(f"DEBUG: Form errors: {errors_dict}")
            print(f"DEBUG: Form data received: {dict(request.POST.items())}")
            print(f"DEBUG: Form cleaned_data (if available): {getattr(form, 'cleaned_data', 'N/A')}")
            print(f"DEBUG: Form non_field_errors: {form.non_field_errors()}")
            print(f"DEBUG: User: {request.user.username if request.user.is_authenticated else 'Anonymous'}")
            print(f"DEBUG: Request method: {request.method}")
            print(f"DEBUG: Content type: {request.content_type}")
            
            return JsonResponse({'success': False, 'errors': errors_dict}, status=400)

    else: # If the request is GET
        initial_data = {}
        if oportunidad_seleccionada:
            initial_data['titulo'] = oportunidad_seleccionada.oportunidad
            initial_data['cliente'] = oportunidad_seleccionada.cliente.id if oportunidad_seleccionada.cliente else None
            initial_data['oportunidad'] = oportunidad_seleccionada.id
            
        # Si viene de auto-fill (Crown Jewel Feature), usar ese título preferentemente
        if is_auto_filled and auto_fill_data.get('titulo'):
            initial_data['titulo'] = f"Cotización - {auto_fill_data['titulo']}"
            print(f"DEBUG: Título auto-llenado: {initial_data['titulo']}")

        form = CotizacionForm(initial=initial_data, user=request.user)
        from django.urls import reverse
        form_action_url = reverse('crear_cotizacion_with_id', args=[cliente_id]) if cliente_id else reverse('crear_cotizacion')
        print(f"DEBUG: crear_cotizacion_view - Generated form_action_url: {form_action_url}")

        # Todos los usuarios pueden ver todos los clientes para la creación de cotizaciones
        clientes_django = Cliente.objects.all().order_by('nombre_empresa')

        print(f"DEBUG: crear_cotizacion_view - Clientes obtenidos de Django: {len(clientes_django)}")

        clientes_data_json = []
        for c in clientes_django:
            clientes_data_json.append({
                'id': str(c.id),
                'name': c.nombre_empresa,
            })
        print(f"DEBUG: crear_cotizacion_view - Clientes serializados para JSON: {clientes_data_json}")

        context = {
            'form': form,
            'cliente_seleccionado': cliente_seleccionado,
            'clientes_data_json': json.dumps(clientes_data_json),
            'cliente_id_inicial': cliente_id,
            'oportunidad_id_inicial': oportunidad_id,
            'form_action_url': form_action_url,
            'producto_choices': TodoItem.PRODUCTO_CHOICES,
            'area_choices': TodoItem.AREA_CHOICES,
            'probabilidad_choices_list': [i for i in range(0, 101, 10)],
            # Crown Jewel Feature: Auto-fill data from opportunity detection
            'is_auto_filled': is_auto_filled,
            'auto_fill_data': auto_fill_data,
            'oportunidad_seleccionada': oportunidad_seleccionada,
        }
        return render(request, 'crear_cotizacion.html', context)


@login_required
def editar_cotizacion_view(request, cotizacion_id):
    cotizacion_original = get_object_or_404(Cotizacion, pk=cotizacion_id)
    detalles_originales = DetalleCotizacion.objects.filter(cotizacion=cotizacion_original).order_by('id')

    # Formatear detalles para el JavaScript del template
    detalles_list = [{
        'nombre_producto': d.nombre_producto,
        'marca': d.marca,
        'no_parte': d.no_parte,
        'descripcion': d.descripcion,
        'cantidad': d.cantidad,
        'precio': str(d.precio_unitario),
        'descuento': str(d.descuento_porcentaje),
        'tipo': getattr(d, 'tipo', 'producto') or 'producto',  # Incluir el tipo (producto o titulo)
    } for d in detalles_originales]

    # Obtener todos los clientes para el dropdown
    if is_supervisor(request.user):
        clientes_django = Cliente.objects.all().order_by('nombre_empresa')
    else:
        clientes_django = Cliente.objects.filter(Q(asignado_a=request.user) | Q(asignado_a__isnull=True)).order_by('nombre_empresa')

    clientes_data_json = []
    for c in clientes_django:
        clientes_data_json.append({
            'id': str(c.id),
            'name': c.nombre_empresa,
        })

    # Obtener oportunidades del cliente para el dropdown
    oportunidades_data_json = []
    if cotizacion_original.cliente:
        if is_supervisor(request.user):
            oportunidades = TodoItem.objects.filter(cliente=cotizacion_original.cliente).order_by('-fecha_creacion')
        else:
            oportunidades = TodoItem.objects.filter(cliente=cotizacion_original.cliente, usuario=request.user).order_by('-fecha_creacion')
        
        for o in oportunidades:
            oportunidades_data_json.append({
                'id': str(o.id),
                'title': o.oportunidad,
                'monto': str(o.monto),
            })

    # URL del formulario apunta siempre a crear_cotizacion estándar para reutilizar la lógica
    from django.urls import reverse
    form_action_url = reverse('crear_cotizacion')

    # Datos iniciales para el formulario
    initial_data = {
        'titulo': cotizacion_original.titulo,
        'cliente': cotizacion_original.cliente.id,
        'oportunidad': cotizacion_original.oportunidad.id if cotizacion_original.oportunidad else None,
        'descripcion': cotizacion_original.descripcion,
        'comentarios': cotizacion_original.comentarios,
        'nombre_cotizacion': cotizacion_original.nombre_cotizacion,
        'iva_rate': cotizacion_original.iva_rate,
        'moneda': cotizacion_original.moneda,
        'tipo_cotizacion': cotizacion_original.tipo_cotizacion,
        'descuento_visible': cotizacion_original.descuento_visible,
    }

    context = {
        'form': CotizacionForm(initial=initial_data, user=request.user),
        'cliente_seleccionado': cotizacion_original.cliente,
        'clientes_data_json': json.dumps(clientes_data_json),
        'oportunidades_data_json': json.dumps(oportunidades_data_json),
        'cliente_id_inicial': cotizacion_original.cliente.id,
        'oportunidad_id_inicial': cotizacion_original.oportunidad.id if cotizacion_original.oportunidad else None,
        'detalles_cotizacion': json.dumps(detalles_list),  # Convertir a JSON para el template
        'form_action_url': form_action_url,
        'editing_mode': True,  # Indicador para el template
        'cotizacion_original': cotizacion_original,  # Datos de la cotización original
        'probabilidad_choices_list': [i for i in range(0, 101, 10)],
    }

    return render(request, 'crear_cotizacion.html', context)



@login_required
def download_and_redirect_cotizacion(request, cotizacion_id, oportunidad_id):
    """
    Vista que muestra una página que descarga el PDF automáticamente y luego redirige 
    a la página de cotizaciones por oportunidad.
    """
    print(f"DEBUG: download_and_redirect_cotizacion - cotizacion_id: {cotizacion_id}, oportunidad_id: {oportunidad_id}")
    
    # Verificar que la cotización existe y el usuario tiene permisos
    cotizacion = get_object_or_404(Cotizacion, pk=cotizacion_id)
    if not is_supervisor(request.user) and cotizacion.created_by != request.user:
        messages.error(request, "No tienes permisos para descargar esta cotización.")
        return redirect('cotizaciones')
    
    # Verificar que la oportunidad existe
    oportunidad = get_object_or_404(TodoItem, pk=oportunidad_id)
    if not is_supervisor(request.user) and oportunidad.usuario != request.user:
        messages.error(request, "No tienes permisos para acceder a esta oportunidad.")
        return redirect('todos')
    
    # URLs necesarias para la página de descarga y redirección
    pdf_download_url = reverse('generate_cotizacion_pdf', args=[cotizacion_id])
    redirect_url = reverse('cotizaciones_por_oportunidad', args=[oportunidad_id])
    
    context = {
        'cotizacion': cotizacion,
        'oportunidad': oportunidad,
        'pdf_download_url': pdf_download_url,
        'redirect_url': redirect_url
    }
    
    return render(request, 'download_and_redirect.html', context)

def generate_cotizacion_pdf(request, cotizacion_id):
    """
    View to generate the PDF of a specific quote.
    """
    print(f"DEBUG: Starting generate_cotizacion_pdf for quote ID: {cotizacion_id}")
    cotizacion = get_object_or_404(Cotizacion, pk=cotizacion_id)
    print(f"DEBUG: Quote found: {cotizacion.id} - Quote Type: {cotizacion.tipo_cotizacion}")
    
    # Ensure that the user has permission to view this quote
    if not is_supervisor(request.user) and cotizacion.created_by != request.user:
        print(f"DEBUG: Access denied for user {request.user.username} to quote {cotizacion.id}")
        return HttpResponse("Acceso denegado.", status=403)

    detalles_cotizacion = DetalleCotizacion.objects.filter(cotizacion=cotizacion).order_by('orden')
    iva_rate_percentage = (cotizacion.iva_rate * Decimal('100')).quantize(Decimal('1'))
    
    # DEBUG: Mostrar todos los detalles antes de procesar
    print(f"DEBUG: Total detalles encontrados: {len(detalles_cotizacion)}")
    for detalle in detalles_cotizacion:
        tipo_actual = getattr(detalle, 'tipo', 'NO_DEFINIDO')
        print(f"DEBUG: Detalle ID={detalle.id}, nombre='{detalle.nombre_producto}', tipo='{tipo_actual}'")
    
    # Organizar productos en secciones basadas en títulos
    secciones = []
    seccion_actual = None

    for detalle in detalles_cotizacion:
        tipo_detalle = getattr(detalle, 'tipo', 'producto') or 'producto'

        if tipo_detalle == 'titulo':
            if seccion_actual:
                secciones.append(seccion_actual)
            seccion_actual = {'titulo': detalle.nombre_producto, 'productos': []}
        else:  # Es un producto
            if not seccion_actual:
                # Si hay productos antes del primer título, se agrupan en una sección sin título.
                seccion_actual = {'titulo': None, 'productos': []}
            seccion_actual['productos'].append(detalle)

    # Agregar la última sección si existe
    if seccion_actual:
        secciones.append(seccion_actual)

    # Si después de todo no hay secciones pero sí detalles, se crea una sección por defecto.
    if not secciones and detalles_cotizacion:
        secciones.append({'titulo': None, 'productos': [d for d in detalles_cotizacion if getattr(d, 'tipo', 'producto') == 'producto']})
    
    print(f"DEBUG: ===== RESUMEN FINAL =====")
    print(f"DEBUG: Secciones organizadas: {len(secciones)} secciones encontradas")
    for i, seccion in enumerate(secciones):
        print(f"DEBUG: 📋 Sección {i+1}: titulo='{seccion['titulo']}', productos={len(seccion['productos'])}")
        for j, producto in enumerate(seccion['productos']):
            print(f"     📦 Producto {j+1}: {producto.nombre_producto} (tipo: {getattr(producto, 'tipo', 'NO_DEFINIDO')})")
    print(f"DEBUG: =========================")

    pdf_name_raw = cotizacion.nombre_cotizacion or f"Cotizacion_{cotizacion.id}"
    pdf_name = "".join(c for c in pdf_name_raw if c.isalnum() or c in ('_', '-')).strip().replace(' ', '_')
    if not pdf_name:
        pdf_name = f"Cotizacion_{cotizacion.id}"

    tipo_cotizacion = cotizacion.tipo_cotizacion
    logo_base64 = ""
    company_name = ""
    company_address = ""
    company_phone = ""
    company_email = ""
    template_name = 'cotizacion_pdf_template.html' # Default template

    if tipo_cotizacion and tipo_cotizacion.lower() == 'iamet':
        template_name = 'iamet_cotizacion_pdf_template.html'
        company_name = 'IAMET S.A. de C.V.'
        company_address = 'Av. Principal #456, Col. Centro, Guadalajara, Jalisco'
        company_phone = '+52 33 9876 5432'
        company_email = 'contacto@iamet.com'
    elif tipo_cotizacion and tipo_cotizacion.lower() == 'bajanet':
        template_name = 'cotizacion_pdf_template.html'
        company_name = 'BAJANET S.A. de C.V.'
        company_address = 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México'
        company_phone = '+52 55 1234 5678'
        company_email = 'ventas@bajanet.com'
        try:
            logo_url = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRV1xCutWCicl-yXCjMjH5P5jTZA0R993cG9g&s"
            response = requests.get(logo_url)
            response.raise_for_status() # Raise an exception for HTTP errors
            logo_base64 = base64.b64encode(response.content).decode('utf-8')
        except requests.exceptions.RequestException as e:
            print(f"ERROR: Error fetching Bajanet logo from URL: {e}")
            logo_base64 = "" # Fallback to empty string if fetching fails
    else: # Fallback to Bajanet if type is not recognized or None
        template_name = 'cotizacion_pdf_template.html'
        company_name = 'BAJANET S.A. de C.V.'
        company_address = 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México'
        company_phone = '+52 55 1234 5678'
        company_email = 'ventas@bajanet.com'
        try:
            logo_url = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRV1xCutWCicl-yXCjMjH5P5jTZA0R993cG9g&s"
            response = requests.get(logo_url)
            response.raise_for_status() # Raise an exception for HTTP errors
            logo_base64 = base64.b64encode(response.content).decode('utf-8')
        except requests.exceptions.RequestException as e:
            print(f"ERROR: Error fetching Bajanet logo from URL: {e}")
            logo_base64 = "" # Fallback to empty string if fetching fails


    context = {
        'cotizacion': cotizacion,
        'detalles_cotizacion': detalles_cotizacion,
        'secciones': secciones,
        'request_user': request.user,
        'current_date': date.today(),
        'company_name': company_name,
        'company_address': company_address,
        'company_phone': company_phone,
        'company_email': company_email,
        'logo_base64': logo_base64,
        'iva_rate_percentage': iva_rate_percentage,
    }

    try:
        print(f"DEBUG: Attempting to render template: {template_name}")
        html_string = render_to_string(template_name, context)
        print("DEBUG: Template rendered to HTML string.")
    except Exception as e:
        print(f"ERROR: Error rendering template '{template_name}': {e}")
        return HttpResponse(f"Internal server error rendering PDF: {e}", status=500)

    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{pdf_name}.pdf"'

    try:
        print("DEBUG: Attempting to generate PDF with WeasyPrint.")
        HTML(string=html_string).write_pdf(response)
        print("DEBUG: PDF generated successfully.")
    except Exception as e:
        print(f"ERROR: Error generating PDF with WeasyPrint: {e}")
        return HttpResponse(f"Internal server error generating PDF: {e}", status=500)
        
    return response


from django.contrib.auth.models import User
from django.contrib.auth.decorators import user_passes_test

def supervisor_required(view_func):
    decorated_view_func = login_required(user_passes_test(is_supervisor)(view_func))
    return decorated_view_func


@login_required
def usuario_redirect_view(request):
    """
    Muestra la página de configuración avanzada y maneja el envío del formulario de avatar.
    """
    if request.method == 'POST':
        # Obtener o crear el perfil del usuario
        profile, created = UserProfile.objects.get_or_create(user=request.user)
        
        # Manejar la subida de imagen
        if 'avatar' in request.FILES and request.FILES['avatar']:
            profile.avatar = request.FILES['avatar']
            profile.usar_animado = False
            profile.avatar_tipo = '1'  # Reset a humano por defecto
        # Si se está seleccionando un avatar animado
        elif 'avatar_choice' in request.POST and request.POST['avatar_choice']:
            profile.usar_animado = True
            profile.avatar_tipo = request.POST['avatar_choice']  # Guardar el tipo seleccionado
            # Limpiar avatar anterior si existía
            profile.avatar = None
        
        profile.save()
        
        # Agregar mensaje de éxito
        messages.success(request, 'Avatar actualizado correctamente')
        
        # Redirigir a la configuración avanzada
        return redirect('configuracion_avanzada')
    
    # Si es GET, redirigir a configuración avanzada
    return redirect('configuracion_avanzada')


@supervisor_required
def reporte_usuarios(request):
    usuarios = User.objects.all().order_by('username')
    return render(request, 'reporte_usuarios.html', {'usuarios': usuarios})

@supervisor_required
def perfil_usuario(request, usuario_id):
    from datetime import date
    usuario = get_object_or_404(User, id=usuario_id)
    oportunidades = TodoItem.objects.filter(usuario=usuario).select_related('cliente')

    today = date.today()
    mes_actual = str(today.month).zfill(2)
    # Oportunidades del mes actual
    oportunidades_mes = oportunidades.filter(mes_cierre=mes_actual)

    # Oportunidad más grande (1-99% probabilidad, cualquier mes)
    oportunidad_mayor = oportunidades.filter(probabilidad_cierre__gte=1, probabilidad_cierre__lte=99).order_by('-monto').first()

    # Total cobrado del mes actual (probabilidad 100%)
    oportunidades_cobradas_mes = oportunidades_mes.filter(probabilidad_cierre=100)
    monto_total_cobrado_mes = oportunidades_cobradas_mes.aggregate(suma=Sum('monto'))['suma'] or 0

    # Oportunidades por cobrar del mes actual (probabilidad > 70% and < 100%)
    oportunidades_por_cobrar_mes = oportunidades_mes.filter(probabilidad_cierre__gt=70, probabilidad_cierre__lt=100)
    monto_total_por_cobrar_mes = oportunidades_por_cobrar_mes.aggregate(suma=Sum('monto'))['suma'] or 0

    # Oportunidades creadas en el mes actual (año y mes actual)
    oportunidades_creadas_mes = oportunidades.filter(fecha_creacion__year=today.year, fecha_creacion__month=today.month)
    oportunidades_creadas_mes_count = oportunidades_creadas_mes.count()

    context = {
        'usuario': usuario,
        'oportunidades': oportunidades.order_by('-monto'),
        'oportunidad_mayor': oportunidad_mayor,
        'oportunidades_cobradas_mes': oportunidades_cobradas_mes,
        'monto_total_cobrado_mes': monto_total_cobrado_mes,
        'oportunidades_por_cobrar_mes': oportunidades_por_cobrar_mes,
        'monto_total_por_cobrar_mes': monto_total_por_cobrar_mes,
        'mes_actual': today.strftime('%B').capitalize(),
        'oportunidades_creadas_mes_count': oportunidades_creadas_mes_count,
    }
    return render(request, 'perfil_usuario.html', context)


from django.views.decorators.csrf import csrf_exempt
from .bitrix_integration import get_bitrix_company_details, get_bitrix_deal_details, BITRIX_WEBHOOK_URL, map_bitrix_category_to_tipo_negociacion, get_producto_from_bitrix_deal, get_etapa_from_bitrix_stage
from django.contrib.auth.models import User
import requests
import traceback

@csrf_exempt
def bitrix_webhook_receiver(request):
    """
    Receives webhook notifications from Bitrix24.
    This view handles the 'ONCRMDEALADD' event to create a new opportunity (TodoItem)
    in the local database when a new deal is created in Bitrix24.
    """
    # Log EVERY request to debug
    print(f"BITRIX WEBHOOK: Received {request.method} request from {request.META.get('REMOTE_ADDR', 'unknown')}", flush=True)
    print(f"BITRIX WEBHOOK: Request headers: {dict(request.headers)}", flush=True)
    print(f"BITRIX WEBHOOK: Request body: {request.body}", flush=True)
    
    if request.method != 'POST':
        print("BITRIX WEBHOOK: Received non-POST request. Ignoring.", flush=True)
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        data = request.POST
        event = data.get('event')

        print(f"BITRIX WEBHOOK: POST data: {dict(data)}", flush=True)
        print(f"BITRIX WEBHOOK: Received event '{event}'", flush=True)

        if event in ['ONCRMDEALADD', 'ONCRMDEALUPDATE', 'ONCRMDEALDEL']:
            deal_id = data.get('data[FIELDS][ID]')
            if not deal_id:
                print(f"BITRIX WEBHOOK: '{event}' event received but no deal ID found.", flush=True)
                return JsonResponse({'status': 'error', 'message': 'Deal ID missing'}, status=400)

            print(f"BITRIX WEBHOOK: Processing {event} for Deal ID: {deal_id}", flush=True)
            
            # Check if this is a deletion event
            if event == 'ONCRMDEALDEL':
                print(f"BITRIX WEBHOOK: Processing DELETE event for Deal ID: {deal_id}", flush=True)
                try:
                    existing_opportunity = TodoItem.objects.get(bitrix_deal_id=deal_id)
                    opportunity_name = existing_opportunity.oportunidad
                    existing_opportunity.delete()
                    print(f"BITRIX WEBHOOK: Successfully deleted opportunity '{opportunity_name}' (Deal ID: {deal_id})", flush=True)
                    return JsonResponse({'status': 'success', 'message': f'Opportunity deleted: {opportunity_name}'})
                except TodoItem.DoesNotExist:
                    print(f"BITRIX WEBHOOK: Deal ID {deal_id} not found locally for deletion. Nothing to delete.", flush=True)
                    return JsonResponse({'status': 'success', 'message': 'Opportunity not found locally, nothing to delete'})
                except Exception as delete_error:
                    print(f"BITRIX WEBHOOK: Error deleting opportunity for Deal ID {deal_id}: {delete_error}", flush=True)
                    return JsonResponse({'status': 'error', 'message': f'Error deleting opportunity: {str(delete_error)}'}, status=500)

            # Check if this is an update to an existing deal
            is_update = event == 'ONCRMDEALUPDATE'
            existing_opportunity = None
            
            if is_update:
                try:
                    existing_opportunity = TodoItem.objects.get(bitrix_deal_id=deal_id)
                    print(f"BITRIX WEBHOOK: Found existing opportunity '{existing_opportunity.oportunidad}' for update", flush=True)
                except TodoItem.DoesNotExist:
                    print(f"BITRIX WEBHOOK: Deal ID {deal_id} not found locally. Will create new opportunity.", flush=True)
                    is_update = False
            else:
                # For ONCRMDEALADD, check for duplicates
                if TodoItem.objects.filter(bitrix_deal_id=deal_id).exists():
                    print(f"BITRIX WEBHOOK: An opportunity for Deal ID {deal_id} already exists. Skipping creation.", flush=True)
                    return JsonResponse({'status': 'success', 'message': 'Duplicate ignored'})

            # Intentar obtener detalles de la oportunidad con una llamada simple
            deal_details = None
            if BITRIX_WEBHOOK_URL:
                try:
                    get_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.get.json")
                    response = requests.post(get_url, json={
                        'id': deal_id,
                        'select': [
                            'ID', 'TITLE', 'OPPORTUNITY', 'CURRENCY_ID', 'COMMENTS',
                            'COMPANY_ID', 'CONTACT_ID', 'ASSIGNED_BY_ID', 'STAGE_ID', 'CATEGORY_ID',
                            'UF_CRM_1752859685662',  # Producto (Runrate)
                            'UF_CRM_1750723256972',  # Solución (Proyectos)
                            'UF_CRM_1752859525038',  # Área
                            'UF_CRM_1752859877756',  # Mes de Cobro
                            'UF_CRM_1752855787179',  # Probabilidad de cierre
                            'UF_CRM_1755615484859',  # Utilidad
                        ]
                    }, timeout=5)
                    if response.status_code == 200:
                        deal_data = response.json()
                        if 'result' in deal_data and deal_data['result']:
                            deal_details = deal_data['result']
                            print(f"BITRIX WEBHOOK: Successfully fetched deal details for ID: {deal_id}", flush=True)
                        else:
                            print(f"BITRIX WEBHOOK: No result in API response for Deal ID: {deal_id}", flush=True)
                    else:
                        print(f"BITRIX WEBHOOK: API returned status {response.status_code} for Deal ID: {deal_id}", flush=True)
                except requests.exceptions.RequestException as e:
                    print(f"BITRIX WEBHOOK: Request failed for Deal ID {deal_id}: {e}", flush=True)
                except Exception as e:
                    print(f"BITRIX WEBHOOK: Unexpected error fetching deal details for ID {deal_id}: {e}", flush=True)
            
            # Si no se pudieron obtener los detalles, usar valores por defecto
            if not deal_details:
                deal_details = {
                    'ID': deal_id,
                    'TITLE': f'Oportunidad #{deal_id}',  # Título por defecto
                    'OPPORTUNITY': 0.0,  # Monto por defecto
                    'COMPANY_ID': None,  # Se buscará si hay datos disponibles
                    'ASSIGNED_BY_ID': None,  # Se buscará si hay datos disponibles
                    'CONTACT_ID': None,  # Se buscará si hay datos disponibles
                }
                print(f"BITRIX WEBHOOK: Using default deal details for Deal ID: {deal_id}", flush=True)
            else:
                print(f"BITRIX WEBHOOK: Using fetched deal details: Title='{deal_details.get('TITLE', 'N/A')}', Amount={deal_details.get('OPPORTUNITY', 'N/A')}", flush=True)

            # --- Find or Create the Associated Client (Company) ---
            company_id = deal_details.get('COMPANY_ID')
            cliente = None
            if company_id:
                try:
                    cliente = Cliente.objects.get(bitrix_company_id=company_id)
                    print(f"BITRIX WEBHOOK: Found existing client '{cliente.nombre_empresa}' for Company ID: {company_id}", flush=True)
                except Cliente.DoesNotExist:
                    print(f"BITRIX WEBHOOK: Client with Company ID {company_id} not found. Creating new client.", flush=True)
                    company_details = get_bitrix_company_details(company_id, request=request)
                    if company_details and company_details.get('TITLE'):
                        cliente = Cliente.objects.create(
                            bitrix_company_id=company_details.get('ID'),
                            nombre_empresa=company_details.get('TITLE')
                        )
                        print(f"BITRIX WEBHOOK: Created new client '{cliente.nombre_empresa}'", flush=True)
                    else:
                        print(f"BITRIX WEBHOOK: Could not fetch details for Company ID: {company_id}", flush=True)
            else:
                print("BITRIX WEBHOOK: Deal has no associated Company ID.", flush=True)

            # --- Find the Assigned User ---
            assigned_by_id = deal_details.get('ASSIGNED_BY_ID')
            usuario = None
            
            if assigned_by_id:
                try:
                    usuario = User.objects.filter(userprofile__bitrix_user_id=assigned_by_id).first()
                    if usuario:
                        print(f"BITRIX WEBHOOK: Found user '{usuario.username}' for Assigned ID: {assigned_by_id}", flush=True)
                    else:
                        print(f"BITRIX WEBHOOK: User with Bitrix User ID {assigned_by_id} not found in local DB.", flush=True)
                except Exception as e:
                    print(f"BITRIX WEBHOOK: Error finding user for Bitrix ID {assigned_by_id}: {e}", flush=True)
                    usuario = None
            else:
                print("BITRIX WEBHOOK: Deal has no assigned user.", flush=True)
            
            # --- Find or Create the Contact ---
            contact_id = deal_details.get('CONTACT_ID')
            contacto_obj = None
            
            if contact_id:
                try:
                    # Buscar contacto existente por bitrix_contact_id
                    contacto_obj = Contacto.objects.filter(bitrix_contact_id=contact_id).first()
                    if contacto_obj:
                        print(f"BITRIX WEBHOOK: Found existing contact '{contacto_obj.nombre} {contacto_obj.apellido}' for Contact ID: {contact_id}", flush=True)
                    else:
                        print(f"BITRIX WEBHOOK: Contact with ID {contact_id} not found locally. Fetching from Bitrix24...", flush=True)
                        # Obtener detalles del contacto desde Bitrix24
                        from .bitrix_integration import get_bitrix_contact_details
                        contact_details = get_bitrix_contact_details(contact_id, request=request)
                        if contact_details:
                            try:
                                contacto_obj = Contacto.objects.create(
                                    nombre=contact_details.get('NAME', 'Sin nombre'),
                                    apellido=contact_details.get('LAST_NAME', ''),
                                    bitrix_contact_id=contact_id,
                                    company_id=contact_details.get('COMPANY_ID'),
                                    cliente=cliente  # Asociar con el cliente
                                )
                                print(f"BITRIX WEBHOOK: Created new contact '{contacto_obj.nombre} {contacto_obj.apellido}'", flush=True)
                            except Exception as e:
                                print(f"BITRIX WEBHOOK: Error creating contact: {e}", flush=True)
                                contacto_obj = None
                        else:
                            print(f"BITRIX WEBHOOK: Could not fetch contact details from Bitrix24 for ID {contact_id}", flush=True)
                except Exception as e:
                    print(f"BITRIX WEBHOOK: Error processing contact ID {contact_id}: {e}", flush=True)
                    contacto_obj = None
            else:
                print("BITRIX WEBHOOK: Deal has no associated Contact ID.", flush=True)

            print(f"BITRIX WEBHOOK: DEBUG - After user assignment. is_update={locals().get('is_update', 'NOT_DEFINED')}, existing_opportunity={locals().get('existing_opportunity', 'NOT_DEFINED')}", flush=True)

            # --- Create the Opportunity (TodoItem) ---
            # Always create the opportunity, using defaults if needed
            if not usuario:
                print(f"BITRIX WEBHOOK: User not found, using default user", flush=True)
                usuario, _ = User.objects.get_or_create(
                    username='default_user',
                    defaults={
                        'first_name': 'Usuario',
                        'last_name': 'Sin Asignar',
                        'is_active': True
                    }
                )
            
            if not cliente:
                print(f"BITRIX WEBHOOK: Client not found, using default client", flush=True)
                cliente, _ = Cliente.objects.get_or_create(
                    nombre_empresa='Cliente Desconocido',
                    defaults={'bitrix_company_id': None}
                )

            # Now create the opportunity
            # Mapeos de Bitrix ID a Django Value - igual que en import_bitrix_opportunities.py
            PRODUCTO_BITRIX_ID_TO_DJANGO_VALUE = {
                "176": "ZEBRA", "178": "PANDUIT", "180": "APC", "182": "AVIGILION",
                "184": "GENETEC", "186": "AXIS", "188": "SOFTWARE", "190": "RUNRATE",
                "192": "PÓLIZA", "194": "CISCO", "374": "RFID", "376": "CONSUMIBLE",
                "378": "IMPRESORA INDUSTRIAL", "380": "SCANNER", "382": "TABLETA",
                "582": "SERVICIO",
            }

            AREA_BITRIX_ID_TO_DJANGO_VALUE = {
                "164": "SISTEMAS", "166": "Recursos Humanos", "168": "Compras",
                "170": "Seguridad", "172": "Mantenimiento", "174": "Almacén",
            }

            MES_COBRO_BITRIX_ID_TO_DJANGO_VALUE = {
                "196": "Enero", "198": "Febrero", "200": "Marzo", "202": "Abril",
                "204": "Mayo", "206": "Junio", "208": "Julio", "210": "Agosto",
                "212": "Septiembre", "214": "Octubre", "216": "Noviembre", "218": "Diciembre",
            }

            PROBABILIDAD_BITRIX_ID_TO_VALUE_STRING = {
                "220": "0%", "124": "10%", "126": "20%", "128": "30%",
                "130": "40%", "132": "50%", "134": "60%", "136": "70%",
                "138": "80%", "140": "90%", "142": "100%",
            }

            UTILIDAD_BITRIX_ID_TO_VALUE_STRING = {
                "718": "10%", "720": "15%", "722": "20%", 
                "724": "25%", "726": "30%", "728": "35%",
            }

            # Obtener valores raw de Bitrix
            area_bitrix_id = deal_details.get('UF_CRM_1752859525038')
            mes_cierre_bitrix_id = deal_details.get('UF_CRM_1752859877756')
            probabilidad_bitrix_id = deal_details.get('UF_CRM_1752855787179')
            utilidad_bitrix_id = deal_details.get('UF_CRM_1755615484859')
            category_id = deal_details.get('CATEGORY_ID')

            print(f"BITRIX WEBHOOK: Raw area ID: {area_bitrix_id}", flush=True)
            print(f"BITRIX WEBHOOK: Raw mes_cierre ID: {mes_cierre_bitrix_id}", flush=True)
            print(f"BITRIX WEBHOOK: Raw probabilidad ID: {probabilidad_bitrix_id}", flush=True)
            print(f"BITRIX WEBHOOK: Raw utilidad ID: {utilidad_bitrix_id}", flush=True)
            print(f"BITRIX WEBHOOK: Raw category ID: {category_id}", flush=True)

            # Mapear tipo de negociación desde CATEGORY_ID
            tipo_negociacion = map_bitrix_category_to_tipo_negociacion(category_id)
            
            # Aplicar conversiones de mapeo
            area = AREA_BITRIX_ID_TO_DJANGO_VALUE.get(str(area_bitrix_id), 'SISTEMAS') # Default
            mes_cierre = MES_COBRO_BITRIX_ID_TO_DJANGO_VALUE.get(str(mes_cierre_bitrix_id), 'Enero') # Default
            
            # Mapear producto/solución según el tipo de negociación
            producto = get_producto_from_bitrix_deal(deal_details, tipo_negociacion)
            
            # Mapear etapa según el tipo de negociación
            stage_id = deal_details.get('STAGE_ID')
            etapa_corta, etapa_completa, etapa_color = get_etapa_from_bitrix_stage(stage_id, tipo_negociacion)

            probabilidad_cierre = 0 # Default value
            if probabilidad_bitrix_id is not None:
                prob_str = PROBABILIDAD_BITRIX_ID_TO_VALUE_STRING.get(str(probabilidad_bitrix_id))
                if prob_str:
                    try:
                        parsed_prob = int(prob_str.replace('%', ''))
                        probabilidad_cierre = min(parsed_prob, 100) # Cap at 100
                    except ValueError:
                        print(f"BITRIX WEBHOOK: Invalid probability string from Bitrix: {prob_str}. Setting to default (0).", flush=True)
                        probabilidad_cierre = 0
                else:
                    print(f"BITRIX WEBHOOK: Unknown probability ID from Bitrix: {probabilidad_bitrix_id}. Setting to default (0).", flush=True)
                    probabilidad_cierre = 0

            # Procesar porcentaje de utilidad
            porcentaje_utilidad = 0 # Default value
            if utilidad_bitrix_id is not None:
                utilidad_str = UTILIDAD_BITRIX_ID_TO_VALUE_STRING.get(str(utilidad_bitrix_id))
                if utilidad_str:
                    try:
                        parsed_utilidad = int(utilidad_str.replace('%', ''))
                        porcentaje_utilidad = min(parsed_utilidad, 100) # Cap at 100
                        print(f"BITRIX WEBHOOK: Porcentaje de utilidad configurado: {porcentaje_utilidad}%", flush=True)
                    except ValueError:
                        print(f"BITRIX WEBHOOK: Invalid utilidad string from Bitrix: {utilidad_str}. Setting to default (0).", flush=True)
                        porcentaje_utilidad = 0
                else:
                    print(f"BITRIX WEBHOOK: Unknown utilidad ID from Bitrix: {utilidad_bitrix_id}. Setting to default (0).", flush=True)
                    porcentaje_utilidad = 0

                print(f"BITRIX WEBHOOK: Mapped product: {producto}", flush=True)
                print(f"BITRIX WEBHOOK: Mapped area: {area}", flush=True)
                print(f"BITRIX WEBHOOK: Mapped mes_cierre: {mes_cierre}", flush=True)
                print(f"BITRIX WEBHOOK: Mapped probabilidad_cierre: {probabilidad_cierre}", flush=True)
                print(f"BITRIX WEBHOOK: About to create opportunity with usuario={usuario}, cliente={cliente}", flush=True)

                if is_update and existing_opportunity:
                    # Verificar si cambió el producto (para detectar cuando se agrega Zebra)
                    producto_anterior = existing_opportunity.producto
                    print(f"BITRIX WEBHOOK: PRODUCTO DEBUG - Anterior: '{producto_anterior}' | Nuevo: '{producto}' | Son diferentes: {producto_anterior != producto}", flush=True)
                    
                    # Obtener el estado de Bitrix24
                    bitrix_stage_id = deal_details.get('STAGE_ID')
                    print(f"BITRIX WEBHOOK: Raw STAGE_ID: {bitrix_stage_id}", flush=True)
                    
                    # Actualizar oportunidad existente
                    existing_opportunity.oportunidad = deal_details.get('TITLE', existing_opportunity.oportunidad)
                    existing_opportunity.monto = deal_details.get('OPPORTUNITY', existing_opportunity.monto) or existing_opportunity.monto
                    existing_opportunity.cliente = cliente or existing_opportunity.cliente
                    existing_opportunity.usuario = usuario or existing_opportunity.usuario
                    existing_opportunity.producto = producto
                    existing_opportunity.area = area
                    existing_opportunity.mes_cierre = mes_cierre
                    existing_opportunity.tipo_negociacion = tipo_negociacion  # Nuevo campo
                    existing_opportunity.etapa_corta = etapa_corta
                    existing_opportunity.etapa_completa = etapa_completa
                    existing_opportunity.etapa_color = etapa_color
                    existing_opportunity.probabilidad_cierre = probabilidad_cierre
                    existing_opportunity.bitrix_stage_id = bitrix_stage_id  # Guardar el estado
                    existing_opportunity.contacto = contacto_obj  # Asignar contacto
                    existing_opportunity.save()
                    print(f"BITRIX WEBHOOK: Successfully updated opportunity '{existing_opportunity.oportunidad}' with ID {existing_opportunity.id}", flush=True)
                    
                    # ========================================
                    # VERIFICAR SI CAMBIÓ EL PRODUCTO A UNA MARCA AUTOMÁTICA
                    # ========================================
                    if producto_anterior != producto:
                        print(f"BITRIX WEBHOOK: Producto cambió de '{producto_anterior}' a '{producto}' - Verificando cotización automática", flush=True)
                        
                        # Verificar si debe generar cotización automática
                        if es_cotizacion_automatica(deal_details):
                            print(f"BITRIX WEBHOOK: Oportunidad actualizada califica para cotización automática - Marca: {producto}", flush=True)
                            
                            # Verificar si ya tiene cotización para evitar duplicados
                            from app.models import Cotizacion
                            cotizacion_existente = Cotizacion.objects.filter(oportunidad=existing_opportunity).first()
                            
                            if cotizacion_existente:
                                print(f"BITRIX WEBHOOK: Ya existe cotización ID {cotizacion_existente.id} para esta oportunidad - No se creará duplicado", flush=True)
                            else:
                                # Obtener usuario final del contacto
                                contact_id = deal_details.get('CONTACT_ID')
                                usuario_final = ''
                                if contact_id:
                                    try:
                                        from .bitrix_integration import get_bitrix_contact_details
                                        contact_details = get_bitrix_contact_details(contact_id, request=request)
                                        if contact_details:
                                            usuario_final = f"{contact_details.get('NAME', '')} {contact_details.get('LAST_NAME', '')}".strip()
                                            print(f"BITRIX WEBHOOK: Usuario final obtenido: {usuario_final}", flush=True)
                                    except Exception as e:
                                        print(f"BITRIX WEBHOOK: Error obteniendo contacto: {e}", flush=True)
                                
                                # Crear cotización automática
                                cotizacion_automatica = crear_cotizacion_automatica_bitrix(deal_details, cliente, usuario, porcentaje_utilidad)
                                
                                if cotizacion_automatica:
                                    # Agregar usuario final si se obtuvo
                                    if usuario_final:
                                        cotizacion_automatica.usuario_final = usuario_final
                                        cotizacion_automatica.save()
                                    
                                    # Subir PDF a Bitrix24
                                    resultado_subida = subir_cotizacion_a_bitrix(cotizacion_automatica, deal_id, request)
                                    
                                    if resultado_subida:
                                        print(f"BITRIX WEBHOOK: ✅ Cotización automática completada exitosamente para deal actualizado {deal_id}")
                                    else:
                                        print(f"BITRIX WEBHOOK: ⚠️ Cotización creada pero falló la subida a Bitrix24 para deal actualizado {deal_id}")
                                else:
                                    print(f"BITRIX WEBHOOK: ❌ No se pudo crear la cotización automática para deal actualizado {deal_id}")
                        else:
                            print(f"BITRIX WEBHOOK: Oportunidad actualizada NO califica para cotización automática - Producto: {producto}", flush=True)
                else:
                    # Crear nueva oportunidad
                    print(f"BITRIX WEBHOOK: Creating new opportunity with data:", flush=True)
                    print(f"  - Title: {deal_details.get('TITLE', 'Oportunidad sin título')}", flush=True)
                    print(f"  - Amount: {deal_details.get('OPPORTUNITY', 0.0)}", flush=True)
                    print(f"  - Cliente: {cliente}", flush=True)
                    print(f"  - Usuario: {usuario}", flush=True)
                    print(f"  - Deal ID: {deal_id}", flush=True)
                    
                    # Obtener el estado de Bitrix24
                    bitrix_stage_id = deal_details.get('STAGE_ID')
                    print(f"BITRIX WEBHOOK: Raw STAGE_ID for new opportunity: {bitrix_stage_id}", flush=True)
                    
                    try:
                        new_opportunity = TodoItem.objects.create(
                            oportunidad=deal_details.get('TITLE', 'Oportunidad sin título'),
                            monto=deal_details.get('OPPORTUNITY', 0.0) or 0.0,
                            cliente=cliente,
                            usuario=usuario,
                            bitrix_deal_id=deal_id,
                            producto=producto,
                            area=area,
                            mes_cierre=mes_cierre,
                            tipo_negociacion=tipo_negociacion,  # Nuevo campo
                            etapa_corta=etapa_corta,
                            etapa_completa=etapa_completa,
                            etapa_color=etapa_color,
                            probabilidad_cierre=probabilidad_cierre,
                            bitrix_stage_id=bitrix_stage_id,  # Guardar el estado
                            contacto=contacto_obj,  # Asignar contacto
                        )
                        print(f"BITRIX WEBHOOK: Successfully created new opportunity '{new_opportunity.oportunidad}' with ID {new_opportunity.id}", flush=True)
                        
                        # ========================================
                        # LÓGICA DE COTIZACIÓN AUTOMÁTICA
                        # ========================================
                        
                        # Verificar si debe generar cotización automática
                        if es_cotizacion_automatica(deal_details):
                            print(f"BITRIX WEBHOOK: Oportunidad califica para cotización automática - Marca: {producto}", flush=True)
                            
                            # Obtener usuario final del contacto
                            contact_id = deal_details.get('CONTACT_ID')
                            usuario_final = ''
                            if contact_id:
                                try:
                                    from .bitrix_integration import get_bitrix_contact_details
                                    contact_details = get_bitrix_contact_details(contact_id, request=request)
                                    if contact_details:
                                        usuario_final = f"{contact_details.get('NAME', '')} {contact_details.get('LAST_NAME', '')}".strip()
                                        print(f"BITRIX WEBHOOK: Usuario final obtenido: {usuario_final}", flush=True)
                                except Exception as e:
                                    print(f"BITRIX WEBHOOK: Error obteniendo contacto: {e}", flush=True)
                            
                            # Crear cotización automática
                            cotizacion_automatica = crear_cotizacion_automatica_bitrix(deal_details, cliente, usuario, porcentaje_utilidad)
                            
                            if cotizacion_automatica:
                                # Agregar usuario final si se obtuvo
                                if usuario_final:
                                    cotizacion_automatica.usuario_final = usuario_final
                                    cotizacion_automatica.save()
                                
                                # Subir PDF a Bitrix24
                                resultado_subida = subir_cotizacion_a_bitrix(cotizacion_automatica, deal_id, request)
                                
                                if resultado_subida:
                                    print(f"BITRIX WEBHOOK: ✅ Cotización automática completada exitosamente para deal {deal_id}")
                                else:
                                    print(f"BITRIX WEBHOOK: ⚠️ Cotización creada pero falló la subida a Bitrix24 para deal {deal_id}")
                            else:
                                print(f"BITRIX WEBHOOK: ❌ No se pudo crear la cotización automática para deal {deal_id}")
                        else:
                            print(f"BITRIX WEBHOOK: Oportunidad NO califica para cotización automática - Producto: {producto}", flush=True)
                        
                    except Exception as create_error:
                        print(f"BITRIX WEBHOOK: Error creating opportunity: {create_error}", flush=True)
                        print(f"BITRIX WEBHOOK: Traceback: {traceback.format_exc()}", flush=True)

        return JsonResponse({'status': 'success'})

    except Exception as e:
        print(f"BITRIX WEBHOOK: An unexpected error occurred: {e}", flush=True)
        print(traceback.format_exc(), flush=True)
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

from django.template.context_processors import request as request_context

def add_is_supervisor_to_context(request):
    return {'is_supervisor': is_supervisor(request.user) if request.user.is_authenticated else False}

from .bitrix_integration import get_all_bitrix_companies

@login_required
def cotizaciones_view(request):
    user = request.user
    is_supervisor_flag = is_supervisor(request.user)
    print(f"DEBUG: cotizaciones_view - Usuario: {user.username}, Es supervisor: {is_supervisor_flag}")

    # Obtener clientes de la base de datos local
    clientes_locales = Cliente.objects.all().order_by('nombre_empresa')
    print(f"DEBUG: cotizaciones_view - Clientes locales obtenidos: {clientes_locales.count()}")

    # Obtener clientes de Bitrix
    clientes_bitrix = get_all_bitrix_companies(request=request)
    print(f"DEBUG: cotizaciones_view - Clientes de Bitrix obtenidos: {len(clientes_bitrix)}")

    # Combinar y desduplicar clientes
    clientes_combinados = {cliente.bitrix_company_id: cliente for cliente in clientes_locales if cliente.bitrix_company_id}
    for cliente_b in clientes_bitrix:
        bitrix_id = cliente_b['ID']
        if bitrix_id not in clientes_combinados:
            # Si el cliente de Bitrix no existe localmente, créalo
            cliente_nuevo, created = Cliente.objects.get_or_create(
                bitrix_company_id=bitrix_id,
                defaults={'nombre_empresa': cliente_b['TITLE']}
            )
            if created:
                print(f"DEBUG: cotizaciones_view - Cliente de Bitrix creado localmente: {cliente_nuevo.nombre_empresa}")
    
    # Obtener todos los clientes de nuevo para incluir los recién creados
    clientes = Cliente.objects.all().order_by('nombre_empresa')

    clientes_data = []
    for cliente in clientes:
        if is_supervisor_flag:
            cotizaciones_qs = Cotizacion.objects.filter(cliente=cliente)
        else:
            cotizaciones_qs = Cotizacion.objects.filter(cliente=cliente, created_by=request.user)
        
        from django.urls import reverse
        cotizaciones_list = [
            {
                'id': c.id,
                'nombre': c.nombre_cotizacion or f'Cotización #{c.id}',
                'descargar_url': reverse('generate_cotizacion_pdf', args=[c.id]),
                'view_url': reverse('view_cotizacion_pdf', args=[c.id])
            }
            for c in cotizaciones_qs
        ]

        clientes_data.append({
            'id': cliente.id,
            'nombre': cliente.nombre_empresa,
            'cotizaciones': cotizaciones_list
        })
    print(f"DEBUG: cotizaciones_view - Clientes finales en clientes_asignados: {len(clientes_data)}")

    context = {
        'clientes_asignados': clientes_data,
        'is_supervisor': is_supervisor_flag
    }
    return render(request, 'cotizaciones.html', context)

def cotizaciones_por_oportunidad_view(request, oportunidad_id):
    """
    Vista para mostrar todas las cotizaciones y volumetrías de una oportunidad específica
    """
    oportunidad = get_object_or_404(TodoItem, pk=oportunidad_id)
    
    # Determinar qué tipo de contenido mostrar basado en el parámetro 'tipo'
    tipo_contenido = request.GET.get('tipo', 'cotizaciones')  # Por defecto mostrar cotizaciones
    
    cotizaciones = Cotizacion.objects.filter(oportunidad=oportunidad).order_by('-fecha_creacion')
    volumetrias = Volumetria.objects.filter(oportunidad=oportunidad).order_by('-fecha_creacion')
    
    # Detectar cotizaciones nuevas y crear comentarios automáticos
    if cotizaciones.exists():
        try:
            from app.models import OportunidadComentario, OportunidadActividad
            import re
            
            # LIMPIEZA ÚNICA: Eliminar comentarios duplicados de cotizaciones (ejecutar solo una vez)
            # Buscar comentarios de cotización sin el patrón [COT_ID:X] (comentarios antiguos)
            comentarios_sin_patron = OportunidadComentario.objects.filter(
                oportunidad=oportunidad,
                contenido__contains='📋 Nueva cotización creada:'
            ).exclude(contenido__contains='[COT_ID:')
            
            if comentarios_sin_patron.exists():
                print(f"🧹 Limpiando {comentarios_sin_patron.count()} comentarios duplicados antiguos...")
                
                # También eliminar las actividades asociadas
                for comentario in comentarios_sin_patron:
                    OportunidadActividad.objects.filter(
                        oportunidad=oportunidad,
                        descripcion__contains=f'[COMENTARIO_ID:{comentario.id}]'
                    ).delete()
                
                comentarios_sin_patron.delete()
                print("✅ Comentarios duplicados eliminados")
            
            # Obtener todas las actividades de comentarios de esta oportunidad
            actividades_comentarios = OportunidadActividad.objects.filter(
                oportunidad=oportunidad,
                tipo='comentario'
            )
            
            # Obtener IDs de cotizaciones que ya tienen comentarios automáticos
            # Usamos un patrón único en el contenido del comentario para identificarlos
            cotizaciones_con_comentario = set()
            
            # Buscar comentarios que contengan el patrón específico de cotización automática
            comentarios_auto = OportunidadComentario.objects.filter(
                oportunidad=oportunidad,
                contenido__contains='📋 Nueva cotización creada:'
            )
            
            for comentario in comentarios_auto:
                # Extraer ID de cotización del patrón [COT_ID:X] que agregaremos
                match = re.search(r'\[COT_ID:(\d+)\]', comentario.contenido)
                if match:
                    cotizaciones_con_comentario.add(int(match.group(1)))
                
            print(f"🔍 Cotizaciones con comentarios automáticos: {cotizaciones_con_comentario}")
            print(f"📊 Cotizaciones actuales en BD: {[c.id for c in cotizaciones]}")
            
            # Crear comentarios para cotizaciones sin comentario
            for cotizacion in cotizaciones:
                if cotizacion.id not in cotizaciones_con_comentario:
                    try:
                        # Crear comentario automático con identificador único de la cotización
                        cot_title = cotizacion.titulo or cotizacion.nombre_cotizacion or f'Cotización #{cotizacion.id}'
                        contenido_comentario = f"📋 Nueva cotización creada: {cot_title} [COT_ID:{cotizacion.id}]"
                        
                        comentario_auto = OportunidadComentario.objects.create(
                            oportunidad=oportunidad,
                            usuario=cotizacion.created_by,  # Usuario que creó la cotización
                            contenido=contenido_comentario
                        )
                        
                        # Crear actividad en el timeline (sin el [COT_ID:X] para que no se vea en el frontend)
                        descripcion_actividad_limpia = f"📋 Nueva cotización creada: {cot_title} [COMENTARIO_ID:{comentario_auto.id}]"
                        
                        OportunidadActividad.objects.create(
                            oportunidad=oportunidad,
                            tipo='comentario',
                            titulo='Nueva Cotización',
                            descripcion=descripcion_actividad_limpia,
                            usuario=cotizacion.created_by
                        )
                        
                        print(f"✅ Comentario automático creado para cotización {cotizacion.id} - {cot_title}")
                        
                    except Exception as e:
                        print(f"❌ Error creando comentario automático para cotización {cotizacion.id}: {e}")
                        
        except Exception as e:
            print(f"❌ Error en detección de cotizaciones nuevas: {e}")
    
        context = {
    
            'oportunidad': oportunidad,
    
            'cotizaciones': cotizaciones,
    
            'volumetrias': volumetrias,
    
            'tiene_cotizaciones': cotizaciones.exists(),
    
            'tiene_volumetrias': volumetrias.exists(),
    
            'tipo_contenido': tipo_contenido,
    
            'is_engineer': True,
    
        }
    
    # Asegurarse de que context esté definido antes de usarlo
    if 'context' not in locals():
        context = {}
    
    # Verificar que la oportunidad esté en el contexto
    if 'oportunidad' not in context:
        context['oportunidad'] = oportunidad
    
    return render(request, 'cotizaciones_por_oportunidad.html', context)

@login_required
@require_http_methods(["POST"])
def editar_oportunidad_api(request, oportunidad_id):
    """
    API para editar información de una oportunidad
    """
    try:
        oportunidad = get_object_or_404(TodoItem, pk=oportunidad_id)
        
        # Verificar permisos - supervisores pueden editar todo, usuarios solo sus oportunidades
        if not is_supervisor(request.user) and oportunidad.usuario != request.user:
            return JsonResponse({'success': False, 'error': 'No tienes permisos para editar esta oportunidad'})
        
        updated_values = {}
        
        # Actualizar cliente
        if 'cliente' in request.POST and request.POST['cliente']:
            try:
                cliente = Cliente.objects.get(id=request.POST['cliente'])
                oportunidad.cliente = cliente
                updated_values['cliente'] = cliente.nombre_empresa
            except Cliente.DoesNotExist:
                return JsonResponse({'success': False, 'error': 'Cliente no encontrado'})
        
        # Actualizar contacto
        if 'contacto' in request.POST:
            oportunidad.contacto = request.POST['contacto'].strip()
            updated_values['contacto'] = oportunidad.contacto or "Sin contacto"
        
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
        
        # Actualizar monto
        if 'monto' in request.POST:
            try:
                monto = float(request.POST['monto'])
                oportunidad.monto = monto
                updated_values['monto'] = f"${monto:,.2f}"
            except (ValueError, TypeError):
                return JsonResponse({'success': False, 'error': 'Monto inválido'})
        
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
        
        oportunidad.save()
        
        return JsonResponse({
            'success': True, 
            'message': 'Oportunidad actualizada correctamente',
            'updated_values': updated_values
        })
        
    except Exception as e:
        print(f"Error editando oportunidad: {e}")
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
def clientes_api(request):
    """
    API para obtener lista de clientes
    """
    try:
        clientes = Cliente.objects.all().order_by('nombre_empresa')
        clientes_data = [
            {
                'id': cliente.id,
                'nombre_empresa': cliente.nombre_empresa
            }
            for cliente in clientes
        ]
        return JsonResponse(clientes_data, safe=False)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
def cotizaciones_por_cliente_view(request, cliente_id):
    user = request.user
    is_supervisor = user.groups.filter(name='Supervisores').exists()
    cliente = get_object_or_404(Cliente, id=cliente_id)
    if is_supervisor:
        cotizaciones = Cotizacion.objects.filter(cliente=cliente)
    else:
        cotizaciones = Cotizacion.objects.filter(cliente=cliente, created_by=user)
    cotizaciones_list = [
        {
            'id': c.id,
            'nombre_cotizacion': c.nombre_cotizacion or c.titulo or f'Cotización #{c.id}',
            'descargar_url': f"/cotizacion/pdf/{c.id}/"
        }
        for c in cotizaciones
    ]
    return render(request, 'cotizaciones_cliente.html', {
        'cliente': cliente,
        'cotizaciones': cotizaciones_list,
        'is_supervisor': is_supervisor
    })




import traceback



from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from .models import TodoItem



from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required
from .models import Cliente
from .bitrix_integration import get_or_create_bitrix_company

@csrf_exempt
@login_required
def crear_cliente_api(request):
    if request.method == 'POST':
        form = ClienteForm(request.POST)
        if form.is_valid():
            # Create the company in Bitrix24 first
            company_name = form.cleaned_data['nombre_empresa']
            contact_name = form.cleaned_data['contacto_principal']
            email = form.cleaned_data['email']
            bitrix_company_id = get_or_create_bitrix_company(company_name, email, contact_name, request=request)

            if bitrix_company_id:
                # Check if a client with this bitrix_company_id already exists
                cliente, created = Cliente.objects.get_or_create(
                    bitrix_company_id=bitrix_company_id,
                    defaults={
                        'nombre_empresa': form.cleaned_data['nombre_empresa'],
                        'contacto_principal': form.cleaned_data['contacto_principal'],
                        'email': form.cleaned_data['email'],
                        'asignado_a': request.user
                    }
                )
                if not created:
                    # If the client already existed, update its fields
                    cliente.nombre_empresa = form.cleaned_data['nombre_empresa']
                    cliente.contacto_principal = form.cleaned_data['contacto_principal']
                    cliente.email = form.cleaned_data['email']
                    cliente.save()

                return JsonResponse({
                    'success': True,
                    'cliente': {
                        'id': cliente.id, # Return the local DB ID
                        'nombre_empresa': cliente.nombre_empresa,
                    }
                })
            else:
                return JsonResponse({'success': False, 'errors': {'__all__': ['Could not create company in Bitrix24.']}}, status=400)
        else:
            print(f"DEBUG: OportunidadModalForm errors: {form.errors}", flush=True)
            return JsonResponse({'success': False, 'errors': form.errors}, status=400)
    return JsonResponse({'error': 'Método no permitido'}, status=405)

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
def view_incrementa_pdf(request, quote_id):
    # This is a dummy PDF content. In a real scenario, you would fetch the PDF
    # from Incrementa API or a storage.
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Cotización Incrementa #{quote_id}</title>
        <style>
            body {{ font-family: sans-serif; margin: 40px; }}
            h1 {{ color: #333; }}
            p {{ color: #666; }}
        </style>
    </head>
    <body>
        <h1>Cotización Incrementa #{quote_id}</h1>
        <p>Este es un PDF de ejemplo para la cotización de Incrementa.</p>
        <p>Contenido detallado de la cotización #{quote_id} iría aquí.</p>
        <p>Fecha: 2023-XX-XX</p>
        <p>Monto: $XXXX.XX</p>
        <p>Cliente: Cliente de Ejemplo</p>
        <p>Este documento simula el PDF de una cotización de Incrementa.</p>
    </body>
    </html>
    """
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="cotizacion_incrementa_{quote_id}.pdf"'
    HTML(string=html_content).write_pdf(response)
    return response

@login_required
def download_incrementa_pdf(request, quote_id):
    # This is a dummy PDF content. In a real scenario, you would fetch the PDF
    # from Incrementa API or a storage.
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Cotización Incrementa #{quote_id}</title>
        <style>
            body {{ font-family: sans-serif; margin: 40px; }}
            h1 {{ color: #333; }}
            p {{ color: #666; }}
        </style>
    </head>
    <body>
        <h1>Cotización Incrementa #{quote_id}</h1>
        <p>Este es un PDF de ejemplo para la cotización de Incrementa.</p>
        <p>Contenido detallado de la cotización #{quote_id} iría aquí.</p>
        <p>Fecha: 2023-XX-XX</p>
        <p>Monto: $XXXX.XX</p>
        <p>Cliente: Cliente de Ejemplo</p>
        <p>Este documento simula el PDF de una cotización de Incrementa.</p>
    </body>
    </html>
    """
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="cotizacion_incrementa_{quote_id}.pdf"'
    HTML(string=html_content).write_pdf(response)
    return response

@csrf_exempt
@login_required
def incrementa_view(request):
    if not is_supervisor(request.user) and not request.user.groups.filter(name='Supervisores').exists():
        return render(request, 'incrementa.html', {'coming_soon': True})

    # Dummy data for Incrementa quotes (replace with API integration later)
    all_incrementa_quotes = [
        {'id': 1, 'nombre': 'Cotización Incrementa #001 - Cliente A', 'fecha': '2023-01-15', 'monto': 1500.00},
        {'id': 2, 'nombre': 'Cotización Incrementa #002 - Cliente B', 'fecha': '2023-02-20', 'monto': 2500.50},
        {'id': 3, 'nombre': 'Cotización Incrementa #003 - Cliente C', 'fecha': '2023-03-10', 'monto': 1200.75},
        {'id': 4, 'nombre': 'Cotización Incrementa #004 - Cliente A', 'fecha': '2023-04-01', 'monto': 3000.00},
        {'id': 5, 'nombre': 'Cotización Incrementa #005 - Cliente D', 'fecha': '2023-05-22', 'monto': 800.00},
        {'id': 6, 'nombre': 'Cotización Incrementa #006 - Cliente E', 'fecha': '2023-06-05', 'monto': 4500.00},
    ]

    # Add view and download URLs to dummy data
    from django.urls import reverse
    for quote in all_incrementa_quotes:
        quote['view_url'] = reverse('view_incrementa_pdf', args=[quote['id']])
        quote['download_url'] = reverse('download_incrementa_pdf', args=[quote['id']])

    search_query = request.GET.get('q', '')
    incrementa_quotes = all_incrementa_quotes

    if search_query:
        incrementa_quotes = [
            q for q in all_incrementa_quotes if search_query.lower() in q['nombre'].lower()
        ]

    context = {
        'coming_soon': False,
        'incrementa_quotes': incrementa_quotes,
        'search_query': search_query,
    }
    return render(request, 'incrementa.html', context)

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

# --- VISTA DE PRUEBA TEMPORAL ---
from django.http import HttpResponse

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
        'probabilidad_cierre': int(probabilidad_cierre),
        'producto': producto, # Use default or provided
        'comentarios': comentarios, # Use default or provided
        'bitrix_stage_id': bitrix_stage_id, # Use default or provided
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
        print(f"ERROR: Falló la sincronización con Bitrix24 para la oportunidad {oportunidad_nombre}: {e}")
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
            print(f"DEBUG: Detectada oportunidad inmediata desde sesión: {alert_data}")
        
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

def trigger_immediate_opportunity_notification(opportunity, request):
    """
    Crown Jewel Feature: Notifica inmediatamente a la sesión del usuario 
    sobre una nueva oportunidad creada, marcándola para detección inmediata
    """
    try:
        # Crear una entrada en la caché/session para que el frontend la detecte inmediatamente
        if hasattr(request, 'session'):
            session_key = f'new_opportunity_alert_{request.user.id}'
            request.session[session_key] = {
                'opportunity_id': opportunity.id,
                'titulo': opportunity.oportunidad,
                'cliente_id': opportunity.cliente.id if opportunity.cliente else None,
                'cliente_nombre': opportunity.cliente.nombre_empresa if opportunity.cliente else 'Sin cliente',
                'monto_estimado': str(opportunity.precio_estimado) if opportunity.precio_estimado else str(opportunity.monto) if opportunity.monto else 'N/A',
                'created_at': opportunity.created_at.isoformat() if opportunity.created_at else timezone.now().isoformat(),
                'user_id': opportunity.usuario.id if opportunity.usuario else request.user.id,
                'timestamp': timezone.now().timestamp()
            }
            # Marcar para que expire en 5 minutos
            request.session.set_expiry(300)
            print(f"DEBUG: Nueva oportunidad marcada para notificación inmediata: {opportunity.oportunidad}")
        
    except Exception as e:
        print(f"ERROR: No se pudo configurar notificación de oportunidad: {e}")


from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
@login_required
def sync_bitrix_manual(request):
    """
    Vista para que los supervisores ejecuten sincronización manual con Bitrix
    """
    # Verificar que el usuario sea supervisor
    if not is_supervisor(request.user):
        return JsonResponse({
            'success': False,
            'error': 'Solo los supervisores pueden ejecutar sincronización'
        })
    
    if request.method != 'POST':
        return JsonResponse({
            'success': False,
            'error': 'Método no permitido'
        })
    
    try:
        from django.core.management import call_command
        import io
        import sys
        from contextlib import redirect_stdout, redirect_stderr
        
        # Capturar la salida de los comandos
        stdout_buffer = io.StringIO()
        stderr_buffer = io.StringIO()
        
        results = {
            'success': [],
            'errors': [],
            'output': []
        }
        
        sync_commands = [
            ('sync_bitrix_users', 'Usuarios de Bitrix'),
            ('sync_bitrix', 'Empresas/Clientes'),
            ('sync_bitrix_contacts', 'Contactos'),
            ('import_bitrix_opportunities', 'Oportunidades')
        ]
        
        for command, description in sync_commands:
            try:
                stdout_buffer.seek(0)
                stdout_buffer.truncate(0)
                stderr_buffer.seek(0) 
                stderr_buffer.truncate(0)
                
                with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
                    call_command(command)
                
                output = stdout_buffer.getvalue()
                results['success'].append({
                    'command': command,
                    'description': description,
                    'output': output[:500]  # Limitar output
                })
                
            except Exception as e:
                error_output = stderr_buffer.getvalue()
                results['errors'].append({
                    'command': command,
                    'description': description,
                    'error': str(e),
                    'output': error_output[:500]
                })
        
        # Estadísticas finales
        from app.models import Cliente, TodoItem, UserProfile
        from django.contrib.auth.models import User
        
        stats = {
            'usuarios': User.objects.count(),
            'profiles_bitrix': UserProfile.objects.filter(bitrix_user_id__isnull=False).count(),
            'clientes': Cliente.objects.count(),
            'oportunidades': TodoItem.objects.count()
        }
        
        return JsonResponse({
            'success': True,
            'message': f'Sincronización completada: {len(results["success"])} exitosos, {len(results["errors"])} errores',
            'results': results,
            'stats': stats
        })
        
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Error general en sincronización: {str(e)}'
        })

@login_required
def search_clientes_api(request):
    """
    API endpoint para buscar clientes por nombre de empresa.
    Permite búsqueda parcial insensible a mayúsculas y minúsculas.
    """
    query = request.GET.get('q', '').strip()
    
    if not query or len(query) < 2:
        return JsonResponse({'clientes': []})
    
    try:
        # Filtrar clientes basado en permisos del usuario
        if is_supervisor(request.user):
            # Supervisores pueden ver todos los clientes
            clientes_queryset = Cliente.objects.filter(
                nombre_empresa__icontains=query
            ).order_by('nombre_empresa')[:20]  # Limitar a 20 resultados
        else:
            # Usuarios normales solo ven sus clientes asignados
            clientes_queryset = Cliente.objects.filter(
                asignado_a=request.user,
                nombre_empresa__icontains=query
            ).order_by('nombre_empresa')[:20]
        
        # Serializar los resultados
        clientes_data = []
        for cliente in clientes_queryset:
            clientes_data.append({
                'id': cliente.id,
                'nombre_empresa': cliente.nombre_empresa,
                'contacto_principal': cliente.contacto_principal,
                'email': cliente.email,
                'telefono': cliente.telefono,
            })
        
        return JsonResponse({
            'clientes': clientes_data,
            'total': len(clientes_data)
        })
        
    except Exception as e:
        print(f"ERROR: Error en búsqueda de clientes: {e}")
        return JsonResponse({
            'clientes': [],
            'error': 'Error interno del servidor'
        }, status=500)

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
        
        print(f"DEBUG Bot: Usuario Django {request.user.username} → Bitrix ID {user_bitrix_id}")
        print(f"DEBUG Bot: Encontradas {len(user_deals)} oportunidades para este usuario de {len(bitrix_deals)} totales")
        
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
                            print(f"Error obteniendo datos de compañía: {e}")
                    
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
        
        print(f"DEBUG Bot: Encontradas {len(recent_deals)} nuevas oportunidades desde Bitrix24")
        
        return JsonResponse({
            'success': True,
            'new_opportunities': recent_deals,
            'count': len(recent_deals),
            'last_check': django_timezone.now().timestamp() * 1000  # Nuevo timestamp
        })
        
    except Exception as e:
        print(f"ERROR Bot: Error al verificar oportunidades desde Bitrix24: {e}")
        return JsonResponse({
            'success': False,
            'error': f'Error al verificar oportunidades desde Bitrix24: {str(e)}'
        }, status=500)


@login_required
def volumetria(request):
    """
    Vista para la sección de Volumetría - Solo para ingenieros y superusuarios
    """
    # Verificar permisos: solo ingenieros y superusuarios
    if not (is_engineer(request.user) or request.user.is_superuser):
        messages.error(request, "No tienes permisos para acceder a esta sección.")
        return redirect('home')
    
    # Obtener datos de oportunidad de la sesión si existen
    oportunidad_data = request.session.get('volumetria_oportunidad_data', None)
    
    context = {
        'page_title': 'Volumetría',
        'user_role': 'Ingeniero' if is_engineer(request.user) else 'Superusuario',
        'oportunidad_data': oportunidad_data
    }
    
    return render(request, 'volumetria.html', context)

@login_required
def crear_volumetria_with_opportunity(request, oportunidad_id):
    """
    Vista para crear volumetría desde una oportunidad específica
    """
    # Verificar permisos: solo ingenieros y superusuarios
    if not (is_engineer(request.user) or request.user.is_superuser):
        messages.error(request, "No tienes permisos para crear volumetrías.")
        return redirect('home')
    
    try:
        # Obtener la oportunidad
        oportunidad = get_object_or_404(TodoItem, pk=oportunidad_id)
        
        # Verificar que el usuario tenga acceso a esta oportunidad
        if not is_supervisor(request.user) and oportunidad.usuario != request.user:
            messages.error(request, "No tienes permisos para acceder a esta oportunidad.")
            return redirect('todos')
        
        print(f"DEBUG: Creando volumetría para oportunidad {oportunidad.id}: {oportunidad.oportunidad}")
        
        # Guardar datos de la oportunidad en la sesión
        request.session['volumetria_oportunidad_data'] = {
            'oportunidad_id': oportunidad.id,
            'oportunidad_nombre': oportunidad.oportunidad,
            'cliente_id': oportunidad.cliente.id if oportunidad.cliente else None,
            'cliente_nombre': oportunidad.cliente.nombre_empresa if oportunidad.cliente else None,
            'monto': float(oportunidad.monto) if oportunidad.monto else 0,
            'timestamp': timezone.now().timestamp()
        }
        
        # Marcar para autostart de volumetría general
        request.session['auto_start_volumetria_general'] = True
        
        # Configurar expiración de la sesión para 30 minutos
        request.session.set_expiry(1800)  # 30 minutos
        
        # messages.success(request, f'Generando volumetría integral para la oportunidad "{oportunidad.oportunidad}".')
        
        # Redirigir a la sección de volumetrías (ahora irá directo a volumetría general)
        return redirect('volumetria')
        
    except Exception as e:
        print(f"ERROR: Error al procesar oportunidad para volumetría: {str(e)}")
        messages.error(request, "Error al cargar los datos de la oportunidad.")
        return redirect('todos')

@csrf_exempt
@login_required
def generar_pdf_volumetria(request):
    """
    Vista para generar el PDF de una volumetría
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        # Verificar permisos
        if not (is_engineer(request.user) or request.user.is_superuser):
            return JsonResponse({'error': 'No tienes permisos para generar PDFs de volumetría'}, status=403)
        
        # Parsear datos JSON
        data = json.loads(request.body)
        print(f"DEBUG: Datos recibidos para PDF volumetría: {data}")
        
        # Obtener información del cliente y oportunidad si están disponibles
        cliente_nombre = "No especificado"
        oportunidad_nombre = "Sin oportunidad asignada"
        vendedor_responsable = None  # Para el responsable del proyecto
        
        if data.get('cliente_id'):
            try:
                cliente = Cliente.objects.get(id=data['cliente_id'])
                cliente_nombre = cliente.nombre_empresa
            except Cliente.DoesNotExist:
                pass
        
        if data.get('oportunidad_id'):
            try:
                oportunidad = TodoItem.objects.get(id=data['oportunidad_id'])
                oportunidad_nombre = oportunidad.oportunidad
                vendedor_responsable = oportunidad.usuario  # Obtener el vendedor responsable
                print(f"DEBUG: Vendedor responsable de la oportunidad: {vendedor_responsable.get_full_name() if vendedor_responsable else 'No definido'}")
            except TodoItem.DoesNotExist:
                pass
        
        # 1. VERIFICAR SI YA EXISTE UN PROYECTO PARA ESTA OPORTUNIDAD
        project_id = None
        carpeta_volumetrias_id = None
        oportunidad_proyecto = None
        oportunidad = None
        
        # Si hay una oportunidad asociada, verificar si ya existe un proyecto
        if data.get('oportunidad_id'):
            try:
                from .models import OportunidadProyecto
                oportunidad = TodoItem.objects.get(id=data['oportunidad_id'])
                
                # Buscar si ya existe un proyecto para esta oportunidad
                try:
                    oportunidad_proyecto = OportunidadProyecto.objects.get(oportunidad=oportunidad)
                    project_id = oportunidad_proyecto.bitrix_project_id
                    carpeta_volumetrias_id = oportunidad_proyecto.carpeta_volumetrias_id
                    
                    # Incrementar contador de volumetrías
                    oportunidad_proyecto.volumetrias_generadas += 1
                    oportunidad_proyecto.save()
                    
                    print(f"DEBUG: Proyecto existente encontrado: ID {project_id}")
                    print(f"DEBUG: Esta será la volumetría #{oportunidad_proyecto.volumetrias_generadas} para este proyecto")
                    
                except OportunidadProyecto.DoesNotExist:
                    print(f"DEBUG: No existe proyecto para oportunidad {data['oportunidad_id']}, se creará uno nuevo")
                    
            except TodoItem.DoesNotExist:
                print(f"WARNING: Oportunidad {data['oportunidad_id']} no encontrada")
                oportunidad = None
        
        # 2. Si NO existe proyecto, crear uno nuevo en Bitrix24
        if not project_id:
            project_name = data.get('nombre_volumetria', 'Análisis Volumétrico')
            project_description = f"""
Proyecto automatizado desde Nethive para volumetría: {project_name}

Cliente: {cliente_nombre}
Oportunidad: {oportunidad_nombre}
Elaborado por: {data.get('elaborado_por', request.user.get_full_name() or request.user.username)}
Fecha: {data.get('fecha', convert_to_tijuana_time(datetime.now()).strftime('%d/%m/%Y'))}

Categoría: {data.get('categoria', 'CAT6')}
Cantidad de nodos: {data.get('cantidad_nodos', 1)}
Total: ${float(data.get('total', 0)):,.2f} USD

Este proyecto contiene la documentación técnica y volumetría del proyecto.
                """.strip()

            try:
                from .bitrix_integration import create_bitrix_project
                project_id = create_bitrix_project(
                    project_name=project_name,
                    description=project_description,
                    vendedor_responsable=vendedor_responsable,
                    request=request
                )
                
                if project_id:
                    print(f"DEBUG: Nuevo proyecto Bitrix24 creado exitosamente: ID {project_id}")
                    
                    # Crear registro en OportunidadProyecto si hay oportunidad
                    if data.get('oportunidad_id') and oportunidad:
                        try:
                            from .models import OportunidadProyecto
                            oportunidad_proyecto = OportunidadProyecto.objects.create(
                                oportunidad=oportunidad,
                                bitrix_project_id=project_id,
                                bitrix_deal_id=str(oportunidad.bitrix_deal_id) if oportunidad.bitrix_deal_id else None,
                                proyecto_nombre=project_name,
                                created_by=request.user,
                                volumetrias_generadas=1
                            )
                            print(f"DEBUG: Registro OportunidadProyecto creado: ID {oportunidad_proyecto.id}")
                        except Exception as e:
                            print(f"WARNING: Error creando registro OportunidadProyecto: {e}")
                else:
                    print("WARNING: No se pudo crear el proyecto en Bitrix24. La volumetría no se adjuntará al proyecto.")

            except Exception as e:
                print(f"WARNING: Error al intentar crear el proyecto en Bitrix24: {e}")
                project_id = None # Asegurar que project_id sea None si la creación falla

        # Calcular valores financieros (estos dependen de los datos de la volumetría, no del proyecto)
        subtotal = float(data.get('subtotal', 0))
        iva_rate = 0.16  # 16% IVA por defecto
        iva = subtotal * iva_rate
        total = subtotal + iva
        
        # Calcular métricas de rentabilidad basadas en los items
        items = data.get('items', [])
        total_costo_proveedor = sum(float(item.get('total_proveedor', 0)) for item in items)
        ganancia_total = subtotal - total_costo_proveedor
        margen_utilidad = (ganancia_total / total_costo_proveedor * 100) if total_costo_proveedor > 0 else 0
        
        cantidad_nodos = int(data.get('cantidad_nodos', 1))
        precio_por_nodo = total / cantidad_nodos if cantidad_nodos > 0 else 0
        costo_por_nodo = total_costo_proveedor / cantidad_nodos if cantidad_nodos > 0 else 0
        
        # Preparar contexto para el template
        context = {
            'volumetria': {
                'nombre_volumetria': data.get('nombre_volumetria', 'Análisis Volumétrico'),
                'cliente_nombre': cliente_nombre,
                'usuario_final': data.get('usuario_final', ''),
                'oportunidad_nombre': oportunidad_nombre,
                'elaborado_por': data.get('elaborado_por', request.user.get_full_name() or request.user.username),
                'fecha': data.get('fecha', convert_to_tijuana_time(datetime.now()).strftime('%d/%m/%Y')),
                'categoria': data.get('categoria', 'CAT6'),
                'color': data.get('color', 'Azul'),
                'cantidad_nodos': cantidad_nodos,
                'distancia': data.get('distancia', 0),
                'subtotal': subtotal,
                'iva': iva,
                'total': total,
                'precio_por_nodo': precio_por_nodo,
                'costo_por_nodo': costo_por_nodo,
                'ganancia_total': ganancia_total,
                'margen_utilidad': margen_utilidad,
                'items': data.get('items', [])
            },
            'logo_base64': get_logo_base64(),
            'current_date': convert_to_tijuana_time(datetime.now()).strftime('%d/%m/%Y')
        }
        
        # Renderizar template HTML
        html_string = render_to_string('volumetria_pdf_template.html', context)
        
        # Generar PDF usando WeasyPrint
        pdf_file = HTML(string=html_string).write_pdf()
        
        # 3. GUARDAR VOLUMETRÍA EN LA BASE DE DATOS
        volumetria_record = None
        if oportunidad:  # Solo si tenemos una oportunidad
            try:
                # Crear registro de volumetría
                volumetria_record = Volumetria.objects.create(
                    titulo=data.get('nombre_volumetria', 'Análisis Volumétrico'),
                    cliente_id=data.get('cliente_id') if data.get('cliente_id') else oportunidad.cliente.id,
                    usuario_final=data.get('usuario_final', ''),
                    oportunidad=oportunidad,
                    categoria=data.get('categoria', 'CAT6'),
                    color=data.get('color', 'Azul'),
                    cantidad_nodos=cantidad_nodos,
                    distancia=Decimal(str(data.get('distancia', 0))),
                    subtotal=Decimal(str(subtotal)),
                    iva_rate=Decimal(str(iva_rate)),
                    iva_amount=Decimal(str(iva)),
                    total=Decimal(str(total)),
                    moneda='USD',
                    total_costo_proveedor=Decimal(str(total_costo_proveedor)),
                    ganancia_total=Decimal(str(ganancia_total)),
                    margen_utilidad=Decimal(str(margen_utilidad)),
                    precio_por_nodo=Decimal(str(precio_por_nodo)),
                    costo_por_nodo=Decimal(str(costo_por_nodo)),
                    pdf_content=pdf_file,
                    bitrix_project_id=project_id,
                    elaborado_por=data.get('elaborado_por', request.user.get_full_name() or request.user.username),
                    created_by=request.user if request.user.is_authenticated else None
                )
                
                # Crear detalles de volumetría
                for item in items:
                    DetalleVolumetria.objects.create(
                        volumetria=volumetria_record,
                        nombre_producto=item.get('nombre', ''),
                        descripcion=item.get('descripcion', ''),
                        cantidad=int(item.get('cantidad', 1)),
                        precio_unitario=Decimal(str(item.get('precio_unitario', 0))),
                        precio_proveedor=Decimal(str(item.get('precio_proveedor', 0))),
                        total=Decimal(str(item.get('total', 0))),
                        total_proveedor=Decimal(str(item.get('total_proveedor', 0)))
                    )
                
                print(f"DEBUG: Volumetría guardada en BD con ID: {volumetria_record.id}")
                
            except Exception as e:
                print(f"WARNING: Error guardando volumetría en BD: {e}")
        
        # 4. Si el proyecto fue creado, subir el PDF de la volumetría a su drive
        # Definir filename con numeración única para proyectos reutilizados
        if project_id:
            if oportunidad_proyecto and oportunidad_proyecto.volumetrias_generadas > 1:
                # Proyecto reutilizado - usar numeración
                filename = f"Volumetria_Proyecto_{project_id}_V{oportunidad_proyecto.volumetrias_generadas}.pdf"
            else:
                # Proyecto nuevo o primera volumetría
                filename = f"Volumetria_Proyecto_{project_id}.pdf"
        else:
            filename = "Volumetria_SinProyecto.pdf"
        
        # NUEVO SISTEMA: Subida en background + opción manual
        if project_id:
            print(f"DEBUG: Proyecto {project_id} creado exitosamente.")
            print(f"DEBUG: Guardando archivo para subida en background...")
            
            # Guardar el archivo en la base de datos para subida posterior
            try:
                from .models import PendingFileUpload
                
                pending_upload = PendingFileUpload.objects.create(
                    project_id=project_id,
                    filename=filename,
                    file_content=pdf_file,
                    file_size=len(pdf_file),
                    created_by=request.user if request.user.is_authenticated else None,
                    oportunidad_id=data.get('oportunidad_id')
                )
                
                print(f"DEBUG: Archivo guardado para subida (ID: {pending_upload.id})")
                
                # Iniciar tarea en background
                def upload_file_in_background(volumetrias_folder_id_to_use=None):
                    import time
                    print(f"DEBUG BACKGROUND: Iniciando tarea de subida para proyecto {project_id} con folder_id {volumetrias_folder_id_to_use}")
                    
                    # Esperar 10 segundos para que el proyecto esté completamente creado en Bitrix24
                    time.sleep(10)
                    
                    try:
                        from .models import PendingFileUpload, OportunidadProyecto
                        from .bitrix_integration import upload_file_to_project_drive
                        import base64
                        
                        # Obtener el registro pendiente
                        upload_record = PendingFileUpload.objects.get(id=pending_upload.id)
                        
                        if upload_record.status != 'pending':
                            print(f"DEBUG BACKGROUND: Archivo ya procesado ({upload_record.status})")
                            return
                        
                        # Marcar como en progreso
                        upload_record.status = 'in_progress'
                        upload_record.attempts += 1
                        upload_record.save()
                        
                        print(f"DEBUG BACKGROUND: Iniciando subida (intento {upload_record.attempts})")
                        
                        # Codificar archivo
                        pdf_base64 = base64.b64encode(upload_record.file_content).decode('utf-8')
                        
                        # Intentar subir, pasando el ID de la carpeta si existe
                        success, returned_folder_id = upload_file_to_project_drive(
                            project_id=upload_record.project_id,
                            file_name=upload_record.filename,
                            file_content_base64=pdf_base64,
                            request=None,
                            volumetrias_folder_id=volumetrias_folder_id_to_use
                        )
                        
                        if success:
                            upload_record.status = 'success'
                            upload_record.completed_at = timezone.now()
                            print(f"SUCCESS BACKGROUND: Archivo subido exitosamente al proyecto {project_id}")

                            # Si la subida fue exitosa y se creó una nueva carpeta, guardamos su ID
                            if returned_folder_id and not volumetrias_folder_id_to_use:
                                try:
                                    op_proyecto = OportunidadProyecto.objects.get(bitrix_project_id=upload_record.project_id)
                                    op_proyecto.carpeta_volumetrias_id = returned_folder_id
                                    op_proyecto.save(update_fields=['carpeta_volumetrias_id'])
                                    print(f"SUCCESS BACKGROUND: ID de carpeta de volumetrías ({returned_folder_id}) guardado.")
                                except OportunidadProyecto.DoesNotExist:
                                    print(f"ERROR BACKGROUND: No se encontró OportunidadProyecto para guardar el ID de la carpeta.")
                                except Exception as e:
                                    print(f"ERROR BACKGROUND: No se pudo guardar el ID de la carpeta: {e}")
                        else:
                            upload_record.status = 'failed'
                            upload_record.error_message = "La función upload_file_to_project_drive retornó False o un error."
                            print(f"ERROR BACKGROUND: Falló la subida al proyecto {project_id}")
                        
                        upload_record.save()
                        
                    except Exception as e:
                        print(f"ERROR BACKGROUND: Excepción en subida: {e}")
                        try:
                            upload_record.status = 'failed'
                            upload_record.error_message = str(e)
                            upload_record.save()
                        except:
                            pass
                
                # Ejecutar en hilo separado, pasando el ID de la carpeta
                import threading
                upload_thread = threading.Thread(target=upload_file_in_background, kwargs={'volumetrias_folder_id_to_use': carpeta_volumetrias_id})
                upload_thread.daemon = True
                upload_thread.start()
                
                print(f"INFO: Tarea de subida en background iniciada para proyecto {project_id}")
                print(f"INFO: El PDF se descargará inmediatamente. La subida se procesará en segundo plano.")
                
            except Exception as e:
                print(f"WARNING: Error creando tarea de subida en background: {e}")
                print(f"INFO: El PDF se descargará normalmente.")
        
        # Crear respuesta HTTP con el PDF
        response = HttpResponse(pdf_file, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        
        print(f"DEBUG: PDF de volumetría generado exitosamente: {filename}")
        return response
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Datos JSON inválidos'}, status=400)
    except Exception as e:
        print(f"ERROR: Error generando PDF de volumetría: {str(e)}")
        return JsonResponse({'error': f'Error interno del servidor: {str(e)}'}, status=500)


@login_required
def view_volumetria_pdf(request, volumetria_id):
    """
    Vista para mostrar el PDF de una volumetría en el navegador
    """
    volumetria = get_object_or_404(Volumetria, id=volumetria_id)
    
    # Verificar permisos
    if not (is_supervisor(request.user) or volumetria.created_by == request.user or volumetria.oportunidad.usuario == request.user):
        return HttpResponse("No tienes permisos para ver esta volumetría.", status=403)
    
    if not volumetria.pdf_content:
        return HttpResponse("PDF no disponible para esta volumetría.", status=404)
    
    response = HttpResponse(volumetria.pdf_content, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{volumetria.get_filename()}"'
    return response

@login_required
def download_volumetria_pdf(request, volumetria_id):
    """
    Vista para descargar el PDF de una volumetría
    """
    volumetria = get_object_or_404(Volumetria, id=volumetria_id)
    
    # Verificar permisos
    if not (is_supervisor(request.user) or volumetria.created_by == request.user or volumetria.oportunidad.usuario == request.user):
        return HttpResponse("No tienes permisos para descargar esta volumetría.", status=403)
    
    if not volumetria.pdf_content:
        return HttpResponse("PDF no disponible para esta volumetría.", status=404)
    
    response = HttpResponse(volumetria.pdf_content, content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{volumetria.get_filename()}"'
    return response

@login_required
@require_http_methods(["POST"])
def eliminar_volumetria(request, volumetria_id):
    """
    Vista para eliminar una volumetría
    """
    try:
        volumetria = get_object_or_404(Volumetria, id=volumetria_id)
        
        # Verificar permisos - solo supervisores o el creador pueden eliminar
        if not (is_supervisor(request.user) or volumetria.created_by == request.user):
            return JsonResponse({'success': False, 'error': 'No tienes permisos para eliminar esta volumetría'}, status=403)
        
        # Guardar información antes de eliminar
        titulo = volumetria.titulo
        oportunidad_id = volumetria.oportunidad.id
        
        # Eliminar la volumetría (los detalles se eliminan automáticamente por cascade)
        volumetria.delete()
        
        return JsonResponse({
            'success': True, 
            'message': f'Volumetría "{titulo}" eliminada exitosamente',
            'redirect_url': f'/app/cotizaciones/oportunidad/{oportunidad_id}/?tipo=volumetrias'
        })
        
    except Volumetria.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Volumetría no encontrada'}, status=404)
    except Exception as e:
        return JsonResponse({'success': False, 'error': f'Error interno: {str(e)}'}, status=500)

def get_logo_base64():
    """
    Función auxiliar para obtener el logo en base64
    """
    try:
        logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'img', 'bajanet_logo.png')
        with open(logo_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    except FileNotFoundError:
        return ""

@csrf_exempt
@login_required
def limpiar_datos_oportunidad_volumetria(request):
    """
    Vista para limpiar los datos de oportunidad de la sesión
    """
    if request.method == 'POST':
        try:
            # Limpiar datos de la sesión
            if 'volumetria_oportunidad_data' in request.session:
                del request.session['volumetria_oportunidad_data']
                print("DEBUG: Datos de oportunidad limpiados de la sesión")
            
            return JsonResponse({'success': True, 'message': 'Datos limpiados correctamente'})
        except Exception as e:
            print(f"ERROR: Error limpiando datos de oportunidad: {str(e)}")
            return JsonResponse({'success': False, 'error': str(e)}, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)

@csrf_exempt
@login_required
def crear_cotizacion_desde_volumetria(request):
    """
    Vista para crear cotización automáticamente desde una volumetría
    """
    print(f"DEBUG: === INICIO crear_cotizacion_desde_volumetria ===")
    print(f"DEBUG: Método: {request.method}")
    
    if request.method != 'POST':
        print(f"ERROR: Método no permitido: {request.method}")
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    print(f"DEBUG: Llegamos después del check de método")
    
    try:
        print(f"DEBUG: Intentando acceder a request.body...")
        body = request.body
        print(f"DEBUG: Request body obtenido, tipo: {type(body)}, tamaño: {len(body) if body else 'None'}")
        try:
            print(f"DEBUG: Request body preview: {str(body)[:200]}...")  # Solo primeros 200 caracteres
        except:
            print(f"DEBUG: No se puede mostrar el body, pero existe")
        
        print(f"DEBUG: About to parse JSON")
        data = json.loads(body)
    except Exception as body_error:
        print(f"ERROR: Error accediendo al request.body: {body_error}")
        return JsonResponse({'success': False, 'error': f'Error en request body: {str(body_error)}'}, status=400)
    print(f"DEBUG: JSON parseado exitosamente")
    print(f"DEBUG: Tipo de data: {type(data)}")
    print(f"DEBUG: Keys en data: {list(data.keys()) if isinstance(data, dict) else 'No es dict'}")
    # Comentado temporalmente: print(f"DEBUG: Creando cotización desde volumetría: {data}")
    print(f"DEBUG: Iniciando validaciones...")
    print(f"DEBUG: cliente_id en data: {data.get('cliente_id')}")
    print(f"DEBUG: oportunidadId en data: {data.get('oportunidadId')}")
    
    try:
        
        if not data.get('cliente_id'):
            return JsonResponse({'success': False, 'error': 'Cliente requerido'})
        
        if not data.get('items') or len(data.get('items', [])) == 0:
            return JsonResponse({'success': False, 'error': 'Items requeridos'})
        
        cliente = get_object_or_404(Cliente, id=data['cliente_id'])
        
        oportunidad = None
        if data.get('oportunidadId'):
            oportunidad = TodoItem.objects.filter(id=data['oportunidadId']).first()
        
        vendedor_responsable = request.user
        if oportunidad and oportunidad.usuario:
            vendedor_responsable = oportunidad.usuario
        
        cotizacion = Cotizacion.objects.create(
            cliente=cliente,
            nombre_cotizacion=data.get('nombreVolumetria', 'Cotización desde Volumetría'),
            descripcion=f"Cotización generada automáticamente desde volumetría por {request.user.get_full_name() or request.user.username}",
            usuario_final=data.get('usuarioFinal', ''),
            iva_rate=Decimal('0.16'), # Asumir 16% por ahora
            moneda='USD',
            created_by=vendedor_responsable,
            oportunidad=oportunidad,
            bitrix_deal_id=oportunidad.bitrix_deal_id if oportunidad else None
        )
        
        total_cotizacion = Decimal('0')
        for item_data in data['items']:
            try:
                precio_unitario = Decimal(str(item_data.get('precio_cliente', 0)))
                cantidad = int(item_data.get('cantidad', 1))
                descuento = Decimal(str(item_data.get('descuento_cliente', 0)))
                
                precio_con_descuento = precio_unitario * (1 - descuento / 100)
                total_item = precio_con_descuento * cantidad
                
                DetalleCotizacion.objects.create(
                    cotizacion=cotizacion,
                    no_parte=item_data.get('numero_parte', ''),
                    descripcion=item_data.get('descripcion', ''),
                    cantidad=cantidad,
                    precio_unitario=precio_unitario,
                    descuento_porcentaje=descuento,
                    precio_con_descuento=precio_con_descuento,
                    total=total_item
                )
                
                total_cotizacion += total_item
                
            except (ValueError, TypeError, decimal.InvalidOperation) as e:
                print(f"ERROR: Error procesando item {item_data}: {str(e)}")
                continue
        
        cotizacion.subtotal = total_cotizacion
        cotizacion.iva_amount = (cotizacion.subtotal * cotizacion.iva_rate).quantize(Decimal('0.01'))
        cotizacion.total = (cotizacion.subtotal + cotizacion.iva_amount).quantize(Decimal('0.01'))
        cotizacion.save()
        
        # El comentario automático se creará cuando se visite la página de cotizaciones por oportunidad
        from django.urls import reverse
        pdf_url = request.build_absolute_uri(reverse('generate_cotizacion_pdf', args=[cotizacion.id]))
        bitrix_comentario = False
        
        print(f"DEBUG: Verificando condiciones para Bitrix24:")
        print(f"DEBUG: - Oportunidad existe: {oportunidad is not None}")
        if oportunidad:
            print(f"DEBUG: - Oportunidad ID: {oportunidad.id}")
            print(f"DEBUG: - Bitrix Deal ID: {oportunidad.bitrix_deal_id}")
        
        if oportunidad and oportunidad.bitrix_deal_id:
            # Generar PDF y adjuntarlo a Bitrix24
            print(f"DEBUG: Intentando adjuntar cotización a Bitrix24 deal {oportunidad.bitrix_deal_id}")
            try:
                from django.http import HttpRequest
                from django.test import RequestFactory
                
                # Crear una petición temporal para generar el PDF
                factory = RequestFactory()
                pdf_request = factory.get(f'/app/cotizacion/{cotizacion.id}/pdf/')
                pdf_request.user = request.user
                
                # Generar el PDF
                print(f"DEBUG: Generando PDF para cotización {cotizacion.id}")
                # from . import views_exportar # Removed as generate_cotizacion_pdf is in this file
                pdf_response = generate_cotizacion_pdf(pdf_request, cotizacion.id)
                print(f"DEBUG: PDF generado con status {pdf_response.status_code}")
                
                if pdf_response.status_code == 200:
                    # Convertir PDF a base64
                    import base64
                    pdf_content = pdf_response.content
                    pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
                    
                    # Nombre del archivo
                    pdf_filename = f"Cotizacion_{cotizacion.nombre_cotizacion}_{cotizacion.id}.pdf"
                    
                    # Comentario para Bitrix
                    comentario_texto = f"""
📋 Cotización Automática desde Volumetría

Cotización: {cotizacion.nombre_cotizacion}
Total: ${float(total_cotizacion):.2f} USD
Generada por: {request.user.get_full_name() or request.user.username}
Fecha: {convert_to_tijuana_time(timezone.now()).strftime('%d/%m/%Y %H:%M')}

Volumetría origen: {data.get('volumetria_nombre', 'N/A')}

🔗 Creada automáticamente desde el sistema Nethive
                    """.strip()
                    
                    # Subir a Bitrix24
                    print(f"DEBUG: Subiendo PDF '{pdf_filename}' a Bitrix24 deal {oportunidad.bitrix_deal_id}")
                    from .bitrix_integration import add_comment_with_attachment_to_deal
                    resultado_bitrix = add_comment_with_attachment_to_deal(
                        deal_id=oportunidad.bitrix_deal_id,
                        file_name=pdf_filename,
                        file_content_base64=pdf_base64,
                        comment_text=comentario_texto,
                        request=request
                    )
                    print(f"DEBUG: Resultado de subida a Bitrix24: {resultado_bitrix}")
                    
                    if resultado_bitrix:
                        bitrix_comentario = True
                        print(f"SUCCESS: PDF de cotización adjuntado a Bitrix24 deal {oportunidad.bitrix_deal_id}")
                    else:
                        print(f"ERROR: No se pudo adjuntar PDF a Bitrix24 deal {oportunidad.bitrix_deal_id}")
                        
                else:
                    print(f"ERROR: No se pudo generar PDF. Status: {pdf_response.status_code}")
                    
            except Exception as e:
                print(f"ERROR: Excepción adjuntando PDF a Bitrix24: {str(e)}")
                bitrix_comentario = False
        else:
            if not oportunidad:
                print("DEBUG: No hay oportunidad, no se puede adjuntar a Bitrix24")
            elif not oportunidad.bitrix_deal_id:
                print("DEBUG: La oportunidad no tiene bitrix_deal_id, no se puede adjuntar a Bitrix24")

        return JsonResponse({
            'success': True,
            'cotizacion_id': cotizacion.id,
            'cotizacion_nombre': cotizacion.nombre_cotizacion,
            'cotizacion_url': pdf_url,
            'total_cotizacion': float(total_cotizacion),
            'bitrix_comentario': bitrix_comentario,
            'pdf_generado': True,
            'message': 'Cotización creada exitosamente desde volumetría'
        })
        
    except Exception as e:
        import traceback
        print(f"ERROR: Error creando cotización desde volumetría: {str(e)}")
        print(f"ERROR: Traceback completo: {traceback.format_exc()}")
        return JsonResponse({'success': False, 'error': f'Error interno: {str(e)}'}, status=500)

@login_required
def get_session_data(request):
    """
    Endpoint para obtener datos almacenados en la sesión (usado por volumetría)
    """
    try:
        session_data = {
            'volumetria_oportunidad_data': request.session.get('volumetria_oportunidad_data'),
            'auto_start_volumetria_general': request.session.get('auto_start_volumetria_general', False),
        }
        
        # Limpiar el flag de auto-start después de leerlo para evitar bucles
        if 'auto_start_volumetria_general' in request.session:
            del request.session['auto_start_volumetria_general']
        
        return JsonResponse(session_data)
    except Exception as e:
        print(f"ERROR: Error obteniendo datos de sesión: {str(e)}")
        return JsonResponse({'error': 'Error obteniendo datos de sesión'}, status=500)

@login_required
def get_opportunities_by_client_api(request, cliente_id):
    """
    Endpoint para obtener oportunidades de un cliente específico (usado por volumetría)
    """
    try:
        cliente = get_object_or_404(Cliente, pk=cliente_id)
        
        # Filtrar oportunidades por cliente
        oportunidades = TodoItem.objects.filter(cliente=cliente).order_by('-fecha_creacion')
        
        # Si no es supervisor, solo mostrar las propias oportunidades
        if not is_supervisor(request.user):
            oportunidades = oportunidades.filter(usuario=request.user)
        
        # Serializar las oportunidades
        oportunidades_data = []
        for oportunidad in oportunidades:
            oportunidades_data.append({
                'id': oportunidad.id,
                'oportunidad': oportunidad.oportunidad,
                'monto': float(oportunidad.monto) if oportunidad.monto else 0,
                'mes_cierre': oportunidad.get_mes_cierre_display(),
                'probabilidad_cierre': oportunidad.probabilidad_cierre,
            })
        
        return JsonResponse(oportunidades_data, safe=False)
        
    except Exception as e:
        print(f"ERROR: Error obteniendo oportunidades por cliente: {str(e)}")
        return JsonResponse({'error': 'Error obteniendo oportunidades'}, status=500)

@login_required
def get_client_by_opportunity_api(request, oportunidad_id):
    """
    API para obtener datos del cliente (incluyendo categoría) de una oportunidad específica
    Usado para auto-detectar cliente cuando se selecciona oportunidad en volumetría
    """
    try:
        oportunidad = get_object_or_404(TodoItem, pk=oportunidad_id)
        
        # Verificar que el usuario tenga acceso a esta oportunidad
        if not is_supervisor(request.user) and oportunidad.usuario != request.user:
            return JsonResponse({'error': 'Acceso denegado'}, status=403)
        
        if not oportunidad.cliente:
            return JsonResponse({'error': 'Esta oportunidad no tiene cliente asignado'}, status=400)
        
        cliente = oportunidad.cliente
        cliente_data = {
            'id': cliente.id,
            'nombre_empresa': cliente.nombre_empresa,
            'categoria': cliente.categoria,
            'porcentaje_utilidad': 15 if cliente.categoria == 'A' else 20 if cliente.categoria == 'B' else 25
        }
        
        return JsonResponse(cliente_data)
        
    except Exception as e:
        print(f"ERROR: Error obteniendo cliente por oportunidad: {str(e)}")
        return JsonResponse({'error': 'Error obteniendo datos del cliente'}, status=500)

# ===============================================
# NUEVAS FUNCIONES PARA SUBIDA MANUAL DE ARCHIVOS
# ===============================================

@login_required
def pending_file_uploads(request):
    """
    Vista para mostrar archivos pendientes de subir al usuario
    """
    if request.user.is_authenticated:
        # Si es supervisor, ver todos los archivos
        if is_supervisor(request.user):
            uploads = PendingFileUpload.objects.all()
        else:
            # Si no, solo los propios
            uploads = PendingFileUpload.objects.filter(created_by=request.user)
    else:
        uploads = PendingFileUpload.objects.none()
    
    return render(request, 'pending_file_uploads.html', {
        'uploads': uploads
    })

@login_required
def retry_file_upload(request, upload_id):
    """
    Endpoint para reintentar la subida manual de un archivo
    """
    if request.method == 'POST':
        try:
            upload = get_object_or_404(PendingFileUpload, id=upload_id)
            
            # Verificar permisos
            if not is_supervisor(request.user) and upload.created_by != request.user:
                return JsonResponse({'error': 'Sin permisos para este archivo'}, status=403)
            
            # Verificar que no se exceda el máximo de intentos
            if upload.attempts >= upload.max_attempts:
                return JsonResponse({'error': 'Máximo de intentos excedido'}, status=400)
            
            # Marcar como en progreso
            upload.status = 'in_progress'
            upload.attempts += 1
            upload.error_message = None
            upload.save()
            
            print(f"DEBUG MANUAL: Reintentando subida manual para archivo {upload.filename}")
            
            # Ejecutar subida en background para no bloquear la respuesta
            def manual_upload_background():
                import time
                time.sleep(2)  # Pequeña pausa
                
                try:
                    from .models import OportunidadProyecto, TodoItem
                    from .bitrix_integration import upload_file_to_project_drive
                    import base64

                    # Obtener el ID de la carpeta de volumetrías si existe
                    volumetrias_folder_id = None
                    if upload.oportunidad_id:
                        try:
                            oportunidad = TodoItem.objects.get(id=upload.oportunidad_id)
                            oportunidad_proyecto = OportunidadProyecto.objects.get(oportunidad=oportunidad)
                            volumetrias_folder_id = oportunidad_proyecto.carpeta_volumetrias_id
                            print(f"DEBUG MANUAL: Carpeta de volumetrías encontrada para reintento: {volumetrias_folder_id}")
                        except (TodoItem.DoesNotExist, OportunidadProyecto.DoesNotExist):
                            print(f"DEBUG MANUAL: No se encontró OportunidadProyecto para la oportunidad {upload.oportunidad_id}. Se subirá a la raíz del proyecto.")
                        except Exception as e:
                            print(f"ERROR MANUAL: Buscando carpeta de volumetrías: {e}")

                    # Codificar archivo
                    pdf_base64 = base64.b64encode(upload.file_content).decode('utf-8')
                    
                    print(f"DEBUG MANUAL: Iniciando subida manual para proyecto {upload.project_id}")
                    
                    # Intentar subir, pasando el ID de la carpeta
                    success, returned_folder_id = upload_file_to_project_drive(
                        project_id=upload.project_id,
                        file_name=upload.filename,
                        file_content_base64=pdf_base64,
                        request=None,
                        volumetrias_folder_id=volumetrias_folder_id
                    )
                    
                    if success:
                        upload.status = 'success'
                        upload.completed_at = timezone.now()
                        upload.error_message = None
                        print(f"SUCCESS MANUAL: Archivo {upload.filename} subido exitosamente")
                        # Si se retornó un ID de carpeta y no teníamos uno, lo guardamos.
                        if returned_folder_id and not volumetrias_folder_id:
                             if upload.oportunidad_id:
                                try:
                                    oportunidad = TodoItem.objects.get(id=upload.oportunidad_id)
                                    op_proyecto, created = OportunidadProyecto.objects.get_or_create(oportunidad=oportunidad, defaults={'bitrix_project_id': upload.project_id})
                                    op_proyecto.carpeta_volumetrias_id = returned_folder_id
                                    op_proyecto.save(update_fields=['carpeta_volumetrias_id'])
                                    print(f"SUCCESS MANUAL: ID de carpeta de volumetrías ({returned_folder_id}) guardado en reintento.")
                                except Exception as e:
                                    print(f"ERROR MANUAL: No se pudo guardar el ID de la carpeta en reintento: {e}")
                    else:
                        upload.status = 'failed'
                        upload.error_message = "La función upload_file_to_project_drive retornó False"
                        print(f"ERROR MANUAL: Falló la subida manual de {upload.filename}")
                    
                    upload.save()
                    
                except Exception as e:
                    print(f"ERROR MANUAL: Excepción en subida manual: {e}")
                    upload.status = 'failed'
                    upload.error_message = str(e)
                    upload.save()
            
            # Ejecutar en hilo separado
            import threading
            upload_thread = threading.Thread(target=manual_upload_background)
            upload_thread.daemon = True
            upload_thread.start()
            
            return JsonResponse({
                'success': True, 
                'message': f'Reintentando subida del archivo {upload.filename}',
                'attempts': upload.attempts
            })
            
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)

@login_required 
def delete_pending_upload(request, upload_id):
    """
    Endpoint para eliminar un archivo pendiente
    """
    if request.method == 'POST':
        try:
            upload = get_object_or_404(PendingFileUpload, id=upload_id)
            
            # Verificar permisos
            if not is_supervisor(request.user) and upload.created_by != request.user:
                return JsonResponse({'error': 'Sin permisos para este archivo'}, status=403)
            
            filename = upload.filename
            upload.delete()
            
            return JsonResponse({
                'success': True,
                'message': f'Archivo {filename} eliminado exitosamente'
            })
            
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    return JsonResponse({'error': 'Método no permitido'}, status=405)

@login_required
def upload_status_api(request):
    """
    API para obtener el estado de las subidas pendientes
    """
    if request.user.is_authenticated:
        if is_supervisor(request.user):
            uploads = PendingFileUpload.objects.all()
        else:
            uploads = PendingFileUpload.objects.filter(created_by=request.user)
    else:
        uploads = PendingFileUpload.objects.none()
    
    uploads_data = []
    for upload in uploads.order_by('-created_at')[:20]:  # Últimas 20
        uploads_data.append({
            'id': upload.id,
            'project_id': upload.project_id,
            'filename': upload.filename,
            'status': upload.status,
            'attempts': upload.attempts,
            'max_attempts': upload.max_attempts,
            'error_message': upload.error_message,
            'created_at': convert_to_tijuana_time(upload.created_at).strftime('%d/%m/%Y %H:%M'),
            'completed_at': convert_to_tijuana_time(upload.completed_at).strftime('%d/%m/%Y %H:%M') if upload.completed_at else None,
        })
    
    return JsonResponse({'uploads': uploads_data})


@login_required
def spotlight_search_api(request):
    """
    API Spotlight - Búsqueda universal de cotizaciones y oportunidades
    """
    query = request.GET.get('q', '').strip()
    
    if len(query) < 2:  # Mínimo 2 caracteres para buscar
        return JsonResponse({'results': []})
    
    results = []
    
    # Búsqueda de Cotizaciones (incluyendo búsqueda por número con #)
    # Detectar si buscan por número (#123 o solo 123)
    numeric_query = query.replace('#', '').strip()
    is_numeric_search = numeric_query.isdigit()
    
    cotizaciones_query = Q(nombre_cotizacion__icontains=query) | Q(cliente__nombre_empresa__icontains=query) | Q(descripcion__icontains=query)
    
    # Si es una búsqueda numérica, darle prioridad
    if is_numeric_search:
        cotizaciones_query |= Q(id__exact=int(numeric_query))
    else:
        # Búsqueda regular por ID como string
        cotizaciones_query |= Q(id__icontains=query)
    
    cotizaciones = Cotizacion.objects.filter(cotizaciones_query).select_related('cliente', 'created_by', 'oportunidad')
    
    # Filtrar por permisos de usuario
    if not is_supervisor(request.user):
        cotizaciones = cotizaciones.filter(created_by=request.user)
    
    for cotizacion in cotizaciones[:10]:  # Limitar a 10 resultados
        # Marcar si es una coincidencia exacta de número para priorizar
        is_exact_match = is_numeric_search and str(cotizacion.id) == numeric_query
        
        # Si la cotización tiene una oportunidad asociada, ir a cotizaciones por oportunidad
        # Si no, ir a la página general de cotizaciones
        if cotizacion.oportunidad:
            cotizacion_url = f'/app/cotizaciones/oportunidad/{cotizacion.oportunidad.id}/'
        else:
            cotizacion_url = f'/app/cotizaciones/'
        
        results.append({
            'type': 'cotizacion',
            'id': cotizacion.id,
            'title': cotizacion.nombre_cotizacion or f'Cotización #{cotizacion.id}',
            'subtitle': f'{cotizacion.cliente.nombre_empresa} • ${cotizacion.total:.2f} {cotizacion.moneda}',
            'description': f'Creada por {cotizacion.created_by.get_full_name() or cotizacion.created_by.username if cotizacion.created_by else "Usuario desconocido"}',
            'date': convert_to_tijuana_time(cotizacion.fecha_creacion).strftime('%d/%m/%Y'),
            'icon': 'document',
            'url': cotizacion_url,
            'priority': 1 if is_exact_match else 2,  # Para ordenamiento
            'actions': [
                {'name': 'Ver', 'action': 'view', 'color': 'green'},
                {'name': 'Descargar', 'action': 'download', 'color': 'blue'}, 
                {'name': 'Editar', 'action': 'edit', 'color': 'yellow'}
            ]
        })
    
    # Búsqueda de Oportunidades (TodoItem)
    oportunidades = TodoItem.objects.filter(
        Q(oportunidad__icontains=query) |
        Q(cliente__nombre_empresa__icontains=query) |
        Q(comentarios__icontains=query)
    ).select_related('cliente', 'usuario')
    
    # Filtrar por permisos de usuario
    if not is_supervisor(request.user):
        oportunidades = oportunidades.filter(usuario=request.user)
    
    for oportunidad in oportunidades[:8]:  # Limitar a 8 resultados
        results.append({
            'type': 'oportunidad',
            'id': oportunidad.id,
            'title': oportunidad.oportunidad,
            'subtitle': f'{oportunidad.cliente.nombre_empresa if oportunidad.cliente else "Sin cliente"} • ${oportunidad.monto:.2f}',
            'description': f'Probabilidad: {oportunidad.probabilidad_cierre}% • {oportunidad.get_area_display()}',
            'date': convert_to_tijuana_time(oportunidad.fecha_creacion).strftime('%d/%m/%Y'),
            'icon': 'star',
            'url': f'/app/cliente/{oportunidad.cliente.id if oportunidad.cliente else 0}/crear-cotizacion/?oportunidad_id={oportunidad.id}',
            'priority': 3,  # Oportunidades tienen menor prioridad
            'actions': [
                {'name': 'Crear Cotización', 'action': 'create_quote', 'color': 'blue'}
            ]
        })
    
    # Ordenar resultados por prioridad (1=exacto, 2=cotización, 3=oportunidad), luego por título
    results.sort(key=lambda x: (x.get('priority', 3), x['title'].lower()))
    
    return JsonResponse({
        'results': results[:15],  # Máximo 15 resultados totales
        'query': query,
        'total': len(results)
    })

@login_required
def cotizaciones_automaticas_view(request):
    """
    Vista para cotizaciones automáticas - Solo para superusuarios
    """
    # Verificar que el usuario sea superusuario
    if not request.user.is_superuser:
        return redirect('home')  # Redirigir si no es superusuario
    
    if request.method == 'POST':
        # Procesar el formulario de cotización automática
        try:
            titulo = request.POST.get('titulo', '')
            cliente_id = request.POST.get('cliente_hidden', '')
            usuario_final = request.POST.get('usuario_final', '')
            oportunidad_id = request.POST.get('oportunidad', '')
            comentarios = request.POST.get('comentarios', '')
            moneda = request.POST.get('moneda', 'USD')
            iva_rate = float(request.POST.get('iva_rate', '0.16'))
            tipo_cotizacion = request.POST.get('tipo_cotizacion', '')
            descuento_visible = request.POST.get('descuento_visible', 'false') == 'true'
            
            # Verificar campos requeridos
            if not titulo or not cliente_id or not tipo_cotizacion:
                messages.error(request, 'Por favor, completa todos los campos obligatorios.')
                return redirect('cotizaciones_automaticas')
            
            # Obtener cliente
            try:
                cliente = Cliente.objects.get(id=cliente_id)
            except Cliente.DoesNotExist:
                messages.error(request, 'Cliente no encontrado.')
                return redirect('cotizaciones_automaticas')
            
            # Obtener oportunidad si se especificó
            oportunidad = None
            if oportunidad_id:
                try:
                    oportunidad = TodoItem.objects.get(id=oportunidad_id)
                except TodoItem.DoesNotExist:
                    pass
            
            # Crear cotización
            cotizacion = Cotizacion.objects.create(
                titulo=titulo,
                cliente=cliente,
                usuario_final=usuario_final,
                oportunidad=oportunidad,
                comentarios=comentarios,
                moneda=moneda,
                iva_rate=iva_rate,
                tipo_cotizacion=tipo_cotizacion,
                descuento_visible=descuento_visible,
                usuario=request.user
            )
            
            # Procesar productos automáticos
            productos_data = {}
            for key, value in request.POST.items():
                if key.startswith('productos[') and '][' in key:
                    # Extraer índice y campo del producto
                    index_start = key.find('[') + 1
                    index_end = key.find(']')
                    field_start = key.rfind('[') + 1
                    field_end = key.rfind(']')
                    
                    if index_start < index_end and field_start < field_end:
                        index = key[index_start:index_end]
                        field = key[field_start:field_end]
                        
                        if index not in productos_data:
                            productos_data[index] = {}
                        productos_data[index][field] = value
            
            # Procesar títulos/secciones
            titulos_data = {}
            for key, value in request.POST.items():
                if key.startswith('titulos[') and '][' in key:
                    index_start = key.find('[') + 1
                    index_end = key.find(']')
                    field_start = key.rfind('[') + 1
                    field_end = key.rfind(']')
                    
                    if index_start < index_end and field_start < field_end:
                        index = key[index_start:index_end]
                        field = key[field_start:field_end]
                        
                        if index not in titulos_data:
                            titulos_data[index] = {}
                        titulos_data[index][field] = value
            
            # Crear detalles de productos y títulos en el orden correcto
            all_items = {}
            
            # Agregar productos
            for index, producto in productos_data.items():
                if all(field in producto for field in ['marca', 'no_parte', 'descripcion', 'cantidad', 'precio']):
                    all_items[f'producto_{index}'] = {
                        'type': 'producto',
                        'order': int(index),
                        'data': producto
                    }
            
            # Agregar títulos
            for index, titulo in titulos_data.items():
                if 'texto' in titulo and 'position' in titulo:
                    all_items[f'titulo_{index}'] = {
                        'type': 'titulo',
                        'order': int(titulo.get('position', 0)),
                        'data': titulo
                    }
            
            # Ordenar por posición y crear detalles
            sorted_items = sorted(all_items.items(), key=lambda x: x[1]['order'])
            
            for item_key, item in sorted_items:
                if item['type'] == 'producto':
                    producto = item['data']
                    cantidad = int(producto.get('cantidad', 1))
                    precio = float(producto.get('precio', 0))
                    descuento = float(producto.get('descuento', 0))
                    
                    DetalleCotizacion.objects.create(
                        cotizacion=cotizacion,
                        marca=producto.get('marca', ''),
                        no_parte=producto.get('no_parte', ''),
                        descripcion=producto.get('descripcion', ''),
                        nombre_producto=producto.get('nombre_producto', ''),
                        cantidad=cantidad,
                        precio=precio,
                        descuento=descuento,
                        tipo='producto'
                    )
                elif item['type'] == 'titulo':
                    titulo_data = item['data']
                    DetalleCotizacion.objects.create(
                        cotizacion=cotizacion,
                        nombre_producto=titulo_data.get('texto', 'NUEVA SECCIÓN'),
                        tipo='titulo',
                        cantidad=0,
                        precio=0,
                        descuento=0
                    )
            
            messages.success(request, f'Cotización automática "{titulo}" creada exitosamente.')
            
            # Redirigir al PDF de la cotización
            return redirect('generate_cotizacion_pdf', cotizacion_id=cotizacion.id)
            
        except Exception as e:
            messages.error(request, f'Error al crear la cotización automática: {str(e)}')
            return redirect('cotizaciones_automaticas')
    
    # GET request - mostrar formulario
    clientes = Cliente.objects.all().order_by('nombre_empresa')
    clientes_data = [
        {'id': cliente.id, 'name': cliente.nombre_empresa}
        for cliente in clientes
    ]
    
    context = {
        'clientes_data_json': json.dumps(clientes_data),
        'is_cotizaciones_automaticas': True,
    }
    
    return render(request, 'cotizaciones_automaticas.html', context)

def parse_producto_inteligente(linea, marcas_validas):
    """
    Parser inteligente que detecta productos por patrón marca-precio
    """
    import re
    
    # Dividir la línea en tokens por espacios
    tokens = linea.split()
    if len(tokens) < 3:  # Mínimo: marca, no_parte, precio
        return None
    
    # Buscar marca válida al inicio
    marca = None
    marca_index = -1
    for i, token in enumerate(tokens):
        if token.upper() in marcas_validas:
            marca = token.upper()
            marca_index = i
            break
    
    if not marca or marca_index == -1:
        return None
    
    # Buscar precio (número decimal) desde el final
    precio = None
    precio_index = -1
    for i in range(len(tokens) - 1, marca_index, -1):
        token = tokens[i].replace(',', '').replace('$', '')
        try:
            precio_val = float(token)
            if precio_val >= 0:
                precio = precio_val
                precio_index = i
                break
        except ValueError:
            continue
    
    if precio is None or precio_index == -1:
        return None
    
    # Extraer no_parte (siguiente token después de marca)
    if marca_index + 1 >= precio_index:
        return None
    
    no_parte = tokens[marca_index + 1]
    
    # Extraer descripción (todos los tokens entre no_parte y precio)
    descripcion_tokens = tokens[marca_index + 2:precio_index]
    descripcion = ' '.join(descripcion_tokens) if descripcion_tokens else no_parte
    
    # Si no hay descripción separada, usar no_parte como descripción base
    if not descripcion.strip():
        descripcion = f"Producto {no_parte}"
    
    return {
        'marca': marca,
        'no_parte': no_parte,
        'descripcion': descripcion,
        'precio': precio
    }

@login_required
def avatar_generator(request):
    """
    Vista para el generador de avatares con IA
    """
    if request.method == 'POST':
        # Obtener el animal seleccionado
        data = json.loads(request.body)
        animal = data.get('animal', 'dinosaur')
        
        # Definir los prompts para cada animal
        AVATAR_PROMPTS = {
            'dinosaur': "Cute, friendly, cartoon dinosaur, T-Rex species, small round eyes, smiling, 3D render, highly detailed, vibrant green and yellow colors, clean white background, digital art, children's book style. Avatar circle crop.",
            'fox': "Cute, friendly, cartoon fox, sitting up, fluffy orange and white fur, big curious eyes, 3D render, highly detailed, vibrant colors, clean white background, digital art. Avatar circle crop.",
            'owl': "Cute, friendly, cartoon owl, wise, large golden eyes, elegant brown and white feathers, 3D render, highly detailed, vibrant colors, clean white background, digital art. Avatar circle crop.",
            'panda': "Cute, friendly, cartoon giant panda, holding bamboo, round face, black and white fur, 3D render, highly detailed, clean white background, digital art. Avatar circle crop.",
            'wolf': "Cute, friendly, cartoon wolf cub, blue-gray fur, sharp but kind eyes, howling playfully, 3D render, highly detailed, vibrant colors, clean white background, digital art. Avatar circle crop."
        }
        
        # Obtener el prompt según el animal seleccionado
        prompt = AVATAR_PROMPTS.get(animal, AVATAR_PROMPTS['dinosaur'])
        
        # Configurar la petición a la API de generación de imágenes
        # NOTA: Necesitarás configurar tu propia API key en settings.py
        api_key = getattr(settings, 'IMAGEN_API_KEY', '')
        if not api_key:
            return JsonResponse({'error': 'API key no configurada'}, status=500)
            
        url = f"https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key={api_key}"
        
        payload = {
            "instances": [
                {
                    "prompt": prompt,
                    "aspectRatio": "1:1",
                    "sampleCount": 1
                }
            ],
            "parameters": {
                "sampleImageSize": "1024"
            }
        }
        
        try:
            # Realizar la petición a la API
            response = requests.post(url, json=payload)
            response.raise_for_status()
            result = response.json()
            
            # Extraer la imagen generada
            if 'predictions' in result and result['predictions']:
                image_data = result['predictions'][0].get('bytesBase64Encoded', '')
                if image_data:
                    # Guardar la imagen en el perfil del usuario si está autenticado
                    if hasattr(request.user, 'userprofile'):
                        request.user.userprofile.avatar = f"data:image/png;base64,{image_data}"
                        request.user.userprofile.save()
                    
                    return JsonResponse({
                        'success': True,
                        'image_url': f"data:image/png;base64,{image_data}"
                    })
            
            return JsonResponse({'error': 'No se pudo generar la imagen'}, status=500)
            
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    
    # Si es GET, mostrar la página del generador
    return render(request, 'avatar_generator.html')

@login_required
def configuracion_avanzada(request):
    """
    Vista para la configuración avanzada de usuario con diseño tipo macOS
    """
    # Asegurar que el usuario tenga un perfil
    user_profile, created = UserProfile.objects.get_or_create(user=request.user)
    
    if request.method == 'POST':
        try:
            # Actualizar información del usuario
            user = request.user
            
            # Actualizar campos del modelo User
            username = request.POST.get('username', '').strip()
            first_name = request.POST.get('first_name', '').strip()
            last_name = request.POST.get('last_name', '').strip()
            email = request.POST.get('email', '').strip()
            
            if username and username != user.username:
                # Verificar que el username no esté en uso
                if User.objects.filter(username=username).exclude(id=user.id).exists():
                    return JsonResponse({'success': False, 'error': 'Este nombre de usuario ya está en uso'})
                user.username = username
            
            user.first_name = first_name
            user.last_name = last_name
            user.email = email
            user.save()
            
            # Actualizar campos del perfil
            birthday = request.POST.get('birthday', '').strip()
            gender = request.POST.get('gender', '').strip()
            
            if birthday:
                try:
                    from datetime import datetime
                    user_profile.birthday = datetime.strptime(birthday, '%Y-%m-%d').date()
                except ValueError:
                    pass  # Ignorar fecha inválida
            
            if gender in ['M', 'F', 'O', 'N']:
                user_profile.gender = gender
            
            user_profile.save()
            
            return JsonResponse({'success': True, 'message': 'Información actualizada correctamente'})
            
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)})
    
    context = {
        'user_profile': user_profile,
    }
    return render(request, 'personalizacion_avanzada.html', context)


def limpiar_y_corregir_texto(texto):
    """
    Limpia caracteres de encoding corrupto y corrige palabras comunes
    """
    import re
    
    # Diccionario de correcciones comunes de caracteres de encoding
    correcciones_encoding = {
        'Bimet√°lica': 'Bimetálica',
        'bimet√°lica': 'bimetálica',
        'met√°lica': 'metálica',
        'Met√°lica': 'Metálica',
        'el√©ctrica': 'eléctrica',
        'El√©ctrica': 'Eléctrica',
        'electr√≥nica': 'electrónica',
        'Electr√≥nica': 'Electrónica',
        'mec√°nica': 'mecánica',
        'Mec√°nica': 'Mecánica',
        'hidr√°ulica': 'hidráulica',
        'Hidr√°ulica': 'Hidráulica',
        'neum√°tica': 'neumática',
        'Neum√°tica': 'Neumática',
        'autom√°tica': 'automática',
        'Autom√°tica': 'Automática',
        'est√°ndar': 'estándar',
        'Est√°ndar': 'Estándar',
        'b√°sica': 'básica',
        'B√°sica': 'Básica',
        'avanzada': 'avanzada',
        'Avanzada': 'Avanzada',
        'pr√°ctica': 'práctica',
        'Pr√°ctica': 'Práctica',
        'gu√≠a': 'guía',
        'Gu√≠a': 'Guía',
        'energ√≠a': 'energía',
        'Energ√≠a': 'Energía',
        'bater√≠a': 'batería',
        'Bater√≠a': 'Batería',
        'H√∫medas': 'Húmedas',
        'h√∫medas': 'húmedas',
        'h√∫meda': 'húmeda',
        'H√∫meda': 'Húmeda',
        'C√©dula': 'Cédula',
        'c√©dula': 'cédula',
        'c√©lula': 'célula',
        'C√©lula': 'Célula',
        'f√°cil': 'fácil',
        'F√°cil': 'Fácil',
        'r√°pida': 'rápida',
        'R√°pida': 'Rápida',
        'r√°pido': 'rápido',
        'R√°pido': 'Rápido',
        'c√°mara': 'cámara',
        'C√°mara': 'Cámara',
        '√°rea': 'área',
        '√Área': 'Área',
        'energ√≠a': 'energía',
        'Energ√≠a': 'Energía',
        'tecnolog√≠a': 'tecnología',
        'Tecnolog√≠a': 'Tecnología',
        'categor√≠a': 'categoría',
        'Categor√≠a': 'Categoría',
        'garant√≠a': 'garantía',
        'Garant√≠a': 'Garantía',
        'compa√±√≠a': 'compañía',
        'Compa√±√≠a': 'Compañía',
        'dise√±o': 'diseño',
        'Dise√±o': 'Diseño',
        'peque√±o': 'pequeño',
        'Peque√±o': 'Pequeño',
        'peque√±a': 'pequeña',
        'Peque√±a': 'Pequeña',
        'a√±o': 'año',
        'A√±o': 'Año',
        'ni√±o': 'niño',
        'Ni√±o': 'Niño',
        'ni√±a': 'niña',
        'Ni√±a': 'Niña',
        'espa√±ol': 'español',
        'Espa√±ol': 'Español',
        'espa√±ola': 'española',
        'Espa√±ola': 'Española'
    }
    
    # Patrones de corrección automática
    patrones_correccion = [
        # √° -> á
        (r'(.*)√°(.*)', r'\1á\2'),
        # √© -> é  
        (r'(.*)√©(.*)', r'\1é\2'),
        # √≠ -> í
        (r'(.*)√≠(.*)', r'\1í\2'),
        # √≥ -> ó
        (r'(.*)√≥(.*)', r'\1ó\2'),
        # √∫ -> ú (común en "húmedo")
        (r'(.*)√∫(.*)', r'\1ú\2'),
        # √± -> ñ
        (r'(.*)√±(.*)', r'\1ñ\2'),
        # Otros caracteres problemáticos
        (r'(.*)‚Ä¢(.*)', r'\1"\2'),
        (r'(.*)‚Äù(.*)', r'\1"\2'),
        (r'(.*)‚Äî(.*)', r'\1-\2'),
        (r'(.*)√¢(.*)', r'\1â\2'),
        (r'(.*)√™(.*)', r'\1ê\2'),
        (r'(.*)√Æ(.*)', r'\1Æ\2'),
        # Limpiar caracteres raros restantes
        (r'√[^a-zA-Z0-9]', ''),
        # Múltiples espacios
        (r'\s+', ' ')
    ]
    
    # Aplicar correcciones específicas del diccionario primero
    texto_corregido = texto
    for incorrecto, correcto in correcciones_encoding.items():
        texto_corregido = texto_corregido.replace(incorrecto, correcto)
    
    # Aplicar patrones de corrección automática
    for patron, reemplazo in patrones_correccion:
        texto_corregido = re.sub(patron, reemplazo, texto_corregido)
    
    # Normalizar espacios y limpiar
    texto_corregido = re.sub(r'\s+', ' ', texto_corregido).strip()
    
    return texto_corregido

def parse_producto_volumetria_inteligente(linea):
    """
    Parser inteligente específico para productos de volumetría
    Detecta patrón: numero_parte marca descripcion precio_lista precio_proveedor
    Ejemplo: TC-CARRIER Bobina de cable de 305 metros... 384 226.56
    """
    import re
    
    # Limpiar la línea y corregir caracteres de encoding
    linea = limpiar_y_corregir_texto(linea.strip())
    if not linea:
        return None
    
    # Dividir en tokens por espacios
    tokens = linea.split()
    if len(tokens) < 3:  # Mínimo: numero_parte, marca, precio
        return None
    
    # Buscar el primer token que parezca un número de parte (con guiones, letras y números)
    numero_parte = None
    numero_parte_index = -1
    
    # Patrón para número de parte: letras, números, guiones
    patron_numero_parte = re.compile(r'^[A-Z0-9\-\/\.]+$', re.IGNORECASE)
    
    for i, token in enumerate(tokens):
        if patron_numero_parte.match(token) and len(token) >= 3:
            numero_parte = token.upper()
            numero_parte_index = i
            break
    
    if not numero_parte or numero_parte_index == -1:
        return None
    
    # Buscar precios desde el final (debe haber al menos 2: precio_lista y precio_proveedor)
    precios = []
    precio_indices = []
    
    # Buscar los últimos 2 números como precios
    for i in range(len(tokens) - 1, numero_parte_index, -1):
        token = tokens[i].replace(',', '').replace('$', '')
        try:
            precio_val = float(token)
            if precio_val >= 0:
                precios.append(precio_val)
                precio_indices.append(i)
                if len(precios) >= 2:  # Solo necesitamos 2 precios
                    break
        except ValueError:
            continue
    
    if len(precios) < 2:
        return None
    
    # Los precios están en orden inverso (el último es precio_lista, el penúltimo es precio_proveedor)
    precio_proveedor = precios[0]  # Último precio encontrado
    precio_lista = precios[1]      # Penúltimo precio encontrado
    
    # El índice donde termina la descripción es el penúltimo precio
    fin_descripcion_index = precio_indices[1]
    
    # Extraer marca (siguiente token después de numero_parte)
    if numero_parte_index + 1 >= fin_descripcion_index:
        return None
    
    marca = tokens[numero_parte_index + 1] if numero_parte_index + 1 < len(tokens) else 'UNKNOWN'
    
    # Extraer descripción (todos los tokens entre marca y primer precio)
    inicio_descripcion = numero_parte_index + 2
    descripcion_tokens = tokens[inicio_descripcion:fin_descripcion_index]
    descripcion = ' '.join(descripcion_tokens) if descripcion_tokens else f"Producto {numero_parte}"
    
    # Limpiar y corregir caracteres de encoding en la descripción
    descripcion = limpiar_y_corregir_texto(descripcion)
    
    # Si la descripción está muy corta, usar una más descriptiva
    if len(descripcion) < 10:
        descripcion = f"Producto {numero_parte} - {marca}"
    
    # Detectar categoría automáticamente desde número de parte o descripción (solo para referencia, no restrictiva)
    categoria = ''
    descripcion_lower = descripcion.lower()
    numero_parte_lower = numero_parte.lower()
    
    if 'cat6a' in descripcion_lower or 'cat6a' in numero_parte_lower:
        categoria = 'Cat6A'
    elif 'cat6' in descripcion_lower or 'cat6' in numero_parte_lower:
        categoria = 'Cat6'
    elif 'cat5e' in descripcion_lower or 'cat5e' in numero_parte_lower:
        categoria = 'Cat5e'
    elif 'jack' in descripcion_lower:
        categoria = 'Jack'
    elif 'patch' in descripcion_lower:
        categoria = 'Patchcord'
    elif 'faceplate' in descripcion_lower or 'face' in descripcion_lower:
        categoria = 'Faceplate'
    elif 'tubo' in descripcion_lower or 'conduit' in descripcion_lower:
        categoria = 'Conduit'
    elif 'conector' in descripcion_lower:
        categoria = 'Conector'
    elif 'cable' in descripcion_lower:
        categoria = 'Cable'
    elif 'charola' in descripcion_lower or 'malla' in descripcion_lower:
        categoria = 'Charola'
    # Si no se detecta ninguna categoría específica, dejar vacío para que el usuario decida
    # No forzar una categoría "Otro"
    
    # Detectar color automáticamente
    color = ''
    if 'negro' in descripcion_lower or 'black' in descripcion_lower:
        color = 'NEGRO'
    elif 'azul' in descripcion_lower or 'blue' in descripcion_lower:
        color = 'AZUL'
    elif 'blanco' in descripcion_lower or 'white' in descripcion_lower:
        color = 'BLANCO'
    elif 'gris' in descripcion_lower or 'gray' in descripcion_lower:
        color = 'GRIS'
    elif 'amarillo' in descripcion_lower or 'yellow' in descripcion_lower:
        color = 'AMARILLO'
    elif 'rojo' in descripcion_lower or 'red' in descripcion_lower:
        color = 'ROJO'
    elif 'verde' in descripcion_lower or 'green' in descripcion_lower:
        color = 'VERDE'
    
    return {
        'numero_parte': numero_parte,
        'marca': marca.upper(),
        'descripcion': descripcion,
        'precio_lista': precio_lista,
        'precio_proveedor': precio_proveedor,
        'categoria': categoria,
        'color': color
    }

@login_required
def gestion_productos_view(request):
    """
    Vista para gestión de productos - Solo para superusuarios
    """
    # Verificar que el usuario sea superusuario
    if not request.user.is_superuser:
        return redirect('home')  # Redirigir si no es superusuario
    
    if request.method == 'POST':
        # Procesar importación de productos desde Excel
        try:
            excel_data = request.POST.get('excel_data', '').strip()
            actualizar_existentes = request.POST.get('actualizar_existentes') == 'on'
            
            if not excel_data:
                messages.error(request, 'Por favor, pega los datos de Excel.')
                return redirect('gestion_productos')
            
            # Procesar datos del Excel
            lineas = excel_data.split('\n')
            productos_procesados = []
            productos_para_crear = []  # Para bulk_create
            productos_para_actualizar = []  # Para bulk_update
            productos_nuevos = 0
            productos_actualizados = 0
            productos_duplicados = 0
            errores = []
            
            # Determinar batch size basado en volumen de datos
            total_lineas = len(lineas)
            if total_lineas > 10000:
                batch_size = 1000  # Para datasets muy grandes
                print(f"IMPORTACIÓN: 🚀 Modo ULTRA-ESCALABLE activado para {total_lineas} líneas (batch: {batch_size})", flush=True)
            elif total_lineas > 5000:
                batch_size = 750   # Para datasets grandes
                print(f"IMPORTACIÓN: 🏃 Modo RÁPIDO activado para {total_lineas} líneas (batch: {batch_size})", flush=True)
            else:
                batch_size = 500   # Para datasets normales
                print(f"IMPORTACIÓN: ⚡ Modo ESTÁNDAR para {total_lineas} líneas (batch: {batch_size})", flush=True)
            
            from app.models import Marca, ProductoCatalogo, ImportacionProductos
            import re
            
            # Marcas válidas
            marcas_validas = {'ZEBRA', 'PANDUIT', 'APC', 'AVIGILON', 'AXIS', 'GENETEC', 'CISCO'}
            
            for i, linea in enumerate(lineas, 1):
                linea = linea.strip()
                if not linea:
                    continue
                
                # Indicador de progreso para datasets grandes
                if total_lineas > 5000 and i % 1000 == 0:
                    progreso = (i / total_lineas) * 100
                    print(f"IMPORTACIÓN: Progreso {progreso:.1f}% ({i}/{total_lineas} líneas procesadas)", flush=True)
                
                # Detectar si es línea de encabezado y saltarla
                if linea.lower().startswith('marca') and 'no' in linea.lower() and 'precio' in linea.lower():
                    continue
                
                try:
                    # Usar algoritmo inteligente de detección por patrones
                    producto_data = parse_producto_inteligente(linea, marcas_validas)
                    
                    if not producto_data:
                        errores.append(f'Línea {i}: No se pudo detectar el patrón marca-precio válido')
                        continue
                    
                    marca_nombre = producto_data['marca']
                    no_parte = producto_data['no_parte']
                    descripcion = producto_data['descripcion']
                    precio_str = str(producto_data['precio'])
                    
                    # Validar datos
                    if not marca_nombre or not no_parte or not descripcion:
                        errores.append(f'Línea {i}: Datos vacíos')
                        continue
                    
                    # Limpiar y convertir precio
                    precio = float(precio_str.replace(',', '').replace('$', ''))
                    if precio < 0:
                        errores.append(f'Línea {i}: Precio no puede ser negativo')
                        continue
                    
                    # Crear o obtener marca
                    marca, created = Marca.objects.get_or_create(
                        nombre=marca_nombre,
                        defaults={'activa': True}
                    )
                    
                    # Crear clave única para identificar duplicados
                    clave_producto = f"{marca.id}_{no_parte}"
                    
                    # Verificar si el producto ya existe en BD
                    producto_existente = ProductoCatalogo.objects.filter(
                        marca=marca,
                        no_parte=no_parte
                    ).first()
                    
                    if producto_existente:
                        if actualizar_existentes:
                            # Agregar a lista para bulk_update
                            producto_existente.descripcion = descripcion
                            producto_existente.precio = precio
                            productos_para_actualizar.append(producto_existente)
                            productos_actualizados += 1
                            # Solo mostrar logs detallados si dataset es pequeño
                            if total_lineas <= 5000:
                                print(f"IMPORTACIÓN: Producto actualizado - {marca_nombre} {no_parte}", flush=True)
                        else:
                            # Producto existe pero no actualizar
                            productos_duplicados += 1
                            # Solo mostrar logs detallados si dataset es pequeño
                            if total_lineas <= 5000:
                                print(f"IMPORTACIÓN: Producto duplicado ignorado - {marca_nombre} {no_parte}", flush=True)
                    else:
                        # Agregar a lista para bulk_create
                        nuevo_producto = ProductoCatalogo(
                            marca=marca,
                            no_parte=no_parte,
                            descripcion=descripcion,
                            precio=precio
                        )
                        productos_para_crear.append(nuevo_producto)
                        productos_nuevos += 1
                        # Solo mostrar logs detallados si dataset es pequeño
                        if total_lineas <= 5000:
                            print(f"IMPORTACIÓN: Producto nuevo preparado - {marca_nombre} {no_parte}", flush=True)
                    
                    productos_procesados.append({
                        'marca': marca_nombre,
                        'no_parte': no_parte,
                        'descripcion': descripcion,
                        'precio': precio
                    })
                    
                except ValueError as e:
                    errores.append(f'Línea {i}: Error en precio "{precio_str}" - {str(e)}')
                except Exception as e:
                    errores.append(f'Línea {i}: Error inesperado - {str(e)}')
            
            # ========================================
            # EJECUTAR OPERACIONES EN LOTE (BULK)
            # ========================================
            
            # Crear productos nuevos en lote
            if productos_para_crear:
                print(f"IMPORTACIÓN: Creando {len(productos_para_crear)} productos nuevos en lote (batch: {batch_size})...", flush=True)
                ProductoCatalogo.objects.bulk_create(productos_para_crear, batch_size=batch_size)
                print(f"IMPORTACIÓN: ✅ {len(productos_para_crear)} productos creados exitosamente", flush=True)
            
            # Actualizar productos existentes en lote
            if productos_para_actualizar:
                print(f"IMPORTACIÓN: Actualizando {len(productos_para_actualizar)} productos en lote (batch: {batch_size})...", flush=True)
                ProductoCatalogo.objects.bulk_update(
                    productos_para_actualizar, 
                    ['descripcion', 'precio', 'fecha_actualizacion'], 
                    batch_size=batch_size
                )
                print(f"IMPORTACIÓN: ✅ {len(productos_para_actualizar)} productos actualizados exitosamente", flush=True)
            
            # Registrar importación
            if productos_procesados:
                importacion = ImportacionProductos.objects.create(
                    usuario=request.user,
                    productos_importados=len(productos_procesados),
                    productos_actualizados=productos_actualizados,
                    productos_nuevos=productos_nuevos,
                    observaciones=f'Errores: {len(errores)}' if errores else 'Importación exitosa'
                )
            
            # Mostrar resultados detallados
            if productos_procesados:
                mensaje_exito = f'✅ Importación completada: {productos_nuevos} productos nuevos, {productos_actualizados} actualizados'
                if productos_duplicados > 0:
                    mensaje_exito += f', {productos_duplicados} duplicados ignorados'
                if errores:
                    mensaje_exito += f'. ⚠️ {len(errores)} errores encontrados.'
                messages.success(request, mensaje_exito)
                
                # Log detallado para debugging
                print(f"IMPORTACIÓN COMPLETADA:", flush=True)
                print(f"  - Líneas procesadas: {len(lineas)}", flush=True)
                print(f"  - Productos nuevos: {productos_nuevos}", flush=True)
                print(f"  - Productos actualizados: {productos_actualizados}", flush=True)
                print(f"  - Productos duplicados: {productos_duplicados}", flush=True)
                print(f"  - Errores: {len(errores)}", flush=True)
            
            if errores:
                for error in errores[:5]:  # Mostrar solo los primeros 5 errores
                    messages.warning(request, error)
                if len(errores) > 5:
                    messages.warning(request, f'... y {len(errores) - 5} errores más.')
            
            return redirect('gestion_productos')
            
        except Exception as e:
            messages.error(request, f'Error al procesar la importación: {str(e)}')
            return redirect('gestion_productos')
    
    # GET request - mostrar formulario
    from app.models import Marca, ProductoCatalogo, ImportacionProductos
    from django.utils import timezone
    from datetime import timedelta
    
    # Estadísticas
    total_productos = ProductoCatalogo.objects.filter(activo=True).count()
    total_marcas = Marca.objects.filter(activa=True).count()
    
    # Días desde última importación
    ultima_importacion = ImportacionProductos.objects.first()
    if ultima_importacion:
        dias_ultima_importacion = (timezone.now() - ultima_importacion.fecha_importacion).days
    else:
        dias_ultima_importacion = 'N/A'
    
    # Productos recientes (últimos 50)
    productos = ProductoCatalogo.objects.filter(activo=True).select_related('marca').order_by('-fecha_actualizacion')[:50]
    
    # Marcas activas
    marcas = Marca.objects.filter(activa=True).order_by('nombre')
    
    # Importaciones recientes
    importaciones_recientes = ImportacionProductos.objects.select_related('usuario', 'marca').order_by('-fecha_importacion')[:10]
    
    context = {
        'total_productos': total_productos,
        'total_marcas': total_marcas,
        'dias_ultima_importacion': dias_ultima_importacion,
        'productos': productos,
        'marcas': marcas,
        'importaciones_recientes': importaciones_recientes,
    }
    
    return render(request, 'gestion_productos.html', context)

@login_required
def get_productos_por_marca_api(request):
    """
    API para obtener productos por marca para cotizaciones automáticas
    """
    marca = request.GET.get('marca', '').upper()
    query = request.GET.get('query', '').lower()
    
    if not marca:
        return JsonResponse({'productos': []})
    
    try:
        from app.models import ProductoCatalogo, Marca
        
        # Obtener la marca
        marca_obj = Marca.objects.filter(nombre=marca, activa=True).first()
        if not marca_obj:
            return JsonResponse({'productos': []})
        
        # Obtener productos de la marca
        productos = ProductoCatalogo.objects.filter(
            marca=marca_obj,
            activo=True
        )
        
        # Filtrar por consulta si se proporciona
        if query:
            productos = productos.filter(
                Q(no_parte__icontains=query) |
                Q(descripcion__icontains=query)
            )
        
        # Limitar resultados
        productos = productos.order_by('no_parte')[:20]
        
        # Formatear respuesta
        productos_data = []
        for producto in productos:
            productos_data.append({
                'no_parte': producto.no_parte,
                'descripcion': producto.descripcion,
                'precio': float(producto.precio),
                'marca': producto.marca.nombre
            })
        
        return JsonResponse({
            'productos': productos_data,
            'marca': marca,
            'query': query
        })
        
    except Exception as e:
        return JsonResponse({
            'error': str(e),
            'productos': []
        })

# ========================================
# COTIZACIONES AUTOMÁTICAS DESDE BITRIX24
# ========================================

import re

def es_cotizacion_automatica(deal_details):
    """
    Detecta si una oportunidad debe generar cotización automática
    basado en si el campo producto es una de las 7 marcas principales
    """
    producto_bitrix_id = deal_details.get('UF_CRM_1752859685662')
    
    # IDs de las 7 marcas que tienen cotización automática
    marcas_automaticas = [
        "176",  # ZEBRA
        "178",  # PANDUIT
        "180",  # APC
        "182",  # AVIGILON
        "184",  # GENETEC
        "186",  # AXIS
        "194",  # CISCO
    ]
    
    return str(producto_bitrix_id) in marcas_automaticas

def extraer_productos_inteligente(texto_requisicion, marca_seleccionada):
    """
    Parser súper inteligente que extrae números de parte y cantidades
    de cualquier formato de texto libre
    """
    if not texto_requisicion or not marca_seleccionada:
        return []
    
    productos_encontrados = []
    
    # Limpiar texto y dividir en líneas
    lineas = texto_requisicion.strip().replace('\r\n', '\n').split('\n')
    
    for linea in lineas:
        linea = linea.strip()
        if not linea:
            continue
            
        # Buscar patrones flexibles: texto alfanumérico + número
        # Patrones que detecta:
        # - "ZT411-203DPI 2"
        # - "ZT411 cantidad: 3"
        # - "necesito 5 del ZT411-203DPI"
        # - "450145 x3"
        # - "ZT411 (2 piezas)"
        
        # Patrón principal: buscar código alfanumérico y número cercano
        patron_principal = r'([A-Z0-9\-_]+).*?(\d+)'
        matches = re.findall(patron_principal, linea, re.IGNORECASE)
        
        for posible_parte, cantidad_str in matches:
            # Limpiar el posible número de parte
            posible_parte = posible_parte.strip().upper()
            
            # Verificar que sea un código válido (al menos 3 caracteres)
            if len(posible_parte) < 3:
                continue
                
            # Verificar que existe en nuestro catálogo para esta marca
            from app.models import ProductoCatalogo, Marca
            try:
                marca_obj = Marca.objects.get(nombre=marca_seleccionada, activa=True)
                producto = ProductoCatalogo.objects.filter(
                    marca=marca_obj,
                    no_parte__iexact=posible_parte,
                    activo=True
                ).first()
                
                if producto:
                    cantidad = int(cantidad_str)
                    productos_encontrados.append({
                        'no_parte': producto.no_parte,
                        'descripcion': producto.descripcion,
                        'precio': float(producto.precio),
                        'cantidad': cantidad,
                        'total': float(producto.precio) * cantidad
                    })
                    print(f"COTIZACIÓN AUTOMÁTICA: Producto encontrado: {producto.no_parte} x{cantidad}")
                    
            except (Marca.DoesNotExist, ValueError) as e:
                print(f"COTIZACIÓN AUTOMÁTICA: Error procesando {posible_parte}: {e}")
                continue
    
    return productos_encontrados

def crear_cotizacion_automatica_bitrix(deal_details, cliente, usuario, porcentaje_utilidad=0):
    """
    Crea una cotización automática basada en los datos de Bitrix24
    """
    try:
        # Obtener la marca del campo producto
        PRODUCTO_BITRIX_ID_TO_DJANGO_VALUE = {
            "176": "ZEBRA", "178": "PANDUIT", "180": "APC", "182": "AVIGILON",
            "184": "GENETEC", "186": "AXIS", "194": "CISCO"
        }
        
        producto_bitrix_id = deal_details.get('UF_CRM_1752859685662')
        marca_seleccionada = PRODUCTO_BITRIX_ID_TO_DJANGO_VALUE.get(str(producto_bitrix_id))
        
        if not marca_seleccionada:
            print(f"COTIZACIÓN AUTOMÁTICA: Marca no válida para ID {producto_bitrix_id}")
            return None
            
        # Obtener el texto de requisición del cliente desde COMMENTS
        # Los ejecutivos pueden escribir números de parte aquí en cualquier formato
        requisicion_cliente = deal_details.get('COMMENTS', '')
        
        print(f"COTIZACIÓN AUTOMÁTICA: Texto de requisición obtenido: '{requisicion_cliente[:100]}...'", flush=True)
        
        # Extraer productos inteligentemente
        productos = extraer_productos_inteligente(requisicion_cliente, marca_seleccionada)
        
        if not productos:
            print(f"COTIZACIÓN AUTOMÁTICA: No se encontraron productos válidos en la requisición")
            return None
            
        # Crear la cotización
        from app.models import Cotizacion, DetalleCotizacion
        
        # Usar el título del deal directamente
        titulo_cotizacion = deal_details.get('TITLE', 'Sin título')

        # Encontrar la oportunidad local correspondiente
        oportunidad_local = None
        deal_id = deal_details.get('ID')
        if deal_id:
            oportunidad_local = TodoItem.objects.filter(bitrix_deal_id=deal_id).first()
        
        cotizacion = Cotizacion.objects.create(
            cliente=cliente,
            created_by=usuario,
            titulo=titulo_cotizacion,
            nombre_cotizacion=titulo_cotizacion,
            oportunidad=oportunidad_local, # Asociar la oportunidad local
            descripcion="", # Descripción vacía
            moneda='USD',
            iva_rate=0.16,  # 16% por defecto
            tipo_cotizacion='Iamet',  # IAMET por defecto
            subtotal=0,  # Se calculará después
            iva_amount=0,  # Se calculará después
            total=0,  # Se calculará después
            descuento_visible=False
        )
        
        # Agregar productos a la cotización
        subtotal = 0
        print(f"COTIZACIÓN AUTOMÁTICA: Aplicando {porcentaje_utilidad}% de utilidad a los precios", flush=True)
        
        for i, producto in enumerate(productos, 1):
            # Aplicar porcentaje de utilidad al precio base
            precio_base = producto['precio']
            if porcentaje_utilidad > 0:
                factor_utilidad = 1 + (porcentaje_utilidad / 100)
                precio_con_utilidad = precio_base * factor_utilidad
                total_con_utilidad = precio_con_utilidad * producto['cantidad']
                print(f"COTIZACIÓN AUTOMÁTICA: Producto {producto['no_parte']} - Precio base: ${precio_base:.2f} → Con {porcentaje_utilidad}% utilidad: ${precio_con_utilidad:.2f}", flush=True)
            else:
                precio_con_utilidad = precio_base
                total_con_utilidad = precio_base * producto['cantidad']
            
            DetalleCotizacion.objects.create(
                cotizacion=cotizacion,
                orden=i,
                marca=marca_seleccionada,
                nombre_producto=producto['no_parte'],
                no_parte=producto['no_parte'],
                descripcion=producto['descripcion'],
                cantidad=producto['cantidad'],
                precio_unitario=precio_con_utilidad,
                descuento_porcentaje=0,
                total=total_con_utilidad
            )
            subtotal += total_con_utilidad
        
        # Calcular totales
        iva_amount = Decimal(str(subtotal)) * Decimal('0.16')
        total = Decimal(str(subtotal)) + iva_amount
        
        # Actualizar cotización con totales
        cotizacion.subtotal = Decimal(str(subtotal))
        cotizacion.iva_amount = iva_amount
        cotizacion.total = total
        cotizacion.save()
        
        print(f"COTIZACIÓN AUTOMÁTICA: Creada cotización {cotizacion.id} con {len(productos)} productos. Total: ${total:.2f}")
        return cotizacion
        
    except Exception as e:
        print(f"COTIZACIÓN AUTOMÁTICA: Error creando cotización: {e}")
        return None

def subir_cotizacion_a_bitrix(cotizacion, deal_id, request=None):
    """
    Genera el PDF de la cotización y lo sube como comentario a Bitrix24
    """
    try:
        from django.test import RequestFactory
        import base64
        
        # Crear una petición temporal para generar el PDF
        factory = RequestFactory()
        pdf_request = factory.get(f'/app/cotizacion/{cotizacion.id}/pdf/')
        pdf_request.user = cotizacion.created_by
        
        # Generar el PDF
        pdf_response = generate_cotizacion_pdf(pdf_request, cotizacion.id)
        
        if pdf_response.status_code == 200:
            # Convertir PDF a base64
            pdf_content = pdf_response.content
            pdf_base64 = base64.b64encode(pdf_content).decode('utf-8')
            
            # Nombre del archivo
            pdf_name_raw = cotizacion.nombre_cotizacion or f"Cotizacion_{cotizacion.id}"
            sanitized_name = "".join(c for c in pdf_name_raw if c.isalnum() or c in ('_', '-')).strip().replace(' ', '_')
            pdf_filename = f"{sanitized_name}.pdf"
            
            # Comentario para Bitrix
            comentario_texto = f"""
🤖 Cotización Automática Generada

Cotización: {cotizacion.nombre_cotizacion}
Total: ${float(cotizacion.total):.2f} {cotizacion.moneda}
Productos: {cotizacion.detalles.count()} artículos
Generada por: {cotizacion.created_by.get_full_name() or cotizacion.created_by.username}
Fecha: {convert_to_tijuana_time(cotizacion.fecha_creacion).strftime('%d/%m/%Y %H:%M')}

⚡ Generada automáticamente desde el sistema Nethive
            """.strip()
            
            # Subir a Bitrix24
            from .bitrix_integration import add_comment_with_attachment_to_deal
            resultado_bitrix = add_comment_with_attachment_to_deal(
                deal_id=deal_id,
                file_name=pdf_filename,
                file_content_base64=pdf_base64,
                comment_text=comentario_texto,
                request=request
            )
            
            if resultado_bitrix:
                print(f"COTIZACIÓN AUTOMÁTICA: PDF subido exitosamente a Bitrix24 deal {deal_id}")
                return True
            else:
                print(f"COTIZACIÓN AUTOMÁTICA: Error subiendo PDF a Bitrix24 deal {deal_id}")
                return False
                
        else:
            print(f"COTIZACIÓN AUTOMÁTICA: Error generando PDF (status {pdf_response.status_code})")
            return False
            
    except Exception as e:
        print(f"COTIZACIÓN AUTOMÁTICA: Error subiendo a Bitrix24: {e}")
        return False

# ========================================
# FUNCIÓN DE TEST PARA COTIZACIONES AUTOMÁTICAS
# ========================================

@login_required
def test_cotizacion_automatica(request):
    """
    Función de test para probar las cotizaciones automáticas sin Bitrix24
    Solo accesible para superusuarios
    """
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Acceso denegado'}, status=403)
    
    try:
        # Simular datos de Bitrix24
        deal_details_test = {
            'ID': '999999',  # ID de prueba
            'TITLE': 'Oportunidad de Prueba - Cotización Automática',
            'OPPORTUNITY': '5000.00',
            'COMPANY_ID': '123',
            'CONTACT_ID': '456',
            'UF_CRM_1752859685662': '176',  # ZEBRA
            'COMMENTS': 'ZT411-203DPI 2\n450145 x3\nNecesito 1 unidad del 20-61019-04R',
        }
        
        # Obtener o crear cliente de prueba
        from app.models import Cliente, User
        cliente_test, _ = Cliente.objects.get_or_create(
            nombre_empresa='Cliente Test Automático',
            defaults={'bitrix_company_id': '123'}
        )
        
        # Usar el usuario actual
        usuario_test = request.user
        
        print("=== INICIANDO TEST DE COTIZACIÓN AUTOMÁTICA ===")
        
        # Test 1: Verificar detección de cotización automática
        es_automatica = es_cotizacion_automatica(deal_details_test)
        print(f"✓ Test detección automática: {es_automatica}")
        
        # Test 2: Probar el parser inteligente
        productos = extraer_productos_inteligente(deal_details_test['COMMENTS'], 'ZEBRA')
        print(f"✓ Test parser inteligente: {len(productos)} productos encontrados")
        for p in productos:
            print(f"  - {p['no_parte']} x{p['cantidad']} = ${p['total']:.2f}")
        
        # Test 3: Crear cotización automática
        if es_automatica and productos:
            cotizacion_test = crear_cotizacion_automatica_bitrix(deal_details_test, cliente_test, usuario_test)
            if cotizacion_test:
                print(f"✓ Test creación cotización: ID {cotizacion_test.id}, Total: ${cotizacion_test.total:.2f}")
                
                return JsonResponse({
                    'success': True,
                    'message': 'Test de cotización automática completado exitosamente',
                    'cotizacion_id': cotizacion_test.id,
                    'total': float(cotizacion_test.total),
                    'productos_count': len(productos),
                    'productos': productos
                })
            else:
                return JsonResponse({'error': 'Falló la creación de la cotización'}, status=400)
        else:
            return JsonResponse({'error': 'Test falló en la detección o parsing'}, status=400)
            
    except Exception as e:
        print(f"ERROR EN TEST: {e}")
        return JsonResponse({'error': str(e)}, status=500)

@login_required
def buscar_producto_catalogo(request):
    """
    API endpoint para buscar productos en el catálogo por número de parte
    """
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    numero_parte = request.GET.get('numero_parte', '').strip()
    tipo_producto = request.GET.get('tipo', '').strip()
    
    if not numero_parte:
        return JsonResponse({'error': 'Número de parte es requerido'}, status=400)
    
    try:
        # Buscar producto por número de parte
        query = CatalogoCableado.objects.filter(
            numero_parte__icontains=numero_parte,
            activo=True
        )
        
        # Filtrar por tipo si se especifica
        if tipo_producto:
            query = query.filter(tipo_producto=tipo_producto.upper())
        
        producto = query.first()
        
        if producto:
            return JsonResponse({
                'success': True,
                'producto': {
                    'numero_parte': producto.numero_parte,
                    'descripcion': producto.descripcion,
                    'tipo_producto': producto.tipo_producto,
                    'marca': producto.marca,
                    'precio_unitario': float(producto.precio_unitario),
                    'precio_proveedor': float(producto.precio_proveedor),
                    'categoria': producto.categoria,
                    'color': producto.color,
                    'activo': producto.activo
                }
            })
        else:
            return JsonResponse({
                'success': False,
                'message': 'Producto no encontrado en el catálogo'
            })
            
    except Exception as e:
        print(f"ERROR buscando producto: {e}")
        return JsonResponse({'error': 'Error interno del servidor'}, status=500)

@login_required  
def agregar_producto_catalogo(request):
    """
    API endpoint para agregar productos al catálogo
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        data = json.loads(request.body)
        
        # Validar campos requeridos
        required_fields = ['numero_parte', 'descripcion', 'tipo_producto', 'precio_unitario']
        for field in required_fields:
            if not data.get(field):
                return JsonResponse({'error': f'Campo {field} es requerido'}, status=400)
        
        # Verificar si el producto ya existe
        if CatalogoCableado.objects.filter(numero_parte=data['numero_parte']).exists():
            return JsonResponse({'error': 'Ya existe un producto con este número de parte'}, status=400)
        
        # Crear nuevo producto
        producto = CatalogoCableado.objects.create(
            numero_parte=data['numero_parte'],
            descripcion=data['descripcion'],
            tipo_producto=data['tipo_producto'].upper(),
            marca=data.get('marca', 'PANDUIT'),
            precio_unitario=Decimal(str(data['precio_unitario'])),
            precio_proveedor=Decimal(str(data.get('precio_proveedor', 0))),
            categoria=data.get('categoria', ''),
            color=data.get('color', ''),
            activo=data.get('activo', True)
        )
        
        return JsonResponse({
            'success': True,
            'message': 'Producto agregado exitosamente',
            'producto_id': producto.id,
            'numero_parte': producto.numero_parte
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        print(f"ERROR agregando producto: {e}")
        return JsonResponse({'error': 'Error interno del servidor'}, status=500)

@login_required
def gestion_catalogo_volumetria(request):
    """
    Vista para gestión del catálogo de productos de volumetría - Solo para superusuarios
    """
    # Verificar que el usuario sea superusuario
    if not request.user.is_superuser:
        messages.error(request, 'No tiene permisos para acceder a esta sección.')
        return redirect('home')
    
    if request.method == 'POST':
        try:
            action = request.POST.get('action')
            
            if action == 'agregar_producto':
                # Agregar un nuevo producto al catálogo
                numero_parte = request.POST.get('numero_parte', '').strip()
                descripcion = request.POST.get('descripcion', '').strip()
                categoria = request.POST.get('categoria', '').strip()
                color = request.POST.get('color', '').strip()
                precio_unitario = request.POST.get('precio_unitario', '0')
                precio_proveedor = request.POST.get('precio_proveedor', '0')
                marca = request.POST.get('marca', 'PANDUIT').strip()
                
                # Validaciones
                if not numero_parte or not descripcion:
                    messages.error(request, 'Número de parte y descripción son obligatorios.')
                    return redirect('gestion_catalogo_volumetria')
                
                # Verificar si ya existe
                if CatalogoCableado.objects.filter(numero_parte=numero_parte).exists():
                    messages.error(request, f'Ya existe un producto con el número de parte: {numero_parte}')
                    return redirect('gestion_catalogo_volumetria')
                
                # Crear producto
                CatalogoCableado.objects.create(
                    numero_parte=numero_parte,
                    descripcion=descripcion,
                    categoria=categoria,
                    color=color.upper(),
                    precio_unitario=Decimal(precio_unitario),
                    precio_proveedor=Decimal(precio_proveedor),
                    marca=marca.upper(),
                    activo=True
                )
                
                messages.success(request, f'Producto {numero_parte} agregado exitosamente.')
                return redirect('gestion_catalogo_volumetria')
                
            elif action == 'importar_masivo':
                # Importación masiva desde texto usando parser inteligente
                productos_texto = request.POST.get('productos_texto', '').strip()
                actualizar_existentes = request.POST.get('actualizar_existentes') == 'on'
                
                if not productos_texto:
                    messages.error(request, 'Por favor, ingrese los datos de productos.')
                    return redirect('gestion_catalogo_volumetria')
                
                productos_procesados = 0
                productos_actualizados = 0
                errores = []
                
                lineas = productos_texto.split('\n')
                for i, linea in enumerate(lineas, 1):
                    linea = linea.strip()
                    if not linea:
                        continue
                    
                    try:
                        # Usar parser inteligente para detectar productos automáticamente
                        producto_data = parse_producto_volumetria_inteligente(linea)
                        
                        if not producto_data:
                            errores.append(f'Línea {i}: No se pudo detectar el patrón número_parte-marca-descripción-precios')
                            continue
                        
                        numero_parte = producto_data['numero_parte']
                        descripcion = producto_data['descripcion']
                        categoria = producto_data['categoria']
                        color = producto_data['color']
                        precio_unitario = Decimal(str(producto_data['precio_lista']))
                        precio_proveedor = Decimal(str(producto_data['precio_proveedor']))
                        marca = producto_data['marca']
                        
                        if not numero_parte or not descripcion:
                            errores.append(f'Línea {i}: Número de parte y descripción son obligatorios')
                            continue
                        
                        # Verificar si existe
                        producto_existente = CatalogoCableado.objects.filter(numero_parte=numero_parte).first()
                        
                        if producto_existente:
                            if actualizar_existentes:
                                producto_existente.descripcion = descripcion
                                producto_existente.categoria = categoria
                                producto_existente.color = color
                                producto_existente.precio_unitario = precio_unitario
                                producto_existente.precio_proveedor = precio_proveedor
                                producto_existente.marca = marca
                                producto_existente.save()
                                productos_actualizados += 1
                            else:
                                errores.append(f'Línea {i}: Producto {numero_parte} ya existe (no se actualiza)')
                        else:
                            CatalogoCableado.objects.create(
                                numero_parte=numero_parte,
                                descripcion=descripcion,
                                categoria=categoria,
                                color=color,
                                precio_unitario=precio_unitario,
                                precio_proveedor=precio_proveedor,
                                marca=marca,
                                activo=True
                            )
                            productos_procesados += 1
                            
                    except Exception as e:
                        errores.append(f'Línea {i}: Error procesando - {str(e)}')
                
                # Mostrar resultados
                if productos_procesados > 0:
                    messages.success(request, f'Se agregaron {productos_procesados} productos nuevos.')
                if productos_actualizados > 0:
                    messages.success(request, f'Se actualizaron {productos_actualizados} productos existentes.')
                if errores:
                    for error in errores[:10]:  # Mostrar solo los primeros 10 errores
                        messages.warning(request, error)
                    if len(errores) > 10:
                        messages.warning(request, f'Y {len(errores) - 10} errores más...')
                
                return redirect('gestion_catalogo_volumetria')
                
        except Exception as e:
            messages.error(request, f'Error procesando solicitud: {str(e)}')
            return redirect('gestion_catalogo_volumetria')
    
    # GET request - Mostrar la página
    productos = CatalogoCableado.objects.all().order_by('categoria', 'numero_parte')
    
    # Estadísticas
    total_productos = productos.count()
    total_categorias = productos.values('categoria').distinct().count()
    productos_sin_precio = productos.filter(precio_unitario=0).count()
    
    # Categorías disponibles para filtro
    categorias = productos.values_list('categoria', flat=True).distinct().order_by('categoria')
    
    context = {
        'productos': productos,
        'total_productos': total_productos,
        'total_categorias': total_categorias,
        'productos_sin_precio': productos_sin_precio,
        'categorias': categorias,
    }
    
    return render(request, 'gestion_catalogo_volumetria.html', context)

@login_required
def eliminar_producto_catalogo(request, producto_id):
    """
    Eliminar un producto del catálogo de volumetría
    """
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    try:
        producto = CatalogoCableado.objects.get(id=producto_id)
        numero_parte = producto.numero_parte
        producto.delete()
        
        return JsonResponse({
            'success': True,
            'message': f'Producto {numero_parte} eliminado exitosamente'
        })
    except CatalogoCableado.DoesNotExist:
        return JsonResponse({'error': 'Producto no encontrado'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
def editar_producto_catalogo(request, producto_id):
    """
    Editar un producto del catálogo de volumetría
    """
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        producto = CatalogoCableado.objects.get(id=producto_id)
        data = json.loads(request.body)
        
        # Actualizar campos
        producto.numero_parte = data.get('numero_parte', producto.numero_parte)
        producto.descripcion = data.get('descripcion', producto.descripcion)
        producto.categoria = data.get('categoria', producto.categoria)
        producto.color = data.get('color', producto.color).upper()
        producto.precio_unitario = Decimal(str(data.get('precio_unitario', producto.precio_unitario)))
        producto.precio_proveedor = Decimal(str(data.get('precio_proveedor', producto.precio_proveedor)))
        producto.marca = data.get('marca', producto.marca).upper()
        
        producto.save()
        
        return JsonResponse({
            'success': True,
            'message': f'Producto {producto.numero_parte} actualizado exitosamente'
        })
        
    except CatalogoCableado.DoesNotExist:
        return JsonResponse({'error': 'Producto no encontrado'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
def vista_previa_volumetria_api(request):
    """
    API para vista previa de importación masiva de productos de volumetría
    """
    if not request.user.is_superuser:
        return JsonResponse({'error': 'Sin permisos'}, status=403)
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    try:
        data = json.loads(request.body)
        productos_texto = data.get('productos_texto', '').strip()
        
        if not productos_texto:
            return JsonResponse({'error': 'No hay datos para procesar'}, status=400)
        
        productos_detectados = []
        errores = []
        
        lineas = productos_texto.split('\n')
        for i, linea in enumerate(lineas, 1):
            linea = linea.strip()
            if not linea:
                continue
            
            try:
                producto_data = parse_producto_volumetria_inteligente(linea)
                
                if producto_data:
                    # Verificar si ya existe en la base de datos
                    existe = CatalogoCableado.objects.filter(numero_parte=producto_data['numero_parte']).exists()
                    
                    productos_detectados.append({
                        'linea': i,
                        'numero_parte': producto_data['numero_parte'],
                        'marca': producto_data['marca'],
                        'descripcion': producto_data['descripcion'],
                        'categoria': producto_data['categoria'],
                        'color': producto_data['color'],
                        'precio_lista': float(producto_data['precio_lista']),
                        'precio_proveedor': float(producto_data['precio_proveedor']),
                        'existe': existe,
                        'status': 'actualizar' if existe else 'nuevo'
                    })
                else:
                    errores.append({
                        'linea': i,
                        'texto': linea[:100] + '...' if len(linea) > 100 else linea,
                        'error': 'No se pudo detectar el patrón número_parte-marca-descripción-precios'
                    })
            except Exception as e:
                errores.append({
                    'linea': i,
                    'texto': linea[:100] + '...' if len(linea) > 100 else linea,
                    'error': str(e)
                })
        
        # Agrupar por marca para mejor visualización
        productos_por_marca = {}
        for producto in productos_detectados:
            marca = producto['marca']
            if marca not in productos_por_marca:
                productos_por_marca[marca] = []
            productos_por_marca[marca].append(producto)
        
        return JsonResponse({
            'success': True,
            'productos_detectados': productos_detectados,
            'productos_por_marca': productos_por_marca,
            'errores': errores,
            'total_productos': len(productos_detectados),
            'total_nuevos': len([p for p in productos_detectados if not p['existe']]),
            'total_existentes': len([p for p in productos_detectados if p['existe']]),
            'total_errores': len(errores)
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'JSON inválido'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
def sugerencias_productos_api(request):
    """
    API para obtener sugerencias de productos mientras se escribe
    """
    print(f"DEBUG: API sugerencias llamada con método: {request.method}")
    
    if request.method != 'GET':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    
    query = request.GET.get('q', '').strip()
    limit = min(int(request.GET.get('limit', 10)), 20)  # Máximo 20 sugerencias
    
    print(f"DEBUG: Query recibida: '{query}', Limit: {limit}")
    
    if len(query) < 2:
        return JsonResponse({'success': True, 'sugerencias': [], 'total': 0})
    
    try:
        print(f"DEBUG: Buscando en CatalogoCableado...")
        
        # Verificar si hay productos en el catálogo
        total_productos = CatalogoCableado.objects.count()
        productos_activos = CatalogoCableado.objects.filter(activo=True).count()
        
        print(f"DEBUG: Total productos en catálogo: {total_productos}, Activos: {productos_activos}")
        
        # Buscar productos que contengan el texto en número de parte o descripción
        productos = CatalogoCableado.objects.filter(
            activo=True
        ).filter(
            Q(numero_parte__icontains=query) | 
            Q(descripcion__icontains=query)
        ).order_by(
            # Priorizar coincidencias exactas en número de parte
            Case(
                When(numero_parte__istartswith=query, then=Value(1)),
                When(numero_parte__icontains=query, then=Value(2)),
                When(descripcion__icontains=query, then=Value(3)),
                default=Value(4)
            ),
            'numero_parte'
        )[:limit]
        
        print(f"DEBUG: Productos encontrados: {productos.count()}")
        
        sugerencias = []
        for producto in productos:
            print(f"DEBUG: Procesando producto: {producto.numero_parte}")
            sugerencia = {
                'numero_parte': producto.numero_parte,
                'descripcion': producto.descripcion[:80] + '...' if len(producto.descripcion) > 80 else producto.descripcion,
                'marca': producto.marca if producto.marca else 'N/A',
                'categoria': producto.categoria if producto.categoria else 'N/A',
                'precio_lista': float(producto.precio_unitario) if producto.precio_unitario else 0.0,
                'precio_proveedor': float(producto.precio_proveedor) if producto.precio_proveedor else 0.0,
                'color': producto.color if producto.color else 'N/A'
            }
            sugerencias.append(sugerencia)
        
        response_data = {
            'success': True,
            'sugerencias': sugerencias,
            'total': len(sugerencias)
        }
        
        print(f"DEBUG: Respuesta exitosa con {len(sugerencias)} sugerencias")
        return JsonResponse(response_data)
        
    except Exception as e:
        print(f"ERROR obteniendo sugerencias: {e}")
        import traceback
        traceback.print_exc()
        return JsonResponse({
            'success': False,
            'error': 'Error interno del servidor',
            'sugerencias': []
        }, status=500)

@login_required
def buscar_producto_catalogo_api(request):
    """
    API para buscar un producto específico en el catálogo de cableado
    por número de parte y devolver todos sus datos
    """
    numero_parte = request.GET.get('numero_parte', '').strip()
    
    if not numero_parte:
        return JsonResponse({
            'success': False,
            'error': 'Número de parte requerido'
        }, status=400)
    
    try:
        # Buscar producto por número de parte (case insensitive)
        producto = CatalogoCableado.objects.filter(
            numero_parte__iexact=numero_parte,
            activo=True
        ).first()
        
        if producto:
            data = {
                'success': True,
                'found': True,
                'producto': {
                    'numero_parte': producto.numero_parte,
                    'descripcion': producto.descripcion,
                    'precio_unitario': float(producto.precio_unitario),
                    'precio_proveedor': float(producto.precio_proveedor),
                    'marca': producto.marca,
                    'categoria': producto.categoria,
                    'color': producto.color if hasattr(producto, 'color') else '',
                    'tipo_producto': producto.tipo_producto,
                    # Calcular margen automáticamente
                    'margen_porcentaje': float(
                        ((producto.precio_unitario - producto.precio_proveedor) / producto.precio_unitario * 100) 
                        if producto.precio_unitario > 0 else 0
                    )
                }
            }
            print(f"✅ Producto encontrado: {producto.numero_parte} - ${producto.precio_unitario}")
        else:
            data = {
                'success': True,
                'found': False,
                'message': f'Producto {numero_parte} no encontrado en catálogo'
            }
            print(f"❌ Producto no encontrado: {numero_parte}")
        
        return JsonResponse(data)
        
    except Exception as e:
        print(f"ERROR buscando producto {numero_parte}: {e}")
        import traceback
        traceback.print_exc()
        return JsonResponse({
            'success': False,
            'error': 'Error interno del servidor'
        }, status=500)

@login_required
@require_http_methods(["GET"])
def buscar_productos_catalogo(request):
    """
    Endpoint para buscar productos en el catálogo de volumetría con motor inteligente.
    Filtra por tipo, categoría, marca, color, uso y texto, y prioriza palabras clave en la descripción.
    """
    try:
        query = request.GET.get('q', '').strip()
        filtros_json = request.GET.get('filtros', '{}')
        tipo_producto = request.GET.get('tipo', '').strip()
        
        print(f"🔍 Búsqueda en catálogo: query='{query}', filtros='{filtros_json}', tipo='{tipo_producto}'")

        try:
            filtros = json.loads(filtros_json)
        except json.JSONDecodeError:
            filtros = {}

        # Si no hay ni query ni filtros, no devolver nada.
        if not query and not filtros:
             return JsonResponse({'success': True, 'productos': [], 'total': 0})

        # Consulta base sobre el modelo correcto: CatalogoCableado
        productos_query = CatalogoCableado.objects.filter(activo=True)

        # 1. Priorizar y/o filtrar por palabra clave en la descripción según el tipo de producto.
        if tipo_producto:
            keyword = ''
            if tipo_producto == 'cable':
                keyword = 'bobina'
                # Filtro restrictivo para cable
                productos_query = productos_query.filter(
                    Q(descripcion__icontains='bobina') | Q(descripcion__icontains='cable')
                )
                print(f"🔌 Filtro RESTRICTIVO para 'cable'/'bobina' aplicado.")
            elif tipo_producto == 'jack':
                keyword = 'jack'
            elif tipo_producto == 'patchcord':
                keyword = 'patchcord'
            elif tipo_producto == 'faceplate':
                keyword = 'faceplate'
            
            if keyword:
                productos_query = productos_query.annotate(
                    priority=Case(
                        When(descripcion__icontains=keyword, then=Value(1)),
                        default=Value(2)
                    )
                )
                print(f"🔌 Prioridad aplicada para '{keyword}' en tipo '{tipo_producto}'.")

        # 2. Filtrar por categoría si se proporciona en los filtros.
        categoria_filtro = filtros.get('categoria')
        if categoria_filtro:
            exact_category = ''
            if categoria_filtro == '6A':
                exact_category = 'Cat6A'
            elif categoria_filtro == '6':
                exact_category = 'Cat6'
            elif categoria_filtro == '5e':
                exact_category = 'Cat5e'
            
            if exact_category:
                productos_query = productos_query.filter(categoria__iexact=exact_category)
                print(f"🎯 Filtro de categoría exacto aplicado: {exact_category}")
            else:
                productos_query = productos_query.filter(categoria__icontains=categoria_filtro)
                print(f"🎯 Filtro de categoría icontains aplicado: {categoria_filtro}")

        # 3. Filtrar por marca, color y uso.
        if 'marca' in filtros and filtros['marca']:
            productos_query = productos_query.filter(marca__iexact=filtros['marca'])
            print(f"🏷️ Filtro de marca aplicado: {filtros['marca']}")
        
        if 'color' in filtros and filtros['color']:
            productos_query = productos_query.filter(color__iexact=filtros['color'])
            print(f"🎨 Filtro de color aplicado: {filtros['color']}")

        if 'uso' in filtros and filtros['uso']:
            productos_query = productos_query.filter(descripcion__icontains=filtros['uso'])
            print(f"🏠 Filtro de uso aplicado: {filtros['uso']}")

        # 4. Filtrar por el query de texto en número de parte y descripción.
        if query:
            productos_query = productos_query.filter(
                Q(numero_parte__icontains=query) | 
                Q(descripcion__icontains=query)
            )
            print(f"🎯 Filtro de texto aplicado: '{query}'")

        # Ordenar y limitar resultados
        if tipo_producto and 'priority' in productos_query.query.annotations:
            productos = productos_query.distinct().order_by('priority', 'numero_parte')[:50]
        else:
            productos = productos_query.distinct().order_by('numero_parte')[:50]
        
        print(f"📦 Productos encontrados después del filtrado: {productos.count()}")

        # Convertir a formato JSON para la respuesta.
        productos_data = []
        for producto in productos:
            productos_data.append({
                'numero_parte': producto.numero_parte,
                'descripcion': producto.descripcion,
                'precio_lista': float(producto.precio_unitario) if producto.precio_unitario else 0.0,
                'costo_unitario': float(producto.precio_proveedor) if producto.precio_proveedor else 0.0,
                'marca': producto.marca,
                'categoria': producto.categoria or '',
            })
        
        print(f"✅ Enviando {len(productos_data)} productos al frontend")
        
        return JsonResponse({
            'success': True,
            'productos': productos_data,
            'total': len(productos_data)
        })
        
    except Exception as e:
        print(f"❌ Error en búsqueda de catálogo: {e}")
        import traceback
        traceback.print_exc()
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=500)

@login_required
@require_http_methods(["POST"])
def buscar_productos_por_numeros_parte(request):
    try:
        data = json.loads(request.body)
        numeros_parte = data.get('numeros_parte', [])

        if not numeros_parte:
            return JsonResponse({'success': False, 'error': 'No se proporcionaron números de parte'})

        productos = CatalogoCableado.objects.filter(numero_parte__in=numeros_parte, activo=True)
        
        productos_data = []
        for producto in productos:
            productos_data.append({
                'numero_parte': producto.numero_parte,
                'descripcion': producto.descripcion,
                'precio_lista': float(producto.precio_unitario) if producto.precio_unitario else 0.0,
                'costo_unitario': float(producto.precio_proveedor) if producto.precio_proveedor else 0.0,
                'marca': producto.marca,
                'categoria': producto.categoria or '',
            })

        return JsonResponse({'success': True, 'productos': productos_data})

    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)

@login_required
def get_marcas_catalogo(request):
    marcas = CatalogoCableado.objects.values_list('marca', flat=True).distinct().order_by('marca')
    return JsonResponse(list(marcas), safe=False)


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
def api_buscar_clientes(request):
    """
    API para autocompletado de clientes en el formulario de nueva oportunidad.
    """
    query = request.GET.get('q', '').strip()
    
    if len(query) < 2:
        return JsonResponse({'clientes': []})
    
    # Buscar clientes que coincidan con el query
    if is_supervisor(request.user):
        clientes = Cliente.objects.filter(
            nombre_empresa__icontains=query
        ).order_by('nombre_empresa')[:10]
    else:
        clientes = Cliente.objects.filter(
            Q(nombre_empresa__icontains=query) & 
            (Q(asignado_a=request.user) | Q(asignado_a__isnull=True))
        ).order_by('nombre_empresa')[:10]
    
    clientes_data = []
    for cliente in clientes:
        clientes_data.append({
            'id': cliente.id,
            'nombre': cliente.nombre_empresa,
            'contacto_principal': cliente.contacto_principal or '',
            'email': cliente.email or '',
            'telefono': cliente.telefono or ''
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


# ===============================================
# API PARA CRM AVANZADO DE OPORTUNIDADES
# ===============================================

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
        if not is_supervisor(request.user) and oportunidad.usuario != request.user:
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
        
        print(f"🔄 Actividad creada: {actividad.id}, estado_anterior: {actividad.estado_anterior}, estado_nuevo: {actividad.estado_nuevo}")
        
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
        
        # Verificar permisos: supervisores ven todo, usuarios solo sus propias oportunidades
        if not is_supervisor(request.user) and oportunidad.usuario != request.user:
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
        print(f"📁 Procesando {len(archivos_keys)} archivos: {archivos_keys}")
        for key in archivos_keys:
            archivo = request.FILES[key]
            print(f"📄 Procesando archivo: {archivo.name}, tamaño: {archivo.size}, tipo: {archivo.content_type}")
            
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
            
            print(f"📋 Tipo determinado: {tipo_archivo}")
            
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
                
                print(f"✅ Archivo guardado exitosamente: ID={archivo_obj.id}, URL={archivo_obj.archivo.url}")
                
                archivos_subidos.append({
                    'id': archivo_obj.id,
                    'nombre': archivo_obj.nombre_original,
                    'tipo': archivo_obj.tipo,
                    'tamaño': archivo_obj.tamaño,
                    'url': archivo_obj.archivo.url if archivo_obj.archivo else None
                })
                
            except Exception as e:
                print(f"❌ Error guardando archivo {archivo.name}: {e}")
                import traceback
                print(traceback.format_exc())
        
        # Crear actividad en el timeline con referencia al comentario
        descripcion_actividad = contenido[:200] + ('...' if len(contenido) > 200 else '')
        if archivos_subidos:
            if contenido:
                descripcion_actividad += f" ({len(archivos_subidos)} archivo{'s' if len(archivos_subidos) > 1 else ''} adjunto{'s' if len(archivos_subidos) > 1 else ''})"
            else:
                descripcion_actividad = f"Subió {len(archivos_subidos)} archivo{'s' if len(archivos_subidos) > 1 else ''}"
        
        # Agregar referencia al comentario en la descripción para linking directo
        descripcion_actividad += f" [COMENTARIO_ID:{comentario.id}]"
        
        print(f"🔥 Creando actividad - Usuario: {request.user}, Usuario ID: {request.user.id}, Nombre: {request.user.get_full_name()}")
        actividad_creada = OportunidadActividad.objects.create(
            oportunidad=oportunidad,
            tipo='comentario',
            titulo='Nuevo Comentario' + (' con archivos' if archivos_subidos else ''),
            descripcion=descripcion_actividad,
            usuario=request.user
        )
        print(f"💬 Actividad creada: ID={actividad_creada.id}, Usuario={actividad_creada.usuario}, Descripcion='{actividad_creada.descripcion}'")
        
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
        print(f"Error en agregar_comentario_oportunidad: {str(e)}")
        print(traceback.format_exc())
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def timeline_oportunidad(request, oportunidad_id):
    """
    API para obtener el timeline completo de una oportunidad
    """
    from datetime import timedelta
    
    oportunidad = get_object_or_404(TodoItem, id=oportunidad_id)
    
    # Verificar permisos: supervisores ven todo, usuarios solo sus propias oportunidades
    if not is_supervisor(request.user) and oportunidad.usuario != request.user:
        return JsonResponse({'error': 'No tienes permisos para ver este timeline'}, status=403)
    
    try:
        # Limpiar actividades huérfanas antes de generar el timeline
        try:
            limpiar_actividades_huerfanas(oportunidad)
        except Exception as e:
            print(f"Error limpiando actividades huérfanas: {e}")
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
        
        print(f"🗑️ Eliminando comentario ID={comentario_id}, usuario={usuario_comentario}, fecha={fecha_comentario}")
        
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
                        print(f"🎯 Actividad {actividad.id} apunta al comentario que se va a eliminar: {comentario_id}")
                else:
                    # Estrategia 2: Fallback para actividades del sistema viejo
                    # Verificar por rango de tiempo
                    diff_tiempo = abs((actividad.fecha_creacion - fecha_comentario).total_seconds())
                    if diff_tiempo <= 300:  # 5 minutos
                        deberia_eliminar = True
                        print(f"⏱️ Actividad {actividad.id} encontrada por tiempo: diff={diff_tiempo}s")
                    
                    # Verificar por usuario y descripción similar
                    if (actividad.usuario == usuario_comentario and 
                        comentario.contenido in actividad.descripcion):
                        deberia_eliminar = True
                        print(f"📝 Actividad {actividad.id} encontrada por contenido")
                
                if deberia_eliminar:
                    print(f"🗑️ Eliminando actividad relacionada ID={actividad.id}")
                    actividad.delete()
                    actividades_eliminadas += 1
            
            print(f"✅ Eliminadas {actividades_eliminadas} actividades relacionadas")
            
        except Exception as e:
            print(f"⚠️ Error eliminando actividades relacionadas: {e}")
            # No fallar si no se pueden eliminar las actividades, el comentario sí se debe eliminar
        
        # Eliminar el comentario
        comentario.delete()
        print(f"✅ Comentario ID={comentario_id} eliminado exitosamente")
        
        return JsonResponse({
            'success': True,
            'message': 'Comentario eliminado exitosamente',
            'oportunidad_id': oportunidad_id
        })
        
    except Exception as e:
        print(f"❌ Error eliminando comentario: {e}")
        return JsonResponse({'error': str(e)}, status=500)


def limpiar_actividades_huerfanas(oportunidad):
    """
    Función para limpiar actividades de comentario que ya no tienen comentario asociado
    """
    try:
        actividades_comentario = OportunidadActividad.objects.filter(
            oportunidad=oportunidad,
            tipo='comentario'
        )
        
        comentarios_existentes = OportunidadComentario.objects.filter(
            oportunidad=oportunidad
        )
        
        actividades_huerfanas = []
        
        for actividad in actividades_comentario:
            # Buscar si existe un comentario para esta actividad usando el nuevo sistema de IDs
            comentario_encontrado = False
            
            # Estrategia 1: Buscar por ID directo en la descripción (nuevo sistema)
            import re
            match = re.search(r'\[COMENTARIO_ID:(\d+)\]', actividad.descripcion or '')
            if match:
                comentario_id = int(match.group(1))
                if comentarios_existentes.filter(id=comentario_id).exists():
                    comentario_encontrado = True
                    print(f"✅ Actividad {actividad.id} tiene comentario válido: {comentario_id}")
                else:
                    print(f"❌ Actividad {actividad.id} referencia comentario inexistente: {comentario_id}")
            else:
                # Estrategia 2: Fallback para actividades del sistema viejo (por tiempo y usuario)
                for comentario in comentarios_existentes:
                    # Verificar por rango de tiempo
                    diff_tiempo = abs((actividad.fecha_creacion - comentario.fecha_creacion).total_seconds())
                    if (diff_tiempo <= 300 and  # 5 minutos
                        actividad.usuario == comentario.usuario):
                        comentario_encontrado = True
                        print(f"✅ Actividad {actividad.id} encontrada por tiempo: comentario {comentario.id}")
                        break
                    
                    # Verificar por contenido en descripción
                    if (actividad.usuario == comentario.usuario and 
                        comentario.contenido in actividad.descripcion):
                        comentario_encontrado = True
                        print(f"✅ Actividad {actividad.id} encontrada por contenido: comentario {comentario.id}")
                        break
            
            if not comentario_encontrado:
                actividades_huerfanas.append(actividad)
        
        # Eliminar actividades huérfanas
        if actividades_huerfanas:
            print(f"🧹 Limpiando {len(actividades_huerfanas)} actividades huérfanas")
            for actividad in actividades_huerfanas:
                print(f"🗑️ Eliminando actividad huérfana ID={actividad.id}")
                actividad.delete()
        
    except Exception as e:
        print(f"⚠️ Error limpiando actividades huérfanas: {e}")


@login_required
def descargar_archivo_oportunidad(request, archivo_id):
    """
    Vista para descargar archivos adjuntos de oportunidades
    """
    try:
        archivo = get_object_or_404(OportunidadArchivo, id=archivo_id)
        
        # Verificar permisos: supervisores ven todo, usuarios solo archivos de sus oportunidades
        if not is_supervisor(request.user) and archivo.oportunidad.usuario != request.user:
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
        print(f"❌ Error descargando archivo: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def vista_previa_archivo_oportunidad(request, archivo_id):
    """
    Vista para mostrar archivos en vista previa (inline)
    """
    try:
        archivo = get_object_or_404(OportunidadArchivo, id=archivo_id)
        
        # Verificar permisos: supervisores ven todo, usuarios solo archivos de sus oportunidades
        if not is_supervisor(request.user) and archivo.oportunidad.usuario != request.user:
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
        print(f"❌ Error en vista previa de archivo: {e}")
        return HttpResponse(f'Error al abrir archivo: {str(e)}', status=500)


# ==========================================
# APIs DE NOTIFICACIONES
# ==========================================

@login_required
def obtener_notificaciones_api(request):
    """
    API para obtener las notificaciones del usuario actual
    """
    try:
        user = request.user
        
        # Obtener notificaciones del usuario (últimas 50)
        notificaciones = Notificacion.objects.filter(
            usuario_destinatario=user
        ).select_related(
            'usuario_remitente', 'oportunidad', 'comentario'
        ).order_by('-fecha_creacion')[:50]
        
        # Contar notificaciones no leídas
        unread_count = Notificacion.objects.filter(
            usuario_destinatario=user,
            leida=False
        ).count()
        
        # Serializar notificaciones
        notifications_data = []
        for notif in notificaciones:
            notifications_data.append({
                'id': notif.id,
                'titulo': notif.titulo,
                'mensaje': notif.mensaje,
                'tipo': notif.tipo,
                'leida': notif.leida,
                'fecha': convert_to_tijuana_time(notif.fecha_creacion).strftime('%d/%m/%Y %H:%M'),
                'remitente': notif.usuario_remitente.get_full_name() if notif.usuario_remitente else 'Sistema',
                'url': notif.get_url(),
            })
        
        return JsonResponse({
            'success': True,
            'notifications': notifications_data,
            'unread_count': unread_count
        })
        
    except Exception as e:
        print(f"❌ Error obteniendo notificaciones: {e}")
        return JsonResponse({
            'success': False,
            'error': 'Error al obtener notificaciones'
        }, status=500)


@login_required
@require_http_methods(["POST"])
def marcar_notificacion_leida_api(request, notificacion_id):
    """
    API para marcar una notificación específica como leída
    """
    try:
        notificacion = get_object_or_404(
            Notificacion, 
            id=notificacion_id, 
            usuario_destinatario=request.user
        )
        
        notificacion.marcar_como_leida()
        
        return JsonResponse({
            'success': True,
            'message': 'Notificación marcada como leída'
        })
        
    except Exception as e:
        print(f"❌ Error marcando notificación como leída: {e}")
        return JsonResponse({
            'success': False,
            'error': 'Error al marcar notificación como leída'
        }, status=500)


@login_required
@require_http_methods(["POST"])
def marcar_todas_notificaciones_leidas_api(request):
    """
    API para marcar todas las notificaciones del usuario como leídas
    """
    try:
        # Marcar todas las notificaciones no leídas del usuario
        notificaciones_no_leidas = Notificacion.objects.filter(
            usuario_destinatario=request.user,
            leida=False
        )
        
        count = notificaciones_no_leidas.update(
            leida=True,
            fecha_lectura=timezone.now()
        )
        
        return JsonResponse({
            'success': True,
            'message': f'{count} notificaciones marcadas como leídas'
        })
        
    except Exception as e:
        print(f"❌ Error marcando todas las notificaciones como leídas: {e}")
        return JsonResponse({
            'success': False,
            'error': 'Error al marcar notificaciones como leídas'
        }, status=500)


def crear_notificacion(usuario_destinatario, tipo, titulo, mensaje, oportunidad=None, comentario=None, usuario_remitente=None, proyecto_id=None, proyecto_nombre=None):
    """
    Función auxiliar para crear notificaciones
    """
    try:
        # No crear notificación si el remitente y destinatario son el mismo
        if usuario_remitente and usuario_destinatario == usuario_remitente:
            return None
            
        notificacion = Notificacion.objects.create(
            usuario_destinatario=usuario_destinatario,
            usuario_remitente=usuario_remitente,
            tipo=tipo,
            titulo=titulo,
            mensaje=mensaje,
            oportunidad=oportunidad,
            comentario=comentario,
            proyecto_id=proyecto_id,
            proyecto_nombre=proyecto_nombre
        )
        
        print(f"✅ Notificación creada: {titulo} para {usuario_destinatario.username}")
        return notificacion
        
    except Exception as e:
        print(f"❌ Error creando notificación: {e}")
        return None

def notificar_miembro_agregado_proyecto(usuario_agregado, proyecto_nombre, proyecto_id, usuario_que_agrega):
    """
    Función específica para notificar cuando se agrega un usuario a un proyecto
    """
    titulo = f"Te han agregado al proyecto: {proyecto_nombre}"
    mensaje = f"{usuario_que_agrega.get_full_name() or usuario_que_agrega.username} te ha agregado como miembro del proyecto '{proyecto_nombre}'. Ahora puedes colaborar en este proyecto."
    
    return crear_notificacion(
        usuario_destinatario=usuario_agregado,
        tipo='proyecto_agregado',
        titulo=titulo,
        mensaje=mensaje,
        usuario_remitente=usuario_que_agrega,
        proyecto_id=proyecto_id,
        proyecto_nombre=proyecto_nombre
    )


def detectar_menciones_en_comentario(contenido, usuario_remitente, oportunidad, comentario=None):
    """
    Detecta menciones @usuario en un comentario y crea notificaciones
    """
    import re
    
    # Buscar menciones en el formato @usuario
    menciones = re.findall(r'@(\w+)', contenido)
    
    for username in menciones:
        try:
            usuario_mencionado = User.objects.get(username=username)
            
            # Crear notificación de mención
            crear_notificacion(
                usuario_destinatario=usuario_mencionado,
                tipo='mencion',
                titulo='Te han mencionado en un comentario',
                mensaje=f'{usuario_remitente.get_full_name() or usuario_remitente.username} te mencionó en la oportunidad "{oportunidad.oportunidad}": {contenido[:100]}...',
                oportunidad=oportunidad,
                comentario=comentario,
                usuario_remitente=usuario_remitente
            )
            
        except User.DoesNotExist:
            # Usuario mencionado no existe, ignorar
            pass




@login_required
@require_http_methods(["POST"])
def actualizar_avatar(request):
    """
    API para actualizar el avatar del usuario
    """
    try:
        # Obtener o crear el perfil del usuario
        user_profile, created = UserProfile.objects.get_or_create(user=request.user)
        
        # Verificar si se envió un archivo de avatar
        if 'avatar' in request.FILES:
            avatar_file = request.FILES['avatar']
            
            # Validar tipo de archivo
            allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
            if avatar_file.content_type not in allowed_types:
                return JsonResponse({
                    'success': False, 
                    'error': 'Tipo de archivo no permitido. Solo se permiten imágenes (JPG, PNG, GIF, WebP)'
                })
            
            # Validar tamaño de archivo (máximo 5MB)
            if avatar_file.size > 5 * 1024 * 1024:
                return JsonResponse({
                    'success': False, 
                    'error': 'El archivo es demasiado grande. Máximo 5MB permitido'
                })
            
            # Eliminar avatar anterior si existe
            if user_profile.avatar:
                try:
                    user_profile.avatar.delete(save=False)
                except:
                    pass  # Ignorar errores al eliminar archivo anterior
            
            # Guardar nuevo avatar
            user_profile.avatar = avatar_file
            user_profile.save()
            
            return JsonResponse({
                'success': True,
                'message': 'Avatar actualizado correctamente',
                'avatar_url': user_profile.get_avatar_url()
            })
        else:
            return JsonResponse({
                'success': False,
                'error': 'No se envió ningún archivo de avatar'
            })
            
    except Exception as e:
        return JsonResponse({
            'success': False,
            'error': f'Error al actualizar avatar: {str(e)}'
        })

@login_required
@user_passes_test(lambda u: u.is_superuser)
def bitrix_sync_admin(request):
    """
    Vista de administración para sincronización con Bitrix24
    """
    if request.method == 'POST':
        action = request.POST.get('action')
        
        if action == 'sync_deletions':
            # Sincronizar eliminaciones
            from .bitrix_integration import get_all_bitrix_deals
            
            try:
                # Obtener todas las oportunidades locales con bitrix_deal_id
                local_opportunities = TodoItem.objects.filter(bitrix_deal_id__isnull=False)
                
                # Obtener todos los deals de Bitrix24
                bitrix_deals = get_all_bitrix_deals()
                if not bitrix_deals:
                    messages.error(request, 'No se pudieron obtener deals de Bitrix24')
                    return redirect('bitrix-sync-admin')
                
                # Crear set de IDs que existen en Bitrix24
                bitrix_deal_ids = {str(deal['ID']) for deal in bitrix_deals}
                
                # Encontrar oportunidades locales que ya no existen en Bitrix24
                opportunities_to_delete = []
                for opportunity in local_opportunities:
                    if str(opportunity.bitrix_deal_id) not in bitrix_deal_ids:
                        opportunities_to_delete.append(opportunity)
                
                # Eliminar las oportunidades
                deleted_count = 0
                for opportunity in opportunities_to_delete:
                    try:
                        opportunity.delete()
                        deleted_count += 1
                    except Exception as e:
                        print(f"Error eliminando oportunidad {opportunity.id}: {e}")
                
                if deleted_count > 0:
                    messages.success(request, f'Se eliminaron {deleted_count} oportunidades que ya no existen en Bitrix24')
                else:
                    messages.info(request, 'No hay oportunidades para eliminar. Todo está sincronizado.')
                    
            except Exception as e:
                messages.error(request, f'Error durante la sincronización: {str(e)}')
        
        elif action == 'import_all':
            # Importar todas las oportunidades
            from django.core.management import call_command
            from io import StringIO
            
            try:
                out = StringIO()
                call_command('import_bitrix_opportunities', stdout=out)
                output = out.getvalue()
                messages.success(request, f'Importación completada: {output}')
            except Exception as e:
                messages.error(request, f'Error durante la importación: {str(e)}')
        
        elif action == 'sync_lost_opportunities':
            # Ejecutar sincronización de oportunidades perdidas
            try:
                from django.core.management import call_command
                from io import StringIO
                
                # Capturar la salida del comando
                out = StringIO()
                call_command('sync_lost_opportunities', stdout=out)
                output = out.getvalue()
                
                # Extraer estadísticas del output
                lines = output.split('\n')
                stats_found = False
                for line in lines:
                    if 'Oportunidades perdidas encontradas:' in line:
                        found_count = line.split(':')[-1].strip()
                        messages.success(
                            request, 
                            f'Sincronización completada. Se encontraron {found_count} oportunidades perdidas que fueron actualizadas.'
                        )
                        stats_found = True
                        break
                
                if not stats_found:
                    messages.success(request, 'Sincronización de oportunidades perdidas completada')
                    
            except Exception as e:
                messages.error(request, f'Error durante la sincronización: {str(e)}')
        
        elif action == 'full_bitrix_sync':
            # Ejecutar sincronización completa bidireccional
            try:
                from django.core.management import call_command
                from io import StringIO
                
                # Capturar la salida del comando
                out = StringIO()
                call_command('full_bitrix_sync', stdout=out)
                output = out.getvalue()
                
                # Extraer estadísticas del output
                lines = output.split('\n')
                for line in lines:
                    if 'Nuevas importadas:' in line:
                        new_count = line.split(':')[-1].strip()
                    elif 'Actualizadas:' in line:
                        updated_count = line.split(':')[-1].strip()
                    elif 'Perdidas detectadas:' in line:
                        lost_count = line.split(':')[-1].strip()
                
                messages.success(
                    request, 
                    f'Sincronización completa terminada. Nuevas: {new_count if "new_count" in locals() else "0"}, '
                    f'Actualizadas: {updated_count if "updated_count" in locals() else "0"}, '
                    f'Perdidas: {lost_count if "lost_count" in locals() else "0"}'
                )
                    
            except Exception as e:
                messages.error(request, f'Error durante la sincronización completa: {str(e)}')
        
        return redirect('bitrix-sync-admin')
    
    # GET request - mostrar estadísticas
    context = {
        'total_opportunities': TodoItem.objects.count(),
        'active_opportunities': TodoItem.objects.count() - len([item for item in TodoItem.objects.all() if is_lost_opportunity(item.bitrix_stage_id)]),
        'lost_opportunities': len([item for item in TodoItem.objects.all() if is_lost_opportunity(item.bitrix_stage_id)]),
        'bitrix_opportunities': TodoItem.objects.filter(bitrix_deal_id__isnull=False).count(),
        'local_opportunities': TodoItem.objects.filter(bitrix_deal_id__isnull=True).count(),
    }
    
    return render(request, 'bitrix_sync_admin.html', context)

def handle_lost_opportunity(opportunity, action='log_only'):
    """
    Maneja oportunidades marcadas como "Cerrado Perdido" en Bitrix24
    
    Actions:
    - 'log_only': Solo registra en logs (default)
    - 'delete': Elimina la oportunidad
    - 'mark_inactive': Marca como inactiva (requiere campo adicional)
    """
    opportunity_name = opportunity.oportunidad if hasattr(opportunity, 'oportunidad') else 'Oportunidad'
    
    if action == 'delete':
        opportunity.delete()
        print(f"BITRIX WEBHOOK: 🗑️ Oportunidad '{opportunity_name}' eliminada por estar marcada como PERDIDA", flush=True)
        return {'deleted': True}
    elif action == 'mark_inactive':
        # Si implementas un campo 'activa' en el modelo
        # opportunity.activa = False
        # opportunity.save()
        print(f"BITRIX WEBHOOK: 📴 Oportunidad '{opportunity_name}' marcada como inactiva por estar PERDIDA", flush=True)
        return {'marked_inactive': True}
    else:  # log_only
        print(f"BITRIX WEBHOOK: ⚠️ Oportunidad '{opportunity_name}' está marcada como PERDIDA en Bitrix24 (solo registro)", flush=True)
        return {'logged': True}

@login_required
@user_passes_test(lambda u: u.is_superuser)
@login_required  
def bitrix_lost_opportunities(request):
    """
    Vista para mostrar y gestionar oportunidades marcadas como "Cerrado Perdido"
    """
    if request.method == 'POST':
        action = request.POST.get('action')
        opportunity_id = request.POST.get('opportunity_id')
        
        if opportunity_id and action in ['delete', 'reactivate']:
            try:
                opportunity = TodoItem.objects.get(id=opportunity_id)
                
                if action == 'delete':
                    opportunity_name = opportunity.oportunidad
                    opportunity.delete()
                    messages.success(request, f'Oportunidad "{opportunity_name}" eliminada exitosamente')
                elif action == 'reactivate':
                    # Cambiar el estado a uno activo (ej: Cotizando)
                    opportunity.bitrix_stage_id = 'UC_YUQKW6'  # Cotizando
                    opportunity.save()
                    messages.success(request, f'Oportunidad "{opportunity.oportunidad}" reactivada')
                    
            except TodoItem.DoesNotExist:
                messages.error(request, 'Oportunidad no encontrada')
            except Exception as e:
                messages.error(request, f'Error: {str(e)}')
        
        return redirect('bitrix-lost-opportunities')
    
    # Obtener oportunidades perdidas usando detección precisa
    all_opportunities = TodoItem.objects.select_related('cliente', 'usuario').all()
    lost_ids = [item.id for item in all_opportunities if is_lost_opportunity(item.bitrix_stage_id)]
    lost_opportunities = TodoItem.objects.filter(id__in=lost_ids).select_related('cliente', 'usuario').order_by('-fecha_actualizacion')
    
    context = {
        'lost_opportunities': lost_opportunities,
        'total_lost': lost_opportunities.count(),
    }
    
    return render(request, 'bitrix_lost_opportunities.html', context)


def enviar_notificacion_cumpleanos():
    """
    Función para enviar notificación de cumpleaños a todos los usuarios excepto al cumpleañero
    Solo se ejecuta una vez por día
    """
    from datetime import date
    
    try:
        # Verificar si ya se envió la notificación hoy
        hoy = date.today()
        titulo_cumpleanos = "🎉 ¡Cumpleaños de Stefanny Corral! 🎂"
        
        # Buscar si ya existe una notificación de cumpleaños de hoy
        notificacion_existente = Notificacion.objects.filter(
            titulo=titulo_cumpleanos,
            fecha_creacion__date=hoy
        ).first()
        
        if notificacion_existente:
            print("ℹ️ Ya se envió la notificación de cumpleaños hoy")
            return True
        
        # Buscar usuario Stefanny Corral
        try:
            stefanny = User.objects.get(
                Q(first_name__icontains='stefanny') & Q(last_name__icontains='corral') |
                Q(username__icontains='stefanny')
            )
        except User.DoesNotExist:
            print("❌ No se encontró usuario Stefanny Corral")
            return False
        except User.MultipleObjectsReturned:
            stefanny = User.objects.filter(
                Q(first_name__icontains='stefanny') & Q(last_name__icontains='corral')
            ).first()
        
        # Obtener todos los usuarios activos excepto Stefanny
        usuarios_destinatarios = User.objects.filter(
            is_active=True
        ).exclude(id=stefanny.id)
        
        mensaje = (
            f"¡Hoy es el cumpleaños de {stefanny.get_full_name() or stefanny.username}! 🎈\n\n"
            "¡Únete a la celebración y envíale tus mejores deseos! 🎁✨\n\n"
            "¡Que tenga un día maravilloso lleno de alegría y felicidad! 🌟"
        )
        
        notificaciones_creadas = 0
        
        # Crear notificación para cada usuario
        for usuario in usuarios_destinatarios:
            notificacion = crear_notificacion(
                usuario_destinatario=usuario,
                tipo='sistema',
                titulo=titulo_cumpleanos,
                mensaje=mensaje,
                usuario_remitente=None  # Sistema
            )
            
            if notificacion:
                notificaciones_creadas += 1
        
        print(f"✅ Se enviaron {notificaciones_creadas} notificaciones de cumpleaños")
        return True
        
    except Exception as e:
        print(f"❌ Error enviando notificaciones de cumpleaños: {e}")
        return False
        
# ----------------------------------------------------------------------
# views_cotizaciones.py — Cotizaciones, PDFs, and client catalog.
# ----------------------------------------------------------------------

import base64
import time
from django.template.loader import render_to_string
from weasyprint import HTML
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
from django.views.decorators.clickjacking import xframe_options_sameorigin
from .views_utils import *

# ── Tipo de cambio USD→MXN en tiempo real (cache 1 hora) ──
_tc_cache = {'rate': None, 'ts': 0}

def get_tipo_cambio_usd_mxn():
    """Obtiene tipo de cambio USD→MXN. Cache de 1 hora, fallback a settings."""
    now = time.time()
    if _tc_cache['rate'] and (now - _tc_cache['ts']) < 3600:
        return _tc_cache['rate']
    fallback = Decimal(str(getattr(settings, 'TIPO_CAMBIO_USD_MXN', '20.00')))
    try:
        r = requests.get('https://api.frankfurter.app/latest?from=USD&to=MXN', timeout=5)
        if r.status_code == 200:
            rate = Decimal(str(r.json()['rates']['MXN']))
            _tc_cache['rate'] = rate
            _tc_cache['ts'] = now
            return rate
    except Exception:
        pass
    try:
        r = requests.get('https://open.er-api.com/v6/latest/USD', timeout=5)
        if r.status_code == 200:
            rate = Decimal(str(r.json()['rates']['MXN']))
            _tc_cache['rate'] = rate
            _tc_cache['ts'] = now
            return rate
    except Exception:
        pass
    return fallback

@login_required
def api_cliente_cotizaciones(request, cliente_id):
    """API que devuelve las cotizaciones de un cliente específico."""
    try:
        cliente = Cliente.objects.get(id=cliente_id)
    except Cliente.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Cliente no encontrado'}, status=404)

    qs = Cotizacion.objects.select_related('oportunidad', 'created_by').filter(cliente=cliente).order_by('-fecha_creacion')

    def fmt(val):
        try:
            return '{:,.0f}'.format(val or 0)
        except (ValueError, TypeError):
            return '0'

    rows = []
    for c in qs:
        rows.append({
            'id': c.id,
            'titulo': c.titulo or 'Cotización',
            'oportunidad': c.oportunidad.oportunidad[:35] if c.oportunidad else '—',
            'oportunidad_id': c.oportunidad_id,
            'usuario': c.created_by.get_full_name() or c.created_by.username if c.created_by else '—',
            'fecha': c.fecha_creacion.strftime('%d/%m/%y') if c.fecha_creacion else '—',
            'subtotal': fmt(c.subtotal),
            'total': fmt(c.total),
            'total_raw': float(c.total or 0),
            'moneda': c.moneda or 'MXN',
            'pdf_url': f'/app/cotizacion/view/{c.id}/',
        })

    return JsonResponse({
        'success': True,
        'cliente_nombre': cliente.nombre_empresa,
        'rows': rows,
    })


@login_required
def api_clientes_rapido(request):
    """GET: lista de clientes. POST: crear cliente rápido."""
    if request.method == 'GET':
        from .views_grupos import get_clientes_visibles_q
        clientes = Cliente.objects.filter(
            get_clientes_visibles_q(request.user)
        ).order_by('nombre_empresa')
        data = [{'id': c.id, 'nombre': c.nombre_empresa} for c in clientes]
        return JsonResponse({'clientes': data})
    elif request.method == 'POST':
        try:
            body = json.loads(request.body)
        except Exception:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        nombre = (body.get('nombre') or '').strip()
        if not nombre:
            return JsonResponse({'error': 'Nombre requerido'}, status=400)
        cliente = Cliente.objects.create(
            nombre_empresa=nombre,
            asignado_a=request.user,
        )
        return JsonResponse({'id': cliente.id, 'nombre': cliente.nombre_empresa})
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@login_required
def api_oportunidades_rapido(request):
    """GET: oportunidades de un cliente. POST: crea oportunidad rápida."""
    if request.method == 'GET':
        cliente_id = request.GET.get('cliente_id')
        if not cliente_id:
            return JsonResponse({'opps': []})
        qs = TodoItem.objects.filter(cliente_id=cliente_id).order_by('-id')
        if not is_supervisor(request.user):
            from .views_grupos import get_usuarios_visibles_ids
            _gids = get_usuarios_visibles_ids(request.user)
            qs = qs.filter(usuario_id__in=_gids) if _gids and len(_gids) > 1 else qs.filter(usuario=request.user)
        data = [{'id': o.id, 'nombre': o.oportunidad} for o in qs[:50]]
        return JsonResponse({'opps': data})
    elif request.method == 'POST':
        try:
            body = json.loads(request.body)
        except Exception:
            return JsonResponse({'error': 'JSON inválido'}, status=400)
        nombre = (body.get('nombre') or '').strip()
        cliente_id = body.get('cliente_id')
        if not nombre or not cliente_id:
            return JsonResponse({'error': 'Nombre y cliente requeridos'}, status=400)
        try:
            cliente = Cliente.objects.get(id=cliente_id)
        except Cliente.DoesNotExist:
            return JsonResponse({'error': 'Cliente no encontrado'}, status=404)
        today = timezone.localdate()
        opp = TodoItem.objects.create(
            usuario=request.user,
            oportunidad=nombre,
            cliente=cliente,
            producto='ZEBRA',
            monto=Decimal('0.00'),
            probabilidad_cierre=5,
            mes_cierre=str(today.month).zfill(2),
            anio_cierre=today.year,
            area='SISTEMAS',
            tipo_negociacion='runrate',
            estado_crm='nueva',
        )
        return JsonResponse({'id': opp.id, 'nombre': opp.oportunidad})
    return JsonResponse({'error': 'Método no permitido'}, status=405)


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
            from .views_grupos import get_clientes_visibles_q
            clients_queryset = Cliente.objects.filter(get_clientes_visibles_q(request.user))
            print(f"DEBUG: Usuario {request.user.username} es vendedor. Obteniendo clientes visibles (propios + grupo).")

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


@login_required
@csrf_exempt
@xframe_options_sameorigin
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
            # Actualizar fecha_actualizacion de la oportunidad vinculada para que suba en la tabla CRM
            if cotizacion.oportunidad:
                cotizacion.oportunidad.save(update_fields=['fecha_actualizacion'])
            print(f"DEBUG: Quote saved with ID: {cotizacion.id}")

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

            # Actualizar siempre el monto de la oportunidad con el subtotal (sin IVA) en MXN
            if cotizacion.oportunidad and cotizacion.subtotal > 0:
                opp = cotizacion.oportunidad
                monto_mxn = cotizacion.subtotal
                if cotizacion.moneda and cotizacion.moneda.upper() == 'USD':
                    tc = get_tipo_cambio_usd_mxn()
                    monto_mxn = (cotizacion.subtotal * tc).quantize(Decimal('0.01'))
                opp.monto = monto_mxn
                opp.save(update_fields=['monto', 'fecha_actualizacion'])
            
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
            
            # Notificar al chat de grupo si la cotización es de un cliente asignado a otro miembro
            try:
                cliente_cot = cotizacion.cliente
                if cliente_cot and hasattr(cliente_cot, 'asignado_a') and cliente_cot.asignado_a and cliente_cot.asignado_a != request.user:
                    from .views_grupos import registrar_accion_grupo
                    actor_nombre = request.user.get_full_name() or request.user.username
                    registrar_accion_grupo(
                        request.user, cliente_cot.asignado_a, 'crear_cotizacion',
                        f'{actor_nombre} creó la cotización "{cotizacion.titulo or f"COT-{cotizacion.id}"}" para el cliente {cliente_cot.nombre_empresa}',
                        objeto_tipo='cotizacion', objeto_id=cotizacion.id,
                        objeto_titulo=cotizacion.titulo or f'COT-{cotizacion.id}',
                    )
            except Exception:
                pass

            # Check if this is a widget_mode request (AJAX from iframe)
            is_widget_mode = request.POST.get('widget_mode') == '1' or request.GET.get('widget_mode') == '1'

            if is_widget_mode:
                # Return JSON response for the widget iframe
                from django.urls import reverse
                pdf_url = reverse('generate_cotizacion_pdf', args=[cotizacion.id])
                return JsonResponse({
                    'success': True,
                    'cotizacion_id': cotizacion.id,
                    'pdf_url': pdf_url,
                })

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
            'widget_mode': request.GET.get('widget_mode') == '1',
        }
        return render(request, 'crear_cotizacion.html', context)


@login_required
@xframe_options_sameorigin
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
        'usuario_final': cotizacion_original.usuario_final,
        'oportunidad': cotizacion_original.oportunidad.id if cotizacion_original.oportunidad else None,
        'descripcion': cotizacion_original.descripcion,
        'comentarios': cotizacion_original.comentarios,
        'nombre_cotizacion': cotizacion_original.nombre_cotizacion,
        'iva_rate': cotizacion_original.iva_rate,
        'moneda': cotizacion_original.moneda,
        'tipo_cotizacion': cotizacion_original.tipo_cotizacion,
        'descuento_visible': cotizacion_original.descuento_visible,
    }

    is_widget = request.GET.get('widget_mode') == '1'
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
        'widget_mode': is_widget,
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
            from .views_grupos import get_usuarios_visibles_ids as _get_vis_ids
            _vis_ids = _get_vis_ids(request.user)
            if _vis_ids is None:
                cotizaciones_qs = Cotizacion.objects.filter(cliente=cliente)
            else:
                cotizaciones_qs = Cotizacion.objects.filter(cliente=cliente, created_by__in=_vis_ids)

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
    
        # Verificar si la oportunidad está ligada a un proyecto
        try:
            from app.models import Proyecto
            proyecto_ligado = Proyecto.objects.filter(oportunidades_ligadas=oportunidad).first()
        except:
            proyecto_ligado = None
        
        context = {
    
            'oportunidad': oportunidad,
    
            'cotizaciones': cotizaciones,
    
            'volumetrias': volumetrias,
    
            'tiene_cotizaciones': cotizaciones.exists(),
    
            'tiene_volumetrias': volumetrias.exists(),
    
            'tipo_contenido': tipo_contenido,
    
            'is_engineer': True,
            
            'proyecto_ligado': proyecto_ligado,
    
        }
    
    # Asegurarse de que context esté definido antes de usarlo
    if 'context' not in locals():
        context = {}
    
    # Verificar que la oportunidad esté en el contexto
    if 'oportunidad' not in context:
        context['oportunidad'] = oportunidad
    
    return render(request, 'cotizaciones_por_oportunidad.html', context)


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
        from .views_grupos import get_usuarios_visibles_ids as _get_vis_ids
        _vis_ids = _get_vis_ids(user)
        if _vis_ids is None:
            cotizaciones = Cotizacion.objects.filter(cliente=cliente)
        else:
            cotizaciones = Cotizacion.objects.filter(cliente=cliente, created_by__in=_vis_ids)
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
def api_clientes(request):
    """
    Retorna lista de clientes para filtros
    """
    try:
        from .views_grupos import get_clientes_visibles_q
        clientes = Cliente.objects.filter(
            get_clientes_visibles_q(request.user)
        ).values('id', 'nombre_empresa')
        return JsonResponse({'clientes': list(clientes)})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

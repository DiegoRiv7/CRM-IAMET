from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponse, JsonResponse
from django.contrib import messages
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required, user_passes_test
from .models import TodoItem, Cliente, Cotizacion, DetalleCotizacion, UserProfile, Contacto
from . import views_exportar
from .forms import VentaForm, VentaFilterForm, CotizacionForm, ClienteForm, OportunidadModalForm
from django.db.models import Sum, Count, F, Q
from django.db.models.functions import Upper, Coalesce
from django.db.models import Value
from datetime import date
from dateutil.relativedelta import relativedelta
from decimal import Decimal
from django.utils.html import json_script
import json
from django.urls import reverse
from django.utils import timezone

# Importaciones para generación de PDF
from weasyprint import HTML
from django.template.loader import render_to_string

# Asegúrate de importar tu modelo Cotizacion y DetalleCotizacion
from .models import Cotizacion, DetalleCotizacion

# Importaciones para el logo Base64
import base64
import os

# Función auxiliar para comprobar si el usuario es supervisor
def is_supervisor(user):
    return user.groups.filter(name='Supervisores').exists()

# Función auxiliar para obtener el display de un valor de choice
def _get_display_for_value(value, choices_list):
    return dict(choices_list).get(value, value)

# Vistas principales y funcionales

@login_required
def get_oportunidades_por_cliente(request):
    cliente_id = request.GET.get('cliente_id')

    if is_supervisor(request.user):
        if cliente_id:
            oportunidades = TodoItem.objects.filter(cliente_id=cliente_id).order_by('-fecha_creacion')
        else:
            # If no client_id, return the 20 most recent opportunities for supervisors
            oportunidades = TodoItem.objects.all().order_by('-fecha_creacion')[:20]
    else:
        if cliente_id:
            oportunidades = TodoItem.objects.filter(cliente_id=cliente_id, usuario=request.user).order_by('-fecha_creacion')
        else:
            # If no client_id, return the 20 most recent opportunities for the current user
            oportunidades = TodoItem.objects.filter(usuario=request.user).order_by('-fecha_creacion')[:20]

    

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
    # Determinar perfil
    perfil = "SUPERVISOR" if is_supervisor(request.user) else "VENDEDOR"
    # Fecha actual
    fecha_actual = timezone.localtime(timezone.now()).strftime('%A, %d de %B de %Y')

    # Usuario del mes: más ventas cerradas (probabilidad 100%) del mes ANTERIOR, solo vendedores
    today = date.today()
    inicio_mes_actual = today.replace(day=1)
    # Calcular el inicio y fin del mes anterior
    inicio_mes_anterior = (inicio_mes_actual - relativedelta(months=1))
    fin_mes_anterior = inicio_mes_actual - relativedelta(days=1)
    ventas_mes = (
        TodoItem.objects.filter(probabilidad_cierre=100, fecha_creacion__date__gte=inicio_mes_anterior, fecha_creacion__date__lte=fin_mes_anterior)
        .exclude(usuario__groups__name='Supervisores')
        .values('usuario')
        .annotate(ventas_cerradas=Count('id'))
        .order_by('-ventas_cerradas')
    )
    usuario_mes = None
    monto_vendido_mes = 0
    if ventas_mes:
        user_id = ventas_mes[0]['usuario']
        user = User.objects.get(id=user_id)
        # Calcular el monto total vendido por este usuario en el mes anterior (probabilidad 100%)
        monto_vendido_mes = TodoItem.objects.filter(
            probabilidad_cierre=100,
            fecha_creacion__date__gte=inicio_mes_anterior,
            fecha_creacion__date__lte=fin_mes_anterior,
            usuario=user
        ).aggregate(total=Sum('monto'))['total'] or 0
        usuario_mes = {
            'nombre': user.get_full_name() or user.username,
            'avatar_url': f'https://ui-avatars.com/api/?name={user.get_full_name() or user.username}&background=38bdf8&color=fff',
            'ventas_cerradas': ventas_mes[0]['ventas_cerradas'],
            'monto_vendido_mes': monto_vendido_mes,
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
        usuario_dia = {
            'nombre': user.get_full_name() or user.username,
            'avatar_url': f'https://ui-avatars.com/api/?name={user.get_full_name() or user.username}&background=f472b6&color=fff',
            'oportunidades_hoy': oportunidades_hoy[0]['oportunidades_hoy'],
        }
    # Si no hay oportunidades hoy, usuario_dia queda en None

    # Últimas oportunidades (de todos)
    ultimas_oportunidades_qs = TodoItem.objects.select_related('cliente', 'usuario').order_by('-fecha_creacion')[:8]
    ultimas_oportunidades = [
        {
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
def dashboard(request):
    # Determinar si el usuario es un supervisor
    if is_supervisor(request.user):
        # Si es supervisor, obtiene todas las oportunidades de todos los usuarios
        user_opportunities = TodoItem.objects.all()
        print("DEBUG: Usuario es supervisor. Obteniendo todas las oportunidades.")
    else:
        # Si no es supervisor, solo obtiene las oportunidades del usuario actual
        user_opportunities = TodoItem.objects.filter(usuario=request.user)
        print(f"DEBUG: Usuario {request.user.username} es vendedor. Obteniendo sus propias oportunidades.")

    # 1. Cliente con más/menos ventas cerradas (100% probabilidad)
    # Las ventas cerradas se filtran por usuario si no es supervisor
    ventas_cerradas_query = TodoItem.objects.filter(probabilidad_cierre=100, cliente__isnull=False)
    if not is_supervisor(request.user):
        ventas_cerradas_query = ventas_cerradas_query.filter(usuario=request.user)

    cliente_mas_vendido = None
    cliente_menos_vendido = None

    ventas_por_cliente_cerradas = ventas_cerradas_query.values('cliente__nombre_empresa', 'cliente__id').annotate( # Asegura cliente__id
        total_vendido=Sum('monto')
    ).order_by('-total_vendido')

    if ventas_por_cliente_cerradas.exists():
        cliente_mas_vendido = ventas_por_cliente_cerradas.first()
        cliente_menos_vendido = ventas_por_cliente_cerradas.last()

    # 2. Producto más/menos vendido (total de oportunidades y ventas cerradas)
    # La consulta de productos también debe considerar el rol de supervisor
    productos_data_base_query = TodoItem.objects.all() if is_supervisor(request.user) else TodoItem.objects.filter(usuario=request.user)

    productos_data_raw = productos_data_base_query.annotate(
        # Convertir el campo 'producto' a mayúsculas para la agrupación
        producto_upper=Upper('producto')
    ).values('producto_upper').annotate(
        count_oportunidades=Count('id'),
        total_monto=Sum('monto'),
        # Suma el monto SOLO si la probabilidad de cierre es 100%
        total_vendido_cerrado=Sum('monto', filter=Q(probabilidad_cierre=100))
    ).order_by('-count_oportunidades') # Ordenar para encontrar el "más vendido"

    productos_data_with_display = []
    for item in productos_data_raw:
        item_copy = item.copy()
        # Usa 'producto_upper' para obtener el display, ya que es el valor normalizado
        item_copy['get_producto_display'] = _get_display_for_value(item_copy['producto_upper'], TodoItem.PRODUCTO_CHOICES)
        # Asegúrate de que total_vendido_cerrado sea 0.00 si es None
        item_copy['total_vendido_cerrado'] = item_copy['total_vendido_cerrado'] or Decimal('0.00')
        productos_data_with_display.append(item_copy)

    productos_data_sorted_asc = sorted(productos_data_with_display, key=lambda x: x['count_oportunidades'])
    productos_data_sorted_desc = sorted(productos_data_with_display, key=lambda x: x['count_oportunidades'], reverse=True)

    # --- Marca más vendida y menos vendida (usando producto como proxy de marca) ---
    marca_mas_vendida = None
    marca_menos_vendida = None

    # Ordenar productos por total vendido cerrado (ventas reales por marca)
    productos_sorted_by_ventas = sorted(productos_data_with_display, key=lambda x: x['total_vendido_cerrado'] or Decimal('0.00'), reverse=True)
    productos_sorted_by_ventas_asc = sorted(productos_data_with_display, key=lambda x: x['total_vendido_cerrado'] or Decimal('0.00'))

    if productos_sorted_by_ventas:
        top_brand = productos_sorted_by_ventas[0]
        marca_mas_vendida = {
            'marca': top_brand['producto_upper'],
            'nombre_marca': top_brand['get_producto_display'],
            'total_vendido': top_brand['total_vendido_cerrado'],
        }
    if productos_sorted_by_ventas_asc:
        least_brand = productos_sorted_by_ventas_asc[0]
        marca_menos_vendida = {
            'marca': least_brand['producto_upper'],
            'nombre_marca': least_brand['get_producto_display'],
            'total_vendido': least_brand['total_vendido_cerrado'],
        }

    # --- Producto más/menos vendido (por cantidad de oportunidades, para compatibilidad con otras vistas) ---
    producto_mas_vendido = None
    producto_menos_vendido = None
    if productos_data_sorted_desc:
        producto_mas_vendido = productos_data_sorted_desc[0]
    if productos_data_sorted_asc:
        producto_menos_vendido = productos_data_sorted_asc[0]

    if producto_mas_vendido:
        producto_mas_vendido_context = {
            'producto': producto_mas_vendido['producto_upper'],
            'get_producto_display': producto_mas_vendido['get_producto_display'],
            'count_oportunidades': producto_mas_vendido['count_oportunidades'],
            'total_vendido_cerrado': producto_mas_vendido['total_vendido_cerrado'],
        }
    else:
        producto_mas_vendido_context = None

    if producto_menos_vendido:
        producto_menos_vendido_context = {
            'producto': producto_menos_vendido['producto_upper'],
            'get_producto_display': producto_menos_vendido['get_producto_display'],
            'count_oportunidades': producto_menos_vendido['count_oportunidades'],
            'total_vendido_cerrado': producto_menos_vendido['total_vendido_cerrado'],
        }
    else:
        producto_menos_vendido_context = None

    # --- Cliente Top (más ventas cerradas) ---
    if is_supervisor(request.user):
        top_cliente_qs = (TodoItem.objects.filter(probabilidad_cierre=100)
            .values('cliente__nombre_empresa')
            .annotate(total_vendido=Sum('monto'))
            .order_by('-total_vendido'))
    else:
        top_cliente_qs = (TodoItem.objects.filter(probabilidad_cierre=100, usuario=request.user)
            .values('cliente__nombre_empresa')
            .annotate(total_vendido=Sum('monto'))
            .order_by('-total_vendido'))
    if top_cliente_qs:
        cliente_top_nombre = top_cliente_qs[0]['cliente__nombre_empresa']
        cliente_top_monto = top_cliente_qs[0]['total_vendido']
        # Oportunidades abiertas (1-99%) para ese cliente
        if is_supervisor(request.user):
            abiertas = TodoItem.objects.filter(cliente__nombre_empresa=cliente_top_nombre, probabilidad_cierre__gte=1, probabilidad_cierre__lte=99)
        else:
            abiertas = TodoItem.objects.filter(cliente__nombre_empresa=cliente_top_nombre, probabilidad_cierre__gte=1, probabilidad_cierre__lte=99, usuario=request.user)
        cliente_top_oportunidades_abiertas = abiertas.count()
        # Porcentaje de avance respecto a meta
        meta_cliente_top = 400000 if is_supervisor(request.user) else 130000
        porcentaje_cliente_top = int((cliente_top_monto / meta_cliente_top * 100) if meta_cliente_top > 0 else 0)
        stroke_dashoffset_cliente_top = 339.292 - (339.292 * porcentaje_cliente_top / 100)
        # Productos más vendidos a cliente top
        productos_cliente_top = (TodoItem.objects.filter(cliente__nombre_empresa=cliente_top_nombre, probabilidad_cierre=100)
            .values('producto')
            .annotate(total_vendido=Sum('monto'))
            .order_by('-total_vendido'))
        # Convertir a lista de dicts con display name
        productos_cliente_top_list = []
        for p in productos_cliente_top:
            display = dict(TodoItem.PRODUCTO_CHOICES).get(p['producto'], p['producto'])
            productos_cliente_top_list.append({'producto': display, 'total_vendido': p['total_vendido'] or 0})
    else:
        cliente_top_nombre = None
        cliente_top_monto = 0
        cliente_top_oportunidades_abiertas = 0
        porcentaje_cliente_top = 0
        stroke_dashoffset_cliente_top = 339.292
        productos_cliente_top_list = []

    # --- Lógica para el Mes Actual (Cobrado) ---
    hoy = date.today()
    mes_actual_val = str(hoy.month).zfill(2)
    mes_actual_nombre = dict(TodoItem.MES_CHOICES).get(mes_actual_val, f"Mes {hoy.month}")
    oportunidades_mes_actual = TodoItem.objects.filter(mes_cierre=mes_actual_val, probabilidad_cierre=100)
    if not is_supervisor(request.user):
        oportunidades_mes_actual = oportunidades_mes_actual.filter(usuario=request.user)
    monto_cobrado_mes_actual = oportunidades_mes_actual.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')
    META_MENSUAL = Decimal('350000.00') if is_supervisor(request.user) else Decimal('130000.00')
    porcentaje_cobertura_mes_actual = int((monto_cobrado_mes_actual / META_MENSUAL * 100) if META_MENSUAL > 0 else 0)
    stroke_dashoffset_mes_actual = 339.292 - (339.292 * porcentaje_cobertura_mes_actual / 100)

    # --- Lógica para el Próximo Mes y Alerta de Meta ---
    # Obtener el próximo mes
    today = date.today()
    next_month_date = today + relativedelta(months=1)
    next_month_value = next_month_date.month # El valor numérico del mes

    # Obtener el nombre del próximo mes para la visualización
    next_month_display = dict(TodoItem.MES_CHOICES).get(str(next_month_value).zfill(2), f"Mes {next_month_value}")

    # Obtener las oportunidades del próximo mes (considerando el rol)
    oportunidades_proximo_mes_query = TodoItem.objects.filter(mes_cierre=str(next_month_value).zfill(2))
    if not is_supervisor(request.user):
        oportunidades_proximo_mes_query = oportunidades_proximo_mes_query.filter(usuario=request.user)

    total_oportunidades_proximo_mes = oportunidades_proximo_mes_query.exclude(probabilidad_cierre=0).count()
    total_monto_esperado_proximo_mes = oportunidades_proximo_mes_query.aggregate(sum_monto=Sum('monto'))['sum_monto'] or Decimal('0.00')


    # Lógica para la alerta de meta
    META_MENSUAL = Decimal('350000.00') if is_supervisor(request.user) else Decimal('130000.00')
    total_ponderado_proximo_mes = Decimal('0.00') # Inicializar como Decimal

    for op in oportunidades_proximo_mes_query: # Iterar sobre el queryset filtrado
        if 70 <= op.probabilidad_cierre <= 100:
            total_ponderado_proximo_mes += op.monto * Decimal('1.00') # Alta importancia
        elif 50 <= op.probabilidad_cierre <= 69:
            total_ponderado_proximo_mes += op.monto * Decimal('0.50') # Media importancia
        else: # op.probabilidad_cierre < 50
            total_ponderado_proximo_mes += op.monto * Decimal('0.10') # Baja importancia

    alerta_proximo_mes = {
        'status': '',
        'message': '',
        'icon': ''
    }

    if total_ponderado_proximo_mes >= META_MENSUAL:
        alerta_proximo_mes['status'] = 'success'
        alerta_proximo_mes['message'] = '¡Meta mensual alcanzada o superada!'
        alerta_proximo_mes['icon'] = 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' # Checkmark circle
    elif total_ponderado_proximo_mes >= META_MENSUAL * Decimal('0.70'): # Multiplicar por Decimal
        alerta_proximo_mes['status'] = 'warning'
        alerta_proximo_mes['message'] = 'Cerca de la meta, aún es posible alcanzarla.'
        alerta_proximo_mes['icon'] = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' # Exclamation triangle
    else:
        alerta_proximo_mes['status'] = 'danger'
        alerta_proximo_mes['message'] = 'Se requiere más esfuerzo para alcanzar la meta.'
        alerta_proximo_mes['icon'] = 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z' # X-mark circle


    # --- TOTAL PERDIDO (0% probabilidad) ---
    oportunidades_perdidas_query = TodoItem.objects.filter(probabilidad_cierre=0)
    if not is_supervisor(request.user):
        oportunidades_perdidas_query = oportunidades_perdidas_query.filter(usuario=request.user)

    total_perdido_monto = oportunidades_perdidas_query.aggregate(
        sum_monto=Sum('monto')
    )['sum_monto'] or Decimal('0.00') # Asegurar que sea Decimal
    total_perdido_count = oportunidades_perdidas_query.count()


    # --- Ventas por mes (para gráfica) ---
    from django.db.models.functions import TruncMonth
    from django.utils.timezone import now
    hoy = now().date()
    # Agrupa ventas por mes_cierre (real, no fecha_creacion)
    ano_actual = hoy.year
    ventas_por_mes_qs = TodoItem.objects.filter(
        probabilidad_cierre=100,
        mes_cierre__isnull=False
    ).exclude(mes_cierre='')
    if not is_supervisor(request.user):
        ventas_por_mes_qs = ventas_por_mes_qs.filter(usuario=request.user)
    ventas_por_mes = ventas_por_mes_qs.values('mes_cierre').annotate(monto=Sum('monto')).order_by('mes_cierre')
    # Prepara lista de 12 meses (enero a diciembre)
    ventas_por_mes_dict = {v['mes_cierre']: float(v['monto'] or 0) for v in ventas_por_mes}
    ventas_por_mes_list = []
    for i in range(1, 13):
        mes_key = str(i).zfill(2)
        ventas_por_mes_list.append({'mes': f'{ano_actual}-{mes_key}', 'monto': ventas_por_mes_dict.get(mes_key, 0)})

    context = {
        'cliente_mas_vendido': cliente_mas_vendido,
        'cliente_menos_vendido': cliente_menos_vendido,
        'marca_mas_vendida': marca_mas_vendida,
        'marca_menos_vendida': marca_menos_vendida,
        'producto_mas_vendido': producto_mas_vendido_context, # Usamos el nuevo contexto
        'producto_menos_vendido': producto_menos_vendido_context, # Usamos el nuevo contexto para menos vendido
        # Datos del cliente top
        'productos_cliente_top_list': productos_cliente_top_list,
        'ventas_por_mes_list': ventas_por_mes_list,
        'porcentaje_cliente_top': porcentaje_cliente_top,
        'stroke_dashoffset_cliente_top': stroke_dashoffset_cliente_top,
        'cliente_top_nombre': cliente_top_nombre,
        'cliente_top_monto': cliente_top_monto,
        'cliente_top_oportunidades_abiertas': cliente_top_oportunidades_abiertas,
        # Datos del mes actual
        'monto_cobrado_mes_actual': monto_cobrado_mes_actual,
        'porcentaje_cobertura_mes_actual': porcentaje_cobertura_mes_actual,
        'mes_actual_nombre': mes_actual_nombre,
        'mes_actual_val': mes_actual_val,
        'stroke_dashoffset_mes_actual': stroke_dashoffset_mes_actual,

        # Datos del próximo mes
        'next_month_display': next_month_display,
        'total_oportunidades_proximo_mes': total_oportunidades_proximo_mes,
        'total_monto_esperado_proximo_mes': total_monto_esperado_proximo_mes,
        'alerta_proximo_mes': alerta_proximo_mes,
        'proximo_mes_val': str(next_month_value).zfill(2),

        # Total Perdido
        'total_perdido_monto': total_perdido_monto,
        'total_perdido_count': total_perdido_count,
        'is_supervisor': is_supervisor(request.user), # Pasamos si el usuario es supervisor al contexto
    }
    return render (request, "dashboard.html", context)


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
                'id': str(client.id), # Convertir ID a string para consistencia con JSON
                'name': client.nombre_empresa, # Mapear nombre_empresa a 'name'
                'address': client.direccion, # Mapear direccion a 'address'
                'taxId': client.email # Mapear email a 'taxId' (o el campo que uses para ID Fiscal)
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

    detalles_cotizacion = DetalleCotizacion.objects.filter(cotizacion=cotizacion)
    iva_rate_percentage = (cotizacion.iva_rate * Decimal('100')).quantize(Decimal('1'))

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
    else: # Default to Bajanet
        template_name = 'cotizacion_pdf_template.html'
        company_name = 'BAJANET S.A. de C.V.'
        company_address = 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México'
        company_phone = '+52 55 1234 5678'
        company_email = 'ventas@bajanet.com'
        try:
            logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'img', 'bajanet_logo.png')
            with open(logo_path, "rb") as image_file:
                logo_base64 = base64.b64encode(image_file.read()).decode('utf-8')
        except FileNotFoundError:
            logo_base64 = ""


    context = {
        'cotizacion': cotizacion,
        'detalles_cotizacion': detalles_cotizacion,
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
    # Determinar si el usuario es un supervisor
    if is_supervisor(request.user):
        items = TodoItem.objects.all()
    else:
        items = TodoItem.objects.filter(usuario=request.user)

    filter_form = VentaFilterForm(request.GET)

    if filter_form.is_valid():
        area = filter_form.cleaned_data.get('area')
        producto = filter_form.cleaned_data.get('producto')
        orden_monto = filter_form.cleaned_data.get('orden_monto')
        probabilidad_min = filter_form.cleaned_data.get('probabilidad_min')
        probabilidad_max = filter_form.cleaned_data.get('probabilidad_max')
        mes_cierre = filter_form.cleaned_data.get('mes_cierre')

        if area:
            items = items.filter(area=area)
        if producto:
            # Modificación aquí: hacer la búsqueda del producto insensible a mayúsculas/minúsculas
            items = items.filter(producto__iexact=producto) # Usa icontains o iexact para insensibilidad
        if probabilidad_min is not None:
            items = items.filter(probabilidad_cierre__gte=probabilidad_min)
        if probabilidad_max is not None:
            items = items.filter(probabilidad_cierre__lte=probabilidad_max)
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
        items = items.order_by('-fecha_creacion')

    print(f"DEBUG: Total items en vista 'todos' después de filtros: {items.count()}")
    for item in items:
        print(f"DEBUG:    - ID: {item.id}, Oportunidad: {item.oportunidad}, Producto: {item.producto}, Usuario ID: {item.usuario.id}")


    context = {
        "items":items,
        "filter_form": filter_form,
        "is_supervisor": is_supervisor(request.user), # También pasamos esto al template de "todos"
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

def user_login(request):
    if request.method == 'POST':
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)
            return redirect('home') # Redirigir a 'home' después de iniciar sesión
    else:
        form = AuthenticationForm()
    return render(request, 'login.html', {'form': form, 'hide_dock': True}) # Pasar hide_dock=True para ocultar el dock

@login_required
def user_logout(request):
    logout(request)
    return redirect('user_login')

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
def crear_cotizacion_view(request, cliente_id=None, oportunidad_id=None):
    cliente_seleccionado = None
    oportunidad_seleccionada = None

    print(f"DEBUG: crear_cotizacion_view - Request method: {request.method}")
    
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
        user = request.user
        try:
            # CORRECTO: Buscar el cliente por su bitrix_company_id, que es lo que la URL del widget nos da.
            cliente_seleccionado = Cliente.objects.get(bitrix_company_id=cliente_id)
        except Cliente.DoesNotExist:
            # Si el cliente no existe, es posible que la sincronización aún no haya ocurrido.
            # Forzamos la sincronización de este cliente específico.
            company_details = get_bitrix_company_details(cliente_id, request=request)
            if company_details:
                cliente_seleccionado, created = Cliente.objects.get_or_create(
                    bitrix_company_id=company_details['ID'],
                    defaults={'nombre_empresa': company_details['TITLE']}
                )
            else:
                messages.error(request, f"El cliente con Bitrix ID {cliente_id} no se encuentra en Bitrix24. Por favor, seleccione un cliente existente o cree uno nuevo.")
                return redirect('crear_cotizacion')

    if cliente_seleccionado:
        print(f"DEBUG: crear_cotizacion_view - Cliente seleccionado: {cliente_seleccionado.nombre_empresa}")
    else:
        print("DEBUG: crear_cotizacion_view - No hay cliente seleccionado.")

    if request.method == 'POST':
        # Instantiate the form with POST data, and provide the user-specific queryset for the cliente field
        form = CotizacionForm(request.POST, user=request.user)

        if form.is_valid():
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

            productos_list = [productos_data[key] for key in sorted(productos_data.keys(), key=int)]
            print(f"DEBUG: productos_list before saving details: {productos_list}")

            calculated_subtotal = Decimal('0.00')
            for item_data in productos_list:
                try:
                    cantidad = int(item_data.get('cantidad', 0))
                    precio = Decimal(item_data.get('precio', '0.00'))
                    descuento = Decimal(item_data.get('descuento', '0.00'))
                    
                    item_total = cantidad * precio
                    item_total -= item_total * (descuento / Decimal('100.00'))
                    calculated_subtotal += item_total.quantize(Decimal('0.01'))
                    print(f"DEBUG_CALC: Item: {item_data.get('nombre')}, Quantity: {cantidad}, Price: {precio}, Discount: {descuento}, Item Total (rounded): {item_total.quantize(Decimal('0.01'))}")
                except (ValueError, TypeError) as e:
                    cotizacion.delete()
                    return JsonResponse({'success': False, 'errors': {'__all__': [{'message': f'Invalid product data in row. Error: {e}'}]}}, status=400)

            cotizacion.subtotal = calculated_subtotal.quantize(Decimal('0.01'))
            
            try:
                cotizacion.iva_rate = Decimal(request.POST.get('iva_rate', '0.00'))
            except (ValueError, TypeError):
                cotizacion.iva_rate = Decimal('0.00')

            cotizacion.iva_amount = (cotizacion.subtotal * cotizacion.iva_rate).quantize(Decimal('0.01'))
            cotizacion.total = (cotizacion.subtotal + cotizacion.iva_amount).quantize(Decimal('0.01'))

            descuento_visible_str = request.POST.get('descuento_visible', 'true')
            cotizacion.descuento_visible = descuento_visible_str.lower() == 'true'
            cotizacion.tipo_cotizacion = request.POST.get('tipo_cotizacion')
            
            cotizacion.save(update_fields=['subtotal', 'iva_rate', 'iva_amount', 'total', 'descuento_visible', 'tipo_cotizacion', 'oportunidad'])
            print(f"DEBUG: Quote totals updated. Subtotal: {cotizacion.subtotal}, IVA: {cotizacion.iva_amount}, Total: {cotizacion.total}, Quote Type: {cotizacion.tipo_cotizacion}")
            
            for item_data in productos_list:
                try:
                    DetalleCotizacion.objects.create(
                        cotizacion=cotizacion,
                        nombre_producto=item_data.get('nombre', ''),
                        descripcion=item_data.get('descripcion', ''),
                        cantidad=int(item_data.get('cantidad', 1)),
                        precio_unitario=Decimal(item_data.get('precio', '0.00')),
                        descuento_porcentaje=Decimal(item_data.get('descuento', '0.00')),
                        marca=item_data.get('marca', ''),
                        no_parte=item_data.get('no_parte', '')
                    )
                    print(f"DEBUG: Product detail created: {item_data.get('nombre')}")
                except (ValueError, TypeError) as e:
                    cotizacion.delete()
                    return JsonResponse({'success': False, 'errors': {'__all__': [{'message': f'Invalid product data in row. Error: {e}'}]}}, status=400)

            pdf_url = reverse('generate_cotizacion_pdf', args=[cotizacion.id])
            print(f"DEBUG: PDF URL generated: {pdf_url}")

            try:
                html_string = render_to_string('cotizacion_pdf_template.html', {
                    'cotizacion': cotizacion,
                    'detalles_cotizacion': cotizacion.detalles.all(),
                    'request_user': request.user,
                    'current_date': date.today(),
                    'company_name': 'BAJANET S.A. de C.V.',
                    'company_address': 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México',
                    'company_phone': '+52 55 1234 5678',
                    'company_email': 'ventas@bajanet.com',
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
            
            return JsonResponse({'success': True, 'pdf_url': pdf_url})

        else:
            errors_dict = {}
            for field, field_errors in form.errors.items():
                errors_dict[field] = [{'message': str(e), 'code': e.code if hasattr(e, 'code') else 'invalid'} for e in field_errors]
            print(f"DEBUG: Form errors: {errors_dict}")
            return JsonResponse({'success': False, 'errors': errors_dict}, status=400)

    else: # If the request is GET
        initial_data = {}
        if oportunidad_seleccionada:
            initial_data['titulo'] = oportunidad_seleccionada.oportunidad
            initial_data['cliente'] = oportunidad_seleccionada.cliente.id if oportunidad_seleccionada.cliente else None
            initial_data['oportunidad'] = oportunidad_seleccionada.id

        form = CotizacionForm(initial=initial_data, user=request.user)
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
        }
        return render(request, 'crear_cotizacion.html', context)


@login_required
def editar_cotizacion_view(request, cotizacion_id):
    cotizacion_original = get_object_or_404(Cotizacion, pk=cotizacion_id)
    detalles_originales = DetalleCotizacion.objects.filter(cotizacion=cotizacion_original)

    detalles_list = [{
        'marca': d.marca,
        'no_parte': d.no_parte,
        'descripcion': d.descripcion,
        'cantidad': d.cantidad,
        'precio': str(d.precio_unitario),
        'descuento': str(d.descuento_porcentaje),
    } for d in detalles_originales]

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

    # Define the URL where the form should be submitted (always the creation URL)
    form_action_url = reverse('crear_cotizacion_with_id', args=[cotizacion_original.cliente.id])

    context = {
        'form': CotizacionForm(instance=cotizacion_original, user=request.user),
        'cliente_seleccionado': cotizacion_original.cliente,
        'clientes_data_json': json.dumps(clientes_data_json),
        'cliente_id_inicial': cotizacion_original.cliente.id,
        'detalles_cotizacion': detalles_list,
        'form_action_url': form_action_url,  # Pass the correct action URL
    }

    return render(request, 'crear_cotizacion.html', context)



@login_required
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

    detalles_cotizacion = DetalleCotizacion.objects.filter(cotizacion=cotizacion)
    iva_rate_percentage = (cotizacion.iva_rate * Decimal('100')).quantize(Decimal('1'))

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
    else: # Default to Bajanet
        template_name = 'cotizacion_pdf_template.html'
        company_name = 'BAJANET S.A. de C.V.'
        company_address = 'Calle Ficticia #123, Colonia Ejemplo, Ciudad de México'
        company_phone = '+52 55 1234 5678'
        company_email = 'ventas@bajanet.com'
        try:
            logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'img', 'bajanet_logo.png')
            with open(logo_path, "rb") as image_file:
                logo_base64 = base64.b64encode(image_file.read()).decode('utf-8')
        except FileNotFoundError:
            logo_base64 = ""


    context = {
        'cotizacion': cotizacion,
        'detalles_cotizacion': detalles_cotizacion,
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
from .bitrix_integration import get_bitrix_company_details, get_bitrix_deal_details
from django.contrib.auth.models import User

import traceback

@csrf_exempt
def bitrix_webhook_receiver(request):
    """
    Receives webhook notifications from Bitrix24.
    This view handles the 'ONCRMDEALADD' event to create a new opportunity (TodoItem)
    in the local database when a new deal is created in Bitrix24.
    """
    if request.method != 'POST':
        print("BITRIX WEBHOOK: Received non-POST request. Ignoring.", flush=True)
        return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)

    try:
        data = request.POST
        event = data.get('event')

        print(f"BITRIX WEBHOOK: Received event '{event}'", flush=True)

        if event == 'ONCRMDEALADD':
            deal_id = data.get('data[FIELDS][ID]')
            if not deal_id:
                print("BITRIX WEBHOOK: 'ONCRMDEALADD' event received but no deal ID found.", flush=True)
                return JsonResponse({'status': 'error', 'message': 'Deal ID missing'}, status=400)

            print(f"BITRIX WEBHOOK: Processing ONCRMDEALADD for Deal ID: {deal_id}", flush=True)

            # Check if this deal has already been created to avoid duplicates.
            if TodoItem.objects.filter(bitrix_deal_id=deal_id).exists():
                print(f"BITRIX WEBHOOK: An opportunity for Deal ID {deal_id} already exists. Skipping creation.", flush=True)
                return JsonResponse({'status': 'success', 'message': 'Duplicate ignored'})

            deal_details = get_bitrix_deal_details(deal_id, request=request)
            if not deal_details:
                print(f"BITRIX WEBHOOK: Could not fetch details for Deal ID: {deal_id}", flush=True)
                return JsonResponse({'status': 'error', 'message': 'Could not fetch deal details'}, status=400)

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
                    usuario = User.objects.get(userprofile__bitrix_user_id=assigned_by_id)
                    print(f"BITRIX WEBHOOK: Found user '{usuario.username}' for Assigned ID: {assigned_by_id}", flush=True)
                except User.DoesNotExist:
                    print(f"BITRIX WEBHOOK: User with Bitrix User ID {assigned_by_id} not found in local DB.", flush=True)
            else:
                print("BITRIX WEBHOOK: Deal has no assigned user.", flush=True)

            # --- Create the Opportunity (TodoItem) ---
            if cliente and usuario:
                # Mapeo de nombres de meses a números de dos dígitos
                MONTH_NAME_TO_NUMBER_MAPPING = {
                    "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
                    "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
                    "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12"
                }

                # Mapeo de valores de Bitrix a los campos del modelo
                producto = deal_details.get('UF_CRM_1752859685662')
                area = deal_details.get('UF_CRM_1752859525038')
                mes_cierre_bitrix = deal_details.get('UF_CRM_1752859877756')
                
                # Convertir el mes de Bitrix al formato esperado por Django
                mes_cierre = MONTH_NAME_TO_NUMBER_MAPPING.get(mes_cierre_bitrix.lower(), '01') if mes_cierre_bitrix else '01'

                probabilidad_cierre = deal_details.get('UF_CRM_1752855787179')

                # Limpiar el valor de probabilidad para que sea solo el número
                if probabilidad_cierre:
                    probabilidad_cierre = int("".join(filter(str.isdigit, probabilidad_cierre)))
                else:
                    probabilidad_cierre = 5 # Valor por defecto si no viene de Bitrix

                new_opportunity = TodoItem.objects.create(
                    oportunidad=deal_details.get('TITLE', 'Oportunidad sin título'),
                    monto=deal_details.get('OPPORTUNITY', 0.0) or 0.0,
                    cliente=cliente,
                    usuario=usuario,
                    bitrix_deal_id=deal_id,
                    producto=producto,
                    area=area,
                    mes_cierre=mes_cierre,
                    probabilidad_cierre=probabilidad_cierre,
                )
                print(f"BITRIX WEBHOOK: Successfully created new opportunity '{new_opportunity.oportunidad}' with ID {new_opportunity.id}", flush=True)
            else:
                missing_info = []
                if not cliente: missing_info.append("cliente")
                if not usuario: missing_info.append("usuario")
                print(f"BITRIX WEBHOOK: Could not create opportunity for Deal ID {deal_id} because the following are missing: {', '.join(missing_info)}", flush=True)

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

@csrf_exempt
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
def crear_oportunidad_api(request):
    if request.method == 'POST':
        form = OportunidadModalForm(request.POST)
        if form.is_valid():
            cliente_id = request.POST.get('cliente')
            nombre_oportunidad = request.POST.get('nombre_oportunidad')
            cliente = get_object_or_404(Cliente, pk=cliente_id)

            oportunidad = form.save(commit=False)
            oportunidad.oportunidad = nombre_oportunidad
            oportunidad.cliente = cliente
            if not is_supervisor(request.user):
                oportunidad.usuario = request.user
            else:
                # If user is a supervisor, you might want to assign a default user or handle it differently
                # For now, let's assign it to the supervisor themselves
                oportunidad.usuario = request.user
            oportunidad.save()

            try:
                opportunity_data = {
                    'oportunidad': oportunidad.oportunidad,
                    'monto': float(oportunidad.monto),
                    'cliente': cliente.nombre_empresa,
                    'bitrix_company_id': cliente.bitrix_company_id,
                    'producto': oportunidad.producto,
                    'area': oportunidad.area,
                    'mes_cierre': oportunidad.mes_cierre,
                    'probabilidad_cierre': oportunidad.probabilidad_cierre,
                    'comentarios': oportunidad.comentarios,
                    'bitrix_stage_id': oportunidad.bitrix_stage_id,
                    'bitrix_contact_id': oportunidad.contacto.bitrix_contact_id if oportunidad.contacto else None,
                }
                bitrix_assigned_by_id = None
                if oportunidad.usuario and hasattr(oportunidad.usuario, 'userprofile') and oportunidad.usuario.userprofile.bitrix_user_id:
                    bitrix_assigned_by_id = oportunidad.usuario.userprofile.bitrix_user_id
                opportunity_data['bitrix_assigned_by_id'] = bitrix_assigned_by_id
                
                bitrix_response = send_opportunity_to_bitrix(opportunity_data, request=request)
                
                if bitrix_response and bitrix_response.get('result'):
                    oportunidad.bitrix_deal_id = bitrix_response.get('result')
                    oportunidad.save(update_fields=['bitrix_deal_id'])
                    return JsonResponse({'success': True, 'oportunidad': {'id': oportunidad.id, 'nombre': oportunidad.oportunidad}})
                else:
                    return JsonResponse({'success': False, 'errors': 'Failed to create opportunity in Bitrix24'})

            except Exception as e:
                return JsonResponse({'success': False, 'errors': str(e)})
        else:
            return JsonResponse({'success': False, 'errors': form.errors})
    return JsonResponse({'success': False, 'errors': 'Invalid request method'})

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

@csrf_exempt
@login_required
def crear_oportunidad_api(request):
    if request.method == 'POST':
        cliente_id = request.POST.get('cliente')
        producto = request.POST.get('producto')
        area = request.POST.get('area')
        probabilidad_cierre = request.POST.get('probabilidad_cierre')
        monto = request.POST.get('monto')
        bitrix_stage_id = request.POST.get('bitrix_stage_id', 'NEW') # Default Bitrix stage ID

        if not cliente_id or not producto or not area or not monto:
            return JsonResponse({'success': False, 'errors': {'__all__': 'Faltan campos obligatorios.'}}, status=400)

        try:
            cliente = Cliente.objects.get(id=cliente_id)
            monto_decimal = Decimal(monto)
            probabilidad_int = int(probabilidad_cierre) if probabilidad_cierre else 0

            # 1. Create opportunity in Bitrix24
            opportunity_data = {
                'oportunidad': f'Oportunidad - {producto} - {cliente.nombre_empresa}', # Default title
                'monto': float(monto_decimal),
                'cliente': cliente.nombre_empresa,
                'bitrix_company_id': cliente.bitrix_company_id,
                'producto': producto,
                'area': area,
                'probabilidad_cierre': probabilidad_int,
                'bitrix_stage_id': bitrix_stage_id,
            }
            
            # Get bitrix_user_id for the current user
            bitrix_assigned_by_id = None
            if request.user and hasattr(request.user, 'userprofile') and request.user.userprofile.bitrix_user_id:
                bitrix_assigned_by_id = request.user.userprofile.bitrix_user_id
            opportunity_data['bitrix_assigned_by_id'] = bitrix_assigned_by_id

            bitrix_response = send_opportunity_to_bitrix(opportunity_data, request=request)

            if bitrix_response and bitrix_response.get('result'):
                bitrix_deal_id = bitrix_response.get('result')
                
                # 2. Save opportunity locally
                new_opportunity = TodoItem.objects.create(
                    oportunidad=opportunity_data['oportunidad'],
                    monto=monto_decimal,
                    cliente=cliente,
                    usuario=request.user,
                    producto=producto,
                    area=area,
                    probabilidad_cierre=probabilidad_int,
                    bitrix_deal_id=bitrix_deal_id,
                    bitrix_stage_id=bitrix_stage_id,
                )
                return JsonResponse({
                    'success': True,
                    'oportunidad': {
                        'id': new_opportunity.id,
                        'nombre': new_opportunity.oportunidad,
                        'bitrix_deal_id': bitrix_deal_id,
                    }
                })
            else:
                return JsonResponse({'success': False, 'errors': {'__all__': 'No se pudo crear la oportunidad en Bitrix24.'}}, status=400)

        except Cliente.DoesNotExist:
            return JsonResponse({'success': False, 'errors': {'cliente': 'Cliente no encontrado.'}}, status=404)
        except Exception as e:
            print(f"ERROR en crear_oportunidad_api: {e}")
            traceback.print_exc()
            return JsonResponse({'success': False, 'errors': {'__all__': str(e)}}, status=500)
    return JsonResponse({'success': False, 'errors': {'__all__': 'Método no permitido.'}}, status=405)

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
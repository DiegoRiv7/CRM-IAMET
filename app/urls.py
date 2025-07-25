from django.urls import path
from django.views.generic import RedirectView

from .views import (
    bienvenida,
    dashboard,
    oportunidades_mes_actual,
    todos,
    get_user_clients_api,
    oportunidad_detalle_api,
    ingresar_venta_todoitem,
    ingresar_venta_todoitem_exitosa,
    register,
    user_login,
    user_logout,
    editar_venta_todoitem,
    reporte_ventas_por_cliente,
    oportunidades_por_cliente,
    producto_dashboard_detail,
    mes_dashboard_detail,
    oportunidades_perdidas_detail,
    crear_cotizacion_view,
    generate_cotizacion_pdf,
    view_cotizacion_pdf,
    # Asegúrate de que estas vistas existan en views.py si las necesitas
    reporte_usuarios,
    perfil_usuario,
    cotizaciones_view,
    cotizaciones_por_cliente_view,
    importar_oportunidades,
    ventas_fullscreen,
    actualizar_probabilidad,
    crear_cliente_api,
)
from .bitrix_integration import get_bitrix_companies_api

# Importa las vistas desde el mismo directorio de la aplicación
from . import views_exportar

urlpatterns = [
    # Página de bienvenida (será la nueva Home)
    path("home/", bienvenida, name="home"),
    path("", bienvenida, name="root_home"),

    # Dashboard principal
    path("dashboard/", dashboard, name="dashboard"),
    path("dashboard/mes-actual/", oportunidades_mes_actual, name="oportunidades_mes_actual"),

    # Ruta para la lista de todas las oportunidades de venta (o las del usuario)
    path("todos/", todos, name="todos"),

    # API para obtener clientes por usuario
    path('api/clients-for-user/', get_user_clients_api, name='clients_for_user_api'),
    # API para detalle de oportunidad (actualización de fila tras edición)
    path('api/oportunidad/<int:id>/detalle/', oportunidad_detalle_api, name='oportunidad_detalle_api'),

    # Rutas para ingresar nuevas oportunidades de venta
    path("ingresar-venta/", ingresar_venta_todoitem, name="ingresar_venta_todoitem"),
    path("ingresar-venta-exitosa/", ingresar_venta_todoitem_exitosa, name="ingresar_venta_todoitem_exitosa"),

    # Rutas de autenticación (registro, login, logout)
    path("register/", register, name="register"),
    path("login/", user_login, name="user_login"),
    path("logout/", user_logout, name="user_logout"),

    # Ruta para editar o eliminar una oportunidad de venta específica
    # <int:pk> captura el ID numérico de la oportunidad
    path("editar-venta/<int:pk>/", editar_venta_todoitem, name="editar_venta_todoitem"),

    # Ruta para el reporte de ventas por cliente
    path("reporte-clientes/", reporte_ventas_por_cliente, name="reporte_ventas_por_cliente"),

    # Ruta para ver las oportunidades de un cliente específico
    # <int:cliente_id> captura el ID numérico del cliente
    path("oportunidades-cliente/<int:cliente_id>/", oportunidades_por_cliente, name="oportunidades_por_cliente"),

    # Ruta para el detalle del dashboard por producto
    # <str:producto_val> captura el valor del producto (ej. "PRODUCTO_A")
    path("producto-detalle/<str:producto_val>/", producto_dashboard_detail, name="producto_dashboard_detail"),

    # Ruta para el detalle del dashboard por mes de cierre
    # <str:mes_val> captura el valor del mes (ej. "07" para Julio)
    path("mes-detalle/<str:mes_val>/", mes_dashboard_detail, name="mes_dashboard_detail"),
    # Ruta para el detalle de oportunidades perdidas (0% probabilidad)
    path("oportunidades-perdidas/", oportunidades_perdidas_detail, name="oportunidades_perdidas_detail"),

    # Ruta para crear una cotización para un cliente específico
    path('cliente/<int:cliente_id>/crear-cotizacion/', crear_cotizacion_view, name='crear_cotizacion'),

    # NUEVA RUTA: Para generar el PDF de una cotización específica
    # Esta es la ruta clave que faltaba para que el PDF se descargue.
    # Recibe el ID de la cotización y lo pasa a la vista generate_cotizacion_pdf.
    path('cotizacion/pdf/<int:cotizacion_id>/', generate_cotizacion_pdf, name='generate_cotizacion_pdf'),

    # Ruta para visualizar el PDF de una cotización en el navegador
    path('cotizacion/view/<int:cotizacion_id>/', view_cotizacion_pdf, name='view_cotizacion_pdf'),

    # Reporte de usuarios (solo para supervisores)
    path('reporte-usuarios/', reporte_usuarios, name='reporte_usuarios'),
    path('perfil-usuario/<int:usuario_id>/', perfil_usuario, name='perfil_usuario'),

    # Ruta para la sección de cotizaciones (listado de clientes y cotizaciones)
    path('cotizaciones/', cotizaciones_view, name='cotizaciones'),

    # Ruta para ver cotizaciones de un cliente específico
    path('cotizaciones/cliente/<int:cliente_id>/', cotizaciones_por_cliente_view, name='cotizaciones_por_cliente'),

    # Exportar oportunidades (restaurado)
    path("importar/", importar_oportunidades, name="importar_oportunidades"),
    # Pantalla fullscreen de ventas por mes
    path('dashboard/ventas_fullscreen/', ventas_fullscreen, name='ventas_fullscreen'),

    # API para actualizar la probabilidad de una oportunidad
    path('api/oportunidad/<int:id>/probabilidad/', actualizar_probabilidad, name='actualizar_probabilidad'),

    # API para crear clientes desde el modal
    path('api/crear-cliente/', crear_cliente_api, name='crear_cliente_api'),
    path('api/bitrix-companies/', get_bitrix_companies_api, name='bitrix_companies_api'),
 
   # path("", RedirectView.as_view(url='/dashboard/', permanent=False), name='root_redirect'),
]
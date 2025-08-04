from django.urls import path
from django.views.generic import RedirectView, TemplateView # <--- ¡Añadido TemplateView aquí!

from . import views
from .bitrix_integration import get_bitrix_companies_api

# Importa las vistas desde el mismo directorio de la aplicación
from . import views_exportar

urlpatterns = [
    path('bitrix/webhook/', views.bitrix_webhook_handler_view, name='bitrix-webhook-handler'),
    # Página de bienvenida (será la nueva Home)
    path("home/", views.bienvenida, name="home"),
    path("", views.bienvenida, name="root_home"),

    # Dashboard principal
    path("dashboard/", views.dashboard, name="dashboard"),
    path("dashboard/mes-actual/", views.oportunidades_mes_actual, name="oportunidades_mes_actual"),

    # Ruta para la lista de todas las oportunidades de venta (o las del usuario)
    path("todos/", views.todos, name="todos"),

    # API para obtener clientes por usuario
    path('api/clients-for-user/', views.get_user_clients_api, name='clients_for_user_api'),
    # API para detalle de oportunidad (actualización de fila tras edición)
    path('api/oportunidad/<int:id>/detalle/', views.oportunidad_detalle_api, name='oportunidad_detalle_api'),

    # Rutas para ingresar nuevas oportunidades de venta
    path("ingresar-venta/", views.ingresar_venta_todoitem, name="ingresar_venta_todoitem"),
    path("ingresar-venta-exitosa/", views.ingresar_venta_todoitem_exitosa, name="ingresar_venta_todoitem_exitosa"),

    # Rutas de autenticación (registro, login, logout)
    path("register/", views.register, name="register"),
    path("login/", views.user_login, name="user_login"),
    path("logout/", views.user_logout, name="user_logout"),

    # Ruta para editar o eliminar una oportunidad de venta específica
    # <int:pk> captura el ID numérico de la oportunidad
    path("editar-venta/<int:pk>/", views.editar_venta_todoitem, name="editar_venta_todoitem"),

    # Ruta para el reporte de ventas por cliente
    path("reporte-clientes/", views.reporte_ventas_por_cliente, name="reporte_ventas_por_cliente"),

    # Ruta para ver las oportunidades de un cliente específico
    # <int:cliente_id> captura el ID numérico del cliente
    path("oportunidades-cliente/<int:cliente_id>/", views.oportunidades_por_cliente, name="oportunidades_por_cliente"),

    # Ruta para el detalle del dashboard por producto
    # <str:producto_val> captura el valor del producto (ej. "PRODUCTO_A")
    path("producto-detalle/<str:producto_val>/", views.producto_dashboard_detail, name="producto_dashboard_detail"),

    # Ruta para el detalle del dashboard por mes de cierre
    # <str:mes_val> captura el valor del mes (ej. "07" para Julio)
    path("mes-detalle/<str:mes_val>/", views.mes_dashboard_detail, name="mes_dashboard_detail"),
    # Ruta para el detalle de oportunidades perdidas (0% probabilidad)
    path("oportunidades-perdidas/", views.oportunidades_perdidas_detail, name="oportunidades_perdidas_detail"),

    # Ruta para crear una cotización para un cliente específico
    path('lanzador-widget/', views.bitrix_widget_launcher, name='bitrix_widget_launcher'),
    path('cliente/<int:cliente_id>/crear-cotizacion/', views.crear_cotizacion_view, name='crear_cotizacion_with_id'),
    path('crear-cotizacion/', views.crear_cotizacion_view, name='crear_cotizacion'),

    # NUEVA RUTA: Para generar el PDF de una cotización específica
    # Esta es la ruta clave que faltaba para que el PDF se descargue.
    # Recibe el ID de la cotización y lo pasa a la vista generate_cotizacion_pdf.
    path('cotizacion/pdf/<int:cotizacion_id>/', views.generate_cotizacion_pdf, name='generate_cotizacion_pdf'),

    # Ruta para visualizar el PDF de una cotización en el navegador
    path('cotizacion/view/<int:cotizacion_id>/', views.view_cotizacion_pdf, name='view_cotizacion_pdf'),

    # Ruta para editar (duplicar) una cotización
    path('cotizacion/<int:cotizacion_id>/editar/', views.editar_cotizacion_view, name='editar_cotizacion'),

    # Reporte de usuarios (solo para supervisores)
    path('reporte-usuarios/', views.reporte_usuarios, name='reporte_usuarios'),
    path('perfil-usuario/<int:usuario_id>/', views.perfil_usuario, name='perfil_usuario'),

    # Ruta para la sección de cotizaciones (listado de clientes y cotizaciones)
    path('cotizaciones/', views.cotizaciones_view, name='cotizaciones'),

    # Ruta para ver cotizaciones de un cliente específico
    path('cotizaciones/cliente/<int:cliente_id>/', views.cotizaciones_por_cliente_view, name='cotizaciones_por_cliente'),

    # Exportar oportunidades (restaurado)
    path("importar/", views.importar_oportunidades, name="importar_oportunidades"),
    # Pantalla fullscreen de ventas por mes
    path('dashboard/ventas_fullscreen/', views.ventas_fullscreen, name='ventas_fullscreen'),

    # API para actualizar la probabilidad de una oportunidad
    path('api/oportunidad/<int:id>/probabilidad/', views.actualizar_probabilidad, name='actualizar_probabilidad'),

    # API para crear clientes desde el modal


    path('api/bitrix-companies/', get_bitrix_companies_api, name='bitrix_companies_api'),
    path('api/get-oportunidades-por-cliente/', views.get_oportunidades_por_cliente, name='get_oportunidades_por_cliente'),
    path('api/bitrix-contacts/', views.get_bitrix_contacts_api, name='bitrix_contacts_api'),
 
   # path("", RedirectView.as_view(url='/dashboard/', permanent=False), name='root_redirect'),
    # Ruta temporal para depuración del enlace de Bitrix
    path('bitrix-temp-link/', TemplateView.as_view(template_name='bitrix_temp_link.html'), name='bitrix_temp_link'),
    path('api/crear-cliente/', views.crear_cliente_api, name='crear_cliente_api'),
]

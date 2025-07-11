# cartera_clientes/app/urls.py

from django.urls import path
from . import views # Importa las vistas desde el mismo directorio de la aplicación


urlpatterns = [
    # Página de bienvenida (será la nueva Home)
    path("home/", views.bienvenida, name="home"),

    # Dashboard principal
    path("dashboard/", views.dashboard, name="dashboard"),

    # Ruta para la lista de todas las oportunidades de venta (o las del usuario)
    path("todos/", views.todos, name="todos"),

    # API para obtener clientes por usuario
    path('api/clients-for-user/', views.get_user_clients_api, name='clients_for_user_api'),

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
    path('cliente/<int:cliente_id>/crear-cotizacion/', views.crear_cotizacion_view, name='crear_cotizacion'),

    # NUEVA RUTA: Para generar el PDF de una cotización específica
    # Esta es la ruta clave que faltaba para que el PDF se descargue.
    # Recibe el ID de la cotización y lo pasa a la vista generate_cotizacion_pdf.
    path('cotizacion/pdf/<int:cotizacion_id>/', views.generate_cotizacion_pdf, name='generate_cotizacion_pdf'),

    # Reporte de usuarios (solo para supervisores)
    path('reporte-usuarios/', views.reporte_usuarios, name='reporte_usuarios'),
    path('perfil-usuario/<int:usuario_id>/', views.perfil_usuario, name='perfil_usuario'),

    # Ruta para la sección de cotizaciones (listado de clientes y cotizaciones)
    path('cotizaciones/', views.cotizaciones_view, name='cotizaciones'),

    # Ruta para ver cotizaciones de un cliente específico
    path('cotizaciones/cliente/<int:cliente_id>/', views.cotizaciones_por_cliente_view, name='cotizaciones_por_cliente'),

    # Ruta raíz redirige al dashboard
    path("", views.dashboard, name="root_dashboard"),

    # API para actualizar la probabilidad de una oportunidad
    path('api/oportunidad/<int:id>/probabilidad/', views.actualizar_probabilidad, name='actualizar_probabilidad'),

    # API para crear clientes desde el modal
    path('api/crear-cliente/', views.crear_cliente_api, name='crear_cliente_api'),
]
from django.urls import path
from django.views.generic import RedirectView, TemplateView # <--- ¡Añadido TemplateView aquí!
from django.views.i18n import set_language as django_set_language

from . import views
from .bitrix_integration import get_bitrix_companies_api

# Importa las vistas desde el mismo directorio de la aplicación
from . import views_exportar

urlpatterns = [
    path('bitrix/webhook/', views.bitrix_webhook_receiver, name='bitrix-webhook-handler'),
    path('bitrix/sync/', views.bitrix_sync_admin, name='bitrix-sync-admin'),
    path('bitrix/lost-opportunities/', views.bitrix_lost_opportunities, name='bitrix-lost-opportunities'),
    # Página de bienvenida (será la nueva Home)
    path("home/", views.bienvenida, name="home"),
    path("", views.bienvenida, name="root_home"),

    # Dashboard principal
    path("dashboard/", views.dashboard, name="dashboard"),
    path("dashboard/mes-actual/", views.oportunidades_mes_actual, name="oportunidades_mes_actual"),
    
    # Tareas y Proyectos (solo superusuarios)
    path("tareas-proyectos/", views.tareas_proyectos, name="tareas_proyectos"),
    path("proyecto/<int:proyecto_id>/", views.proyecto_detalle, name="proyecto_detalle"),
    
    # APIs para comentarios de proyecto
    path("api/proyecto/<int:proyecto_id>/comentarios/", views.api_comentarios_proyecto, name="api_comentarios_proyecto"),
    path("api/proyecto/<int:proyecto_id>/comentarios/agregar/", views.api_agregar_comentario_proyecto, name="api_agregar_comentario_proyecto"),
    path("api/comentario-proyecto/<int:comentario_id>/editar/", views.api_editar_comentario_proyecto, name="api_editar_comentario_proyecto"),
    path("api/comentario-proyecto/<int:comentario_id>/eliminar/", views.api_eliminar_comentario_proyecto, name="api_eliminar_comentario_proyecto"),
    
    # APIs para comentarios de tareas
    path("api/tarea/<int:tarea_id>/comentarios/", views.api_comentarios_tarea, name="api_comentarios_tarea"),
    path("api/tarea/<int:tarea_id>/comentarios/agregar/", views.api_agregar_comentario_tarea, name="api_agregar_comentario_tarea"),
    path("api/comentario-tarea/<int:comentario_id>/editar/", views.api_editar_comentario_tarea, name="api_editar_comentario_tarea"),
    path("api/comentario-tarea/<int:comentario_id>/eliminar/", views.api_eliminar_comentario_tarea, name="api_eliminar_comentario_tarea"),
    
    
    # APIs para Tareas y Proyectos
    path("api/proyectos/", views.api_proyectos, name="api_proyectos"),
    path("api/tareas/", views.api_tareas, name="api_tareas"),
    path("api/tarea/<int:tarea_id>/", views.api_tarea_detalle, name="api_tarea_detalle"),
    path("api/tareas/actualizar-estado/", views.api_actualizar_estado_tarea, name="api_actualizar_estado_tarea"),
    path("api/tareas/actualizar/", views.api_actualizar_tarea, name="api_actualizar_tarea"),
    path("api/estadisticas-tareas-proyectos/", views.api_estadisticas_tareas_proyectos, name="api_estadisticas_tareas_proyectos"),
    path("api/buscar-usuarios/", views.api_buscar_usuarios, name="api_buscar_usuarios"),
    path("api/crear-proyecto/", views.api_crear_proyecto, name="api_crear_proyecto"),

    # Ruta para la lista de todas las oportunidades de venta (o las del usuario)
    path("todos/", views.todos, name="todos"),

    # API para obtener clientes por usuario
    path('api/clients-for-user/', views.get_user_clients_api, name='clients_for_user_api'),
    # API para buscar clientes por nombre
    path('api/search-clientes/', views.search_clientes_api, name='search_clientes_api'),
    # API para detalle de oportunidad (actualización de fila tras edición)
    path('api/oportunidad/<int:id>/detalle/', views.oportunidad_detalle_api, name='oportunidad_detalle_api'),

    # Rutas para ingresar nuevas oportunidades de venta
    path("ingresar-venta/", views.ingresar_venta_todoitem, name="ingresar_venta_todoitem"),
    path("ingresar-venta-exitosa/", views.ingresar_venta_todoitem_exitosa, name="ingresar_venta_todoitem_exitosa"),
    
    # Nueva funcionalidad de oportunidades optimizada
    path("nueva-oportunidad/", views.nueva_oportunidad, name="nueva_oportunidad"),
    path("api/buscar-clientes/", views.api_buscar_clientes, name="api_buscar_clientes"),
    path("api/buscar-contactos/", views.api_buscar_contactos, name="api_buscar_contactos"),
    
    # APIs para CRM avanzado (solo superusuarios)
    path("api/cambiar-estado-oportunidad/<int:oportunidad_id>/", views.cambiar_estado_oportunidad, name="cambiar_estado_oportunidad"),
    path("api/agregar-comentario-oportunidad/<int:oportunidad_id>/", views.agregar_comentario_oportunidad, name="agregar_comentario_oportunidad"),
    path("api/timeline-oportunidad/<int:oportunidad_id>/", views.timeline_oportunidad, name="timeline_oportunidad"),
    path("api/editar-comentario-oportunidad/<int:comentario_id>/", views.editar_comentario_oportunidad, name="editar_comentario_oportunidad"),
    path("api/eliminar-comentario-oportunidad/<int:comentario_id>/", views.eliminar_comentario_oportunidad, name="eliminar_comentario_oportunidad"),
    path("api/descargar-archivo-oportunidad/<int:archivo_id>/", views.descargar_archivo_oportunidad, name="descargar_archivo_oportunidad"),
    path("api/vista-previa-archivo-oportunidad/<int:archivo_id>/", views.vista_previa_archivo_oportunidad, name="vista_previa_archivo_oportunidad"),

    # Rutas de autenticación (registro, login, logout, idioma)
    path("register/", views.register, name="register"),
    path("login/", views.user_login, name="user_login"),
    path("logout/", views.user_logout, name="user_logout"),
    path("set-language/", views.set_language, name="set_language"),

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
    path('bitrix-cotizador-redirect/', views.bitrix_cotizador_redirect, name='bitrix_cotizador_redirect'),
    path('cliente/<int:cliente_id>/crear-cotizacion/', views.crear_cotizacion_view, name='crear_cotizacion_with_id'),
    path('crear-cotizacion/', views.crear_cotizacion_view, name='crear_cotizacion'),
    path('crear-cotizacion/oportunidad/<int:oportunidad_id>/', views.crear_cotizacion_view, name='crear_cotizacion_with_opportunity'),

    # NUEVA RUTA: Para generar el PDF de una cotización específica
    # Esta es la ruta clave que faltaba para que el PDF se descargue.
    # Recibe el ID de la cotización y lo pasa a la vista generate_cotizacion_pdf.
    path('cotizacion/pdf/<int:cotizacion_id>/', views.generate_cotizacion_pdf, name='generate_cotizacion_pdf'),
    
    # RUTA NUEVA: Para descargar PDF y redirigir a cotizaciones por oportunidad
    path('cotizacion/download-and-redirect/<int:cotizacion_id>/oportunidad/<int:oportunidad_id>/', views.download_and_redirect_cotizacion, name='download_and_redirect_cotizacion'),

    # Ruta para visualizar el PDF de una cotización en el navegador
    path('cotizacion/view/<int:cotizacion_id>/', views.view_cotizacion_pdf, name='view_cotizacion_pdf'),

    # Ruta para editar (duplicar) una cotización
    path('cotizacion/<int:cotizacion_id>/editar/', views.editar_cotizacion_view, name='editar_cotizacion'),

    path("usuario/", views.usuario_redirect_view, name="usuario"),

    # Reporte de usuarios (solo para supervisores)
    path('reporte-usuarios/', views.reporte_usuarios, name='reporte_usuarios'),
    path('perfil-usuario/<int:usuario_id>/', views.perfil_usuario, name='perfil_usuario'),

    # Ruta para la sección de cotizaciones (listado de clientes y cotizaciones)
    path('cotizaciones/', views.cotizaciones_view, name='cotizaciones'),
    
    # Ruta para cotizaciones automáticas (solo superusuarios)
    path('cotizaciones-automaticas/', views.cotizaciones_automaticas_view, name='cotizaciones_automaticas'),
    
    # Ruta para gestión de productos (solo superusuarios)
    path('gestion-productos/', views.gestion_productos_view, name='gestion_productos'),

    # Ruta para ver cotizaciones de un cliente específico
    path('cotizaciones/cliente/<int:cliente_id>/', views.cotizaciones_por_cliente_view, name='cotizaciones_por_cliente'),
    
    # Ruta para ver cotizaciones de una oportunidad específica
    path('cotizaciones/oportunidad/<int:oportunidad_id>/', views.cotizaciones_por_oportunidad_view, name='cotizaciones_por_oportunidad'),

    # Exportar oportunidades (restaurado)
    path("importar/", views.importar_oportunidades, name="importar_oportunidades"),

    path('exportar/csv/', views.exportar_oportunidades_csv, name='exportar_oportunidades_csv'),
    # Pantalla fullscreen de ventas por mes
    path('dashboard/ventas_fullscreen/', views.ventas_fullscreen, name='ventas_fullscreen'),

    # API para actualizar la probabilidad de una oportunidad
    path('api/oportunidad/<int:id>/probabilidad/', views.actualizar_probabilidad, name='actualizar_probabilidad'),
    
    # API para editar información de oportunidad
    path('api/editar-oportunidad/<int:oportunidad_id>/', views.editar_oportunidad_api, name='editar_oportunidad_api'),
    
    # API para obtener lista de clientes
    path('api/clientes/', views.clientes_api, name='clientes_api'),

    # API para crear clientes desde el modal


    path('api/bitrix-companies/', get_bitrix_companies_api, name='bitrix_companies_api'),
    path('api/get-oportunidades-por-cliente/', views.get_oportunidades_por_cliente, name='get_oportunidades_por_cliente'),
    path('api/bitrix-contacts/', views.get_bitrix_contacts_api, name='bitrix_contacts_api'),
    path('api/crear-oportunidad/', views.crear_oportunidad_api, name='crear_oportunidad_api'),
 
   # path("", RedirectView.as_view(url='/dashboard/', permanent=False), name='root_redirect'),
    # Ruta temporal para depuración del enlace de Bitrix
    path('bitrix-temp-link/', TemplateView.as_view(template_name='bitrix_temp_link.html'), name='bitrix_temp_link'),
    path('incrementa/', views.incrementa_view, name='incrementa'),
    path('incrementa/pdf/view/<int:quote_id>/', views.view_incrementa_pdf, name='view_incrementa_pdf'),
    path('incrementa/pdf/download/<int:quote_id>/', views.download_incrementa_pdf, name='download_incrementa_pdf'),
    
    # Volumetría - Solo para ingenieros y superusuarios
    path('volumetria/', views.volumetria, name='volumetria'),
    # Crear volumetría desde oportunidad específica
    path('crear-volumetria/oportunidad/<int:oportunidad_id>/', views.crear_volumetria_with_opportunity, name='crear_volumetria_with_opportunity'),
    # API para generar PDF de volumetría
    path('api/generar-pdf-volumetria/', views.generar_pdf_volumetria, name='generar_pdf_volumetria'),
    # API para limpiar datos de oportunidad de volumetría
    path('api/limpiar-datos-oportunidad-volumetria/', views.limpiar_datos_oportunidad_volumetria, name='limpiar_datos_oportunidad_volumetria'),
    # API para crear cotización automática desde volumetría
    path('api/crear-cotizacion-desde-volumetria/', views.crear_cotizacion_desde_volumetria, name='crear_cotizacion_desde_volumetria'),
    path('api/crear-cliente/', views.crear_cliente_api, name='crear_cliente_api'),
    # API endpoint para detectar nuevas oportunidades locales (Crown Jewel Feature)
    path('api/check-new-local-opportunities/', views.check_new_local_opportunities, name='check_new_local_opportunities'),
    # API endpoint para detectar nuevas oportunidades directamente desde Bitrix24
    path('api/check-new-bitrix-opportunities/', views.check_new_bitrix_opportunities, name='check_new_bitrix_opportunities'),
    # API para obtener productos por marca (cotizaciones automáticas)
    path('api/productos-por-marca/', views.get_productos_por_marca_api, name='get_productos_por_marca_api'),
    # Test de cotizaciones automáticas (solo superusuarios)
    path('api/test-cotizacion-automatica/', views.test_cotizacion_automatica, name='test_cotizacion_automatica'),
    # API endpoint para sincronización manual de Bitrix (solo supervisores)
    path('api/sync-bitrix-manual/', views.sync_bitrix_manual, name='sync_bitrix_manual'),
    # API para obtener datos de sesión (usado por volumetría)
    path('api/get-session-data/', views.get_session_data, name='get_session_data'),
    # API para obtener oportunidades por cliente (usado por volumetría)
    path('api/get-opportunities-by-client/<int:cliente_id>/', views.get_opportunities_by_client_api, name='get_opportunities_by_client_api'),
    # API para obtener datos del cliente de una oportunidad (auto-detección en volumetría)
    path('api/get-client-by-opportunity/<int:oportunidad_id>/', views.get_client_by_opportunity_api, name='get_client_by_opportunity_api'),
    
    # APIs para catálogo de productos de volumetría
    path('api/buscar-producto-catalogo/', views.buscar_producto_catalogo, name='buscar_producto_catalogo'),
    path('api/buscar-productos-catalogo/', views.buscar_productos_catalogo, name='buscar_productos_catalogo'),
    # API para auto-completar productos en tabla de volumetría
    path('api/buscar-producto-por-numero-parte/', views.buscar_producto_catalogo_api, name='buscar_producto_catalogo_api'),
    path('api/agregar-producto-catalogo/', views.agregar_producto_catalogo, name='agregar_producto_catalogo'),
    path('api/editar-producto-catalogo/<int:producto_id>/', views.editar_producto_catalogo, name='editar_producto_catalogo'),
    path('api/eliminar-producto-catalogo/<int:producto_id>/', views.eliminar_producto_catalogo, name='eliminar_producto_catalogo'),
    path('api/vista-previa-volumetria/', views.vista_previa_volumetria_api, name='vista_previa_volumetria_api'),
    path('api/sugerencias-productos/', views.sugerencias_productos_api, name='sugerencias_productos_api'),
    path('api/buscar-productos-por-numeros-parte/', views.buscar_productos_por_numeros_parte, name='buscar_productos_por_numeros_parte'),
    path('api/get-marcas-catalogo/', views.get_marcas_catalogo, name='get_marcas_catalogo'),
    
    # Gestión de catálogo de volumetría (solo superusuarios)
    path('gestion-catalogo-volumetria/', views.gestion_catalogo_volumetria, name='gestion_catalogo_volumetria'),
    
    # ===============================================
    # NUEVAS RUTAS PARA SUBIDA MANUAL DE ARCHIVOS
    # ===============================================
    path('pending-uploads/', views.pending_file_uploads, name='pending_file_uploads'),
    path('api/retry-upload/<int:upload_id>/', views.retry_file_upload, name='retry_file_upload'),
    path('api/delete-upload/<int:upload_id>/', views.delete_pending_upload, name='delete_pending_upload'),
    path('api/upload-status/', views.upload_status_api, name='upload_status_api'),
    
    
    # ===============================================
    # RUTAS PARA GESTIÓN DE VOLUMETRÍAS
    # ===============================================
    path('volumetria/pdf/view/<int:volumetria_id>/', views.view_volumetria_pdf, name='view_volumetria_pdf'),
    path('volumetria/pdf/download/<int:volumetria_id>/', views.download_volumetria_pdf, name='download_volumetria_pdf'),
    path('api/eliminar-volumetria/<int:volumetria_id>/', views.eliminar_volumetria, name='eliminar_volumetria'),
    
    # ===============================================
    # API SPOTLIGHT - BÚSQUEDA UNIVERSAL
    # ===============================================
    path('api/spotlight-search/', views.spotlight_search_api, name='spotlight_search_api'),
    
    # ===============================================
    # APIs DE NOTIFICACIONES
    # ===============================================
    path('api/obtener-notificaciones/', views.obtener_notificaciones_api, name='obtener_notificaciones_api'),
    path('api/marcar-notificacion-leida/<int:notificacion_id>/', views.marcar_notificacion_leida_api, name='marcar_notificacion_leida_api'),
    path('api/marcar-todas-notificaciones-leidas/', views.marcar_todas_notificaciones_leidas_api, name='marcar_todas_notificaciones_leidas_api'),
    
    # Nueva API para sistema de notificaciones de tareas
    path('api/notificaciones/', views.api_notificaciones, name='api_notificaciones'),
    
    path('calendario/', views.calendario_view, name='calendario'),
    path('api/actividades/', views.actividad_list_create, name='actividad_list_create'),
    path('api/actividades/<int:pk>/', views.actividad_detail, name='actividad_detail'),
    path('api/users/', views.user_list_api, name='user_list_api'),
    path('api/oportunidades/', views.oportunidad_list_api, name='oportunidad_list_api'),
    path('koti-bot-html/', TemplateView.as_view(template_name='nethive_bot.html'), name='koti_bot_html'),
    
    # Generador de avatares con IA
    path('avatar-generator/', views.avatar_generator, name='avatar_generator'),
    
    # Configuración avanzada de usuario
    path('configuracion-avanzada/', views.configuracion_avanzada, name='configuracion_avanzada'),
    
    # API para actualizar avatar de usuario
    path('api/actualizar-avatar/', views.actualizar_avatar, name='actualizar_avatar'),
    
    # Feed de actividad
    path('feed/', views.feed, name='feed'),
]

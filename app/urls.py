from django.urls import path
from django.views.generic import TemplateView

from . import views
from .bitrix_integration import get_bitrix_companies_api

from . import views_exportar
from . import views_mail
from . import views_automatizacion

urlpatterns = [
    # ── Bitrix ───────────────────────────────────────────────────────────────
    path('bitrix/webhook/', views.bitrix_webhook_receiver, name='bitrix-webhook-handler'),
    path('bitrix/sync/', views.bitrix_sync_admin, name='bitrix-sync-admin'),
    path('bitrix/lost-opportunities/', views.bitrix_lost_opportunities, name='bitrix-lost-opportunities'),

    # ── CRM Home ─────────────────────────────────────────────────────────────
    path('', views.crm_home, name='root_home'),
    path('home/', views.crm_home, name='home'),
    path('todos/', views.crm_home, name='todos'),  # alias histórico

    # ── Oportunidades ────────────────────────────────────────────────────────
    path('nueva-oportunidad/', views.nueva_oportunidad, name='nueva_oportunidad'),
    path('editar-venta/<int:pk>/', views.editar_venta_todoitem, name='editar_venta_todoitem'),
    path('importar/', views.importar_oportunidades, name='importar_oportunidades'),
    path('oportunidades-cliente/<int:cliente_id>/', views.oportunidades_por_cliente, name='oportunidades_por_cliente'),
    path('oportunidades-perdidas/', views.oportunidades_perdidas_detail, name='oportunidades_perdidas_detail'),
    path('producto-detalle/<str:producto_val>/', views.producto_dashboard_detail, name='producto_dashboard_detail'),
    path('mes-detalle/<str:mes_val>/', views.mes_dashboard_detail, name='mes_dashboard_detail'),
    path('reporte-clientes/', views.reporte_ventas_por_cliente, name='reporte_ventas_por_cliente'),
    path('exportar/csv/', views.exportar_oportunidades_csv, name='exportar_oportunidades_csv'),

    # ── Cotizaciones ─────────────────────────────────────────────────────────
    path('cotizaciones/', views.cotizaciones_view, name='cotizaciones'),
    path('cotizaciones/cliente/<int:cliente_id>/', views.cotizaciones_por_cliente_view, name='cotizaciones_por_cliente'),
    path('cotizaciones/oportunidad/<int:oportunidad_id>/', views.cotizaciones_por_oportunidad_view, name='cotizaciones_por_oportunidad'),
    path('crear-cotizacion/', views.crear_cotizacion_view, name='crear_cotizacion'),
    path('crear-cotizacion/oportunidad/<int:oportunidad_id>/', views.crear_cotizacion_view, name='crear_cotizacion_with_opportunity'),
    path('cliente/<int:cliente_id>/crear-cotizacion/', views.crear_cotizacion_view, name='crear_cotizacion_with_id'),
    path('cotizacion/<int:cotizacion_id>/editar/', views.editar_cotizacion_view, name='editar_cotizacion'),
    path('cotizacion/pdf/<int:cotizacion_id>/', views.generate_cotizacion_pdf, name='generate_cotizacion_pdf'),
    path('cotizacion/view/<int:cotizacion_id>/', views.view_cotizacion_pdf, name='view_cotizacion_pdf'),
    path('cotizacion/download-and-redirect/<int:cotizacion_id>/oportunidad/<int:oportunidad_id>/', views.download_and_redirect_cotizacion, name='download_and_redirect_cotizacion'),
    path('gestion-productos/', views.gestion_productos_view, name='gestion_productos'),

    # ── Drive / Archivos ─────────────────────────────────────────────────────
    path('api/proyecto/<int:proyecto_id>/carpetas/', views.api_carpetas_proyecto, name='api_carpetas_proyecto'),
    path('api/proyecto/<int:proyecto_id>/carpeta/<int:carpeta_id>/', views.api_carpeta_detalle, name='api_carpeta_detalle'),
    path('api/proyecto/<int:proyecto_id>/archivos/', views.api_archivos_proyecto, name='api_archivos_proyecto'),
    path('api/proyecto/<int:proyecto_id>/archivo/<int:archivo_id>/', views.api_archivo_detalle, name='api_archivo_detalle'),
    path('api/proyecto/<int:proyecto_id>/archivo/<int:archivo_id>/stream/', views.api_archivo_proyecto_stream, name='api_archivo_proyecto_stream'),
    path('api/oportunidad/<int:opp_id>/drive/', views.api_drive_oportunidad, name='api_drive_oportunidad'),
    path('api/oportunidad/<int:opp_id>/drive/carpeta/<int:carpeta_id>/', views.api_drive_oportunidad_carpeta, name='api_drive_oportunidad_carpeta'),
    path('api/oportunidad/<int:opp_id>/drive/archivos/', views.api_drive_oportunidad_archivo, name='api_drive_oportunidad_archivo'),
    path('api/oportunidad/<int:opp_id>/drive/archivo/<int:archivo_id>/', views.api_drive_oportunidad_archivo_detalle, name='api_drive_oportunidad_archivo_detalle'),
    path('api/oportunidad/<int:opp_id>/drive/archivo/<int:archivo_id>/stream/', views.api_drive_archivo_stream, name='api_drive_archivo_stream'),

    # ── Proyectos (CRM-integrado) ─────────────────────────────────────────────
    path('api/proyectos/', views.api_proyectos, name='api_proyectos'),
    path('api/crear-proyecto/', views.api_crear_proyecto, name='api_crear_proyecto'),
    path('api/proyecto/<int:proyecto_id>/configuracion/', views.api_configuracion_proyecto, name='api_configuracion_proyecto'),
    path('api/proyecto/<int:proyecto_id>/comentarios/', views.api_comentarios_proyecto, name='api_comentarios_proyecto'),
    path('api/proyecto/<int:proyecto_id>/comentarios/agregar/', views.api_agregar_comentario_proyecto, name='api_agregar_comentario_proyecto'),
    path('api/comentario-proyecto/<int:comentario_id>/editar/', views.api_editar_comentario_proyecto, name='api_editar_comentario_proyecto'),
    path('api/comentario-proyecto/<int:comentario_id>/eliminar/', views.api_eliminar_comentario_proyecto, name='api_eliminar_comentario_proyecto'),
    path('api/eliminar-proyecto/<int:proyecto_id>/', views.api_eliminar_proyecto_completo, name='api_eliminar_proyecto_completo'),
    path('api/buscar-oportunidades-proyecto/', views.api_buscar_oportunidades_proyecto, name='api_buscar_oportunidades_proyecto'),
    path('api/oportunidad/<int:opp_id>/proyectos/', views.api_oportunidad_proyectos, name='api_oportunidad_proyectos'),
    path('api/oportunidad/<int:opp_id>/proyectos/<int:link_id>/accion/', views.api_oportunidad_proyectos_accion, name='api_oportunidad_proyectos_accion'),
    path('api/oportunidad/<int:opp_id>/proyectos/buscar/', views.api_oportunidad_proyectos_buscar, name='api_oportunidad_proyectos_buscar'),
    path('api/solicitar-acceso-proyecto/<int:proyecto_id>/', views.solicitar_acceso_proyecto, name='solicitar_acceso_proyecto'),
    path('api/responder-solicitud-proyecto/<int:solicitud_id>/', views.responder_solicitud_proyecto, name='responder_solicitud_proyecto'),
    path('api/solicitudes-proyecto/', views.obtener_solicitudes_proyecto, name='obtener_solicitudes_proyecto'),

    # ── Tareas ────────────────────────────────────────────────────────────────
    path('api/tareas/', views.api_tareas, name='api_tareas'),
    path('api/crear-tarea/', views.api_crear_tarea, name='api_crear_tarea'),
    path('api/tarea/<int:tarea_id>/', views.api_tarea_detalle, name='api_tarea_detalle'),
    path('api/tarea/<int:tarea_id>/actualizar/', views.api_actualizar_tarea_real, name='api_actualizar_tarea_real'),
    path('api/tarea/<int:tarea_id>/toggle-timer/', views.api_toggle_task_timer, name='api_toggle_task_timer'),
    path('api/tarea/<int:tarea_id>/completar/', views.api_completar_tarea, name='api_completar_tarea'),
    path('api/tarea/<int:tarea_id>/reabrir/', views.api_reabrir_tarea, name='api_reabrir_tarea'),
    path('api/tareas/actualizar-estado/', views.api_actualizar_estado_tarea, name='api_actualizar_estado_tarea'),
    path('api/tareas/actualizar/', views.api_actualizar_tarea, name='api_actualizar_tarea'),
    path('api/estadisticas-tareas-proyectos/', views.api_estadisticas_tareas_proyectos, name='api_estadisticas_tareas_proyectos'),
    path('api/buscar-usuarios/', views.api_buscar_usuarios, name='api_buscar_usuarios'),
    path('api/oportunidad/<int:opp_id>/tareas/', views.api_tareas_oportunidad, name='api_tareas_oportunidad'),
    path('api/tarea-oportunidad/<int:tarea_id>/', views.api_tarea_oportunidad_detail, name='api_tarea_oportunidad_detail'),
    path('api/todas-tareas-oportunidad/', views.api_todas_tareas_opp, name='api_todas_tareas_opp'),
    path('api/tarea-opp/<int:tarea_id>/detalle/', views.api_tarea_opp_detalle, name='api_tarea_opp_detalle'),
    path('api/tarea-opp/<int:tarea_id>/comentarios/', views.api_tarea_opp_comentarios, name='api_tarea_opp_comentarios'),
    path('api/tarea-opp/<int:tarea_id>/comentarios/<int:comentario_id>/', views.api_tarea_opp_comentario_detail, name='api_tarea_opp_comentario_detail'),
    path('api/tarea/<int:tarea_id>/comentarios/', views.api_comentarios_tarea, name='api_comentarios_tarea'),
    path('api/tarea/<int:tarea_id>/comentarios/agregar/', views.api_agregar_comentario_tarea, name='api_agregar_comentario_tarea'),
    path('api/comentario-tarea/<int:comentario_id>/editar/', views.api_editar_comentario_tarea, name='api_editar_comentario_tarea'),
    path('api/comentario-tarea/<int:comentario_id>/eliminar/', views.api_eliminar_comentario_tarea, name='api_eliminar_comentario_tarea'),
    path('api/tarea-archivo/<int:archivo_id>/', views.api_tarea_archivo, name='api_tarea_archivo'),

    # ── APIs CRM ──────────────────────────────────────────────────────────────
    path('api/crm-table-data/', views.api_crm_table_data, name='api_crm_table_data'),
    path('api/subir-facturacion/', views.api_subir_facturacion, name='api_subir_facturacion'),
    path('api/crear-oportunidad/', views.api_crear_oportunidad, name='api_crear_oportunidad'),
    path('api/oportunidad/<int:id>/detalle/', views.oportunidad_detalle_api, name='oportunidad_detalle_api'),
    path('api/oportunidad-detalle-crm/<int:oportunidad_id>/', views.api_oportunidad_detalle_crm, name='api_oportunidad_detalle_crm'),
    path('api/editar-oportunidad/<int:oportunidad_id>/', views.editar_oportunidad_api, name='editar_oportunidad_api'),
    path('api/oportunidad/<int:id>/probabilidad/', views.actualizar_probabilidad, name='actualizar_probabilidad'),
    path('api/oportunidad/<int:id>/po/', views.actualizar_po, name='actualizar_po'),
    path('api/oportunidad/<int:opp_id>/chat/', views.api_chat_oportunidad, name='api_chat_oportunidad'),
    path('api/oportunidad/<int:opp_id>/chat/mensaje/<int:msg_id>/', views.api_chat_mensaje, name='api_chat_mensaje'),
    path('api/chat-media/<int:msg_id>/', views.api_chat_media_file, name='api_chat_media_file'),
    path('api/oportunidad/<int:oportunidad_id>/productos/', views.api_oportunidad_productos, name='api_oportunidad_productos'),
    path('api/oportunidad/<int:oportunidad_id>/productos/<int:producto_id>/', views.api_oportunidad_producto_delete, name='api_oportunidad_producto_delete'),
    path('api/cliente-oportunidades/<int:cliente_id>/', views.api_cliente_oportunidades, name='api_cliente_oportunidades'),
    path('api/cliente-cotizaciones/<int:cliente_id>/', views.api_cliente_cotizaciones, name='api_cliente_cotizaciones'),
    path('api/cambiar-estado-oportunidad/<int:oportunidad_id>/', views.cambiar_estado_oportunidad, name='cambiar_estado_oportunidad'),
    path('api/agregar-comentario-oportunidad/<int:oportunidad_id>/', views.agregar_comentario_oportunidad, name='agregar_comentario_oportunidad'),
    path('api/timeline-oportunidad/<int:oportunidad_id>/', views.timeline_oportunidad, name='timeline_oportunidad'),
    path('api/editar-comentario-oportunidad/<int:comentario_id>/', views.editar_comentario_oportunidad, name='editar_comentario_oportunidad'),
    path('api/eliminar-comentario-oportunidad/<int:comentario_id>/', views.eliminar_comentario_oportunidad, name='eliminar_comentario_oportunidad'),
    path('api/descargar-archivo-oportunidad/<int:archivo_id>/', views.descargar_archivo_oportunidad, name='descargar_archivo_oportunidad'),
    path('api/vista-previa-archivo-oportunidad/<int:archivo_id>/', views.vista_previa_archivo_oportunidad, name='vista_previa_archivo_oportunidad'),
    path('api/buscar-clientes/', views.api_buscar_clientes, name='api_buscar_clientes'),
    path('api/buscar-contactos/', views.api_buscar_contactos, name='api_buscar_contactos'),
    path('api/quick-crear-cliente/', views.api_quick_crear_cliente, name='api_quick_crear_cliente'),
    path('api/quick-crear-contacto/', views.api_quick_crear_contacto, name='api_quick_crear_contacto'),

    # ── APIs Clientes ─────────────────────────────────────────────────────────
    path('api/clientes/', views.api_clientes, name='api_clientes'),
    path('api/clientes/', views.clientes_api, name='clientes_api'),
    path('api/clients-for-user/', views.get_user_clients_api, name='clients_for_user_api'),
    path('api/search-clientes/', views.search_clientes_api, name='search_clientes_api'),
    path('api/crear-cliente/', views.crear_cliente_api, name='crear_cliente_api'),
    path('api/get-oportunidades-por-cliente/', views.get_oportunidades_por_cliente, name='get_oportunidades_por_cliente'),
    path('api/bitrix-companies/', get_bitrix_companies_api, name='bitrix_companies_api'),
    path('api/bitrix-contacts/', views.get_bitrix_contacts_api, name='bitrix_contacts_api'),

    # ── APIs Admin ────────────────────────────────────────────────────────────
    path('api/admin/usuarios/', views.api_admin_usuarios, name='api_admin_usuarios'),
    path('api/admin/usuarios/<int:user_id>/', views.api_admin_usuario_detalle, name='api_admin_usuario_detalle'),
    path('api/admin/clientes/', views.api_admin_clientes, name='api_admin_clientes'),
    path('api/admin/clientes/<int:cliente_id>/', views.api_admin_cliente_detalle, name='api_admin_cliente_detalle'),
    path('api/admin/contactos/', views.api_admin_contactos, name='api_admin_contactos'),
    path('api/admin/metas/', views.api_admin_metas, name='api_admin_metas'),
    path('api/admin/permisos/<int:user_id>/', views.api_admin_permisos, name='api_admin_permisos'),

    # ── APIs Ingeniero / Programación ─────────────────────────────────────────
    path('api/ingeniero/actividades/', views.api_ingeniero_actividades, name='api_ingeniero_actividades'),
    path('api/ingeniero/proyectos/', views.api_ingeniero_proyectos, name='api_ingeniero_proyectos'),
    path('api/ingeniero/proyecto/<int:proyecto_id>/', views.api_ingeniero_proyecto_detalle, name='api_ingeniero_proyecto_detalle'),
    path('api/ingeniero/board/reorder/', views.api_ingeniero_board_reorder, name='api_ingeniero_board_reorder'),
    path('api/ingeniero/dashboard-stats/', views.api_ingeniero_dashboard_stats, name='api_ingeniero_dashboard_stats'),
    path('api/programacion/actividades/', views.api_programacion_actividades, name='api_programacion_actividades'),
    path('api/programacion/actividad/<int:actividad_id>/', views.api_programacion_actividad_detail, name='api_programacion_actividad_detail'),
    path('api/programacion/disponibilidad/', views.api_programacion_disponibilidad, name='api_programacion_disponibilidad'),
    path('api/actividades/', views.actividad_list_create, name='actividad_list_create'),
    path('api/actividades/<int:pk>/', views.actividad_detail, name='actividad_detail'),
    path('api/users/', views.user_list_api, name='user_list_api'),
    path('api/oportunidades/', views.oportunidad_list_api, name='oportunidad_list_api'),

    # ── Jornadas / Asistencia ─────────────────────────────────────────────────
    path('api/jornada/estado/', views.api_jornada_estado, name='api_jornada_estado'),
    path('api/jornada/iniciar/', views.api_jornada_iniciar, name='api_jornada_iniciar'),
    path('api/jornada/pausar/', views.api_jornada_pausar, name='api_jornada_pausar'),
    path('api/jornada/terminar/', views.api_jornada_terminar, name='api_jornada_terminar'),
    path('api/jornada/ayer/', views.api_jornada_ayer, name='api_jornada_ayer'),
    path('api/empleados/jornadas/', views.api_empleados_jornadas, name='api_empleados_jornadas'),
    path('api/verificar-empleado-mes/', views.api_verificar_empleado_mes, name='api_verificar_empleado_mes'),

    # ── Cotizar Rápido ────────────────────────────────────────────────────────
    path('api/cotizar-rapido/clientes/', views.api_clientes_rapido, name='api_clientes_rapido'),
    path('api/cotizar-rapido/oportunidades/', views.api_oportunidades_rapido, name='api_oportunidades_rapido'),

    # ── Muro Empresarial ──────────────────────────────────────────────────────
    path('api/muro/posts/', views.api_muro_posts, name='api_muro_posts'),
    path('api/muro/posts/<int:post_id>/', views.api_muro_post_detail, name='api_muro_post_detail'),
    path('api/muro/posts/<int:post_id>/like/', views.api_muro_like, name='api_muro_like'),
    path('api/muro/posts/<int:post_id>/comentarios/', views.api_muro_comentarios, name='api_muro_comentarios'),
    path('api/muro/comentarios/<int:comentario_id>/', views.api_muro_comentario_detail, name='api_muro_comentario_detail'),

    # ── Notificaciones ────────────────────────────────────────────────────────
    path('api/notificaciones/', views.api_notificaciones, name='api_notificaciones'),
    path('api/obtener-notificaciones/', views.obtener_notificaciones_api, name='obtener_notificaciones_api'),
    path('api/marcar-notificacion-leida/<int:notificacion_id>/', views.marcar_notificacion_leida_api, name='marcar_notificacion_leida_api'),
    path('api/marcar-todas-notificaciones-leidas/', views.marcar_todas_notificaciones_leidas_api, name='marcar_todas_notificaciones_leidas_api'),

    # ── Novedades ─────────────────────────────────────────────────────────────
    path('novedades/', views.novedades_view, name='novedades'),
    path('api/novedades/toggle-widget/', views.api_toggle_novedades_widget, name='api_toggle_novedades_widget'),

    # ── Spotlight Search ──────────────────────────────────────────────────────
    path('api/spotlight-search/', views.spotlight_search_api, name='spotlight_search_api'),

    # ── Export ────────────────────────────────────────────────────────────────
    path('api/export-excel/', views.api_export_excel, name='api_export_excel'),

    # ── Perfil de usuario ─────────────────────────────────────────────────────
    path('api/actualizar-avatar/', views.actualizar_avatar, name='actualizar_avatar'),
    path('api/perfil/solicitar-cambio/', views.api_solicitar_cambio_perfil, name='api_solicitar_cambio_perfil'),
    path('api/perfil/procesar-solicitud/<int:solicitud_id>/', views.api_procesar_solicitud_perfil, name='api_procesar_solicitud_perfil'),

    # ── Reportes / Admin panel ────────────────────────────────────────────────
    path('reporte-usuarios/', views.reporte_usuarios, name='reporte_usuarios'),
    path('perfil-usuario/<int:usuario_id>/', views.perfil_usuario, name='perfil_usuario'),
    path('estadisticas-usuarios/', views.estadisticas_usuarios, name='estadisticas_usuarios'),
    path('usuario/', views.usuario_redirect_view, name='usuario'),

    # ── Bitrix widget / redirect ──────────────────────────────────────────────
    path('lanzador-widget/', views.bitrix_widget_launcher, name='bitrix_widget_launcher'),
    path('bitrix-cotizador-redirect/', views.bitrix_cotizador_redirect, name='bitrix_cotizador_redirect'),
    path('bitrix-temp-link/', TemplateView.as_view(template_name='bitrix_temp_link.html'), name='bitrix_temp_link'),
    path('api/sync-bitrix-manual/', views.sync_bitrix_manual, name='sync_bitrix_manual'),
    path('api/check-new-local-opportunities/', views.check_new_local_opportunities, name='check_new_local_opportunities'),
    path('api/check-new-bitrix-opportunities/', views.check_new_bitrix_opportunities, name='check_new_bitrix_opportunities'),

    # ── Intercambio Navideño ──────────────────────────────────────────────────
    path('intercambio-navidad/', views.intercambio_navidad, name='intercambio_navidad'),
    path('api/realizar-sorteo-navidad/', views.realizar_sorteo_navidad, name='realizar_sorteo_navidad'),
    path('api/agregar-participante-navidad/', views.agregar_participante_navidad, name='agregar_participante_navidad'),
    path('api/eliminar-participante-navidad/', views.eliminar_participante_navidad, name='eliminar_participante_navidad'),
    path('api/listar-participantes-navidad/', views.listar_participantes_navidad, name='listar_participantes_navidad'),
    path('api/actualizar-evento-navidad/', views.actualizar_evento_navidad, name='actualizar_evento_navidad'),
    path('api/estado-usuario-navidad/', views.estado_usuario_navidad, name='estado_usuario_navidad'),

    # ── Autenticación ─────────────────────────────────────────────────────────
    path('register/', views.register, name='register'),
    path('login/', views.user_login, name='user_login'),
    path('logout/', views.user_logout, name='user_logout'),
    path('api/solicitar-reset-password/', views.solicitar_reset_password, name='solicitar_reset_password'),
    path('set-language/', views.set_language, name='set_language'),

    # ── Mail ──────────────────────────────────────────────────────────────────
    path('mail/', views_mail.mail_home, name='mail_home'),
    path('api/mail/conexion/', views_mail.api_mail_conexion, name='api_mail_conexion'),
    path('api/mail/sincronizar/', views_mail.api_mail_sincronizar, name='api_mail_sincronizar'),
    path('api/mail/lista/', views_mail.api_mail_lista, name='api_mail_lista'),
    path('api/mail/detalle/<int:correo_id>/', views_mail.api_mail_detalle, name='api_mail_detalle'),
    path('api/mail/enviar/', views_mail.api_mail_enviar, name='api_mail_enviar'),
    path('api/mail/responder/<int:correo_id>/', views_mail.api_mail_responder, name='api_mail_responder'),
    path('api/mail/vincular/<int:correo_id>/', views_mail.api_mail_vincular_oportunidad, name='api_mail_vincular'),
    path('api/mail/crear-oportunidad/<int:correo_id>/', views_mail.api_mail_crear_oportunidad_desde_correo, name='api_mail_crear_oportunidad'),
    path('api/mail/adjunto/<int:adjunto_id>/', views_mail.api_mail_descargar_adjunto, name='api_mail_descargar_adjunto'),
    path('api/mail/check/', views_mail.api_mail_check_nuevos, name='api_mail_check_nuevos'),
    path('api/mail/destacar/<int:correo_id>/', views_mail.api_mail_destacar, name='api_mail_destacar'),
    path('api/mail/eliminar/<int:correo_id>/', views_mail.api_mail_eliminar, name='api_mail_eliminar'),
    path('api/mail/reenviar/<int:correo_id>/', views_mail.api_mail_reenviar, name='api_mail_reenviar'),
    path('api/mail/conexion/<int:conexion_id>/eliminar/', views_mail.api_mail_eliminar_conexion, name='api_mail_eliminar_conexion'),

    # ── Automatización de tareas ──────────────────────────────────────────────────────────────────────
    path('api/automatizacion/reglas/', views_automatizacion.api_automatizacion_listar, name='api_automatizacion_listar'),
    path('api/automatizacion/reglas/crear/', views_automatizacion.api_automatizacion_crear, name='api_automatizacion_crear'),
    path('api/automatizacion/reglas/<int:regla_id>/', views_automatizacion.api_automatizacion_editar, name='api_automatizacion_editar'),
    path('api/automatizacion/reglas/<int:regla_id>/eliminar/', views_automatizacion.api_automatizacion_eliminar, name='api_automatizacion_eliminar'),
    path('api/automatizacion/reglas/<int:regla_id>/toggle/', views_automatizacion.api_automatizacion_toggle, name='api_automatizacion_toggle'),
    path('api/automatizacion/historial/', views_automatizacion.api_automatizacion_historial, name='api_automatizacion_historial'),
]

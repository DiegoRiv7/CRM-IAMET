from django.urls import path
from django.views.generic import TemplateView

from . import views
from .bitrix_integration import get_bitrix_companies_api

from . import views_exportar
from . import views_mail
from . import views_automatizacion
from . import views_grupos
from . import views_proyectos
from . import views_iamet

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
    path('api/desglose-facturacion/', views.api_desglose_facturacion, name='api_desglose_facturacion'),
    path('api/subir-cobrado/', views.api_subir_cobrado, name='api_subir_cobrado'),
    path('api/desglose-cobrado/', views.api_desglose_cobrado, name='api_desglose_cobrado'),
    path('api/tendencia-mensual/', views.api_tendencia_mensual, name='api_tendencia_mensual'),
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
    path('api/oportunidad/<int:opp_id>/toggle-pin/', views.api_toggle_pin_oportunidad, name='api_toggle_pin_oportunidad'),
    path('api/tarea/<int:tarea_id>/toggle-pin/', views.api_toggle_pin_tarea, name='api_toggle_pin_tarea'),
    path('api/cliente-oportunidades/<int:cliente_id>/', views.api_cliente_oportunidades, name='api_cliente_oportunidades'),
    path('api/cliente-cotizaciones/<int:cliente_id>/', views.api_cliente_cotizaciones, name='api_cliente_cotizaciones'),
    path('api/cambiar-estado-oportunidad/<int:oportunidad_id>/', views.cambiar_estado_oportunidad, name='cambiar_estado_oportunidad'),
    path('api/agregar-comentario-oportunidad/<int:oportunidad_id>/', views.agregar_comentario_oportunidad, name='agregar_comentario_oportunidad'),
    path('api/timeline-oportunidad/<int:oportunidad_id>/', views.timeline_oportunidad, name='timeline_oportunidad'),
    path('api/editar-comentario-oportunidad/<int:comentario_id>/', views.editar_comentario_oportunidad, name='editar_comentario_oportunidad'),
    path('api/eliminar-comentario-oportunidad/<int:comentario_id>/', views.eliminar_comentario_oportunidad, name='eliminar_comentario_oportunidad'),
    path('api/descargar-archivo-oportunidad/<int:archivo_id>/', views.descargar_archivo_oportunidad, name='descargar_archivo_oportunidad'),
    path('api/vista-previa-archivo-oportunidad/<int:archivo_id>/', views.vista_previa_archivo_oportunidad, name='vista_previa_archivo_oportunidad'),
    path('api/desglose-cotizaciones/', views.api_desglose_cotizaciones, name='api_desglose_cotizaciones'),
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
    path('api/admin/oportunidades/', views.api_admin_oportunidades, name='api_admin_oportunidades'),
    path('api/admin/oportunidades/<int:opp_id>/', views.api_admin_oportunidad_detalle, name='api_admin_oportunidad_detalle'),
    path('api/admin/etapas-pipeline/', views.api_admin_etapas_pipeline, name='api_admin_etapas_pipeline'),
    path('api/admin/alias-clientes/', views.api_admin_alias_clientes, name='api_admin_alias_clientes'),

    # ── APIs Ingeniero / Programación ─────────────────────────────────────────
    path('api/ingeniero/actividades/', views.api_ingeniero_actividades, name='api_ingeniero_actividades'),
    path('api/ingeniero/proyectos/', views.api_ingeniero_proyectos, name='api_ingeniero_proyectos'),
    path('api/ingeniero/proyecto/<int:proyecto_id>/', views.api_ingeniero_proyecto_detalle, name='api_ingeniero_proyecto_detalle'),
    path('api/ingeniero/board/reorder/', views.api_ingeniero_board_reorder, name='api_ingeniero_board_reorder'),
    path('api/ingeniero/dashboard-stats/', views.api_ingeniero_dashboard_stats, name='api_ingeniero_dashboard_stats'),
    path('api/programacion/actividades/', views.api_programacion_actividades, name='api_programacion_actividades'),
    path('api/programacion/actividad/<int:actividad_id>/', views.api_programacion_actividad_detail, name='api_programacion_actividad_detail'),
    path('api/programacion/actividad/<int:actividad_id>/completar/', views.api_programacion_actividad_completar, name='api_programacion_actividad_completar'),
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
    path('api/novedades/toggle-empleado-mes/', views.api_toggle_empleado_mes_widget, name='api_toggle_empleado_mes_widget'),

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

    # ── Prospección ──────────────────────────────────────────────────────────
    path('api/prospeccion/clientes/', views.api_prospeccion_clientes, name='api_prospeccion_clientes'),
    path('api/prospeccion/cliente/<int:cliente_id>/prospectos/', views.api_prospectos_por_cliente, name='api_prospectos_por_cliente'),
    path('api/prospectos/', views.api_prospectos_lista, name='api_prospectos_lista'),
    path('api/crear-prospecto/', views.api_crear_prospecto, name='api_crear_prospecto'),
    path('api/prospecto/<int:prospecto_id>/detalle/', views.api_prospecto_detalle, name='api_prospecto_detalle'),
    path('api/prospecto/<int:prospecto_id>/etapa/', views.api_prospecto_etapa, name='api_prospecto_etapa'),
    path('api/prospecto/<int:prospecto_id>/convertir/', views.api_prospecto_convertir, name='api_prospecto_convertir'),
    path('api/prospecto/<int:prospecto_id>/comentarios/', views.api_prospecto_comentarios, name='api_prospecto_comentarios'),
    path('api/prospecto/<int:prospecto_id>/actividades/', views.api_prospecto_actividades, name='api_prospecto_actividades'),
    path('api/prospecto-actividad/<int:actividad_id>/toggle/', views.api_prospecto_actividad_toggle, name='api_prospecto_actividad_toggle'),

    # ── Campañas ────────────────────────────────────────────────────────
    path('api/campana/templates/', views.api_campana_templates, name='api_campana_templates'),
    path('api/campana/template/<int:template_id>/', views.api_campana_template_detalle, name='api_campana_template_detalle'),
    path('api/campana/template/<int:template_id>/render/', views.api_campana_template_render, name='api_campana_template_render'),
    path('api/campana/registrar-envio/', views.api_campana_registrar_envio, name='api_campana_registrar_envio'),

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
    path('api/mail/auto-sync/', views_mail.api_mail_auto_sync, name='api_mail_auto_sync'),
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
    # ── Grupos de Trabajo ─────────────────────────────────────────────────────────────────────────────
    path('api/grupos/', views_grupos.api_grupos_listar, name='api_grupos_listar'),
    path('api/grupos/crear/', views_grupos.api_grupos_crear, name='api_grupos_crear'),
    path('api/grupos/mis-grupos/', views_grupos.api_mis_grupos, name='api_mis_grupos'),
    path('api/grupos/<int:grupo_id>/', views_grupos.api_grupos_editar, name='api_grupos_editar'),
    path('api/grupos/<int:grupo_id>/eliminar/', views_grupos.api_grupos_eliminar, name='api_grupos_eliminar'),
    path('api/grupos/<int:grupo_id>/toggle/', views_grupos.api_grupos_toggle, name='api_grupos_toggle'),
    path('api/grupos/<int:grupo_id>/chat/', views_grupos.api_grupo_chat, name='api_grupo_chat'),
    path('api/grupos/<int:grupo_id>/chat/enviar/', views_grupos.api_grupo_chat_enviar, name='api_grupo_chat_enviar'),
    path('api/grupos/<int:grupo_id>/chat/leer/', views_grupos.api_grupo_chat_leer, name='api_grupo_chat_leer'),
    path('api/grupos/<int:grupo_id>/no-leidos/', views_grupos.api_grupo_no_leidos, name='api_grupo_no_leidos'),
    path('api/grupos/<int:grupo_id>/miembros/agregar/', views_grupos.api_grupo_agregar_miembro, name='api_grupo_agregar_miembro'),
    path('api/grupos/<int:grupo_id>/miembros/<int:user_id>/', views_grupos.api_grupo_quitar_miembro, name='api_grupo_quitar_miembro'),
    path('api/grupos/<int:grupo_id>/renombrar/', views_grupos.api_grupo_renombrar, name='api_grupo_renombrar'),

    # ═══ PROYECTOS IAMET ═══════════════════════════════════════
    # Proyectos
    path('api/iamet/proyectos/', views_iamet.api_proyectos_lista, name='api_iamet_proyectos_lista'),
    path('api/iamet/proyectos/crear/', views_iamet.api_proyecto_crear, name='api_iamet_proyecto_crear'),
    path('api/iamet/proyectos/dashboard/', views_iamet.api_proyectos_dashboard, name='api_proyectos_dashboard'),
    path('api/iamet/proyectos/financiero/', views_iamet.api_proyectos_financiero, name='api_proyectos_financiero'),
    path('api/iamet/proyectos/<int:proyecto_id>/', views_iamet.api_proyecto_detalle, name='api_iamet_proyecto_detalle'),
    path('api/iamet/proyectos/<int:proyecto_id>/actualizar/', views_iamet.api_proyecto_actualizar, name='api_iamet_proyecto_actualizar'),
    path('api/iamet/proyectos/<int:proyecto_id>/eliminar/', views_iamet.api_proyecto_eliminar, name='api_iamet_proyecto_eliminar'),
    # Partidas
    path('api/iamet/proyectos/<int:proyecto_id>/partidas/', views_iamet.api_partidas_lista, name='api_iamet_partidas_lista'),
    path('api/iamet/partidas/crear/', views_iamet.api_partida_crear, name='api_iamet_partida_crear'),
    path('api/iamet/partidas/<int:partida_id>/actualizar/', views_iamet.api_partida_actualizar, name='api_iamet_partida_actualizar'),
    path('api/iamet/partidas/<int:partida_id>/eliminar/', views_iamet.api_partida_eliminar, name='api_iamet_partida_eliminar'),
    path('api/iamet/partidas/importar-excel/', views_iamet.api_importar_excel, name='api_iamet_importar_excel'),
    path('api/iamet/proyectos/<int:proyecto_id>/volumetria-versiones/', views_iamet.api_volumetria_versiones, name='api_iamet_volumetria_versiones'),
    path('api/iamet/proyectos/<int:proyecto_id>/restaurar-version/', views_iamet.api_restaurar_version, name='api_iamet_restaurar_version'),
    # Ordenes de Compra
    path('api/iamet/proyectos/<int:proyecto_id>/oc/', views_iamet.api_oc_lista, name='api_iamet_oc_lista'),
    path('api/iamet/oc/crear/', views_iamet.api_oc_crear, name='api_iamet_oc_crear'),
    path('api/iamet/oc/<int:oc_id>/actualizar/', views_iamet.api_oc_actualizar, name='api_iamet_oc_actualizar'),
    # Facturas Proveedor
    path('api/iamet/proyectos/<int:proyecto_id>/facturas-proveedor/', views_iamet.api_facturas_proveedor_lista, name='api_iamet_facturas_proveedor_lista'),
    path('api/iamet/facturas-proveedor/crear/', views_iamet.api_factura_proveedor_crear, name='api_iamet_factura_proveedor_crear'),
    path('api/iamet/facturas-proveedor/<int:factura_id>/actualizar/', views_iamet.api_factura_proveedor_actualizar, name='api_iamet_factura_proveedor_actualizar'),
    # Facturas Ingreso
    path('api/iamet/proyectos/<int:proyecto_id>/facturas-ingreso/', views_iamet.api_facturas_ingreso_lista, name='api_iamet_facturas_ingreso_lista'),
    path('api/iamet/facturas-ingreso/crear/', views_iamet.api_factura_ingreso_crear, name='api_iamet_factura_ingreso_crear'),
    path('api/iamet/facturas-ingreso/<int:factura_id>/actualizar/', views_iamet.api_factura_ingreso_actualizar, name='api_iamet_factura_ingreso_actualizar'),
    # Gastos Operativos
    path('api/iamet/proyectos/<int:proyecto_id>/financiero/sync-drive/', views_iamet.api_financiero_sync_drive, name='api_financiero_sync_drive'),
    path('api/iamet/proyectos/<int:proyecto_id>/financiero/upload-oc/', views_iamet.api_financiero_upload_oc, name='api_financiero_upload_oc'),
    path('api/iamet/proyectos/<int:proyecto_id>/financiero/upload-factura/', views_iamet.api_financiero_upload_factura_ingreso, name='api_financiero_upload_factura_ingreso'),
    path('api/iamet/proyectos/<int:proyecto_id>/gastos/', views_iamet.api_gastos_lista, name='api_iamet_gastos_lista'),
    path('api/iamet/gastos/crear/', views_iamet.api_gasto_crear, name='api_iamet_gasto_crear'),
    path('api/iamet/gastos/<int:gasto_id>/actualizar/', views_iamet.api_gasto_actualizar, name='api_iamet_gasto_actualizar'),
    path('api/iamet/gastos/<int:gasto_id>/aprobar/', views_iamet.api_gasto_aprobar, name='api_iamet_gasto_aprobar'),
    # Tareas de Proyecto
    path('api/iamet/proyectos/<int:proyecto_id>/tareas/', views_iamet.api_tareas_proyecto_lista, name='api_iamet_tareas_proyecto_lista'),
    path('api/iamet/tareas/crear/', views_iamet.api_tarea_proyecto_crear, name='api_iamet_tarea_proyecto_crear'),
    path('api/iamet/tareas/<int:tarea_id>/actualizar/', views_iamet.api_tarea_proyecto_actualizar, name='api_iamet_tarea_proyecto_actualizar'),
    # Alertas
    path('api/iamet/proyectos/<int:proyecto_id>/alertas/', views_iamet.api_alertas_lista, name='api_iamet_alertas_lista'),
    path('api/iamet/alertas/<int:alerta_id>/resolver/', views_iamet.api_alerta_resolver, name='api_iamet_alerta_resolver'),
    # Financieros
    path('api/iamet/proyectos/<int:proyecto_id>/financieros/', views_iamet.api_proyecto_financieros, name='api_iamet_proyecto_financieros'),
]

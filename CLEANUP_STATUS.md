# Estado de Limpieza del Proyecto — En Progreso

## Contexto
Este CRM fue construido encima de un cotizador anterior (UI negra/oscura).
Hay lógica del cotizador viejo mezclada con el CRM nuevo (UI blanca con widgets).
Estamos limpiando todo lo que no sirve en la rama `pruebas`.

## Lo que se hizo (commits en rama `pruebas`)
1. Eliminados ~64 archivos: templates viejos UI negra, scripts debug/fix, CSS oscuro
2. Eliminados ~45 archivos: comandos sync Bitrix (suscripción termina), debug management commands
3. Eliminados ~43 archivos: templates de features no usados (volumetria, incrementa,
   proyectos standalone, calendario standalone, dashboard viejo, feed, bienvenida, etc.)
   + 21 render() en views.py reemplazados con redirect('/app/todos/')
   + Raíz limpiada: deploy scripts viejos, docs Bitrix, seed data, docker-compose duplicados

## Estado actual del error
Al hacer `git pull` + restart en pruebas, hay un error. NO se ha verificado cuál es.
Hay que revisar los logs ANTES de continuar:
```bash
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml logs web --tail 50
```

## Posibles causas del error
- Algún template borrado que aún se referencia en otro template con `{% include %}`
- Similar al problema anterior con `dock.html` que estaba en `base.html`
- Revisar todos los `{% include %}` en los templates activos

## Comando para detectar includes rotos
```bash
# En el servidor o local — busca includes de templates que ya no existen
grep -r "{% include" app/templates/ --include="*.html" | grep -v "crm/_"
```

## Lo que FALTA hacer (próxima sesión)

### 1. Resolver el error actual en pruebas
Ver logs, identificar template faltante, arreglar.

### 2. Verificar todas las páginas activas
Navegar en pruebas y confirmar que estas secciones funcionan:
- CRM principal (`/app/todos/`)
- Cotizaciones
- Nueva oportunidad
- Drive de proyectos
- Widget calendario (el del CRM, NO el standalone)
- Mail
- Admin panel (supervisor)

### 3. Refactorizar views.py (16,600 líneas → módulos)
El plan acordado:
- `views_crm.py` — vistas del CRM principal
- `views_cotizaciones.py` — cotizaciones y PDFs
- `views_drive.py` — drive de archivos
- `views_admin.py` — panel admin y supervisores
- `views_api.py` — todos los endpoints API
- `views_mail.py` — ya existe, mantener
- `views_tarea_comentarios.py` — ya existe, mantener
- `views_exportar.py` — ya existe, mantener
- Eliminar funciones de features ya borrados (volumetria, incrementa, etc.)

### 4. JS a archivos estáticos
Mover el JS de los templates `_scripts_main.html`, `_scripts_muro.html`, etc.
a `/static/js/` como archivos separados.

## Templates activos (NO tocar)
```
app/templates/
├── base.html
├── login.html / register.html
├── crm_home.html  (solo 27 líneas, incluye los partials)
├── crm/
│   ├── _styles.html, _topbar.html, _content.html
│   ├── _widget_*.html (oportunidad, mail, negociacion, extras, admin, muro, notificaciones, perfil, empleados, calendario, cotizar_rapido, recordatorio_entrada)
│   ├── _scripts_main.html, _scripts_mail.html, _scripts_muro.html, _scripts_ingeniero.html
│   └── _actividades_board.html, _topbar_ingeniero.html
├── cotizaciones.html, crear_cotizacion.html, cotizaciones_cliente.html, cotizaciones_por_oportunidad.html
├── cotizacion_pdf_template.html, iamet_cotizacion_pdf_template.html
├── nueva_oportunidad.html, editar_venta.html
├── oportunidades_por_cliente.html, reporte_ventas_por_cliente.html
├── reporte_usuarios.html, perfil_usuario.html, estadisticas_usuarios.html
├── gestion_productos.html
├── mail.html
├── importar_oportunidades.html
├── download_and_redirect.html
├── exportar.html  (usado en views_exportar.py)
├── bitrix_temp_link.html  (tiene URL activa)
└── admin/base_site.html
```

## Reglas importantes
- SIEMPRE trabajar en rama `pruebas` primero
- NUNCA mergear a `principal` sin verificar en `http://crm.pruebas.nethive.mx`
- El servidor de producción (`crm.iamet.mx`) corre la rama `principal` — NO tocarlo hasta verificar
- La descarga de archivos Bitrix corre esta noche en producción (`descargar_archivos_bitrix`)
- Ver WORKFLOW.md para comandos de deploy, backup, etc.

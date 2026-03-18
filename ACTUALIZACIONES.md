# Historial de Cambios — CRM IAMET

Registro de todas las actualizaciones, mejoras y correcciones del sistema.
Formato: `[YYYY-MM-DD]` · Tipo: `MEJORA` / `NUEVO` / `FIX` / `TÉCNICO`



## [2026-03-17] — Correcciones

### FIX — Archivos de proyectos no abrían en el Drive
- Los archivos subidos desde Bitrix que ya estaban descargados localmente mostraban "Archivo no disponible" al intentar abrirlos.
- Causa: faltaba importar `urllib.parse` en la función de streaming, el error se tragaba silenciosamente y devolvía 404.
- Ahora los archivos locales abren correctamente. Además, si algún archivo no tuviera copia local, se obtiene directo de Bitrix como fallback.

## [2026-03-13] — Refactorización, limpieza mayor y correcciones

### NUEVO — Buscador global
- Ahora en la barra de arriba viene una lupa para buscar cualquier oportunidad, se puede buscar por nombre, PO, factura y permite buscar cotizaciones por número de cotización.
- Permite buscar tareas por nombre de la tarea.

### NUEVO — Tarjeta "Actividad Programada" 
- Ahora aparece una tarjeta que muestra la siguiente actividad pendiente (la más próxima)
- Muestra nombre, fecha y si está vencida (en rojo)
- Haciendo clic se abre el detalle de la actividad para verla o completarla
- Si no hay actividad programada, muestra "Sin actividad programada"

### NUEVO — Campo PO 
- El campo PO en el detalle de oportunidades ahora guarda correctamente la PO
- Todas las oportunidades importadas de Bitrix ya cuentan con su PO original

### NUEVO — Campo factura
- El campo factura en el detalle de oportunidades ahora guarda correctamente la factura
- Todas las oportunidades importadas de Bitrix ya cuentan con su número de factura original

### NUEVO — tareas
- Ahora el responsable de la tarea puede editar la fecha limite de la tarea, si la cambia se le notifica al admin del cambio.
- Ahora se puede etiquetar y subir documentos a los comentarios de las tareas.

### MEJORA — Subida de archivos al drive
- El drive de oportunidades ahora acepta archivos de hasta 100MB (antes el límite era 2.5MB)
- Se pueden subir planos DWG, videos, archivos pesados de ingeniería sin error

### MEJORA — Tabla de oportunidades
- Ahora las oportunidades con actividades o tareas vencidas se muestran en rojo y en lo mas alto de la tabla
- El widget de la oportunidad no se puede cerrar si no tiene una actividad activa

### MEJORA — Chat: adjuntar cualquier tipo de archivo y etiquetar
- El botón de adjuntar en el chat de oportunidad ya no se limita a imágenes
- Se pueden subir PDFs, documentos Word, Excel, planos DWG, videos, etc.
- Se pueden seleccionar varios archivos a la vez; se envían como mensajes separados
- Los archivos no-imagen se muestran como enlace descargable; las imágenes siguen mostrándose como imagen
- El icono del botón cambió de fotografía a clip para indicar que acepta cualquier archivo
- Ahora se puede etiquetar a usuarios en el chat con @nombre

### FIX - recargar la pagina
- Cuando se recarga la pagina ya no regresa a la seccion de CRM, se queda en la seccion que se estaba viendo



### TÉCNICO — Archivos de proyectos migrados a servidor local
- Los archivos descargados de Bitrix (10,075 archivos, ~9.7GB) ahora se sirven desde el servidor local
- Ya no depende de que Bitrix esté activo para ver los archivos de proyectos

### TÉCNICO — Base de código profesionalizada
- El código fuente fue reorganizado completamente para ser más rápido, estable y fácil de mantener
- JavaScript y CSS separados en archivos independientes con caché del navegador → la página carga más rápido en visitas repetidas
- El archivo principal de vistas (views.py, antes 16,591 líneas) dividido en 8 módulos por área funcional

### TÉCNICO — Backup media corregido
- El script de respaldo semanal de archivos ahora respalda correctamente el volumen Docker donde están los archivos reales

## [2026-03-17] — 

### NUEVO - Sección clientes en CRM
- Se combino las secciones de cotizado, cobrado y facturado para hacer una sola sección 
- Esta sección se encarga de darnos un estatus de como estan las ventas de cada vendedor en la empresa
- Nos dice como vamos respecto a las metas y nos sirve para ver por cliente si estamos llegando a las metas y con que marcas
- Muestra kpis inteligentes que nos evitan la fatiga de leer e interpretar tantos datos, los kpis ya nos ayudan con eso
- Se configuro para establecer metas mensuales por cliente de: oportunidades, cotizaciones, cobrado y facturado

### NUEVO - Sección de novedades 
- Se incluyo una sección de novedades donde se registran todas las novedades, mejoras y fixes de la ultima actualización del sistema.
- Esta sección icluye filtros para que los usuarios vean solo las novedades que les importen mas.

### FIX - muro
- Ya se pueden enviar fotos en los mensajes del muro.

### FIX - calendario
- Ya se pueden agendar actividades desde el calendario sin error.
- La hora de inicio se estipula en la hora en la que se quizo crear la actividad y la hora de cierre una hora después.

### FIX - drive 
- Se arreglo que el mensaje para editar algo dentro del drive o eliminar algo, salía atras del widget del drive y no se veía.
- Se arreglo archivos que no se podían ver porque el sistema lo seguia buscando en bitrix pero ya lo descargamos en local.

### TÉCNICO - cambios a producción 
- Se subieron los cambios que se habían trabajado en pruebas a producción.

## Cómo usar este archivo

**Para generar un reporte de cambios recientes:**
> "Genera un resumen de los cambios del CHANGELOG para comunicar a los usuarios qué hay de nuevo en la última actualización"

**Para agregar un cambio nuevo:**
> "Agrega al CHANGELOG que hoy [fecha] se agregó [funcionalidad]"

**Tipos de entrada:**
- `NUEVO` — funcionalidad que antes no existía
- `MEJORA` — algo que ya existía pero funciona mejor
- `FIX` — corrección de un error
- `TÉCNICO` — cambio interno, el usuario no lo nota directamente

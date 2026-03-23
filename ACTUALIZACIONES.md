# Historial de Cambios — CRM IAMET

Registro de todas las actualizaciones, mejoras y correcciones del sistema.
Formato: `[YYYY-MM-DD]` · Tipo: `MEJORA` / `NUEVO` / `FIX` / `TÉCNICO`





## [2026-03-19] — Calendario

### MEJORA — Vista diaria del calendario
- Las tareas ya no se muestran como bloques largos: aparecen como marcadores compactos alineados a la derecha del timeline, sin tapar las actividades.
- Las actividades que se solapan en horario se dividen en columnas (2, 3, 4...) al estilo Google Calendar para que todas sean visibles.
- Los colores son consistentes: azul para actividades con oportunidad, naranja para tareas, gris/negro para actividades sin oportunidad.

### MEJORA — Panel derecho del calendario
- Las actividades muestran dos botones: "Ver Detalle" (gris) y "Completar" (verde) — ya no hace falta abrir el widget para marcarlas como completadas.
- Las tareas muestran solo "Abrir Tarea" (naranja) que abre directamente el widget de tarea.

### FIX — Widgets que abrían detrás del widget de oportunidad
- "Nueva Actividad" y "Nueva Tarea" ya no se abrían detrás del detalle de oportunidad. Corregido el orden de capas (z-index).

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

## [2026-03-17] — actualizaciones

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

## [2026-03-18] — actualizaciones

### MEJORA - formulario de negociación
- Se mejoro el formulario para que tenga mejor UX, el nombre de la oportunidad ahora es el primer campo que se llena
- Se pueden crear clientes nuevos y contactos nuevos directo del formulario 
- Se mejoro el diseño del formulario.

### MEJORA - cotización rápida
- Se mejoro el diseño del widget
- Cuando se le da a crear cotización despliega el fomulario para crear la cotización rapida con los campos de oportunidad y cliente ya llenados.

### MEJORA - Optimización de tareas
- Se ajusto la lógica en como el sistema mostraba las tareas activas para evitar que tarde en cargar esa sección.
- Se reliazo un sistema de paginación para las tareas completadas y la sección de todas las tareas para evitar tiempos de carga largos


## [2026-03-19] — actualizaciones

### MEJORA - Calendario
- El diseño del calendario se mejoro, tambien ahora se pueden arrastrar las actividades para reagendarlas
- Se hizo el widget del calendario mas grande para que el mes se viera completo sin tener que hacer scroll.
- Ahora el calendario muestra 3 cuadros que indican la cantidad de actividades y tareas del mes y tambien la efectividad dle usaurios al completar sus tareas y actividades.

### FIX - Calendario
- Se arreglo que las tareas no aparecían
- Tambien se arreglo que la descripcion y oportunidades de algunas actividades no salian el el widget de la actividad

### FIX - Drive
- Se arreglo que no se podían borrar archivos del drive

### MEJORA - Tareas
- Ahora se permite reabrir tareas ya cerradas en caso que quieran volver a darle seguimiento o si el responsable se equivoco y no cumplio con lo solicitado.
- Cuando se vuelve a abrir una tarea se envía un mensaje al administrador para informar el porque se volvió a abrir una tarea completada.

## [2026-03-20] — Módulo de Correo

### MEJORA — Panel de respuesta inline (estilo macOS Mail)
- Al presionar "Responder", el panel de respuesta aparece directamente debajo del correo sin abrir una ventana separada.
- Editor enriquecido (contenteditable) con barra de herramientas: negrita, cursiva, subrayado, lista con viñetas.
- Botón "CC / CCO" para agregar copias y copias ocultas sin saturar la interfaz.
- Texto original del correo colapsado al final del panel, expandible con un clic.
- El panel se cierra con "Cancelar" o con el botón ✕ del encabezado.

### FIX — Botón "+" para agregar cuenta de correo
- Corregido error `mailAbrirConfig is not defined` al presionar el botón "+".
- Ahora abre el modal de configuración en modo "Agregar cuenta" con los campos vacíos.

### MEJORA — Vincular correo a oportunidad
- El buscador de oportunidades en el panel "Vincular a Oportunidad" ahora funciona (búsqueda con debounce 350ms).
- Al seleccionar una oportunidad, el correo queda vinculado y se muestra la barra azul de oportunidad sin recargar.

### TÉCNICO — CC y CCO en respuestas
- `api_mail_responder` ahora acepta los campos `cc` y `bcc`.
- El CCO se agrega solo a la lista de destinatarios SMTP (no aparece en los headers del correo).


### FIX — Botón "Completar" dejaba de funcionar tras la primera actividad - calendario 
- Corregido bug donde `btn.disabled = true` nunca se reiniciaba al completar con éxito.
- Ahora al abrir el detalle de cualquier actividad, el botón siempre se reinicia a su estado activo.

### MEJORA — Completar actividades sin que desaparezcan del calendario
- Las actividades y tareas completadas ya no desaparecen del calendario.
- Quedan visibles con opacidad reducida (~38%) y con tachado en el título.
- El color de estado en el panel derecho cambia a gris cuando está completada.
- El botón "Completar" pasa a "Ya completada" (deshabilitado) si la actividad ya fue marcada.
- Aplica en las tres vistas: mes, día y semana.

### TÉCNICO — Campo `completada` en modelo Actividad
- Se agregó campo `completada = BooleanField(default=False)` al modelo `Actividad`.
- El endpoint `PATCH /api/actividades/<id>/` actualiza únicamente ese campo.
- Migración 0092 aplicada.

### MEJORA - Notificaciones 
- Se rediseño por completo el diseño de las notificaciones para ordenarlas con mayor claridad.
- Se estableció un sistema estilo mac para las nuevas notifaciones, para no tener que abrir el panel de notificaciones para verlas.


### NUEVO - Tareas automáticas 
- Se creó un sistema dentro de la configuración, para crear tareas automáticas según las etapas de las oportunidades.
- Ahora cuando un usuario cambia de etapa una oportunidad, se le crea una tarea automáticamente según la etapa en la que se encuentra.
- Las tareas automaticas son perfectamente configurables por un usaurio administrador, se pueden editar, administrar y eliminar.

### NUEVO - Grupos de trabajo
- Se creó una nueva sección para crear grupos de trabajo y establecer supervisores y personas que trabajaran en conjunto 
- Ahora los supervisores de grupo pueden ver las oportunidades de las personas que están en su grupo.
- Los usuarios que pertenecen a un grupo pueden ver las oportunidades de su supervisor.


## [2026-03-23] — grupos de trabajo


### MEJORA 
- Se mejoro la colaboración entre los miebors del grupo, ahora todos los miebros del grupo pueden ver las actividades, tareas y oportunidades de otros miebros y cerrar tareas y actividades de otros.
- Los supervisores de los grupos pueden quitar y agregar usaurios.

### NUEVO - chat grupo de trabajo
- Se creó un chat para cada grupo de trabajo, donde los miebros del grupo pueden comunicarse entre sí.
- Cuando un miebro del grupo crea una oportunidad, se le notifica a todos los miebros del grupo.
- Cuando un miebro del grupo cierra una oportunidad, se le notifica a todos los miebros del grupo.

### FIX - tares
- Ahora sin necesidad de recargar la pagina se pueden ver las tareas completadas y las tareas pendientes.


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

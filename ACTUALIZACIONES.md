# Historial de Cambios — CRM IAMET

Registro de todas las actualizaciones, mejoras y correcciones del sistema.
Formato: `[YYYY-MM-DD]` · Tipo: `MEJORA` / `NUEVO` / `FIX` / `TÉCNICO`



## [2026-03-13] — Refactorización, limpieza mayor y correcciones

### NUEVO — Buscador global
- Ahora en la barra de arriba viene una lupa para buscar cualquier oportunidad, se puede buscar por nombre, PO, factura y permite buscar cotizaciones por número de cotización.
- Permite buscar tareas por nombre de la tarea.

### NUEVO — Tarjeta "Actividad Programada" 
- Ahora aparece una tarjeta que muestra la siguiente actividad pendiente (la más próxima)
- Muestra nombre, fecha y si está vencida (en rojo)
- Haciendo clic se abre el detalle de la actividad para verla o completarla
- Si no hay actividad programada, muestra "Sin actividad programada"

### NUEVO — Campo PO (Purchase Order)
- El campo PO en el detalle de oportunidades ahora guarda correctamente la PO
- Todas las oportunidades importadas de Bitrix ya cuentan con su PO original

### NUEVO — Campo factura
- El campo factura en el detalle de oportunidades ahora guarda correctamente la factura
- Todas las oportunidades importadas de Bitrix ya cuentan con su número de factura original

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


### FIX — Tareas en el widget de oportunidad no abrían al hacer clic
- Al hacer clic en una tarea dentro del widget de oportunidad, ahora abre correctamente el detalle de esa tarea en el panel lateral
- Antes llamaba al widget de tareas de proyectos de ingeniería por error

### TÉCNICO — Archivos de proyectos migrados a servidor local
- Los archivos descargados de Bitrix (10,075 archivos, ~9.7GB) ahora se sirven desde el servidor local
- Ya no depende de que Bitrix esté activo para ver los archivos de proyectos

### TÉCNICO — Base de código profesionalizada
- El código fuente fue reorganizado completamente para ser más rápido, estable y fácil de mantener
- JavaScript y CSS separados en archivos independientes con caché del navegador → la página carga más rápido en visitas repetidas
- El archivo principal de vistas (views.py, antes 16,591 líneas) dividido en 8 módulos por área funcional

### TÉCNICO — Backup media corregido
- El script de respaldo semanal de archivos ahora respalda correctamente el volumen Docker donde están los archivos reales

---

## [Próxima actualización] — En preparación

- Comentarios de tareas Bitrix visibles en el sistema
- Sincronización del campo PO con Bitrix
- Mejoras visuales pendientes 

---

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

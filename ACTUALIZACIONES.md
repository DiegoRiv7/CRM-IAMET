# Historial de Cambios — CRM IAMET

Registro de todas las actualizaciones, mejoras y correcciones del sistema.
Formato: `[YYYY-MM-DD]` · Tipo: `MEJORA` / `NUEVO` / `FIX` / `TÉCNICO`

---

## [2026-03-13] — Refactorización, limpieza mayor y correcciones

### TÉCNICO — Base de código profesionalizada
- El código fuente fue reorganizado completamente para ser más rápido, estable y fácil de mantener
- JavaScript y CSS separados en archivos independientes con caché del navegador → la página carga más rápido en visitas repetidas
- El archivo principal de vistas (views.py, antes 16,591 líneas) dividido en 8 módulos por área funcional

### FIX — Campo PO (Purchase Order)
- El campo PO en el detalle de oportunidades ahora guarda correctamente la PO
- Todas las oportunidades importadas de Bitrix ya cuentan con su PO original

### MEJORA — Subida de archivos al drive
- El drive de oportunidades ahora acepta archivos de hasta 100MB (antes el límite era 2.5MB)
- Se pueden subir planos DWG, videos, archivos pesados de ingeniería sin error

### MEJORA — Archivos de proyectos
- Los archivos descargados de Bitrix (10,075 archivos, ~9.7GB) ahora se sirven desde el servidor local
- Ya no depende de que Bitrix esté activo para ver los archivos de proyectos

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

# Estado de Sesión — CRM IAMET

## LEER PRIMERO
Lee WORKFLOW.md para entender los ambientes, ramas y comandos de deploy.
Lee CLEANUP_STATUS.md para el historial de limpieza.

---

## Estado actual de la rama `pruebas`

### Commits recientes (todos en rama `pruebas`):
1. Fix SyntaxError: `})` huérfano en views.py (línea 3387)
2. Limpieza: scripts one-time, debug commands, archivos temporales
3. Fase 1: eliminar 48 funciones muertas de views.py (~2,900 líneas eliminadas)
   - urls.py reescrito y organizado por secciones
   - `todos/` ahora apunta a `crm_home` (alias histórico)
4. Fase 2: dividir views.py en módulos por dominio:
   - `views_utils.py` — 26 helpers (851 líneas)
   - `views_crm.py` — 37 vistas CRM (3,308 líneas)
   - `views_cotizaciones.py` — 17 vistas cotizaciones (1,535 líneas)
   - `views_drive.py` — 10 vistas drive (763 líneas)
   - `views_proyectos.py` — 45 vistas proyectos/tareas (3,700 líneas)
   - `views_admin.py` — 24 vistas admin/bitrix (1,889 líneas)
   - `views_api.py` — 24 APIs muro/jornadas/chat (1,405 líneas)
   - `views_auth.py` — 5 vistas autenticación (220 líneas)
   - `views.py` — re-exportador thin (35 líneas)
5. Fix PO: `woCurrentId` → `currentOppId` en `_scripts_main.html`
6. Fix drive carpetas Bitrix: `_woDriveProyecto` era null al entrar carpeta proyecto
7. Fix imports faltantes en todos los módulos (base64, render_to_string, weasyprint, openpyxl, rapidfuzz, math, random, urllib, StringIO)
8. Fix prioridad archivos: locales primero, Bitrix como fallback
9. Fix backup.sh: respaldar desde volumen Docker `crm-iamet_media_files`

---

## Lo que falta verificar en pruebas ANTES de mergear
- [ ] Ver cotización (daba error `render_to_string` — ya corregido, falta probar)
- [ ] Abrir carpetas Bitrix en drive de oportunidad (ya corregido)
- [ ] Campo PO guarda correctamente (ya corregido)
- [ ] Navegar CRM principal, mail, cotizaciones, drive, admin panel

---

## Pendiente después del merge a producción

### 1. Actualizar backup script en servidor
El `scripts/backup.sh` del repo fue corregido para respaldar el volumen Docker.
Hay que copiarlo al servidor de producción:
```bash
cp ~/crm-iamet/scripts/backup.sh ~/backup_crm.sh
```

### 2. Comentarios de tareas Bitrix
- Existía un comando pero metía los comentarios en la descripción de la tarea
- Hay que crear/corregir el management command para que vayan a `TareaComentario`
- Los últimos 5 meses solamente

### 3. Campo PO desde Bitrix
- El campo PO ya existe en el modelo (`po_number` en `TodoItem`)
- El widget ya lo guarda (fix aplicado)
- Falta: sincronizarlo con el campo en Bitrix (nombre del campo en Bitrix API: pendiente confirmar)
- El usuario no necesita Postman para esto
- Hay que agregar el campo al sync de `bitrix_webhook_receiver` y/o comando manual

---

## Información importante del servidor

### Archivos Bitrix descargados ✓
- 10,075 / 10,076 archivos en volumen Docker `crm-iamet_media_files` (9.7GB)
- 1 archivo falló con HTTP 403: `OCC-TIJ12634 VARILLA.pdf` (proyecto 3149) — irrecuperable
- El código ya prioriza archivo local sobre URL Bitrix

### Backup
- BD: corre diario ~4am Tijuana (10am UTC), último: `db_2026-03-13_10-00.sql.gz` (5.6MB) ✓
- Media: corre domingos — próximo domingo respaldará 9.7GB con script corregido
- Backups en: `~/backups/` en el servidor

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`

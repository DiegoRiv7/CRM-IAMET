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

### 1. Garantizar backup del domingo — PASOS EXACTOS
El script en el repo ya fue corregido. Hay que aplicarlo en el servidor ANTES del domingo.

```bash
# En el servidor de producción:
cd ~/crm-iamet
git pull origin principal          # trae el backup.sh corregido

# Copiar al script activo en cron:
cp ~/crm-iamet/scripts/backup.sh ~/backup_crm.sh
chmod +x ~/backup_crm.sh

# Verificar que el cron lo tiene apuntado correctamente:
crontab -l
# Debe verse algo como: 0 10 * * * /home/iamet2026/backup_crm.sh

# Probar en seco que el script puede ver el volumen Docker:
sudo docker run --rm \
    -v crm-iamet_media_files:/media_src:ro \
    alpine du -sh /media_src
# Debe mostrar ~9.7G — si muestra eso, el domingo el backup funcionará bien

# Asegurarse que la variable MYSQL_ROOT_PASSWORD está disponible para el cron:
cat ~/.backup_env
# Debe tener: MYSQL_ROOT_PASSWORD=...
```

Si el domingo no corre o falla, correr manualmente:
```bash
source ~/.backup_env && ~/backup_crm.sh
```
Y verificar en:
```bash
ls -lh ~/backups/media_*.tar.gz
cat ~/backups/backup.log | tail -20
```

### 2. Comentarios de tareas Bitrix
- Existía un comando pero metía los comentarios en la descripción de la tarea
- Hay que crear/corregir el management command para que vayan a `TareaComentario`
- Los últimos 5 meses solamente

### 3. Campo PO desde Bitrix
- El campo PO ya existe en el modelo (`po_number` en `TodoItem`)
- El widget ya lo guarda (fix aplicado en esta sesión)
- Falta: sincronizarlo con el campo en Bitrix API
- Nombre del campo en Bitrix: pendiente confirmar (revisar en configuración de campos de Bitrix o respuesta de API)
- Hay que agregar el campo al sync de `bitrix_webhook_receiver` y/o comando manual

---

## Información importante del servidor

### Archivos Bitrix descargados ✓
- 10,075 / 10,076 archivos en volumen Docker `crm-iamet_media_files` (9.7GB)
- 1 archivo falló con HTTP 403: `OCC-TIJ12634 VARILLA.pdf` (proyecto 3149) — irrecuperable
- El código ya prioriza archivo local sobre URL Bitrix — cuando Bitrix se desconecte, 10,075 archivos siguen disponibles desde el servidor

### Backup
- BD: corre diario ~4am Tijuana (10am UTC), último: `db_2026-03-13_10-00.sql.gz` (5.6MB) ✓
- Media: corre domingos — script ya corregido, aplicar antes del domingo (ver pasos arriba)
- Backups en: `~/backups/` en el servidor

---

## Resumen de mejoras realizadas en esta sesión

### Limpieza de código (deuda técnica eliminada)
| Qué | Antes | Después |
|-----|-------|---------|
| Archivos basura en `/proyecto/` | ~20 scripts temporales, HTMLs sueltos, archivos .aider | 0 |
| management/commands muertos | 6 comandos one-time (link_proyectos, match, etc.) | Solo `descargar_archivos_bitrix` |
| views.py | 16,591 líneas, monolítico | 35 líneas (re-exportador) |
| Funciones muertas eliminadas | — | 48 funciones (~2,900 líneas) |
| URLs muertas eliminadas | ~40 URLs (volumetria, incrementa, bienvenida, etc.) | 0 |

### Refactorización views.py → módulos
El archivo monolítico de 16,591 líneas se dividió en 8 módulos por dominio.
`urls.py` no cambió — compatibilidad total vía re-export en `views.py`.

### Bugs corregidos
- Campo PO no guardaba (`woCurrentId` no existía → `currentOppId`)
- Carpetas Bitrix en drive daban TypeError null al abrirse
- Cotización daba NameError (imports inline faltantes en módulos nuevos)
- Archivos de proyectos usaban URL Bitrix aunque tuvieran copia local

---

## Pendiente técnico — próximas sesiones

### Limpieza pendiente
- **JS mezclado con HTML**: `_scripts_main.html`, `_scripts_muro.html`, `_scripts_mail.html`, `_scripts_ingeniero.html` tienen miles de líneas de JavaScript incrustado en templates HTML. Lo correcto es moverlos a `/static/js/` como archivos `.js` separados. Beneficios: caché del navegador, separación de responsabilidades, más fácil de modificar sin romper el HTML.
- **CSS mezclado**: `_styles.html` tiene 3,154 líneas de CSS. Debe ir a `/static/css/`.
- **Funciones JS duplicadas o inconsistentes**: al haber mezclado el CRM nuevo con el cotizador viejo, hay variables JS con nombres distintos para lo mismo (ejemplo: `woCurrentId` vs `currentOppId`). Hay que auditar y unificar.
- **views_utils.py muy grande**: algunos helpers podrían moverse a sus módulos respectivos si solo los usa uno.

### Features pendientes
- Comentarios de tareas Bitrix (últimos 5 meses) → management command
- Campo PO sync con Bitrix API
- Auditar que todas las páginas activas funcionan en producción post-merge

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`

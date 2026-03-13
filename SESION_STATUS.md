# Estado de Sesión — CRM IAMET

## LEER PRIMERO
Lee WORKFLOW.md para flujo de trabajo, ramas y comandos de deploy.
Lee ESTRUCTURA.md para entender la arquitectura completa del proyecto.

---

## Rama actual: `pruebas` — VERIFICADA, pendiente merge a `principal`

### Todo lo que está funcionando en pruebas:
- CRM principal: tabla, filtros, tabs, búsqueda ✓
- Widget oportunidad (abrir, editar, PO) ✓
- Widget negociación (crear oportunidad) ✓
- Cotizaciones (crear, PDF) ✓
- Drive (carpetas locales y Bitrix) ✓
- Muro empresarial ✓
- Correo ✓
- Admin panel ✓
- Backup BD diario ✓

---

## Pendiente ANTES de mergear a producción

### 1. Verificar en pruebas (hacer click en cada sección)
- [ ] Abrir oportunidad desde tabla → widget detalle
- [ ] Crear cotización desde oportunidad
- [ ] Navegar drive de oportunidad y proyecto
- [ ] Abrir correo, enviar prueba
- [ ] Abrir muro, crear post

### 2. Al mergear a producción — comandos exactos
```bash
# En Mac:
git checkout principal
git merge pruebas
git push crm-iamet principal
git checkout pruebas

# En servidor producción:
cd ~/crm-iamet
git pull origin principal
sudo docker compose exec web python manage.py collectstatic --noinput
sudo docker compose restart web
```

### 3. Garantizar backup media del domingo — ANTES del domingo
```bash
# En servidor producción:
cd ~/crm-iamet
git pull origin principal
cp ~/crm-iamet/scripts/backup.sh ~/backup_crm.sh
chmod +x ~/backup_crm.sh

# Verificar volumen Docker accesible:
sudo docker run --rm -v crm-iamet_media_files:/media_src:ro alpine du -sh /media_src
# Debe mostrar ~9.7G

# Verificar cron:
crontab -l
# Debe verse: 0 10 * * * /home/iamet2026/backup_crm.sh
```

---

## Pendiente técnico — próximas sesiones

### 1. `base.html` — JS inline
El archivo base tiene JavaScript inline (~300 líneas). No es crítico pero
debería moverse a `static/js/base.js` siguiendo el mismo patrón que hicimos
con los demás archivos.

### 2. Comentarios de tareas Bitrix
- Crear/corregir management command para importar comentarios de tareas
- Los comentarios deben ir a `TareaComentario` (NO a la descripción de tarea)
- Solo los últimos 5 meses
- Comando: `python manage.py importar_comentarios_bitrix`

### 3. Campo PO sincronizar con Bitrix API
- El campo `po_number` en `TodoItem` ya existe y el widget lo guarda
- Falta sincronizar con el campo en Bitrix (nombre del campo: pendiente confirmar)
- Agregar al `bitrix_webhook_receiver` y/o comando manual

### 4. "Found another file" warnings en collectstatic
Warnings benignos — ocurren porque `app` está en STATICFILES_DIRS Y en
INSTALLED_APPS. No causan problemas pero se pueden eliminar quitando
`app/static` de STATICFILES_DIRS (Django lo encuentra igual via AppDirectoriesFinder).

---

## Resumen de cambios realizados (sesiones anteriores + hoy)

### Sesión anterior — Refactorización views.py
| Qué | Antes | Después |
|-----|-------|---------|
| views.py | 16,591 líneas monolítico | 35 líneas (re-exportador) |
| Módulos nuevos | — | 8 módulos por dominio |
| Funciones muertas | 48 funciones sin uso | Eliminadas |
| URLs muertas | ~40 URLs | Eliminadas |
| Archivos basura en /proyecto/ | ~20 scripts/HTMLs sueltos | 0 |

### Hoy — Separación CSS/JS a archivos estáticos
| Archivo | Antes | Después |
|---------|-------|---------|
| `_styles.html` | 4,206 líneas CSS inline | `static/css/crm.css` — 2 líneas en template |
| `_scripts_main.html` | 4,577 líneas JS inline | `static/js/crm_main.js` — 13 líneas en template |
| `_scripts_mail.html` | 577 líneas JS inline | `static/js/crm_mail.js` — 2 líneas en template |
| `_scripts_muro.html` | 289 líneas JS inline | `static/js/crm_muro.js` — 8 líneas en template |
| `_scripts_ingeniero.html` | 801 líneas JS inline | `static/js/crm_ingeniero.js` — 8 líneas en template |

### Bugs corregidos hoy
- Static files 404: nginx apuntaba a host, staticfiles estaban en volumen Docker nombrado → fix: bind mount `./staticfiles:/app/staticfiles`
- `_muro_post_dict`, `_exportar_estadisticas_excel`, `_serialize_tarea_opp` no importaban (funciones `_privadas` no se exportan con `import *`) → fix: imports explícitos
- `datetime` y `ZoneInfo` faltaban en `views_api.py`
- Tags `<script>` y `</div>` HTML quedaron dentro de `crm_main.js` → eliminados
- CSS en `<body>` en lugar de `<head>` → movido a `{% block extra_head %}`
- `personalizacion.css` y `oportunidad_detail.css` solo existían en volumen Docker → recuperados y agregados al repo

### Archivos eliminados hoy
- `app/templates/prettier_error.txt`, `script3_debug*.txt`, `list_blocks.js`, `script4_final_check.js`
- Función legacy `ingresar_venta_todoitem` (template inexistente, no usada)

---

## Información importante del servidor

### Archivos Bitrix descargados ✓
- 10,075 / 10,076 archivos en volumen Docker `crm-iamet_media_files` (9.7GB)
- 1 archivo falló HTTP 403: `OCC-TIJ12634 VARILLA.pdf` (proyecto 3149) — irrecuperable
- Código prioriza archivo local sobre URL Bitrix

### Backup
- BD: corre diario ~4am Tijuana (10am UTC)
- Media: corre domingos — script corregido en repo, aplicar en servidor antes del domingo
- Backups en: `~/backups/` en servidor producción

### Static files — cómo funciona en producción
- Código fuente: `app/static/`
- Colectados: `~/crm-iamet/staticfiles/` (bind mount `./staticfiles:/app/staticfiles`)
- Servidos por: nginx `alias /home/iamet2026/crm-iamet/staticfiles/;`
- Al agregar archivos nuevos a static: siempre correr `collectstatic` antes de restart

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`

# Estructura del Proyecto — CRM IAMET

## Stack
Django 5.2.4 + Python 3.13 | MySQL 8.0 (prod) | Docker + Gunicorn | nginx | WhiteNoise

---

## Directorios principales

```
Gesti-n-de-ventas/
├── app/                        # Aplicación Django principal
│   ├── views.py                # Re-exportador thin (35 líneas) — no tocar
│   ├── views_crm.py            # 37 vistas CRM principal (~3,200 líneas)
│   ├── views_cotizaciones.py   # 17 vistas cotizaciones (~1,535 líneas)
│   ├── views_proyectos.py      # 45 vistas proyectos/tareas (~3,700 líneas)
│   ├── views_admin.py          # 24 vistas admin/Bitrix (~1,890 líneas)
│   ├── views_api.py            # 24 APIs muro/jornadas/chat (~1,405 líneas)
│   ├── views_drive.py          # 10 vistas drive (~763 líneas)
│   ├── views_auth.py           # 5 vistas autenticación (~220 líneas)
│   ├── views_utils.py          # 26 helpers compartidos (~851 líneas)
│   ├── views_tarea_comentarios.py  # 4 endpoints comentarios tareas
│   ├── models.py               # Todos los modelos (~3,300 líneas)
│   ├── forms.py                # Forms Django (~485 líneas)
│   ├── urls.py                 # Todas las URLs (~200 líneas, organizadas por sección)
│   ├── bitrix_integration.py   # API Bitrix24 (~1,027 líneas)
│   ├── static/
│   │   ├── css/
│   │   │   ├── crm.css             # TODOS los estilos del CRM (4,205 líneas)
│   │   │   ├── responsive.css      # Media queries responsivo
│   │   │   ├── personalizacion.css # Estilos página perfil/avatar
│   │   │   └── oportunidad_detail.css  # Estilos detalle oportunidad
│   │   ├── js/
│   │   │   ├── crm_main.js         # JS principal CRM (~4,570 líneas)
│   │   │   ├── crm_mail.js         # JS widget correo (~576 líneas)
│   │   │   ├── crm_muro.js         # JS muro empresarial (~286 líneas)
│   │   │   ├── crm_ingeniero.js    # JS dashboard ingeniero (~799 líneas)
│   │   │   └── personalizacion_avanzada.js
│   │   └── images/                 # Avatars, favicons, iconos
│   └── templates/
│       ├── base.html               # Template base (head, nav global, scripts CDN)
│       ├── crm_home.html           # Página CRM (27 líneas, solo includes)
│       ├── crm/                    # Partials del CRM
│       │   ├── _styles.html        # <link> a crm.css (2 líneas)
│       │   ├── _topbar.html        # Barra superior: avatar, nav, filtros, stats
│       │   ├── _content.html       # Tabs + tablas + filtros inline
│       │   ├── _widget_oportunidad.html  # Overlay detalle oportunidad
│       │   ├── _widget_negociacion.html  # Overlay crear oportunidad
│       │   ├── _widget_mail.html         # Overlay correo
│       │   ├── _widget_muro.html         # Overlay muro empresarial
│       │   ├── _widget_admin.html        # Panel admin (solo supervisores)
│       │   ├── _widget_extras.html       # Cotizador rápido + opps cliente
│       │   ├── _widget_notificaciones.html
│       │   ├── _widget_perfil.html
│       │   ├── _widget_calendario.html
│       │   ├── _widget_empleados.html
│       │   ├── _widget_cotizar_rapido.html
│       │   ├── _widget_recordatorio_entrada.html
│       │   ├── _scripts_main.html    # Config vars Django + <script src crm_main.js>
│       │   ├── _scripts_mail.html    # <script src crm_mail.js>
│       │   ├── _scripts_muro.html    # Config vars + <script src crm_muro.js>
│       │   ├── _scripts_ingeniero.html  # Config vars + <script src crm_ingeniero.js>
│       │   └── _topbar_ingeniero.html
│       ├── crear_cotizacion.html
│       ├── cotizacion_pdf_template.html
│       ├── iamet_cotizacion_pdf_template.html
│       └── [otros templates de vistas individuales]
├── cartera_clientes/
│   ├── settings.py             # Configuración Django
│   ├── urls.py                 # URLs raíz (incluye app.urls)
│   └── wsgi.py
├── scripts/
│   └── backup.sh               # Script backup BD (diario) + media (domingos)
├── staticfiles/                # Generado por collectstatic — NO commitear
├── docs/                       # Specs técnicas y prompts (no operacional)
├── reports/                    # Histórico de reportes de avances (Reporte_Avances_*.html)
├── Dockerfile
├── docker-entrypoint.sh
├── docker-compose.yml          # Producción
├── docker-compose.pruebas.yml  # Pruebas
├── WORKFLOW.md                 # Flujo de deploy (vigente, no modificar)
├── Plan_Hardening_CRM.md       # Plan de hardening (Fases 1-3 cerradas)
├── Plan_Fase6_Refactor.md      # Plan de refactor + handoff actual
└── ESTRUCTURA.md               # Este archivo
```

---

## Cómo funciona el CRM (flujo de una request)

1. Usuario abre `crm.iamet.mx/app/todos/`
2. nginx recibe → proxy_pass al contenedor Docker puerto 8000 (prod) / 8001 (pruebas)
3. Django → `views_crm.py: crm_home()` → renderiza `crm_home.html`
4. `crm_home.html` incluye todos los partials vía `{% include %}`
5. `_styles.html` carga `crm.css` desde nginx (estático, cacheado)
6. `_scripts_main.html` pasa variables Django en `_CRM_CONFIG` + carga `crm_main.js`
7. JS hace fetch a `/app/api/crm-table-data/` → `views_crm.py: api_crm_table_data()`
8. Tabla se renderiza en el browser

---

## Variables Django pasadas al JS (config objects)

```javascript
// En _scripts_main.html
var _CRM_CONFIG = {
    vendedoresFilter, tabActivo, mesFiltro, anioFiltro,
    usuarioNombre, userId, isSuperuser
};

// En _scripts_muro.html
var _MURO_CONFIG = { currentUserId, isSupervisor };

// En _scripts_ingeniero.html
var _ING_CONFIG = { firstName, lastName };
```

---

## Archivos clave para despliegue

### Dockerfile
- Base: `python:3.13`
- Instala dependencias de `requirements.txt`
- Copia código a `/app`
- Entrypoint: `docker-entrypoint.sh`

### docker-entrypoint.sh (corre al iniciar contenedor)
```
1. Esperar DB disponible
2. python manage.py migrate
3. python manage.py collectstatic --noinput  ← copia app/static/ a staticfiles/
4. Iniciar gunicorn
```

### docker-compose.yml (PRODUCCIÓN)
```yaml
web:
  volumes:
    - .:/app                    # Código fuente bind mount (git pull aplica al instante)
    - media_files:/app/media    # Volumen Docker para uploads (externo)
  ports: 8000:8000              # nginx hace proxy_pass a 127.0.0.1:8000
  networks: nginx_default       # Red externa compartida con nginx

volumes:
  media_files:
    external: true
    name: crm-iamet_media_files  # ~9.9GB con todo el drive de oportunidades
```

> **CRÍTICO:** `media_files` DEBE ser external apuntando a `crm-iamet_media_files`.
> Si se quita el `external`, compose crea un volumen nuevo (`gesti-n-de-ventas_media_files`)
> vacío y los archivos del Drive "desaparecen" para el contenedor. Los datos
> reales siguen en `crm-iamet_media_files` — sólo se rompe el mount.

> **Compose project name**: `gesti-n-de-ventas` (nombre legado, no coincide con
> el directorio `~/crm-iamet`). Los contenedores son `gesti-n-de-ventas-web-1`
> y `gesti-n-de-ventas-db-1`. SIEMPRE pasa `-p gesti-n-de-ventas` a los
> comandos compose o se crea un stack nuevo vacío bajo `crm-iamet-*`:
> ```bash
> sudo docker compose -p gesti-n-de-ventas <comando>
> ```

### docker-compose.pruebas.yml (PRUEBAS)
```yaml
web:
  volumes:
    - .:/app
    - media_pruebas:/app/media
    - ./staticfiles:/app/staticfiles  # Bind mount → nginx puede servir static
  ports: 8001:8000
```

### nginx (producción: crm.iamet.mx)
```nginx
location /static/ { alias /home/iamet2026/crm-iamet/staticfiles/; }
location /media/  { alias /var/lib/docker/volumes/crm-iamet_media_files/_data/; }
location /        { proxy_pass http://127.0.0.1:8000; }
```
> **static/** se sirve desde el host (collectstatic los pone en `~/crm-iamet/staticfiles/`).
> **media/** se sirve desde el Docker volume `crm-iamet_media_files` (avatares, PDFs del drive,
> facturas subidas). El path del host `~/crm-iamet/media/` NO contiene los archivos porque
> el volume mount del contenedor lo overridea.
> **proxy_pass** a 127.0.0.1:8000 → si no coincide con el puerto del contenedor → 502.

### nginx (pruebas: crm.pruebas.nethive.mx)
```nginx
location /static/ { alias /home/iamet2026/crm-pruebas/staticfiles/; }
location /media/  { alias /home/iamet2026/crm-pruebas/media/; }
location /        { proxy_pass http://127.0.0.1:8001; }
```

### settings.py — puntos clave
```python
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'    # Destino de collectstatic
STATICFILES_DIRS = ['app/static']         # Fuente
STORAGES = {"staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"}}
# WhiteNoise comprime automáticamente → genera .gz y .br de cada archivo
```

---

## APIs principales

| Endpoint | Vista | Descripción |
|----------|-------|-------------|
| `GET /app/api/crm-table-data/` | `views_crm` | Datos tabla CRM (oportunidades) |
| `GET/POST /app/api/oportunidad/<id>/` | `views_crm` | Detalle/editar oportunidad |
| `GET/POST /app/api/muro/posts/` | `views_api` | Posts muro empresarial |
| `GET /app/api/drive/oportunidad/<id>/` | `views_drive` | Drive de oportunidad |
| `GET /app/api/proyectos/` | `views_proyectos` | Lista proyectos |
| `POST /app/api/crear-oportunidad/` | `views_crm` | Crear nueva oportunidad |
| `POST /app/bitrix/webhook/` | `views_admin` | Receptor webhook Bitrix |

---

## Modelos principales

| Modelo | Descripción |
|--------|-------------|
| `TodoItem` | Oportunidad de venta (modelo central) |
| `Cliente` | Empresa/cliente con integración Bitrix |
| `Contacto` | Persona de contacto del cliente |
| `Cotizacion` / `DetalleCotizacion` | Cotizaciones con líneas |
| `Proyecto` / `Tarea` | Proyectos de ingeniería |
| `PostMuro` / `ComentarioMuro` | Muro empresarial |
| `UserProfile` | Perfil extendido con Bitrix user ID |
| `ArchivoProyecto` | Archivos descargados de Bitrix (9.7GB, 10,075 archivos) |

---

## Notas importantes

- `views.py` es solo un re-exportador — NUNCA agregar lógica ahí
- Cada módulo views_*.py tiene `from .views_utils import *` + imports explícitos de funciones `_privadas`
- Al agregar CSS/JS nuevo: siempre en `app/static/`, luego `collectstatic` en servidor
- Los archivos media de Bitrix están en volumen Docker `crm-iamet_media_files` en producción
- Backup media: domingos vía `~/backup_crm.sh` (script corregido para usar volumen Docker)

---

## Estado del proyecto y plan de handoff (2026-06)

**Contexto crítico:** Diego (desarrollador único) sale de IAMET en ~julio 2026.
El plan de handoff está documentado en `Plan_Fase6_Refactor.md` con orden,
estimados y razones. Lee ese archivo para el contexto completo.

### ✅ Hardening (Fases 1-3) — COMPLETADAS (Plan_Hardening_CRM.md)

Trabajo realizado entre mayo-junio 2026, ya en producción en `pruebas`:

- **Fase 1 — Widgets**: stack manager dinámico de z-index, helper toast() global,
  event bus `crm:data-changed`, breadcrumb en widgets anidados, Escape consistente,
  URL syncing con `crmWidgetUrl.set/clear/read`.
  Archivos clave: `widget_stack.js`, `widget_toast.js`, `widget_data_bus.js`,
  `widget_url_sync.js`.
- **Fase 2 — Notificaciones**: 25 tipos con routing completo, `Notificacion.get_url()`
  cubre todo, logger estructurado, polling con back-off 8s→20s, comando cron
  `python manage.py procesar_vencimientos` reemplaza el cálculo inline.
- **Fase 3 — Búsqueda**: índices DB en 9 campos del Spotlight, AbortController,
  skeleton loading, modal con teclado completo (auto-select first, Tab cambia
  scope, Home/End, footer con atajos).

### 🔄 Fase 6 — Refactor + Handoff (EN CURSO)

Plan completo en `Plan_Fase6_Refactor.md`. Resumen de sub-fases:

| Sub-fase | Estado | Trabajo |
|---|---|---|
| 1.A — Quitar peso muerto | ✅ Hecho (commit `283a6065`) | Borrar legacy, mover reports, imágenes, docs |
| 1.B — Reorganizar carpetas | ✅ Hecho | `reports/`, `docs/`, `app/static/images/`, `.gitignore` |
| 2.A-D — Boy Scout terreno | ⏳ Próximo | Crear `*_v2.js`, `views_v2/` vacíos + headers LEGACY |
| 3.A-D — Optimizar usuarios | Pendiente | Cleanups críticos + `crm_main.js` Turbo-tolerant + Turbo activo |
| 4.A-E — Documentar handoff | Pendiente | SERVIDOR.md, README, DEPLOYMENT, ARQUITECTURA, DECISIONES |

### 🏕️ Boy Scout Rule (a partir de 2026-06-04)

**Política nueva**: los archivos legacy gigantes NO se modifican. Todo código
nuevo va a archivos `*_v2.js` (frontend) o `views_v2/*.py` (backend) con
header documentado.

Archivos marcados como LEGACY (a partir de Fase 2):
- `app/static/js/crm_main.js` (~11,500 líneas)
- `app/static/js/crm_proyectos.js` (~7,400 líneas)
- `app/static/js/crm_levantamiento.js` (~4,500 líneas)
- `app/views_proyectos.py` (~6,861 líneas)
- `app/views_iamet.py` (~6,568 líneas)
- `app/views_crm.py` (~6,488 líneas)

**Solo se modifican** para bugs críticos de producción o cambios menores que
no ameritan crear módulo nuevo. Cualquier feature nueva → archivo nuevo.

### 🧹 Limpieza realizada en Fase 1 (qué se borró del repo)

Eliminados (verificado con grep contra todo el código antes):
- `SESION_STATUS.md` — notas de sesión del 20 marzo, info desactualizada
- `nginx.conf` raíz — template legacy, configs reales viven en `/etc/nginx/sites-enabled/`
- `app/templates/crm/_actividades_board.html` — tablero legacy en `{% comment %}`
- `app/static/js/test_script.js` — nunca cargado en HTML
- 4 management commands one-shot: `crear_admin_compras`, `crear_proyecto_prueba`,
  `poblar_etapas_pipeline`, `seed_compras_demo`

**Conservados a propósito**: `seed_compras.py` y `seed_tecnicos.py` (referenciados
desde JS como sugerencia de comando al admin cuando catálogos están vacíos).

Movidos:
- 41 archivos `Reporte_Avances_*.html` → `reports/`
- 3 imágenes raíz → `app/static/images/`
- `prompt-claude-design-levantamiento.md` → `docs/`

### 📊 Modelos paralelos (decisión pendiente — Fase 4.E)

Hay dos pares de modelos paralelos sin decisión oficial:

- **`Proyecto` (legacy) vs `ProyectoIAMET` (moderno)** — el moderno tiene
  estructura financiera (partidas, OCs, facturas). `views_iamet.py` aliasa
  `ProyectoIAMET` como `Proyecto` (línea 16: `from .models import ProyectoIAMET as Proyecto`).
  Decisión documentada en `Plan_Fase6_Refactor.md` Fase 4.E: marcar legacy
  como `DEPRECATED` en código (sin eliminar — riesgoso).

- **`Tarea` (proyectos ingeniería) vs `TareaOportunidad` (CRM-centric)** —
  ambas vigentes con propósitos distintos. Mantener ambas, documentar
  diferencia en `DECISIONES.md`.

### 📚 Documentos clave del proyecto (orden recomendado de lectura)

1. **`ESTRUCTURA.md`** (este archivo) — mapa general
2. **`WORKFLOW.md`** — flujo de deploy, comandos, ramas, backups (NO modificar)
3. **`Plan_Fase6_Refactor.md`** — plan activo de handoff
4. **`Plan_Hardening_CRM.md`** — historia de Fases 1-3 (hechas)
5. **`ACTUALIZACIONES.md`** — changelog histórico (parcialmente desactualizado)
6. **`MEJORAS_DEUDA_TECNICA.md`** — áreas de mejora identificadas
7. **`Optimizacion_Performance_Pendiente.md`** — pendientes de performance
8. **`Especificacion_Tecnica_Programa_de_Obra.md`** — spec del módulo Gantt

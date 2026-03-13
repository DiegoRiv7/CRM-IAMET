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
│       │   ├── _topbar_ingeniero.html
│       │   └── _actividades_board.html
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
├── Dockerfile
├── docker-entrypoint.sh
├── docker-compose.yml          # Producción
├── docker-compose.pruebas.yml  # Pruebas
├── WORKFLOW.md
├── SESION_STATUS.md
└── ESTRUCTURA.md               # Este archivo
```

---

## Cómo funciona el CRM (flujo de una request)

1. Usuario abre `crm.iamet.mx/app/todos/`
2. nginx recibe → proxy_pass al contenedor Docker puerto 8007 (prod) / 8001 (pruebas)
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
    - .:/app                    # Código fuente bind mount
    - media_files:/app/media    # Volumen Docker para uploads
  ports: 8000:8000
  networks: nginx_default       # Red externa compartida con nginx
```

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
location /media/  { alias /home/iamet2026/crm-iamet/media/; }
location /        { proxy_pass http://127.0.0.1:8007; }
```

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

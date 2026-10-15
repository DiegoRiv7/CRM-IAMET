# PLAN MULTIEMPRESA — CRM IAMET como producto para otras empresas

**Fecha del plan:** 2026-09-07 · **Estado:** FASES 1-5 HECHAS (2026-09-15). Portal público `https://portal.82-223-44-29.nip.io` + demo con datos. Falta: revisión del usuario, "CRM lite", y el merge a `principal` cuando lo ordene
**Responsable:** Jafet · **Ejecuta:** Jafet + agentes Claude (rama `pruebas`)
**Documento para jefes:** `reports/Plan_CRM_Multiempresa_07_Septiembre_2026.html`

---

## 1. Objetivo

Presentar el CRM a un cliente nuevo y, si lo contrata ese mismo día, entregarle
su propio CRM en minutos, sin que vea ningún dato ni marca de IAMET. Al mismo
tiempo, IAMET conserva su CRM de producción tal cual, y Jafet sigue con libertad
para experimentar en él (temas de temporada, avatares, asistente) sin afectar a
los clientes.

Urgencia: tiempos mínimos. **Total: 5 días hábiles** (2 + 1.5 + 1 + 0.5).

---

## 2. Arquitectura decidida

> **ACTUALIZACIÓN 2026-10-15 (decisión del usuario):** el modelo "una instancia
> por empresa" se REEMPLAZA por **multitenant real tipo bridge** — una sola app
> atiende a todas las empresas, cada una con SU base de datos, resuelta por el
> hostname en cada request. Motivo: levantar un contenedor por registro cuesta
> ~650 MB (caben 4-5 empresas) y hace imposible el self-serve y las demos sin
> autorización. Los datos NO se mueven (ya hay una BD por empresa); cambia solo
> la capa de conexión. Ver **§Fase 6**. Lo que sigue en esta sección es la
> arquitectura anterior, que se conserva como historia.

**Una instancia por empresa** (mismo código, misma imagen, base de datos y
volúmenes propios). No es multi-tenant por columna ni por router de BD.

| Pieza | Decisión |
|---|---|
| Aislamiento | Un stack Docker por empresa: `web` + `mailsync`. Nombre de proyecto `crm-<slug>`. |
| Base de datos | **Un solo contenedor MySQL 8 Community compartido** (compose `crm-core`, red `crm_tenants`). Una base y un usuario por empresa con `GRANT` solo sobre su base. Los tenants apuntan con `DB_HOST=crm-mysql` (el entrypoint ya lo lee). |
| IAMET prod y pruebas | **No se tocan.** Conservan sus contenedores `db` propios. IAMET no es un "tenant"; es su línea aparte. |
| Servidor | El actual, `82.223.44.29`. Se amplía RAM cuando lleguen las primeras firmas, no antes. |
| Proxy | El **nginx del host** que ya sirve iamet.mx y crm.iamet.mx. Vhost por empresa desde plantilla + certbot. (Caddy descartado: no mover producción.) |
| Dominio | Se define al final. Demo con la dirección/puerto actual. Futuro: `<empresa>.crm.iamet.mx` con un registro comodín `*.crm.iamet.mx → 82.223.44.29`. |
| Nombre visible | "IAMET · <Nombre de la empresa>" desde la configuración de empresa. |
| Motor de BD | MySQL 8 Community (GPL, sin costo por tamaño/usuarios). MariaDB descartado: 25 JSONField, 219 migraciones y 34 SQL crudos probados contra MySQL 8; el JSON y las colaciones `utf8mb4_0900` no son compatibles. |
| Código | **Un solo repo, dos líneas de liberación** (ver §4). |

### Capacidad medida el 2026-09-07 (servidor 82)

| Recurso | Valor |
|---|---|
| CPU | 4 núcleos |
| RAM | 7.9 GB total · 3.8 GB disponibles |
| Disco | 180 GB libres |
| MySQL en reposo | 600 MB – 1.1 GB |
| web + mailsync en reposo | ≈ 650 MB |

Con MySQL compartido caben **4–5 empresas** antes de ampliar. Con MySQL por
empresa solo cabrían 2. La imagen se construye **una sola vez** (build acotado
`--cpuset-cpus="2,3" --memory=3g`, como el sitio) para todas las empresas.

### Rutas descartadas (no re-proponer)

- **Columna `empresa` en todos los modelos:** 143 modelos, 62k líneas de vistas,
  34 SQL crudos → un filtro olvidado = fuga de datos. Meses de trabajo.
- **Un solo proceso Django con router por subdominio:** el worker `mailsync` y
  el scheduler tendrían que iterar empresas; MySQL no tiene esquemas. Opción
  futura si pasan de ~20 empresas (los datos ya quedan en una BD por empresa,
  así que la migración sería barata).
- **Fork del repo por cliente:** doble mantenimiento; se descarta.
- **VPS nuevo / Caddy / MariaDB:** ver tabla.

---

## 3. Fases

### Fase 1 — Preparar el CRM para cualquier empresa (2 días · días 1–2) — ✅ HECHA 2026-09-07

**Entregado (commits b31e41d1, 30d5eb2b, cdf9857b en `pruebas`; desplegado por parche
en crm-pruebas, migración 0224 aplicada):** `EmpresaConfig` + `OpcionCatalogo` +
`app/empresa.py` + context processor (`EMPRESA`, `MODULOS`, `CATALOGO_*`,
`COLUMNAS_PRODUCTO`); marca fuera del código (login, sidebar, títulos, PDF, PWA,
placeholders); catálogos editables en selects/filtros/forms/reportes/export y tabla
del CRM con columnas por producto; módulos apagables (chat web, leads web, SSO
tienda, marketing hub, ideas, muro, navidad, fondo mundial) con 404 en vistas;
Administración → Empresa ("Datos y módulos" + "Catálogos"); `seed_empresa`.
Verificado en pruebas: IAMET idéntico (10 columnas, logo, módulos) y prueba "Acme"
sin rastros de IAMET, módulos apagados → 404, config revertida.

**Pendientes menores de la Fase 1 (no bloquean la demo):**
- `importar_oportunidades.html` (pegado desde Excel) sigue con cabeceras ZEBRA/PANDUIT
  fijas; `gestion_productos.html` (`marcasValidas`), chips de marca en
  `_widget_evento_form.html` / `_widget_campana.html` (módulos de IAMET).
- `mod_proyectos_iamet`, `mod_temas_temporada`, `mod_intercambio_navidad` (sidebar),
  `mod_bitrix`: la bandera existe pero aún no oculta nada en la UI (navidad/fondo
  mundial sí devuelven 404). Colores de la empresa guardados pero todavía no se aplican
  al tema.
- `AsistenteConfig.nombre` ("IAMET AI") lo cambia `seed_empresa`; en el panel del
  asistente el nombre viene de ahí.
- El Action de deploy sigue sin autenticar: se desplegó por parche (árbol del server
  con cambios sin commitear = commits b31e41d1..cdf9857b). Respaldo de los parches
  previos: `/home/iamet2026/server_parches_20260907.diff`.


Sacar de código todo lo que hoy es IAMET y volverlo configuración por empresa.
Inventario medido: **1,124 menciones a "iamet" en 123 archivos**; las visibles
son un subconjunto manejable.

**Tareas**
1. Modelo `EmpresaConfig` (singleton por base) con: `nombre`, `nombre_corto`,
   `logo`, `favicon`, `color_primario`, `color_secundario`, `correo_contacto`,
   `correo_ventas`, `dominio`, `moneda`, `zona_horaria` y **banderas de módulos**:
   `chat_web`, `leads_web`, `sso_tienda`, `proyectos_iamet`, `marketing_hub`,
   `bitrix`, `intercambio_navidad`, `temas_temporada`, `fondo_mundial`, `muro`,
   `avatares_personalizados`, `asistente_ia`. Helper `empresa_config()` cacheado.
2. Context processor que inyecta `EMPRESA` a todas las plantillas
   (`context_processors.py`). Título/pestaña: "IAMET · {{ EMPRESA.nombre }}".
3. Reemplazar marca visible: `login.html` (título, "IAMET · Sistema de Gestión",
   iamet.mx), `base.html`, `crm/_sidebar.html` (logo `iamet-logo.png` y tooltip),
   plantillas PDF de cotización (`cotizacion_pdf_template.html`,
   `iamet_cotizacion_pdf_template.html`), y los 24 `ventas@iamet.mx` + variantes
   (`ventas@iamet.com.mx`, `datacenter@`, `seguridad@`, `gobierno@`) en vistas y
   JS → `EMPRESA.correo_ventas`.
4. Catálogos fijos → tablas editables: `TodoItem.PRODUCTO_CHOICES` (ZEBRA,
   PANDUIT, APC, GENETEC, AXIS, CISCO…) y `AREA_CHOICES` (models.py ~342–365),
   `MARCA_CHOICES` (~635). Estrategia mínima: quitar `choices` del CharField y
   alimentar los `<select>` desde una tabla `OpcionCatalogo(tipo, valor,
   etiqueta, orden, activo)` sembrada con los valores actuales (IAMET no cambia
   nada). Sin migración de datos destructiva.
5. Banderas de módulos aplicadas en: sidebar (ocultar botones), `urls.py` o
   decorador `@modulo_activo('chat_web')` en las vistas de Chat Web, Leads Web,
   SSO tienda, Proyectos IAMET, Marketing Hub (los casos de éxito en
   `static/marketing/recursos/casos/` son de IAMET), Bitrix.
6. `ALLOWED_HOSTS` / `CSRF_TRUSTED_ORIGINS` ya salen de env; limpiar los
   defaults viejos (nethive.mx, neubox, bitrix24) del settings.
7. Comando `seed_empresa`: etapas de `EtapaPipeline` (hoy solo se crean desde
   Administración), roles, `EmpresaConfig` inicial, `OpcionCatalogo` base.
   Idempotente.
8. Migraciones: `makemigrations` DENTRO del contenedor y **filtrar a mano el
   drift ajeno** (RenameIndex/AlterField en ~30 tablas que no es nuestro).

**Criterio de hecho**
- En `pruebas`, con `EmpresaConfig.nombre="Acme"` y banderas apagadas, un
  recorrido completo (login, CRM, oportunidad, cotización PDF, correo, Mi día)
  **no muestra "IAMET" ni correos @iamet** salvo el prefijo "IAMET ·" del nombre.
- Con las banderas encendidas y datos de IAMET, `pruebas` se ve idéntico a hoy.

### Fase 2 — Alta automática de empresas (1.5 días · días 3–4) — ✅ HECHA 2026-09-14

**Entregado (commits 72fe397d, 1809270e, ef98dcc4, 6b16afd6, f1b9c13c en `pruebas`):**
`deploy/empresas/` (compose core + tenant, plantillas .env/.env.core/nginx, README de
operación) y `scripts/` (`empresas_lib.sh`, `construir_imagen.sh`, `nueva_empresa.sh`,
`baja_empresa.sh`). En el servidor: worktree limpio `/home/iamet2026/crm-producto`
(imagen `crm-producto:<sha>`, build acotado), operación en `/home/iamet2026/crm-empresas`
(`.env.core` con root de MySQL y llave IA compartida copiada de pruebas, `.env.demo`,
`empresas.yml`, `IMAGEN_ACTUAL`), núcleo `crm-core` (contenedor `crm-mysql`, red
`crm_tenants`, sin puerto al host).

**Verificado:** alta desde cero de "Prueba Dos" en **66 s** (237 migraciones incluidas);
re-alta idempotente de la demo en ~30 s; `u_demo` solo ve `crm_demo` y el SELECT sobre
`crm_prueba2` es denegado (1142); `baja_empresa.sh prueba2 --purge` dejó respaldos de BD,
media y .env y borró todo lo demás; prod (:8000) y pruebas (:8001) siguieron en 200.
Consumo: crm-mysql 512 MB, web 200 MB, mailsync 90 MB.

**Demo viva:** empresa `demo` "Aceros del Norte" → `http://demo.82-223-44-29.nip.io/app/login/`
(nip.io resuelve a la IP sin tocar DNS; el puerto 8010 queda en 127.0.0.1 y el firewall
no expone puertos altos, así que nginx es la única puerta). Admin
`admin@acerosdelnorte.com`, contraseña en `/home/iamet2026/crm-empresas/.env.demo`.
Sin rastros de IAMET en crm/correo/calendario.

**Hallazgo corregido:** la cadena de migraciones no se reproducía desde cero (0063 se
editó después de aplicarse y 0143 volvía a crear `MailCorreo.oportunidad_id`).
`app/migrations/_seguro.py` aporta `AddFieldSiFalta`, `CreateModelSiFalta`, etc.; 0143
lo usa. Regla: si una migración vieja se edita a mano, usar estas operaciones.

**Pendientes de la Fase 2:** `--https` con certbot no se probó (no hay dominio real aún);
el modo Instalaciones del calendario ("Plan de Trabajo Bajanet") sigue visible para todas
las empresas (es de IAMET; candidato a bandera en el pulido). crm-pruebas sigue con el árbol
parchado en cdf9857b (no se le llevaron 25315c0f..f1b9c13c; no afectan a IAMET).


**Tareas**
1. `docker-compose.core.yml`: servicio `crm-mysql` (mysql:8.0, volumen
   `crm_core_db`, límite de memoria, red `crm_tenants`, puerto NO expuesto al
   host). Root solo desde el contenedor.
2. `docker-compose.tenant.yml` (plantilla): `web` + `mailsync` con
   `env_file: .env.<slug>`, `DB_HOST=crm-mysql`, puerto `${PUERTO}:8000`,
   volúmenes `media_<slug>` y `static_<slug>`, límites de memoria (web 768m,
   mailsync 256m), red `crm_tenants`. Sin volumen `.:/app`: **corre la imagen**
   (ver §4).
3. `scripts/nueva_empresa.sh <slug> [dominio] [puerto]`, idempotente:
   - crea base `crm_<slug>` y usuario `u_<slug>` con `GRANT ALL ON crm_<slug>.*`;
   - genera `.env.<slug>`: `DJANGO_SECRET_KEY`, `MAIL_ENCRYPTION_KEY` (Fernet)
     nuevas, credenciales de BD, `DJANGO_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`,
     `DJANGO_DEBUG=False`, `OPENROUTER_API_KEY` (decidir: llave por empresa o
     compartida con tope), `DJANGO_SUPERUSER_EMAIL/PASSWORD`;
   - `docker compose -p crm-<slug> -f docker-compose.tenant.yml up -d`
     (el entrypoint corre `migrate` + `collectstatic` + superusuario);
   - `manage.py seed_empresa --nombre "<Empresa>"`;
   - vhost nginx desde `nginx/tenant.conf.tmpl` + `certbot --nginx` si hay
     dominio; sin dominio, solo puerto;
   - registra en `empresas.yml` (slug, nombre, puerto, dominio, fecha, imagen);
   - verifica `curl 127.0.0.1:<puerto>/app/login/` → 200/302.
4. `scripts/baja_empresa.sh <slug>`: respaldo de BD + media → `~/backups/<slug>/`
   antes de bajar contenedores; borrar BD/usuario solo con `--purge`.
5. Asignación de puertos: 8010 en adelante (8000 prod, 8001 pruebas, 3005 web).

**Criterio de hecho**
- Alta completa desde cero en **< 10 minutos**, repetible dos veces seguidas
  sin errores, y Jafet puede correrla frente al cliente.
- Un usuario de la empresa A no puede conectarse a la base de la empresa B
  (probar con `mysql -u u_a` contra `crm_b`).

### Fase 3 — Demostración lista (1 día · días 4–5) — ✅ HECHA 2026-09-14

**Entregado (commits b3953473..b4722acd):** `manage.py seed_demo` (4 usuarios por rol, 15
clientes con contacto, 30 oportunidades en todas las etapas, conversación, 4 cotizaciones
con partidas, 17 actividades, 2 proyectos, 6 tareas, 5 prospectos, 6 correos simulados
analizados con IA; buzón simulado que el worker ignora; `--reset`; se niega en IAMET),
etapas por defecto compatibles con el código (Pagado/Perdido), **HTTPS en la demo** (con
`DJANGO_DEBUG=False` las cookies son Secure: sin HTTPS el login no funciona → `nueva_empresa.sh
--https` también para nip.io, idempotente con certbot), guion `deploy/empresas/GUION_DEMO.md`.
Rastros de IAMET eliminados: "IAMET AI" → AsistenteConfig.nombre, presets de correo, palma del
login, "Participantes IAMET", Leads Web del panel admin, modo Instalaciones/Técnicos del
calendario, comentarios internos. Selector de logo visible con vista previa (el input de
archivo lo oculta el CSS global).

**Verificado:** con navegador real (Brave headless + puppeteer) como Laura y Gerardo: login,
home (toast de Mi día con IA), Mi día (recomendaciones + feed 5 correos / 2 opps), tabla por
productos del catálogo, correo (6 en bandeja con chips de oportunidad), calendario,
prospección, panel Empresa/Catálogos, subida de logo (se ve en sidebar y /media por nginx),
PDF de cotización con datos de la empresa; consola limpia salvo `/favicon.ico`. Grep de
"iamet" en el HTML de todas las pantallas: solo el prefijo "IAMET ·" y el nombre interno
`proyectos_iamet` del JSON de módulos. Demo: `laura.mendoza` / `gerardo.ruiz`, contraseña
`Demo2026*`.

**Pendientes menores:** cabecera "Marca" de la columna producto (término de IAMET) en
tablas/kanban; `/favicon.ico` en la raíz; el recordatorio de jornada aparece al entrar
(es funcionalidad, no marca); el toggle Tabla/Kanban vive en el menú ☰.


**Tareas**
1. Comando `seed_demo`: empresa ficticia (p. ej. "Aceros del Norte", ya usada
   en el simulador), usuarios por rol (vendedor, supervisor, prospectador,
   administrador), ~15 clientes, ~30 oportunidades repartidas en etapas y meses,
   2–3 proyectos, actividades del calendario, y correos simulados vía el
   simulador existente (`/app/simulador-correo/`) para que "Mi día" y el
   asistente tengan material.
2. Instancia `demo` con `nueva_empresa.sh demo` en puerto 8010, servida por el
   nginx del host con la dirección actual (sin DNS nuevo).
3. Ensayo completo: guion de la presentación + alta en vivo de una segunda
   empresa durante la demo.
4. **Checklist "cero IAMET":** login, sidebar, títulos de pestaña, PDF de
   cotización, correos salientes, plantillas de correo, Marketing Hub apagado,
   avatares/temas por defecto, `grep -ri iamet` sobre el HTML renderizado de las
   pantallas principales.

**Criterio de hecho:** la demo se recorre de punta a punta sin mostrar datos ni
marca de IAMET, y el alta en vivo tarda menos de 10 minutos.

### Fase 4 — Operación, dos líneas de código y respaldos (½ día · día 5) — ✅ HECHA 2026-09-14

**Entregado (commit 655e7693 + ajuste):** rama **`producto`** creada y publicada (hoy =
`pruebas` verificado; tras el merge del multiempresa a `principal` se avanza con
`git merge --ff-only principal`); en el server el worktree `/home/iamet2026/crm-producto`
está en la rama `producto`. `scripts/deploy_all.sh` (construye una vez y actualiza todas las
empresas activas: IMAGEN en .env → up -d → espera → sin migraciones pendientes → inventario;
rollback y alto si una falla; `--ref`, `--imagen`, `--solo`, `--continuar`).
`scripts/backup_empresas.sh` (todas las bases crm_* + .env + media los domingos o `--media`,
retención 14/60/30 días, núcleo `.env.core`+`empresas.yml`) en cron de root a las 03:30.
`scripts/empresas_status.sh` (inventario vivo). README de operación actualizado.

**Verificado:** deploy_all demo (36 s), alta prueba4 desde cero (63 s), deploy_all con dos
empresas (5 s, ambas 200 y 0 migraciones pendientes), backup con archivos por empresa
(db/media/env) y del núcleo, cron instalado, baja prueba4 con purga.

**Pendiente humano:** autorizar la llave del server como Deploy key de solo lectura en
GitHub (Settings → Deploy keys) y cambiar el remoto a SSH; mientras, el código viaja por
bundle (README §"Cómo llega el código al servidor").


**Tareas**
1. **Rama `producto`** creada desde `principal`. Imagen `crm-producto:vN`
   (mismo Dockerfile). IAMET sigue con su imagen/rama `principal`.
2. `scripts/deploy_all.sh <tag>`: build acotado una vez → para cada empresa de
   `empresas.yml`: actualizar tag en su compose, `up -d`, esperar, `curl`
   de verificación, y `showmigrations` si hubo migración. Aborta y avisa si una
   empresa falla; no continúa a ciegas.
3. Respaldos: adaptar `~/backup_crm.sh` para iterar las bases `crm_*` del
   MySQL compartido (dump por empresa) + `media_<slug>`; retención 7/30 días.
4. `empresas.yml` como inventario único (fuente de verdad para deploy y backup).

**Criterio de hecho:** un `deploy_all` actualiza demo + una segunda empresa y
ambas responden; un backup produce un archivo por empresa.

### Fase 5 — Portal maestro: registro público con aprobación (2026-09-15) — ✅ HECHA

Decisión del usuario: la demo debe ser completa como la vería el cliente (link → registro →
autorización → entrar). `deploy/portal/` (Flask en el host, servicio `crm-portal`, nginx +
certbot en `portal.<ip>.nip.io`): portada, "Entrar a mi CRM" (redirige a la instancia por
nombre/slug/correo), "Crear mi empresa" (solicitud con honeypot, suma, cupo, límite por IP),
página de avance en vivo, panel interno (aprobar/rechazar/reintentar, aprobación automática,
tope, baja/purga). Hilo trabajador ejecuta los scripts de alta/baja de uno en uno.
**Verificado real:** registro → aprobación en panel → creación en 82 s con HTTPS → login con
la contraseña elegida → home 200 → "Entrar" por correo redirige → baja+borrar desde el panel
(contenedores, BD y vhost fuera; respaldos guardados). Capturas revisadas. `baja --purge`
ahora también borra el certificado del host. Pendiente: correo de bienvenida (sin SMTP).

**Rediseño 2026-09-28 (pedido del usuario):** el portal dejó de ser una página genérica y ahora
usa la misma pantalla del login del CRM (foto de palmeras + tarjeta con logo y palma); Entrar /
Crear mi empresa son pestañas de la tarjeta; `/` redirige a `/entrar`. Un identificador de una
empresa dada de baja vuelve a estar disponible. Verificado en vivo con capturas.

**Login único (2026-09-28, pedido del usuario):** "Entrar a mi CRM" es el login real (usuario/correo,
contraseña, recordarme, olvidé contraseña). SSO por token: `app/views_portal_sso.py`
(validar / reset / login por token firmado de un solo uso y 90 s; `PortalTokenUsado`, migración
0225), `PORTAL_SSO_SECRET` por empresa (plantilla .env + alta idempotente que lo agrega a las
existentes). Verificado en vivo: login por usuario y por correo → home 200, token reusado
rechazado, contraseña mala → mensaje del CRM, reset → notificación al supervisor, IAMET → 404.

**Portada + un solo inicio (2026-09-28, pedido del usuario: "tenemos 2 inicios"):** `/` es una
portada promocional (hero con la foto del login, 6 beneficios, 3 pasos, CTA) con "Iniciar sesión"
y "Pruébalo"; el login y el registro ya no llevan pestañas. Las instancias de clientes definen
`PORTAL_URL` y su `/app/login/` redirige al portal conservando `?next` y la empresa (hint para
validar primero ahí); IAMET no lo define y conserva su login.

**Autorización dentro del CRM (2026-09-29, pedido del usuario: "para no depender de otro portal"):**
el portal expone una API de administración por token (`PORTAL_ADMIN_TOKEN`); el Panel de
Administración del CRM de IAMET tiene la sección Producto → **Empresas del producto**
(`api/admin/portal/`, proxy, solo supervisores; visible solo con `PORTAL_ADMIN_URL` en el .env,
es decir IAMET; ya emparejado en crm-pruebas). Verificado desde el CRM: aprobar → empresa creada
en 68 s → ajustes → baja con borrado. Para producción: agregar las dos variables al .env de prod
en el merge.

**Siguiente (orden acordado):** revisión del usuario de la demo completa → "CRM lite" para
clientes (quitar IA, Mi día, empleado del mes, etc.; se define con el usuario) → merge.

### Fase 6 — Multitenant real (bridge): una app, una BD por empresa — 🔄 EN CURSO desde 2026-10-15

**Decisión (usuario, 2026-10-15).** Reemplaza "una instancia por empresa". Una
sola app (`TENANT_MODE=1`, línea `producto`) atiende a N empresas; cada request
resuelve su empresa por el **hostname** y se conecta a SU base (`crm_<slug>`,
usuario `u_<slug>` con GRANT solo sobre ella). IAMET producción y pruebas siguen
en modo clásico (`TENANT_MODE` apagado): mismo código, **cero cambio** de
comportamiento. Los datos no se mueven: ya existe una BD por empresa; cambia
solo la capa de conexión.

**Por qué bridge y no pool (columna `empresa` en cada tabla).** 146 modelos,
54k líneas de vistas, 34 SQL crudos: un filtro olvidado = fuga de datos y meses
de trabajo. En bridge la empresa A no puede ver la base de B *por construcción*
(router + GRANT de MySQL). Lo único que se pierde —consultas cruzadas entre
empresas— se resuelve con un job que recorre las bases.

**Diseño.**
- `tenants/` (app nueva; solo se instala con `TENANT_MODE=1`):
  - `Tenant` / `TenantHost` en la BD de **control** (`crm_control`, usuario
    `u_control`, variables `CONTROL_DB_*`). Es el único mapa hostname → base;
    reemplaza a `empresas.yml` + `.env.<slug>` como fuente de verdad.
  - `context.py`: contextvar del tenant actual + `tenant_context()` +
    `bind_tenant()` para hilos (threading no hereda contextvars).
  - `router.py`: `tenants` → `control`; todo lo demás → `t_<slug>` del tenant
    actual; **sin tenant → rechaza** (nunca `default` ni otra empresa);
    `default` no recibe migraciones en modo tenant.
  - `middleware.py`: resuelve por `Host` **antes** de sesiones/auth; host
    desconocido o empresa inactiva → 404; `/healthz/` responde sin BD.
  - `connections.py`: registra `connections.databases['t_<slug>']` en caliente.
  - `manage.py tenant_run <slug> <comando> [args]`: única forma de operar una
    empresa desde consola (migrate, seed_empresa, createsuperuser...).
- `settings.py`: bloque gateado por `TENANT_MODE` (app, middleware, BD de
  control, router, sufijos de host `TENANT_HOST_SUFFIXES`). `default` apunta a
  control a propósito: si algo lo toca por error, truena en vez de filtrar.
- `app/empresa.py`: caché prefijada por tenant (fuga #1 del mapeo) y sin
  fallback a "IAMET con todo abierto" en modo tenant (fuga #3).
- Un solo `SECRET_KEY` de app: las sesiones siguen separadas porque
  `django_session` vive en la BD de cada empresa y la cookie es por host.
  `MAIL_ENCRYPTION_KEY` y `PORTAL_SSO_SECRET` pasan a vivir en `Tenant` (6.1).

**Sub-fases y criterio de hecho.**
- **6.0 Cimiento** — ✅ HECHA 2026-10-15, verificada en server (app `tenants`,
  settings, router, middleware, comando, pruebas; commits dfc5d605 + aadf051e). Pruebas locales sin cargar `app`:
  `DJANGO_SETTINGS_MODULE=tenants.tests.settings_test python -m django test tenants`.
  Hecho cuando: pruebas en verde **y** en el server de pruebas una empresa real
  responde por hostname con `TENANT_MODE=1`.
  *Hallazgos de la verificación en server (2026-10-15):* (a) el Action de
  pruebas **no jala commits** (HEAD del server quedó en 41a05d46 con parches sin
  commitear) → la verificación corre en una copia aislada
  `/home/iamet2026/crm-f6smoke` (árbol de pruebas + overlay), con BD de control
  `crm_control`/`u_control` (`crm-empresas/.env.control`) y empresa de humo
  `crm_f6smoke` (`.env.f6smoke`), contenedor `crm-f6smoke` en `127.0.0.1:8099`
  con entrypoint gunicorn directo (el entrypoint oficial corre `migrate` y
  `createsuperuser` contra `default`). (b) **5 migraciones usan SQL crudo sobre
  `django.db.connection` (= `default`)**: `_seguro.py`, 0035, 0045, 0082, 0083 —
  bajo silo `default` era la empresa, bajo bridge es control → `tenant_run`
  repunta `default` a la BD del tenant mientras corre (solo consola; el web
  sigue estricto). (c) En código web el SQL crudo está **solo** en
  `views_proyectos.py` (3 `connection.cursor()`: ~4056, 4134, 4214) → 6.1.
  (d) Middleware verificado en vivo: host desconocido → 404, `127.0.0.1` → 404,
  `/healthz/` → 200, host del tenant → enruta a `crm_f6smoke` (nunca a control).
  (e) Cierre 6.0: migración desde cero + `seed_empresa` vía `tenant_run` OK;
  login del tenant 200 con título "Smoke Fase 6"; POST de login 302 → sesión
  creada en `crm_f6smoke.django_session` (auth_user=1); `crm_control` contiene
  SOLO `django_migrations`, `tenants_tenant`, `tenants_tenanthost` (el router no
  dejó pasar ninguna tabla de la app). Nota de harness: con `DJANGO_DEBUG=False`
  la cookie es `Secure` y curl no la reenvía por HTTP → el home vuelve al login;
  en el server real va con HTTPS (gotcha ya conocido de la Fase 3).
- **6.1 Blindaje** — ✅ HECHA 2026-10-15, verificada en server con 2 empresas
  (commit 1ef5d069; `tenants/runtime.py`, `tenants/storage.py`, `tenants/views.py`
  + parches en app; 17 pruebas). Resultado en vivo (`f6smoke` vs `f6b`): cada
  host ve su login y desconocido → 404; `/media/` sin login → 302 y `../` → 404;
  secreto SSO de A en host B → 403; token de A en B → rechazado (firma de otra
  empresa), en A → sesión, reutilizado → usado; sesiones por BD (A=3, B=0);
  control con 3 tablas. *Pendiente antes de PROD:* los webhooks de Bitrix ya no
  tienen default en el código → confirmar que el `.env` de producción define
  `BITRIX_PROJECTS_WEBHOOK_URL` y `BITRIX_DISK_UPLOAD_WEBHOOK_URL` (pruebas sí).
  Lo que cerró — las fugas del mapeo del 2026-10-15: hilos sin
  tenant (`views_mail.py:605-614`, `views_iamet.py:3901` → `bind_tenant`); token
  SSO sin empresa (`views_portal_sso.py:79` → firmar el slug y verificarlo contra
  el tenant resuelto); `MAIL_ENCRYPTION_KEY` / `PORTAL_SSO_SECRET` por tenant
  (`views_mail.py:48,61`, `views_portal_sso.py:34`); `MEDIA_ROOT` por tenant y
  `/media/` con autorización (`cartera_clientes/urls.py:29-33`); env leído al
  importar → en request (`context_processors.py:11,16`,
  `bitrix_integration.py:14-16` — y sacar del código el webhook real de IAMET);
  `cache.set('asist_xlsx_…')` con prefijo de tenant; OCR (`services_financiero.py:451`)
  por tenant o en cola. Hecho cuando: suite de aislamiento con 2 tenants en verde.
- **6.2 Workers** — ✅ HECHA 2026-10-15 (commit 45c71fba). `sincronizar_correo`
  recorre las empresas activas de control y corre cada pasada en
  `tenant_context` (router → su BD, llave Fernet propia) con `default`
  repuntado para el código legado; `close_all()` entre empresas; un error en
  una no detiene a las demás. Verificado en server: UN proceso, una pasada,
  `[f6b]` y `[f6smoke]` recorridas sin errores (las empresas de humo no tienen
  buzones; la sincronización IMAP real por empresa se ejercita en 6.4 con un
  buzón de verdad). `app/scheduler.py` no tiene llamadores (código muerto):
  se deja intacto.
- **6.3 Alta sin contenedor** — `nueva_empresa.sh` solo hace: BD + usuario +
  GRANT, `tenant_run <slug> migrate`, `seed_empresa`, alta en control (+ hosts).
  Sin puerto, sin vhost por empresa (uno comodín). Portal: la empresa se elige
  **antes** de autenticar (se elimina el fan-out de la contraseña a todas las
  instancias). Hecho cuando: alta < 15 s y login por hostname.
- **6.4 Migración y cierre** — registrar en control las empresas existentes
  (sus datos no se mueven), suite de aislamiento completa (vistas, media, SSO,
  hilos, caché), apagar los contenedores por empresa, `deploy_all.sh` migra por
  tenant. Hecho cuando: todas sirven desde la app compartida con la suite en verde.

**Riesgos → cobertura.** Caché de proceso → prefijo por tenant (6.0). Hilos →
`bind_tenant` (6.1). SSO → slug firmado (6.1). Media → ruta por tenant +
autorización (6.1). Resolución fallida → 404/500, nunca otra empresa (6.0).
Vecino ruidoso (OCR, IA) → límites/colas (6.1+). Secretos en BD de control →
usuario `u_control` solo con acceso a `crm_control`; cifrado en reposo queda
anotado para después de la firma.

**Reglas.** Con `TENANT_MODE` apagado nada cambia. Todo nace en `pruebas`;
`principal` y `producto` solo con orden explícita del usuario.

---

### Después de la firma (sin tiempo asignado)

- Panel maestro de altas/bajas/pausa (envoltorio web sobre los scripts).
- Planes y cobro; qué módulos incluye cada plan (ya son banderas).
- Dominio definitivo: registro comodín `*.crm.iamet.mx` y vhost por empresa.
- Ampliar RAM del 82 (16 GB) al pasar de ~4 empresas.
- Auto-registro (self-signup) si se quiere vender sin intervención.
- Evaluar "un proceso, muchas BD" si pasan de ~20 empresas.

---

## 4. Dos líneas de código (regla de trabajo permanente)

```
pruebas ──▶ principal (IAMET prod: laboratorio, todo entra)
               │
               │  con retraso (1–4 semanas), cuando Jafet decida
               ▼
           producto (clientes: solo lo que ya corrió estable en IAMET)
```

- **`producto` = `principal` con retraso + banderas.** No se escogen commits
  sueltos: así las migraciones siguen lineales y no hay conflictos en los
  archivos grandes. Única excepción: correcciones urgentes para clientes se
  pasan con `cherry-pick` el mismo día.
- **Nunca se desarrolla directo en `producto`.** Todo nace en `pruebas`.
- **Todo lo "muy IAMET" nace detrás de una bandera de `EmpresaConfig`.** Si se
  escribe suelto, viaja a los clientes en la siguiente liberación. Las
  banderas de IAMET van encendidas; las de clientes, apagadas por defecto.
- Cambios compartidos (asistente, modelos base, mailsync) se prueban en IAMET
  antes de liberarse: IAMET es el canario.
- Dos imágenes: `crm-iamet:<tag>` (principal) y `crm-producto:<tag>`.
- Los tenants **no montan `.:/app`**: corren la imagen. Así un parche en el
  árbol del servidor no les llega por accidente.

---

## 5. Gotchas conocidos que aplican aquí

- **Producción de IAMET no se toca sin orden explícita.** Todo en `pruebas`.
- El GitHub Action de pruebas **da verde falso** (el pull no autentica):
  verificar `git rev-parse --short HEAD` en el server y, si no coincide,
  deployar por parche (`git apply` + `docker restart crm-pruebas-web`).
- Builds en el 82 siempre acotados (`--cpuset-cpus="2,3" --memory=3g`) para
  no alentar prod. Revisar `ps aux | grep "docker build"` antes de construir.
- SSH del 82: usuario `root`, llave `~/.ssh/github_deploy`, `BatchMode=yes`,
  pausas entre conexiones; archivos grandes en chunks de 6 KB.
- Otro agente Claude puede estar trabajando en `pruebas`: `git add` solo de
  archivos propios, nunca `git add .`; revisar `git log` antes de commit/push.
- Al insertar helpers en `views_crm.py`, verificar que no queden pegados a los
  decoradores de la vista siguiente (ya pasó).
- `mailsync` es el único que habla IMAP; cada tenant lleva el suyo con su
  `MAIL_ENCRYPTION_KEY` propia. **Nunca reusar la llave ni las credenciales de
  IAMET** en un tenant.
- Costo IA: cada tenant con su `OPENROUTER_API_KEY` o una compartida con tope;
  decidirlo antes del primer cliente real (demo puede usar la de pruebas).
- `staticfiles/` no se commitea; el entrypoint corre `collectstatic`.

---

## 6. Pendientes del usuario (no bloquean la Fase 1)

- [ ] Fecha de la presentación.
- [ ] Nombre comercial del producto (hoy: "IAMET · <Empresa>").
- [ ] Registro DNS comodín `*.crm.iamet.mx` (cuando se decida el dominio).
- [ ] Quién paga la IA de cada cliente (llave por empresa vs. compartida).
- [ ] Borrar en Automatizaciones la regla de prueba "sdfsdf" (crea tareas
      basura al crear oportunidades; aparecería en la demo).

## 7. Checklist de arranque de la Fase 1

- [ ] `git fetch origin pruebas` y revisar qué hizo el otro agente.
- [ ] Rama de trabajo sobre `pruebas`; commits pequeños por tarea.
- [ ] Empezar por `EmpresaConfig` + context processor + login/sidebar (lo más
      visible), luego correos y PDF, luego catálogos, al final banderas.
- [ ] Probar en pruebas con nombre "Acme" y banderas apagadas; luego con las
      de IAMET encendidas (debe verse igual que hoy).

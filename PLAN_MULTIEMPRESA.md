# PLAN MULTIEMPRESA — CRM IAMET como producto para otras empresas

**Fecha del plan:** 2026-09-07 · **Estado:** Fase 1 HECHA y desplegada en pruebas (2026-09-07); sigue Fase 2
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

### Fase 2 — Alta automática de empresas (1.5 días · días 3–4)

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

### Fase 3 — Demostración lista (1 día · días 4–5)

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

### Fase 4 — Operación, dos líneas de código y respaldos (½ día · día 5)

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

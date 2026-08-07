# Servidor CRM IAMET — Operación e Infraestructura

> Documento de handoff: todo lo que vive en el VPS y no está en el repo.
> Complementa `WORKFLOW.md` (deploy del día-a-día) y `ESTRUCTURA.md` (código).
>
> **Última actualización:** 2026-06-05
> **Audiencia:** sucesor de Diego.

---

## 1. Acceso al servidor

| Qué | Cómo |
|-----|------|
| Cliente recomendado | Terminus (Mac/iOS) o cualquier SSH client |
| Host / IP | Ver documento privado de credenciales (NO en este repo) |
| Usuario operacional | `iamet2026` (uid 1000, grupo `sudo`) |
| Flujo recomendado | Conectar como root o como `iamet2026`; si entras como root, ejecuta `su - iamet2026` **antes** de tocar cualquier cosa en `~/crm-iamet` o `~/crm-pruebas`. Si editas como root quedan archivos `root:root` y `git pull` empieza a pedir sudo (ya hay drift así en `~/crm-pruebas/`). |
| Sudo | `iamet2026` puede `sudo` sin password configurado por defecto |
| 2FA | No configurado |

> **Credenciales (SSH, MySQL root, .env, API tokens):** viven fuera del repo.
> Entrega aparte por gestor de contraseñas o sobre cerrado al supervisor.
> En este repo solo se documentan **nombres de variables**, nunca valores.

---

## 2. Sistema base

| Componente | Valor |
|------------|-------|
| OS | Ubuntu 22.04.5 LTS (jammy) |
| Kernel | 5.15.0-168-generic (compilado 2026-01-09) |
| Hostname | `ubuntu` |
| Uptime al inventario | 126 días (último reboot ~2026-01-30) |
| RAM | 7.7 GiB total, ~3.4 GiB en uso, ~4 GiB disponibles |
| Swap | **0 B (no hay swap configurado)** ⚠️ |
| Disco | `/dev/vda1` 233 GB total, 42 GB usado (19%), 191 GB libres |
| Docker | 29.2.0 |
| Docker Compose | v5.1.0 |
| nginx | 1.18.0 (Ubuntu) |

---

## 3. Stacks corriendo en el servidor

Este VPS hospeda **varios proyectos**, no solo CRM IAMET. Conviene saber qué es qué antes de tocar.

| Contenedor | Imagen | Puerto host | Dominio público | Carpeta repo | Pertenece a |
|------------|--------|-------------|------------------|---------------|-------------|
| `gesti-n-de-ventas-web-1` | `gesti-n-de-ventas-web` | 8000 | `crm.iamet.mx` | `~/crm-iamet/` | CRM IAMET (prod) |
| `gesti-n-de-ventas-db-1` | `mysql:8.0` | (interna) | — | `~/crm-iamet/` | CRM IAMET (prod) |
| `crm-pruebas-web` | `crm-pruebas-web` | 8001 | `crm.pruebas.nethive.mx` | `~/crm-pruebas/` | CRM IAMET (pruebas) |
| `crm-pruebas-db` | `mysql:8.0` | (interna) | — | `~/crm-pruebas/` | CRM IAMET (pruebas) |
| `nethive-web-1` | `nethive-web` | 8002 | (sin dominio público confirmado) | — | Nethive (otro proyecto) |
| `nethive-db-1` | `mysql:8.0` | (interna) | — | — | Nethive |
| `iamet-website` | `pagina-iamet-iamet-web` | 3001 | `iamet.mx` | `~/pagina-iamet/` | Sitio público IAMET (Next/Node) |
| `iamet-cableado` | `cableado-estructurado-iamet-cableado` | 3003 | `cableado.iamet.mx` | `~/cableado-estructurado/` | Sub-sitio cableado |
| `ai-command-bridge-panel` | `frontend_vps-panel` | 8080 | (sin dominio público) | — | ⚠️ pendiente confirmar ownership |
| `funny_edison` | `hello-world` | — | — | — | Basura, `Exited (0)` hace 4 meses |

> **TODOs sobre los otros stacks:** ver §11 PENDIENTES. La sección de soporte y
> ownership de Nethive / iamet-website / ai-command-bridge-panel queda fuera del
> alcance del sucesor del CRM salvo que se acuerde lo contrario.

---

## 4. CRM IAMET — mapa operativo

### 4.1 Producción

| Qué | Valor |
|-----|-------|
| Dominio | `https://crm.iamet.mx` |
| Carpeta código | `/home/iamet2026/crm-iamet/` |
| Rama git | `principal` (HEAD al inventario: `ef55dd90`) |
| Compose project name | `gesti-n-de-ventas` (legacy — siempre usar `-p gesti-n-de-ventas`) |
| Contenedor web | `gesti-n-de-ventas-web-1` (puerto 8000) |
| Contenedor BD | `gesti-n-de-ventas-db-1` (MySQL 8.0, solo accesible dentro de la red Docker) |
| Base de datos | `crm_iamet_db` |
| Volumen media | `crm-iamet_media_files` (external en docker-compose.yml) — **~11 GB** |
| Mountpoint host del volumen | `/var/lib/docker/volumes/crm-iamet_media_files/_data/` |
| Variables entorno | `~/crm-iamet/.env` |

### 4.2 Pruebas

| Qué | Valor |
|-----|-------|
| Dominio | `https://crm.pruebas.nethive.mx` |
| Carpeta código | `/home/iamet2026/crm-pruebas/` |
| Rama git | `pruebas` (HEAD al inventario: `8da3412`) |
| Contenedor web | `crm-pruebas-web` (puerto 8001) |
| Contenedor BD | `crm-pruebas-db` |
| Base de datos | `crm_pruebas` |
| Volúmenes | `crm-pruebas_db_pruebas`, `crm-pruebas_media_pruebas`, `crm-pruebas_static_pruebas` |
| Media (host) | `~/crm-pruebas/media/` |
| Variables entorno | `~/crm-pruebas/.env.pruebas` |
| Compose file | `docker-compose.pruebas.yml` (lanzado con `--env-file .env.pruebas`) |

### 4.3 Volúmenes Docker (CRM)

| Volumen | Uso | Estado |
|---------|-----|--------|
| `crm-iamet_media_files` | Volumen **vivo** de producción (~11 GB con todo el drive Bitrix) | ACTIVO — montado en `gesti-n-de-ventas-web-1:/app/media` |
| `crm-iamet_db_data` | Huérfano potencial — no lo usa ningún contenedor activo | ⚠️ Inspeccionar antes de borrar |
| `gesti-n-de-ventas_db_data` | Creado por compose con el project-name legacy; **es** el datastore de la BD prod | ACTIVO |
| `gesti-n-de-ventas_media_files` | Creado por compose, no usado (compose declara media como external apuntando a `crm-iamet_media_files`) | Vacío / huérfano probable |
| `crm-pruebas_db_pruebas` / `crm-pruebas_media_pruebas` / `crm-pruebas_static_pruebas` | Stack de pruebas | ACTIVOS |

> ⚠️ **Los 3 nombres del CRM en producción son distintos a propósito:**
>
> - Carpeta del repo en disco → `~/crm-iamet/`
> - Compose project name (legacy) → `gesti-n-de-ventas`
> - Volumen externo de media → `crm-iamet_media_files`
>
> No es un error. Es legado. No renombrar nada sin un plan completo de migración
> (perderías 9.7 GB de archivos Bitrix si te equivocas).

---

## 5. Nginx

- Binario: nginx 1.18.0 (Ubuntu)
- Sitios habilitados: `/etc/nginx/sites-enabled/`
- Sitios disponibles: `/etc/nginx/sites-available/`
- Recargar: `sudo nginx -t && sudo systemctl reload nginx`
- Service: `nginx.service` activo desde 2026-06-03

### 5.1 Configs por dominio

| Archivo en `sites-enabled/` | Dominio | `proxy_pass` | Tipo |
|-----------------------------|---------|--------------|------|
| `crm.iamet.mx` | crm.iamet.mx | `http://127.0.0.1:8000` | **archivo plano (NO symlink)** ⚠️ |
| `crm.iamet.mx.bak` (Apr 20) | — | — | ⚠️ LEGACY — nginx lo lee igual, hay que sacarlo |
| `crm.pruebas.nethive.mx.conf` | crm.pruebas.nethive.mx | `http://127.0.0.1:8001` | symlink |
| `cableado.iamet.mx.conf` | cableado.iamet.mx | hacia stack cableado (3003) | symlink |
| `iamet.mx` | iamet.mx | hacia stack iamet-website (3001) | — |
| `nethive` | (Nethive) | hacia stack nethive (8002) | archivo plano |
| `bridge` | (panel AI) | — | symlink |

### 5.2 Locations relevantes — CRM prod (`crm.iamet.mx`)

```nginx
server_name crm.iamet.mx;
client_max_body_size 100M;

location /static/ {
    alias /home/iamet2026/crm-iamet/staticfiles/;
}

# ⚠️ FALTA — debería existir:
# location /media/ {
#     alias /var/lib/docker/volumes/crm-iamet_media_files/_data/;
# }

location / {
    proxy_pass http://127.0.0.1:8000;
}
```

### 5.3 Locations relevantes — CRM pruebas

```nginx
server_name crm.pruebas.nethive.mx;
client_max_body_size 50M;

location /static/ {
    alias /home/iamet2026/crm-pruebas/staticfiles/;
}

# ⚠️ FALTA — debería existir:
# location /media/ {
#     alias /home/iamet2026/crm-pruebas/media/;
# }

location / {
    proxy_pass http://127.0.0.1:8001;
}
```

> Ambos tienen redirect 80→443 OK y SSL por certbot.

---

## 6. SSL — certbot / Let's Encrypt

Renovación automática vía `/etc/cron.d/certbot`. Certificados activos en `/etc/letsencrypt/live/`.

| Dominio | Vence | Días restantes (al 2026-06-05) |
|---------|-------|-------------------------------|
| `crm.pruebas.nethive.mx` | **2026-07-22** | 46 ⚠️ |
| `crm.iamet.mx` | **2026-07-31** | 55 ⚠️ |
| `nethive.mx` | 2026-08-27 | 83 |
| `cableado.iamet.mx` | 2026-09-02 | 88 |
| `iamet.mx` | 2026-09-02 | 88 |

> ⚠️ Los dos certificados del CRM vencen **justo cuando Diego sale del proyecto**.
> Validar con `sudo certbot renew --dry-run` antes de la salida.
> Renovación manual si falla: `sudo certbot renew && sudo systemctl reload nginx`.

---

## 7. Cron

### 7.1 Crontab `iamet2026`

```
0 10 * * *  /home/iamet2026/backup_crm.sh
```

Único job — backup diario a las 10:00 UTC (= 02:00 hora Tijuana).

### 7.2 Crontab root

Vacío.

### 7.3 `/etc/cron.d/`

- `certbot` — auto-renovación SSL
- `e2scrub_all` — sistema

### 7.4 Crons que faltan ⚠️

- **`procesar_vencimientos`** (Fase 2 del Hardening). El comando existe en
  `app/management/commands/procesar_vencimientos.py` y la documentación lo
  da por activo, pero **no está agendado en el servidor**. Los vencimientos
  no se procesan automáticamente.

  Sugerido en `crontab -e` de `iamet2026`:
  ```
  */15 * * * * /usr/bin/docker exec gesti-n-de-ventas-web-1 python manage.py procesar_vencimientos >> /home/iamet2026/backups/procesar_vencimientos.log 2>&1
  ```

- **`limpiar_notificaciones_caducas`** (2026-08-05). Barre los avisos de
  vencimiento que ya no aplican: tareas completadas, reprogramadas o borradas.
  La API ya depura al leer, así que el usuario no las ve aunque el cron no
  corra; esto vacía el histórico y evita que la tabla siga creciendo.

  ```
  30 3 * * * /usr/bin/docker exec gesti-n-de-ventas-web-1 python manage.py limpiar_notificaciones_caducas >> /home/iamet2026/backups/limpiar_notificaciones.log 2>&1
  ```

  Para la primera pasada conviene verla en seco antes de aplicar:
  ```
  docker exec gesti-n-de-ventas-web-1 python manage.py limpiar_notificaciones_caducas --dry-run
  ```

---

## 8. Backups

### 8.1 Script

| Qué | Valor |
|-----|-------|
| Script | `/home/iamet2026/backup_crm.sh` (2260 bytes, owner `iamet2026`) |
| Variables | `/home/iamet2026/.backup_env` (perms 600, contiene `MYSQL_ROOT_PASSWORD`) |
| Destino | `/home/iamet2026/backups/` |
| Log | `/home/iamet2026/backups/backup.log` |

### 8.2 Qué se respalda

| Tipo | Frecuencia | Retención actual | Archivo | Estado |
|------|------------|-------------------|---------|--------|
| BD MySQL prod (dump) | Diario 10:00 UTC | 7 días | `db_YYYY-MM-DD_HH-MM.sql.gz` (~21 MB c/u) | ✅ Funciona |
| Media (volumen Bitrix) | Domingos | 4 semanas | `media_YYYY-MM-DD_HH-MM.tar.gz` (272 KB c/u) | 🚨 BUG — ver abajo |

### 8.3 🚨 BUG CRÍTICO — los backups de media NO respaldan los archivos reales

Los `.tar.gz` de media pesan **272 KB constantes** semana tras semana, pero el
volumen real `crm-iamet_media_files` pesa **~11 GB**. El script está empaquetando
`~/crm-iamet/media/` (carpeta del host, casi vacía porque el mount del volumen
Docker la overridea) en vez del directorio real del volumen.

**Resultado: 9.7 GB de archivos descargados desde Bitrix24 (avatares, PDFs,
contratos, planos — todo lo del drive) NO se están respaldando.**

Corregir cambiando la fuente del `tar` en `backup_crm.sh` a:
```bash
/var/lib/docker/volumes/crm-iamet_media_files/_data/
```
o usando `docker run --rm -v crm-iamet_media_files:/data alpine tar czf - /data`.

Tras corregir, validar: `ls -lh ~/backups/media_*.tar.gz` debe mostrar archivos
de varios GB, no 272 K.

### 8.4 Lo que NO existe (aún)

- **Sin backup offsite** — los `.sql.gz` y `.tar.gz` viven en el mismo disco
  `/dev/vda1` que la BD productiva. Si el VPS pierde el disco, se pierde
  todo simultáneamente.
- **Sin procedimiento de restauración documentado/probado** — los dumps existen
  pero nadie ha verificado que se puedan restaurar en frío.

### 8.5 Comandos útiles

```bash
# Backup manual
~/backup_crm.sh

# Ver log
cat ~/backups/backup.log

# Dump prod → pruebas (sync de datos)
sudo docker exec gesti-n-de-ventas-db-1 mysqldump -u root -p crm_iamet_db > /tmp/backup.sql
sudo docker exec -i crm-pruebas-db mysql -u root -p crm_pruebas < /tmp/backup.sql
```

---

## 9. Variables de entorno (`.env` keys)

Solo nombres. Los valores viven en `~/crm-iamet/.env` (prod) y
`~/crm-pruebas/.env.pruebas` (pruebas). **Nunca subir estos archivos al repo.**
Confirmar que tengan `chmod 600`.

### 9.1 Django

| Key | Notas |
|-----|-------|
| `DJANGO_SECRET_KEY` | Generar nueva si se compromete |
| `DJANGO_DEBUG` | ⚠️ Debe ser literal `False` en prod (default del código es `True`). Verificar con `docker exec gesti-n-de-ventas-web-1 env \| grep DJANGO_DEBUG` |
| `DJANGO_ALLOWED_HOSTS` | Hosts permitidos (crm.iamet.mx, etc.) |
| `CSRF_TRUSTED_ORIGINS` | Orígenes para CSRF |

### 9.2 Base de datos MySQL

| Key | Notas |
|-----|-------|
| `DB_NAME` | `crm_iamet_db` (prod) / `crm_pruebas` (pruebas) |
| `DB_USER` | usuario aplicación |
| `DB_PASSWORD` | password del usuario aplicación |
| `MYSQL_ROOT_PASSWORD` | Password root MySQL (también en `~/.backup_env`) |
| `DB_HOST` | hostname del contenedor BD |
| `DB_PORT` | `3306` |

### 9.3 Integraciones externas

| Key | Notas |
|-----|-------|
| `BITRIX_WEBHOOK_URL` | URL base webhook Bitrix24 |
| `BITRIX_WEBHOOK_TOKEN` | Token del webhook |
| `BITRIX_PROJECTS_WEBHOOK_URL` | Webhook para proyectos |
| `BITRIX_DISK_UPLOAD_WEBHOOK_URL` | Webhook para subir archivos al disk de Bitrix |
| `INCREMENTA_API_TOKEN` | Token API Incrementa |
| `GEMINI_API_TOKEN` | Token Gemini |
| `OPENROUTER_API_KEY` | API key OpenRouter |
| `LITELLM_MODEL` | Modelo por defecto |

> ⚠️ La key `BITRIX_DISK_UPLOAD_WEBHOOK_URL` aparece **duplicada** en ambos
> `.env` (tanto prod como pruebas). Limpiar para dejar una sola línea.

---

## 10. Quirks (las trampas que conviene saber antes de tocar nada)

1. **Compose project name legacy.** En producción es `gesti-n-de-ventas`, no
   `crm-iamet`. Cualquier comando de compose en prod requiere `-p gesti-n-de-ventas`,
   si no, compose crea un stack nuevo vacío con prefix `crm-iamet-*` que NO
   tiene los datos. Esto está documentado en `WORKFLOW.md` y `ESTRUCTURA.md`.

2. **El volumen `media_files` es `external` apuntando a `crm-iamet_media_files`.**
   Si alguien edita `docker-compose.yml` y le quita el `external`, compose crea
   un volumen `gesti-n-de-ventas_media_files` vacío y "desaparecen" los 9.7 GB
   de Bitrix para el contenedor (los datos siguen vivos en el volumen original,
   solo se rompe el mount).

3. **`~/crm-iamet/media/` está VACÍO en el host.** Los archivos reales están en
   el volumen Docker. El mount del contenedor overridea esa carpeta. **Por esto
   el backup de media está roto** (ver §8.3).

4. **Carpeta fantasma `~/Gesti-n-de-ventas/`.** En el home del usuario hay un
   directorio con el nombre original del repo. Trampa cognitiva: el sucesor
   verá `gesti-n-de-ventas-*` en `docker ps` y buscará el código ahí — NO está
   ahí, está en `~/crm-iamet/`.

5. **Carpeta de pruebas tiene archivos `root:root`.** Varios `.md` y el
   `Dockerfile` en `~/crm-pruebas/` son de root, mezclados con archivos de
   `iamet2026`. Confunde y bloquea operaciones de git sin sudo. Corregir con
   `sudo chown -R iamet2026:iamet2026 ~/crm-pruebas`.

6. **`crm.iamet.mx` en sites-enabled es archivo plano, no symlink.** Si el
   sucesor edita `sites-available/crm.iamet.mx` esperando que nginx lo lea,
   no pasa nada. Convertir a symlink siguiendo la convención Debian/Ubuntu
   (`sites-enabled` debe ser symlink → `sites-available`).

7. **`crm.iamet.mx.bak` en sites-enabled.** nginx carga TODOS los archivos del
   directorio, así que el `.bak` también se evalúa — puede generar warnings o
   conflictos. Sacar al fuera con `sudo mv /etc/nginx/sites-enabled/crm.iamet.mx.bak ~/`.

8. **nginx NO sirve `/media/` directamente.** Toda request a un archivo media
   pasa por gunicorn → consume worker, agrega latencia y satura. Esto explica
   parte de los `upstream timed out (110)` en los logs. `ESTRUCTURA.md` ya
   documenta el bloque `location /media/` que debería existir.

9. **gunicorn corre con 1 worker sync.** El `Dockerfile` configura
   `--workers 5 --worker-class gevent` pero `docker-compose.yml` lo sobrescribe
   con un `command:` que no pasa workers. Resultado: una sola request lenta
   tapa el server. Quitar el `command:` del compose para heredar del Dockerfile.

10. **Sin swap.** Si MySQL o gunicorn hacen un spike, el OOM-killer mata
    procesos. Crear un swap de 4 GB es trivial y barato.

11. **Repositorio en cuenta personal de GitHub.** `https://github.com/DiegoRiv7/CRM-IAMET.git`
    está bajo la cuenta personal de Diego. Si Diego cierra la cuenta o pone el
    repo en privado, IAMET queda sin acceso. Transferir a organización IAMET
    antes de la salida.

---

## 11. PENDIENTES POST-INVENTARIO

Hallazgos de la auditoría 2026-06-05 que requieren acción. Severidad indicada;
ver `Plan_Fase6_Refactor.md` para el orden y las sub-fases.

### Críticos (acción urgente)

- 🚨 **Backup de media respalda carpeta vacía** — corregir `~/backup_crm.sh`
  para tar del volumen Docker real. **9.7 GB de Bitrix sin backup hoy.** (§8.3)
- 🚨 **Sin backup offsite** — configurar copia a S3/B2/GDrive vía rclone o
  restic al final de `backup_crm.sh`. Si se pierde el disco del VPS, no hay
  recuperación. (§8.4)
- 🚨 **Documento de accesos / credenciales** — SSH, repo GitHub, Bitrix portal,
  certbot email, dueños de tokens externos (Gemini, OpenRouter, Incrementa).
  Entrega fuera de repo (gestor de contraseñas o sobre cerrado).

### Altos (resolver antes de la salida de Diego)

- ⚠️ Validar renovación SSL: `sudo certbot renew --dry-run`. Cert prod vence
  2026-07-31, pruebas 2026-07-22. (§6)
- ⚠️ Confirmar `DJANGO_DEBUG=False` literal en prod: `docker exec gesti-n-de-ventas-web-1 env | grep DJANGO_DEBUG`. (§9.1)
- ⚠️ Agregar cron `procesar_vencimientos` (Fase 2 del Hardening está incompleta
  sin esto). (§7.4)
- ⚠️ Quitar el `command:` de `docker-compose.yml` para que gunicorn levante
  con los 5 workers gevent del Dockerfile (root cause de los `upstream timed
  out` en logs). (§10 punto 9)
- ⚠️ Aumentar retención de backups: 30 días de dumps diarios + 1 dump mensual
  preservado todo el año. (§8.2)
- ⚠️ Setup mínimo de monitoring: UptimeRobot para los dominios + Healthchecks.io
  para que `backup_crm.sh` haga `curl https://hc-ping.com/<uuid>` al final.
- ⚠️ Runbook de restauración: documentar pasos exactos para BD y media,
  probarlo en `crm-pruebas`.
- ⚠️ Transferir repo GitHub `DiegoRiv7/CRM-IAMET` a organización IAMET.
  Actualizar `WORKFLOW.md` y los `git remote set-url origin` del servidor.
- ⚠️ Crear `HERENCIA.md` consolidando bugs aceptados, features prometidas y
  deudas técnicas para que el sucesor tenga un único punto de entrada.

### Medios

- Agregar `location /media/` en nginx prod y pruebas (ESTRUCTURA.md ya lo
  documenta como esperado). (§5.2, §5.3)
- Quitar `crm.iamet.mx.bak` de `sites-enabled/`. (§10 punto 7)
- Convertir `sites-enabled/crm.iamet.mx` a symlink hacia `sites-available/`. (§10 punto 6)
- Crear swap de 4 GB persistente en `/etc/fstab`. (§10 punto 10)
- Limpiar archivos basura en `~/crm-iamet/`: `docker-compose.yml.bak`,
  `FETCH_HEAD`, `nethive_backup.sql`, `project_links_backup.json`,
  `Reporte_Avances_18_Mayo_2026.html`. (§4 inventario)
- Decidir destino de `~/Gesti-n-de-ventas/` (borrar o mover a `~/_legacy/`).
- Decidir destino de `~/cotizaciones_backup.sql`, `~/mapeo_inserts.sql`,
  `~/mapeo_oportunidades.txt`, `~/nethive_backup.sql` (legacy en home).
- Investigar archivos modificados en `staticfiles/` (theme.js, admin_custom.css)
  en prod y pruebas — decidir si revertir o promover al repo en `app/static/`.
- Confirmar volumen `crm-iamet_db_data` (huérfano potencial). Si está vacío:
  `sudo docker volume rm crm-iamet_db_data`. Si tiene datos, exportar a
  `~/backups/legacy/`. (§4.3)
- `sudo chown -R iamet2026:iamet2026 ~/crm-pruebas` para corregir drift de
  ownership de `.md`. (§10 punto 5)
- Quitar duplicado de `BITRIX_DISK_UPLOAD_WEBHOOK_URL` en ambos `.env`. (§9.3)
- Confirmar permisos `chmod 600` en `~/crm-iamet/.env` y `~/crm-pruebas/.env.pruebas`.
- Descomentar bloque de seguridad Django en `cartera_clientes/settings.py`
  (HSTS, SECURE_CONTENT_TYPE_NOSNIFF, SECURE_SSL_REDIRECT) dentro de `if not DEBUG:`.
- Reemplazar `X_FRAME_OPTIONS='ALLOWALL'` por `SAMEORIGIN` o por CSP con
  `frame-ancestors`.
- Agregar headers de seguridad nginx (HSTS, X-Content-Type-Options, Referrer-Policy)
  en los server blocks SSL.
- Cambiar `ports:` de los servicios web en compose a `127.0.0.1:8000:8000` para
  que no estén expuestos en `0.0.0.0` directo (bypassean nginx + SSL).
- Agregar `restart: unless-stopped` a los servicios web/db de los `docker-compose.yml`.
- Confirmar ownership de `ai-command-bridge-panel` (¿se mantiene o se apaga?).
- Limpiar prints de debug "Avatar URL para X: None" en `views_*.py`.
- Investigar `RuntimeWarning: DateTimeField Tarea.fecha_limite received a naive datetime`
  (envolver con `timezone.make_aware`).
- Investigar `SENT sync error: command SEARCH illegal in state AUTH` en `views_mail`
  (suele faltar `select(folder)` antes del search).

### Bajos / informativos

- Considerar `django-axes` o rate-limit nginx para `/admin/` y `/accounts/login/`.
- Programar reboot controlado con `apt upgrade` antes de la salida de Diego
  (uptime 126 días — deuda de parches de kernel).
- Documentar los stacks no-CRM (Nethive, iamet-website, iamet-cableado,
  ai-command-bridge-panel) o declararlos explícitamente como "no es scope del
  sucesor del CRM, contactar a X".

---

## 12. Referencias rápidas

- **Deploy día a día:** `WORKFLOW.md`
- **Mapa del código:** `ESTRUCTURA.md`
- **Plan de handoff y refactor:** `Plan_Fase6_Refactor.md`
- **Bugs / deudas técnicas pendientes:** `MEJORAS_DEUDA_TECNICA.md`, `BUGS_PENDIENTES_FASE5.md`
- **Optimización pendiente:** `Optimizacion_Performance_Pendiente.md`
- **Histórico de Fases 1-3:** `Plan_Hardening_CRM.md`

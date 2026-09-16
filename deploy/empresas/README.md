# Multiempresa — operación en el servidor (Fase 2)

Cada empresa cliente corre como **su propia instancia** (web + mailsync) con **su
base de datos y usuario propios** dentro de un **MySQL compartido** (`crm-mysql`).
IAMET producción y pruebas no participan: conservan sus contenedores `db`.
Plan completo: `PLAN_MULTIEMPRESA.md`.

## Rutas en el servidor 82.223.44.29

| Ruta | Qué es |
|---|---|
| `/home/iamet2026/crm-producto` | Código del producto: **worktree limpio** de git en un commit (de aquí sale la imagen). |
| `/home/iamet2026/crm-empresas` | Operación: `.env.core`, `.env.<slug>`, `empresas.yml`, `IMAGEN_ACTUAL`. Permisos 700. |
| `/home/iamet2026/backups/empresas/<slug>/` | Respaldos que deja `baja_empresa.sh`. |
| `/etc/nginx/sites-available/crm-<slug>.conf` | Vhost de cada empresa (lo genera el alta). |

## Preparación (una sola vez)

```bash
# 1) worktree limpio del código (comparte objetos con crm-pruebas, no toca su árbol)
cd /home/iamet2026/crm-pruebas
git worktree add /home/iamet2026/crm-producto <commit>

# 2) imagen del producto (build acotado para no alentar producción)
/home/iamet2026/crm-producto/scripts/construir_imagen.sh

# 3) (opcional) llave de IA que heredan las empresas nuevas
#    editar /home/iamet2026/crm-empresas/.env.core → OPENROUTER_API_KEY_COMPARTIDA=...
```

## Alta de una empresa

```bash
/home/iamet2026/crm-producto/scripts/nueva_empresa.sh acme --nombre "Acme S.A." \
    --correo ventas@acme.com --admin-email admin@acme.com
```

Resultado en < 10 min: `http://82.223.44.29:<puerto>/app/login/` y
`http://acme.82-223-44-29.nip.io/app/login/` (nip.io resuelve al server sin
tocar DNS). Con dominio propio: `--dominio acme.crm.iamet.mx --https`
(requiere el registro DNS apuntando al server). El script es idempotente:
volver a correrlo con el mismo slug conserva llaves, contraseñas y datos.

## Actualizar el código de todas las empresas (Fase 4)

```bash
cd /home/iamet2026/crm-producto
scripts/deploy_all.sh --ref producto        # mueve el worktree a la rama, construye la imagen y actualiza todas
scripts/deploy_all.sh --solo demo           # una sola empresa
scripts/deploy_all.sh --imagen crm-producto:abc123   # reutilizar una imagen ya construida
```
Por empresa: cambia `IMAGEN` en su `.env`, `up -d` (migra al arrancar), espera al login,
verifica que no queden migraciones pendientes y registra la imagen en `empresas.yml`.
Si una empresa falla, la regresa a su imagen anterior y se detiene (`--continuar` para
seguir con las demás).

### Dos líneas de código
- `principal` = CRM de IAMET (laboratorio; ahí entra todo primero).
- `producto` = lo que corren los clientes: `principal` con retraso, cuando se decida
  liberar. Hasta el merge del multiempresa a `principal`, `producto` nace de `pruebas`
  ya verificado; después se avanza con `git merge --ff-only principal`.
- Nunca se desarrolla directo en `producto`. Correcciones urgentes: `cherry-pick`.

### Cómo llega el código al servidor
El server no tiene credenciales para GitHub (el `git pull` del Action falla en silencio).
Dos opciones:
1. **Autorizar la llave del servidor (recomendado, 2 min):** GitHub → repo → Settings →
   Deploy keys → Add, pegar `/root/.ssh/id_ed25519.pub` (solo lectura) y en el server
   `git -C /home/iamet2026/crm-pruebas remote set-url origin git@github.com:DiegoRiv7/CRM-IAMET.git`.
   Desde entonces `deploy_all.sh --ref producto` hace `git fetch` solo.
2. **Bundle por SSH** (lo que se usa hoy): `git bundle create f.bundle <base>..producto`,
   mandarlo en trozos de 6 KB y `git -C /home/iamet2026/crm-pruebas fetch f.bundle producto:refs/remotes/bundle/producto`,
   y luego `git -C /home/iamet2026/crm-producto merge --ff-only refs/remotes/bundle/producto`.
   **Nunca** hagas `fetch ... producto:producto` sobre la rama que el worktree tiene
   activa: mueve la rama sin tocar los archivos y el worktree queda desfasado (si pasa:
   `git -C /home/iamet2026/crm-producto checkout HEAD -- .`).

## Respaldos

```bash
scripts/backup_empresas.sh           # BD de cada empresa (+ media los domingos) + .env.core + empresas.yml
scripts/backup_empresas.sh --media   # forzar media hoy
```
Cron (root, 03:30): `30 3 * * * /home/iamet2026/crm-producto/scripts/backup_empresas.sh >> /home/iamet2026/crm-empresas/backup.log 2>&1`.
Retención: BD 14 días, media 60, env 30. Restaurar una empresa:
`gunzip < db-<fecha>.sql.gz | docker exec -i -e MYSQL_PWD=... crm-mysql mysql -uroot crm_<slug>` y
`docker run --rm -v crm-<slug>_media:/m -v <dir>:/b alpine tar xzf /b/media-<fecha>.tgz -C /m`.

## Estado

```bash
scripts/empresas_status.sh     # contenedores, imagen, migraciones pendientes y URL de cada empresa
```

## Baja

```bash
scripts/baja_empresa.sh acme            # detiene; conserva base, media y .env
scripts/baja_empresa.sh acme --purge    # borra todo (siempre respalda antes)
```

## Seguridad

- Cada empresa: `DJANGO_SECRET_KEY`, `MAIL_ENCRYPTION_KEY`, contraseña de BD y
  superusuario **propios y aleatorios**. Nunca se reutiliza nada de IAMET.
- El usuario `u_<slug>` solo tiene permisos sobre `crm_<slug>`.
- `crm-mysql` no expone puerto al host; solo la red Docker `crm_tenants`.
- Los contenedores corren la imagen (no montan el código del servidor).

## Portal maestro (Fase 5) — registro público y panel

Servicio `crm-portal` (Flask + gunicorn en 127.0.0.1:8090, systemd, nginx con HTTPS) que
vive en el host, fuera de las instancias. Código en `deploy/portal/`.

```bash
deploy/portal/instalar_portal.sh [--dominio portal.crm.iamet.mx]   # instala/actualiza (idempotente)
systemctl restart crm-portal                                        # tras cambiar portal.py
journalctl -u crm-portal -f                                         # log
```
- Público: `/` portada · `/entrar` (nombre, identificador o correo → login de su instancia) ·
  `/registro` (solicitud con honeypot, suma de verificación, tope de cupo y límite por IP) ·
  `/solicitud/<token>` (avance en vivo; guarda el enlace).
- Panel `/panel` (usuario y contraseña en `/home/iamet2026/crm-empresas/portal.env`):
  aprobar/rechazar/reintentar solicitudes, interruptor **aprobación automática**, tope de
  empresas, empresas del servidor con Login / Baja / Baja + borrar.
- Un hilo del servicio ejecuta `nueva_empresa.sh --https` y `baja_empresa.sh` de una en una;
  el log de cada trabajo queda en `portal.db` (SQLite). La contraseña del administrador se
  guarda solo hasta que la instancia existe.
- Pendiente: correo de bienvenida (no hay SMTP del portal); hoy el registrante ve sus
  accesos en la página de la solicitud.

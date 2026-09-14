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

## Actualizar el código de todas las empresas

```bash
cd /home/iamet2026/crm-producto && git checkout --detach <commit-nuevo>
scripts/construir_imagen.sh
for s in $(python3 -c "import yaml;print(' '.join(e['slug'] for e in yaml.safe_load(open('/home/iamet2026/crm-empresas/empresas.yml')) if e['activa']))"); do
  scripts/nueva_empresa.sh $s        # re-crea los contenedores con la imagen nueva (migra al arrancar)
done
```
(La Fase 4 lo empaqueta en `deploy_all.sh`.)

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

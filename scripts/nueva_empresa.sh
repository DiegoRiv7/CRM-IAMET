#!/bin/bash
# MULTIEMPRESA — Alta de una empresa NUEVA en menos de 10 minutos. Idempotente.
#
#   scripts/nueva_empresa.sh <slug> --nombre "Acme S.A." [opciones]
#
#   --nombre "..."         Nombre de la empresa (obligatorio la primera vez)
#   --dominio acme.crm.iamet.mx   Dominio propio (requiere DNS apuntando al server)
#   --https                Certificado Let's Encrypt (para --dominio, o para el nombre nip.io). RECOMENDADO: sin HTTPS el login no funciona
#   --puerto 8010          Puerto en el host (default: el siguiente libre desde 8010)
#   --admin-email x        Correo del superusuario inicial (default: admin@<slug>.local)
#   --admin-password y     Contraseña del superusuario (default: aleatoria, se imprime)
#   --correo ventas@...    Correo de ventas/contacto de la empresa
#   --sitio https://...    Sitio web de la empresa
#   --imagen crm-producto:abc123   Imagen a usar (default: IMAGEN_ACTUAL)
#   --catalogo-iamet       Catálogo de marcas de IAMET en vez del genérico
#   --sin-nginx            No tocar el nginx del host
#
# Pasos: núcleo (red + MySQL compartido) → base y usuario propios → .env con llaves
# propias → contenedores web + mailsync (migrate + collectstatic al arrancar) →
# seed_empresa → vhost nginx (+ certbot) → inventario → verificación.
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
INICIO=$(date +%s)

SLUG="${1:-}"; [[ -n "$SLUG" ]] || { sed -n '2,20p' "$0"; exit 1; }
shift
validar_slug "$SLUG"
NOMBRE=""; DOMINIO=""; HTTPS=0; PUERTO=""; ADMIN_EMAIL=""; ADMIN_PASSWORD=""; CORREO=""; SITIO=""; IMAGEN=""; CAT_IAMET=0; SIN_NGINX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --nombre) NOMBRE="$2"; shift 2;;
    --dominio) DOMINIO="$2"; shift 2;;
    --https) HTTPS=1; shift;;
    --puerto) PUERTO="$2"; shift 2;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2;;
    --correo) CORREO="$2"; shift 2;;
    --sitio) SITIO="$2"; shift 2;;
    --imagen) IMAGEN="$2"; shift 2;;
    --catalogo-iamet) CAT_IAMET=1; shift;;
    --sin-nginx) SIN_NGINX=1; shift;;
    *) die "opción desconocida: $1";;
  esac
done

mkdir -p "$EMPRESAS_DIR" "$EMPRESAS_DIR/nginx"
chmod 700 "$EMPRESAS_DIR"
[[ -d "$DEPLOY_DIR" ]] || die "No existe $DEPLOY_DIR (¿SRC_DIR apunta al código del producto?)"

# ── 0. Núcleo ────────────────────────────────────────────────────────────
if [[ ! -f "$CORE_ENV" ]]; then
  log "Creando $CORE_ENV (contraseña root nueva para el MySQL compartido)"
  sed -e "s|__ROOT_PASSWORD__|$(aleatorio 24)|" -e "s|__FECHA__|$(date +%F)|" "$DEPLOY_DIR/env.core.tmpl" > "$CORE_ENV"
  chmod 600 "$CORE_ENV"
  warn "OPENROUTER_API_KEY_COMPARTIDA está vacía en $CORE_ENV: la IA queda apagada hasta capturar una llave"
fi
cargar_core_env
asegurar_core

# ── 1. Imagen ────────────────────────────────────────────────────────────
IMAGEN="${IMAGEN:-$(imagen_actual)}"
[[ -n "$IMAGEN" ]] || die "No hay imagen: corre scripts/construir_imagen.sh primero (o pasa --imagen)"
docker image inspect "$IMAGEN" >/dev/null 2>&1 || die "La imagen $IMAGEN no existe en este servidor"
ok "Imagen: $IMAGEN"

# ── 2. Puerto y env de la empresa (reusar si ya existe) ─────────────────
ENV_FILE="$EMPRESAS_DIR/.env.$SLUG"
NIP="$SLUG.$(tr . - <<<"$IP_PUBLICA").nip.io"
if [[ -f "$ENV_FILE" ]]; then
  log "Ya existe $ENV_FILE: se conservan llaves y contraseñas"
  # shellcheck disable=SC1090
  DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
  PUERTO="${PUERTO:-$(grep -E '^PUERTO=' "$ENV_FILE" | cut -d= -f2-)}"
  [[ -n "$NOMBRE" ]] || NOMBRE="$(python3 -c "import yaml;print(next((e['nombre'] for e in (yaml.safe_load(open('$INVENTARIO')) or []) if e['slug']=='$SLUG'),''))" 2>/dev/null || true)"
else
  [[ -n "$NOMBRE" ]] || die "Falta --nombre \"Nombre de la empresa\""
  DB_PASSWORD="$(aleatorio 16)"
fi
[[ -n "$NOMBRE" ]] || die "No sé el nombre de la empresa: pásalo con --nombre"
PUERTO="${PUERTO:-$(siguiente_puerto_libre)}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@$SLUG.local}"
ADMIN_PASSWORD_GENERADA=0
if [[ -z "$ADMIN_PASSWORD" ]]; then
  if [[ -f "$ENV_FILE" ]]; then ADMIN_PASSWORD="$(grep -E '^DJANGO_SUPERUSER_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"; fi
  if [[ -z "$ADMIN_PASSWORD" ]]; then ADMIN_PASSWORD="$(aleatorio 8)"; ADMIN_PASSWORD_GENERADA=1; fi
fi

# ── 3. Base de datos y usuario propios ───────────────────────────────────
log "Base crm_$SLUG y usuario u_$SLUG en el MySQL compartido"
mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS \`crm_$SLUG\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'u_$SLUG'@'%' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER 'u_$SLUG'@'%' IDENTIFIED BY '$DB_PASSWORD';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'u_$SLUG'@'%';
GRANT ALL PRIVILEGES ON \`crm_$SLUG\`.* TO 'u_$SLUG'@'%';
FLUSH PRIVILEGES;
SQL
ok "base y usuario listos (permisos solo sobre crm_$SLUG)"

# ── 4. .env de la empresa ────────────────────────────────────────────────
HOSTS="127.0.0.1,localhost,$IP_PUBLICA,$NIP,crm-$SLUG-web"
ORIGENES="http://$IP_PUBLICA:$PUERTO,http://$NIP,https://$NIP"
if [[ -n "$DOMINIO" ]]; then HOSTS="$HOSTS,$DOMINIO"; ORIGENES="$ORIGENES,http://$DOMINIO,https://$DOMINIO"; fi
if [[ ! -f "$ENV_FILE" ]]; then
  log "Generando $ENV_FILE (SECRET_KEY y llave de correo nuevas)"
  MAIL_KEY="$(docker run --rm --entrypoint python "$IMAGEN" -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
  SECRET_KEY="$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-60)"
  sed -e "s|__SLUG__|$SLUG|g" -e "s|__FECHA__|$(date +%F)|" -e "s|__PUERTO__|$PUERTO|" -e "s|__IMAGEN__|$IMAGEN|" \
      -e "s|__ENV_FILE__|$ENV_FILE|" -e "s|__SECRET_KEY__|$SECRET_KEY|" -e "s|__ALLOWED_HOSTS__|$HOSTS|" \
      -e "s|__CSRF_ORIGINS__|$ORIGENES|" -e "s|__DB_PASSWORD__|$DB_PASSWORD|" -e "s|__MAIL_KEY__|$MAIL_KEY|" \
      -e "s|__OPENROUTER_KEY__|${OPENROUTER_API_KEY_COMPARTIDA:-}|" -e "s|__ADMIN_EMAIL__|$ADMIN_EMAIL|" \
      -e "s|__ADMIN_PASSWORD__|$ADMIN_PASSWORD|" "$DEPLOY_DIR/env.tenant.tmpl" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  # Actualizar solo lo que puede cambiar entre corridas (imagen, puerto, hosts).
  sed -i -e "s|^IMAGEN=.*|IMAGEN=$IMAGEN|" -e "s|^PUERTO=.*|PUERTO=$PUERTO|" -e "s|^DJANGO_ALLOWED_HOSTS=.*|DJANGO_ALLOWED_HOSTS=$HOSTS|" -e "s|^CSRF_TRUSTED_ORIGINS=.*|CSRF_TRUSTED_ORIGINS=$ORIGENES|" "$ENV_FILE"
fi
ok ".env listo (puerto $PUERTO)"

# ── 5. Contenedores ──────────────────────────────────────────────────────
log "Levantando crm-$SLUG-web y crm-$SLUG-mailsync (migraciones + estáticos al arrancar)"
compose_tenant "$SLUG" up -d --remove-orphans >/dev/null
esperar_web "$PUERTO" 180 || { docker logs --tail 40 "crm-$SLUG-web"; die "web no arrancó; revisa los logs arriba"; }

# ── 6. Semilla ───────────────────────────────────────────────────────────
log "Semilla de la empresa (config, catálogos, etapas, asistente)"
ARGS_SEED=(--nombre "$NOMBRE" --slug "$SLUG")
[[ -n "$CORREO" ]] && ARGS_SEED+=(--correo "$CORREO")
[[ -n "$SITIO" ]] && ARGS_SEED+=(--sitio "$SITIO")
[[ -n "$CORREO" ]] && ARGS_SEED+=(--dominio "${CORREO#*@}")
[[ $CAT_IAMET -eq 1 ]] && ARGS_SEED+=(--catalogo-iamet)
docker exec "crm-$SLUG-web" python manage.py seed_empresa "${ARGS_SEED[@]}" | sed 's/^/  /'

# ── 7. nginx del host ────────────────────────────────────────────────────
if [[ $SIN_NGINX -eq 0 && -d "$NGINX_AVAIL" ]] && command -v nginx >/dev/null; then
  NAMES="$NIP"; [[ -n "$DOMINIO" ]] && NAMES="$DOMINIO $NIP"
  CONF="$NGINX_AVAIL/crm-$SLUG.conf"
  if [[ -f "$CONF" ]] && grep -q "managed by Certbot" "$CONF"; then
    ok "nginx: vhost existente con HTTPS (certbot) — se conserva"
  else
    sed -e "s|__SLUG__|$SLUG|g" -e "s|__FECHA__|$(date +%F)|" -e "s|__PUERTO__|$PUERTO|" -e "s|__SERVER_NAMES__|$NAMES|" "$DEPLOY_DIR/nginx-tenant.conf.tmpl" > "$CONF"
  fi
  ln -sf "$CONF" "$NGINX_ENABLED/crm-$SLUG.conf"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx && ok "nginx: $NAMES → :$PUERTO"
    # HTTPS: con dominio propio usa el dominio; sin dominio, el nombre nip.io también
    # acepta certificado de Let's Encrypt. Necesario: con DJANGO_DEBUG=False las cookies
    # de sesión son Secure y el login NO funciona sobre HTTP.
    CERT_DOM="${DOMINIO:-$NIP}"
    if [[ $HTTPS -eq 1 ]] && ! grep -q "managed by Certbot" "$CONF"; then
      certbot --nginx -d "$CERT_DOM" --non-interactive --agree-tos --register-unsafely-without-email --redirect && ok "HTTPS activo en $CERT_DOM" || warn "certbot falló (¿DNS de $CERT_DOM ya apunta al server?)"
    fi
  else
    rm -f "$NGINX_ENABLED/crm-$SLUG.conf"; warn "nginx -t falló; vhost NO activado (revisa $CONF)"
  fi
else
  warn "nginx omitido"
fi

# ── 8. Inventario y resumen ──────────────────────────────────────────────
inventario_upsert "$SLUG" "$NOMBRE" "$PUERTO" "$DOMINIO" "$IMAGEN"
SEG=$(( $(date +%s) - INICIO ))
echo
printf '\033[1;32m══════ Empresa "%s" lista en %d s ══════\033[0m\n' "$NOMBRE" "$SEG"
echo "  slug:          $SLUG"
echo "  Puerto local:  127.0.0.1:$PUERTO (solo vía nginx; el firewall no expone puertos altos)"
echo "  URL nip.io:    http://$NIP/app/login/"
[[ -n "$DOMINIO" ]] && echo "  URL dominio:   http$([[ $HTTPS -eq 1 ]] && echo s)://$DOMINIO/app/login/"
[[ $HTTPS -eq 0 ]] && warn "Sin --https el inicio de sesión NO funciona en el navegador (cookies Secure con DJANGO_DEBUG=False); vuelve a correr con --https"
echo "  Administrador: $ADMIN_EMAIL"
[[ $ADMIN_PASSWORD_GENERADA -eq 1 ]] && echo "  Contraseña:    $ADMIN_PASSWORD   (guárdala: también está en $ENV_FILE)"
echo "  Contenedores:  crm-$SLUG-web, crm-$SLUG-mailsync   (imagen $IMAGEN)"
echo "  Base de datos: crm_$SLUG (usuario u_$SLUG) en crm-mysql"
echo "  Inventario:    $INVENTARIO"

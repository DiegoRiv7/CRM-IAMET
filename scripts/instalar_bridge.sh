#!/bin/bash
# MULTITENANT (Fase 6) — Instala/actualiza el CRM COMPARTIDO: una sola app que
# atiende a TODAS las empresas, cada una con su base. Idempotente.
#
#   scripts/instalar_bridge.sh [--imagen crm-producto:abc] [--puerto 8009] [--sin-nginx]
#
# Pasos: núcleo (red + MySQL compartido) → BD de control (crm_control + u_control)
# → .env.bridge → migrar control → contenedores crm-bridge-web/mailsync →
# vhost comodín (*.nip.io, *.crm.iamet.mx) → verificación.
#
# El alta de cada empresa es aparte y ya NO levanta contenedores: scripts/alta_empresa.sh
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
INICIO=$(date +%s)

IMAGEN=""; PUERTO=""; SIN_NGINX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --imagen) IMAGEN="$2"; shift 2;;
    --puerto) PUERTO="$2"; shift 2;;
    --sin-nginx) SIN_NGINX=1; shift;;
    *) die "opción desconocida: $1";;
  esac
done

mkdir -p "$EMPRESAS_DIR"; chmod 700 "$EMPRESAS_DIR"
[[ -d "$DEPLOY_DIR" ]] || die "No existe $DEPLOY_DIR (¿SRC_DIR apunta al código del producto?)"

# ── 0. Núcleo compartido ─────────────────────────────────────────────────
[[ -f "$CORE_ENV" ]] || die "Falta $CORE_ENV (córrelo después de nueva_empresa.sh, o créalo desde env.core.tmpl)"
cargar_core_env
PORTAL_URL="${PORTAL_URL:-}"
asegurar_core

IMAGEN="${IMAGEN:-$(imagen_actual)}"
[[ -n "$IMAGEN" ]] || die "No hay imagen: corre scripts/construir_imagen.sh primero (o pasa --imagen)"
docker image inspect "$IMAGEN" >/dev/null 2>&1 || die "La imagen $IMAGEN no existe en este servidor"
ok "Imagen: $IMAGEN"
PUERTO="${PUERTO:-$BRIDGE_PUERTO}"

# ── 1. Base de datos de CONTROL (solo el registro de empresas) ───────────
if [[ -f "$CONTROL_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$CONTROL_ENV"; set +a
  ok "control: credenciales existentes ($CONTROL_ENV)"
else
  CONTROL_DB_PASSWORD="$(aleatorio 24)"
  umask 077
  printf 'CONTROL_DB_NAME=crm_control\nCONTROL_DB_USER=u_control\nCONTROL_DB_PASSWORD=%s\nCONTROL_DB_HOST=crm-mysql\nCONTROL_DB_PORT=3306\n' \
    "$CONTROL_DB_PASSWORD" > "$CONTROL_ENV"
  ok "control: credenciales nuevas en $CONTROL_ENV"
fi
log "Base crm_control y usuario u_control (permisos solo sobre esa base)"
mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS \`crm_control\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'u_control'@'%' IDENTIFIED BY '$CONTROL_DB_PASSWORD';
ALTER USER 'u_control'@'%' IDENTIFIED BY '$CONTROL_DB_PASSWORD';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'u_control'@'%';
GRANT ALL PRIVILEGES ON \`crm_control\`.* TO 'u_control'@'%';
FLUSH PRIVILEGES;
SQL
ok "control listo"

# ── 2. .env del bridge ───────────────────────────────────────────────────
if [[ -f "$BRIDGE_ENV" ]]; then
  log "Ya existe $BRIDGE_ENV: se conservan llaves; se actualizan imagen y puerto"
  sed -i -e "s|^IMAGEN=.*|IMAGEN=$IMAGEN|" -e "s|^PUERTO=.*|PUERTO=$PUERTO|" "$BRIDGE_ENV"
  grep -q '^ENV_FILE=' "$BRIDGE_ENV" || printf 'ENV_FILE=%s\n' "$BRIDGE_ENV" >> "$BRIDGE_ENV"
else
  log "Generando $BRIDGE_ENV"
  sed -e "s|__FECHA__|$(date +%F)|" -e "s|__IMAGEN__|$IMAGEN|" -e "s|__PUERTO__|$PUERTO|" \
      -e "s|__SECRET_KEY__|$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-60)|" \
      -e "s|__IP_GUIONES__|$(tr . - <<<"$IP_PUBLICA")|" \
      -e "s|__CONTROL_PASSWORD__|$CONTROL_DB_PASSWORD|" \
      -e "s|__OPENROUTER_KEY__|${OPENROUTER_API_KEY_COMPARTIDA:-}|" \
      -e "s|__PORTAL_URL__|$PORTAL_URL|" "$DEPLOY_DIR/env.bridge.tmpl" > "$BRIDGE_ENV"
  printf 'ENV_FILE=%s\n' "$BRIDGE_ENV" >> "$BRIDGE_ENV"
  chmod 600 "$BRIDGE_ENV"
fi
ok ".env del bridge listo (puerto $PUERTO)"

# ── 3. Migrar la BD de control ───────────────────────────────────────────
log "Migrando la BD de control (tablas del registro de empresas)"
bridge_manage migrate --database control --noinput | sed 's/^/  /'

# ── 3b. Base plantilla (hace que las altas tarden segundos) ─────────────
asegurar_plantilla

# ── 4. Contenedores compartidos ──────────────────────────────────────────
log "Levantando crm-bridge-web y crm-bridge-mailsync"
compose_bridge up -d --remove-orphans >/dev/null
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/healthz/" || true)
  [[ "$code" == "200" ]] && { ok "la app compartida responde en :$PUERTO"; break; }
  sleep 3
  [[ $i -eq 60 ]] && { docker logs --tail 40 crm-bridge-web; die "crm-bridge-web no arrancó"; }
done

# ── 5. nginx: UN vhost comodín para todas las empresas ───────────────────
if [[ $SIN_NGINX -eq 0 && -d "$NGINX_AVAIL" ]] && command -v nginx >/dev/null; then
  NAMES="*.$(tr . - <<<"$IP_PUBLICA").nip.io *.crm.iamet.mx"
  CONF="$NGINX_AVAIL/crm-bridge.conf"
  sed -e "s|__FECHA__|$(date +%F)|" -e "s|__PUERTO__|$PUERTO|" -e "s|__SERVER_NAMES__|$NAMES|" \
      "$DEPLOY_DIR/nginx-bridge.conf.tmpl" > "$CONF"
  ln -sf "$CONF" "$NGINX_ENABLED/crm-bridge.conf"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx && ok "nginx: $NAMES → :$PUERTO"
  else
    rm -f "$NGINX_ENABLED/crm-bridge.conf"; warn "nginx -t falló; vhost NO activado (revisa $CONF)"
  fi
else
  warn "nginx omitido"
fi

SEG=$(( $(date +%s) - INICIO ))
echo
printf '\033[1;32m══════ CRM compartido listo en %d s ══════\033[0m\n' "$SEG"
echo "  Contenedores:  crm-bridge-web, crm-bridge-mailsync   (imagen $IMAGEN)"
echo "  Puerto local:  127.0.0.1:$PUERTO (solo vía nginx)"
echo "  Control:       crm_control (usuario u_control) · credenciales en $CONTROL_ENV"
echo "  Plantilla:     $PLANTILLA_DB (esquema listo: las altas la clonan)"
echo "  Alta empresa:  scripts/alta_empresa.sh <slug> --nombre \"...\"   (segundos, sin contenedores)"

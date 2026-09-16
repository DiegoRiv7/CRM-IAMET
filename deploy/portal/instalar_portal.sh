#!/bin/bash
# Instala/actualiza el portal maestro en el servidor (idempotente).
#   deploy/portal/instalar_portal.sh [--dominio portal.crm.iamet.mx] [--sin-https]
set -euo pipefail
SRC_DIR="${SRC_DIR:-/home/iamet2026/crm-producto}"
EMPRESAS_DIR="${EMPRESAS_DIR:-/home/iamet2026/crm-empresas}"
VENV="$EMPRESAS_DIR/portal-venv"; ENVF="$EMPRESAS_DIR/portal.env"
DOMINIO=""; HTTPS=1
while [[ $# -gt 0 ]]; do case "$1" in --dominio) DOMINIO="$2"; shift 2;; --sin-https) HTTPS=0; shift;; *) echo "opción desconocida $1"; exit 1;; esac; done
log(){ printf '\033[1;34m[portal]\033[0m %s\n' "$*"; }

mkdir -p "$EMPRESAS_DIR"; chmod 700 "$EMPRESAS_DIR"
IP="$(grep -E '^IP_PUBLICA=' "$EMPRESAS_DIR/.env.core" 2>/dev/null | cut -d= -f2- || true)"; IP="${IP:-82.223.44.29}"
HOST="${DOMINIO:-portal.$(tr . - <<<"$IP").nip.io}"

# 1) Dependencias
if [[ ! -x "$VENV/bin/gunicorn" ]]; then
  log "Creando entorno Python en $VENV"
  python3 -m venv "$VENV" 2>/dev/null || { apt-get install -y -q python3-venv >/dev/null && python3 -m venv "$VENV"; }
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q "flask>=3,<4" "gunicorn>=21" "pyyaml>=6"
fi

# 2) Configuración (una sola vez; conserva contraseñas)
if [[ ! -f "$ENVF" ]]; then
  log "Creando $ENVF"
  cat > "$ENVF" <<CFG
PORTAL_SECRET=$(openssl rand -hex 32)
PORTAL_ADMIN_USER=iamet
PORTAL_ADMIN_PASSWORD=$(openssl rand -hex 8)
PORTAL_APROBACION_AUTOMATICA=0
PORTAL_MAX_EMPRESAS=5
PORTAL_DOMINIO_BASE=
PORTAL_IP=$IP
PORTAL_SRC_DIR=$SRC_DIR
PORTAL_EMPRESAS_DIR=$EMPRESAS_DIR
PORTAL_NOMBRE_PRODUCTO=IAMET CRM
PORTAL_CONTACTO=ventas@iamet.mx
PORTAL_HTTPS=$HTTPS
CFG
  chmod 600 "$ENVF"
fi

# 3) Servicio systemd
cp "$SRC_DIR/deploy/portal/crm-portal.service" /etc/systemd/system/crm-portal.service
systemctl daemon-reload
systemctl enable -q crm-portal
systemctl restart crm-portal
sleep 3
systemctl is-active -q crm-portal && log "servicio crm-portal activo" || { journalctl -u crm-portal -n 20 --no-pager; exit 1; }

# 4) nginx + HTTPS
CONF=/etc/nginx/sites-available/crm-portal.conf
if [[ -f "$CONF" ]] && grep -q "managed by Certbot" "$CONF"; then
  log "vhost existente con HTTPS: se conserva"
else
  sed -e "s|__SERVER_NAME__|$HOST|" -e "s|__FECHA__|$(date +%F)|" "$SRC_DIR/deploy/portal/nginx-portal.conf.tmpl" > "$CONF"
fi
ln -sf "$CONF" /etc/nginx/sites-enabled/crm-portal.conf
nginx -t >/dev/null && systemctl reload nginx && log "nginx: $HOST → 127.0.0.1:8090"
if [[ $HTTPS -eq 1 ]] && ! grep -q "managed by Certbot" "$CONF"; then
  certbot --nginx -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect && log "HTTPS activo" || log "certbot falló (¿DNS de $HOST apunta al server?)"
fi

echo
log "Portal: http$([[ $HTTPS -eq 1 ]] && echo s)://$HOST/"
log "Panel:  http$([[ $HTTPS -eq 1 ]] && echo s)://$HOST/panel  (usuario $(grep ^PORTAL_ADMIN_USER= "$ENVF" | cut -d= -f2-), contraseña en $ENVF)"

#!/bin/bash
# MULTITENANT (Fase 6) — Alta de una empresa en el CRM COMPARTIDO. Segundos, sin
# contenedores nuevos. Idempotente.
#
#   scripts/alta_empresa.sh <slug> --nombre "Acme S.A." [opciones]
#
#   --nombre "..."       Nombre de la empresa (obligatorio la primera vez)
#   --dominio acme.crm.iamet.mx   Dominio propio (requiere DNS apuntando al server)
#   --https              Certificado Let's Encrypt para ese nombre. RECOMENDADO:
#                        sin HTTPS el login no funciona (cookies Secure)
#   --admin-email x      Superusuario inicial (default: admin@<slug>.local)
#   --admin-password y   Contraseña (default: aleatoria, se imprime)
#   --correo ventas@...  Correo de ventas/contacto
#   --sitio https://...  Sitio web
#   --catalogo-iamet     Catálogo de marcas de IAMET en vez del genérico
#   --sin-nginx          No tocar nginx (el comodín del bridge ya cubre *.nip.io)
#
# Pasos: base + usuario con GRANT propio → registrar en control (secretos por
# entorno) → migrar SU base → seed_empresa → [vhost del dominio propio] → listo.
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
INICIO=$(date +%s)

SLUG="${1:-}"; [[ -n "$SLUG" ]] || { sed -n '2,20p' "$0"; exit 1; }
shift
validar_slug "$SLUG"
NOMBRE=""; DOMINIO=""; HTTPS=0; ADMIN_EMAIL=""; ADMIN_PASSWORD=""; CORREO=""; SITIO=""; CAT_IAMET=0; SIN_NGINX=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --nombre) NOMBRE="$2"; shift 2;;
    --dominio) DOMINIO="$2"; shift 2;;
    --https) HTTPS=1; shift;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2;;
    --correo) CORREO="$2"; shift 2;;
    --sitio) SITIO="$2"; shift 2;;
    --catalogo-iamet) CAT_IAMET=1; shift;;
    --sin-nginx) SIN_NGINX=1; shift;;
    *) die "opción desconocida: $1";;
  esac
done

[[ -f "$BRIDGE_ENV" ]] || die "Falta $BRIDGE_ENV: corre primero scripts/instalar_bridge.sh"
cargar_core_env
PUERTO="$(grep -E '^PUERTO=' "$BRIDGE_ENV" | cut -d= -f2-)"
NIP="$SLUG.$(tr . - <<<"$IP_PUBLICA").nip.io"

# ¿Ya estaba registrada? (define si --nombre es obligatorio)
if bridge_manage tenant_alta "$SLUG" --existe >/dev/null 2>&1; then
  YA=1; log "La empresa $SLUG ya está registrada: se actualiza y se re-migra"
else
  YA=0; [[ -n "$NOMBRE" ]] || die "Falta --nombre \"Nombre de la empresa\""
fi

# ── 1. Secretos (se conservan entre corridas) ────────────────────────────
cargar_o_crear_secretos "$SLUG"

# ── 2. Base y usuario propios ────────────────────────────────────────────
log "Base crm_$SLUG y usuario u_$SLUG (permisos solo sobre esa base)"
crear_bd_empresa "$SLUG" "$TENANT_DB_PASSWORD"
ok "base y usuario listos"

# ── 3. Registro en la BD de control ──────────────────────────────────────
log "Registrando la empresa en control (hostname → su base)"
ARGS_ALTA=("$SLUG" --host "$NIP")
[[ -n "$NOMBRE" ]] && ARGS_ALTA+=(--nombre "$NOMBRE")
[[ -n "$DOMINIO" ]] && ARGS_ALTA+=(--host "$DOMINIO")
if docker ps --format '{{.Names}}' | grep -qx crm-bridge-web; then
  docker exec -e TENANT_DB_PASSWORD="$TENANT_DB_PASSWORD" -e TENANT_SSO_SECRET="$TENANT_SSO_SECRET" \
    -e TENANT_MAIL_KEY="$TENANT_MAIL_KEY" crm-bridge-web python manage.py tenant_alta "${ARGS_ALTA[@]}" | sed 's/^/  /'
else
  docker run --rm --network crm_tenants --env-file "$BRIDGE_ENV" \
    -e TENANT_DB_PASSWORD="$TENANT_DB_PASSWORD" -e TENANT_SSO_SECRET="$TENANT_SSO_SECRET" \
    -e TENANT_MAIL_KEY="$TENANT_MAIL_KEY" --entrypoint python \
    "$(grep -E '^IMAGEN=' "$BRIDGE_ENV" | cut -d= -f2-)" manage.py tenant_alta "${ARGS_ALTA[@]}" | sed 's/^/  /'
fi

# ── 4. Migrar SU base ────────────────────────────────────────────────────
log "Migrando la base de $SLUG"
bridge_manage tenant_run "$SLUG" migrate --noinput 2>&1 | tail -3 | sed 's/^/  /'

# ── 5. Semilla ───────────────────────────────────────────────────────────
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@$SLUG.local}"
ADMIN_PASSWORD_GENERADA=0
if [[ -z "$ADMIN_PASSWORD" ]]; then ADMIN_PASSWORD="$(aleatorio 8)"; ADMIN_PASSWORD_GENERADA=1; fi
log "Semilla de la empresa (config, catálogos, etapas, asistente, superusuario)"
ARGS_SEED=(--nombre "${NOMBRE:-$SLUG}" --slug "$SLUG" --admin-email "$ADMIN_EMAIL" --admin-password "$ADMIN_PASSWORD")
[[ -n "$CORREO" ]] && ARGS_SEED+=(--correo "$CORREO" --dominio "${CORREO#*@}")
[[ -n "$SITIO" ]] && ARGS_SEED+=(--sitio "$SITIO")
[[ $CAT_IAMET -eq 1 ]] && ARGS_SEED+=(--catalogo-iamet)
bridge_manage tenant_run "$SLUG" seed_empresa "${ARGS_SEED[@]}" 2>&1 | tail -6 | sed 's/^/  /'

# ── 6. nginx: solo si hay dominio propio (el comodín ya cubre nip.io) ────
if [[ -n "$DOMINIO" && $SIN_NGINX -eq 0 && -d "$NGINX_AVAIL" ]] && command -v nginx >/dev/null; then
  CONF="$NGINX_AVAIL/crm-host-$SLUG.conf"
  if [[ -f "$CONF" ]] && grep -q "managed by Certbot" "$CONF"; then
    ok "nginx: vhost existente con HTTPS — se conserva"
  else
    sed -e "s|__SLUG__|$SLUG|g" -e "s|__FECHA__|$(date +%F)|" -e "s|__PUERTO__|$PUERTO|" -e "s|__SERVER_NAMES__|$DOMINIO|" \
        "$DEPLOY_DIR/nginx-bridge-host.conf.tmpl" > "$CONF"
  fi
  ln -sf "$CONF" "$NGINX_ENABLED/crm-host-$SLUG.conf"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx && ok "nginx: $DOMINIO → :$PUERTO"
    if [[ $HTTPS -eq 1 ]] && ! grep -q "managed by Certbot" "$CONF"; then
      certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
        && ok "HTTPS activo en $DOMINIO" || warn "certbot falló (¿el DNS de $DOMINIO ya apunta al server?)"
    fi
  else
    rm -f "$NGINX_ENABLED/crm-host-$SLUG.conf"; warn "nginx -t falló; vhost NO activado (revisa $CONF)"
  fi
elif [[ $HTTPS -eq 1 && -z "$DOMINIO" ]]; then
  CONF="$NGINX_AVAIL/crm-host-$SLUG.conf"
  sed -e "s|__SLUG__|$SLUG|g" -e "s|__FECHA__|$(date +%F)|" -e "s|__PUERTO__|$PUERTO|" -e "s|__SERVER_NAMES__|$NIP|" \
      "$DEPLOY_DIR/nginx-bridge-host.conf.tmpl" > "$CONF"
  ln -sf "$CONF" "$NGINX_ENABLED/crm-host-$SLUG.conf"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx \
    && certbot --nginx -d "$NIP" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    && ok "HTTPS activo en $NIP" || warn "no pude activar HTTPS en $NIP"
fi

# ── 7. Verificación por hostname ─────────────────────────────────────────
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $NIP" "http://127.0.0.1:$PUERTO/app/login/" || true)
[[ "$CODE" == "200" || "$CODE" == "302" ]] && ok "la app responde $CODE para $NIP" || warn "la app devolvió $CODE para $NIP"

SEG=$(( $(date +%s) - INICIO ))
echo
printf '\033[1;32m══════ Empresa "%s" lista en %d s ══════\033[0m\n' "${NOMBRE:-$SLUG}" "$SEG"
echo "  slug:          $SLUG"
echo "  URL nip.io:    http://$NIP/app/login/"
[[ -n "$DOMINIO" ]] && echo "  URL dominio:   http$([[ $HTTPS -eq 1 ]] && echo s)://$DOMINIO/app/login/"
[[ $HTTPS -eq 0 ]] && warn "Sin --https el inicio de sesión NO funciona en el navegador (cookies Secure)"
echo "  Administrador: $ADMIN_EMAIL"
[[ $ADMIN_PASSWORD_GENERADA -eq 1 ]] && echo "  Contraseña:    $ADMIN_PASSWORD   (guárdala)"
echo "  Base de datos: crm_$SLUG (usuario u_$SLUG) en crm-mysql"
echo "  Secretos:      $EMPRESAS_DIR/.secretos.$SLUG"
echo "  SIN contenedores nuevos: la atiende crm-bridge-web"

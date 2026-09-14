#!/bin/bash
# MULTIEMPRESA — Baja de una empresa. SIEMPRE respalda antes.
#
#   scripts/baja_empresa.sh <slug>            detiene los contenedores (datos y .env se conservan)
#   scripts/baja_empresa.sh <slug> --purge    además borra base, usuario, volúmenes, .env y vhost
#   ... --si                                  no pedir confirmación
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"

SLUG="${1:-}"; [[ -n "$SLUG" ]] || { sed -n '2,8p' "$0"; exit 1; }
shift
validar_slug "$SLUG"
PURGE=0; SI=0
for a in "$@"; do case "$a" in --purge) PURGE=1;; --si) SI=1;; *) die "opción desconocida: $a";; esac; done
cargar_core_env

if [[ $SI -eq 0 ]]; then
  read -r -p "¿Dar de baja la empresa '$SLUG'$([[ $PURGE -eq 1 ]] && echo ' y BORRAR sus datos')? (escribe el slug para confirmar) " conf
  [[ "$conf" == "$SLUG" ]] || die "cancelado"
fi

# ── Respaldo ─────────────────────────────────────────────────────────────
DEST="$BACKUPS_DIR/$SLUG"; mkdir -p "$DEST"; FECHA="$(date +%Y%m%d-%H%M%S)"
if mysql_root -e "USE \`crm_$SLUG\`" 2>/dev/null; then
  log "Respaldo de la base crm_$SLUG"
  docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" crm-mysql mysqldump -uroot --single-transaction --routines --triggers "crm_$SLUG" | gzip > "$DEST/db-$FECHA.sql.gz"
  ok "$DEST/db-$FECHA.sql.gz ($(du -h "$DEST/db-$FECHA.sql.gz" | cut -f1))"
else
  warn "la base crm_$SLUG no existe; sin respaldo de BD"
fi
if docker volume inspect "crm-${SLUG}_media" >/dev/null 2>&1; then
  log "Respaldo de archivos (media)"
  docker run --rm -v "crm-${SLUG}_media:/m:ro" -v "$DEST:/b" alpine tar czf "/b/media-$FECHA.tgz" -C /m . && ok "$DEST/media-$FECHA.tgz"
fi
[[ -f "$EMPRESAS_DIR/.env.$SLUG" ]] && cp "$EMPRESAS_DIR/.env.$SLUG" "$DEST/env-$FECHA.bak" && chmod 600 "$DEST/env-$FECHA.bak"

# ── Contenedores ─────────────────────────────────────────────────────────
if [[ -f "$EMPRESAS_DIR/.env.$SLUG" ]]; then
  log "Deteniendo contenedores de $SLUG"
  if [[ $PURGE -eq 1 ]]; then compose_tenant "$SLUG" down -v --remove-orphans >/dev/null; else compose_tenant "$SLUG" down --remove-orphans >/dev/null; fi
  ok "contenedores abajo"
fi

# ── nginx ────────────────────────────────────────────────────────────────
if [[ -e "$NGINX_ENABLED/crm-$SLUG.conf" ]]; then
  rm -f "$NGINX_ENABLED/crm-$SLUG.conf"
  [[ $PURGE -eq 1 ]] && rm -f "$NGINX_AVAIL/crm-$SLUG.conf"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "vhost nginx retirado"
fi

# ── Purga ────────────────────────────────────────────────────────────────
if [[ $PURGE -eq 1 ]]; then
  log "Borrando base, usuario y .env"
  mysql_root <<SQL
DROP DATABASE IF EXISTS \`crm_$SLUG\`;
DROP USER IF EXISTS 'u_$SLUG'@'%';
FLUSH PRIVILEGES;
SQL
  rm -f "$EMPRESAS_DIR/.env.$SLUG"
  inventario_quitar "$SLUG"
  ok "empresa $SLUG eliminada (respaldos en $DEST)"
else
  python3 - "$INVENTARIO" "$SLUG" <<'PY' 2>/dev/null || true
import sys, yaml
ruta, slug = sys.argv[1:3]
data = yaml.safe_load(open(ruta)) or []
for e in data:
    if e.get('slug') == slug: e['activa'] = False
yaml.safe_dump(data, open(ruta, 'w'), allow_unicode=True, sort_keys=False)
PY
  ok "empresa $SLUG detenida (datos conservados; reactivar = nueva_empresa.sh $SLUG)"
fi

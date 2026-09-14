#!/bin/bash
# MULTIEMPRESA — Respaldo de todas las empresas (Fase 4). Pensado para cron diario.
#
#   scripts/backup_empresas.sh            BD de cada empresa (+ media los domingos) + núcleo
#   scripts/backup_empresas.sh --media    forzar también el respaldo de media hoy
#
# Deja en $BACKUPS_DIR/<slug>/: db-<fecha>.sql.gz, media-<fecha>.tgz, env-<fecha>.bak; y en
# $BACKUPS_DIR/core/: env.core, empresas.yml. Retención: BD 14 días, media 60 días, env 30.
set -uo pipefail
source "$(dirname "$0")/empresas_lib.sh"
cargar_core_env
FORZAR_MEDIA=0; [[ "${1:-}" == "--media" ]] && FORZAR_MEDIA=1
FECHA="$(date +%Y%m%d-%H%M%S)"; DOMINGO=$([[ "$(date +%u)" == "7" ]] && echo 1 || echo 0)
mkdir -p "$BACKUPS_DIR/core"; chmod 700 "$BACKUPS_DIR"
errores=0; n=0

# Núcleo: config y inventario (sin ellos no se recupera nada)
cp "$CORE_ENV" "$BACKUPS_DIR/core/env.core-$FECHA.bak" && chmod 600 "$BACKUPS_DIR/core/env.core-$FECHA.bak"
[[ -f "$INVENTARIO" ]] && cp "$INVENTARIO" "$BACKUPS_DIR/core/empresas-$FECHA.yml"

# Todas las bases crm_* del MySQL compartido (aunque no estén en el inventario)
for DB in $(mysql_root -e "SHOW DATABASES LIKE 'crm\\_%'" 2>/dev/null); do
  SLUG="${DB#crm_}"; DEST="$BACKUPS_DIR/$SLUG"; mkdir -p "$DEST"
  if docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" crm-mysql mysqldump -uroot --single-transaction --routines --triggers "$DB" 2>/dev/null | gzip > "$DEST/db-$FECHA.sql.gz" && [[ -s "$DEST/db-$FECHA.sql.gz" ]]; then
    ok "$SLUG: BD $(du -h "$DEST/db-$FECHA.sql.gz" | cut -f1)"; n=$((n+1))
  else
    warn "$SLUG: falló el dump de $DB"; rm -f "$DEST/db-$FECHA.sql.gz"; errores=$((errores+1))
  fi
  [[ -f "$EMPRESAS_DIR/.env.$SLUG" ]] && cp "$EMPRESAS_DIR/.env.$SLUG" "$DEST/env-$FECHA.bak" && chmod 600 "$DEST/env-$FECHA.bak"
  if [[ $DOMINGO -eq 1 || $FORZAR_MEDIA -eq 1 ]] && docker volume inspect "crm-${SLUG}_media" >/dev/null 2>&1; then
    if docker run --rm -v "crm-${SLUG}_media:/m:ro" -v "$DEST:/b" alpine tar czf "/b/media-$FECHA.tgz" -C /m . 2>/dev/null; then
      ok "$SLUG: media $(du -h "$DEST/media-$FECHA.tgz" | cut -f1)"
    else
      warn "$SLUG: falló el respaldo de media"; errores=$((errores+1))
    fi
  fi
done

# Retención
find "$BACKUPS_DIR" -name 'db-*.sql.gz' -mtime +14 -delete 2>/dev/null
find "$BACKUPS_DIR" -name 'media-*.tgz' -mtime +60 -delete 2>/dev/null
find "$BACKUPS_DIR" -name 'env-*.bak' -mtime +30 -delete 2>/dev/null
find "$BACKUPS_DIR/core" -type f -mtime +30 -delete 2>/dev/null

log "backup_empresas: $n bases respaldadas, $errores errores, $(du -sh "$BACKUPS_DIR" | cut -f1) en $BACKUPS_DIR"
exit $(( errores > 0 ? 1 : 0 ))

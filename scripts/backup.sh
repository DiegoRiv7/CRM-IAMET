#!/bin/bash
# ============================================================
# Backup CRM IAMET
# - BD MySQL: diario (se ejecuta desde cron a las 2am Tijuana)
# - Archivos media: semanal los domingos
# Guarda los últimos 7 días de BD y 4 semanas de media.
# ============================================================

BACKUP_DIR="/home/iamet2026/backups"
MEDIA_DIR="/home/iamet2026/crm-iamet/media"
DB_CONTAINER="gesti-n-de-ventas-db-1"
DB_NAME="crm_iamet_db"
LOG="$BACKUP_DIR/backup.log"
FECHA=$(date '+%Y-%m-%d_%H-%M')

mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

# ── 1. BACKUP DE BASE DE DATOS (siempre) ────────────────────
log "Iniciando backup de BD: $DB_NAME"

SQL_FILE="$BACKUP_DIR/db_${FECHA}.sql.gz"
sudo docker exec "$DB_CONTAINER" mysqldump \
    -u root -p"${MYSQL_ROOT_PASSWORD}" \
    --single-transaction \
    "$DB_NAME" | gzip > "$SQL_FILE"

if [ $? -eq 0 ]; then
    SIZE=$(du -sh "$SQL_FILE" | cut -f1)
    log "BD backup OK: db_${FECHA}.sql.gz ($SIZE)"
else
    log "ERROR: Fallo el backup de BD"
fi

# Eliminar backups de BD con más de 7 días
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +7 -delete
log "Backups de BD antiguos eliminados (>7 días)"

# ── 2. BACKUP DE ARCHIVOS MEDIA (solo domingos) ─────────────
if [ "$(date '+%u')" = "7" ]; then
    log "Domingo detectado — iniciando backup de archivos media"

    MEDIA_FILE="$BACKUP_DIR/media_${FECHA}.tar.gz"
    tar -czf "$MEDIA_FILE" -C "$(dirname $MEDIA_DIR)" "$(basename $MEDIA_DIR)" 2>/dev/null

    if [ $? -eq 0 ]; then
        SIZE=$(du -sh "$MEDIA_FILE" | cut -f1)
        log "Media backup OK: media_${FECHA}.tar.gz ($SIZE)"
    else
        log "ERROR: Fallo el backup de media"
    fi

    # Eliminar backups de media con más de 28 días (4 semanas)
    find "$BACKUP_DIR" -name "media_*.tar.gz" -mtime +28 -delete
    log "Backups de media antiguos eliminados (>28 días)"
else
    log "No es domingo — backup de media omitido"
fi

log "Backup finalizado."
log "────────────────────────────────────────────"

#!/bin/bash
# Script para sincronización automática diaria con Bitrix
# Se ejecuta todos los días a las 2:00 AM

LOG_FILE="/var/log/bitrix_sync.log"
PROJECT_DIR="/opt/Gesti-n-de-ventas"

echo "=== Iniciando sincronización Bitrix $(date) ===" >> $LOG_FILE

cd $PROJECT_DIR

# Ejecutar sincronización completa
docker compose exec web python manage.py sync_all_bitrix --force >> $LOG_FILE 2>&1

echo "=== Sincronización completada $(date) ===" >> $LOG_FILE
echo "" >> $LOG_FILE
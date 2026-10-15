#!/bin/bash
set -e

# Función para logging con timestamp
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

log "🐳 Iniciando contenedor Django..."

# Esperar a que la base de datos esté disponible (si es necesario)
if [ "$DB_HOST" ]; then
    log "⏳ Esperando a que la base de datos en $DB_HOST:${DB_PORT:-3306} esté disponible..."
    while ! nc -z $DB_HOST ${DB_PORT:-3306}; do
        log "Base de datos no disponible, esperando 1 segundo..."
        sleep 1
    done
    log "✅ Base de datos disponible."
fi

# MULTITENANT (bridge): con TENANT_MODE=1 NO hay una "base de la instancia".
# `default` apunta a la BD de control y las tablas de la app viven en la base de
# cada empresa, así que migrar y crear superusuarios aquí sería un error (o
# escribiría en la base equivocada). Eso lo hacen, por empresa:
#   manage.py tenant_run <slug> migrate      (scripts/alta_empresa.sh, deploy_all_bridge.sh)
#   manage.py migrate --database control     (scripts/instalar_bridge.sh)
if [ "$TENANT_MODE" = "1" ]; then
    log "🏢 Modo multitenant: migraciones y superusuario se manejan por empresa (omitidos aquí)"
else
    # Ejecutar migraciones
    log "🔄 Ejecutando migraciones de base de datos..."
    python manage.py migrate --noinput
fi

# Recolectar archivos estáticos (IMPORTANTE para el favicon)
log "📁 Recolectando archivos estáticos..."
python manage.py collectstatic --noinput --clear --verbosity=1

# Verificar que los archivos del favicon existan
log "🎯 Verificando archivos de favicon..."
if [ -f "staticfiles/images/favicon.svg" ]; then
    log "✅ favicon.svg encontrado"
else
    log "⚠️  favicon.svg no encontrado en staticfiles"
fi

if [ -f "staticfiles/images/favicon.ico" ]; then
    log "✅ favicon.ico encontrado"  
else
    log "⚠️  favicon.ico no encontrado en staticfiles"
fi

# Crear superusuario si no existe (opcional) — nunca en modo multitenant
if [ "$TENANT_MODE" != "1" ] && [ "$DJANGO_SUPERUSER_EMAIL" ]; then
    log "👤 Creando superusuario..."
    python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
if not User.objects.filter(email='$DJANGO_SUPERUSER_EMAIL').exists():
    User.objects.create_superuser('$DJANGO_SUPERUSER_EMAIL', '$DJANGO_SUPERUSER_EMAIL', '$DJANGO_SUPERUSER_PASSWORD')
    print('Superusuario creado')
else:
    print('Superusuario ya existe')
" || log "⚠️  Error creando superusuario (opcional)"
fi

log "🚀 Iniciando servidor Django..."

# Ejecutar el comando pasado al contenedor
exec "$@"
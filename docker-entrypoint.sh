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

# Ejecutar migraciones
log "🔄 Ejecutando migraciones de base de datos..."
python manage.py migrate --noinput

# Recolectar archivos estáticos (IMPORTANTE para el favicon)
log "📁 Recolectando archivos estáticos..."
python manage.py collectstatic --noinput --verbosity=1

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

# Crear superusuario si no existe (opcional)
if [ "$DJANGO_SUPERUSER_EMAIL" ]; then
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
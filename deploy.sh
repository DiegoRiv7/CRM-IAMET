#!/bin/bash
set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para logging con colores
log() {
    echo -e "${GREEN}[DEPLOY]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log "🚀 Iniciando despliegue de Gestión de Ventas..."

# Verificar que Docker está instalado
if ! command -v docker &> /dev/null; then
    error "Docker no está instalado. Por favor instala Docker primero."
    exit 1
fi

# Verificar que docker-compose está instalado
if ! command -v docker-compose &> /dev/null; then
    error "docker-compose no está instalado. Por favor instala docker-compose primero."
    exit 1
fi

# Parar contenedores existentes si existen
if [ "$(docker ps -q -f name=gestion-ventas)" ]; then
    log "🛑 Parando contenedores existentes..."
    docker-compose -f docker-compose.production.yml down
fi

# Construir la imagen
log "🔨 Construyendo imagen Docker..."
docker build -t gestion-ventas:latest . --no-cache

# Verificar variables de entorno
if [ ! -f .env ]; then
    warn "No se encontró archivo .env. Creando uno de ejemplo..."
    cat > .env << EOF
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_SECRET_KEY=$(openssl rand -base64 32)
DJANGO_SUPERUSER_EMAIL=admin@localhost.com
DJANGO_SUPERUSER_PASSWORD=admin123
EOF
    warn "⚠️  Archivo .env creado. ACTUALIZA las variables antes del despliegue en producción!"
fi

# Levantar los servicios
log "🚢 Levantando servicios con docker-compose..."
docker-compose -f docker-compose.production.yml up -d

# Esperar a que el servicio esté listo
log "⏳ Esperando a que la aplicación esté lista..."
sleep 10

# Verificar que la aplicación esté corriendo
if curl -f -s http://localhost:8000 > /dev/null; then
    log "✅ Aplicación desplegada correctamente!"
    info "🌐 Accede a la aplicación en: http://localhost:8000"
    info "👤 Usuario admin: admin@localhost.com / admin123"
else
    error "❌ La aplicación no responde. Verificando logs..."
    docker-compose -f docker-compose.production.yml logs web
    exit 1
fi

# Verificar favicon
log "🎯 Verificando favicon..."
if docker exec $(docker ps -q -f name=gestion-ventas) ls staticfiles/images/favicon.svg > /dev/null 2>&1; then
    log "✅ Favicon encontrado correctamente"
else
    warn "⚠️  Favicon no encontrado, ejecutando collectstatic..."
    docker exec $(docker ps -q -f name=gestion-ventas) python manage.py collectstatic --noinput
fi

# Mostrar información útil
log "📋 Información del despliegue:"
info "  • URL: http://localhost:8000"
info "  • Admin: http://localhost:8000/admin/"
info "  • Logs: docker-compose -f docker-compose.production.yml logs -f"
info "  • Parar: docker-compose -f docker-compose.production.yml down"

# Mostrar logs en tiempo real
read -p "¿Quieres ver los logs en tiempo real? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log "📄 Mostrando logs (Ctrl+C para salir)..."
    docker-compose -f docker-compose.production.yml logs -f
fi

log "🎉 Despliegue completado!"
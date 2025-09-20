#!/bin/bash

# Script para deployment con Docker
# Hace el deployment y configuración correcta de archivos media

echo "🚀 Iniciando deployment de Django con Docker..."

# Detener servicios existentes
echo "🛑 Deteniendo contenedores existentes..."
docker-compose down

# Construir nuevas imágenes
echo "🏗️ Construyendo nuevas imágenes..."
docker-compose build --no-cache

# Crear volúmenes si no existen
echo "💾 Creando volúmenes..."
docker volume create gesti-n-de-ventas_media_files
docker volume create gesti-n-de-ventas_db_data

# Iniciar servicios
echo "🚀 Iniciando servicios..."
docker-compose up -d

# Esperar a que la base de datos esté lista
echo "⏳ Esperando a que la base de datos esté lista..."
sleep 10

# Ejecutar migraciones
echo "🔄 Ejecutando migraciones..."
docker-compose exec web python manage.py migrate

# Recopilar archivos estáticos
echo "📦 Recopilando archivos estáticos..."
docker-compose exec web python manage.py collectstatic --noinput

# Crear directorio media con permisos correctos
echo "📁 Configurando directorio media..."
docker-compose exec web mkdir -p /app/media
docker-compose exec web chown -R 1000:1000 /app/media

# Mostrar estado
echo "📊 Estado de los contenedores:"
docker-compose ps

echo "✅ Deployment completado!"
echo "🌐 Tu aplicación debería estar disponible en http://localhost"
echo "📋 Para ver logs: docker-compose logs -f"
echo "🐛 Para debugging: docker-compose exec web bash"
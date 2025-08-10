# Instrucciones de Despliegue - Favicon y Docker

## Problema del Favicon en Servidor con Docker

El favicon no aparece en el servidor porque Django en producción requiere que se recolecten los archivos estáticos.

### Solución para Docker

#### Opción 1: Ejecutar collectstatic en el contenedor en ejecución
```bash
docker exec -it tu_contenedor python manage.py collectstatic --noinput
```

#### Opción 2: Agregar al Dockerfile (Recomendado)
Agrega esto a tu Dockerfile antes del CMD:

```dockerfile
# Recolectar archivos estáticos
RUN python manage.py collectstatic --noinput
```

#### Opción 3: Agregar al docker-compose.yml o script de entrada
En tu `entrypoint.sh` o script de inicio:

```bash
#!/bin/bash
# Ejecutar migraciones y collectstatic
python manage.py migrate
python manage.py collectstatic --noinput

# Iniciar servidor
exec "$@"
```

### Solución para servidor sin Docker

Ejecuta este comando en tu servidor:

```bash
python manage.py collectstatic --noinput
```

### Verificar Configuración en settings.py

Asegúrate que tengas estas configuraciones:

```python
# settings.py
import os

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'app', 'static'),
]
```

## Despliegue con Docker (Recomendado)

### Opción 1: Solo aplicación Django
```bash
# Construir la imagen
docker build -t gestion-ventas .

# Ejecutar el contenedor
docker run -d \
  --name gestion-ventas-app \
  -p 8000:8000 \
  -e DJANGO_DEBUG=False \
  -e DJANGO_ALLOWED_HOSTS=tu-dominio.com,localhost \
  -e DJANGO_SECRET_KEY=tu-clave-super-secreta \
  gestion-ventas
```

### Opción 2: Con docker-compose (Recomendado)
```bash
# Usando el archivo de producción
docker-compose -f docker-compose.production.yml up -d

# Ver logs
docker-compose -f docker-compose.production.yml logs -f

# Parar los servicios
docker-compose -f docker-compose.production.yml down
```

### Verificar que todo funciona
```bash
# Ver logs del contenedor
docker logs gestion-ventas-app -f

# Ejecutar comandos dentro del contenedor
docker exec -it gestion-ventas-app python manage.py shell

# Verificar archivos estáticos
docker exec -it gestion-ventas-app ls -la staticfiles/images/
```

### Troubleshooting Docker

Si el favicon no aparece:
```bash
# Verificar que collectstatic se ejecutó
docker exec -it gestion-ventas-app ls -la staticfiles/images/

# Re-ejecutar collectstatic manualmente
docker exec -it gestion-ventas-app python manage.py collectstatic --noinput -v2

# Reiniciar el contenedor
docker restart gestion-ventas-app
```

### Para Nginx (si usas Nginx)

Agrega esta configuración para servir archivos estáticos:

```nginx
location /static/ {
    alias /ruta/a/tu/proyecto/staticfiles/;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# Favicon especial
location = /favicon.ico {
    alias /ruta/a/tu/proyecto/staticfiles/images/favicon.ico;
    expires 1y;
}
```

### Verificar que funcione

1. Ejecuta `collectstatic`
2. Verifica que los archivos estén en `/staticfiles/images/`
3. Recarga la página
4. El favicon debería aparecer
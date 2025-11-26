# 🚀 Instrucciones finales para aplicar migración

## 📋 Comandos exactos para ejecutar en el servidor:

### 1. **Git pull para obtener la migración limpia**
```bash
git pull origin main
```

### 2. **Eliminar migraciones conflictivas (si aún existen)**
```bash
docker-compose exec web rm -f app/migrations/0046_intercambio_navidad.py
docker-compose exec web rm -f app/migrations/0046_solicitud_acceso_proyecto.py
docker-compose exec web rm -f app/migrations/0050_solicitudaccesoproyecto_and_more.py
```

### 3. **Aplicar la migración 0047 (la nueva y limpia)**
```bash
docker-compose exec web python manage.py migrate app 0047_solicitud_acceso_proyecto
```

### 4. **Verificar que se aplicó correctamente**
```bash
docker-compose exec web python manage.py showmigrations app
```

## ✅ **Verificación rápida:**

```bash
# Verificar que la tabla se creó
docker-compose exec web python manage.py dbshell
```
```sql
SHOW TABLES LIKE '%solicitud%';
EXIT;
```

## 🎉 **¡Listo!** 

Una vez aplicada la migración 0047, el sistema completo de privacidad estará funcionando:

- ✅ Proyectos privados con blur + candado
- ✅ Botón "Solicitar unirse" 
- ✅ Notificaciones en el dock
- ✅ Aceptar/rechazar solicitudes

## 🔧 **Si hay algún problema:**

Si la migración 0047 da conflicto, usar el método directo:
```bash
# Crear tabla manualmente
docker-compose exec web python manage.py dbshell
```
```sql
CREATE TABLE app_solicitudaccesoproyecto (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    fecha_solicitud DATETIME(6) NOT NULL,
    fecha_respuesta DATETIME(6) NULL,
    mensaje LONGTEXT NOT NULL,
    proyecto_id BIGINT NOT NULL,
    usuario_respuesta_id BIGINT NULL,
    usuario_solicitante_id BIGINT NOT NULL,
    FOREIGN KEY (proyecto_id) REFERENCES app_proyecto (id),
    FOREIGN KEY (usuario_respuesta_id) REFERENCES auth_user (id),
    FOREIGN KEY (usuario_solicitante_id) REFERENCES auth_user (id),
    UNIQUE KEY app_solicitud_unique_proyecto_usuario (proyecto_id, usuario_solicitante_id)
);

INSERT INTO django_migrations (app, name, applied) VALUES ('app', '0047_solicitud_acceso_proyecto', NOW());
EXIT;
```

¡Solo ejecuta los comandos del paso 1-3 y estará listo! 🚀
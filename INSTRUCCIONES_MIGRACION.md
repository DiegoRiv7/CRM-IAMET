# 🚀 Instrucciones para aplicar el sistema de privacidad de proyectos

## ⚠️ IMPORTANTE: Si hay archivos de migración problemáticos, elimínalos primero

```bash
# Solo si existe, elimina la migración conflictiva
docker-compose exec web rm -f app/migrations/0050_solicitudaccesoproyecto_and_more.py
```

## 📋 Comandos para aplicar en el servidor:

### 1. Hacer git pull
```bash
git pull origin main
```

### 2. Aplicar la nueva migración
```bash
docker-compose exec web python manage.py migrate app 0046_solicitud_acceso_proyecto
```

### 3. Verificar que se aplicó correctamente
```bash
docker-compose exec web python manage.py showmigrations app
```

## ✅ Verificar funcionamiento

1. Ve a cualquier proyecto privado donde NO seas miembro
2. Deberías ver:
   - ✅ Contenido borroso con candado 🔒
   - ✅ Botón "Solicitar Unirse"
   - ✅ Al hacer clic, aparece modal de confirmación

3. Si eres creador/miembro de proyectos privados:
   - ✅ Revisa las notificaciones en el dock
   - ✅ Deberías poder aceptar/rechazar solicitudes

## 🔧 Si hay problemas:

### Verificar tabla creada:
```bash
docker-compose exec db mysql -u root -p cartera_clientes_db
```
```sql
SHOW TABLES LIKE '%solicitud%';
DESCRIBE app_solicitudaccesoproyecto;
```

### Resetear migración si es necesario:
```bash
# Marcar migración como no aplicada
docker-compose exec web python manage.py migrate app 0045_fix_foreign_key_constraints

# Volver a aplicar
docker-compose exec web python manage.py migrate app 0046_solicitud_acceso_proyecto
```

## 🎉 Funcionalidades que estarán disponibles:

- **Proyectos públicos**: Funcionan exactamente como antes
- **Proyectos privados**: 
  - Los miembros ven todo normal
  - Los no-miembros ven contenido borroso + candado + botón de solicitud
- **Sistema de solicitudes**:
  - Notificaciones en el dock
  - Botones aceptar/rechazar
  - Acceso automático una vez aprobado

¡El sistema está listo! 🚀
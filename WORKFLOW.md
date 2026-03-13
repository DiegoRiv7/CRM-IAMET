# Flujo de Trabajo CRM IAMET

## Repositorio
- **GitHub:** https://github.com/DiegoRiv7/CRM-IAMET.git
- **Rama producción:** `principal`
- **Rama pruebas:** `pruebas`

---

## Ambientes

### Producción — `crm.iamet.mx`
| Qué | Valor |
|-----|-------|
| Carpeta en servidor | `~/crm-iamet/` |
| Rama git | `principal` |
| Contenedor web | `crm-iamet-web-1` |
| Contenedor BD | `gesti-n-de-ventas-db-1` |
| Base de datos | `crm_iamet_db` |
| Puerto | `8007` |
| Variables de entorno | `~/crm-iamet/.env` |

### Pruebas — `http://crm.pruebas.nethive.mx`
| Qué | Valor |
|-----|-------|
| Carpeta en servidor | `~/crm-pruebas/` |
| Rama git | `pruebas` |
| Contenedor web | `crm-pruebas-web` |
| Contenedor BD | `crm-pruebas-db` |
| Base de datos | `crm_pruebas` |
| Puerto | `8001` |
| Variables de entorno | `~/crm-pruebas/.env.pruebas` |
| Docker Compose | `docker-compose.pruebas.yml` |

---

## Flujo de desarrollo

```
1. Trabajar en Mac en rama "pruebas"
2. git push → GitHub rama "pruebas"
3. En servidor pruebas: git pull + reiniciar
4. Probar en http://crm.pruebas.nethive.mx
5. Si está bien: merge pruebas → principal en GitHub
6. En servidor producción: git pull + reiniciar
```

---

## Comandos frecuentes

### Subir cambios a PRUEBAS
```bash
# En Mac — subir cambios
git add .
git commit -m "descripción del cambio"
git push crm-iamet pruebas

# En servidor — aplicar cambios
cd ~/crm-pruebas
git pull origin pruebas

# Si solo hay cambios en Python/templates (sin archivos estáticos nuevos):
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml restart web

# Si hay archivos CSS/JS nuevos en static/ (OBLIGATORIO correr collectstatic):
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml exec web python manage.py collectstatic --noinput
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml restart web
```

> **NOTA:** `docker compose restart` NO vuelve a ejecutar el entrypoint (que incluye collectstatic).
> Cuando agregues archivos nuevos a `app/static/`, siempre corre collectstatic manualmente.

### Subir cambios a PRODUCCIÓN
```bash
# En Mac — merge y push (solo cuando pruebas está verificado)
git checkout principal
git merge pruebas
git push crm-iamet principal

# En servidor — aplicar cambios
cd ~/crm-iamet
git pull origin principal
sudo docker compose restart web
```

### Ver logs en tiempo real
```bash
# Producción
sudo docker logs crm-iamet-web-1 --tail 50 -f

# Pruebas
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml logs web -f
```

### Correr comandos Django

```bash
# Producción
sudo docker exec -it crm-iamet-web-1 python manage.py COMANDO

# Pruebas
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml exec web python manage.py COMANDO
```

### Reiniciar contenedores
```bash
# Producción
cd ~/crm-iamet && sudo docker compose restart web

# Pruebas
cd ~/crm-pruebas && sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml restart web
```

### Levantar pruebas desde cero (si se cae)
```bash
cd ~/crm-pruebas
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml up -d
```

---

## Backups

### Script
- Ubicación en servidor: `~/backup_crm.sh`
- Variables: `~/.backup_env` (contiene MYSQL_ROOT_PASSWORD)
- Backups guardados en: `~/backups/`

### Qué respalda
| Qué | Frecuencia | Retención | Archivo |
|-----|-----------|-----------|---------|
| Base de datos MySQL | Diario 2am Tijuana (10am UTC) | 7 días | `db_YYYY-MM-DD_HH-MM.sql.gz` |
| Archivos media | Domingos | 4 semanas | `media_YYYY-MM-DD_HH-MM.tar.gz` |

### Correr backup manual
```bash
~/backup_crm.sh
```

### Ver log de backups
```bash
cat ~/backups/backup.log
```

### Restaurar backup en pruebas (actualizar datos)
```bash
# Hacer dump de producción
sudo docker exec gesti-n-de-ventas-db-1 mysqldump -u root -p crm_iamet_db > /tmp/backup.sql

# Importar en pruebas
sudo docker exec -i crm-pruebas-db mysql -u root -p crm_pruebas < /tmp/backup.sql
```

---

## Descarga de archivos Bitrix24
Antes de que venza la suscripción, descargar los 10,076 archivos (~9.5 GB):
```bash
screen -S descarga
cd ~/crm-iamet
sudo docker compose exec web python manage.py descargar_archivos_bitrix
# Ctrl+A, D para dejar corriendo en background
# screen -r descarga para volver a verlo
```

---

## Nginx
- Configuración: `/etc/nginx/sites-enabled/`
- Config de pruebas: `crm.pruebas.nethive.mx.conf` → puerto 8001
- Config de producción: `crm.iamet.mx` → puerto 8007
- Recargar nginx: `sudo systemctl reload nginx`

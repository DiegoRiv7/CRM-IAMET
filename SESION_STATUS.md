# Estado de Sesión — CRM IAMET

## LEER PRIMERO
Lee WORKFLOW.md para flujo de trabajo, ramas y comandos de deploy.
Lee ESTRUCTURA.md para entender la arquitectura completa del proyecto.

---

## Rama actual: `pruebas` — commit `d522cfb` subido, pendiente verificar en servidor

---

## Último commit — `d522cfb` — Bug fixes chat/notificaciones/tareas/oportunidades

- **400 en crear negociación**: URL duplicada en `urls.py` tapaba al handler correcto (`api_crear_oportunidad`)
- **Oportunidades en rojo**: `views_crm` ahora revisa `tareas_generales` (Tarea) además de `tareas_oportunidad` (TareaOportunidad) para detectar vencidas
- **@mention en chat**: backend parsea `@username` y crea notificaciones a los mencionados
- **Notificación tipo `oportunidad_mensaje`**: no se marca leída al click, solo cuando el usuario responde
- **Notificación abre el chat**: al click abre el widget de la oportunidad + panel de conversación
- **`woMentionHighlight is not defined`**: cambiado a `window.woMentionHighlight` para que funcionen inline handlers
- **Tareas abren con widget correcto**: revertido a `crmTaskVerDetalle` (no `woVerActividad`)
- **Archivos en chat**: `accept="*/*"` en input; `woImgFallback()` degrada imagen 404 a link de descarga
- **Cerrar oportunidad sin actividad**: solo bloquea al responsable (`usuario_id`), no a todos

---

## Pasos para aplicar en servidor de pruebas

```bash
cd ~/crm-pruebas
git pull origin pruebas

# Migración 0088 (ImageField → FileField en MensajeOportunidad):
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml exec web python manage.py migrate

# JS modificado → collectstatic obligatorio:
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml exec web python manage.py collectstatic --noinput
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml restart web
```

---

## Pendiente verificar en pruebas

1. Crear nueva negociación — debe funcionar sin 400
2. Oportunidad con tarea vencida — debe aparecer en rojo y hasta arriba en la tabla
3. @mention en chat — usuario mencionado debe recibir notificación
4. Notificación de chat — al click debe abrir la oportunidad y el panel de conversación; no desaparecer hasta que el usuario responda
5. Cerrar oportunidad sin actividad — debe bloquearse solo si el usuario logueado es el responsable
6. Subir archivo en chat — debe mostrarse como link o imagen correctamente (no rectángulo vacío)
7. Tareas en widget de oportunidad — al hacer click deben abrir el modal de tarea completo (no el mini widget de actividad)

---

## Problema pendiente: Media 404 en pruebas

Los archivos subidos en el chat dan 404 porque nginx en pruebas apunta a:
```
location /media/ { alias /home/iamet2026/crm-pruebas/media/; }
```
Pero el volumen Docker `media_pruebas` es un volumen nombrado — nginx del host no puede acceder.

**Solución**: En `docker-compose.pruebas.yml` cambiar `media_pruebas` de volumen nombrado a bind mount:
```yaml
- /home/iamet2026/crm-pruebas/media:/app/media
```
Luego copiar los archivos existentes del volumen al nuevo path y recargar nginx.

---

## Pendiente próxima sesión

### 1. Comentarios de tareas Bitrix
- Crear management command `importar_comentarios_bitrix`
- Los comentarios deben ir a `TareaComentario` (NO a la descripción de tarea)
- Solo los últimos 5 meses
- Similar al patrón de `importar_po_bitrix`

---

## Pasos para pasar a producción (cuando pruebas esté verificado)

```bash
# En Mac
git checkout principal
git merge pruebas
git push crm-iamet principal
git checkout pruebas

# En servidor producción
cd ~/crm-iamet
git pull origin principal
sudo docker compose exec web python manage.py migrate
sudo docker compose exec web bash -c "rm -rf /app/staticfiles/* && python manage.py collectstatic --noinput"
sudo docker compose restart web
```

> Migraciones a aplicar en producción: `0088_mensajeoportunidad_imagen_filefield`

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`

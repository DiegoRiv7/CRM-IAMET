# Estado de Sesión — CRM IAMET

## LEER PRIMERO
Lee WORKFLOW.md para flujo de trabajo, ramas y comandos de deploy.
Lee ESTRUCTURA.md para entender la arquitectura completa del proyecto.

---

## Rama actual: `pruebas` — sesión activa 14 de marzo 2026

---

## Último commit aplicado en pruebas: `eb73fd8`

Bugs corregidos en esta sesión (commits d522cfb → eb73fd8):
- Fix 400 crear negociación (URL duplicada en urls.py)
- Fix búsqueda tabla (cliente__nombre → cliente__nombre_empresa)
- Fix opp desaparece al recargar (history.replaceState al crear)
- Fix 403 archivos chat (nuevo endpoint /api/chat-media/<id>/ sirve desde Django)
- Fix cliente duplicado al crear opp (get_or_create → filter().first())
- Fix tarea sin título (api_tarea_detalle bloqueaba por permisos)
- Fix @mention backend, notificaciones, woAbrirGestorConversacion
- Fix woMentionHighlight en window, tareas abren con crmTaskVerDetalle
- Fix closeDetalleWidget pasa MouseEvent como forceClose → bypass del check
- Fix woCargarTareasInline expuesta en window para refresh tras crear tarea
- Fix orden tabla: más recientes primero, vencidas siempre arriba

---

## Bugs pendientes de corregir (próxima sesión)

### 1. Actividad agendada no se refleja en widget sin recargar
- Al agendar una actividad desde el widget de creación (woCrearActividad), el
  card "ACTIVIDAD PROGRAMADA" no se actualiza automáticamente.
- Fix: después del POST exitoso en el handler de crear actividad, llamar
  `woCargarActividadReciente(_woCurrentOppId)` para refrescar el card.
- También verificar que `window.woCargarActividadReciente` esté expuesta en window.
- Archivo: `_widget_oportunidad.html` — buscar el submit de la actividad y agregar el refresh.

### 2. Hora del calendario 1 hora adelantada — zona horaria Tijuana
- El servidor usa UTC, la app muestra 1 hora de diferencia vs Tijuana (UTC-8 o UTC-7 en verano).
- Fix en settings.py: `TIME_ZONE = 'America/Tijuana'` (ya debe estar, verificar).
- Fix en frontend: al crear actividades y tareas, enviar la hora local del usuario
  o convertir correctamente. El problema puede estar en cómo se guarda la fecha_inicio
  de TareaOportunidad.
- Revisar `api_crear_actividad` / `api_tareas_oportunidad POST` en views_proyectos.py
  para ver cómo parsea las fechas. Usar `timezone.make_aware(dt, timezone.get_current_timezone())`
  en lugar de asumir UTC.

### 3. Actividad creada muestra "Sin fecha" en widget
- La actividad se guarda con fecha pero el card la muestra "Sin fecha límite".
- Revisar `woCargarActividadReciente` en `_widget_oportunidad.html` — qué campo usa para
  mostrar la fecha (`fecha_inicio`, `fecha_limite`, `fecha`).
- Revisar qué devuelve la API `/app/api/oportunidad/<id>/tareas/` (TareaOportunidad).

### 4. Opp con tarea vencida no sale roja en tabla (aún)
- El fix de DateField vs datetime se aplicó pero puede necesitar verificar en pruebas.
- La Tarea "prueba de rojo" tiene fecha_limite = 14 mar. Con el fix `t.fecha_limite <= _today`
  debería aparecer roja. Si sigue sin funcionar, verificar que el pull y collectstatic
  se aplicaron correctamente.
- También verificar que `fecha_ts` esté en el dict de rows (línea ~550 views_crm.py).

### 5. Opp no aparece en filtro "Marzo" — aparece solo en "Todos"
- La opp "mas pruebas para probar" fue creada cuando el widget negociación tenía
  mes_cierre = "todos" o un mes incorrecto.
- En `api_crear_oportunidad`: `mes_cierre = data.get('mes_cierre', mes_actual)` y
  `anio_cierre = now_dt.year`. Si el form `wfMesCierre` envía "todos", la opp queda
  con mes_cierre="todos" y no aparece en filtro de marzo.
- Fix: en `api_crear_oportunidad`, si `mes_cierre == 'todos'` o vacío, usar `mes_actual`.
- Archivo: `app/views_crm.py` línea ~2424.

---

## Pasos para aplicar en servidor de pruebas

```bash
cd ~/crm-pruebas
git pull origin pruebas
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml exec web python manage.py collectstatic --noinput
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml restart web
```

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

> Migración pendiente: `0088_mensajeoportunidad_imagen_filefield`

---

## Contexto de modelos clave
- `TareaOportunidad` — actividades CRM del widget (DateTimeField para fecha_limite)
  endpoint: `/app/api/oportunidad/<id>/tareas/` (GET/POST)
  opened via: `woVerActividad(id)`
- `Tarea` — tareas de ingeniería (DateField para fecha_limite)
  endpoint: `/app/api/tareas/?oportunidad_id=X`
  opened via: `crmTaskVerDetalle(id)`
- `MensajeOportunidad` — chat de la oportunidad, campo `imagen` es FileField (migración 0088)

## Archivos clave modificados esta sesión
- `app/urls.py` — eliminada URL duplicada crear-oportunidad, añadido /api/chat-media/<id>/
- `app/views_crm.py` — fix búsqueda, fix orden tabla, fix DateField comparación
- `app/views_api.py` — @mention backend, endpoint chat-media
- `app/views_proyectos.py` — removido check de permisos restrictivo en api_tarea_detalle
- `app/static/js/crm_main.js` — múltiples fixes (closeDetalleWidget, refreshCrmTable, etc.)
- `app/templates/crm/_widget_oportunidad.html` — woMentionHighlight, woCargarTareasInline en window
- `app/templates/crm/_widget_notificaciones.html` — oportunidad_mensaje no se marca leída al click

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`

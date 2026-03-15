# Estado de Sesión — CRM IAMET

## LEER PRIMERO
Lee WORKFLOW.md para flujo de trabajo, ramas y comandos de deploy.
Lee ESTRUCTURA.md para entender la arquitectura completa del proyecto.

---

## Rama actual: `pruebas` — sesión activa 14 de marzo 2026

---

## Último commit pusheado a pruebas: `6248399`

Bugs corregidos en esta sesión (commits eb73fd8 → 6248399):
- Fix tarea vencida no muestra rojo: `Tarea.fecha_limite` es DateTimeField (no DateField),
  comparar `datetime <= date` lanzaba TypeError. Fix: strip tzinfo y comparar contra `_now_naive`.
- Fix tabla vacía al cerrar widget: `refreshCrmTable()` ahora siempre se llama al cerrar
  el widget de oportunidad, sin depender de `_crmTableDirty`.
- Fix hora 1 hora adelantada: frontend enviaba `-08:00` hardcoded pero Tijuana está en UTC-7
  durante verano (DST desde 8 mar). Ahora envía hora sin offset, backend localiza con
  `America/Tijuana` (maneja DST correctamente).
- Fix opps con `mes_cierre='todos'`: 5 opps corregidas a '03' via Django shell en servidor pruebas.

Bugs corregidos en sesión anterior (commits d522cfb → eb73fd8):
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

## Bugs pendientes de verificar / corregir

### 1. Verificar fix tabla vacía en pruebas
- Después del push `6248399`, verificar que al crear una opp y cerrar el widget
  la tabla muestre los datos correctos sin necesidad de recargar la página.

### 2. Verificar fix hora en calendario
- Crear una actividad de 6pm a 7pm y verificar que el calendario la muestre correctamente
  (antes se mostraba 7pm-8pm por el offset UTC-8 hardcoded).

### 3. Verificar fix opps rojas con tarea vencida
- La opp con tarea vencida debería aparecer roja y arriba de la tabla.
- Si no funciona, verificar que el estado de la Tarea sea 'pendiente', 'iniciada' o 'en_progreso'.

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
- `Tarea` — tareas de ingeniería (DateTimeField para fecha_limite — OJO, NO DateField)
  endpoint: `/app/api/tareas/?oportunidad_id=X`
  opened via: `crmTaskVerDetalle(id)`
- `MensajeOportunidad` — chat de la oportunidad, campo `imagen` es FileField (migración 0088)

## Archivos clave modificados (ambas sesiones)
- `app/urls.py` — eliminada URL duplicada crear-oportunidad, añadido /api/chat-media/<id>/
- `app/views_crm.py` — fix búsqueda, fix orden tabla, fix DateTimeField comparación, fix mes_cierre
- `app/views_api.py` — @mention backend, endpoint chat-media
- `app/views_proyectos.py` — removido check de permisos restrictivo, fix timezone actividades
- `app/static/js/crm_main.js` — closeDetalleWidget, refreshCrmTable siempre al cerrar widget
- `app/templates/crm/_widget_oportunidad.html` — fix hora DST (sin offset hardcoded)
- `app/templates/crm/_widget_notificaciones.html` — oportunidad_mensaje no se marca leída al click
- `cartera_clientes/settings.py` — TIME_ZONE = 'America/Tijuana'

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`

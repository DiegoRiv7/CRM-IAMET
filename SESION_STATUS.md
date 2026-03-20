# Estado de Sesión — CRM IAMET

## LEER PRIMERO
Lee WORKFLOW.md para flujo de trabajo, ramas y comandos de deploy.
Lee ESTRUCTURA.md para entender la arquitectura completa del proyecto.

---

## Rama actual: `pruebas` — sesión activa 20 de marzo 2026

---

## Cambios de esta sesión: Rediseño completo del sistema de notificaciones

### NUEVO — Sistema de notificaciones v2
- Rediseño completo del widget `_widget_notificaciones.html` con diseño moderno tipo SaaS
- Layout de 2 columnas: sidebar de filtros (izquierda) + lista principal (derecha)
- Sistema de prioridades con 3 niveles: Críticas (rojo), Importantes (ámbar), Informativas (azul)
- Agrupación inteligente: notificaciones vencidas se agrupan cuando hay 3+ del mismo tipo
- Secciones temporales: Hoy, Ayer, Esta semana, Anteriores
- Acciones rápidas en hover: Ver, Completar, Aprobar/Rechazar, Marcar leída
- Filtros en sidebar: Todas, No leídas, Críticas, Tareas, Oportunidades, Equipo, Admin
- Iconos SVG por tipo (sin emojis), diferenciación visual clara por prioridad
- Tags inline: "Urgente" (rojo) y "Importante" (ámbar) en notificaciones no leídas
- Timestamps relativos: "ahora", "5m", "2h", "ayer", "3d"

### MEJORA — Umbral de alerta "por vencer" cambiado a 10 minutos
- Antes el umbral era de 1 día (`timedelta(days=1)`)
- Ahora la notificación de "por vencer" se dispara cuando faltan 10 minutos o menos
- Aplica tanto a tareas de ingeniería como a actividades de oportunidad
- Mensajes actualizados: "vence en menos de 10 minutos" en lugar de "vencerá pronto"

### TÉCNICO — Modelo Notificacion actualizado
- `TIPO_CHOICES` ahora incluye todos los tipos que se usan en el sistema:
  `tarea_vencida`, `tarea_por_vencer`, `actividad_vencida`, `actividad_por_vencer`,
  `tarea_asignada`, `tarea_mencion`, `tarea_comentario`, `tarea_reprogramada`
- Campo `tipo` ampliado de `max_length=25` a `max_length=30`
- Migración: `0091_alter_notificacion_tipo_max_length`

### NUEVO — Documento de mejoras de deuda técnica
- Archivo `MEJORAS_DEUDA_TECNICA.md` con 5 áreas de mejora identificadas
- Para trabajar con Claude en sesiones futuras

---

## Archivos modificados en esta sesión
- `app/templates/crm/_widget_notificaciones.html` — Reescrito completamente (v2)
- `app/views_api.py` — Umbral de vencimiento cambiado a 10 minutos, mensajes actualizados
- `app/models.py` — TIPO_CHOICES actualizado, max_length de tipo ampliado a 30
- `app/migrations/0091_alter_notificacion_tipo_max_length.py` — Nueva migración
- `MEJORAS_DEUDA_TECNICA.md` — Nuevo archivo
- `NUEVO_SISTEMA_NOTIFICACIONES.md` — Documento de diseño del sistema

---

## Pasos para aplicar en servidor de pruebas

```bash
cd ~/crm-pruebas
git pull origin pruebas
sudo docker compose --env-file .env.pruebas -f docker-compose.pruebas.yml exec web python manage.py migrate
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

> Migraciones pendientes: `0088_mensajeoportunidad_imagen_filefield`, `0091_alter_notificacion_tipo_max_length`

---

## Contexto de modelos clave
- `TareaOportunidad` — actividades CRM del widget (DateTimeField para fecha_limite)
  endpoint: `/app/api/oportunidad/<id>/tareas/` (GET/POST)
  opened via: `woVerActividad(id)`
- `Tarea` — tareas de ingeniería (DateTimeField para fecha_limite — OJO, NO DateField)
  endpoint: `/app/api/tareas/?oportunidad_id=X`
  opened via: `crmTaskVerDetalle(id)`
- `MensajeOportunidad` — chat de la oportunidad, campo `imagen` es FileField (migración 0088)
- `Notificacion` — 23 tipos organizados por prioridad (Crítica/Importante/Informativa)

## Archivos clave modificados (todas las sesiones)
- `app/urls.py` — eliminada URL duplicada crear-oportunidad, añadido /api/chat-media/<id>/
- `app/views_crm.py` — fix búsqueda, fix orden tabla, fix DateTimeField comparación, fix mes_cierre
- `app/views_api.py` — @mention backend, endpoint chat-media, umbral 10min notificaciones
- `app/views_proyectos.py` — removido check de permisos restrictivo, fix timezone actividades
- `app/static/js/crm_main.js` — closeDetalleWidget, refreshCrmTable siempre al cerrar widget
- `app/templates/crm/_widget_oportunidad.html` — fix hora DST (sin offset hardcoded)
- `app/templates/crm/_widget_notificaciones.html` — Rediseño completo v2
- `cartera_clientes/settings.py` — TIME_ZONE = 'America/Tijuana'
- `app/models.py` — Notificacion.TIPO_CHOICES actualizado

---

## Reglas del proyecto
- Trabajar en rama `pruebas` primero
- Verificar en `http://crm.pruebas.nethive.mx`
- NUNCA mergear a `principal` sin verificar
- Producción corre en `crm.iamet.mx` rama `principal`

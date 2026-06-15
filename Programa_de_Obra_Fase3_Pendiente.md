# Programa de Obra — Fase 3 (Pendiente)

**Estado:** Fases 1 y 2 completadas. Fase 3 por implementar.
**Fecha:** Abril 2026

---

## Lo que ya existe (Fases 1 y 2)

### Fase 1 — Gantt Funcional ✅
- **Modelos Django:** `GanttFase` + `GanttActividad` en `app/models.py`
- **Migración:** `app/migrations/0127_gantt_programa_obra.py`
- **API REST** (5 endpoints en `app/views_proyectos.py`):
  - `GET/POST /app/api/proyecto/<id>/gantt/` — listar + crear actividad
  - `PUT/DELETE /app/api/gantt/actividad/<id>/` — editar/eliminar
  - `POST/DELETE /app/api/gantt/fase/` — crear/eliminar fases
  - `PUT/DELETE /app/api/gantt/fase/<id>/` — editar fase
  - `POST /app/api/gantt/actividad/<id>/cascada/` — cascada Finish-to-Start
- **Canvas Gantt** (`app/static/js/gantt_programa_obra.js`, ~1950 líneas):
  - Canvas 2D con barras pill (border-radius completo)
  - Drag & drop horizontal (mover fecha)
  - Resize de bordes (cambiar duración)
  - Fases colapsables con summary bars
  - Toolbar: + Actividad, Eliminar, Fases, zoom D/S/M
  - Modal de nueva actividad
  - Empty state con CTA
  - Colores por progreso: azul (0%), azul oscuro fill (parcial), verde (100%)

### Fase 2 — Dependencias + Interacciones ✅
- **Menú contextual** (click derecho en barra):
  - Agregar dependencia → submenu con actividades disponibles
  - Quitar dependencias
  - Editar progreso (mini-input 0-100)
  - Ver detalles
- **Flechas SVG** de dependencia Finish-to-Start con curvas suaves
- **Inline edit** de nombre (doble click en tabla)
- **Cascada visual** durante drag (dependientes se mueven en tiempo real)

### Rediseño Visual ✅
- Estilo tipo Monday.com/Linear
- Barras pill con sombra y hover
- Grid casi invisible (solo separadores de semana)
- Día de hoy con círculo azul (Google Calendar style)
- Tabla solo nombre (DUR/% aparecen en hover como badges)
- Tooltip como mini-card con progress bar y avatares
- Empty state "Comienza tu programa de obra"

### Integración ✅
- Toggle Simple/Avanzado en la Fase 4 del levantamiento (`crm_levantamiento.js`)
- Script tag en `crm_home.html`
- CSS en `crm_proyectos.css`
- Persiste elección en localStorage

---

## Fase 3 — Por Implementar

### 3.1 Vista de Erogaciones e Ingresos (spec PRO-008)
**Objetivo:** Vista financiera duplicada del cronograma donde las barras representan costos e ingresos.

**Qué construir:**
- Botón "Erogaciones" en el toolbar del Gantt que togglea entre vista cronograma y vista financiera
- En vista financiera:
  - Las barras muestran el monto en miles (ej: "$45k") en lugar del porcentaje
  - Color de barra: rojo para costos, verde para ingresos
  - Hover/tooltip muestra: Costo estimado, Ingreso estimado, margen
- Comparte el mismo modelo de datos — cualquier cambio en una vista se refleja en la otra
- Para calcular erogación diaria: `task.cost / task.dur`

**Archivos a modificar:**
- `app/static/js/gantt_programa_obra.js` — agregar modo de renderizado financiero

### 3.2 Dashboard de Valor Ganado / EVM (spec PRO-009)
**Objetivo:** Indicadores clave de desempeño del proyecto basados en Valor Ganado.

**KPIs a mostrar:**
| KPI | Fórmula | Interpretación |
|-----|---------|---------------|
| SPI (Schedule Performance Index) | EV / PV | > 1.0 = adelantado, < 1.0 = retrasado |
| CPI (Cost Performance Index) | EV / AC | > 1.0 = bajo presupuesto, < 1.0 = sobre presupuesto |
| Avance Global | avg(task.progress) | Porcentaje promedio de completitud |

**Dónde:**
- Donde dice:
  - EV (Earned Value) = sum(tarea.costo_estimado × tarea.progreso / 100)
  - PV (Planned Value) = sum(tarea.costo_estimado) de tareas que deberían estar completadas a hoy
  - AC (Actual Cost) = sum(gastos reales del proyecto desde módulo financiero)

**Qué construir:**
- 3 cards tipo KPI arriba del Gantt (o en un panel lateral colapsable)
- Gráfica de tendencia SPI/CPI por semana (mini sparkline)
- Barra de avance global con porcentaje

**Archivos a modificar:**
- `app/static/js/gantt_programa_obra.js` — agregar panel EVM
- `app/views_proyectos.py` — endpoint que calcule EV/PV/AC

### 3.3 Asignación de Recursos Humanos (spec PRO-006)
**Objetivo:** Asignar/desasignar personal a actividades del cronograma.

**Qué construir:**
- Modal "Asignar Recursos" (ya existe básico como `_showResourceModal`)
- Mejorar el modal: mostrar lista de usuarios del sistema con checkboxes
- Mostrar costo diario por recurso (si está definido)
- En la tabla: icono con conteo de recursos asignados
- En la barra del Gantt: iniciales de recursos como micro-avatares debajo de la barra
- Vista de carga de recursos: tabla que muestra por usuario cuántos días tiene asignados, detectar sobre-asignación

**Datos:**
- `GanttActividad.recursos` ya es M2M a User — el modelo está listo
- Los recursos se guardan via PUT al endpoint existente

**Archivos a modificar:**
- `app/static/js/gantt_programa_obra.js` — mejorar `_showResourceModal`

### 3.4 Integración con Calendario (pendiente)
**Objetivo:** Vincular actividades del Gantt al calendario del CRM.

**Qué construir:**
- Al crear/mover una actividad en el Gantt, crear/actualizar su `Actividad` del calendario
- El campo `GanttActividad.actividad_calendario` ya existe (FK a `Actividad`)
- Cuando se mueve la barra, actualizar la fecha de la Actividad del calendario
- En el calendario global, las actividades del Gantt deberían aparecer

**Archivos a modificar:**
- `app/views_proyectos.py` — en el PUT de actividad, sincronizar con Actividad del calendario
- `app/static/js/gantt_programa_obra.js` — al completar drag, triggear sync

### 3.5 Exportación (spec Anexo D)
- PDF del cronograma (canvas → imagen → PDF)
- CSV de la tabla de actividades con costos
- Botón "Exportar" en el toolbar

---

## Archivos clave del módulo

| Archivo | Contenido |
|---|---|
| `app/static/js/gantt_programa_obra.js` | Canvas Gantt completo (~1950 líneas) |
| `app/models.py` (final) | `GanttFase` + `GanttActividad` |
| `app/views_proyectos.py` (final) | 5 endpoints API REST |
| `app/urls.py` | 5 rutas Gantt |
| `app/migrations/0127_gantt_programa_obra.py` | Migración de tablas |
| `app/static/css/crm_proyectos.css` (final) | Estilos del toggle + contenedor |
| `app/static/js/crm_levantamiento.js` | Toggle Simple/Avanzado en Fase 4 |
| `app/static/js/crm_proyectos.js` | `proyGetCurrentProjectId()` expuesto |
| `app/templates/crm/_widget_proyectos.html` | Tab "Programa de Obra" con toggle |
| `app/templates/crm_home.html` | Script tag del gantt JS |
| `Especificacion_Tecnica_Programa_de_Obra.md` | Spec completa de los 9 procesos |

---

## Notas para el implementador

1. **No tocar la lógica funcional** de Fases 1-2 (drag, resize, cascada, API) — solo agregar ENCIMA
2. El archivo `gantt_programa_obra.js` es autocontenido (IIFE) — todo se agrega dentro del mismo scope
3. La función `_drawActivityBar` maneja el rendering de barras — extenderla para modo financiero
4. `_showResourceModal` ya existe pero es básico — reemplazarlo con versión mejorada
5. El modelo `GanttActividad` ya tiene los campos `costo_estimado`, `ingreso_estimado`, `recursos` (M2M) y `actividad_calendario` — no hace falta tocar modelos
6. Para EVM, se necesita un endpoint nuevo que calcule PV/EV/AC basado en las actividades + gastos del proyecto

# Plan Fase 6 — Refactor + Handoff

**Fecha:** 2026-06-04
**Contexto:** Diego Jafet Rivera planea salir de IAMET en ~1 mes. Objetivo: dejar el CRM IAMET limpio, ordenado, con experiencia mejorada para usuarios actuales y documentado para el sucesor.

**Filosofía del plan:**
- **NO refactor masivo** (no partir archivos enormes con riesgo alto)
- **SÍ Boy Scout Rule** (a partir de hoy, todo lo nuevo va en archivos nuevos)
- **SÍ Turbo** (los usuarios actuales llevan meses sufriendo lentitud)
- **SÍ documentación completa** (lo único que el sucesor REALMENTE necesita)

---

## 📊 Orden del plan (lógica natural)

1. **Limpiar** → eliminar peso muerto
2. **Ordenar** → carpetas y archivos en su lugar
3. **Preparar terreno** → crear archivos nuevos vacíos para futuras features
4. **Optimizar para usuarios actuales** → Turbo + cleanups críticos
5. **Documentar** → al final, con sistema estable y servidor accesible

---

## ⏱️ Plan completo (~13-14 días)

### 🧹 FASE 1 — Limpiar y ordenar (~2-3 días)

**1.A — Quitar peso muerto (1 día)**
- Borrar `SESION_STATUS.md` (legacy del 20 marzo)
- Borrar `nginx.conf` raíz (nunca usado en prod)
- Borrar `_actividades_board.html` (comentado out desde 28 mayo)
- Borrar `test_script.js` (nunca cargado)
- Borrar 6 management commands one-shot: `crear_admin_compras`, `crear_proyecto_prueba`, `poblar_etapas_pipeline`, `seed_compras`, `seed_compras_demo`, `seed_tecnicos`
- Eliminar CSS muerto: `.compras-soon`, `.proy-empty`, `.wco-info-saved`, spotlight v1 (729 líneas en `base.css:457-728`)
- Eliminar console.logs olvidados restantes

**1.B — Reorganizar estructura (1 día)**
- Crear `reports/` y mover los 42 archivos `Reporte_Avances_*.html`
- Mover imágenes raíz (`iamet_logo_tight.png`, `image.png`, `logo bajanet.jpeg`) a `app/static/images/`
- Crear `docs/` y mover `prompt-claude-design-levantamiento.md` ahí
- Limpiar `.gitignore`: quitar duplicados (`.env` 2×, `.DS_Store` 2×), agregar `*.log`, `*.swp`, `*~`
- Crear directorio `app/static/js/legacy/` (vacío por ahora — destino para archivos que se "fosilicen")

**1.C — Smoke check post-limpieza (medio día)**
- Verificar que la página sigue cargando bien
- Commit + push a `pruebas`
- Validación visual: CRM, calendario, proyectos, reportes

---

### 🏗️ FASE 2 — Preparar terreno Boy Scout (~1-2 días)

Crear la estructura de archivos NUEVOS donde irán las próximas features. Los archivos van **vacíos con header documentado**, listos para recibir contenido cuando se necesite.

**2.A — Crear archivos nuevos vacíos para Frontend**

Frontend (en `app/static/js/`):
```
crm_kanban_v2.js          ← futuras features del kanban
crm_tareas_v2.js          ← futuras features de tareas
crm_clientes_v2.js        ← futuras features del dashboard de clientes
crm_features_misc.js      ← features sueltos que no encajan en otro lado
proyectos_v2.js           ← futuras features de proyectos
```

Cada archivo arranca así:
```js
/* ═══════════════════════════════════════════════════════════════════
 * crm_kanban_v2.js — CÓDIGO NUEVO desde 2026-06-04
 *
 * Aquí va TODA modificación o nueva feature relacionada con el kanban
 * de oportunidades. NO modificar crm_main.js (sección kanban líneas
 * X-Y) — está marcado como LEGACY y se conserva intacto.
 *
 * Cuando una función del kanban legacy necesite cambios, se reescribe
 * acá con el mismo nombre + 'V2' y se delega desde el viejo:
 *   // En crm_main.js:
 *   window.kanbanRender = window.kanbanRenderV2 || _kanbanRenderLegacy;
 *
 * Convenciones obligatorias:
 *  - IIFE: (function () { 'use strict'; ... })();
 *  - Comentarios donde el "por qué" no sea obvio
 *  - Idempotente (guard con window._wired flag)
 *  - Sin console.log de debug
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    // (vacío por ahora — el primer feature nuevo aterriza aquí)
})();
```

**2.B — Crear archivos nuevos vacíos para Backend**

Backend (en `app/`):
```
app/views_v2/                          ← nuevo paquete
├── __init__.py
├── README.md                          ← regla Boy Scout
├── crm_v2.py                          ← futuras vistas CRM
├── proyectos_v2.py                    ← futuras vistas proyectos
└── api_v2.py                          ← futuras APIs
```

Cada `*_v2.py` arranca con docstring del módulo explicando:
- Qué dominio cubre
- Qué archivo legacy reemplaza progresivamente
- Convenciones obligatorias (decoradores, logging, etc.)

**2.C — README de los directorios**

Crear:
- `app/static/js/README.md` — explica qué archivos son LEGACY (no tocar) y cuáles son V2 (donde va lo nuevo)
- `app/views_v2/README.md` — mismo concepto para backend
- `legacy/README.md` (en cada lugar relevante) — explica que esos archivos están "congelados"

**2.D — Marcar archivos LEGACY en su header**

Agregar al inicio de cada archivo legacy:
```js
/* ═══════════════════════════════════════════════════════════════════
 * crm_main.js — ARCHIVO LEGACY (no modificar)
 *
 * Este archivo está congelado desde 2026-06-04. Cualquier cambio nuevo
 * debe ir en crm_kanban_v2.js, crm_tareas_v2.js o crm_clientes_v2.js
 * según el dominio. Ver app/static/js/README.md.
 *
 * Solo se modifica para:
 *  - Bugs críticos de producción
 *  - Cambios menores que NO ameritan crear un módulo nuevo
 * ═══════════════════════════════════════════════════════════════════ */
```

Aplicar a:
- `app/static/js/crm_main.js` (11,500 líneas)
- `app/static/js/crm_proyectos.js` (7,400 líneas)
- `app/static/js/crm_levantamiento.js` (4,500 líneas)
- `app/static/js/gantt_programa_obra.js` (3,700 líneas)
- `app/views_proyectos.py` (6,861 líneas)
- `app/views_iamet.py` (6,568 líneas)
- `app/views_crm.py` (6,488 líneas)

---

### ⚡ FASE 3 — Optimizar para usuarios actuales (~4-5 días)

Esta es la fase de mayor valor PARA LOS USUARIOS QUE YA USAN EL CRM. Llevan meses sufriendo lentitud entre navegaciones.

**3.A — Cleanups críticos (2 días)**

- Reemplazar los **5 try/except pass más críticos** con `logger.exception()`:
  - `views_crm.py:235, 621, 1465, 2607, 3273`
- Agregar **2 índices DB faltantes**:
  - `TodoItem.oportunidad` (models.py:353)
  - `ProyectoPartida.numero_parte` (models.py:4377)
- Verificar `DJANGO_DEBUG=False` en `.env` del servidor de producción (SSH al servidor)
- Documentar en código el WARNING del volumen `media_files external: true`
- Eliminar 280+ `print()` statements restantes — reemplazar con `logger.debug()` donde aplique

**3.B — `crm_main.js` Turbo-tolerant SIN partir (2 días)**

Hacer el archivo idempotente sin tocar la lógica interna:
- Migrar los 5 `DOMContentLoaded` (líneas 24, 380, 8029, 8366, 10839) a `window.crmReady()`
- Agregar guards `if (window._crmListNWired) return; window._crmListNWired = true;` para los listeners delegation en `document` dentro de cada listener (evita duplicación al re-evaluar)
- Agregar flag `_wired` a elementos del body que se wirean (mesFilter, vfBtn, etc.) para idempotencia

**Mismo tratamiento para:**
- `crm_proyectos.js` (1 DOMContentLoaded principal)
- `crm_mail.js`, `crm_muro.js`, `crm_ingeniero.js` (1 cada uno)

**3.C — Re-activar Turbo (1 día)**

- Re-introducir Turbo Drive desde la rama `turbo-experiment` (ya tenemos el código)
- Volver a poner `data-turbo-permanent` en spotlight y ayuda modales
- Volver a poner `data-turbo-eval="false"` en widget_stack, widget_toast, widget_data_bus, widget_url_sync
- Volver a poner `data-turbo-track="reload"` en crm_main.js (por si hace falta full reload entre páginas con scripts distintos)
- Activar `data-turbo="true"` en los links del sidebar: CRM, Tareas, Proyectos, Calendario, Compras
- Smoke test integral: cada flujo crítico

**3.D — Smoke test integral (0.5 día)**

Probar manualmente:
- Login → CRM
- CRM ↔ Tareas (Turbo)
- CRM ↔ Proyectos (Turbo)
- CRM ↔ Calendario (Turbo)
- Recargar la página en cada tab
- Abrir/cerrar widgets (oportunidad, tarea, proyecto, cotización)
- Spotlight (⌘K + búsqueda + navegación con teclado)
- Crear/editar/completar tareas
- Crear oportunidad
- Logout

---

### 📚 FASE 4 — Documentación y handoff (~5-6 días)

**4.A — Inventario del servidor (1 día)**

SSH al servidor de producción + pruebas para levantar inventario REAL:
- Ver `.env` actual (qué variables tiene, valores ofuscados)
- Ver `crontab -l` (qué cron jobs corren, a qué hora)
- Ver `/etc/nginx/sites-enabled/` (configs reales)
- Ver SSL certs (dónde, cuándo expiran, certbot config)
- Ver scripts en `~` o `/home/iamet2026/` (backup.sh, otros)
- Ver paths de volúmenes Docker (`docker volume ls` + `docker volume inspect`)
- Ver versión de Docker, MySQL, OS
- Ver logs (`/var/log/`, journalctl, docker logs)
- Tomar notas de TODO

**4.B — Crear `SERVIDOR.md` (1 día)**

Documento que cubre TODO lo que vive en el servidor y NO en el repo:
- Acceso SSH: comandos para conectar a prod y pruebas
- Estructura de directorios en el servidor
- Variables de entorno: lista completa con explicación de cada una
- Cron jobs: tabla con cron expression, comando, qué hace, dónde escribe log
- Nginx: ubicación de configs, qué sirven, cómo recargar
- SSL: dónde están los certs, cómo renueva certbot, cuándo expiran
- Backups: dónde se guardan, retención, cómo restaurar (con comandos exactos)
- Volúmenes Docker: nombres, dónde están físicamente, advertencia de `external: true`
- Comandos de operación: restart, rebuild, ver logs, conectar a MySQL
- Troubleshooting: qué hacer si Nginx tira 502, si el contenedor no levanta, etc.
- GitHub Actions: cómo está configurado, a qué rama dispara, qué hace

**4.C — Crear documentación del repo (2 días)**

- **`README.md`** — descripción del proyecto, stack, quick start local (`docker compose up`), links a otros docs
- **`DEPLOYMENT.md`** — proceso de deploy paso a paso, rollback, troubleshooting frecuente
- **`ARQUITECTURA.md`** — mapa del proyecto: dónde vive cada cosa, dependencias entre módulos, decisiones arquitectónicas
- **`DECISIONES.md`** — por qué Proyecto vs ProyectoIAMET (cuál es oficial), por qué Tarea vs TareaOportunidad, por qué Vanilla JS y no React, por qué Boy Scout Rule, por qué algunos features usan iframe, etc.
- **`.env.example`** — todas las variables documentadas (sin valores reales)
- **`app/static/js/README.md`** — regla Boy Scout, qué es legacy, qué es v2
- **`app/views_v2/README.md`** — idem para backend
- **`scripts/README.md`** — qué hace backup.sh, schedule, restore
- **`nginx/README.md`** — aclarar que configs reales viven en `/etc/nginx/sites-enabled/`

**4.D — Update de docs existentes (1 día)**

- **`ESTRUCTURA.md`** — actualizar con cambios recientes (Hardening Fases 1-3, Boy Scout, archivos v2)
- **`WORKFLOW.md`** — actualizar con regla Boy Scout y dónde poner código nuevo
- **`ACTUALIZACIONES.md`** — agregar todo lo de abril-junio (Hardening, Prospección, Grupos, etc.)
- **`Plan_Hardening_CRM.md`** — marcar Fases 1-3 como completas oficialmente
- Consolidar `NUEVO_SISTEMA_NOTIFICACIONES.md` en `Plan_Hardening_CRM.md` Fase 2 (eliminar duplicación)

**4.E — Decisiones explícitas en código (medio día)**

- Marcar `Proyecto` legacy con docstring `# DEPRECATED: usar ProyectoIAMET` (sin eliminar)
- Marcar endpoints legacy duplicados con docstring de deprecation
- Headers con `# DEPRECATED` claros donde aplique

---

## 📋 Resumen visual del plan

```
┌──────────────────────────────────────────────────────────────┐
│  FASE 1 — Limpiar y ordenar              (2-3 días)          │
│  ├─ 1.A Quitar peso muerto                                   │
│  ├─ 1.B Reorganizar carpetas                                 │
│  └─ 1.C Smoke check                                          │
├──────────────────────────────────────────────────────────────┤
│  FASE 2 — Preparar terreno Boy Scout     (1-2 días)          │
│  ├─ 2.A Archivos JS nuevos vacíos                            │
│  ├─ 2.B Archivos Python nuevos vacíos                        │
│  ├─ 2.C READMEs de directorios                               │
│  └─ 2.D Headers LEGACY en archivos grandes                   │
├──────────────────────────────────────────────────────────────┤
│  FASE 3 — Optimizar para usuarios        (4-5 días) ⭐       │
│  ├─ 3.A Cleanups críticos                                    │
│  ├─ 3.B crm_main.js Turbo-tolerant                           │
│  ├─ 3.C Re-activar Turbo                                     │
│  └─ 3.D Smoke test integral                                  │
├──────────────────────────────────────────────────────────────┤
│  FASE 4 — Documentación y handoff        (5-6 días)          │
│  ├─ 4.A Inventario del servidor (SSH)                        │
│  ├─ 4.B SERVIDOR.md                                          │
│  ├─ 4.C README/DEPLOYMENT/ARQUITECTURA/DECISIONES            │
│  ├─ 4.D Update docs existentes                               │
│  └─ 4.E Marcar deprecated en código                          │
└──────────────────────────────────────────────────────────────┘

Total: ~13-14 días de trabajo dedicado
```

## 🎯 Por qué este orden funciona

1. **Limpieza primero** → reduce ruido visual y mental antes de hacer trabajo intelectual
2. **Boy Scout antes de Turbo** → al activar Turbo, los archivos nuevos ya están listos para recibir features futuros
3. **Turbo en el medio** → valor inmediato a usuarios mientras todavía conozco el sistema
4. **Docs al final** → cuando ya hice TODO el trabajo, sé exactamente qué documentar y tengo SSH abierto al servidor

## 📅 Si la velocidad de avance es rápida, hay margen para:
- Tests smoke mínimos (modelos críticos + APIs principales)
- Migration squash (opcional, low priority)
- Sub-fases pequeñas de N+1 queries adicionales

Pero NO son críticos para el handoff.

## 🟢 Lo que está bien hecho y se preserva

- Sistema de widgets (data_bus, stack, url_sync, toast) ✓
- Spotlight v2 ✓
- Responsive.css con 5 breakpoints ✓
- Sistema de 4 temas ✓
- Docker setup ✓
- GitHub Actions a pruebas ✓
- Backups automatizados en servidor ✓
- Migraciones organizadas ✓

---

**Próximo paso:** Diego confirma → arrancamos con Fase 1.A (Quick wins de limpieza).

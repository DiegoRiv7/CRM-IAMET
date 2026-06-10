# JavaScript del CRM IAMET

Este directorio contiene **dos tipos de archivos**: legacy y nuevos.
La política Boy Scout Rule (desde 2026-06-04) separa unos de otros.

## 🏛️ Archivos LEGACY (no modificar salvo bug crítico)

Estos archivos están **congelados** por su tamaño y complejidad. Cualquier
feature nueva NO va aquí — va en los archivos `*_v2.js`.

| Archivo | Líneas | Responsabilidades mezcladas |
|---|---|---|
| `crm_main.js` | ~11,500 | Kanban opp, dashboard clientes, tareas cockpit, admin, varios |
| `crm_proyectos.js` | ~7,400 | Lista proyectos, detalle, levantamientos, drive |
| `crm_levantamiento.js` | ~4,500 | Wizard de levantamiento (5 fases) |
| `gantt_programa_obra.js` | ~3,700 | Gantt + templates de programa de obra |

Solo se modifican para:
- **Bugs críticos en producción** que afectan operación
- **Cambios mínimos** que NO ameritan crear un módulo nuevo

## 🆕 Archivos V2 (todo código nuevo va aquí)

Vacíos al crearse (2026-06-04). El primer feature aterriza en el que
corresponda según dominio.

| Archivo | Dominio |
|---|---|
| `crm_kanban_v2.js` | Kanban de oportunidades + filtros |
| `crm_tareas_v2.js` | Tareas, subtareas, comentarios, timer |
| `crm_clientes_v2.js` | Dashboard de clientes (ck*, drill-down, gráficas) |
| `crm_features_misc.js` | Features sueltos que no encajan en otro lado |
| `proyectos_v2.js` | Módulo de proyectos (lista, detalle, drive, programa obra) |

**Activación**: cuando un `*_v2.js` reciba su primer código real, hay que
agregarlo en el template correspondiente:
- Scripts del CRM principal → `app/templates/crm/_scripts_main.html`
- Scripts globales del home → `app/templates/crm_home.html`

Mientras estén vacíos, NO se cargan en ningún template (cero overhead).

## 🧱 Archivos del sistema de widgets (Hardening Fase 1)

Estos son CORE del sistema y se mantienen como están. Modelo a seguir
para nuevos módulos:

| Archivo | Propósito |
|---|---|
| `widget_stack.js` | Stack manager dinámico de z-index para widgets |
| `widget_toast.js` | Helper global `window.toast(msg, type, ttl)` |
| `widget_data_bus.js` | Event bus `crm:data-changed` + auto-emit en fetch |
| `widget_url_sync.js` | URL syncing con `crmWidgetUrl.set/clear/read` |
| `widget_window.js` | Sistema de ventanas: resize por esquinas, drag, minimizar a dock, máx 4 ventanas. Oportunidades adicionales = ventanas-iframe EDITABLES (`/app/home/?ww=1&open_opp=<id>`; documento propio → estado propio; data bus puenteado por postMessage). Piloto: whitelist `WINDOWABLE_IDS` o `data-windowable="1"`. CSS en `widget_window.css` |

## 📝 Convenciones obligatorias para archivos V2

```js
/* ═══════════════════════════════════════════════════════════════════════
 * <nombre>.js — CÓDIGO NUEVO (desde <fecha>)
 *
 * Qué dominio cubre + qué archivo legacy reemplaza progresivamente
 * + cuándo escribir aquí vs en el legacy.
 * ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // 1. IIFE para evitar contaminar el scope global
    // 2. Idempotente: usar guard `if (window._fooWired) return; ...`
    //    si vas a wirear listeners en `document` o `window` (sobreviven
    //    a recargas parciales bajo Turbo Drive cuando se active)
    // 3. Listeners delegation cuando se pueda
    // 4. Reusar globales del Hardening: window.toast, window.crmDataBus,
    //    window.crmWidgetStack, window.crmWidgetUrl
    // 5. Sin console.log de debug; sí console.error en catch legítimos

})();
```

## 🚫 Lo que NO se debe hacer

- Agregar más código a los archivos legacy (rompe Boy Scout Rule)
- Duplicar helpers que ya existen (escapeHtml, fmtMoney, parseFloat)
  → cuando se cree `helpers_shared.js`, importar de ahí
- Crear `<script>` inline en templates HTML para lógica grande
  → poner en un `*_v2.js` y cargar el archivo

## 📚 Más contexto

Ver:
- `ESTRUCTURA.md` (raíz del repo) — mapa general del proyecto
- `Plan_Fase6_Refactor.md` — plan actual de handoff
- `Plan_Hardening_CRM.md` — historia del sistema de widgets (Fases 1-3)

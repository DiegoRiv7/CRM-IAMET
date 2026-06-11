/* ═══════════════════════════════════════════════════════════════════════
 * crm_kanban_v2.js — CÓDIGO NUEVO (desde 2026-06-04)
 *
 * Aquí va TODA modificación o nueva feature relacionada con el kanban
 * de oportunidades del CRM. NO modificar crm_main.js (sección kanban,
 * líneas ~100-380 aprox) — está marcado como LEGACY y se conserva
 * intacto por la política Boy Scout Rule (ver ESTRUCTURA.md).
 *
 * Cuándo escribir aquí:
 *   - Nueva feature del kanban (drag-and-drop, columnas custom, etc.)
 *   - Cambio en filtros mes/año/vendedor que ameriten lógica nueva
 *   - Mejoras visuales del kanban
 *
 * Cuándo escribir en crm_main.js (legacy):
 *   - Solo bug crítico de producción que ya existe en el código viejo
 *
 * Cómo "reemplazar" funciones del legacy sin tocarlo:
 *   // En crm_main.js (legacy):  window.kanbanRender = function() { ... }
 *   // Aquí (nuevo):
 *   var _legacyKanbanRender = window.kanbanRender;
 *   window.kanbanRender = function() {
 *       // lógica nueva
 *       _legacyKanbanRender();  // o no, según sea reemplazo total o wrap
 *   };
 *
 * Convenciones obligatorias en este archivo:
 *   - IIFE: (function () { 'use strict'; ... })();
 *   - Comentarios donde el "por qué" no sea obvio
 *   - Idempotente: usar guard `if (window._kanbanV2Wired) return;` si wirea
 *     listeners en `document` o `window`
 *   - Listeners delegation cuando se pueda (sobreviven a re-renders)
 *   - Sin console.log de debug; sí console.error en catch legítimos
 *
 * Para activar este archivo: agregar `<script src=".../crm_kanban_v2.js">`
 * en `app/templates/crm/_scripts_main.html` después de crm_main.js.
 * Mientras esté vacío, no se carga en ningún template (sin overhead).
 * ═══════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';
    // (vacío por ahora — el primer feature nuevo aterriza aquí)
})();

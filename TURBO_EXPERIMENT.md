# Turbo Drive — Experimento (branch `turbo-experiment`)

**Fecha:** 2026-06-04
**Branch:** `turbo-experiment` (NO mergear a `pruebas` hasta validar)
**Estado:** infraestructura lista, validación pendiente

## TL;DR

Se preparó la infraestructura para usar **Turbo Drive 8.0.13** en modo
**opt-in conservador**. Por defecto Turbo está **desactivado globalmente**
— solo intercepta los `<a>` que llevan explícitamente `data-turbo="true"`.

Hoy solo un link tiene Turbo activo: el botón **"Calendario"** del sidebar.
Es la prueba mínima para validar que el sistema no se rompa.

**El experimento sirve para responder:** ¿podemos meter Turbo a este CRM sin
romper nada?  → si sí, en futuras sesiones activamos más links y se siente
la mejora real. Si no, descartamos sin haber invertido mucho.

---

## Qué se hizo

### 1. Vendorizar Turbo
- `app/static/vendor/turbo/turbo.es2017-umd.js` (209 KB, v8.0.13)
- Cargado desde `base.html` antes que cualquier otro script

### 2. Bootstrap (`app/static/js/turbo_bootstrap.js`)
- Desactiva Turbo Drive globalmente: `Turbo.session.drive = false`
- Expone `window.crmReady(fn)` — sustituto de `DOMContentLoaded` que
  también se dispara en cada `turbo:load`
- Limpia widgets/modales/toasts antes de cachear (evita verlos al volver
  con back-button)
- Loguea errores de fetch de Turbo

### 3. Marcado de elementos
- `data-turbo-permanent` en `#spotlight-modal` y `#ayuda-modal` (preservan
  estado entre navegaciones)
- `data-turbo-track="reload"` en `crm_main.js`, `crm_proyectos.js`,
  `programa_obra.js` (si el set de scripts cambia, Turbo hace full reload
  en lugar de intentar mantener estado JS — más seguro para archivos
  enormes no idempotentes)
- `data-turbo="false"` en el link de logout (siempre debe ser full nav)

### 4. Migración de inicializaciones a `crmReady()`
- `widget_stack.js` — usa crmReady si está disponible
- `widget_url_sync.js` — idem
- `base.js` (spotlight) — idem, con flag idempotente `_spotlightWired`
- `crm_main.js` (5 listeners) — **NO migrado** (ver "Limitaciones")

### 5. Activación de Turbo en un link
- `_sidebar.html` línea 79 y 195: botón "Calendario" lleva
  `data-turbo="true"`

---

## Cómo probar

1. Pull del branch en pruebas:
   ```bash
   git fetch && git checkout turbo-experiment
   docker compose -f docker-compose.pruebas.yml restart
   ```

2. Abrir el CRM en navegador. Abrir DevTools → Console y Network.

3. **Smoke test 1 — la página carga normal:**
   - Ningún error en consola
   - Todos los widgets siguen funcionando

4. **Smoke test 2 — navegación a calendario:**
   - Estando en `/app/home/?tab=crm`, click en el botón "Calendario"
   - Esperado: la URL cambia a `/app/home/?tab=calendario` SIN full
     reload (Network panel: una sola request HTML en lugar de re-cargar
     todos los assets)
   - El calendario debe pintar correctamente

5. **Smoke test 3 — back button funciona:**
   - Después de #4, click en back del navegador
   - Esperado: vuelve al CRM sin reload (Turbo cached navigation)

6. **Smoke test 4 — spotlight sobrevive navegación:**
   - Abrir spotlight con ⌘K, escribir algo, **NO** cerrar
   - Click en "Calendario" del sidebar
   - Esperado: el spotlight cierra solo (turbo:before-cache lo cierra)
   - Abrir spotlight de nuevo: debe seguir funcionando

---

## Limitaciones honestas

### El experimento es conservador a propósito
Solo **un** link tiene Turbo activo. Para realmente ver beneficio en TODA
la navegación se necesita:

1. Activar Turbo en más links (sidebar, topbar, dock).
2. Hacer que `crm_main.js` (5 listeners) y `crm_proyectos.js` sean
   **idempotentes** — sus listeners no deben duplicarse si se ejecutan
   más de una vez. Hoy ambos llevan `track="reload"`, que provoca full
   reload si el set de scripts cambia. Eso anula el beneficio de Turbo
   en algunas navegaciones.
3. Refactorizar la navegación entre tabs del CRM (CRM ↔ Tareas ↔
   Proyectos ↔ Compras) — hoy esos cambios disparan `window.location.href='?'`
   que es un **full reload**, independiente de Turbo. Para que sean
   fluidos hay que cambiar el sidebar a usar `history.pushState` + JS
   interno, o convertir los buttons en `<a data-turbo="true">`.

### Lo que NO se va a sentir con este experimento
La queja original del usuario fue **"al pasar de CRM a Dashboard se siente
lento"**. Si "Dashboard" es el tab `clientes` dentro del MISMO crm_home.html,
el problema NO es Turbo — es que el sidebar hace `window.location.href='?'`
para cambiar de tab. Eso es un full reload independiente.

**Solución alternativa más simple para ese problema específico:** cambiar
el sidebar para que la navegación entre tabs del CRM NO haga reload (usar
JS interno + pushState). Es un cambio chico y resuelve directamente la
queja. Turbo está pensado para navegación entre páginas REALMENTE distintas
(CRM ↔ Reportes).

---

## Decisión sugerida

1. **Probar los smoke tests** arriba. Si pasan todos, validamos que la
   infraestructura no rompe nada.
2. **Decidir el camino:**
   - Opción A: invertir 1-2 días más migrando `crm_main.js`/`crm_proyectos.js`
     a idempotente + activar Turbo en más links. Beneficio: navegación
     fluida entre TODAS las secciones.
   - Opción B: descartar Turbo y atacar el problema real con un cambio
     más pequeño (refactor del sidebar para pushState entre tabs).
     Beneficio: el problema concreto del usuario se resuelve sin
     introducir una librería más.
   - Opción C: dejar la infraestructura lista pero no avanzar más hoy.
     Volver cuando se tenga tiempo dedicado.

Mi recomendación honesta: **Opción B**. Turbo es excelente en sistemas
diseñados para él (Rails, Basecamp). En este sistema, refactorizar el
sidebar es 10× menos trabajo y resuelve directamente la queja del usuario.

---

## Para revertir el experimento (si se descarta)

```bash
git checkout pruebas
git branch -D turbo-experiment
```

Eso elimina toda la infraestructura sin tocar la rama de trabajo.

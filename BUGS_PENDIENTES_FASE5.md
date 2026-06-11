# Bugs preexistentes detectados — Pendientes para Fase 5 (Pulido por widget)

Lista viva de bugs/quirks visibles que se detectan durante el desarrollo
pero que NO están en el alcance de la fase actual. Cuando lleguemos a
Fase 5 (pulido por widget), atacar uno por uno.

Cada entrada con: **archivo:línea aproximada**, qué pasa, cómo
reproducir, propuesta de fix.

---

## 🔍 Spotlight — Apertura lenta de oportunidad fuera del CRM
**Detectado:** 2026-06-04
**Severidad:** Media (afecta UX diaria, no rompe nada)

**Síntoma:** Si abres Spotlight (⌘K) desde una sección que NO es CRM
(ej. Proyectos, Calendario, Reportes) y seleccionas una oportunidad,
el sistema:
1. Hace full reload a `/app/todos/?tab=crm&mes=todos&open_opp=N`
2. Cuando carga, el deep-link `?open_opp=N` abre el widget
3. Resultado: 1-2 segundos de espera + cambio de sección visible

El usuario espera comportamiento de "widget instantáneo" como cuando
ya estás en CRM.

**Causa:** `app/static/js/base.js:425-432`
```js
var enCRM = window.location.pathname === '/app/todos/';
if (r.type === 'oportunidad' && r.id) {
    var url = '/app/todos/?tab=crm&mes=todos&open_opp=' + r.id;
    if (newTab) { window.open(url, '_blank'); return; }
    if (enCRM && typeof window.openDetalle === 'function') { window.openDetalle(r.id); return; }
    window.location.href = url;  // ← este es el reload
    return;
}
```

**Propuesta de fix:**
Cuando NO estés en CRM, fetch el HTML de la oportunidad (que ya existe
como widget en `_widget_oportunidad.html`) y montarlo sobre la página
actual. O alternativamente, navegar Turbo-style (cuando Fase 3.C
active Turbo, esto puede ser parte de la solución).

Aplica también a otros tipos de resultado del Spotlight:
- Cotizaciones (línea 434)
- Tareas (línea 446)
- Clientes (línea 453)
- Proyectos (línea 464)

---

## 📂 Proyectos — Detalle "trabado" debajo de la lista
**Detectado:** 2026-06-04
**Severidad:** Media (visual molesto, pero el flujo principal funciona)

**Síntoma:** Al estar en sección Proyectos viendo la lista, el
widget de detalle de un proyecto anterior queda visible DEBAJO de
la lista (no se cerró correctamente).

**Reproducir:**
1. Ir a CRM
2. Abrir un proyecto vía Spotlight o link directo con `?open_proyecto=N`
3. Volver a la lista de proyectos (click en "Portafolio" o sidebar)
4. El widget de detalle aparece debajo de la lista en lugar de cerrarse

**Causa probable:** `app/static/js/crm_proyectos.js` —
`proyectosOpenFromUrl` se ejecuta al cargar y abre `widgetProyectoDetalle`,
pero no hay limpieza del widget cuando el usuario navega DENTRO de la
misma página vía JS interno (switchCrmView).

**Propuesta de fix:** En `switchCrmView('proyectos')` cerrar
`widgetProyectoDetalle` antes de mostrar la lista. O hacer que
`widgetProyectoDetalle` se posicione como overlay modal (z-index alto)
en lugar de inline en el flujo del DOM.

---

## 📧 Muro — 404 en imágenes de avatares antiguos
**Detectado:** 2026-06-04
**Severidad:** Baja (cosmético en pruebas; puede ser real en prod si
algún avatar/post se borró del volumen)

**Síntoma:** Console muestra 404 en `media/avatars/IMG_3756.jpeg` y
`media/muro/Imagen_2.jpeg`.

**Causa:** Posts del muro o usuarios apuntan a archivos que no existen
en el storage. En **pruebas** es esperado (el volumen externo de prod
con 9.9 GB no está en pruebas). En **producción** sería real si algún
admin borró archivos del filesystem sin limpiar la referencia en BD.

**Propuesta de fix:**
1. Verificar si las referencias rotas también existen en prod (probable
   que sí en algunos casos).
2. En `_widget_muro.html` y `_widget_perfil.html`, agregar fallback de
   imagen para src que devuelven 404 (con avatar placeholder o icono).
3. Job de mantenimiento: detectar referencias huérfanas en BD y
   limpiarlas o regenerarlas.

---

## 📧 Correo — Mixed Content + IPs HTTP hardcoded en emails antiguos
**Detectado:** 2026-06-04
**Severidad:** Baja (no rompe funcionalidad, solo warnings)

**Síntoma:** Al abrir un email antiguo en el widget Correo:
- Mixed Content warning: el iframe HTTPS intenta cargar imágenes desde
  `http://77.237.237.248:8765/email-assets/...` (HTTP)
- "Blocked script execution in 'about:srcdoc'" — esto es CORRECTO,
  el sandbox bloquea scripts dentro de emails (anti-XSS)

**Causa:** Templates de email enviados hace tiempo tienen URLs HTTP
hardcoded (cuando el server estaba en HTTP). Esos emails no se pueden
editar — están como se enviaron.

**Propuesta de fix:**
- Para EMAILS NUEVOS: cambiar templates a usar HTTPS o paths relativos.
  Ver `crm_mail.js` y los templates de email correspondientes.
- Para emails antiguos: nada que hacer; el sandbox impide problemas.

El "Blocked script execution" NO es bug — es el comportamiento correcto
del sandbox (`<iframe sandbox>`) y proteje al usuario de XSS.

---

---

## 🏷️ Breadcrumb del widget stack muestra "Calendario Master" como capa
**Detectado:** 2026-06-04 (durante validación Fase 3.C)
**Severidad:** Baja (visual molesto, no rompe funcionalidad)

**Síntoma:** Al abrir un widget (ej. Notificaciones) desde el tab
Calendario, el breadcrumb superior dice:
  `Calendario Master › Notificaciones`

"Calendario Master" no es un nombre amigable y aparece aunque el
calendario sea la página de fondo, no un widget modal real.

**Causa:** `widget_stack.js` detecta `#widgetCalendarioMaster` (que
en modo page-mode tiene `display:flex`) como widget visible y lo
incluye en el stack. El breadcrumb lee el id del elemento.

**Propuesta de fix:**
- Agregar `data-stack-ignore="true"` a `#widgetCalendarioMaster` cuando
  esté en modo page-mode (para que el stack manager lo ignore), o
- Agregar `data-stack-label="Calendario"` para que el breadcrumb use
  un nombre amigable cuando sí aparezca.

---

## 📌 Convención de esta lista

- Agregar nuevos bugs **al final** con fecha de detección.
- Cuando se ataque uno en Fase 5, **marcarlo como hecho con commit**
  y mover a una sección "RESUELTOS" al final del archivo.
- NO atacar estos bugs fuera de Fase 5 a menos que sean críticos
  (afecten datos o seguridad).

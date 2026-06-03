# Plan de Hardening del CRM

> **Misión:** terminar de construir bien lo que ya existe. Pausa de features
> nuevas. Foco en estabilidad, UX consistente, código limpio y servidor sano.
>
> **Razón:** el sistema nació como cotizador y creció sin planeación a CRM
> completo. Hay deuda técnica acumulada en 3 frentes: producto, código,
> infraestructura.

---

## Principios

Estos aplican a TODO el hardening — son la vara para decir "esto sí, esto no":

1. **Pausa de features nuevas.** Mientras dure este plan, NO se construyen
   módulos nuevos. Solo se arregla, se completa, se optimiza.
2. **El sistema se debe sentir profesional, no "de juguete".** Tipografía
   consistente, paleta limitada, espaciados sistemáticos.
3. **Carga pesada real sin fatiga del usuario.** Que aguante un día completo
   de trabajo intensivo sin que se sienta lento ni inconsistente.
4. **Actualizaciones en tiempo real.** Después de cada acción, el resultado
   se ve sin recargar la página.
5. **Confianza en los contratos.** Si una notificación dice "X", al hacer
   click sucede X. Si un botón dice "Guardar", lo guarda. Cero "click sin
   respuesta".
6. **Una sola fuente de verdad.** Si dos lugares muestran el mismo dato,
   ambos se actualizan al mismo tiempo.

---

## Fases (orden propuesto)

### FASE 1 — Sistema de Widgets (cimiento)
**Por qué primero:** todo el resto se construye encima de los widgets. Si
fallan, fallan todos los demás flujos.

**Inventario real (2026-06-03):** 36 widgets activos en el sistema.

**Hallazgos críticos del mapeo:**
- **8 widgets comparten `z-index: 10100`** (Detalle, Mail, Muro, Negociación,
  Calendario, Cotizador, CotizarRapido, ClienteProspectos). El orden de
  apilamiento depende del DOM render → causa los bugs "se abre detrás".
- **13 valores únicos de z-index** dispersos sin sistema: 10100, 10200,
  10300, 10310, 10350, 10400, 10450, 10500, 10550, 10800, 11200, 11500,
  99990. Imposible mantener.
- **Un widget en z-index 99990** (woOppCrearActividad) — clásica "fix
  rápida" sin sistema.
- **5 widgets sin toast funcional**: Notificaciones, CertDetalle,
  CursoDetalle, EventoDetalle, ClienteProspectos. Si guardas ahí no hay
  confirmación.
- **3 funciones toast() distintas** en el código (la global `widgetToast`,
  una local en `widgetAvanceEtapa`, otras en Compras y Reportes).
- **Patrones inconsistentes de abrir/cerrar**: unos usan `display:none`,
  otros `classList.add('open')`. Sin abstracción central.

**Problemas conocidos (síntomas que ve el usuario):**
- [ ] Widgets se abren detrás de otros widgets.
- [ ] Toasts de éxito ("✓ guardado") se ven detrás de los widgets.
- [ ] Página se traba al abrir varios widgets.
- [ ] Actualizaciones no se reflejan en tiempo real — usuario recarga.
- [ ] Falta animaciones consistentes (algunos slide, otros fade, otros nada).

**Diseño propuesto del sistema (a validar antes de aplicar):**

  Capas oficiales de z-index (tokens):
  ```
  --z-base:        0       (contenido normal)
  --z-sidebar:     100
  --z-header:      200
  --z-tooltip:     500
  --z-widget:      1000    (modales/overlays de primer nivel)
  --z-widget-sub:  2000    (modales abiertos DESDE un widget)
  --z-widget-3:    3000    (tercer nivel: confirmaciones sobre subs)
  --z-toast:       9000    (toasts SIEMPRE arriba de cualquier widget)
  --z-tooltip-top: 9500    (tooltips críticos)
  ```
  Cualquier widget DEBE usar uno de estos tokens, no inventar un número.

  Helper toast() global:
  - Una sola función `window.toast(msg, type)` en `crm_main.js`.
  - Z-index `--z-toast` (9000), nunca detrás de un widget.
  - Las funciones locales (`Compras`, `Reportes`, `widgetAvanceEtapa`) se
    refactorizan para llamar al global.

  Patrón "después de acción → refresh":
  - Un widget que modifica algo emite un evento `crm:data-changed`.
  - Componentes que muestran ese dato escuchan y se refrescan sin reload.

  API uniforme de widgets:
  - `widgetOpen(id, opts)` / `widgetClose(id)` global, opcional.
  - Animación standard: 200ms fade overlay + 280ms slide del card.
  - Cierre con Escape SIEMPRE.

**Entregables Fase 1 (incluye los 3 puntos premium):**

  *Cimiento básico*
- [ ] **1.A** CSS con tokens `--z-widget` / `--z-widget-sub` / `--z-widget-3` / `--z-toast` aplicados al `<body>` y `.widget-overlay`.
- [ ] **1.B** Reasignar los 36 widgets al token que les corresponde según su rol (nivel 1, 2 o 3).
- [x] **1.C** Helper global `window.toast(msg, type, ttl)` + atajos `.success/.error/.info`. Vive en `widget_toast.js`, cargado antes de `crm_main.js`.
- [x] **1.D** `showToast()` local de `crm_main.js` ahora delega al global. Las funciones toast locales de archivos viejos (compras, reportes, marketing) quedan intactas (no romper) — el global está disponible si las llaman.
- [ ] **1.E** Cobertura por widget → se hace en Fase 5 (pulido por flujo). Los 5 widgets sin toast (Notificaciones, CertDetalle, CursoDetalle, EventoDetalle, ClienteProspectos) reciben llamadas a `window.toast()` cuando se trabaje cada uno individualmente.
- [ ] **1.F** Animación standard: 200ms fade overlay + 280ms slide del card. Aplicada a todos.

  *Premium — lo que diferencia "funcional" de "nivel Notion/Linear"*
- [x] **1.G** Patrón `crm:data-changed` event system (`widget_data_bus.js`). Bus de eventos global con wrapper de fetch que auto-emite. Consumidores conectados con debounce: kanban opps, lista de tareas, calendario, Programa de Obra.
- [x] **1.H** Breadcrumb visual en widgets de nivel 2 y 3. Chip flotante "Padre › Hijo" arriba del centro. Click en padre cierra todos los hijos.
- [x] **1.I** Escape consistente: cierra solo el widget de top del stack. Respeta foco en inputs (deja el Esc nativo del input primero). Capture:true para correr antes que listeners locales.
- [x] **1.J** URL syncing: helper `crmWidgetUrl.set/clear/read`. Bootstrap automático con `?open_opp=N` (widgetDetalle) y `?open_proyecto=N` (existente). Más widgets reciben URL sync en Fase 5.

  *Validación*
- [ ] **1.K** Smoke test manual del flujo más usado (kanban → opp → tarea → cotizar → cerrar todo). TÚ.
- [ ] **1.L** Smoke test del peor caso anidado (opp → tarea → confirmar eliminar → toast verde encima). TÚ.

---

### FASE 2 — Notificaciones (confianza)
**Por qué después:** el problema no es UX, es contrato roto. Hay que
reconstruir confianza antes de pulir.

**Auditoría real (2026-06-03):** 3 capas rotas:

1. **Creación silenciosa de fallos:**
   - `views_utils.py:672` — helper `crear_notificacion()` con
     try/except + `print()`, sin logger.
   - `views_api.py:437-438` — try/except genérico en disparadores
     de vencimientos.
   - `views_proyectos.py:655`, `views_grupos.py:392` — try/except
     `pass` sin log.

2. **Routing roto — 22 de 25 tipos sin mapeo explícito** en el JS del
   widget (`_widget_notificaciones.html:1192-1241`). Tipos huérfanos:
   `tarea_asignada`, `rendimiento_bajo`, `solicitud_cambio_perfil`,
   `prospecto_asignado`, `certificacion_por_vencer`,
   `certificacion_vencida`, `sistema`, y otros que caen al fallback
   `openDetalle(oppId)` que falla cuando no hay `oppId`.
   - `models.py:1750` — `Notificacion.get_url()` solo cubre 3 tipos.

3. **Polling agresivo + race conditions:**
   - Cada 3s (`_pollForToasts` línea 1361 del widget).
   - 50 notificaciones cargadas cada vez (`views_api.py:445`).
   - **Vencimientos re-calculados en CADA poll** (`views_api.py:397-435`)
     con `.exists()` + `.create()` sin transacción → genera duplicados.

**Entregables Fase 2:**

  *Routing (lo más visible)*
- [ ] **2.A** Mapeo completo Tipo → Acción en JS. Tabla declarativa
  con handler explícito por cada uno de los 25 tipos. Fallback genérico
  que avise al usuario en vez de fallar silencioso.
- [ ] **2.B** `Notificacion.get_url()` en el modelo: cubrir los 25 tipos
  con su URL fallback (para deep-links que no usan JS).

  *Creación confiable*
- [ ] **2.C** Logger estructurado en `crear_notificacion()`. Reemplazar
  `print()` por `logger.exception()`. Sin try/except `pass` en ningún
  disparador.
- [ ] **2.D** Auditar todos los disparadores y agregar log estructurado:
  `logger.info('[notif] %s → user=%s tipo=%s', razon, user, tipo)`.

  *Polling sano*
- [ ] **2.E** Bajar polling a 8s con back-off (como historial de tareas).
  Refresh inmediato cuando el data bus emite eventos relevantes.
- [ ] **2.F** Mover re-cálculo de vencimientos a un comando de gestión
  (`python manage.py procesar_vencimientos`) corrido por cron cada 5min.
  El endpoint de polling solo LEE notificaciones existentes.

  *UX*
- [ ] **2.G** Textos accionables con contexto ("X reabrió la tarea Y
  porque Z" en vez de "Tarea reabierta").
- [ ] **2.H** Si una notificación click no encuentra destino, mostrar
  toast "Sin destino disponible" en vez de no hacer nada.

---

### FASE 3 — Búsqueda (refinamiento visible)
**Por qué tercero:** visible pero no bloqueante. Es el momentum-closer.

**Problemas conocidos:**
- [ ] Diseño y funcionamiento no intuitivo.
- [ ] Lenta al abrir resultados (¿>1s perceptible?).
- [ ] No es fácil entender qué se puede buscar.

**Entregables:**
- [ ] **Auditoría de performance del endpoint de búsqueda** (¿qué tarda?).
- [ ] **Índices DB** donde falten para las queries de búsqueda.
- [ ] **Rediseño UX**: input prominente, resultados agrupados por tipo
  (Cliente, Oportunidad, Tarea, etc.), atajos de teclado.
- [ ] **Autocompletado con debounce + abort de requests anteriores.**

---

### FASE 4 — Design System & UX consistente (paralelo / continuo)
**Cuándo:** se hace en paralelo, no como sprint aislado. Cada vez que se
toca una pantalla, se aplica.

**Áreas:**
- [ ] Tipografía: 3-4 tamaños fijos (no decenas ad-hoc).
- [ ] Paleta limitada (azul corporativo, grises, semáforo).
- [ ] Espaciados sistemáticos (4, 8, 12, 16, 24, 32px).
- [ ] Componentes reusables (botones, inputs, cards, pills) con clases
  estables.
- [ ] Eliminar inline styles donde sean ruidosos.

---

### FASE 5 — Pequeños bugs y flujos incompletos del CRM
Lista de inventario que vamos poblando juntos:

| # | Área | Problema | Prioridad | Estado |
|---|------|----------|-----------|--------|
| 1 | (pendiente recorrido) | — | — | — |

---

### FASE 6 — Refactor de código y arquitectura
Sólo después de que el CRM esté estable.

**Áreas conocidas:**
- [ ] `crm_main.js` es enorme — dividir por responsabilidades.
- [ ] `views_proyectos.py` es enorme — separar por dominio.
- [ ] Endpoints duplicados (`/api/proyectos/` legacy vs `/api/iamet/proyectos/` moderno).
- [ ] Modelos paralelos sin sync (`Proyecto` vs `ProyectoIAMET`,
  `Tarea` vs `TareaOportunidad`).
- [ ] Tests automáticos (smoke tests al menos) ANTES del refactor pesado.

---

### FASE 7 — Servidor (SSH al final)
**Cuando llegue su turno**, conexión SSH y revisamos juntos:

- [ ] Disco / memoria / CPU del servidor en uso real.
- [ ] Backups: ¿corren?, ¿se restauran?, ¿hace cuánto?
- [ ] Logs: ¿hay errores recurrentes silenciosos?
- [ ] Queries lentas (slow query log de MySQL).
- [ ] Worker count de gunicorn vs carga real.
- [ ] Nginx tuning (cache, gzip, headers).
- [ ] Monitoreo (Sentry / similar) si vale la pena instalarlo.

**Diagnóstico rápido recomendado AHORA** (30 min): descartar cosas
críticas urgentes antes de meses de trabajo de las otras fases.

---

## Reglas de proceso

1. **No agregar a este documento sin discutirlo.** Sino crece sin control.
2. **Cada ítem se marca completo (✓) cuando está en producción**, no en
   pruebas.
3. **Si un fix abre 3 hallazgos nuevos**, los anotamos pero NO los
   atacamos hasta cerrar el actual.
4. **Antes de un refactor**: hay tests. Aunque sean básicos.
5. **Honestidad**: si algo se ve mal en pantalla, se anota aunque parezca
   "pequeño". Pequeño hoy = grietón mañana.

---

### FASE 8 — Multi-window / Workspace mode (post-hardening)
**Estado:** parqueada. NO se trabaja hasta cerrar Fases 1-7.

**Idea original (sugerencia del usuario, 2026-06-03):**
Sistema tipo Windows donde el usuario pueda tener varios widgets
abiertos en paralelo (2-4 opps lado a lado), redimensionables y
movibles. Comparar entidades, workflows de power-user.

**Por qué se parqueó:**
- Va contra la regla #1 del plan ("pausa de features nuevas").
- Reescribe el stack manager, breadcrumb, Esc, URL sync — todo el
  trabajo de Fase 1 que acabamos de cerrar.
- Costo estimado: 2-3 semanas. Esas semanas se gastan en Notificaciones,
  Búsqueda y Servidor (más impacto inmediato según el usuario).
- Imposible en mobile.
- Uso real probablemente no lo justifica todavía (no hay pedido formal
  de usuarios — es intuición de power-user).

**Cuando se retome, considerar:**
- Empezar con un MVP de "modo comparación" — 2 widgets lado a lado
  hardcoded, sin drag ni resize. ~2 días de trabajo.
- Si después el feedback muestra que el equipo lo usa de verdad,
  evolucionar a multi-window real con drag/resize/snap-to-edges.
- Re-evaluar el data bus para refresh granular por id, no por entidad
  (si tienes 2 instancias de la opp A abiertas, refresh debe actualizar
  ambas).

---

## Histórico

- **2026-06-03**: documento creado. Punto de partida.
  Fase 1 (Sistema de Widgets) completa: tokens z-index, stack manager
  dinámico, toast global, event bus + auto-refresh, breadcrumb anidado,
  Esc consistente, URL syncing.
  Idea de multi-window parqueada para Fase 8.

/* ═══════════════════════════════════════════════════════════════════
   CRM Data Bus — Hardening Fase 1.G

   Resuelve la queja crítica del usuario: "cuando hago un cambio en
   un widget, las listas en background no se actualizan — tengo que
   recargar la página".

   Patrón estándar de event-driven UI: cualquier acción que modifica
   datos en el servidor emite un evento global. Las listas / vistas /
   contadores que muestran esos datos se SUSCRIBEN al evento y se
   refrescan automáticamente.

   ── API pública ──────────────────────────────────────────────────

   Emitir (después de guardar/editar/borrar algo):
     crmDataBus.emit(entidad, accion, id, extra)
     Ej.: crmDataBus.emit('oportunidad', 'update', 123)
          crmDataBus.emit('tarea', 'delete', 456)
          crmDataBus.emit('instalacion', 'create', 789, { proyecto_id: 30 })

   Suscribirse (listas que muestran esa entidad):
     crmDataBus.on('oportunidad', function(detail) { ... })
     crmDataBus.on(null, function(detail) { ... })  // cualquier entidad

   ── Auto-emit por fetch wrapper ──────────────────────────────────

   Wrapper global de window.fetch que detecta llamadas modificadoras
   (POST/PUT/PATCH/DELETE) a /api/<entidad>/<id> y emite el evento
   automáticamente. Cubre la MAYORÍA de cambios sin tener que tocar
   cada función del frontend.

   Para los casos donde la URL no es estándar, se usa crmDataBus.emit()
   manual desde el código del widget.

   ── Entidades canónicas ──────────────────────────────────────────

   oportunidad, tarea, tarea-opp, prospecto, idea, proyecto,
   instalacion, notificacion, cotizacion, actividad, evento, curso,
   certificacion, cliente, contacto, comentario.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var EVT_NAME = 'crm:data-changed';

    // Lista canónica de entidades + su segmento de URL en /api/.
    // El primer match en la URL del fetch determina la entidad emitida.
    // Orden importante: los más específicos primero (tarea-opp antes de tarea).
    var ENTITY_PATTERNS = [
        { regex: /\/api\/tarea-opp\/(\d+)/, entidad: 'tarea-opp' },
        { regex: /\/api\/tarea\/(\d+)/, entidad: 'tarea' },
        { regex: /\/api\/instalacion\/(\d+)/, entidad: 'instalacion' },
        { regex: /\/api\/proyecto\/(\d+)\/instalaciones/, entidad: 'instalacion' },
        { regex: /\/api\/proyecto\/(\d+)/, entidad: 'proyecto' },
        { regex: /\/api\/iamet\/proyectos\/(\d+)/, entidad: 'proyecto' },
        { regex: /\/api\/oportunidad\/(\d+)/, entidad: 'oportunidad' },
        { regex: /\/api\/prospecto\/(\d+)/, entidad: 'prospecto' },
        { regex: /\/api\/idea\/(\d+)/, entidad: 'idea' },
        { regex: /\/api\/cotizacion\/(\d+)/, entidad: 'cotizacion' },
        { regex: /\/api\/cotizaciones\/(\d+)/, entidad: 'cotizacion' },
        { regex: /\/api\/actividad\/(\d+)/, entidad: 'actividad' },
        { regex: /\/api\/actividades\/(\d+)/, entidad: 'actividad' },
        { regex: /\/api\/notificaciones?\/(\d+)/, entidad: 'notificacion' },
        { regex: /\/api\/evento\/(\d+)/, entidad: 'evento' },
        { regex: /\/api\/curso\/(\d+)/, entidad: 'curso' },
        { regex: /\/api\/certificacion\/(\d+)/, entidad: 'certificacion' },
        { regex: /\/api\/cliente\/(\d+)/, entidad: 'cliente' },
        { regex: /\/api\/contacto\/(\d+)/, entidad: 'contacto' },
        { regex: /\/api\/comentario\/(\d+)/, entidad: 'comentario' },
        // Plurales (lista o create sin id):
        { regex: /\/api\/oportunidades\/?(?:\?|$)/, entidad: 'oportunidad' },
        { regex: /\/api\/tareas\/?(?:\?|$)/, entidad: 'tarea' },
        { regex: /\/api\/prospectos\/?(?:\?|$)/, entidad: 'prospecto' },
        { regex: /\/api\/ideas\/?(?:\?|$)/, entidad: 'idea' },
    ];

    // Excluir endpoints que NO son acciones de modificación de datos
    // (aunque sean POST/PUT) — historial, exportar, búsqueda con POST, etc.
    var IGNORE_PATTERNS = [
        /\/historial\//,
        /\/export/,
        /\/buscar/,
        /\/upload/,
    ];

    function detectEntity(url) {
        if (!url) return null;
        for (var i = 0; i < IGNORE_PATTERNS.length; i++) {
            if (IGNORE_PATTERNS[i].test(url)) return null;
        }
        for (var j = 0; j < ENTITY_PATTERNS.length; j++) {
            var m = url.match(ENTITY_PATTERNS[j].regex);
            if (m) {
                return { entidad: ENTITY_PATTERNS[j].entidad, id: m[1] ? parseInt(m[1], 10) : null };
            }
        }
        return null;
    }

    function methodToAction(method) {
        switch ((method || 'GET').toUpperCase()) {
            case 'POST':   return 'create';   // o 'update' si tiene id — el subscriptor lo discrimina si quiere
            case 'PUT':    return 'update';
            case 'PATCH':  return 'update';
            case 'DELETE': return 'delete';
            default: return null;
        }
    }

    // ── API pública ──
    window.crmDataBus = {
        emit: function (entidad, accion, id, extra) {
            if (!entidad) return;
            try {
                document.dispatchEvent(new CustomEvent(EVT_NAME, {
                    detail: {
                        entidad: entidad,
                        accion: accion || 'update',
                        id: id != null ? id : null,
                        extra: extra || null,
                        ts: Date.now(),
                    },
                }));
            } catch (e) {
                console.warn('[crmDataBus] no se pudo emitir:', e);
            }
        },
        on: function (entidad, callback) {
            if (typeof callback !== 'function') return function () {};
            var handler = function (e) {
                if (entidad == null || e.detail.entidad === entidad) {
                    try { callback(e.detail); } catch (err) { console.error('[crmDataBus] listener error:', err); }
                }
            };
            document.addEventListener(EVT_NAME, handler);
            return function unsubscribe() {
                document.removeEventListener(EVT_NAME, handler);
            };
        },
        // Util para debug
        EVT_NAME: EVT_NAME,
    };

    // ── Auto-emit via fetch wrapper ──
    // Si ya hay un wrapper anterior (ej. del historial), respetarlo.
    if (!window._crmFetchWrappedForBus) {
        window._crmFetchWrappedForBus = true;
        var _origFetch = window.fetch;
        window.fetch = function (input, init) {
            var url = (typeof input === 'string') ? input : (input && input.url) || '';
            var method = (init && init.method) ||
                         (typeof input !== 'string' && input && input.method) || 'GET';
            var p = _origFetch.apply(this, arguments);

            try {
                if (/^(POST|PUT|PATCH|DELETE)$/i.test(method)) {
                    var info = detectEntity(url);
                    if (info) {
                        p.then(function (resp) {
                            if (resp && resp.ok) {
                                window.crmDataBus.emit(
                                    info.entidad,
                                    methodToAction(method),
                                    info.id
                                );
                            }
                        }).catch(function () { /* noop */ });
                    }
                }
            } catch (e) { /* no romper fetch por error en logging */ }

            return p;
        };
    }

    // ── Debug en consola ──
    // crmDataBus.on(null, function(d){ console.log('[bus]', d); }) en consola.

    // ──────────────────────────────────────────────────────────────
    // Consumidores auto-conectados (debounced)
    //
    // Listas/vistas que se refrescan al detectar cambios. Con debounce
    // de 500ms para que si se hacen varios cambios rápidos (típico al
    // cuadrar una opp con 3-4 ediciones) solo se haga UN refresh al final.
    //
    // Cada listener verifica que la función exista antes de llamarla —
    // así si el código del CRM evoluciona y renombra la función, este
    // archivo no se rompe (solo deja de refrescar y se nota en testing).
    // ──────────────────────────────────────────────────────────────
    var debounceTimers = {};
    function debounce(key, fn, ms) {
        clearTimeout(debounceTimers[key]);
        debounceTimers[key] = setTimeout(fn, ms || 500);
    }

    // Kanban / lista de oportunidades.
    window.crmDataBus.on('oportunidad', function () {
        debounce('opps', function () {
            if (typeof window.refreshCrmTable === 'function') {
                window.refreshCrmTable();
            }
        });
    });

    // Lista de tareas (sidebar Tareas).
    window.crmDataBus.on('tarea', function () {
        debounce('tareas', function () {
            if (typeof window.recargarTareasCRM === 'function') {
                window.recargarTareasCRM();
            }
        });
    });
    window.crmDataBus.on('tarea-opp', function () {
        debounce('tareas', function () {
            if (typeof window.recargarTareasCRM === 'function') {
                window.recargarTareasCRM();
            }
        });
    });

    // Calendario (actividades, tareas, instalaciones — todas se ven ahí).
    function refreshCalendario() {
        if (typeof window.calGlobalRefetch === 'function') {
            var sel = document.getElementById('calUserFilter');
            window.calGlobalRefetch(sel ? sel.value : 'all');
        }
    }
    window.crmDataBus.on('actividad', function () { debounce('cal', refreshCalendario); });
    window.crmDataBus.on('tarea', function () { debounce('cal', refreshCalendario); });
    window.crmDataBus.on('tarea-opp', function () { debounce('cal', refreshCalendario); });
    window.crmDataBus.on('instalacion', function () { debounce('cal', refreshCalendario); });

    // Programa de Obra (tab dentro de Proyecto).
    window.crmDataBus.on('instalacion', function () {
        debounce('pob', function () {
            if (typeof window.pobCargarLista === 'function') {
                window.pobCargarLista();
            }
        });
    });
})();

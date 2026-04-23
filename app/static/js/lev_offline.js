/* ══════════════════════════════════════════════════════════════════
 *  PWA Levantamientos IAMET — Módulo Offline (Fase C)
 *  ──────────────────────────────────────────────────────────────────
 *  Intercepta fetch() del wizard cuando no hay red y persiste los
 *  levantamientos en IndexedDB. Al recuperar conexión, drena la cola
 *  contra el endpoint /api/iamet/levantamientos/offline-sync/.
 *
 *  Expone window.levOffline con: { syncAll, getPendingCount,
 *  clearSynced, onStateChange }.
 *
 *  Este archivo debe cargarse ANTES de crm_proyectos.js y
 *  crm_levantamiento.js para poder envolver window.fetch.
 *  ══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ─── Config ────────────────────────────────────────────────────
    var DB_NAME = 'iamet_lev_offline';
    var DB_VERSION = 1;
    var OFFLINE_PREFIX = 'offline:';
    var SYNC_URL = '/app/api/iamet/levantamientos/offline-sync/';

    var API = {
        // POST /app/api/iamet/proyectos/<id>/levantamientos/crear/
        CREATE:    /^\/app\/api\/iamet\/proyectos\/(\d+)\/levantamientos\/crear\/?$/,
        // POST /app/api/iamet/levantamientos/<id>/actualizar/
        UPDATE:    /^\/app\/api\/iamet\/levantamientos\/([^/]+)\/actualizar\/?$/,
        // POST /app/api/iamet/levantamientos/<id>/fase/
        FASE:      /^\/app\/api\/iamet\/levantamientos\/([^/]+)\/fase\/?$/,
        // POST /app/api/iamet/levantamientos/<id>/evidencia/
        EVIDENCIA: /^\/app\/api\/iamet\/levantamientos\/([^/]+)\/evidencia\/?$/,
        // POST /app/api/iamet/levantamientos/<id>/eliminar/
        ELIMINAR:  /^\/app\/api\/iamet\/levantamientos\/([^/]+)\/eliminar\/?$/,
        // GET  /app/api/iamet/levantamientos/<id>/
        DETALLE:   /^\/app\/api\/iamet\/levantamientos\/([^/]+)\/?$/,
        // GET  /app/api/iamet/proyectos/<id>/levantamientos/
        LEV_LIST:  /^\/app\/api\/iamet\/proyectos\/(\d+)\/levantamientos\/?$/,
    };

    // ─── Utilidades ────────────────────────────────────────────────
    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    function now() { return new Date().toISOString(); }
    function log() { try { console.log.apply(console, ['[levOffline]'].concat([].slice.call(arguments))); } catch (e) {} }
    function warn() { try { console.warn.apply(console, ['[levOffline]'].concat([].slice.call(arguments))); } catch (e) {} }

    function synthResponse(obj, status) {
        return new Response(JSON.stringify(obj), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    function getCsrf() {
        var el = document.querySelector('[name=csrfmiddlewaretoken]');
        return el ? el.value : '';
    }

    // ─── IndexedDB ─────────────────────────────────────────────────
    var _dbPromise = null;
    function openDB() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('drafts')) {
                    var s = db.createObjectStore('drafts', { keyPath: 'client_key' });
                    s.createIndex('proyecto_id', 'proyecto_id');
                    s.createIndex('sync_state', 'sync_state');
                }
                if (!db.objectStoreNames.contains('evidencias')) {
                    var e2 = db.createObjectStore('evidencias', { keyPath: 'client_key' });
                    e2.createIndex('draft_key', 'draft_key');
                    e2.createIndex('sync_state', 'sync_state');
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
        return _dbPromise;
    }
    function tx(store, mode) {
        return openDB().then(function (db) {
            return db.transaction(store, mode || 'readonly').objectStore(store);
        });
    }
    function req2promise(r) {
        return new Promise(function (resolve, reject) {
            r.onsuccess = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
        });
    }

    // ─── Data access ───────────────────────────────────────────────
    var Drafts = {
        put: function (d) {
            d.modified_at = now();
            return tx('drafts', 'readwrite').then(function (s) { return req2promise(s.put(d)); });
        },
        get: function (k) {
            return tx('drafts').then(function (s) { return req2promise(s.get(k)); });
        },
        getAll: function () {
            return tx('drafts').then(function (s) { return req2promise(s.getAll()); });
        },
        del: function (k) {
            return tx('drafts', 'readwrite').then(function (s) { return req2promise(s.delete(k)); });
        },
        pending: function () {
            return Drafts.getAll().then(function (arr) {
                return arr.filter(function (d) {
                    return d.sync_state === 'pending' || d.sync_state === 'error';
                });
            });
        },
    };
    var Evidencias = {
        put: function (e) {
            e.modified_at = now();
            return tx('evidencias', 'readwrite').then(function (s) { return req2promise(s.put(e)); });
        },
        byDraft: function (dk) {
            return tx('evidencias').then(function (s) {
                var idx = s.index('draft_key');
                return req2promise(idx.getAll(dk));
            });
        },
        del: function (k) {
            return tx('evidencias', 'readwrite').then(function (s) { return req2promise(s.delete(k)); });
        },
    };

    // ─── Compresión de fotos ───────────────────────────────────────
    // Reduce una imagen a máximo 1600px en el lado mayor, JPEG q=0.82.
    // Una foto típica de 4MB del iPhone baja a ~350-500KB.
    function compressImage(file, maxSide, quality) {
        maxSide = maxSide || 1600;
        quality = quality || 0.82;
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () {
                var w = img.naturalWidth, h = img.naturalHeight;
                var scale = Math.min(1, maxSide / Math.max(w, h));
                var tw = Math.round(w * scale), th = Math.round(h * scale);
                var cv = document.createElement('canvas');
                cv.width = tw; cv.height = th;
                var ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0, tw, th);
                cv.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('toBlob failed'));
                }, 'image/jpeg', quality);
            };
            img.onerror = function () { reject(new Error('image load failed')); };
            img.src = URL.createObjectURL(file);
        });
    }

    // ─── Helpers: shape de respuesta sintética ─────────────────────
    // El wizard espera objetos con la estructura de _lev_to_dict y
    // _evidencia_to_dict. Construimos equivalentes offline.
    function draftToLevDict(d) {
        return {
            id: d.client_key,               // PREFIJO 'offline:' incluido
            proyecto_id: d.proyecto_id,
            proyecto_nombre: d.proyecto_nombre || '',
            nombre: d.nombre || '',
            status: d.status || 'borrador',
            status_label: 'Borrador (offline)',
            fase_actual: d.fase_actual || 1,
            fase1_data: d.fase1_data || {},
            fase2_data: d.fase2_data || {},
            fase3_data: d.fase3_data || {},
            fase4_data: d.fase4_data || {},
            fase5_data: d.fase5_data || {},
            creado_por_id: null,
            creado_por_nombre: 'Tú (offline)',
            fecha_creacion: d.created_at,
            fecha_actualizacion: d.modified_at,
            _offline: true,
        };
    }
    function evidenciaToDict(e) {
        // Usamos una object-URL del blob para que el wizard pueda previsualizarla.
        var url = e.blob ? URL.createObjectURL(e.blob) : null;
        return {
            id: e.client_key,
            url: url,
            nombre_original: e.nombre_original || '',
            comentario: e.comentario || '',
            producto_idx: e.producto_idx,
            subido_por_id: null,
            subido_por_nombre: 'Tú (offline)',
            fecha_subida: e.created_at,
            _offline: true,
        };
    }

    // ─── Handlers por endpoint ─────────────────────────────────────
    function handleCreate(proyectoId, body) {
        var d = {
            client_key: OFFLINE_PREFIX + uuid(),
            proyecto_id: Number(proyectoId),
            nombre: (body && body.nombre) || '',
            status: (body && body.status) || 'borrador',
            fase_actual: (body && body.fase_actual) || 1,
            fase1_data: (body && body.fase1_data) || {},
            fase2_data: (body && body.fase2_data) || {},
            fase3_data: (body && body.fase3_data) || {},
            fase4_data: (body && body.fase4_data) || {},
            fase5_data: (body && body.fase5_data) || {},
            sync_state: 'pending',
            created_at: now(),
        };
        return Drafts.put(d).then(function () {
            updateBadge();
            return synthResponse({ success: true, data: draftToLevDict(d) });
        });
    }

    function handleUpdate(clientKey, body) {
        return Drafts.get(clientKey).then(function (d) {
            if (!d) return synthResponse({ success: false, error: 'Draft no encontrado' }, 404);
            if (body.nombre != null) d.nombre = String(body.nombre || '').trim();
            if (body.status != null) d.status = body.status;
            if (body.fase_actual != null) {
                var f = parseInt(body.fase_actual, 10);
                if (f >= 1 && f <= 5) d.fase_actual = f;
            }
            ['fase1_data', 'fase2_data', 'fase3_data', 'fase4_data', 'fase5_data'].forEach(function (k) {
                if (body[k] && typeof body[k] === 'object') d[k] = body[k];
            });
            if (d.sync_state === 'done') d.sync_state = 'pending';
            return Drafts.put(d).then(function () {
                updateBadge();
                return synthResponse({ success: true, data: draftToLevDict(d) });
            });
        });
    }

    function handleFase(clientKey, body) {
        return Drafts.get(clientKey).then(function (d) {
            if (!d) return synthResponse({ success: false, error: 'Draft no encontrado' }, 404);
            var fase = parseInt(body.fase, 10);
            if (fase < 1 || fase > 5) return synthResponse({ success: false, error: 'Fase inválida' }, 400);
            if (body.data && typeof body.data === 'object') {
                d['fase' + fase + '_data'] = body.data;
            }
            if (body.fase_actual != null) {
                var f = parseInt(body.fase_actual, 10);
                if (f >= 1 && f <= 5) d.fase_actual = f;
            }
            if (d.sync_state === 'done') d.sync_state = 'pending';
            return Drafts.put(d).then(function () {
                updateBadge();
                return synthResponse({ success: true, data: draftToLevDict(d) });
            });
        });
    }

    function handleEvidencia(clientKey, formData) {
        var file = formData.get('archivo');
        if (!file) return Promise.resolve(synthResponse({ success: false, error: 'Archivo requerido' }, 400));
        var comentario = formData.get('comentario') || '';
        var productoIdxRaw = formData.get('producto_idx');
        var productoIdx = null;
        if (productoIdxRaw != null && productoIdxRaw !== '' && productoIdxRaw !== 'null') {
            productoIdx = parseInt(productoIdxRaw, 10);
            if (isNaN(productoIdx)) productoIdx = null;
        }
        return compressImage(file).then(function (blob) {
            var ev = {
                client_key: OFFLINE_PREFIX + uuid(),
                draft_key: clientKey,
                blob: blob,
                nombre_original: (file.name || 'foto.jpg').substring(0, 255),
                comentario: String(comentario || '').substring(0, 255),
                producto_idx: productoIdx,
                sync_state: 'pending',
                created_at: now(),
            };
            return Evidencias.put(ev).then(function () {
                updateBadge();
                return synthResponse({ success: true, data: evidenciaToDict(ev) });
            });
        }).catch(function (err) {
            warn('Compresión de foto falló:', err);
            return synthResponse({ success: false, error: 'No se pudo procesar la foto' }, 500);
        });
    }

    function handleEliminar(clientKey) {
        // Borra el draft y sus evidencias localmente.
        return Evidencias.byDraft(clientKey).then(function (evs) {
            var dels = (evs || []).map(function (e) { return Evidencias.del(e.client_key); });
            return Promise.all(dels);
        }).then(function () {
            return Drafts.del(clientKey);
        }).then(function () {
            updateBadge();
            return synthResponse({ success: true });
        });
    }

    function handleDetalle(clientKey) {
        return Drafts.get(clientKey).then(function (d) {
            if (!d) return synthResponse({ success: false, error: 'No encontrado' }, 404);
            return Evidencias.byDraft(clientKey).then(function (evs) {
                var dict = draftToLevDict(d);
                dict.evidencias = (evs || []).map(evidenciaToDict);
                return synthResponse({ ok: true, data: dict });
            });
        });
    }

    function handleLevLista(proyectoId) {
        // Para la vista de lista de levantamientos: mezcla local (drafts
        // pendientes de sync) con lo que venga del servidor. Si el
        // servidor responde, nos toca merge; si falla (offline), devolvemos
        // solo locales.
        var pid = Number(proyectoId);
        return Drafts.getAll().then(function (all) {
            var locales = (all || []).filter(function (d) { return d.proyecto_id === pid; });
            return { locales: locales };
        });
    }

    // ─── Sync: drenar cola contra /offline-sync/ ──────────────────
    var _syncInFlight = false;
    function syncAll() {
        if (_syncInFlight) return Promise.resolve({ skipped: true });
        if (!navigator.onLine) return Promise.resolve({ offline: true });
        _syncInFlight = true;
        _emit('sync:start');
        return Drafts.pending().then(function (drafts) {
            log('Drafts pendientes:', drafts.length);
            // procesar uno por uno para no reventar la red con upload de fotos
            var p = Promise.resolve();
            var results = [];
            drafts.forEach(function (d) {
                p = p.then(function () { return syncOne(d); }).then(function (r) { results.push(r); });
            });
            return p.then(function () { return results; });
        }).then(function (results) {
            _syncInFlight = false;
            updateBadge();
            _emit('sync:end', results);
            return results;
        }).catch(function (err) {
            _syncInFlight = false;
            warn('syncAll falló:', err);
            _emit('sync:end', { error: err });
            throw err;
        });
    }

    function syncOne(draft) {
        draft.sync_state = 'syncing';
        return Drafts.put(draft).then(function () {
            return Evidencias.byDraft(draft.client_key);
        }).then(function (evs) {
            var fd = new FormData();
            fd.append('idempotency_key', draft.client_key.replace(OFFLINE_PREFIX, ''));
            fd.append('proyecto_id', String(draft.proyecto_id));
            if (draft.nombre) fd.append('nombre', draft.nombre);
            if (draft.status) fd.append('status', draft.status);
            if (draft.fase_actual) fd.append('fase_actual', String(draft.fase_actual));
            ['fase1_data', 'fase2_data', 'fase3_data', 'fase4_data', 'fase5_data'].forEach(function (k) {
                if (draft[k] && Object.keys(draft[k]).length) {
                    fd.append(k, JSON.stringify(draft[k]));
                }
            });
            var evMeta = [];
            (evs || []).forEach(function (e, i) {
                evMeta.push({
                    idempotency_key: e.client_key.replace(OFFLINE_PREFIX, ''),
                    comentario: e.comentario || '',
                    producto_idx: e.producto_idx,
                });
                if (e.blob) {
                    fd.append('evidencia_' + i, e.blob, e.nombre_original || 'foto.jpg');
                }
            });
            fd.append('evidencias_meta', JSON.stringify(evMeta));
            return _originalFetch(SYNC_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': getCsrf(), 'X-Requested-With': 'XMLHttpRequest' },
                body: fd,
            }).then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
              .then(function (res) {
                  if (res.status >= 200 && res.status < 300 && res.json && res.json.success) {
                      draft.sync_state = 'done';
                      draft.server_id = res.json.levantamiento_id;
                      return Drafts.put(draft).then(function () {
                          // Marcar evidencias como 'done' también
                          var mapByClientKey = {};
                          (res.json.evidencias || []).forEach(function (e) {
                              mapByClientKey[e.client_key] = e;
                          });
                          var saves = (evs || []).map(function (e) {
                              var r = mapByClientKey[e.client_key.replace(OFFLINE_PREFIX, '')];
                              if (r && r.server_id) e.server_id = r.server_id;
                              e.sync_state = 'done';
                              return Evidencias.put(e);
                          });
                          return Promise.all(saves).then(function () { return { ok: true, client_key: draft.client_key }; });
                      });
                  }
                  // Error servidor
                  draft.sync_state = 'error';
                  draft.last_error = (res.json && res.json.error) || ('HTTP ' + res.status);
                  return Drafts.put(draft).then(function () { return { ok: false, error: draft.last_error }; });
              });
        }).catch(function (err) {
            draft.sync_state = 'error';
            draft.last_error = String(err && err.message || err);
            return Drafts.put(draft).then(function () { return { ok: false, error: draft.last_error }; });
        });
    }

    // ─── Fetch proxy ──────────────────────────────────────────────
    var _originalFetch = window.fetch.bind(window);
    function proxyFetch(resource, init) {
        init = init || {};
        var url = typeof resource === 'string' ? resource : (resource && resource.url) || '';
        var method = ((init && init.method) || (resource && resource.method) || 'GET').toUpperCase();

        // Quitar origen si viene absoluto
        var path = url;
        try {
            if (url && url.indexOf('://') !== -1) {
                var u = new URL(url);
                if (u.origin === window.location.origin) path = u.pathname + u.search;
            }
        } catch (e) {}
        var pathOnly = path.split('?')[0];

        // ── Rutas que SIEMPRE pasan offline si el id es offline: ──
        function parseJsonBody() {
            if (!init.body) return {};
            if (typeof init.body === 'string') {
                try { return JSON.parse(init.body); } catch (e) { return {}; }
            }
            return {};
        }

        var m;

        if (method === 'POST' && (m = pathOnly.match(API.CREATE))) {
            if (!navigator.onLine) {
                return handleCreate(m[1], parseJsonBody());
            }
        }

        if (method === 'POST' && (m = pathOnly.match(API.UPDATE))) {
            if (m[1].indexOf(OFFLINE_PREFIX) === 0) {
                return handleUpdate(m[1], parseJsonBody());
            }
        }

        if (method === 'POST' && (m = pathOnly.match(API.FASE))) {
            if (m[1].indexOf(OFFLINE_PREFIX) === 0) {
                return handleFase(m[1], parseJsonBody());
            }
        }

        if (method === 'POST' && (m = pathOnly.match(API.EVIDENCIA))) {
            if (m[1].indexOf(OFFLINE_PREFIX) === 0) {
                // init.body es FormData
                return handleEvidencia(m[1], init.body);
            }
        }

        if (method === 'POST' && (m = pathOnly.match(API.ELIMINAR))) {
            if (m[1].indexOf(OFFLINE_PREFIX) === 0) {
                return handleEliminar(m[1]);
            }
        }

        if (method === 'GET' && (m = pathOnly.match(API.DETALLE))) {
            if (m[1].indexOf(OFFLINE_PREFIX) === 0) {
                return handleDetalle(m[1]);
            }
        }

        // GET lista de levantamientos: pasamos por red y mergeamos
        // los drafts locales del mismo proyecto (para que el user vea
        // lo que capturó offline aunque no se haya subido todavía).
        if (method === 'GET' && (m = pathOnly.match(API.LEV_LIST))) {
            var proyectoId = Number(m[1]);
            return _originalFetch(resource, init).then(function (r) {
                return r.json().then(function (j) { return { ok: true, json: j }; });
            }).catch(function () {
                return { ok: false, json: { success: false, data: [] } };
            }).then(function (res) {
                return handleLevLista(proyectoId).then(function (locales) {
                    var serverData = (res.json && res.json.data) || [];
                    var merged = serverData.slice();
                    (locales.locales || []).forEach(function (d) {
                        // Solo mostrar los que AUN no se sincronizaron
                        if (d.sync_state !== 'done') {
                            merged.push(draftToLevDict(d));
                        }
                    });
                    // Orden por fecha desc
                    merged.sort(function (a, b) {
                        return String(b.fecha_actualizacion || b.fecha_creacion || '').localeCompare(
                               String(a.fecha_actualizacion || a.fecha_creacion || ''));
                    });
                    return synthResponse({ success: true, ok: true, data: merged });
                });
            });
        }

        // ── Default: passthrough al fetch original ──
        return _originalFetch(resource, init);
    }

    // Reemplazar window.fetch
    try {
        window.fetch = proxyFetch;
    } catch (e) {
        warn('No se pudo instalar fetch proxy:', e);
    }

    // ─── Eventos online/offline ────────────────────────────────────
    window.addEventListener('online', function () {
        log('Evento online — intentando sync');
        setTimeout(function () { syncAll(); }, 800);
    });

    // ─── UI: badge con contador de pendientes ─────────────────────
    function getPendingCount() {
        return Drafts.pending().then(function (arr) { return arr.length; });
    }
    function updateBadge() {
        var el = document.getElementById('levSync');
        var txt = document.getElementById('levSyncText');
        if (!el || !txt) return;
        getPendingCount().then(function (n) {
            if (!navigator.onLine) {
                el.classList.remove('has-pending');
                el.classList.add('offline');
                txt.textContent = n ? ('Sin red · ' + n + ' pend.') : 'Sin conexión';
                return;
            }
            el.classList.remove('offline');
            if (n > 0) {
                el.classList.add('has-pending');
                txt.textContent = n + ' pendiente' + (n === 1 ? '' : 's');
            } else {
                el.classList.remove('has-pending');
                txt.textContent = 'En línea';
            }
        });
    }

    // ─── Pub/sub minimal ──────────────────────────────────────────
    var _listeners = {};
    function on(evt, fn) {
        _listeners[evt] = _listeners[evt] || [];
        _listeners[evt].push(fn);
    }
    function _emit(evt, data) {
        (_listeners[evt] || []).forEach(function (fn) { try { fn(data); } catch (e) {} });
    }

    // ─── API pública ──────────────────────────────────────────────
    window.levOffline = {
        syncAll: syncAll,
        getPendingCount: getPendingCount,
        updateBadge: updateBadge,
        on: on,
        Drafts: Drafts,
        Evidencias: Evidencias,
        OFFLINE_PREFIX: OFFLINE_PREFIX,
    };

    // ─── Init ──────────────────────────────────────────────────────
    openDB().then(function () {
        log('IndexedDB listo');
        updateBadge();
        // Si arrancamos online y hay drafts pendientes, intentar sync
        if (navigator.onLine) {
            setTimeout(function () { syncAll(); }, 1500);
        }
    }).catch(function (err) {
        warn('No se pudo abrir IndexedDB — modo offline deshabilitado:', err);
    });

    window.addEventListener('online', updateBadge);
    window.addEventListener('offline', updateBadge);
})();

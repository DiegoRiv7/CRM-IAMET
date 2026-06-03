/* ============================================================
   crm_proyectos.js  --  Modulo Proyectos (inline section + detail overlay)
   ============================================================ */
(function() {
    'use strict';

    // --- State ---
    var currentProjectId = null;
    var currentFilter = 'todos';
    var currentTab = 'partidas';
    var _cachedProjectDetail = null;
    var searchQuery = '';

    // --- Cached data from API ---
    var _cachedProjects = [];


    // =========================================
    //  API HELPERS
    // =========================================

    function _csrf() {
        var elem = document.querySelector('[name=csrfmiddlewaretoken]');
        return elem ? elem.value : '';
    }

    function _fetch(url, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        opts.headers['X-CSRFToken'] = _csrf();
        if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        opts.credentials = 'same-origin';
        return fetch(url, opts).then(function(r) { return r.json(); });
    }


    // =========================================
    //  HELPERS
    // =========================================

    function fmtMoney(val) {
        return '$' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function fmtDate(dateStr) {
        if (!dateStr) return '\u2014';
        var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        var parts = dateStr.split('T')[0].split('-');
        return parseInt(parts[2]) + ' ' + months[parseInt(parts[1]) - 1] + ' ' + parts[0];
    }

    function statusLabel(status) {
        var map = {
            planning:'Planificacion', active:'Activo', paused:'Pausado', completed:'Completado', archived:'Archivado',
            pending:'Pendiente', ordered:'Ordenado', in_transit:'En Transito', received:'Recibido', closed:'Cerrado',
            draft:'Borrador', emitted:'Emitida', cancelled:'Cancelada', paid:'Pagada', disputed:'Disputada',
            in_progress:'En Progreso', approved:'Aprobado', rejected:'Rechazado', overdue:'Vencida'
        };
        return map[status] || status;
    }

    function statusClass(status) {
        var map = {
            planning:'planning', active:'active', paused:'paused', completed:'completed', archived:'archived',
            pending:'planning', ordered:'active', in_transit:'paused', received:'completed', closed:'archived',
            draft:'planning', emitted:'active', cancelled:'archived', paid:'completed', disputed:'paused',
            in_progress:'active', approved:'completed', rejected:'paused'
        };
        return 'proy-status-' + (map[status] || 'planning');
    }

    function priorityClass(priority) {
        return 'proy-priority-' + (priority || 'low');
    }

    function priorityLabel(priority) {
        var map = { low:'Baja', medium:'Media', high:'Alta', critical:'Critica' };
        return map[priority] || priority;
    }

    function truncate(str, len) {
        if (!str) return '\u2014';
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    function severityIcon(severity) {
        var icons = {
            critical: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
            warning: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
            info: '<svg viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
        };
        return icons[severity] || icons.info;
    }

    function categoryDot(category) {
        var colors = {
            'Equipamiento': '#3b82f6',
            'Accesorios': '#8b5cf6',
            'Mano de Obra': '#f59e0b',
            'Materiales': '#10b981',
            'Servicios': '#ec4899',
            'Software': '#06b6d4'
        };
        var color = colors[category] || '#6b7280';
        return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:6px;flex-shrink:0"></span>';
    }

    function el(id) {
        return document.getElementById(id);
    }

    // -- Overview helpers (header + KPI cards rediseñados) --

    // Iniciales rápidas para nombres ("Eduardo Rivera" -> "ER")
    function _initials(name) {
        if (!name) return '·';
        var s = String(name).trim();
        if (!s) return '·';
        var parts = s.split(/\s+/).filter(Boolean);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    // Format compacto: $48k / $80k (en miles), $1.2M (en millones)
    function _fmtMoneyShort(v) {
        var n = Number(v || 0);
        var sign = n < 0 ? '-' : '';
        var abs = Math.abs(n);
        if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
        if (abs >= 1e3) return sign + '$' + Math.round(abs / 1e3) + 'k';
        return sign + '$' + Math.round(abs);
    }

    // Pinta avatar (chip o círculo). target: elemento, opts: {bg, text, image}
    function _paintAvatar(target, opts) {
        if (!target) return;
        opts = opts || {};
        if (opts.image) {
            target.style.backgroundImage = 'url(' + opts.image + ')';
            target.style.backgroundColor = 'transparent';
            target.textContent = '';
        } else {
            target.style.backgroundImage = '';
            target.style.backgroundColor = opts.bg || '#1e3a8a';
            target.textContent = opts.text || '·';
        }
    }

    // Calcula color del avance (verde/ámbar/rojo) según delta vs tiempo
    function _avanceClass(delta) {
        if (delta === null || delta === undefined) return '';
        if (delta >= 0) return '';                 // verde (default)
        if (delta > -15) return 'is-warn';         // ámbar
        return 'is-danger';                        // rojo
    }

    // Escape para insertar texto en innerHTML sin abrir XSS
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Texto descriptivo del estado de vida del proyecto (parte izquierda del meta row).
    function _stateLabel(status) {
        switch ((status || '').toLowerCase()) {
            case 'planificacion': return 'Proyecto en planificación';
            case 'ejecucion':     return 'Proyecto activo';
            case 'riesgo':        return 'Proyecto activo';
            case 'detenido':      return 'Proyecto detenido';
            case 'completado':    return 'Proyecto completado';
            default:              return 'Proyecto';
        }
    }

    // Pinta avatar del stack del topbar usando un miembro del equipo.
    function _avatarStackHtml(member, idx) {
        var initials = (member && (member.iniciales || _initials(member.nombre))) || '·';
        var content;
        if (member && member.avatar_url) {
            content = '<img src="' + _esc(member.avatar_url) + '" alt="">';
        } else {
            content = _esc(initials);
        }
        // título tooltip nativo
        var title = (member && member.nombre) ? member.nombre : '';
        return '<div class="proy-v2-avatar" style="z-index:' + (10 - idx) + ';" title="' + _esc(title) + '">' + content + '</div>';
    }

    // Pinta el cuadrado oscuro del cliente (avatar v3) — iniciales en blanco
    // o logo de fondo si existe. Background #1c1c1e por defecto (uniform).
    // Mantenido por compat con el header anterior; el v3 minimal ya no lo usa.
    function _paintClientSquare(target, cliente) {
        if (!target) return;
        var nombre = (cliente && cliente.nombre) || '';
        var ini = (cliente && cliente.iniciales) || _initials(nombre) || '·';
        if (cliente && cliente.logo_url) {
            target.style.backgroundImage = 'url(' + _esc(cliente.logo_url) + ')';
            target.textContent = '';
        } else {
            target.style.backgroundImage = '';
            target.textContent = ini;
        }
        target.title = nombre;
    }

    // Formatea un rango de fechas como "10 abr → 17 abr 2026" (o "10 abr 2026
    // → 5 may 2027" si los años difieren). Acepta strings ISO YYYY-MM-DD.
    function _fmtDateRange(ini, fin) {
        if (!ini && !fin) return '';
        if (!ini) return fmtDate(fin);
        if (!fin) return fmtDate(ini);
        var aIni = ini.split('T')[0].split('-');
        var aFin = fin.split('T')[0].split('-');
        var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        var sameYear = aIni[0] === aFin[0];
        var d1 = parseInt(aIni[2], 10) + ' ' + months[parseInt(aIni[1], 10) - 1] + (sameYear ? '' : ' ' + aIni[0]);
        var d2 = parseInt(aFin[2], 10) + ' ' + months[parseInt(aFin[1], 10) - 1] + ' ' + aFin[0];
        return d1 + ' → ' + d2;
    }

    // Render del header + KPIs partiendo de data.overview (si existe).
    // Tolera ausencias y degrada con "—".
    function renderProjectOverview(project) {
        var ov = (project && project.overview) ? project.overview : null;

        // ---- ID del proyecto (top bar) ----
        var idEl = el('proyV3ProjectId');
        if (idEl) {
            idEl.textContent = (project && project.id) ? ('ID: PROY-' + project.id) : 'ID: —';
        }

        // ---- TÍTULO ----
        var hName = el('proyDetailName');
        var projName = (project && project.nombre) || (ov && ov.nombre) || '';
        if (hName) hName.textContent = projName;

        // ---- BREADCRUMB en el topbar contextual: "Portafolio · [Nombre]" ----
        // Mantiene el contexto del proyecto al lado del botón "← Portafolio"
        // cuando los tabs ocupan el centro de la dynamic island.
        var crumbName = el('proyV3CrumbName');
        if (crumbName) {
            crumbName.textContent = projName || 'Proyecto';
            crumbName.title = projName ? ('Volver al portafolio · ' + projName) : 'Volver al portafolio';
        }

        // ---- RAG PILL (status del header) ----
        // Antes mostraba el lifecycle (Planificación/Ejecución). Ahora muestra
        // la salud (EN RIESGO / ATENCIÓN / EN TIEMPO) — más útil de un vistazo.
        var hStatus = el('proyDetailStatus');
        if (hStatus) {
            var rag = ov && ov.salud ? ov.salud.rag : null;
            var ragLabel, ragColor;
            if (rag === 'rojo')      { ragLabel = 'EN RIESGO'; ragColor = '#ef4444'; }
            else if (rag === 'ambar'){ ragLabel = 'ATENCIÓN';  ragColor = '#f59e0b'; }
            else if (rag === 'verde'){ ragLabel = 'EN TIEMPO'; ragColor = '#10b981'; }
            else                     { ragLabel = '—';         ragColor = '#94a3b8'; }
            hStatus.innerHTML = '<span class="proy-v3-rag-dot"></span><span class="proy-v3-rag-text">' + _esc(ragLabel) + '</span>';
            hStatus.style.background = ragColor + '1f';
            hStatus.style.borderColor = ragColor + '4d';
            hStatus.style.color = ragColor;
        }

        // ---- META LINE: cliente · fechas · alerta inline (header minimal) ----
        var clienteNombre = ov && ov.cliente ? ov.cliente.nombre : (project ? project.cliente_nombre : '');
        var clienteUbic   = ov && ov.cliente ? ov.cliente.ubicacion : '';
        var hClient = el('proyDetailClient');
        if (hClient) hClient.textContent = clienteNombre || '—';
        var sepCli = el('proyV3MetaSepCli');
        if (sepCli) sepCli.style.display = clienteNombre ? '' : 'none';

        // Rango de fechas (formato "10 abr → 17 abr 2026")
        var fechas = el('proyV3Fechas');
        var sepFech = el('proyV3MetaSepFechas');
        var hUbic   = el('proyDetailUbicacion');
        var fIni = ov ? ov.fecha_inicio : (project ? project.fecha_inicio : null);
        var fFin = ov ? ov.fecha_fin    : (project ? project.fecha_fin    : null);
        var rango = _fmtDateRange(fIni, fFin);
        if (fechas) {
            fechas.textContent = rango || 'Sin fechas';
            fechas.classList.toggle('is-empty', !rango);
        }
        if (sepFech) sepFech.style.display = (rango || clienteNombre) ? '' : 'none';
        if (hUbic) hUbic.textContent = clienteUbic || '';

        // Lifecycle state legacy — el header minimal ya no lo muestra.
        var stateEl = el('proyV2MetaState');
        if (stateEl) stateEl.textContent = ov ? _stateLabel(ov.status) : '';

        // Link oportunidad (en el topbar, al lado de "Portafolio") — muestra
        // el nombre completo de la oportunidad (no solo el código), para que
        // el usuario sepa de inmediato de qué venta nació este proyecto.
        var oppChip = el('proyDetailOppChip');
        var oppText = el('proyDetailOppText');
        var oppSep  = el('proyV3CrumbOppSep');
        if (oppChip) {
            var oppId   = ov && ov.oportunidad ? ov.oportunidad.id : (project ? project.oportunidad_id : null);
            var oppName = ov && ov.oportunidad ? (ov.oportunidad.nombre || '') : '';
            var oppCod  = ov && ov.oportunidad ? (ov.oportunidad.codigo || '') : '';
            if (oppId) {
                // Preferimos el nombre completo; si no hay nombre, caemos al código.
                var label = oppName || oppCod || ('Oportunidad #' + oppId);
                if (oppText) oppText.textContent = label;
                oppChip.style.display = '';
                oppChip.setAttribute('data-opp-id', oppId);
                oppChip.setAttribute('title', oppCod ? (oppCod + ' — ' + label) : ('Oportunidad — ' + label));
                if (oppSep) oppSep.style.display = '';
            } else {
                oppChip.style.display = 'none';
                if (oppSep) oppSep.style.display = 'none';
            }
        }

        // ---- ALERTA INLINE (meta line del header minimal) ----
        // Solo se muestra si rag = rojo o ámbar y hay razones. Vive como
        // un fragmento más de la línea de meta, sin banner separado —
        // mucho menos ruidoso que el alert bar grande del v2.
        var alertInline = el('proyV3AlertInline');
        var alertInlineText = el('proyV3AlertInlineText');
        var alertSep = el('proyV3MetaSepAlert');
        if (alertInline && alertInlineText) {
            var ragV = ov && ov.salud ? ov.salud.rag : null;
            var razones = (ov && ov.salud && ov.salud.razones) ? ov.salud.razones : [];
            if ((ragV === 'rojo' || ragV === 'ambar') && razones.length) {
                alertInline.style.display = '';
                if (alertSep) alertSep.style.display = '';
                alertInline.classList.toggle('is-warn', ragV === 'ambar');
                // Solo la primera razón — la lista completa vive en el Dashboard.
                alertInlineText.textContent = razones[0];
            } else {
                alertInline.style.display = 'none';
                if (alertSep) alertSep.style.display = 'none';
            }
        }

        // ---- AVATAR STACK (topbar derecho) ----
        var stack = el('proyV2AvatarStack');
        if (stack) {
            var miembros = (ov && ov.equipo && ov.equipo.length) ? ov.equipo : [];
            if (!miembros.length && ov) {
                if (ov.vendedor)  miembros.push(ov.vendedor);
                if (ov.ingeniero_responsable) miembros.push(ov.ingeniero_responsable);
            }
            var max = 3;
            var html = '';
            miembros.slice(0, max).forEach(function(m, i) { html += _avatarStackHtml(m, i); });
            var total = (ov && typeof ov.equipo_total === 'number') ? ov.equipo_total : miembros.length;
            if (total > max) {
                html += '<div class="proy-v2-avatar is-extra" title="+' + (total - max) + ' más">+' + (total - max) + '</div>';
            }
            stack.innerHTML = html;
        }

        // ---- KPI cells ----
        renderOverviewKPIs(ov);

        // ---- Secciones extra del Dashboard (gauge, equipo, stack bar, mini-stats) ----
        _renderDashboardSections(ov);
    }

    // Renderiza las cards adicionales del Dashboard (gauge avance,
    // equipo, breakdown presupuesto, mini-stats). Tolera ausencia de
    // overview con valores neutros.
    function _renderDashboardSections(ov) {
        // ── Gauge avance vs cronograma (semicircle SVG) ──
        // El path "M 20 110 A 80 80 0 0 1 180 110" tiene length ≈ 251.3
        // (π·80). stroke-dashoffset 251.3 = vacío; 0 = lleno.
        var GAUGE_LENGTH = 251.3;
        var gaugeReal = el('proyDashGaugeReal');
        var gaugeTime = el('proyDashGaugeTime');
        var gaugePct  = el('proyDashGaugePct');
        var gaugeRealLbl = el('proyDashGaugeRealLabel');
        var gaugeTimeLbl = el('proyDashGaugeTimeLabel');
        var gaugeDelta = el('proyDashAvanceDelta');

        var avp = (ov && typeof ov.avance_pct === 'number') ? Math.max(0, Math.min(100, Math.round(ov.avance_pct))) : 0;
        var tpp = (ov && typeof ov.tiempo_transcurrido_pct === 'number') ? Math.max(0, Math.min(100, Math.round(ov.tiempo_transcurrido_pct))) : 0;
        var delta = (ov && typeof ov.avance_vs_tiempo_delta === 'number') ? ov.avance_vs_tiempo_delta : (avp - tpp);

        if (gaugeReal) gaugeReal.style.strokeDashoffset = (GAUGE_LENGTH * (1 - avp / 100)).toFixed(1);
        if (gaugeTime) gaugeTime.style.strokeDashoffset = (GAUGE_LENGTH * (1 - tpp / 100)).toFixed(1);
        if (gaugeReal) {
            // Color del avance según delta vs tiempo
            var color = '#10b981'; // verde
            if (delta <= -15) color = '#ef4444';
            else if (delta < 0) color = '#f59e0b';
            gaugeReal.setAttribute('stroke', color);
        }
        if (gaugePct)    gaugePct.textContent = avp + '%';
        if (gaugeRealLbl) gaugeRealLbl.textContent = avp + '%';
        if (gaugeTimeLbl) gaugeTimeLbl.textContent = tpp + '%';
        if (gaugeDelta) {
            if (!ov) gaugeDelta.textContent = '—';
            else if (delta > 0) gaugeDelta.textContent = '+' + delta + '% sobre el plan';
            else if (delta === 0) gaugeDelta.textContent = 'En plan';
            else gaugeDelta.textContent = delta + '% vs plan';
        }

        // ── Equipo grid ──
        var equipoGrid = el('proyDashEquipoGrid');
        var equipoCount = el('proyDashEquipoCount');
        if (equipoGrid) {
            var miembros = (ov && ov.equipo && ov.equipo.length) ? ov.equipo : [];
            if (miembros.length) {
                equipoGrid.innerHTML = miembros.map(function (m) {
                    var ini = _esc(m.iniciales || _initials(m.nombre || ''));
                    var nombre = _esc(m.nombre || '—');
                    var rol = _esc(m.rol || '');
                    var avatarHtml;
                    if (m.avatar_url) {
                        avatarHtml = '<div class="proy-v3-equipo-avatar" style="background-image:url(' + _esc(m.avatar_url) + ');"></div>';
                    } else {
                        avatarHtml = '<div class="proy-v3-equipo-avatar">' + ini + '</div>';
                    }
                    return '<div class="proy-v3-equipo-card">' + avatarHtml +
                        '<div class="proy-v3-equipo-info">' +
                            '<div class="proy-v3-equipo-name">' + nombre + '</div>' +
                            (rol ? '<div class="proy-v3-equipo-rol">' + rol + '</div>' : '') +
                        '</div></div>';
                }).join('');
            } else {
                equipoGrid.innerHTML = '<div class="proy-v3-empty-tiny">Sin miembros asignados.</div>';
            }
            if (equipoCount) {
                var total = (ov && typeof ov.equipo_total === 'number') ? ov.equipo_total : miembros.length;
                equipoCount.textContent = total + (total === 1 ? ' miembro' : ' miembros');
            }
        }

        // ── Stack bar: breakdown del presupuesto por categoría ──
        var stackBar = el('proyDashStackBar');
        var stackLegend = el('proyDashStackLegend');
        var stackSummary = el('proyDashFinSummary');
        if (stackBar && stackLegend) {
            var breakdown = (ov && Array.isArray(ov.breakdown_presupuesto)) ? ov.breakdown_presupuesto : [];
            var totalBreak = breakdown.reduce(function (s, b) { return s + Number(b.monto || 0); }, 0);
            // Paleta determinística por orden (suficiente para 4-6 categorías típicas)
            var palette = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#64748b'];

            if (breakdown.length && totalBreak > 0) {
                stackBar.innerHTML = breakdown.map(function (b, i) {
                    var pct = (Number(b.monto || 0) / totalBreak) * 100;
                    var color = palette[i % palette.length];
                    return '<div class="proy-v3-stack-segment" style="width:' + pct.toFixed(2) + '%;background:' + color + ';" title="' + _esc(b.categoria || '') + ': ' + _fmtMoneyShort(b.monto) + '"></div>';
                }).join('');
                stackLegend.innerHTML = breakdown.map(function (b, i) {
                    var color = palette[i % palette.length];
                    var pct = Math.round((Number(b.monto || 0) / totalBreak) * 100);
                    return '<div class="proy-v3-stack-legend-item">' +
                        '<span class="proy-v3-stack-legend-dot" style="background:' + color + ';"></span>' +
                        '<span class="proy-v3-stack-legend-label">' + _esc(b.categoria || 'Otros') + '</span>' +
                        '<span class="proy-v3-stack-legend-amount">' + _fmtMoneyShort(b.monto) + ' · ' + pct + '%</span>' +
                    '</div>';
                }).join('');
            } else {
                stackBar.innerHTML = '<div class="proy-v3-stack-segment" style="width:100%;background:#e2e8f0;"></div>';
                stackLegend.innerHTML = '<div class="proy-v3-empty-tiny">Aún no hay partidas con monto. Captura el levantamiento para ver el desglose.</div>';
            }
            if (stackSummary) {
                stackSummary.textContent = totalBreak > 0 ? ('Total: ' + _fmtMoneyShort(totalBreak)) : 'Sin datos';
            }
        }

        // ── Mini-stats ──
        var counts = (ov && ov.counts) ? ov.counts : {};
        var dr = (ov && typeof ov.dias_restantes === 'number') ? ov.dias_restantes : null;

        var sDias = el('proyDashStatDias');
        if (sDias) {
            sDias.classList.remove('is-danger', 'is-warn');
            if (dr === null)      sDias.textContent = '—';
            else if (dr < 0)    { sDias.textContent = '−' + Math.abs(dr); sDias.classList.add('is-danger'); }
            else if (dr <= 3)   { sDias.textContent = dr;                 sDias.classList.add('is-warn'); }
            else                  sDias.textContent = dr;
        }
        var sLev = el('proyDashStatLevantamientos');
        if (sLev) sLev.textContent = (counts.levantamientos != null) ? counts.levantamientos : '—';

        var sTar = el('proyDashStatTareas');
        if (sTar) {
            var tp = (counts.tareas_pendientes != null) ? counts.tareas_pendientes : null;
            sTar.classList.remove('is-warn');
            sTar.textContent = (tp != null) ? tp : '—';
            if (tp && tp > 5) sTar.classList.add('is-warn');
        }
        var sAle = el('proyDashStatAlertas');
        if (sAle) {
            var al = (counts.alertas != null) ? counts.alertas : null;
            sAle.classList.remove('is-danger');
            sAle.textContent = (al != null) ? al : '—';
            if (al && al > 0) sAle.classList.add('is-danger');
        }
        var sOC = el('proyDashStatOC');
        if (sOC) sOC.textContent = (counts.ordenes_compra_activas != null) ? counts.ordenes_compra_activas : '—';
    }

    // Render de las 4 celdas del KPI strip v3 (Estado · Progreso · Presupuesto · Facturado).
    // Si no hay overview, deja valores neutros sin romper.
    function renderOverviewKPIs(ov) {
        // ── Cell 1: ESTADO GLOBAL (rag-driven) ──
        var estCard = el('proyKpiSalud');
        var estVal  = el('proyKpiSaludMsg');
        var estSub  = el('proyKpiSaludRazones');
        if (estCard && estVal && estSub) {
            estVal.classList.remove('is-danger', 'is-warn', 'is-good');
            estSub.classList.remove('is-danger', 'is-warn');
            if (ov && ov.salud) {
                var rag = ov.salud.rag || 'verde';
                estCard.setAttribute('data-rag', rag);
                // Value: usa la label del backend ("Atrasado X% vs cronograma" /
                // "Margen apretado (X%)" / "En tiempo · sin riesgos") tal cual.
                estVal.textContent = ov.salud.label || '—';
                if (rag === 'rojo')      estVal.classList.add('is-danger');
                else if (rag === 'ambar') estVal.classList.add('is-warn');
                else if (rag === 'verde') estVal.classList.add('is-good');
                // Sub: primera razón si hay; si no, frase neutra por rag.
                var razones = ov.salud.razones || [];
                if (razones.length) {
                    estSub.textContent = razones[0];
                    if (rag === 'rojo')       estSub.classList.add('is-danger');
                    else if (rag === 'ambar') estSub.classList.add('is-warn');
                } else {
                    estSub.textContent = (rag === 'verde') ? 'Sin alertas activas' : 'Revisar reporte de salud';
                }
            } else {
                estCard.removeAttribute('data-rag');
                estVal.textContent = '—';
                estSub.textContent = '—';
            }
        }

        // ── Cell 2: PROGRESO DE OBRA ──
        var avPct = el('proyKpiAvancePct');
        var avBar = el('proyKpiAvanceBar');
        var avSub = el('proyKpiAvanceSub');
        if (avPct && avBar && avSub) {
            avBar.classList.remove('is-danger', 'is-warn', 'is-good');
            avSub.classList.remove('is-danger', 'is-warn');
            if (ov) {
                var avp = (typeof ov.avance_pct === 'number' ? Math.round(ov.avance_pct) : 0);
                avPct.textContent = avp + '%';
                avBar.style.width = Math.max(0, Math.min(100, avp)) + '%';

                var d = (typeof ov.avance_vs_tiempo_delta === 'number') ? ov.avance_vs_tiempo_delta : 0;
                if (d <= -15)      avBar.classList.add('is-danger');
                else if (d < 0)    avBar.classList.add('is-warn');
                else if (d > 0 || avp > 0) avBar.classList.add('is-good');

                if (avp >= 100) {
                    avSub.textContent = 'Obra completada';
                } else if (avp === 0) {
                    avSub.textContent = 'Fase inicial no completada';
                } else if (d <= -15) {
                    avSub.textContent = 'Atrasado ' + Math.abs(d) + '% vs cronograma';
                    avSub.classList.add('is-danger');
                } else if (d < 0) {
                    avSub.textContent = Math.abs(d) + '% por debajo del plan';
                    avSub.classList.add('is-warn');
                } else if (d > 0) {
                    avSub.textContent = '+' + d + '% sobre el plan';
                } else {
                    avSub.textContent = 'En línea con el plan';
                }
            } else {
                avPct.textContent = '0%';
                avBar.style.width = '0%';
                avSub.textContent = '—';
            }
        }

        // ── Cell 3: PRESUPUESTO (gastado / presupuesto) ──
        var fAmt  = el('proyKpiFinAmounts');
        var fMeta = el('proyKpiFinMeta');
        if (fAmt && fMeta) {
            fMeta.classList.remove('is-danger', 'is-warn');
            if (ov && ov.financiero) {
                var f = ov.financiero;
                var gastado = Number(f.gastado || 0);
                var presupuesto = Number(f.contratado || 0);
                fAmt.innerHTML =
                    '<span class="proy-v3-kpi-value">' + _esc(_fmtMoneyShort(gastado)) + '</span>' +
                    '<span class="proy-v3-kpi-value-small">/ ' + _esc(_fmtMoneyShort(presupuesto)) + '</span>';
                if (presupuesto <= 0) {
                    fMeta.textContent = 'Sin presupuesto asignado';
                } else {
                    var consumPct = Math.round((gastado / presupuesto) * 100);
                    var disponible = presupuesto - gastado;
                    if (consumPct >= 100) {
                        fMeta.classList.add('is-danger');
                        fMeta.textContent = 'Sobregiro ' + _fmtMoneyShort(Math.abs(disponible)) + ' · ' + consumPct + '% usado';
                    } else if (consumPct >= 80) {
                        fMeta.classList.add('is-warn');
                        fMeta.textContent = consumPct + '% usado · disponible ' + _fmtMoneyShort(disponible);
                    } else {
                        fMeta.textContent = consumPct + '% usado · disponible ' + _fmtMoneyShort(disponible);
                    }
                }
            } else {
                fAmt.innerHTML = '<span class="proy-v3-kpi-value">$0</span><span class="proy-v3-kpi-value-small">/ $0</span>';
                fMeta.textContent = 'Sin presupuesto asignado';
            }
        }

        // ── Cell 4: FACTURADO (cobrado / contratado) ──
        // Reusamos los IDs proyKpiCrono* (legacy) sin renombrar.
        var cBig   = el('proyKpiCronoPct');
        var cSmall = el('proyKpiCronoSubtitle');
        var cSub   = el('proyKpiCronoDelta');
        if (cBig && cSmall && cSub) {
            cSub.classList.remove('is-danger', 'is-warn');
            if (ov && ov.financiero) {
                var ff = ov.financiero;
                var cobrado = Number(ff.cobrado || 0);
                var contratado = Number(ff.contratado || 0);
                cBig.textContent = _fmtMoneyShort(cobrado);
                cSmall.textContent = '/ ' + _fmtMoneyShort(contratado);
                if (contratado <= 0) {
                    cSub.textContent = 'Sin monto contratado';
                } else if (cobrado >= contratado) {
                    cSub.textContent = 'Facturado al 100%';
                } else {
                    var pct = Math.round((cobrado / contratado) * 100);
                    cSub.textContent = pct + '% facturado · por cobrar ' + _fmtMoneyShort(contratado - cobrado);
                }
            } else {
                cBig.textContent = '$0';
                cSmall.textContent = '/ $0';
                cSub.textContent = 'Sin monto contratado';
            }
        }
    }

    // "Ver reporte" desde la card de Salud — abre la tab de Cronograma para
    // que el usuario revise el detalle del atraso/desviación. Si después se
    // hace un reporte dedicado, basta cambiar esta función.
    window.proyDetailVerReporteSalud = function(ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (typeof window.proyectosSetTab === 'function') window.proyectosSetTab('programa');
    };

    // Toast simple para feedback de acciones del topbar (Compartir, agregar
    // miembro, etc). Reusa una sola instancia en el body.
    function _proyToast(msg) {
        var t = document.getElementById('proyV2Toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'proyV2Toast';
            t.className = 'proy-v2-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        // forzar reflow para que la transición corra siempre
        // eslint-disable-next-line no-unused-expressions
        t.offsetWidth;
        t.classList.add('is-visible');
        clearTimeout(t._hideTimer);
        t._hideTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 1800);
    }

    // "Compartir": genera link directo al proyecto, lo copia al clipboard
    // y muestra un toast confirmando. El destinatario que abra ese link
    // verá el detalle del proyecto abierto automáticamente (handled abajo
    // en proyectosOpenFromUrl).
    window.proyDetailCompartir = function(ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (!currentProjectId) return;
        var url = window.location.origin + '/app/todos/?open_proyecto=' + currentProjectId;
        var done = function() { _proyToast('Link copiado al portapapeles'); };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(done, function() {
                    // fallback execCommand si clipboard API es rechazada
                    _copyToClipboardFallback(url); done();
                });
            } else {
                _copyToClipboardFallback(url); done();
            }
        } catch (e) {
            _copyToClipboardFallback(url); done();
        }
    };

    function _copyToClipboardFallback(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) {}
    }

    // Apertura automática del detalle al cargar la página si la URL trae
    // ?open_proyecto=N (opcional &tab=foo). Espera a que el listado termine
    // de cargar para que proyectosVerDetalle pueda hidratar el estado
    // correctamente. proyectosVerDetalle se encarga de re-escribir la URL
    // con replaceState (ahora coordinado vía _proySyncUrl), así que aquí
    // sólo necesitamos leer y disparar.
    window.proyectosOpenFromUrl = function() {
        try {
            var qs = window.location.search;
            var m = qs.match(/[?&]open_proyecto=(\d+)/);
            if (!m) return;
            var pid = parseInt(m[1], 10);
            if (!pid) return;
            var tabM = qs.match(/[?&]tab=([a-zA-Z0-9_\-]+)/);
            var initialTab = tabM ? decodeURIComponent(tabM[1]) : null;
            // Esperamos un tick para que el DOM del proyecto esté listo
            setTimeout(function () {
                if (typeof window.proyectosVerDetalle === 'function') {
                    window.proyectosVerDetalle(pid, initialTab);
                }
            }, 200);
        } catch (e) { /* noop */ }
    };

    // ── Dropdown "Más ▾" del topbar contextual del proyecto ──
    // Aloja Equipo / Comunicación / Reportes / Info. Al elegir un item
    // delega en proyectosSetTab.
    function _proyMoreMenuOpen() {
        var menu = el('proyMoreMenu');
        var btn = el('proyMoreBtn');
        if (!menu) return;
        menu.style.display = '';
        if (btn) btn.setAttribute('aria-expanded', 'true');
        setTimeout(function () {
            document.addEventListener('mousedown', _proyMoreMenuOutside, true);
            document.addEventListener('keydown', _proyMoreMenuEsc, true);
        }, 10);
    }
    function _proyMoreMenuClose() {
        var menu = el('proyMoreMenu');
        var btn = el('proyMoreBtn');
        if (menu) menu.style.display = 'none';
        if (btn) btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', _proyMoreMenuOutside, true);
        document.removeEventListener('keydown', _proyMoreMenuEsc, true);
    }
    function _proyMoreMenuOutside(ev) {
        var wrap = document.querySelector('.proy-v3-more-wrap');
        if (wrap && !wrap.contains(ev.target)) _proyMoreMenuClose();
    }
    function _proyMoreMenuEsc(ev) {
        if (ev.key === 'Escape') _proyMoreMenuClose();
    }
    window.proyMoreMenuToggle = function(ev) {
        if (ev) { ev.preventDefault && ev.preventDefault(); ev.stopPropagation && ev.stopPropagation(); }
        var menu = el('proyMoreMenu');
        if (!menu) return;
        var open = menu.style.display !== 'none';
        if (open) _proyMoreMenuClose(); else _proyMoreMenuOpen();
    };
    window.proyMoreMenuPick = function(tab) {
        _proyMoreMenuClose();
        if (typeof window.proyectosSetTab === 'function') window.proyectosSetTab(tab);
    };

    // ── Agregar miembro: abre popover, busca usuarios, POST al endpoint ──
    var _proyMemberSearchTimer = null;

    window.proyDetailAgregarMiembro = function(ev) {
        if (ev) { ev.preventDefault && ev.preventDefault(); ev.stopPropagation && ev.stopPropagation(); }
        var pop = el('proyV2MemberPopover');
        if (!pop) return;
        var isOpen = pop.style.display !== 'none';
        if (isOpen) {
            _closeMemberPopover();
        } else {
            _openMemberPopover();
        }
    };

    function _openMemberPopover() {
        var pop = el('proyV2MemberPopover');
        var input = el('proyV2MemberSearch');
        var list = el('proyV2MemberList');
        if (!pop) return;
        pop.style.display = '';
        if (list) list.innerHTML = '<div class="proy-v2-member-empty">Escribe para buscar usuarios</div>';
        if (input) { input.value = ''; setTimeout(function(){ input.focus(); }, 30); }
        setTimeout(function () {
            document.addEventListener('mousedown', _memberPopoverOutside, true);
            document.addEventListener('keydown', _memberPopoverEsc, true);
        }, 10);
    }

    function _closeMemberPopover() {
        var pop = el('proyV2MemberPopover');
        if (pop) pop.style.display = 'none';
        document.removeEventListener('mousedown', _memberPopoverOutside, true);
        document.removeEventListener('keydown', _memberPopoverEsc, true);
    }

    function _memberPopoverOutside(ev) {
        var wrap = document.querySelector('.proy-v2-add-member-wrap');
        if (wrap && !wrap.contains(ev.target)) _closeMemberPopover();
    }
    function _memberPopoverEsc(ev) {
        if (ev.key === 'Escape') _closeMemberPopover();
    }

    window.proyDetailMiembroBuscar = function(q) {
        if (_proyMemberSearchTimer) clearTimeout(_proyMemberSearchTimer);
        var list = el('proyV2MemberList');
        var query = (q || '').trim();
        if (!query) {
            if (list) list.innerHTML = '<div class="proy-v2-member-empty">Escribe para buscar usuarios</div>';
            return;
        }
        if (list) list.innerHTML = '<div class="proy-v2-member-loading">Buscando…</div>';
        _proyMemberSearchTimer = setTimeout(function () {
            fetch('/app/api/buscar-usuarios/?q=' + encodeURIComponent(query))
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var users = data.usuarios || [];
                    if (!users.length) {
                        if (list) list.innerHTML = '<div class="proy-v2-member-empty">Sin resultados</div>';
                        return;
                    }
                    if (list) {
                        list.innerHTML = users.slice(0, 30).map(function (u) {
                            var ini = _initials(u.nombre || u.username || '');
                            var label = _esc(u.nombre || u.username || '');
                            return '<div class="proy-v2-member-item" data-uid="' + _esc(String(u.id)) + '" data-name="' + label + '">' +
                                '<div class="proy-v2-member-item-avatar">' + _esc(ini) + '</div>' +
                                '<div class="proy-v2-member-item-name">' + label + '</div>' +
                            '</div>';
                        }).join('');
                        Array.prototype.forEach.call(list.querySelectorAll('.proy-v2-member-item'), function (item) {
                            item.addEventListener('click', function () {
                                var uid = item.getAttribute('data-uid');
                                var name = item.getAttribute('data-name') || '';
                                _addMemberToProject(uid, name);
                            });
                        });
                    }
                })
                .catch(function () {
                    if (list) list.innerHTML = '<div class="proy-v2-member-empty">Error al buscar</div>';
                });
        }, 220);
    };

    window.proyDetailMiembroKey = function(ev) {
        if (ev.key === 'Enter') {
            var first = document.querySelector('#proyV2MemberList .proy-v2-member-item');
            if (first) first.click();
        }
    };

    function _addMemberToProject(userId, name) {
        if (!currentProjectId || !userId) return;
        var csrf = (function(){ var v=document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)'); return v?v.pop():''; })();
        fetch('/app/api/iamet/proyectos/' + currentProjectId + '/miembros/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            body: JSON.stringify({ user_id: userId })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data && data.success) {
                _closeMemberPopover();
                _proyToast(data.already_member ? (name + ' ya es miembro') : (name + ' agregado al equipo'));
                // Re-fetch del detalle para refrescar avatares + equipo
                if (typeof window.proyectosVerDetalle === 'function') {
                    window.proyectosVerDetalle(currentProjectId);
                }
            } else {
                _proyToast((data && data.error) || 'No se pudo agregar el miembro');
            }
        })
        .catch(function () { _proyToast('Error de red al agregar'); });
    }

    // Click handler del chip Oportunidad
    window.proyDetailAbrirOportunidad = function(ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        var chip = el('proyDetailOppChip');
        if (!chip) return;
        var oppId = chip.getAttribute('data-opp-id');
        if (!oppId) return;
        if (typeof window.crmAbrirOportunidad === 'function') {
            window.crmAbrirOportunidad(oppId);
        } else if (typeof window.proyectosAbrirOportunidad === 'function') {
            window.proyectosAbrirOportunidad(oppId);
        } else {
            // TODO: definir handler global para abrir oportunidad desde detalle de proyecto.
            window.location.href = '/app/todos/?tab=crm&mes=todos&open_opp=' + oppId;
        }
    };


    // =========================================
    //  INIT (called when section becomes active)
    // =========================================

    var _currentMainTab = 'programa';

    window.proyectosInit = function() {
        currentProjectId = null;
        currentFilter = 'todos';
        searchQuery = '';
        var searchInput = el('proySearch');
        if (searchInput) searchInput.value = '';
        // Defense in depth: asegurar que el topbar del listado y la
        // sección estén visibles cuando entramos al módulo.
        var listTop = el('proyListTopbar');
        if (listTop) listTop.style.display = '';
        var section = el('proyectosSection');
        if (section) section.style.display = '';
        proySetMainTab('programa');
    };
    window.proyectosAbrir = window.proyectosInit;


    // =========================================
    //  LIST VIEW
    // =========================================

    function proyectosCargarLista() {
        // Update filter pill active state
        var pills = document.querySelectorAll('.proy-filter-pill');
        pills.forEach(function(pill) {
            pill.classList.toggle('active', pill.getAttribute('data-filter') === currentFilter);
        });

        var url = '/app/api/iamet/proyectos/';
        if (currentFilter !== 'todos') {
            url += '?status=' + currentFilter;
        }

        _fetch(url).then(function(resp) {
            if (resp.ok || resp.success) {
                _cachedProjects = resp.data || [];
                var filtered = getFilteredProjects();
                renderProjectCards(filtered);
            } else {
                console.error('Error cargando proyectos:', resp.error);
            }
        }).catch(function(err) {
            console.error('Error de red cargando proyectos:', err);
        });
    }

    function getFilteredProjects() {
        var filtered = _cachedProjects.slice();

        // Search filter (client-side on cached data)
        if (searchQuery) {
            var q = searchQuery.toLowerCase();
            filtered = filtered.filter(function(p) {
                return (p.nombre && p.nombre.toLowerCase().indexOf(q) !== -1) ||
                       (p.cliente_nombre && p.cliente_nombre.toLowerCase().indexOf(q) !== -1) ||
                       (p.descripcion && p.descripcion.toLowerCase().indexOf(q) !== -1);
            });
        }

        // Sort
        if (typeof window._proyApplySort === 'function') {
            filtered = window._proyApplySort(filtered);
        }

        return filtered;
    }

    window.proyectosFilterStatus = function(status) {
        currentFilter = status;
        proyectosCargarLista();
    };

    window.proyectosBuscar = function() {
        var searchInput = el('proySearch');
        searchQuery = searchInput ? searchInput.value.trim() : '';
        var filtered = getFilteredProjects();
        renderProjectCards(filtered);
    };

    // ── Nueva UI: Filtro dropdown + Ordenar dropdown ──────────────
    var _currentSort = 'recientes';

    window.proyFilterMenuToggle = function (e) {
        if (e) e.stopPropagation();
        var m = el('proyFilterMenu');
        if (!m) return;
        var open = m.style.display === 'block';
        // Cerrar cualquier otro menu abierto
        var sm = el('proySortMenu'); if (sm) sm.style.display = 'none';
        m.style.display = open ? 'none' : 'block';
    };
    window.proySortMenuToggle = function (e) {
        if (e) e.stopPropagation();
        var m = el('proySortMenu');
        if (!m) return;
        var open = m.style.display === 'block';
        var fm = el('proyFilterMenu'); if (fm) fm.style.display = 'none';
        m.style.display = open ? 'none' : 'block';
    };
    // Cerrar menus al click fuera
    document.addEventListener('click', function (e) {
        var fm = el('proyFilterMenu');
        var sm = el('proySortMenu');
        if (fm && fm.style.display === 'block') {
            var wrap = fm.closest('.proy-facet-wrap');
            if (wrap && !wrap.contains(e.target)) fm.style.display = 'none';
        }
        if (sm && sm.style.display === 'block') {
            var wrap2 = sm.closest('.proy-facet-wrap');
            if (wrap2 && !wrap2.contains(e.target)) sm.style.display = 'none';
        }
    });

    window.proyFilterPick = function (value, label) {
        var btn = el('proyFilterBtn');
        var lbl = el('proyFilterLabel');
        if (lbl) lbl.textContent = label || 'Filtro';
        if (btn) btn.classList.toggle('active', value !== 'todos');
        el('proyFilterMenu').style.display = 'none';
        proyectosFilterStatus(value);
    };

    window.proySortPick = function (value, label) {
        var btn = el('proySortBtn');
        var lbl = el('proySortLabel');
        if (lbl) lbl.textContent = label || 'Ordenar';
        if (btn) btn.classList.toggle('active', value !== 'recientes');
        el('proySortMenu').style.display = 'none';
        _currentSort = value;
        proyectosCargarLista();
    };

    // Aplica el sort actual sobre la lista filtrada
    function _applySort(list) {
        if (!_currentSort || _currentSort === 'recientes') return list;
        var arr = list.slice();
        if (_currentSort === 'antiguos') {
            arr.sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
        } else if (_currentSort === 'monto_desc') {
            arr.sort(function (a, b) { return (parseFloat(b.monto || 0) - parseFloat(a.monto || 0)); });
        } else if (_currentSort === 'monto_asc') {
            arr.sort(function (a, b) { return (parseFloat(a.monto || 0) - parseFloat(b.monto || 0)); });
        }
        return arr;
    }
    // Expose so getFilteredProjects can chain it
    window._proyApplySort = _applySort;


    // =========================================
    //  RENDER: PROJECTS TABLE (v2 — design system)
    //  Reemplaza las cards por una tabla sin columna ID,
    //  con "Oportunidad" antes de la fecha.
    // =========================================

    // Helper: chip de servicio basado en producto o tipo
    function _servicioChipHtml(value) {
        if (!value) return '<span class="proy-tv2-chip proy-tv2-chip-default">—</span>';
        var v = String(value).toLowerCase();
        var cls = 'proy-tv2-chip-default';
        var label = value;
        if (v.indexOf('cctv') !== -1 || v.indexOf('camara') !== -1 || v.indexOf('video') !== -1 || v.indexOf('avigilion') !== -1 || v.indexOf('axis') !== -1 || v.indexOf('genetec') !== -1) {
            cls = 'proy-tv2-chip-cctv'; label = 'CCTV';
        } else if (v.indexOf('acces') !== -1) {
            cls = 'proy-tv2-chip-acceso'; label = 'Control de Acceso';
        } else if (v.indexOf('panduit') !== -1 || v.indexOf('cable') !== -1) {
            cls = 'proy-tv2-chip-cableado'; label = 'Cableado';
        } else if (v.indexOf('voceo') !== -1) {
            cls = 'proy-tv2-chip-voceo'; label = 'Voceo';
        } else if (v.indexOf('alarma') !== -1) {
            cls = 'proy-tv2-chip-alarma'; label = 'Alarma';
        } else if (v.indexOf('telefon') !== -1 || v.indexOf('cisco') !== -1) {
            cls = 'proy-tv2-chip-telefonia'; label = 'Telefonía';
        } else if (v.indexOf('zebra') !== -1 || v.indexOf('apc') !== -1) {
            cls = 'proy-tv2-chip-default'; label = value;
        }
        return '<span class="proy-tv2-chip ' + cls + '">' + label + '</span>';
    }

    // Helper: pip bar 1-5 de fases
    function _phasesBarHtml(maxFase, total) {
        var html = '<span class="proy-tv2-phases">';
        for (var i = 1; i <= 5; i++) {
            html += '<span class="proy-tv2-phase-pip' + (i <= maxFase ? ' on' : '') + '"></span>';
        }
        if (total > 0) {
            html += '<span class="proy-tv2-phase-count">' + total + '</span>';
        }
        html += '</span>';
        return html;
    }

    // Helper: fecha corta tipo "15 Abr 2026"
    function _fmtShortDate(iso) {
        if (!iso) return '\u2014';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        var MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
    }

    // Helper: escape html
    function _esc(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
    }

    function renderProjectCards(projects) {
        // Nombre histórico para compatibilidad; delega al nuevo renderer
        return renderProjectsTable(projects);
    }

    function renderProjectsTable(projects) {
        var body = el('proyListBody');
        var emptyEl = el('proyEmpty');
        var view = el('proyListView');
        if (!body) return;

        if (!projects || projects.length === 0) {
            body.innerHTML = '';
            if (view) view.style.display = 'none';
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (view) view.style.display = '';
        if (emptyEl) emptyEl.style.display = 'none';

        var html = '';
        projects.forEach(function (p) {
            var cliente = p.cliente_nombre || '—';
            var monto = p.oportunidad_monto || p.utilidad_presupuestada || 0;
            var montoHtml = '$' + Number(monto).toLocaleString('es-MX', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            var status = p.status || 'planning';
            var statusLbl = statusLabel(status).toUpperCase();
            var servicio = p.oportunidad_producto || 'SIN SERVICIO';
            // Progreso: porcentaje basado en fase_max de levantamientos
            var fasePct = Math.round(((p.levantamiento_fase_max || 0) / 5) * 100);
            var faseLbl = (p.levantamiento_fase_max || 0) + '/5';
            var etapaCorta = p.oportunidad_etapa ? p.oportunidad_etapa.toUpperCase() : faseLbl;
            // Stroke neutro (sin color-logic)
            var strokeColor = '#3B82F6';

            var oppPillHtml;
            if (p.oportunidad_id) {
                oppPillHtml = '<div class="crm-list-activity-pill has-activity" onclick="event.stopPropagation(); proyectosAbrirOportunidad(' + p.oportunidad_id + ')" title="' + _esc(p.oportunidad_nombre || '') + '">' +
                    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' +
                    '<span>' + _esc(p.oportunidad_nombre || 'Ver oportunidad') + '</span>' +
                '</div>';
            } else {
                oppPillHtml = '<div class="crm-list-activity-pill">' +
                    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' +
                    '<span>Sin oportunidad</span>' +
                '</div>';
            }

            html += '<div class="crm-data-row crm-list-row" onclick="proyectosVerDetalle(' + p.id + ')">' +
                // Strip neutro (sin colores/warm)
                '<div class="crm-list-strip"></div>' +
                // Columna 1: Proyecto / Cliente
                '<div class="crm-list-cell" style="flex:2.6;padding-left:22px;">' +
                    '<div class="crm-list-title">' +
                        '<span>' + _esc(_truncate(p.nombre, 42)) + '</span>' +
                    '</div>' +
                    '<div class="crm-list-sub">' + _esc(_truncate(cliente, 34)) + '</div>' +
                '</div>' +
                // Columna 2: Monto
                '<div class="crm-list-cell" style="flex:1;">' +
                    '<span class="crm-list-value">' + montoHtml + '</span>' +
                '</div>' +
                // Columna 3: Servicio
                '<div class="crm-list-cell" style="flex:0.9;">' +
                    '<span class="crm-list-brand-badge">' + _esc(servicio) + '</span>' +
                '</div>' +
                // Columna 4: Estado (donut + label)
                '<div class="crm-list-cell" style="flex:1.3;">' +
                    '<div class="crm-list-state">' +
                        '<div class="crm-list-progress">' +
                            '<svg viewBox="0 0 36 36" style="width:36px;height:36px;transform:rotate(-90deg);">' +
                                '<circle cx="18" cy="18" r="15.5" fill="none" stroke="#E5E7EB" stroke-width="2.5" pathLength="100"/>' +
                                '<circle cx="18" cy="18" r="15.5" fill="none" stroke="' + strokeColor + '" stroke-width="2.5" pathLength="100" stroke-dasharray="' + fasePct + ' 100" stroke-linecap="round"/>' +
                            '</svg>' +
                            '<span>' + fasePct + '%</span>' +
                        '</div>' +
                        '<div class="crm-list-state-text">' +
                            '<div class="crm-list-state-label">' + statusLbl + '</div>' +
                            '<div class="crm-list-state-stage">' + _esc(etapaCorta) + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                // Columna 5: Oportunidad (pill style)
                '<div class="crm-list-cell" style="flex:1.7;">' + oppPillHtml + '</div>' +
                // Columna 6: Fecha
                '<div class="crm-list-cell" style="flex:0.8;text-align:right;padding-right:18px;">' +
                    '<span style="font-size:0.72rem;color:#94A3B8;white-space:nowrap;">' + _fmtShortDate(p.created_at) + '</span>' +
                '</div>' +
            '</div>';
        });
        body.innerHTML = html;
    }

    // Helper truncate
    function _truncate(s, n) {
        if (!s) return '';
        s = String(s);
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    // Abre la oportunidad desde el link en la fila del proyecto
    window.proyectosAbrirOportunidad = function (oppId) {
        if (!oppId) return;
        // En la PWA de levantamientos no abrir widget de oportunidad
        if (document.body.classList.contains('lev-app')) return;
        if (typeof window.openDetalle === 'function') {
            window.openDetalle(oppId);
            return;
        }
        window.location.href = '/app/todos/?tab=crm&mes=todos&open_opp=' + oppId;
    };


    // =========================================
    //  DETAIL VIEW (opens overlay)
    // =========================================

    // Lista v\u00e1lida de tabs del detalle (incluye aliases nuevos +
    // nombres legacy para no romper c\u00f3digo viejo / deep-links). Si llega
    // algo distinto, caemos a 'resumen'.
    var _DETAIL_TAB_VALID = {
        resumen: 1, dashboard: 1,
        tareas: 1, programa: 1,
        'programa-obra': 1,
        partidasv4: 1, partidas: 1, levantamientos: 1,
        drive: 1,
        info: 1, equipo: 1, comunicacion: 1, reportes: 1,
        financiero: 1,
    };

    function _proyDetailNormalizeTab(t) {
        if (!t) {
            // Persistencia ligera: si no hay initialTab, intenta recuperar
            // el último tab activo guardado en localStorage.
            try {
                var saved = localStorage.getItem('_proy_last_tab');
                if (saved && _DETAIL_TAB_VALID[saved]) return saved;
            } catch (e) {}
            return 'resumen';
        }
        return _DETAIL_TAB_VALID[t] ? t : 'resumen';
    }

    // Sincroniza la URL con el proyecto/tab activos. Se usa tambi\u00e9n desde
    // proyectosSetTab para que un share-link refleje la secci\u00f3n actual.
    function _proySyncUrl(projectId, tab) {
        try {
            var url = new URL(window.location.href);
            if (projectId) {
                url.searchParams.set('open_proyecto', String(projectId));
                if (tab) url.searchParams.set('tab', tab);
                else url.searchParams.delete('tab');
            } else {
                url.searchParams.delete('open_proyecto');
                url.searchParams.delete('tab');
            }
            window.history.replaceState({}, '', url.pathname + (url.search || '') + (url.hash || ''));
        } catch (e) { /* noop */ }
    }

    // proyectosVerDetalle(projectId, initialTab?)
    //   initialTab opcional \u2192 permite deep-link a una secci\u00f3n espec\u00edfica
    //   (?open_proyecto=N&tab=tareas). Si no se pasa, abrimos en "Resumen".
    window.proyectosVerDetalle = function(projectId, initialTab) {
        currentProjectId = projectId;
        // Expone el id activo para que otros módulos (ej. programa_obra.js)
        // sepan qué proyecto está abierto sin tener que pasarlo por args.
        window._proyectoActualId = projectId;
        var tab = _proyDetailNormalizeTab(initialTab);
        currentTab = tab;

        // Defense in depth: garantiza que NADA esté visible debajo del
        // detalle del proyecto. Cubre cualquier camino de entrada (Spotlight,
        // deep-link, click en breadcrumb de tarea, etc). Para el ingeniero
        // esto oculta dashIngRoot que sino quedaba flotando arriba.
        var _dashIng = document.getElementById('dashIngRoot');
        if (_dashIng) _dashIng.style.display = 'none';
        var _crmContent = document.getElementById('crmContentSection');
        if (_crmContent) _crmContent.style.display = 'none';
        var _tareasSec = document.getElementById('tareasSection');
        if (_tareasSec) _tareasSec.classList.remove('active');
        var _calOv = document.getElementById('widgetCalendarioMaster');
        if (_calOv && _calOv.classList.contains('is-page-mode')) {
            _calOv.style.display = 'none';
        }

        // Inline: el detalle vive como página dentro del flujo, no como
        // overlay. Ocultamos el listado completo y mostramos el detalle.
        var section = el('proyectosSection');
        if (section) section.style.display = 'none';
        var detail = el('widgetProyectoDetalle');
        if (detail) detail.classList.add('is-open');

        // El topbar del listado (#proyListTopbar) vive DENTRO de
        // #proyectosSection que ya quedó oculto — NO seteamos un
        // display:none directo en el topbar para evitar que ese estilo
        // inline persista y deje el topbar oculto si la sección se
        // vuelve a mostrar por otra vía (sin pasar por proyectosVolverLista).

        // Estado vac\u00edo inmediato (evita header con datos del proyecto previo)
        renderProjectOverview(null);

        // Fetch project detail + financials
        _fetch('/app/api/iamet/proyectos/' + projectId + '/').then(function(resp) {
            if (resp.ok || resp.success) {
                var project = resp.data;
                _cachedProjectDetail = project;

                // Render header redise\u00f1ado + 3 KPI cards (consume project.overview si existe)
                renderProjectOverview(project);

                // Render info tab if it's the current tab
                if (currentTab === 'info') {
                    renderInfo();
                }
            } else {
                console.error('Error cargando proyecto:', resp.error);
            }
        }).catch(function(err) {
            console.error('Error de red cargando proyecto:', err);
        });

        proyectosSetTab(tab);
        _proySyncUrl(projectId, tab);
    };

    window.proyectosVolverLista = function() {
        currentProjectId = null;
        window._proyectoActualId = null;
        // Inline: cierra el detalle (quita .is-open) y restaura la lista.
        var detail = el('widgetProyectoDetalle');
        if (detail) detail.classList.remove('is-open');
        var section = el('proyectosSection');
        if (section) section.style.display = '';

        // Restaurar topbar del listado por si qued\u00f3 con display:none.
        var listTop = el('proyListTopbar');
        if (listTop) listTop.style.display = '';

        // Cierra el dropdown "M\u00e1s \u25be" si qued\u00f3 abierto
        if (typeof _proyMoreMenuClose === 'function') _proyMoreMenuClose();

        // Limpia los query params del proyecto para no re-disparar la apertura
        _proySyncUrl(null, null);
    };


    // =========================================
    //  KPIs (legacy stubs — el header rediseñado renderiza
    //  Salud / Financiero / Cronograma desde data.overview en
    //  renderProjectOverview(). Estas funciones se conservan como
    //  no-ops para no romper call sites antiguos en tabs).
    // =========================================

    function renderKPIsFromAPI(projectId) { /* no-op: KPIs vienen de overview */ }
    function renderOperationalKPIs(projectId) { /* no-op */ }
    function renderFinancialKPIs(projectId) { /* no-op */ }


    // =========================================
    //  TABS
    // =========================================

    // Mapeo de los nombres "públicos" (data-tab del topbar / argumento del
    // deep-link) al ID del DOM <div id="proyPane_*">. Permite renombrar
    // la UI sin tocar los IDs del HTML que están cableados con CSS / código
    // legacy. Si el nombre no está aquí, asumimos que el ID es proyPane_<name>.
    var _PANE_ALIAS = {
        resumen: 'proyPane_dashboard',          // tab "Resumen" reusa el pane de dashboard
        levantamientos: 'proyPane_partidas',    // tab "Levantamientos" reusa el pane partidas legacy
        dashboard: 'proyPane_dashboard',        // legacy direct
        partidas: 'proyPane_partidas',          // legacy direct
    };

    // Nombres de tabs visibles en la barra del detalle (lo que aparece como
    // botón en .proy-v3-topbar-tabs). Sirve para resolver qué activar visual-
    // mente cuando el tab activo es uno escondido bajo "Más ▾".
    var _DETAIL_VISIBLE_TABS = ['resumen','tareas','programa','partidasv4','levantamientos','drive'];
    var _DETAIL_MORE_TABS    = ['equipo','comunicacion','reportes','info'];

    window.proyectosSetTab = function(tabName) {
        tabName = tabName || 'resumen';
        currentTab = tabName;

        // Toggle tab buttons. Si el tab está dentro del menú "Más ▾", marcamos
        // como activo ese botón (en lugar del item del menú, que no está visible).
        var underMore = _DETAIL_MORE_TABS.indexOf(tabName) !== -1;
        var tabs = document.querySelectorAll('.proy-tab-btn');
        tabs.forEach(function(t) {
            var dt = t.getAttribute('data-tab');
            var match = (dt === tabName) || (underMore && dt === 'more');
            t.classList.toggle('active', !!match);
        });

        // Hide all panes
        var panes = document.querySelectorAll('.proy-tab-pane');
        panes.forEach(function(pane) {
            pane.style.display = 'none';
        });

        // Show the selected pane (resuelve alias si aplica)
        var paneId = _PANE_ALIAS[tabName] || ('proyPane_' + tabName);
        var activePane = el(paneId);
        if (activePane) activePane.style.display = '';

        // Cierra el dropdown "Más ▾" cuando se navega
        if (typeof _proyMoreMenuClose === 'function') _proyMoreMenuClose();

        // Sincroniza URL para que la sección actual sea compartible.
        if (currentProjectId) _proySyncUrl(currentProjectId, tabName);

        // Persistir el último tab para que sobreviva al refresh aunque
        // la URL no traiga ?tab=…
        try { localStorage.setItem('_proy_last_tab', tabName); } catch (e) {}

        // Render data
        if (!currentProjectId) return;
        switch (tabName) {
            case 'info':           renderInfo(); break;
            case 'partidas':       // legacy alias
            case 'levantamientos': renderLevantamientos(currentProjectId); break;
            case 'partidasv4':     renderPartidas(currentProjectId); break;
            case 'financiero':     renderFinanciero(currentProjectId); break;
            case 'programa':       renderProgramaObra(currentProjectId); break;
            case 'tareas':         renderTareas(currentProjectId); break;
            case 'drive':          _renderDrive(currentProjectId); break;
            case 'resumen':        // pane "dashboard" es estático (overview ya renderizado)
            case 'dashboard':      break;
            // equipo / comunicacion / reportes son placeholders ("Próximamente")
            case 'equipo':
            case 'comunicacion':
            case 'reportes':       break;
        }

        // Update KPIs based on active tab
        if (tabName === 'partidas' || tabName === 'levantamientos' || tabName === 'partidasv4' || tabName === 'programa') {
            renderOperationalKPIs(currentProjectId);
        } else if (tabName === 'financiero') {
            renderFinancialKPIs(currentProjectId);
        } else {
            renderOperationalKPIs(currentProjectId);
        }
    };


    // =========================================
    //  RENDER: PARTIDAS (Line Items)
    // =========================================

    // --- Cached OCs for inline display under partidas ---
    var _cachedOCsForPartidas = [];

    function renderPartidas(projectId) {
        var container = el('proyPartidasBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';

        // Fetch partidas and OCs in parallel
        var partidasPromise = _fetch('/app/api/iamet/proyectos/' + projectId + '/partidas/');
        var ocsPromise = _fetch('/app/api/iamet/proyectos/' + projectId + '/oc/');

        Promise.all([partidasPromise, ocsPromise]).then(function(results) {
            var resp = results[0];
            var ocResp = results[1];

            // Cache OCs
            _cachedOCsForPartidas = (ocResp.ok || ocResp.success) ? (ocResp.data || []) : [];

            if (resp.ok || resp.success) {
                var respData = resp.data || {};
                var items = Array.isArray(respData) ? respData : (respData.partidas || []);
                var apiTotales = Array.isArray(respData) ? null : (respData.totales || null);

                if (items.length === 0) {
                    container.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:40px;color:#8e8e93">' +
                        '<div style="font-size:0.95rem;color:#48484A;margin-bottom:6px;">Aún no hay partidas en este proyecto</div>' +
                        '<div style="font-size:0.78rem;color:#86868B;">Las partidas se llenan automáticamente cuando un ingeniero importa una volumetría desde Excel ' +
                        'o marca una volumetría como completada en la <b>Fase 3</b> del levantamiento.</div>' +
                        '</td></tr>';
                    var foot = el('proyPartidasFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var html = '';
                items.forEach(function(item, idx) {
                    var totalCost = item.costo_total || ((item.costo_unitario || 0) * (item.cantidad || 0));
                    var totalSale = item.precio_venta_total || ((item.precio_venta_unitario || 0) * (item.cantidad || 0));
                    var totalProfit = item.ganancia || (totalSale - totalCost);

                    // Encode item data as JSON attribute for menu actions
                    var itemJson = encodeURIComponent(JSON.stringify(item));

                    var rowStyle = 'border-bottom:1px solid rgba(0,0,0,0.04);';
                    var cellStyle = 'padding:14px 14px;';
                    html += '<tr class="proy-partida-row" data-partida-idx="' + idx + '" style="' + rowStyle + '">' +
                        '<td style="' + cellStyle + '">' + categoryDot(item.categoria) + (item.categoria || '\u2014') + '</td>' +
                        '<td style="' + cellStyle + '" title="' + (item.descripcion || '') + '">' + truncate(item.descripcion, 32) + '</td>' +
                        '<td style="' + cellStyle + '">' + (item.marca || '\u2014') + '</td>' +
                        '<td style="' + cellStyle + 'font-size:0.72rem;color:#aeaeb2">' + (item.numero_parte || '\u2014') + '</td>' +
                        '<td style="' + cellStyle + 'text-align:center">' + (item.cantidad || 0) + '</td>' +
                        '<td style="' + cellStyle + 'text-align:center;color:' + ((item.cantidad_pendiente || 0) > 0 ? '#f59e0b' : '#10b981') + '">' + (item.cantidad_pendiente || 0) + '</td>' +
                        '<td style="' + cellStyle + 'text-align:right">' + fmtMoney(item.precio_lista) + '</td>' +
                        '<td style="' + cellStyle + 'text-align:center">' + (item.descuento || 0) + '%</td>' +
                        '<td style="' + cellStyle + 'text-align:right">' + fmtMoney(item.costo_unitario) + '</td>' +
                        '<td style="' + cellStyle + 'text-align:right">' + fmtMoney(item.precio_venta_unitario) + '</td>' +
                        '<td style="' + cellStyle + 'text-align:right;color:#10b981">' + fmtMoney(totalProfit) + '</td>' +
                        '<td style="' + cellStyle + '">' + truncate(item.proveedor, 16) + '</td>' +
                        '<td style="' + cellStyle + '"><span class="proy-badge ' + statusClass(item.status) + '">' + statusLabel(item.status) + '</span></td>' +
                        '<td style="text-align:center;width:36px;position:relative;">' +
                            '<button class="proy-partida-menu-btn" data-partida="' + itemJson + '" onclick="event.stopPropagation();proyectosPartidaMenuToggle(this)" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:#8e8e93;padding:4px 8px;border-radius:6px;line-height:1;" title="Opciones">' +
                                '\u22EF' +
                            '</button>' +
                        '</td>' +
                    '</tr>';

                    // Sub-row for OCs of this partida
                    var partidaOCs = _cachedOCsForPartidas.filter(function(oc) {
                        return oc.partida_id === item.id;
                    });
                    if (partidaOCs.length > 0) {
                        html += '<tr class="proy-partida-oc-row">' +
                            '<td colspan="14" style="padding:0 0 0 28px;background:rgba(0,122,255,0.03);border-top:none;">' +
                                '<div style="display:flex;flex-direction:column;gap:4px;padding:8px 0;">';
                        partidaOCs.forEach(function(oc) {
                            var ocAmount = oc.monto_total || ((oc.cantidad || 0) * (oc.precio_unitario || 0));
                            var ocJson = encodeURIComponent(JSON.stringify(oc));
                            var partidaJson = encodeURIComponent(JSON.stringify(item));
                            html += '<div style="display:flex;align-items:center;gap:12px;font-size:0.75rem;color:#636366;padding:6px 10px;border-radius:6px;background:rgba(0,122,255,0.04);position:relative;">' +
                                '<span style="color:#007aff;font-weight:600;">' + (oc.numero_oc || 'OC') + '</span>' +
                                '<span>' + (oc.cantidad || 0) + ' uds</span>' +
                                '<span>' + (oc.proveedor || '\u2014') + '</span>' +
                                '<span class="proy-badge ' + statusClass(oc.status) + '" style="font-size:0.68rem;padding:1px 6px;">' + statusLabel(oc.status) + '</span>' +
                                '<span style="color:#8e8e93;">' + fmtDate(oc.fecha_emision) + '</span>' +
                                '<span style="margin-left:auto;font-weight:600;">' + fmtMoney(ocAmount) + '</span>' +
                                '<button class="proy-oc-menu-btn" data-oc="' + ocJson + '" data-partida="' + partidaJson + '" onclick="event.stopPropagation();proyOcMenuToggle(this)" style="background:none;border:none;cursor:pointer;font-size:1rem;color:#8e8e93;padding:2px 8px;border-radius:6px;line-height:1;" title="Opciones">\u22ef</button>' +
                            '</div>';
                        });
                        html += '</div></td></tr>';
                    }
                });

                container.innerHTML = html;

                // Totals -- use API totals if available, otherwise calculate
                var totals = apiTotales || {};
                var totalsCost = totals.costo_total || totals.total_costo || 0;
                var totalsSale = totals.precio_venta_total || totals.total_venta || 0;
                var totalsProfit = totals.ganancia || totals.total_ganancia || 0;

                if (!apiTotales) {
                    totalsCost = 0; totalsSale = 0; totalsProfit = 0;
                    items.forEach(function(item) {
                        totalsCost += (item.costo_unitario || 0) * (item.cantidad || 0);
                        totalsSale += (item.precio_venta_unitario || 0) * (item.cantidad || 0);
                        totalsProfit += (item.ganancia || ((item.precio_venta_unitario || 0) - (item.costo_unitario || 0))) * (item.cantidad || 0);
                    });
                }

                // KPIs ahora vienen de project.overview en renderProjectOverview;
                // ya no sobreescribimos el grid de cards desde aquí.
                var foot = el('proyPartidasFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td colspan="8" style="text-align:right;color:#8e8e93">Totales</td>' +
                        '<td style="text-align:right">' + fmtMoney(totalsCost) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(totalsSale) + '</td>' +
                        '<td style="text-align:right;color:#10b981">' + fmtMoney(totalsProfit) + '</td>' +
                        '<td colspan="3"></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:40px;color:#ef4444">Error al cargar partidas</td></tr>';
                console.error('Error cargando partidas:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:40px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando partidas:', err);
        });
    }


    // =========================================
    //  PARTIDA CONTEXT MENU
    // =========================================

    window.proyectosPartidaMenuToggle = function(btn) {
        // Remove any existing menu
        _closePartidaMenu();

        var item = JSON.parse(decodeURIComponent(btn.getAttribute('data-partida')));

        var menu = document.createElement('div');
        menu.id = 'proyPartidaContextMenu';
        menu.style.cssText = 'position:absolute;right:0;top:100%;z-index:10600;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.18);padding:6px 0;min-width:190px;animation:fadeIn 0.12s ease;';

        var menuItems = [
            { icon: '\uD83D\uDCDD', label: 'Editar', color: '#1d1d1f', action: 'edit' },
            { icon: '\uD83D\uDED2', label: 'Mandar a comprar', color: '#007AFF', action: 'buy' },
            { icon: '\uD83D\uDDD1', label: 'Eliminar', color: '#EF4444', action: 'delete' }
        ];

        var menuHtml = '';
        menuItems.forEach(function(mi) {
            menuHtml += '<button class="proy-ctx-menu-item" data-action="' + mi.action + '" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px;border:none;background:none;cursor:pointer;font-size:0.82rem;color:' + mi.color + ';text-align:left;transition:background 0.15s;" onmouseover="this.style.background=\'#f5f5f7\'" onmouseout="this.style.background=\'none\'">' +
                '<span style="font-size:1rem;width:20px;text-align:center;">' + mi.icon + '</span>' +
                '<span style="font-weight:500;">' + mi.label + '</span>' +
            '</button>';
        });
        menu.innerHTML = menuHtml;

        // Position relative to button
        btn.parentElement.style.position = 'relative';
        btn.parentElement.appendChild(menu);

        // Bind actions
        menu.querySelectorAll('.proy-ctx-menu-item').forEach(function(menuBtn) {
            menuBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var action = menuBtn.getAttribute('data-action');
                _closePartidaMenu();
                if (action === 'edit') {
                    _openEditPartidaDialog(item);
                } else if (action === 'buy') {
                    _openComprarPartidaDialog(item);
                } else if (action === 'delete') {
                    _confirmDeletePartida(item);
                }
            });
        });
    };

    function _closePartidaMenu() {
        var existing = document.getElementById('proyPartidaContextMenu');
        if (existing) existing.remove();
    }

    // Close menu on outside click
    document.addEventListener('click', function() {
        _closePartidaMenu();
    });


    // =========================================
    //  DIALOG: EDITAR PARTIDA
    // =========================================

    function _openEditPartidaDialog(item) {
        var existing = document.getElementById('proyDialogoEditarPartida');
        if (existing) existing.remove();

        var ov = document.createElement('div');
        ov.id = 'proyDialogoEditarPartida';
        ov.className = 'proy-dialog-overlay';
        ov.style.cssText = 'display:flex;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10500;align-items:center;justify-content:center;';
        ov.onclick = function(e) { if (e.target === ov) ov.remove(); };

        ov.innerHTML =
            '<div style="background:#fff;border-radius:16px;padding:28px;width:min(480px,92vw);max-height:85vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,0.25);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
                    '<h3 style="margin:0;font-size:1.05rem;font-weight:700;color:#1d1d1f;">Editar Partida</h3>' +
                    '<button onclick="document.getElementById(\'proyDialogoEditarPartida\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#8e8e93;padding:4px;">&times;</button>' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;gap:14px;">' +
                    '<div>' +
                        '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Descripcion</label>' +
                        '<input type="text" id="proyEditPartDesc" class="proy-info-input" value="' + (item.descripcion || '').replace(/"/g, '&quot;') + '">' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
                        '<div>' +
                            '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Marca</label>' +
                            '<input type="text" id="proyEditPartMarca" class="proy-info-input" value="' + (item.marca || '').replace(/"/g, '&quot;') + '">' +
                        '</div>' +
                        '<div>' +
                            '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Numero de parte</label>' +
                            '<input type="text" id="proyEditPartNumParte" class="proy-info-input" value="' + (item.numero_parte || '').replace(/"/g, '&quot;') + '">' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">' +
                        '<div>' +
                            '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Cantidad</label>' +
                            '<input type="number" id="proyEditPartCantidad" class="proy-info-input" value="' + (item.cantidad || 0) + '" min="1">' +
                        '</div>' +
                        '<div>' +
                            '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Costo unitario</label>' +
                            '<input type="number" id="proyEditPartCostoUnit" class="proy-info-input" value="' + (item.costo_unitario || 0) + '" step="0.01">' +
                        '</div>' +
                        '<div>' +
                            '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Precio venta unit.</label>' +
                            '<input type="number" id="proyEditPartVentaUnit" class="proy-info-input" value="' + (item.precio_venta_unitario || 0) + '" step="0.01">' +
                        '</div>' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Proveedor</label>' +
                        '<input type="text" id="proyEditPartProveedor" class="proy-info-input" value="' + (item.proveedor || '').replace(/"/g, '&quot;') + '">' +
                    '</div>' +
                '</div>' +
                '<div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px;">' +
                    '<button onclick="document.getElementById(\'proyDialogoEditarPartida\').remove()" style="padding:10px 20px;border-radius:10px;border:1px solid #e5e5ea;background:#f5f5f7;color:#3c3c43;font-size:0.85rem;font-weight:600;cursor:pointer;">Cancelar</button>' +
                    '<button id="proyEditPartGuardarBtn" style="padding:10px 20px;border-radius:10px;border:none;background:#007AFF;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;">Guardar</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(ov);

        // Bind save
        document.getElementById('proyEditPartGuardarBtn').addEventListener('click', function() {
            var desc = (document.getElementById('proyEditPartDesc') || {}).value || '';
            var marca = (document.getElementById('proyEditPartMarca') || {}).value || '';
            var numParte = (document.getElementById('proyEditPartNumParte') || {}).value || '';
            var cantidad = parseInt((document.getElementById('proyEditPartCantidad') || {}).value) || 0;
            var costoUnit = parseFloat((document.getElementById('proyEditPartCostoUnit') || {}).value) || 0;
            var ventaUnit = parseFloat((document.getElementById('proyEditPartVentaUnit') || {}).value) || 0;
            var proveedor = (document.getElementById('proyEditPartProveedor') || {}).value || '';

            if (!desc.trim()) {
                _showToast('La descripcion es obligatoria');
                return;
            }

            _fetch('/app/api/iamet/partidas/' + item.id + '/actualizar/', {
                method: 'POST',
                body: {
                    descripcion: desc.trim(),
                    marca: marca.trim(),
                    numero_parte: numParte.trim(),
                    cantidad: cantidad,
                    costo_unitario: costoUnit,
                    precio_venta_unitario: ventaUnit,
                    proveedor: proveedor.trim()
                }
            }).then(function(resp) {
                if (resp.ok || resp.success) {
                    document.getElementById('proyDialogoEditarPartida').remove();
                    _showToast('Partida actualizada');
                    renderPartidas(currentProjectId);
                } else {
                    _showToast(resp.error || 'Error al actualizar partida');
                }
            }).catch(function(err) {
                _showToast('Error de conexion');
                console.error('Error actualizando partida:', err);
            });
        });
    }


    // =========================================
    //  DIALOG: MANDAR A COMPRAR (Crear OC desde partida)
    // =========================================

    function _openComprarPartidaDialog(item) {
        var existing = document.getElementById('proyDialogoComprarPartida');
        if (existing) existing.remove();

        var pendiente = item.cantidad_pendiente || 0;
        if (pendiente <= 0) {
            _showToast('Esta partida no tiene cantidad pendiente');
            return;
        }

        var ov = document.createElement('div');
        ov.id = 'proyDialogoComprarPartida';
        ov.className = 'proy-dialog-overlay';
        ov.style.cssText = 'display:flex;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10500;align-items:center;justify-content:center;';
        ov.onclick = function(e) { if (e.target === ov) ov.remove(); };

        var precioUnit = item.costo_unitario || 0;

        ov.innerHTML =
            '<div style="background:#fff;border-radius:16px;padding:28px;width:min(440px,92vw);box-shadow:0 24px 60px rgba(0,0,0,0.25);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
                    '<h3 style="margin:0;font-size:1.05rem;font-weight:700;color:#1d1d1f;">Mandar a Comprar</h3>' +
                    '<button onclick="document.getElementById(\'proyDialogoComprarPartida\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#8e8e93;padding:4px;">&times;</button>' +
                '</div>' +
                '<div style="font-size:0.82rem;color:#636366;margin-bottom:20px;padding:8px 12px;background:#f5f5f7;border-radius:8px;">' +
                    '<strong style="color:#1d1d1f;">' + (item.descripcion || '\u2014') + '</strong>' +
                    (item.marca ? ' <span style="color:#8e8e93;">\u2014 ' + item.marca + '</span>' : '') +
                '</div>' +
                '<div style="display:flex;flex-direction:column;gap:14px;">' +
                    '<div>' +
                        '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Cantidad</label>' +
                        '<input type="number" id="proyComprarCantidad" class="proy-info-input" value="' + pendiente + '" min="1" max="' + pendiente + '">' +
                        '<div style="font-size:0.72rem;color:#8e8e93;margin-top:3px;">Disponible: ' + pendiente + ' unidades</div>' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Proveedor</label>' +
                        '<input type="text" id="proyComprarProveedor" class="proy-info-input" value="' + (item.proveedor || '').replace(/"/g, '&quot;') + '">' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:0.75rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Precio unitario</label>' +
                        '<input type="number" id="proyComprarPrecioUnit" class="proy-info-input" value="' + precioUnit + '" step="0.01">' +
                    '</div>' +
                    '<div style="padding:12px;background:#f0f9ff;border-radius:10px;display:flex;align-items:center;justify-content:space-between;">' +
                        '<span style="font-size:0.82rem;font-weight:600;color:#636366;">Monto total</span>' +
                        '<span id="proyComprarTotal" style="font-size:1.1rem;font-weight:700;color:#007AFF;">' + fmtMoney(pendiente * precioUnit) + '</span>' +
                    '</div>' +
                '</div>' +
                '<div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px;">' +
                    '<button onclick="document.getElementById(\'proyDialogoComprarPartida\').remove()" style="padding:10px 20px;border-radius:10px;border:1px solid #e5e5ea;background:#f5f5f7;color:#3c3c43;font-size:0.85rem;font-weight:600;cursor:pointer;">Cancelar</button>' +
                    '<button id="proyComprarCrearBtn" style="padding:10px 20px;border-radius:10px;border:none;background:#007AFF;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;">Crear Orden de Compra</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(ov);

        // Update total in real time
        var cantInput = document.getElementById('proyComprarCantidad');
        var precioInput = document.getElementById('proyComprarPrecioUnit');
        var totalSpan = document.getElementById('proyComprarTotal');

        function updateTotal() {
            var c = parseInt(cantInput.value) || 0;
            var p = parseFloat(precioInput.value) || 0;
            totalSpan.textContent = fmtMoney(c * p);
        }
        cantInput.addEventListener('input', updateTotal);
        precioInput.addEventListener('input', updateTotal);

        // Validate max on cantidad
        cantInput.addEventListener('input', function() {
            var val = parseInt(cantInput.value) || 0;
            if (val > pendiente) cantInput.value = pendiente;
            if (val < 1 && cantInput.value !== '') cantInput.value = 1;
        });

        // Bind create
        document.getElementById('proyComprarCrearBtn').addEventListener('click', function() {
            var cantidad = parseInt(cantInput.value) || 0;
            var proveedor = (document.getElementById('proyComprarProveedor') || {}).value || '';
            var precioUnitario = parseFloat(precioInput.value) || 0;

            if (cantidad <= 0 || cantidad > pendiente) {
                _showToast('Cantidad invalida (max: ' + pendiente + ')');
                return;
            }
            if (!proveedor.trim()) {
                _showToast('El proveedor es obligatorio');
                return;
            }

            var btn = document.getElementById('proyComprarCrearBtn');
            btn.disabled = true;
            btn.textContent = 'Creando...';

            _fetch('/app/api/iamet/oc/crear/', {
                method: 'POST',
                body: {
                    proyecto_id: currentProjectId,
                    partida_id: item.id,
                    cantidad: cantidad,
                    proveedor: proveedor.trim(),
                    precio_unitario: precioUnitario
                }
            }).then(function(resp) {
                if (resp.ok || resp.success) {
                    document.getElementById('proyDialogoComprarPartida').remove();
                    _showToast('Orden de compra creada exitosamente');
                    renderPartidas(currentProjectId);
                } else {
                    btn.disabled = false;
                    btn.textContent = 'Crear Orden de Compra';
                    _showToast(resp.error || 'Error al crear OC');
                }
            }).catch(function(err) {
                btn.disabled = false;
                btn.textContent = 'Crear Orden de Compra';
                _showToast('Error de conexion');
                console.error('Error creando OC desde partida:', err);
            });
        });
    }


    // =========================================
    //  CONFIRM DELETE PARTIDA (from context menu)
    // =========================================

    function _confirmDeletePartida(item) {
        var existing = document.getElementById('proyDialogoEliminarPartida');
        if (existing) existing.remove();

        var ov = document.createElement('div');
        ov.id = 'proyDialogoEliminarPartida';
        ov.className = 'proy-dialog-overlay';
        ov.style.cssText = 'display:flex;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10500;align-items:center;justify-content:center;';
        ov.onclick = function(e) { if (e.target === ov) ov.remove(); };

        ov.innerHTML =
            '<div style="background:#fff;border-radius:16px;padding:28px;width:min(380px,90vw);text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.25);">' +
                '<div style="width:48px;height:48px;border-radius:50%;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">' +
                    '<svg width="24" height="24" fill="none" stroke="#EF4444" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
                '</div>' +
                '<div style="font-size:1rem;font-weight:700;color:#1d1d1f;margin-bottom:8px;">Eliminar partida</div>' +
                '<div style="font-size:0.85rem;color:#636366;margin-bottom:20px;">Se eliminara <strong>"' + truncate(item.descripcion, 40) + '"</strong>. Esta accion no se puede deshacer.</div>' +
                '<div style="display:flex;gap:10px;justify-content:center;">' +
                    '<button onclick="document.getElementById(\'proyDialogoEliminarPartida\').remove()" style="padding:10px 20px;border-radius:10px;border:1px solid #e5e5ea;background:#f5f5f7;color:#3c3c43;font-size:0.85rem;font-weight:600;cursor:pointer;">Cancelar</button>' +
                    '<button id="proyElimPartConfirmBtn" style="padding:10px 20px;border-radius:10px;border:none;background:#EF4444;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;">Eliminar</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(ov);

        document.getElementById('proyElimPartConfirmBtn').addEventListener('click', function() {
            _fetch('/app/api/iamet/partidas/' + item.id + '/eliminar/', {
                method: 'POST'
            }).then(function(resp) {
                if (resp.ok || resp.success) {
                    document.getElementById('proyDialogoEliminarPartida').remove();
                    _showToast('Partida eliminada');
                    if (currentProjectId) renderPartidas(currentProjectId);
                } else {
                    _showToast(resp.error || 'Error al eliminar partida');
                }
            }).catch(function(err) {
                _showToast('Error de conexion');
                console.error('Error eliminando partida:', err);
            });
        });
    }


    // =========================================
    //  RENDER: ORDENES DE COMPRA
    // =========================================

    function renderOC(projectId) {
        var container = el('proyOCBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/oc/').then(function(resp) {
            if (resp.ok || resp.success) {
                var orders = resp.data || [];
                if (orders.length === 0) {
                    container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#8e8e93">No hay ordenes de compra</td></tr>';
                    var foot = el('proyOCFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var html = '';
                var total = 0;
                orders.forEach(function(oc) {
                    var amount = oc.monto_total || ((oc.cantidad || 0) * (oc.precio_unitario || 0));
                    total += amount;
                    // Nombre clickeable para abrir el PDF
                    var nombreHtml = oc.archivo_url
                        ? '<a href="' + oc.archivo_url + '" target="_blank" style="font-weight:600;color:#007aff;text-decoration:none;white-space:nowrap;cursor:pointer;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">' + (oc.numero_oc || '\u2014') + '</a>'
                        : '<span style="font-weight:600;color:#007aff;white-space:nowrap;">' + (oc.numero_oc || '\u2014') + '</span>';

                    html += '<tr>' +
                        '<td>' + nombreHtml + '</td>' +
                        '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (oc.proveedor || '').replace(/"/g,'') + '">' + (oc.proveedor || '\u2014') + '</td>' +
                        '<td>' + (oc.descripcion || oc.partida_descripcion || '\u2014') + '</td>' +
                        '<td style="text-align:right">' + (oc.cantidad || 0) + '</td>' +
                        '<td style="text-align:right;font-weight:600;">' + fmtMoney(amount) + '</td>' +
                        '<td style="text-align:center"><span class="proy-badge ' + statusClass(oc.status) + '">' + statusLabel(oc.status) + '</span></td>' +
                        '<td style="white-space:nowrap;">' + fmtDate(oc.fecha_emision) + '</td>' +
                        '<td style="text-align:center;"><button onclick="event.stopPropagation();proyFinEliminarOC(' + oc.id + ')" style="background:none;border:none;cursor:pointer;color:#D1D5DB;padding:4px;" title="Eliminar OC"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button></td>' +
                    '</tr>';
                });

                container.innerHTML = html;

                var foot = el('proyOCFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td colspan="4" style="text-align:right;color:#8e8e93">Total OC</td>' +
                        '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                        '<td colspan="3"></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444">Error al cargar OC</td></tr>';
                console.error('Error cargando OC:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando OC:', err);
        });
    }


    // =========================================
    //  RENDER: PROGRAMA DE OBRA  (Gantt visual PRO)
    // =========================================
    //
    //   Cronograma profesional al nivel MS Project / Primavera / Smartsheet.
    //   Estructura:
    //     Header con titulo + KPIs + acciones (+ Fase / + Actividad / Imprimir / CSV)
    //     Toolbar: filtros (Todas/Activas/Completadas/Atrasadas) + zoom + busqueda + vista
    //     Tabla: columna izquierda con Fase (collapsable) > Actividades anidadas
    //            columna derecha con grid de meses + barras + linea de hoy
    //     SVG overlay para dependencias (flechas Finish-to-Start)
    //     Tooltip rico al hover, drag para mover/resize, context menu, etc.
    //
    //   Datos:  /app/api/proyecto/{id}/gantt/  (fases + actividades)
    //   POST:   /app/api/proyecto/{id}/gantt/        -> crea actividad
    //   POST:   /app/api/proyecto/{id}/gantt/fase/   -> crea fase
    //   PUT:    /app/api/gantt/actividad/{id}/       -> actualiza actividad
    //   PUT:    /app/api/gantt/fase/{id}/            -> actualiza fase
    //   DEL:    /app/api/gantt/actividad/{id}/       -> elimina actividad
    //   DEL:    /app/api/gantt/fase/{id}/            -> elimina fase + cascada
    // =========================================

    // Categorias inferidas a partir del nombre (heuristica + override manual)
    var _PROY_GANTT_CATEGORIES = [
        { id: 'planificacion', label: 'Planificación', color: '#6366f1',
          tokens: ['planif', 'planeac', 'arranque', 'inicio', 'kickoff', 'kick-off', 'permis', 'preparac', 'demolic', 'limpiez', 'levant', 'diagnost', 'topograf'] },
        { id: 'cimentacion', label: 'Cimentación', color: '#d97706',
          tokens: ['cimentac', 'cimiento', 'cimien', 'fundac', 'excav', 'zapata', 'losa de cim', 'desplante'] },
        { id: 'estructura', label: 'Estructura', color: '#2563eb',
          tokens: ['estructur', 'columnas', 'losa', 'muro', 'mamposter', 'concret', 'armado', 'castillos'] },
        { id: 'instalaciones', label: 'Instalaciones', color: '#0891b2',
          tokens: ['instalac', 'electric', 'hidraul', 'hidrosanit', 'sanitar', 'cableado', 'cctv', 'voz', 'datos', 'aire', 'climatiz'] },
        { id: 'acabados', label: 'Acabados', color: '#16a34a',
          tokens: ['acabad', 'pintura', 'pisos', 'fachad', 'aplanad', 'plafond', 'recubri', 'azulejo', 'mármol', 'marmol', 'carpinter', 'canceler', 'jardin', 'paisaj', 'impermeab'] },
        { id: 'entrega', label: 'Entrega', color: '#dc2626',
          tokens: ['entrega', 'recepci', 'cierre', 'finiqui', 'pruebas', 'puesta en marcha', 'capacitac'] }
    ];
    var _PROY_GANTT_DEFAULT_CAT = { id: 'general', label: 'General', color: '#64748b' };

    function _proyGanttCategoryFor(name) {
        if (!name) return _PROY_GANTT_DEFAULT_CAT;
        var n = String(name).toLowerCase();
        for (var i = 0; i < _PROY_GANTT_CATEGORIES.length; i++) {
            var c = _PROY_GANTT_CATEGORIES[i];
            for (var j = 0; j < c.tokens.length; j++) {
                if (n.indexOf(c.tokens[j]) !== -1) return c;
            }
        }
        return _PROY_GANTT_DEFAULT_CAT;
    }

    function _proyGanttEsc(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _proyGanttFmtMoneda(n) {
        var v = Number(n) || 0;
        var sign = v < 0 ? '-' : '';
        var abs = Math.abs(v);
        if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
        return sign + '$' + abs.toFixed(0);
    }
    function _proyGanttFmtMoneyFull(n) {
        var v = Number(n) || 0;
        return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    // Color del Gantt segun % gastado vs presupuestado (vista financiera).
    // Devuelve un objeto { color, pct } usado para colorear barras y mostrar
    // labels. Si la actividad no tiene costo, devuelve color neutro.
    function _proyGanttFinColor(r) {
        var cost = r.costo || 0;
        var rev = r.ingreso || 0;
        // "Ejecutado" se aproxima a costo * progreso (sin gasto real granular).
        var ejecutado = cost * ((r.progress || 0) / 100);
        var presupuesto = (rev > 0 ? rev : (cost > 0 ? cost : 0));
        if (presupuesto <= 0) return { color: '#94a3b8', pct: 0, ejecutado: 0, presupuesto: 0 };
        var pct = (ejecutado / presupuesto) * 100;
        var color;
        if (pct < 50) color = '#16a34a';
        else if (pct < 80) color = '#d97706';
        else if (pct <= 100) color = '#dc2626';
        else color = '#7f1d1d';
        return { color: color, pct: pct, ejecutado: ejecutado, presupuesto: presupuesto };
    }

    function _proyGanttFmtFechaCorta(d) {
        var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
    }

    function _proyGanttFmtFechaLarga(d) {
        var meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
    }

    // Estado (persiste durante la sesión)
    var _proyGanttFiltro       = 'todo';        // todo | activo | completado | atrasado
    var _proyGanttZoom         = 'mes';         // semana | mes | trimestre | ano
    var _proyGanttVista        = 'gantt';       // gantt | lista | financiero
    var _proyGanttFiltroResp   = '';
    var _proyGanttFiltroCat    = '';
    var _proyGanttBusqueda     = '';
    var _proyGanttCollapsed    = {};            // map { faseId: true } (sólo cliente)
    var _proyGanttData         = null;
    var _proyGanttMiembros     = [];
    var _proyActEditId         = null;
    var _proyActDeps           = {};
    var _proyFaseEditId        = null;
    var _proyGanttResizeBound  = false;
    // Mapas { id -> { id, nombre, ... } } para chips dinámicos del modal
    var _actividadSelectedUsers = {};       // users (responsables)
    var _actividadSelectedRecursos = {};    // recursos materiales
    var _proyGanttPendingScroll = true;        // primer render hace auto-scroll a hoy

    // Configuración de zoom — controla el rango temporal y el ancho mínimo.
    // Cada zoom debe verse claramente distinto:
    //   semana    → 52 columnas finas (S1..S52) con header doble Mes/Semana
    //   mes       → 12 columnas medianas (Ene..Dic)
    //   trimestre → 4 grupos grandes Q1..Q4, cada uno con 3 sub-meses (header doble)
    //   ano       → 1 columna ancha (todo el año), opcionalmente con sub-trimestres
    var _PROY_GANTT_ZOOM_CFG = {
        ano:       { units: 1,   minWidthPerUnit: 880 },   // todo el año en 1 columna grande
        trimestre: { units: 12,  minWidthPerUnit: 110 },   // 12 meses bajo grupos Q1..Q4
        mes:       { units: 12,  minWidthPerUnit: 64 },    // 12 meses
        semana:    { units: 52,  minWidthPerUnit: 42 }     // 52 semanas, header doble
    };

    // ─── ENTRY POINT ────────────────────────────────────────────────────
    function renderProgramaObra(projectId, opts) {
        opts = opts || {};
        var containerId = opts.containerId || 'proyProgramaContainer';
        var container = el(containerId);
        if (!container) return;

        var detail = opts.projectDetail || _cachedProjectDetail;
        if (opts.projectDetail) { _cachedProjectDetail = detail; currentProjectId = projectId; }

        container.innerHTML = '<div class="proy-gantt-loading">Cargando cronograma…</div>';

        _fetch('/app/api/proyecto/' + projectId + '/gantt/').then(function(data) {
            _proyGanttData = data || {};
            _proyGanttRender(container, projectId, detail, _proyGanttData);
        }).catch(function(err) {
            console.error('[programa-obra] error cargando gantt:', err);
            container.innerHTML = '<div class="proy-gantt-error">No se pudo cargar el cronograma. <button type="button" onclick="window.proyectosRenderProgramaObra(' + projectId + ')">Reintentar</button></div>';
        });
    }

    // ─── RENDER PRINCIPAL ───────────────────────────────────────────────
    function _proyGanttRender(container, projectId, detail, data) {
        var fases = (data.fases || []).slice();
        var actividades = (data.actividades || []).slice();

        // Determinar año del eje (proyecto.fecha_inicio o min(actividad))
        var yearStart = (new Date()).getFullYear();
        if (detail && detail.fecha_inicio) {
            yearStart = parseInt(String(detail.fecha_inicio).slice(0, 4), 10);
        } else if (data.proyecto_inicio) {
            yearStart = parseInt(String(data.proyecto_inicio).slice(0, 4), 10);
        } else if (actividades.length) {
            var minDate = actividades.reduce(function(min, a) {
                return (!min || a.fecha_inicio < min) ? a.fecha_inicio : min;
            }, null);
            if (minDate) yearStart = parseInt(minDate.slice(0, 4), 10);
        }

        var zoomCfg = _PROY_GANTT_ZOOM_CFG[_proyGanttZoom] || _PROY_GANTT_ZOOM_CFG.mes;
        var totalUnits = zoomCfg.units;
        var hoy = new Date(); hoy.setHours(12, 0, 0, 0);
        var hoyUnit = _proyGanttDateToUnit(hoy, yearStart, _proyGanttZoom);

        // Empty state global (sin fases ni actividades)
        if (!fases.length && !actividades.length) {
            container.innerHTML = _proyGanttEmptyState();
            _proyGanttBindEmptyState(container, projectId, detail);
            return;
        }

        // Construye filas en orden Fase → Actividades hijas → fases sin acts → actividades sueltas
        var rows = _proyGanttBuildRows(fases, actividades, yearStart, totalUnits, hoyUnit);
        var avanceGlobal = _proyGanttAvanceGlobal(rows);

        // Catalogos para filtros
        var respMap = {}; var catMap = {};
        rows.forEach(function(r) {
            (r.responsables || []).forEach(function(u) { if (u && u.id != null) respMap[u.id] = u; });
            if (r.category) catMap[r.category.id] = r.category;
        });
        var responsablesCat = Object.keys(respMap).map(function(k) { return respMap[k]; });
        var categoriasCat = Object.keys(catMap).map(function(k) { return catMap[k]; });

        // Filtros + busqueda + colapso de fases
        var rowsVisibles = _proyGanttFilterRows(rows, hoyUnit);

        // Conteos para los filtros (siempre del set completo, no del filtrado)
        var counts = _proyGanttCounts(rows);

        var hoyDentroRango = hoyUnit >= 0 && hoyUnit <= totalUnits;
        var todayLeftPct = (Math.max(0, Math.min(totalUnits, hoyUnit)) / totalUnits) * 100;

        // ── HTML ──
        var html = '<div class="proy-gantt-root">';

        // Header
        html += _proyGanttHeaderHTML(detail, yearStart, fases.length, rows, avanceGlobal, hoy, counts);

        // Toolbar
        html += _proyGanttToolbarHTML(responsablesCat, categoriasCat, counts);

        // Cuerpo (gantt o lista o financiero)
        if (_proyGanttVista === 'lista') {
            html += _proyGanttListaHTML(rowsVisibles);
        } else {
            // 'gantt' y 'financiero' usan el mismo render Gantt (cambia coloreo de barras)
            html += _proyGanttHTML(rowsVisibles, totalUnits, hoyDentroRango, todayLeftPct, hoy, yearStart, zoomCfg, fases);
        }

        // Leyenda (usa solo categorías que aparecen en el proyecto)
        html += _proyGanttLegendHTML(categoriasCat);

        html += '</div>'; // /root
        container.innerHTML = html;

        _proyGanttAttachHandlers(container, projectId, detail, data, rowsVisibles, totalUnits, fases);
    }

    function _proyGanttCounts(rows) {
        var c = { todo: 0, activo: 0, completado: 0, atrasado: 0 };
        rows.forEach(function(r) {
            if (r.type !== 'actividad') return;
            c.todo++;
            if (r.progress >= 100) c.completado++;
            else if (r.isActive && r.progress < (r.expectedProgress - 5)) c.atrasado++;
            else if (r.isActive) c.activo++;
        });
        return c;
    }

    function _proyGanttFilterRows(rows, hoyUnit) {
        var q = (_proyGanttBusqueda || '').toLowerCase().trim();
        // Set de fases que tienen al menos una hija que pase los filtros (para no "huerfanar" fases)
        var faseTienePasada = {};
        rows.forEach(function(r) {
            if (r.type !== 'actividad') return;
            if (!_proyGanttRowPasses(r, q)) return;
            if (r.parentFaseId) faseTienePasada[r.parentFaseId] = true;
        });
        return rows.filter(function(r) {
            if (r.type === 'fase') {
                // mostramos la fase si pasa el filtro propio O si alguna hija pasa
                if (faseTienePasada[r.faseId]) return true;
                return _proyGanttRowPasses(r, q);
            }
            // actividad: si su fase está colapsada, ocultar (excepto si hay búsqueda)
            if (r.parentFaseId && _proyGanttCollapsed[r.parentFaseId] && !q) return false;
            return _proyGanttRowPasses(r, q);
        });
    }

    function _proyGanttRowPasses(r, q) {
        if (_proyGanttFiltro === 'activo' && !r.isActive) return false;
        if (_proyGanttFiltro === 'completado' && r.progress < 100) return false;
        if (_proyGanttFiltro === 'atrasado' && !(r.isActive && r.progress < r.expectedProgress - 5)) return false;
        if (_proyGanttFiltroResp) {
            var rid = parseInt(_proyGanttFiltroResp, 10);
            var found = (r.responsables || []).some(function(u) { return u.id === rid; });
            if (!found) return false;
        }
        if (_proyGanttFiltroCat && r.category && r.category.id !== _proyGanttFiltroCat) return false;
        if (q && r.name.toLowerCase().indexOf(q) === -1) return false;
        return true;
    }

    // ─── HEADER ────────────────────────────────────────────────────────
    function _proyGanttHeaderHTML(detail, yearStart, nFases, rows, avanceGlobal, hoy, counts) {
        var nActs = counts.todo;
        var proyName = (detail && detail.nombre) ? _proyGanttEsc(detail.nombre) : 'Proyecto';
        var html = '<div class="proy-gantt-header">';
        html += '  <div class="proy-gantt-header-left">';
        if (_proyGanttVista === 'financiero') {
            // Modo financiero: KPIs Costo / Ingreso / Margen
            var totalCosto = 0, totalIngreso = 0;
            rows.forEach(function(r) {
                if (r.type !== 'actividad') return;
                totalCosto += (r.costo || 0);
                totalIngreso += (r.ingreso || 0);
            });
            var margen = totalIngreso - totalCosto;
            var margenPct = totalIngreso > 0 ? (margen / totalIngreso) * 100 : 0;
            html += '    <h2 class="proy-gantt-title">Cronograma financiero ' + yearStart + '</h2>';
            html += '    <p class="proy-gantt-subtitle">' + proyName +
                    ' &middot; <strong>' + nActs + '</strong> ' + (nActs === 1 ? 'actividad' : 'actividades') + '</p>';
            html += '    <div class="proy-gantt-fin-kpis">';
            html += '      <div class="proy-gantt-fin-kpi">' +
                    '<div class="proy-gantt-fin-kpi-lbl">Costo estimado</div>' +
                    '<div class="proy-gantt-fin-kpi-val proy-gantt-fin-kpi-cost">' + _proyGanttFmtMoneda(totalCosto) + '</div>' +
                    '</div>';
            html += '      <div class="proy-gantt-fin-kpi">' +
                    '<div class="proy-gantt-fin-kpi-lbl">Ingreso estimado</div>' +
                    '<div class="proy-gantt-fin-kpi-val proy-gantt-fin-kpi-rev">' + _proyGanttFmtMoneda(totalIngreso) + '</div>' +
                    '</div>';
            html += '      <div class="proy-gantt-fin-kpi">' +
                    '<div class="proy-gantt-fin-kpi-lbl">Margen</div>' +
                    '<div class="proy-gantt-fin-kpi-val ' + (margen >= 0 ? 'proy-gantt-fin-kpi-pos' : 'proy-gantt-fin-kpi-neg') + '">' +
                    _proyGanttFmtMoneda(margen) +
                    ' <span class="proy-gantt-fin-kpi-sub">(' + (margenPct >= 0 ? '+' : '') + margenPct.toFixed(1) + '%)</span>' +
                    '</div></div>';
            html += '    </div>';
        } else {
            html += '    <h2 class="proy-gantt-title">Cronograma ' + yearStart + '</h2>';
            html += '    <p class="proy-gantt-subtitle">' + proyName +
                    ' &middot; <strong>' + nFases + '</strong> ' + (nFases === 1 ? 'fase' : 'fases') +
                    ' &middot; <strong>' + nActs + '</strong> ' + (nActs === 1 ? 'actividad' : 'actividades') +
                    ' &middot; Avance hoy: <strong>' + Math.round(avanceGlobal) + '%</strong></p>';
        }
        html += '  </div>';
        html += '  <div class="proy-gantt-header-right">';
        html += '    <div class="proy-gantt-today-pill">';
        html += '      <span class="proy-gantt-today-dot"></span>';
        html += '      <span class="proy-gantt-today-text">Hoy: ' + _proyGanttFmtFechaCorta(hoy) + '</span>';
        html += '    </div>';
        // Imprimir
        html += '    <button type="button" class="proy-gantt-icon-btn" id="proyGanttBtnPrint" title="Imprimir cronograma">';
        html += '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
        html += '      <span>Imprimir</span></button>';
        // CSV
        html += '    <button type="button" class="proy-gantt-icon-btn" id="proyGanttBtnExport" title="Exportar CSV">';
        html += '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        html += '      <span>CSV</span></button>';
        // CTA principal: + Fase
        html += '    <button type="button" class="proy-gantt-cta proy-gantt-cta-fase" id="proyGanttBtnNuevaFase" title="Crear una nueva fase">+ Fase</button>';
        // CTA: + Actividad
        html += '    <button type="button" class="proy-gantt-cta" id="proyGanttBtnNueva" title="Crear una nueva actividad">+ Actividad</button>';
        html += '  </div>';
        html += '</div>';
        return html;
    }

    // ─── TOOLBAR ───────────────────────────────────────────────────────
    function _proyGanttToolbarHTML(responsablesCat, categoriasCat, counts) {
        var html = '<div class="proy-gantt-toolbar">';
        // Filtros estado
        html += '  <div class="proy-gantt-filter">';
        var filterCfg = [
            { id: 'todo', label: 'Todas', count: counts.todo },
            { id: 'activo', label: 'Activas', count: counts.activo },
            { id: 'completado', label: 'Completadas', count: counts.completado },
            { id: 'atrasado', label: 'Atrasadas', count: counts.atrasado }
        ];
        filterCfg.forEach(function(f) {
            var isActive = (_proyGanttFiltro === f.id);
            html += '<button type="button" class="proy-gantt-filter-btn' + (isActive ? ' is-active' : '') +
                    '" data-filter="' + f.id + '">' + f.label +
                    ' <span class="proy-gantt-filter-count">' + f.count + '</span></button>';
        });
        html += '  </div>';

        // Busqueda
        html += '  <div class="proy-gantt-search">';
        html += '    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
        html += '    <input type="search" id="proyGanttSearch" placeholder="Buscar actividad…" value="' + _proyGanttEsc(_proyGanttBusqueda) + '">';
        html += '  </div>';

        // Filtro responsable
        if (responsablesCat.length) {
            html += '  <select class="proy-gantt-select" id="proyGanttFiltroResp">';
            html += '<option value="">Todos los responsables</option>';
            responsablesCat.forEach(function(u) {
                var sel = (String(_proyGanttFiltroResp) === String(u.id)) ? ' selected' : '';
                html += '<option value="' + u.id + '"' + sel + '>' + _proyGanttEsc(u.nombre) + '</option>';
            });
            html += '  </select>';
        }
        if (categoriasCat.length > 1) {
            html += '  <select class="proy-gantt-select" id="proyGanttFiltroCat">';
            html += '<option value="">Todas las categorías</option>';
            categoriasCat.forEach(function(c) {
                var sel = (_proyGanttFiltroCat === c.id) ? ' selected' : '';
                html += '<option value="' + c.id + '"' + sel + '>' + _proyGanttEsc(c.label) + '</option>';
            });
            html += '  </select>';
        }

        // Spacer para empujar zoom y vista a la derecha
        html += '  <div class="proy-gantt-toolbar-spacer"></div>';

        // Zoom (visible para gantt y financiero — ambos son visualizaciones temporales)
        if (_proyGanttVista !== 'lista') {
            html += '  <div class="proy-gantt-filter proy-gantt-zoom">';
            ['semana','mes','trimestre','ano'].forEach(function(z) {
                var labels = {semana:'Sem', mes:'Mes', trimestre:'Trim', ano:'Año'};
                var isActive = (_proyGanttZoom === z);
                html += '<button type="button" class="proy-gantt-filter-btn' + (isActive ? ' is-active' : '') +
                        '" data-zoom="' + z + '">' + labels[z] + '</button>';
            });
            html += '  </div>';
        }

        // Vista (Gantt | Lista | Financiero)
        html += '  <div class="proy-gantt-filter proy-gantt-vista">';
        var vistas = [
            { id: 'gantt', label: 'Gantt' },
            { id: 'lista', label: 'Lista' },
            { id: 'financiero', label: 'Financiero' }
        ];
        vistas.forEach(function(v) {
            var isActive = (_proyGanttVista === v.id);
            html += '<button type="button" class="proy-gantt-filter-btn' + (isActive ? ' is-active' : '') +
                    '" data-vista="' + v.id + '">' + v.label + '</button>';
        });
        html += '  </div>';

        html += '</div>';
        return html;
    }

    // ─── LEGEND ───────────────────────────────────────────────────────
    // - Modo "categorías" (gantt/lista): solo muestra las categorías que están
    //   en uso por alguna fase/actividad del proyecto actual.
    // - Modo "financiero": muestra rangos de % gastado en lugar de categorías.
    function _proyGanttLegendHTML(categoriasUsadas) {
        var html = '<div class="proy-gantt-legend">';
        if (_proyGanttVista === 'financiero') {
            html += '<span class="proy-gantt-legend-label">Costo ejecutado:</span>';
            var fin = [
                { label: '< 50%', color: '#16a34a' },
                { label: '50–80%', color: '#d97706' },
                { label: '80–100%', color: '#dc2626' },
                { label: '> 100% (sobrepasado)', color: '#7f1d1d' },
            ];
            fin.forEach(function(s) {
                html += '<span class="proy-gantt-legend-item">' +
                        '<span class="proy-gantt-legend-dot" style="background:' + s.color + ';"></span>' +
                        s.label + '</span>';
            });
        } else {
            html += '<span class="proy-gantt-legend-label">Categorías:</span>';
            var cats = (categoriasUsadas && categoriasUsadas.length)
                ? categoriasUsadas
                : [_PROY_GANTT_DEFAULT_CAT];
            cats.forEach(function(c) {
                html += '<span class="proy-gantt-legend-item">' +
                        '<span class="proy-gantt-legend-dot" style="background:' + c.color + ';"></span>' +
                        _proyGanttEsc(c.label) + '</span>';
            });
        }
        html += '<span class="proy-gantt-legend-item proy-gantt-legend-today">' +
                '<span class="proy-gantt-legend-line"></span>Hoy</span>';
        html += '<span class="proy-gantt-legend-item">' +
                '<svg width="10" height="10" viewBox="0 0 24 24" style="vertical-align:middle"><path d="M12 2 L22 12 L12 22 L2 12 Z" fill="#a16207"/></svg>' +
                ' Hito</span>';
        html += '<span class="proy-gantt-legend-item">' +
                '<span class="proy-gantt-legend-tip-late"></span> Atrasada</span>';
        html += '<span class="proy-gantt-legend-help">Tip: Shift+arrastrar la barra para mover la actividad. Click derecho abre menú.</span>';
        html += '</div>';
        return html;
    }

    // ─── GANTT VISUAL ──────────────────────────────────────────────────
    function _proyGanttHTML(rowsVisibles, totalUnits, hoyDentroRango, todayLeftPct, hoy, yearStart, zoomCfg, fases) {
        var minWidth = totalUnits * zoomCfg.minWidthPerUnit;

        var html = '<div class="proy-gantt-card">';
        html += '  <div class="proy-gantt-scroll" id="proyGanttScroll">';
        html += '    <div class="proy-gantt-grid proy-gantt-grid-zoom-' + _proyGanttZoom +
                '" style="min-width:' + minWidth + 'px;--proy-gantt-units:' + totalUnits + ';" data-units="' + totalUnits + '" data-zoom="' + _proyGanttZoom + '">';

        // Header del eje X (subdivisiones).
        // Header de doble fila: primary (grupos grandes) sobre secondary (subdivisiones).
        var subdivs = _proyGanttSubdivisions(_proyGanttZoom, yearStart, hoy);
        var hasPrimary = subdivs.primary && subdivs.primary.length;
        var hasSecondary = subdivs.secondary && subdivs.secondary.length;

        // Fila primaria (sólo si aplica)
        if (hasPrimary) {
            html += '<div class="proy-gantt-row proy-gantt-row-header proy-gantt-row-header-primary">';
            html += '  <div class="proy-gantt-col-left">';
            html += '    <span class="proy-gantt-col-left-label">Fase / Actividad</span>';
            html += '  </div>';
            html += '  <div class="proy-gantt-col-right">';
            subdivs.primary.forEach(function(sd) {
                var span = sd.span || 1;
                html += '<div class="proy-gantt-month proy-gantt-month-primary' +
                        (sd.isCurrent ? ' is-current' : '') +
                        '" style="flex:' + span + ';"><span>' + sd.label + '</span></div>';
            });
            if (hoyDentroRango) {
                html += '<div class="proy-gantt-today-line proy-gantt-today-line-header" style="left:' + todayLeftPct.toFixed(3) + '%;"></div>';
            }
            html += '  </div>';
            html += '</div>';
        }

        // Fila secundaria (siempre presente)
        if (hasSecondary) {
            html += '<div class="proy-gantt-row proy-gantt-row-header proy-gantt-row-header-secondary">';
            html += '  <div class="proy-gantt-col-left">';
            if (!hasPrimary) {
                html += '    <span class="proy-gantt-col-left-label">Fase / Actividad</span>';
            }
            html += '  </div>';
            html += '  <div class="proy-gantt-col-right">';
            subdivs.secondary.forEach(function(sd) {
                html += '<div class="proy-gantt-month' + (sd.isCurrent ? ' is-current' : '') + '">' +
                        '<span>' + sd.label + '</span></div>';
            });
            if (hoyDentroRango && !hasPrimary) {
                html += '<div class="proy-gantt-today-line proy-gantt-today-line-header" style="left:' + todayLeftPct.toFixed(3) + '%;"></div>';
            }
            html += '  </div>';
            html += '</div>';
        }

        if (!rowsVisibles.length) {
            html += '<div class="proy-gantt-row proy-gantt-row-empty">';
            html += '  <div class="proy-gantt-col-left">' +
                    '<span style="color:#94a3b8;font-size:0.78rem;">Sin filas para este filtro</span></div>';
            html += '  <div class="proy-gantt-col-right"></div>';
            html += '</div>';
        }

        rowsVisibles.forEach(function(r) {
            html += _proyGanttRowHTML(r, totalUnits, hoyDentroRango, todayLeftPct);
        });

        // SVG overlay de dependencias (placeholder; coords se calculan post-render)
        html += _proyGanttDepsSVG(rowsVisibles);

        html += '    </div>'; // /grid
        html += '  </div>';   // /scroll
        html += '</div>';     // /card

        // Tooltip flotante (compartido)
        html += '<div class="proy-gantt-tooltip" id="proyGanttTooltip" style="display:none;"></div>';

        // Drag confirm overlay (controlado dinámicamente)
        html += '<div class="proy-gantt-drag-confirm" id="proyGanttDragConfirm" style="display:none;"></div>';

        // Context menu
        html += '<div class="proy-gantt-ctxmenu" id="proyGanttCtxMenu" style="display:none;"></div>';

        return html;
    }

    function _proyGanttRowHTML(r, totalUnits, hoyDentroRango, todayLeftPct) {
        var leftPct = (r.startUnit / totalUnits) * 100;
        var widthPct = (r.durationUnits / totalUnits) * 100;
        var fillPct = Math.max(0, Math.min(100, r.progress));
        var done = (r.progress >= 100);
        var atrasada = r.isActive && r.progress < (r.expectedProgress - 5);

        var statusTag = '';
        if (done) {
            statusTag = '<span class="proy-gantt-tag proy-gantt-tag-done">✓ Lista</span>';
        } else if (atrasada) {
            var diasAtraso = Math.round(((+r.fechaFin) - Date.now()) / 86400000);
            var atrasoTxt = (diasAtraso < 0) ? 'Vencida ' + Math.abs(diasAtraso) + 'd' : 'Atrasada';
            statusTag = '<span class="proy-gantt-tag proy-gantt-tag-late">' + atrasoTxt + '</span>';
        } else if (r.isActive) {
            statusTag = '<span class="proy-gantt-tag proy-gantt-tag-active">Activa</span>';
        }

        var avatarsHtml = '';
        var avs = (r.responsables || []).slice(0, 3);
        avs.forEach(function(u, i) {
            var nombre = u.nombre || u.username || '';
            var ini = _initials(nombre) || '·';
            var bg = _proyGanttAvatarColor(u.id || i);
            avatarsHtml += '<span class="proy-gantt-avatar" title="' + _proyGanttEsc(nombre) + '" style="background:' + bg + ';">' + _proyGanttEsc(ini) + '</span>';
        });
        if ((r.responsables || []).length > 3) {
            avatarsHtml += '<span class="proy-gantt-avatar proy-gantt-avatar-more">+' + (r.responsables.length - 3) + '</span>';
        }

        var rangoTxt = _proyGanttFmtFechaLarga(r.fechaInicio) + ' → ' + _proyGanttFmtFechaLarga(r.fechaFin);

        var rowClasses = 'proy-gantt-row';
        if (r.type === 'fase') rowClasses += ' proy-gantt-row-fase';
        if (r.type === 'actividad' && r.parentFaseId) rowClasses += ' proy-gantt-row-child';
        if (r.type === 'actividad' && r.esHito) rowClasses += ' proy-gantt-row-milestone';

        var dataAttrs = ' data-row-id="' + r.id + '"';
        if (r.type === 'actividad') dataAttrs += ' data-act-id="' + r.actId + '"';
        if (r.type === 'fase') dataAttrs += ' data-fase-id="' + r.faseId + '"';

        var html = '<div class="' + rowClasses + '"' + dataAttrs + ' title="' + _proyGanttEsc(r.name) + ' · ' + rangoTxt + '">';
        // Columna izquierda
        html += '<div class="proy-gantt-col-left">';
        if (r.type === 'fase') {
            // Chevron + dot + actividades count + boton inline "+ Actividad"
            var collapsed = !!_proyGanttCollapsed[r.faseId];
            html += '<button type="button" class="proy-gantt-chevron' + (collapsed ? ' is-collapsed' : '') +
                    '" data-fase-id="' + r.faseId + '" aria-label="Plegar fase">' +
                    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
                    '</button>';
        }
        // Indicador color
        if (r.type === 'actividad' && r.esHito) {
            html += '<svg class="proy-gantt-row-diamond" width="11" height="11" viewBox="0 0 24 24"><path d="M12 2 L22 12 L12 22 L2 12 Z" fill="#a16207"/></svg>';
        } else {
            html += '<span class="proy-gantt-row-dot" style="background:' + r.color + ';"></span>';
        }
        // Info
        html += '<div class="proy-gantt-row-info">';
        html += '  <div class="proy-gantt-row-name">' + _proyGanttEsc(r.name) + '</div>';
        html += '  <div class="proy-gantt-row-meta">';
        if (statusTag) html += statusTag;
        html += '    <span class="proy-gantt-row-pct">' + Math.round(r.progress) + '%</span>';
        if (r.actividadesCount > 0) {
            html += '<span class="proy-gantt-row-acts">' + r.actividadesCount + ' ' + (r.actividadesCount === 1 ? 'actividad' : 'actividades') + '</span>';
        }
        html += '  </div>';
        html += '</div>';
        // Avatars
        if (avatarsHtml) html += '<div class="proy-gantt-row-avatars">' + avatarsHtml + '</div>';
        // Boton inline solo para fases: + Actividad
        if (r.type === 'fase') {
            html += '<button type="button" class="proy-gantt-row-addact" data-fase-id="' + r.faseId + '" title="Agregar actividad a esta fase">' +
                    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                    '</button>';
        }
        html += '</div>'; // /col-left

        // Columna derecha
        html += '<div class="proy-gantt-col-right">';
        if (hoyDentroRango) {
            html += '<div class="proy-gantt-today-line" style="left:' + todayLeftPct.toFixed(3) + '%;"></div>';
        }
        if (r.type === 'actividad' && r.esHito) {
            // Hito: rombo
            html += '<div class="proy-gantt-milestone" style="left:' + leftPct.toFixed(3) + '%;" data-row-id="' + r.id + '" data-act-id="' + r.actId + '">';
            html += '  <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2 L22 12 L12 22 L2 12 Z" fill="' + (done ? '#16a34a' : '#a16207') + '" stroke="#fff" stroke-width="1.5"/></svg>';
            html += '</div>';
        } else if (r.type === 'fase' && r.isEmpty) {
            // Fase vacia: placeholder discreto en col-right (sin barra)
            html += '<div class="proy-gantt-fase-empty">Sin actividades · <span class="proy-gantt-fase-empty-link" data-fase-id="' + r.faseId + '">+ Agregar</span></div>';
        } else if (widthPct < 0.05) {
            // Actividad fuera del rango visible
            html += '<div class="proy-gantt-bar-track is-outofrange" style="left:' + Math.max(0, Math.min(99, leftPct)).toFixed(3) + '%;width:0.5%;background:' + r.color + ';"' + dataAttrs + ' title="Actividad fuera del rango visible"></div>';
        } else {
            // Barra normal
            var atrasadaCls = atrasada ? ' is-late' : '';
            if (r.type === 'fase') atrasadaCls += ' proy-gantt-bar-fase';

            // Color del relleno y de la barra: en vista financiera depende del % gastado.
            var barColor = r.color;
            var fillBarColor = r.color;
            var fillBarPct = fillPct; // por defecto = progreso
            var barLabel = '';
            if (_proyGanttVista === 'financiero' && r.type === 'actividad') {
                var fc = _proyGanttFinColor(r);
                barColor = fc.color;
                fillBarColor = fc.color;
                fillBarPct = Math.min(100, fc.pct);
                if (widthPct > 12 && fc.presupuesto > 0) {
                    barLabel = _proyGanttFmtMoneda(fc.ejecutado) + ' / ' + _proyGanttFmtMoneda(fc.presupuesto);
                } else if (widthPct > 6 && fc.presupuesto > 0) {
                    barLabel = Math.round(fc.pct) + '%';
                }
            } else if (widthPct > 8) {
                barLabel = Math.round(r.progress) + '%';
            }

            html += '<div class="proy-gantt-bar-track' + atrasadaCls + '" style="left:' + leftPct.toFixed(3) + '%;width:' + widthPct.toFixed(3) + '%;background:' + barColor + '22;border-color:' + barColor + ';"' + dataAttrs + '>';
            html += '  <div class="proy-gantt-bar-fill" style="width:' + fillBarPct.toFixed(3) + '%;background:' + fillBarColor + ';"></div>';
            if (barLabel) {
                var labelColor = (fillBarPct > 35) ? '#fff' : '#1c1917';
                html += '<div class="proy-gantt-bar-label" style="color:' + labelColor + ';">' + _proyGanttEsc(barLabel) + '</div>';
            }
            // Handle de resize (solo para actividades reales)
            if (r.type === 'actividad' && !r.esHito) {
                html += '<span class="proy-gantt-bar-handle" title="Arrastra para cambiar duración"></span>';
            }
            html += '</div>';
        }
        html += '</div>'; // /col-right
        html += '</div>'; // /row
        return html;
    }

    // ─── LISTA ─────────────────────────────────────────────────────────
    function _proyGanttListaHTML(rows) {
        var html = '<div class="proy-gantt-card proy-gantt-list-card">';
        html += '<table class="proy-gantt-table">';
        html += '<thead><tr>';
        html += '<th>Fase / Actividad</th>';
        html += '<th>Categoría</th>';
        html += '<th>Inicio</th>';
        html += '<th>Fin</th>';
        html += '<th>Días</th>';
        html += '<th>Avance</th>';
        html += '<th>Responsables</th>';
        html += '<th>Estado</th>';
        html += '<th></th>';
        html += '</tr></thead><tbody>';
        if (!rows.length) {
            html += '<tr><td colspan="9" class="proy-gantt-table-empty">Sin filas para este filtro</td></tr>';
        }
        rows.forEach(function(r) {
            var dias = Math.max(1, Math.round(((+r.fechaFin) - (+r.fechaInicio)) / 86400000));
            var avs = '';
            (r.responsables || []).slice(0, 3).forEach(function(u) {
                var nombre = u.nombre || u.username || '';
                var bg = _proyGanttAvatarColor(u.id);
                avs += '<span class="proy-gantt-avatar" style="background:' + bg + ';" title="' + _proyGanttEsc(nombre) + '">' + _proyGanttEsc(_initials(nombre) || '·') + '</span>';
            });
            if ((r.responsables || []).length > 3) {
                avs += '<span class="proy-gantt-avatar proy-gantt-avatar-more">+' + (r.responsables.length - 3) + '</span>';
            }
            var done = (r.progress >= 100);
            var atrasada = r.isActive && r.progress < (r.expectedProgress - 5);
            var estado = done ? '<span class="proy-gantt-tag proy-gantt-tag-done">Lista</span>' :
                         atrasada ? '<span class="proy-gantt-tag proy-gantt-tag-late">Atrasada</span>' :
                         r.isActive ? '<span class="proy-gantt-tag proy-gantt-tag-active">Activa</span>' :
                         '<span class="proy-gantt-tag proy-gantt-tag-pending">Pendiente</span>';
            var hito = (r.type === 'actividad' && r.esHito) ?
                '<svg width="10" height="10" viewBox="0 0 24 24" style="vertical-align:middle;margin-right:4px;"><path d="M12 2 L22 12 L12 22 L2 12 Z" fill="#a16207"/></svg>' : '';
            var trCls = (r.type === 'fase') ? ' class="proy-gantt-tr-fase"' : (r.type === 'actividad' && r.parentFaseId ? ' class="proy-gantt-tr-child"' : '');
            html += '<tr' + trCls + '>';
            html += '<td><span class="proy-gantt-row-dot" style="background:' + r.color + ';display:inline-block;margin-right:6px;"></span>' + hito + _proyGanttEsc(r.name) + '</td>';
            html += '<td><span style="color:' + r.color + ';font-weight:600;font-size:0.72rem;">' + _proyGanttEsc(r.category.label) + '</span></td>';
            html += '<td>' + _proyGanttFmtFechaCorta(r.fechaInicio) + '</td>';
            html += '<td>' + _proyGanttFmtFechaCorta(r.fechaFin) + '</td>';
            html += '<td>' + dias + 'd</td>';
            html += '<td><div class="proy-gantt-list-progress"><div style="width:' + Math.min(100, r.progress) + '%;background:' + r.color + ';"></div></div><span style="font-size:0.7rem;color:#64748b;margin-left:6px;">' + Math.round(r.progress) + '%</span></td>';
            html += '<td><div class="proy-gantt-row-avatars">' + (avs || '<span style="color:#cbd5e1;font-size:0.7rem;">—</span>') + '</div></td>';
            html += '<td>' + estado + '</td>';
            // Acciones
            html += '<td style="text-align:right;">';
            if (r.type === 'actividad') {
                html += '<button type="button" class="proy-gantt-row-edit" data-act-id="' + r.actId + '" title="Editar">' +
                        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
                        '</button>';
            } else {
                html += '<button type="button" class="proy-gantt-row-edit-fase" data-fase-id="' + r.faseId + '" title="Editar fase">' +
                        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
                        '</button>';
            }
            html += '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        html += '</div>';
        return html;
    }

    // ─── DEPS SVG ──────────────────────────────────────────────────────
    function _proyGanttDepsSVG(rowsVisibles) {
        var hayDeps = rowsVisibles.some(function(r) {
            return r.type === 'actividad' && r.dependencias && r.dependencias.length;
        });
        if (!hayDeps) return '';
        return '<svg class="proy-gantt-deps-svg" id="proyGanttDepsSvg" preserveAspectRatio="none">' +
            '<defs>' +
              '<marker id="proyGanttArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
                '<path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>' +
              '</marker>' +
              '<marker id="proyGanttArrowHi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
                '<path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626"/>' +
              '</marker>' +
            '</defs>' +
            '</svg>';
    }

    function _proyGanttDrawDeps(container, rowsVisibles) {
        var svg = container.querySelector('#proyGanttDepsSvg');
        if (!svg) return;
        var grid = container.querySelector('.proy-gantt-grid');
        if (!grid) return;
        var rowEls = grid.querySelectorAll('.proy-gantt-row:not(.proy-gantt-row-header)');
        if (!rowEls.length) return;

        // Mapa actId -> { y, xStart, xEnd } en pixels relativos a `grid`
        var firstRight = grid.querySelector('.proy-gantt-row:not(.proy-gantt-row-header) .proy-gantt-col-right');
        if (!firstRight) return;
        var leftCol = grid.querySelector('.proy-gantt-col-left');
        var leftWidth = leftCol ? leftCol.offsetWidth : 240;
        var rightWidth = firstRight.offsetWidth;
        var headerH = grid.querySelector('.proy-gantt-row-header').offsetHeight;

        // Configurar SVG con tamaño absoluto del grid
        var gridRect = grid.getBoundingClientRect();
        svg.setAttribute('width', gridRect.width);
        svg.setAttribute('height', gridRect.height);
        svg.setAttribute('viewBox', '0 0 ' + gridRect.width + ' ' + gridRect.height);
        svg.style.left = '0';
        svg.style.width = gridRect.width + 'px';
        svg.style.height = gridRect.height + 'px';

        // Limpiar paths previos
        var oldPaths = svg.querySelectorAll('path.proy-gantt-dep-path');
        Array.prototype.forEach.call(oldPaths, function(p) { p.parentNode.removeChild(p); });

        var rowYs = {};   // actId -> y center
        var actBars = {}; // actId -> { x0, x1 }
        Array.prototype.forEach.call(rowEls, function(row) {
            var actId = parseInt(row.getAttribute('data-act-id'), 10);
            if (!actId) return;
            var rect = row.getBoundingClientRect();
            var bar = row.querySelector('.proy-gantt-bar-track[data-act-id], .proy-gantt-milestone[data-act-id]');
            if (!bar) return;
            var barRect = bar.getBoundingClientRect();
            rowYs[actId] = (rect.top - gridRect.top) + (rect.height / 2);
            actBars[actId] = {
                x0: barRect.left - gridRect.left,
                x1: barRect.right - gridRect.left
            };
        });

        var ns = 'http://www.w3.org/2000/svg';
        rowsVisibles.forEach(function(toR) {
            if (toR.type !== 'actividad' || !toR.dependencias || !toR.dependencias.length) return;
            (toR.dependencias || []).forEach(function(depId) {
                if (!actBars[depId] || !actBars[toR.actId]) return;
                var fromX = actBars[depId].x1;
                var fromY = rowYs[depId];
                var toX = actBars[toR.actId].x0;
                var toY = rowYs[toR.actId];
                if (fromX == null || toX == null) return;

                // Curva en S con offset
                var dx = 14;
                var d = 'M ' + fromX + ' ' + fromY +
                        ' C ' + (fromX + dx) + ' ' + fromY + ', ' +
                                (toX - dx) + ' ' + toY + ', ' +
                                (toX - 1) + ' ' + toY;

                var path = document.createElementNS(ns, 'path');
                path.setAttribute('d', d);
                path.setAttribute('stroke', '#94a3b8');
                path.setAttribute('stroke-width', '1.4');
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke-dasharray', '3,3');
                path.setAttribute('marker-end', 'url(#proyGanttArrow)');
                path.setAttribute('data-from', String(depId));
                path.setAttribute('data-to', String(toR.actId));
                path.setAttribute('class', 'proy-gantt-dep-path');
                svg.appendChild(path);
            });
        });
    }

    // ─── HANDLERS ──────────────────────────────────────────────────────
    function _proyGanttAttachHandlers(container, projectId, detail, data, rowsVisibles, totalUnits, fases) {
        var rerender = function() { _proyGanttRender(container, projectId, detail, data); };

        // Dibujar dependencias post-layout y bind resize
        if (_proyGanttVista === 'gantt') {
            // requestAnimationFrame para esperar al layout
            requestAnimationFrame(function() { _proyGanttDrawDeps(container, rowsVisibles); });

            // Auto-scroll a "hoy"
            if (_proyGanttPendingScroll) {
                _proyGanttPendingScroll = false;
                requestAnimationFrame(function() {
                    var scroll = container.querySelector('#proyGanttScroll');
                    var todayLine = container.querySelector('.proy-gantt-today-line-header');
                    if (scroll && todayLine) {
                        var leftCol = container.querySelector('.proy-gantt-col-left');
                        var leftWidth = leftCol ? leftCol.offsetWidth : 240;
                        var todayPct = parseFloat(todayLine.style.left) || 0;
                        var rightWidth = scroll.scrollWidth - leftWidth;
                        var scrollTo = Math.max(0, (todayPct / 100) * rightWidth - scroll.clientWidth / 3);
                        scroll.scrollLeft = scrollTo;
                    }
                });
            }

            if (!_proyGanttResizeBound) {
                _proyGanttResizeBound = true;
                window.addEventListener('resize', function() {
                    var c = el('proyProgramaContainer');
                    if (c && _proyGanttVista === 'gantt') {
                        // re-dibujar deps con coords actualizadas
                        _proyGanttDrawDeps(c, rowsVisibles);
                    }
                });
            }
        }

        // Filtros estado
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-filter-btn[data-filter]'), function(btn) {
            btn.addEventListener('click', function() {
                _proyGanttFiltro = btn.getAttribute('data-filter') || 'todo';
                rerender();
            });
        });
        // Vista
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-filter-btn[data-vista]'), function(btn) {
            btn.addEventListener('click', function() {
                _proyGanttVista = btn.getAttribute('data-vista') || 'gantt';
                rerender();
            });
        });
        // Zoom
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-filter-btn[data-zoom]'), function(btn) {
            btn.addEventListener('click', function() {
                _proyGanttZoom = btn.getAttribute('data-zoom') || 'mes';
                _proyGanttPendingScroll = true;  // re-centrar hoy en el nuevo zoom
                rerender();
            });
        });
        // Filtro responsable
        var selResp = el('proyGanttFiltroResp');
        if (selResp) selResp.addEventListener('change', function() {
            _proyGanttFiltroResp = this.value || ''; rerender();
        });
        // Filtro categoria
        var selCat = el('proyGanttFiltroCat');
        if (selCat) selCat.addEventListener('change', function() {
            _proyGanttFiltroCat = this.value || ''; rerender();
        });
        // Buqueda
        var searchEl = el('proyGanttSearch');
        if (searchEl) {
            var dt = null;
            searchEl.addEventListener('input', function() {
                clearTimeout(dt);
                var v = searchEl.value;
                dt = setTimeout(function() {
                    _proyGanttBusqueda = v;
                    rerender();
                    setTimeout(function() {
                        var x = el('proyGanttSearch'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); }
                    }, 0);
                }, 200);
            });
            // Cmd+F atajo: solo si el container es visible
            if (!_proyGanttSearchBound) {
                _proyGanttSearchBound = true;
                document.addEventListener('keydown', function(e) {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
                        var pane = el('proyPane_programa');
                        if (pane && pane.offsetParent) {
                            e.preventDefault();
                            var s = el('proyGanttSearch'); if (s) s.focus();
                        }
                    }
                });
            }
        }

        // CTAs
        var btnNueva = el('proyGanttBtnNueva');
        if (btnNueva) btnNueva.addEventListener('click', function() {
            // Si no hay fases, mostrar mensaje guía
            if (!fases || !fases.length) {
                _proyGanttShowToast('Crea primero una fase para organizar tus actividades.', 'info', {
                    actionLabel: '+ Fase',
                    onAction: function() { _openFaseForm(); }
                });
                return;
            }
            _openActividadForm(_isoToday());
        });
        var btnFase = el('proyGanttBtnNuevaFase');
        if (btnFase) btnFase.addEventListener('click', function() { _openFaseForm(); });

        // Export CSV
        var exportBtn = el('proyGanttBtnExport');
        if (exportBtn) exportBtn.addEventListener('click', function() { _proyGanttExportCSV(rowsVisibles, detail); });

        // Imprimir
        var printBtn = el('proyGanttBtnPrint');
        if (printBtn) printBtn.addEventListener('click', function() {
            document.body.classList.add('proy-gantt-printing');
            setTimeout(function() {
                window.print();
                setTimeout(function() { document.body.classList.remove('proy-gantt-printing'); }, 500);
            }, 100);
        });

        // Chevrons (plegar/desplegar fases)
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-chevron'), function(ch) {
            ch.addEventListener('click', function(e) {
                e.stopPropagation();
                var fid = parseInt(ch.getAttribute('data-fase-id'), 10);
                if (!fid) return;
                _proyGanttCollapsed[fid] = !_proyGanttCollapsed[fid];
                rerender();
            });
        });

        // Boton inline "+ Actividad" en una fase
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-row-addact'), function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var fid = parseInt(btn.getAttribute('data-fase-id'), 10);
                _openActividadForm(_isoToday(), { faseId: fid });
            });
        });

        // Link "+ Agregar" dentro de fila de fase vacia
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-fase-empty-link'), function(a) {
            a.addEventListener('click', function(e) {
                e.stopPropagation();
                var fid = parseInt(a.getAttribute('data-fase-id'), 10);
                _openActividadForm(_isoToday(), { faseId: fid });
            });
        });

        // Click en fase (col-left) → editar fase
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-row-fase .proy-gantt-row-info'), function(el2) {
            el2.addEventListener('click', function(e) {
                e.stopPropagation();
                var row = el2.closest('.proy-gantt-row-fase');
                if (!row) return;
                var fid = parseInt(row.getAttribute('data-fase-id'), 10);
                _openFaseForm(fid);
            });
        });
        // Editar fase desde lista
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-row-edit-fase'), function(b) {
            b.addEventListener('click', function() {
                var fid = parseInt(b.getAttribute('data-fase-id'), 10);
                if (fid) _openFaseForm(fid);
            });
        });

        // Tooltip + click + drag + context menu sobre barras / hitos
        var tooltip = el('proyGanttTooltip');
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-bar-track[data-act-id], .proy-gantt-milestone[data-act-id]'), function(bar) {
            var rid = bar.getAttribute('data-row-id');
            var r = rowsVisibles.filter(function(x) { return x.id === rid; })[0];
            if (!r) return;

            bar.addEventListener('mouseenter', function() {
                if (tooltip) {
                    tooltip.innerHTML = _proyGanttTooltipHTML(r);
                    tooltip.style.display = 'block';
                }
                _proyGanttHighlightDeps(container, r, true);
            });
            bar.addEventListener('mousemove', function(e) {
                if (!tooltip) return;
                var rect = container.getBoundingClientRect();
                var x = e.clientX - rect.left + 14;
                var y = e.clientY - rect.top + 14;
                // Clamp para no salir de la pantalla
                var ttW = tooltip.offsetWidth || 280;
                if (x + ttW > rect.width - 12) x = e.clientX - rect.left - ttW - 14;
                tooltip.style.left = x + 'px';
                tooltip.style.top  = y + 'px';
            });
            bar.addEventListener('mouseleave', function() {
                if (tooltip) tooltip.style.display = 'none';
                _proyGanttHighlightDeps(container, null, false);
            });
            // Click → editar
            bar.addEventListener('click', function(e) {
                if (e.shiftKey) return;  // shift-drag se maneja aparte
                if (bar._wasDragged) { bar._wasDragged = false; return; }
                var actId = parseInt(bar.getAttribute('data-act-id'), 10);
                if (actId) _openActividadForm(null, { editId: actId });
            });
            // Right click → context menu
            bar.addEventListener('contextmenu', function(e) {
                e.preventDefault();
                _proyGanttShowCtxMenu(e.clientX, e.clientY, r, container);
            });
            // Drag (shift+arrastrar) o resize por handle
            _proyGanttAttachDrag(bar, r, container, projectId, detail, totalUnits);
        });

        // Click derecho en filas → context menu (también para clicks fuera de la barra)
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-row[data-act-id]'), function(row) {
            row.addEventListener('contextmenu', function(e) {
                if (e.target.closest('.proy-gantt-bar-track, .proy-gantt-milestone')) return;  // ya manejado
                e.preventDefault();
                var rid = row.getAttribute('data-row-id');
                var r = rowsVisibles.filter(function(x) { return x.id === rid; })[0];
                if (r) _proyGanttShowCtxMenu(e.clientX, e.clientY, r, container);
            });
        });

        // Editar desde lista
        Array.prototype.forEach.call(container.querySelectorAll('.proy-gantt-row-edit'), function(b) {
            b.addEventListener('click', function() {
                var aid = parseInt(b.getAttribute('data-act-id'), 10);
                if (aid) _openActividadForm(null, { editId: aid });
            });
        });

        // Cerrar context menu al click fuera
        if (!_proyGanttCtxBound) {
            _proyGanttCtxBound = true;
            document.addEventListener('click', function(e) {
                var menu = el('proyGanttCtxMenu');
                if (menu && !menu.contains(e.target)) menu.style.display = 'none';
            });
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    var m = el('proyGanttCtxMenu'); if (m) m.style.display = 'none';
                    var dc = el('proyGanttDragConfirm'); if (dc) dc.style.display = 'none';
                }
            });
        }
    }
    var _proyGanttCtxBound = false;
    var _proyGanttSearchBound = false;

    function _proyGanttShowCtxMenu(x, y, r, container) {
        var menu = el('proyGanttCtxMenu');
        if (!menu) return;
        if (r.type !== 'actividad') {
            // Para fase: editar / + actividad / eliminar
            menu.innerHTML =
                '<button type="button" data-action="edit-fase">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
                  'Editar fase</button>' +
                '<button type="button" data-action="add-act-fase">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                  '+ Actividad</button>' +
                '<button type="button" data-action="delete-fase" class="proy-gantt-ctxmenu-danger">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
                  'Eliminar fase</button>';
        } else {
            menu.innerHTML =
                '<button type="button" data-action="edit">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
                  'Editar actividad</button>' +
                '<button type="button" data-action="duplicate">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
                  'Duplicar</button>' +
                ((r.dependencias || []).length ? '<button type="button" data-action="show-deps">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h12"/><path d="M15 18H3"/></svg>' +
                  'Ver dependencias (' + r.dependencias.length + ')</button>' : '') +
                '<button type="button" data-action="delete" class="proy-gantt-ctxmenu-danger">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
                  'Eliminar</button>';
        }
        menu.style.display = 'block';
        // Posicion (clamp a viewport)
        var menuW = 180;
        var px = Math.min(x, window.innerWidth - menuW - 12);
        var py = Math.min(y, window.innerHeight - 200);
        menu.style.left = px + 'px';
        menu.style.top  = py + 'px';

        // Bind
        Array.prototype.forEach.call(menu.querySelectorAll('button[data-action]'), function(b) {
            b.addEventListener('click', function() {
                var act = b.getAttribute('data-action');
                menu.style.display = 'none';
                if (act === 'edit')          _openActividadForm(null, { editId: r.actId });
                else if (act === 'duplicate') _proyGanttDuplicarActividad(r);
                else if (act === 'show-deps') _proyGanttShowDepsHighlight(container, r);
                else if (act === 'delete')    _proyGanttEliminarActividadConfirm(r);
                else if (act === 'edit-fase') _openFaseForm(r.faseId);
                else if (act === 'add-act-fase') _openActividadForm(_isoToday(), { faseId: r.faseId });
                else if (act === 'delete-fase') _proyGanttEliminarFaseConfirm(r);
            });
        });
    }

    function _proyGanttShowDepsHighlight(container, r) {
        _proyGanttHighlightDeps(container, r, true);
        setTimeout(function() { _proyGanttHighlightDeps(container, null, false); }, 2500);
    }

    function _proyGanttDuplicarActividad(r) {
        if (!_proyGanttData) return;
        var orig = (_proyGanttData.actividades || []).filter(function(a) { return a.id === r.actId; })[0];
        if (!orig) return;
        var payload = {
            nombre: orig.nombre + ' (copia)',
            fecha_inicio: orig.fecha_inicio,
            duracion_dias: orig.duracion_dias,
            progreso: 0,
            costo_estimado: orig.costo_estimado,
            ingreso_estimado: orig.ingreso_estimado,
            fase_id: orig.fase_id || null,
        };
        _fetch('/app/api/proyecto/' + currentProjectId + '/gantt/', { method: 'POST', body: payload })
            .then(function(resp) {
                if (resp && resp.success) {
                    _showToast('Actividad duplicada');
                    renderProgramaObra(currentProjectId);
                } else {
                    alert('Error al duplicar');
                }
            }).catch(function() { alert('Error de conexión'); });
    }

    function _proyGanttEliminarActividadConfirm(r) {
        proyConfirm('Eliminar actividad', '¿Seguro que quieres eliminar “' + r.name + '”? Esta acción no se puede deshacer.', {
            textoConfirmar: 'Eliminar',
            onConfirm: function() {
                _fetch('/app/api/gantt/actividad/' + r.actId + '/', { method: 'DELETE' }).then(function(resp) {
                    if (resp && resp.success) {
                        _showToast('Actividad eliminada');
                        renderProgramaObra(currentProjectId);
                    } else { alert('Error al eliminar'); }
                });
            }
        });
    }

    function _proyGanttEliminarFaseConfirm(r) {
        var n = r.actividadesCount || 0;
        var msg = n > 0
            ? '¿Eliminar la fase “' + r.name + '” y sus ' + n + ' actividad' + (n === 1 ? '' : 'es') + '? Esta acción no se puede deshacer.'
            : '¿Eliminar la fase “' + r.name + '”?';
        proyConfirm('Eliminar fase', msg, {
            textoConfirmar: 'Eliminar fase',
            onConfirm: function() {
                _fetch('/app/api/gantt/fase/' + r.faseId + '/', { method: 'DELETE' }).then(function(resp) {
                    if (resp && resp.success) {
                        _showToast('Fase eliminada');
                        renderProgramaObra(currentProjectId);
                    } else { alert('Error al eliminar fase'); }
                });
            }
        });
    }

    function _proyGanttHighlightDeps(container, r, on) {
        var paths = container.querySelectorAll('.proy-gantt-dep-path');
        if (!paths.length) return;
        Array.prototype.forEach.call(paths, function(p) {
            var fromId = parseInt(p.getAttribute('data-from'), 10);
            var toId = parseInt(p.getAttribute('data-to'), 10);
            if (on && r && r.actId && (fromId === r.actId || toId === r.actId)) {
                p.setAttribute('stroke', '#dc2626');
                p.setAttribute('stroke-width', '2.5');
                p.setAttribute('stroke-dasharray', '0');
                p.setAttribute('marker-end', 'url(#proyGanttArrowHi)');
            } else {
                p.setAttribute('stroke', '#94a3b8');
                p.setAttribute('stroke-width', '1.4');
                p.setAttribute('stroke-dasharray', '3,3');
                p.setAttribute('marker-end', 'url(#proyGanttArrow)');
            }
        });
    }

    // ─── TOOLTIP RICO ──────────────────────────────────────────────────
    function _proyGanttTooltipHTML(r) {
        var dias = Math.max(1, Math.round(((+r.fechaFin) - (+r.fechaInicio)) / 86400000));
        var hoy = new Date(); hoy.setHours(12, 0, 0, 0);
        var diasRest = Math.round(((+r.fechaFin) - (+hoy)) / 86400000);
        var diasRestTxt;
        if (r.progress >= 100) {
            diasRestTxt = '<span style="color:#34d399;font-weight:700;">Completada</span>';
        } else if (diasRest < 0) {
            diasRestTxt = '<span style="color:#f87171;font-weight:700;">' + Math.abs(diasRest) + ' días vencido</span>';
        } else if (diasRest === 0) {
            diasRestTxt = '<span style="color:#fbbf24;font-weight:700;">Vence hoy</span>';
        } else {
            diasRestTxt = '<span style="color:#34d399;font-weight:700;">' + diasRest + ' días restantes</span>';
        }
        var resps = (r.responsables || []).map(function(u) { return u.nombre || u.username || 'Usuario'; });
        var hitoTag = (r.type === 'actividad' && r.esHito) ? '<span class="proy-gantt-tt-tag" style="background:#fef3c7;color:#a16207;">HITO</span>' : '';
        var faseTag = (r.type === 'fase') ? '<span class="proy-gantt-tt-tag" style="background:#e0e7ff;color:#4338ca;">FASE</span>' : '';
        var depsCount = (r.dependencias || []).length;

        var html = '<div class="proy-gantt-tt-title">' + _proyGanttEsc(r.name) + hitoTag + faseTag + '</div>';
        html += '<div class="proy-gantt-tt-cat" style="color:' + r.color + ';">' + _proyGanttEsc(r.category.label) + '</div>';
        html += '<div class="proy-gantt-tt-row">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
                _proyGanttFmtFechaCorta(r.fechaInicio) + ' → ' + _proyGanttFmtFechaCorta(r.fechaFin) + ' (' + dias + 'd)</div>';
        html += '<div class="proy-gantt-tt-row">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                'Avance: <strong>' + Math.round(r.progress) + '%</strong>' +
                ' (esperado ' + Math.round(r.expectedProgress) + '%)</div>';
        html += '<div class="proy-gantt-tt-row">' + diasRestTxt + '</div>';
        if (resps.length) {
            html += '<div class="proy-gantt-tt-row">' +
                    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>' +
                    resps.slice(0, 4).join(', ') + (resps.length > 4 ? ' +' + (resps.length - 4) : '') + '</div>';
        }
        if (depsCount) {
            html += '<div class="proy-gantt-tt-row" style="opacity:0.85;">Depende de ' + depsCount + ' actividad' + (depsCount === 1 ? '' : 'es') + '</div>';
        }
        if (r.costo > 0 || r.ingreso > 0) {
            var costo = r.costo ? '$' + Number(r.costo).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
            var ingreso = r.ingreso ? '$' + Number(r.ingreso).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
            html += '<div class="proy-gantt-tt-row" style="opacity:0.85;">Costo ' + costo + ' · Ingreso ' + ingreso + '</div>';
        }
        return html;
    }

    // ─── DRAG (shift-arrastrar mover, handle = resize) ─────────────────
    function _proyGanttAttachDrag(bar, r, container, projectId, detail, totalUnits) {
        if (r.type !== 'actividad') return;
        if (r.esHito) return;  // hitos no se redimensionan

        var dragging = false;
        var resizing = false;
        var startX = 0;
        var origLeft = 0;
        var origWidth = 0;
        var trackParent = null;

        var handle = bar.querySelector('.proy-gantt-bar-handle');

        function onMouseMove(e) {
            if (!dragging && !resizing) return;
            e.preventDefault();
            var dx = e.clientX - startX;
            var pw = trackParent.offsetWidth;
            if (resizing) {
                var newWidthPx = Math.max(8, origWidth + dx);
                var pct = (newWidthPx / pw) * 100;
                bar.style.width = pct + '%';
            } else if (dragging) {
                var newLeftPx = origLeft + dx;
                newLeftPx = Math.max(0, Math.min(pw - origWidth, newLeftPx));
                var pct2 = (newLeftPx / pw) * 100;
                bar.style.left = pct2 + '%';
            }
            bar._wasDragged = true;
        }

        function onMouseUp(e) {
            if (!dragging && !resizing) return;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            bar.style.cursor = '';
            bar.classList.remove('is-dragging');
            // Calcular nuevas fechas a partir de left/width finales
            var pw = trackParent.offsetWidth;
            var newLeftPx = (parseFloat(bar.style.left) / 100) * pw;
            var newWidthPx = (parseFloat(bar.style.width) / 100) * pw;
            var newStartUnit = (newLeftPx / pw) * totalUnits;
            var newDurUnits = (newWidthPx / pw) * totalUnits;
            // Convertir unidades a fecha
            var yearStart = (_proyGanttData.proyecto_inicio) ? parseInt(String(_proyGanttData.proyecto_inicio).slice(0,4),10) : (new Date()).getFullYear();
            if (detail && detail.fecha_inicio) yearStart = parseInt(String(detail.fecha_inicio).slice(0,4),10);
            var newIni = _proyGanttUnitToDate(newStartUnit, yearStart, _proyGanttZoom);
            var newDurDias;
            if (resizing) {
                var newFin = _proyGanttUnitToDate(newStartUnit + newDurUnits, yearStart, _proyGanttZoom);
                newDurDias = Math.max(1, Math.round((newFin - newIni) / 86400000));
            } else {
                newDurDias = r.fechaFin && r.fechaInicio ? Math.max(1, Math.round((r.fechaFin - r.fechaInicio) / 86400000)) : 1;
            }
            // Toast confirm
            var oldIni = r.fechaInicio;
            var oldFin = r.fechaFin;
            var newFinDate = new Date(newIni.getTime() + newDurDias * 86400000);

            _proyGanttShowDragConfirm({
                titulo: resizing ? 'Cambiar duración' : 'Mover actividad',
                actividad: r.name,
                oldStart: oldIni, oldEnd: oldFin,
                newStart: newIni, newEnd: newFinDate,
                onAccept: function() {
                    _fetch('/app/api/gantt/actividad/' + r.actId + '/', {
                        method: 'PUT',
                        body: {
                            fecha_inicio: newIni.toISOString().slice(0, 10),
                            duracion_dias: newDurDias
                        }
                    }).then(function(resp) {
                        if (resp && resp.success) {
                            _showToast('Cambios guardados');
                            renderProgramaObra(currentProjectId);
                        } else {
                            alert('Error al guardar cambios');
                            renderProgramaObra(currentProjectId);
                        }
                    }).catch(function() {
                        alert('Error de conexión');
                        renderProgramaObra(currentProjectId);
                    });
                },
                onCancel: function() {
                    renderProgramaObra(currentProjectId);
                }
            });

            dragging = false;
            resizing = false;
        }

        bar.addEventListener('mousedown', function(e) {
            // Resize si click sobre el handle
            if (e.target === handle) {
                resizing = true;
            } else if (e.shiftKey) {
                dragging = true;
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            trackParent = bar.parentElement;
            // origLeft / origWidth en pixels
            var pw = trackParent.offsetWidth;
            origLeft = (parseFloat(bar.style.left) / 100) * pw;
            origWidth = (parseFloat(bar.style.width) / 100) * pw;
            bar.style.cursor = resizing ? 'ew-resize' : 'grabbing';
            bar.classList.add('is-dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    function _proyGanttShowDragConfirm(opts) {
        var dc = el('proyGanttDragConfirm');
        if (!dc) return;
        var fmt = _proyGanttFmtFechaCorta;
        dc.innerHTML =
            '<div class="proy-gantt-drag-card">' +
              '<div class="proy-gantt-drag-title">' + _proyGanttEsc(opts.titulo) + '</div>' +
              '<div class="proy-gantt-drag-act">' + _proyGanttEsc(opts.actividad) + '</div>' +
              '<div class="proy-gantt-drag-row">' +
                '<span class="proy-gantt-drag-label">Inicio</span>' +
                '<span class="proy-gantt-drag-old">' + fmt(opts.oldStart) + '</span>' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
                '<span class="proy-gantt-drag-new">' + fmt(opts.newStart) + '</span>' +
              '</div>' +
              '<div class="proy-gantt-drag-row">' +
                '<span class="proy-gantt-drag-label">Fin</span>' +
                '<span class="proy-gantt-drag-old">' + fmt(opts.oldEnd) + '</span>' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>' +
                '<span class="proy-gantt-drag-new">' + fmt(opts.newEnd) + '</span>' +
              '</div>' +
              '<div class="proy-gantt-drag-actions">' +
                '<button type="button" class="proy-gantt-drag-cancel">Cancelar</button>' +
                '<button type="button" class="proy-gantt-drag-accept">Confirmar</button>' +
              '</div>' +
            '</div>';
        dc.style.display = 'flex';
        var cancelBtn = dc.querySelector('.proy-gantt-drag-cancel');
        var acceptBtn = dc.querySelector('.proy-gantt-drag-accept');
        cancelBtn.addEventListener('click', function() { dc.style.display = 'none'; if (opts.onCancel) opts.onCancel(); });
        acceptBtn.addEventListener('click', function() { dc.style.display = 'none'; if (opts.onAccept) opts.onAccept(); });
    }

    function _proyGanttExportCSV(rows, detail) {
        var nombreProy = (detail && detail.nombre) ? detail.nombre.replace(/[^\w\-]/g, '_') : 'cronograma';
        var sep = ',';
        var headers = ['Tipo','Nombre','Categoria','Fase_Padre','Inicio','Fin','Duracion_dias','Progreso_pct','Responsables','Estado','Hito','Costo','Ingreso'];
        var lines = [headers.join(sep)];
        rows.forEach(function(r) {
            var dias = Math.max(1, Math.round(((+r.fechaFin) - (+r.fechaInicio)) / 86400000));
            var resps = (r.responsables || []).map(function(u) { return u.nombre || u.username || ''; }).join(' / ');
            var estado = r.progress >= 100 ? 'Completada' : (r.isActive ? 'Activa' : 'Pendiente');
            var fila = [
                r.type, _csvCell(r.name), r.category.label, _csvCell(r.parentName || ''),
                r.fechaInicio.toISOString().slice(0,10), r.fechaFin.toISOString().slice(0,10),
                dias, Math.round(r.progress), _csvCell(resps), estado,
                (r.esHito ? 'Sí' : 'No'), r.costo || 0, r.ingreso || 0
            ];
            lines.push(fila.join(sep));
        });
        var csv = '﻿' + lines.join('\r\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        var url = URL.createObjectURL(blob);
        a.href = url;
        a.download = 'gantt_' + nombreProy + '_' + (new Date()).toISOString().slice(0,10) + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        _showToast('Cronograma exportado');
    }

    function _csvCell(s) {
        if (s == null) s = '';
        s = String(s);
        if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    // ─── CALCULOS DE FECHAS / UNIDADES ─────────────────────────────────
    function _proyGanttDateToUnit(d, yearStart, zoom) {
        var year = d.getFullYear();
        var month = d.getMonth();
        var day = d.getDate();
        var daysInMonth = new Date(year, month + 1, 0).getDate();
        var dayFraction = (day - 1) / daysInMonth;
        var monthsFromStart = (year - yearStart) * 12 + month;
        if (zoom === 'ano') {
            // 1 unidad = 1 año completo. Fracción dentro del año.
            var dayOfYear = Math.floor((d - new Date(year, 0, 1)) / 86400000);
            var daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
            return (year - yearStart) + (dayOfYear / daysInYear);
        }
        if (zoom === 'trimestre' || zoom === 'mes') return monthsFromStart + dayFraction;
        if (zoom === 'semana') {
            var jan1 = new Date(yearStart, 0, 1);
            return ((d - jan1) / 86400000) / 7;
        }
        return monthsFromStart + dayFraction;
    }

    function _proyGanttUnitToDate(u, yearStart, zoom) {
        if (zoom === 'ano') {
            var yrInt = Math.floor(u);
            var yrFrac = u - yrInt;
            var year = yearStart + yrInt;
            var daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
            var dayOfYear = Math.round(yrFrac * daysInYear);
            var d = new Date(year, 0, 1);
            d.setDate(d.getDate() + dayOfYear);
            d.setHours(12, 0, 0, 0);
            return d;
        }
        if (zoom === 'trimestre' || zoom === 'mes') {
            return _monthsFromStartToDate(u, yearStart);
        }
        if (zoom === 'semana') {
            var jan1 = new Date(yearStart, 0, 1);
            var ms = jan1.getTime() + u * 7 * 86400000;
            var dd = new Date(ms); dd.setHours(12, 0, 0, 0);
            return dd;
        }
        return _monthsFromStartToDate(u, yearStart);
    }

    function _monthsFromStartToDate(monthsFloat, yearStart) {
        var monthsInt = Math.floor(monthsFloat);
        var monthFrac = monthsFloat - monthsInt;
        var year = yearStart + Math.floor(monthsInt / 12);
        var month = monthsInt % 12;
        var daysInMonth = new Date(year, month + 1, 0).getDate();
        var day = Math.round(monthFrac * daysInMonth) + 1;
        var d = new Date(year, month, day, 12, 0, 0);
        return d;
    }

    // Devuelve { primary: [...], secondary: [...] }.
    // - primary: fila superior (grupos grandes — Q1..Q4 en trimestre, mes en semana)
    // - secondary: fila inferior (subdivisiones de cada unidad de la grilla)
    // Cuando no hay agrupación (mes, año), primary va vacío.
    function _proyGanttSubdivisions(zoom, yearStart, hoy) {
        var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        var primary = [];
        var secondary = [];

        if (zoom === 'ano') {
            // Una sola columna (todo el año). Sub-divisiones internas: 4 trimestres.
            primary.push({
                label: yearStart.toString(),
                isCurrent: (hoy.getFullYear() === yearStart),
                span: 1
            });
            ['Q1','Q2','Q3','Q4'].forEach(function(q, i) {
                var qm = i * 3;
                var isCur = (hoy.getFullYear() === yearStart && hoy.getMonth() >= qm && hoy.getMonth() < qm + 3);
                secondary.push({ label: q, isCurrent: isCur });
            });
        } else if (zoom === 'trimestre') {
            // 4 grupos Q1..Q4 (header arriba), cada uno con 3 meses (header abajo).
            for (var qi = 0; qi < 4; qi++) {
                var qmStart = qi * 3;
                var qIsCur = (hoy.getFullYear() === yearStart && hoy.getMonth() >= qmStart && hoy.getMonth() < qmStart + 3);
                primary.push({
                    label: 'Q' + (qi + 1) + ' ' + yearStart,
                    isCurrent: qIsCur,
                    span: 3
                });
            }
            meses.forEach(function(m, i) {
                secondary.push({
                    label: m,
                    isCurrent: (hoy.getFullYear() === yearStart && i === hoy.getMonth())
                });
            });
        } else if (zoom === 'mes') {
            // Sin header agrupador; sólo 12 meses con sufijo año corto.
            meses.forEach(function(m, i) {
                secondary.push({
                    label: m + ' ' + yearStart.toString().slice(2),
                    isCurrent: (hoy.getFullYear() === yearStart && i === hoy.getMonth())
                });
            });
        } else if (zoom === 'semana') {
            // Header agrupador: 12 meses (cada uno cubre ~4.33 semanas).
            // Sub-header: 52 semanas.
            // Para que la fila Mes alinee bien con las semanas, calculamos
            // el span (en semanas) de cada mes a partir del calendario real.
            var weeksByMonth = [0,0,0,0,0,0,0,0,0,0,0,0];
            for (var ww = 1; ww <= 52; ww++) {
                var jan1m = new Date(yearStart, 0, 1);
                var dd = new Date(jan1m.getTime() + (ww - 1) * 7 * 86400000);
                var midWeek = new Date(dd.getTime() + 3 * 86400000);
                weeksByMonth[midWeek.getMonth()] += 1;
            }
            // Asegurar suma=52 y meses no-cero
            var sum = weeksByMonth.reduce(function(a,b){ return a+b; }, 0);
            if (sum !== 52) weeksByMonth[11] += (52 - sum);
            meses.forEach(function(m, i) {
                primary.push({
                    label: m + ' ' + yearStart.toString().slice(2),
                    isCurrent: (hoy.getFullYear() === yearStart && i === hoy.getMonth()),
                    span: Math.max(1, weeksByMonth[i])
                });
            });
            for (var w = 1; w <= 52; w++) {
                var jan1 = new Date(yearStart, 0, 1);
                var d = new Date(jan1.getTime() + (w - 1) * 7 * 86400000);
                var weekEnd = new Date(d.getTime() + 6 * 86400000);
                var isCur = (hoy >= d && hoy <= weekEnd);
                secondary.push({ label: 'S' + w, isCurrent: isCur });
            }
        }
        return { primary: primary, secondary: secondary };
    }

    // ─── CONSTRUIR FILAS ───────────────────────────────────────────────
    function _proyGanttBuildRows(fases, actividades, yearStart, totalUnits, hoyUnit) {
        var byFase = {};
        actividades.forEach(function(a) {
            var k = a.fase_id || '__sinfase__';
            if (!byFase[k]) byFase[k] = [];
            byFase[k].push(a);
        });
        var rows = [];
        // Fases ordenadas (vienen ya ordenadas por backend)
        fases.forEach(function(f) {
            var acts = byFase[f.id] || [];
            var faseRow = _proyGanttFaseRow(f, acts, yearStart, totalUnits, hoyUnit);
            if (faseRow) rows.push(faseRow);
            // Hijas
            acts.slice().sort(function(a, b) {
                if (a.orden !== b.orden) return (a.orden || 0) - (b.orden || 0);
                return (a.fecha_inicio || '').localeCompare(b.fecha_inicio || '');
            }).forEach(function(a) {
                var ar = _proyGanttActividadRow(a, yearStart, totalUnits, hoyUnit);
                if (ar) {
                    ar.parentName = f.nombre;
                    ar.parentFaseId = f.id;
                    rows.push(ar);
                }
            });
        });
        // Actividades sin fase (huérfanas)
        (byFase['__sinfase__'] || []).forEach(function(a) {
            var ar = _proyGanttActividadRow(a, yearStart, totalUnits, hoyUnit);
            if (ar) { ar.parentName = ''; rows.push(ar); }
        });
        return rows;
    }

    function _proyGanttFaseRow(fase, acts, yearStart, totalUnits, hoyUnit) {
        if (!acts.length) {
            // Fase vacia: aún se muestra la fila (sin barra)
            return {
                type: 'fase', id: 'f' + fase.id, faseId: fase.id, name: fase.nombre || 'Fase',
                startUnit: 0, durationUnits: 0, rawStart: 0, rawEnd: 0,
                progress: 0, expectedProgress: 0,
                category: _proyGanttCategoryFor(fase.nombre),
                color: _proyGanttCategoryFor(fase.nombre).color,
                responsables: [], isActive: false, actividadesCount: 0,
                fechaInicio: new Date(yearStart, 0, 1, 12, 0), fechaFin: new Date(yearStart, 0, 1, 12, 0),
                esHito: false, costo: 0, ingreso: 0, dependencias: [],
                isEmpty: true
            };
        }
        var minStart = null; var maxEnd = null;
        var totalDias = 0; var sumaProgresoPond = 0;
        var responsableMap = {}; var sumaCosto = 0; var sumaIngreso = 0;
        acts.forEach(function(a) {
            if (!a.fecha_inicio) return;
            var ini = new Date(a.fecha_inicio + 'T12:00:00');
            var fin = new Date(ini.getTime() + (a.duracion_dias || 1) * 86400000);
            if (!minStart || ini < minStart) minStart = ini;
            if (!maxEnd || fin > maxEnd) maxEnd = fin;
            var dias = a.duracion_dias || 1;
            totalDias += dias; sumaProgresoPond += dias * (a.progreso || 0);
            sumaCosto += parseFloat(a.costo_estimado || 0) || 0;
            sumaIngreso += parseFloat(a.ingreso_estimado || 0) || 0;
            (a.recursos || []).forEach(function(r) { if (!responsableMap[r.id]) responsableMap[r.id] = r; });
        });
        if (!minStart || !maxEnd) return null;
        var startU = _proyGanttDateToUnit(minStart, yearStart, _proyGanttZoom);
        var endU = _proyGanttDateToUnit(maxEnd, yearStart, _proyGanttZoom);
        var clampedStart = Math.max(0, Math.min(totalUnits, startU));
        var clampedEnd = Math.max(0, Math.min(totalUnits, endU));
        var progress = totalDias > 0 ? Math.round(sumaProgresoPond / totalDias) : 0;
        var category = _proyGanttCategoryFor(fase.nombre);
        var isActive = (startU <= hoyUnit && endU >= hoyUnit);
        var responsables = Object.keys(responsableMap).map(function(k) { return responsableMap[k]; });
        var expectedProgress = 0;
        if (hoyUnit >= endU) expectedProgress = 100;
        else if (hoyUnit > startU) expectedProgress = ((hoyUnit - startU) / (endU - startU)) * 100;
        return {
            type: 'fase', id: 'f' + fase.id, faseId: fase.id, name: fase.nombre || 'Fase',
            startUnit: clampedStart, durationUnits: Math.max(0, clampedEnd - clampedStart),
            rawStart: startU, rawEnd: endU, progress: progress, expectedProgress: expectedProgress,
            category: category, color: category.color, responsables: responsables, isActive: isActive,
            actividadesCount: acts.length, fechaInicio: minStart, fechaFin: maxEnd,
            esHito: false, costo: sumaCosto, ingreso: sumaIngreso, dependencias: []
        };
    }

    function _proyGanttActividadRow(a, yearStart, totalUnits, hoyUnit) {
        var ini = new Date(a.fecha_inicio + 'T12:00:00');
        if (isNaN(ini.getTime())) return null;
        var dur = a.duracion_dias || 1;
        var fin = new Date(ini.getTime() + dur * 86400000);
        var startU = _proyGanttDateToUnit(ini, yearStart, _proyGanttZoom);
        var endU = _proyGanttDateToUnit(fin, yearStart, _proyGanttZoom);
        var clampedStart = Math.max(0, Math.min(totalUnits, startU));
        var clampedEnd = Math.max(0, Math.min(totalUnits, endU));
        var esHito = (dur <= 1);
        var category = _proyGanttCategoryFor(a.nombre);
        var isActive = (startU <= hoyUnit && endU >= hoyUnit);
        var expectedProgress = 0;
        if (hoyUnit >= endU) expectedProgress = 100;
        else if (hoyUnit > startU) expectedProgress = ((hoyUnit - startU) / Math.max(0.0001, endU - startU)) * 100;
        return {
            type: 'actividad', id: 'a' + a.id, actId: a.id, name: a.nombre || 'Actividad',
            startUnit: clampedStart, durationUnits: Math.max(0, clampedEnd - clampedStart),
            rawStart: startU, rawEnd: endU, progress: a.progreso || 0, expectedProgress: expectedProgress,
            category: category, color: category.color, responsables: a.recursos || [], isActive: isActive,
            actividadesCount: 0, fechaInicio: ini, fechaFin: fin, esHito: esHito,
            costo: parseFloat(a.costo_estimado || 0) || 0,
            ingreso: parseFloat(a.ingreso_estimado || 0) || 0,
            dependencias: a.dependencias || []
        };
    }

    function _proyGanttAvanceGlobal(rows) {
        var actsRows = rows.filter(function(r) { return r.type === 'actividad'; });
        if (!actsRows.length) return 0;
        var totalDias = 0; var sumaPond = 0;
        actsRows.forEach(function(r) {
            var dias = Math.max(1, Math.round(((+r.fechaFin) - (+r.fechaInicio)) / 86400000));
            totalDias += dias; sumaPond += dias * r.progress;
        });
        return totalDias > 0 ? (sumaPond / totalDias) : 0;
    }

    function _proyGanttAvatarColor(seed) {
        var palette = ['#6366f1','#0891b2','#16a34a','#d97706','#dc2626','#2563eb','#8b5cf6','#ec4899','#0d9488'];
        var n = parseInt(seed, 10);
        if (isNaN(n)) n = String(seed).split('').reduce(function(s,c){ return s + c.charCodeAt(0); }, 0);
        return palette[Math.abs(n) % palette.length];
    }

    // ─── EMPTY STATE ───────────────────────────────────────────────────
    function _proyGanttEmptyState() {
        var html = '<div class="proy-gantt-root">';
        html += '<div class="proy-gantt-empty">';
        html += '  <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#cbd5e1" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 4v16"/><path d="M16 14h4"/><path d="M16 17h2"/></svg>';
        html += '  <h3>Aún no hay cronograma</h3>';
        html += '  <p>Empieza creando una <strong>Fase</strong> (Planificación, Cimentación, Estructura…) y dentro de ella agrega tus actividades.</p>';
        html += '  <div class="proy-gantt-empty-actions">';
        html += '    <button type="button" class="proy-gantt-cta proy-gantt-cta-fase" id="proyGanttBtnEmptyFase">+ Crear primera Fase</button>';
        html += '    <button type="button" class="proy-gantt-icon-btn" id="proyGanttBtnEmptyAct">+ Actividad sin fase</button>';
        html += '  </div>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function _proyGanttBindEmptyState(container, projectId, detail) {
        var bf = container.querySelector('#proyGanttBtnEmptyFase');
        if (bf) bf.addEventListener('click', function() { _openFaseForm(); });
        var ba = container.querySelector('#proyGanttBtnEmptyAct');
        if (ba) ba.addEventListener('click', function() { _openActividadForm(_isoToday()); });
    }

    // Toast con accion (ej: "+ Fase")
    function _proyGanttShowToast(msg, kind, opts) {
        opts = opts || {};
        var existing = document.getElementById('proyToast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = 'proyToast';
        var bg = (kind === 'info') ? '#1f2937' : '#1D1D1F';
        toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:' + bg + ';color:#fff;padding:14px 22px;border-radius:12px;font-size:0.85rem;font-weight:600;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.25);transition:opacity 0.3s;display:flex;align-items:center;gap:12px;font-family:Plus Jakarta Sans,sans-serif;';
        toast.innerHTML = '<span>' + _proyGanttEsc(msg) + '</span>';
        if (opts.actionLabel) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = opts.actionLabel;
            btn.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:inherit;';
            btn.onclick = function() {
                if (opts.onAction) opts.onAction();
                toast.remove();
            };
            toast.appendChild(btn);
        }
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; }, 4000);
        setTimeout(function() { toast.remove(); }, 4500);
    }

    window.proyectosRenderProgramaObra = renderProgramaObra;


    // =========================================
    //  ACTIVIDAD FORM (PROGRAMA DE OBRA)
    // =========================================

    function _getDayNameSpanish(dateStr) {
        var d = new Date(dateStr + 'T12:00:00');
        var names = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        return names[d.getDay()];
    }

    function _fmtDateLong(dateStr) {
        var d = new Date(dateStr + 'T12:00:00');
        var months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return d.getDate() + ' de ' + months[d.getMonth()] + ' de ' + d.getFullYear();
    }

    function _isoToday() { return (new Date()).toISOString().split('T')[0]; }
    function _isoAddDays(iso, days) {
        var d = new Date(iso + 'T12:00:00');
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    }
    function _diffDays(iso1, iso2) {
        var a = new Date(iso1 + 'T12:00:00');
        var b = new Date(iso2 + 'T12:00:00');
        return Math.round((b - a) / 86400000);
    }

    function _openActividadForm(dateStr, opts) {
        opts = opts || {};
        var dlg = el('proyDialogoActividad');
        if (!dlg) {
            console.error('[gantt] modal #proyDialogoActividad no encontrado');
            alert('No se pudo abrir el formulario de actividad. Recarga la pagina.');
            return;
        }

        _proyActEditId = opts.editId || null;
        _actividadSelectedUsers = {};
        _actividadSelectedRecursos = {};
        _proyActDeps = {};

        var isEdit = !!_proyActEditId;
        var actividad = null;
        if (isEdit && _proyGanttData && Array.isArray(_proyGanttData.actividades)) {
            for (var i = 0; i < _proyGanttData.actividades.length; i++) {
                if (_proyGanttData.actividades[i].id === _proyActEditId) {
                    actividad = _proyGanttData.actividades[i];
                    break;
                }
            }
        }

        var titEl = el('proyActDialogTitle');
        if (titEl) titEl.textContent = isEdit ? 'Editar Actividad' : 'Nueva Actividad';
        var btnCrearEl = el('proyActBtnCrear');
        if (btnCrearEl) btnCrearEl.textContent = isEdit ? 'Guardar cambios' : 'Crear Actividad';
        var btnElimEl = el('proyActBtnEliminar');
        if (btnElimEl) btnElimEl.style.display = isEdit ? 'inline-flex' : 'none';

        var fechaIni = (actividad && actividad.fecha_inicio) || dateStr || _isoToday();
        var fechaFin;
        if (actividad) {
            fechaFin = _isoAddDays(actividad.fecha_inicio, actividad.duracion_dias || 1);
        } else {
            fechaFin = _isoAddDays(fechaIni, 3);  // default 3 días
        }

        if (el('proyActTitulo')) {
            el('proyActTitulo').value = actividad ? (actividad.nombre || '') : '';
            el('proyActTitulo').style.borderColor = '';
        }
        if (el('proyActDescripcion')) {
            el('proyActDescripcion').value = actividad ? (actividad.descripcion || '') : '';
        }
        if (el('proyActFechaInicio')) el('proyActFechaInicio').value = fechaIni;
        if (el('proyActFechaFin')) el('proyActFechaFin').value = fechaFin;
        if (el('proyActProgreso')) el('proyActProgreso').value = actividad ? (actividad.progreso || 0) : 0;
        if (el('proyActProgresoRange')) el('proyActProgresoRange').value = actividad ? (actividad.progreso || 0) : 0;
        if (el('proyActCosto')) el('proyActCosto').value = actividad ? (actividad.costo_estimado || 0) : 0;
        if (el('proyActIngreso')) el('proyActIngreso').value = actividad ? (actividad.ingreso_estimado || 0) : 0;

        var hitoChk = el('proyActEsHito');
        var esHito = actividad ? ((actividad.duracion_dias || 1) <= 1) : false;
        if (hitoChk) hitoChk.checked = esHito;

        var label = el('proyActFechaLabel');
        if (label) {
            try { label.textContent = _getDayNameSpanish(fechaIni) + ', ' + _fmtDateLong(fechaIni); }
            catch (e) { label.textContent = 'Cronograma del proyecto'; }
        }

        // Fase: si llega faseId desde "+ Actividad" inline, pre-seleccionar
        var preFaseId = (opts.faseId != null) ? opts.faseId : (actividad ? actividad.fase_id : null);
        _populateFasesSelect(preFaseId);

        if (actividad && Array.isArray(actividad.recursos)) {
            actividad.recursos.forEach(function(r) {
                _actividadSelectedUsers[r.id] = {
                    id: r.id,
                    nombre: r.nombre || r.username || ('Usuario ' + r.id),
                };
            });
        }
        if (actividad && Array.isArray(actividad.recursos_materiales)) {
            actividad.recursos_materiales.forEach(function(rm) {
                _actividadSelectedRecursos[rm.id] = {
                    id: rm.id,
                    nombre: rm.nombre || ('Recurso ' + rm.id),
                    tipo: rm.tipo || 'otro',
                    tipo_label: rm.tipo_label || '',
                };
            });
        }
        if (actividad && Array.isArray(actividad.dependencias)) {
            actividad.dependencias.forEach(function(id) { _proyActDeps[id] = true; });
        }

        dlg.style.display = 'flex';

        // Render inicial de chips + bind del autocomplete
        _proyActRenderUsuariosChips();
        _proyActRenderRecursosChips();
        _proyActBindAutocompletes();
        _renderDependenciasOptions(actividad ? actividad.id : null);

        var iniEl = el('proyActFechaInicio');
        var finEl = el('proyActFechaFin');
        if (iniEl) iniEl.onchange = _refreshDuracionLabel;
        if (finEl) finEl.onchange = _refreshDuracionLabel;
        _refreshDuracionLabel();

        if (hitoChk) {
            hitoChk.onchange = function() {
                var wrap = el('proyActFechaFinWrap');
                if (this.checked) {
                    if (finEl && iniEl) finEl.value = iniEl.value;
                    if (wrap) wrap.style.opacity = '0.5';
                    if (finEl) finEl.disabled = true;
                } else {
                    if (wrap) wrap.style.opacity = '';
                    if (finEl) finEl.disabled = false;
                    if (finEl && iniEl && finEl.value === iniEl.value) {
                        finEl.value = _isoAddDays(iniEl.value, 1);
                    }
                }
                _refreshDuracionLabel();
            };
            hitoChk.onchange();
        }

        var rng = el('proyActProgresoRange');
        var num = el('proyActProgreso');
        if (rng && num) {
            rng.oninput = function() { num.value = rng.value; };
            num.oninput = function() {
                var v = parseInt(num.value, 10);
                if (isNaN(v)) v = 0;
                v = Math.max(0, Math.min(100, v));
                num.value = v; rng.value = v;
            };
        }

        setTimeout(function() {
            var t = el('proyActTitulo');
            if (t) t.focus();
        }, 50);
    }

    function _refreshDuracionLabel() {
        var iniEl = el('proyActFechaInicio');
        var finEl = el('proyActFechaFin');
        var lbl = el('proyActDuracionTxt');
        if (!iniEl || !finEl || !lbl) return;
        if (!iniEl.value || !finEl.value) { lbl.textContent = 'Duración: —'; return; }
        var dias = Math.max(1, _diffDays(iniEl.value, finEl.value));
        lbl.textContent = 'Duración: ' + dias + ' día' + (dias === 1 ? '' : 's');
    }

    function _populateFasesSelect(selectedFaseId) {
        var selEl = el('proyActFase');
        if (!selEl) return;
        var fases = (_proyGanttData && Array.isArray(_proyGanttData.fases)) ? _proyGanttData.fases : [];
        var html = '<option value="">— Sin fase (independiente) —</option>';
        fases.forEach(function(f) {
            var selAttr = (selectedFaseId === f.id) ? ' selected' : '';
            html += '<option value="' + f.id + '"' + selAttr + '>' + _proyGanttEsc(f.nombre) + '</option>';
        });
        selEl.innerHTML = html;
        if (selectedFaseId) selEl.value = String(selectedFaseId);
    }

    function _loadMiembrosDelProyecto() {
        var container = el('proyActPersonalList');
        if (!container) return;
        var miembros = _miembrosFromDetail(_cachedProjectDetail);
        if (miembros && miembros.length) {
            _proyGanttMiembros = miembros;
            _renderMiembrosCheckboxes(miembros);
            return;
        }
        if (!currentProjectId) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:0.8rem;">Sin proyecto activo</div>';
            return;
        }
        container.innerHTML = '<div style="text-align:center;padding:16px;color:#8e8e93;font-size:0.8rem;">Cargando equipo del proyecto...</div>';
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/').then(function(resp) {
            if (!resp || !resp.success) {
                container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:0.8rem;">No se pudo cargar el equipo</div>';
                return;
            }
            var detail = resp.data || {};
            _cachedProjectDetail = detail;
            var ms = _miembrosFromDetail(detail);
            _proyGanttMiembros = ms;
            if (!ms.length) {
                container.innerHTML = '<div style="text-align:center;padding:16px;color:#8e8e93;font-size:0.8rem;">Aún no hay miembros en el proyecto.<br>Agrega gente desde el botón "+" del topbar.</div>';
                return;
            }
            _renderMiembrosCheckboxes(ms);
        }).catch(function(err) {
            console.error('[gantt] error cargando miembros:', err);
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:0.8rem;">Error de conexión</div>';
        });
    }

    function _miembrosFromDetail(detail) {
        if (!detail) return [];
        var equipo = (detail.overview && Array.isArray(detail.overview.equipo)) ? detail.overview.equipo : null;
        if (equipo && equipo.length) {
            return equipo.map(function(e) {
                return {
                    id: e.user_id || e.id,
                    nombre: e.nombre || e.name || 'Usuario',
                    iniciales: e.iniciales || _initials(e.nombre || ''),
                };
            });
        }
        if (detail.usuario_id) {
            return [{ id: detail.usuario_id, nombre: detail.usuario_nombre || 'Asignado', iniciales: _initials(detail.usuario_nombre || 'A') }];
        }
        return [];
    }

    function _renderMiembrosCheckboxes(users) {
        var container = el('proyActPersonalList');
        if (!container) return;
        if (!users.length) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#8e8e93;font-size:0.8rem;">No hay miembros disponibles.</div>';
            return;
        }
        var html = '';
        users.forEach(function(u) {
            var checked = _actividadSelectedUsers[u.id] ? ' checked' : '';
            var bg = _proyGanttAvatarColor(u.id);
            html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.15s;color:#1d1d1f;" onmouseover="this.style.background=\'#F5F5F7\'" onmouseout="this.style.background=\'transparent\'">' +
                '<input type="checkbox" value="' + u.id + '"' + checked +
                ' onchange="proyActToggleUser(' + u.id + ', this.checked)" style="width:16px;height:16px;accent-color:#2563eb;flex-shrink:0;">' +
                '<div style="width:28px;height:28px;border-radius:50%;background:' + bg + ';color:#fff;font-size:0.6rem;line-height:28px;text-align:center;flex-shrink:0;font-weight:700;">' + _proyGanttEsc(u.iniciales || _initials(u.nombre)) + '</div>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:0.82rem;font-weight:500;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _proyGanttEsc(u.nombre) + '</div>' +
                '</div>' +
                '</label>';
        });
        container.innerHTML = html;
    }

    function _renderDependenciasOptions(currentActId) {
        var wrap = el('proyActDependenciasWrap');
        var list = el('proyActDependenciasList');
        if (!wrap || !list) return;
        var acts = (_proyGanttData && Array.isArray(_proyGanttData.actividades)) ? _proyGanttData.actividades : [];
        var opts = acts.filter(function(a) { return a.id !== currentActId; });
        if (!opts.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        var html = '';
        opts.forEach(function(a) {
            var checked = _proyActDeps[a.id] ? ' checked' : '';
            html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:0.8rem;color:#1d1d1f;">' +
                '<input type="checkbox" value="' + a.id + '"' + checked +
                ' onchange="proyActToggleDep(' + a.id + ', this.checked)" style="width:14px;height:14px;accent-color:#2563eb;">' +
                '<span>' + _proyGanttEsc(a.nombre) + '</span>' +
                '<span style="color:#94a3b8;font-size:0.7rem;margin-left:auto;">' + _proyGanttEsc(a.fecha_inicio) + '</span>' +
                '</label>';
        });
        list.innerHTML = html;
    }

    window.proyActToggleUser = function(userId, checked) {
        // Compatibilidad con la version anterior (checkbox list).
        // Hoy el modal usa chips + autocomplete, pero esta función se mantiene
        // por si algún punto del código aún la llama.
        if (checked) {
            _actividadSelectedUsers[userId] = _actividadSelectedUsers[userId] || { id: userId, nombre: 'Usuario ' + userId };
        } else {
            delete _actividadSelectedUsers[userId];
        }
    };
    window.proyActToggleDep = function(actId, checked) {
        if (checked) _proyActDeps[actId] = true;
        else delete _proyActDeps[actId];
    };

    // ─── Autocomplete + chips: usuarios y recursos materiales ───────────
    function _proyActRenderUsuariosChips() {
        var wrap = el('proyActUsuariosChips');
        if (!wrap) return;
        var ids = Object.keys(_actividadSelectedUsers);
        if (!ids.length) {
            wrap.innerHTML = '<span class="proy-act-chips-empty">Aún sin responsables</span>';
            return;
        }
        var html = '';
        ids.forEach(function(uid) {
            var u = _actividadSelectedUsers[uid];
            var bg = _proyGanttAvatarColor(u.id);
            var ini = _initials(u.nombre || '') || '·';
            html += '<span class="proy-act-chip proy-act-chip-user" data-id="' + u.id + '">' +
                    '<span class="proy-act-chip-avatar" style="background:' + bg + ';">' + _proyGanttEsc(ini) + '</span>' +
                    '<span class="proy-act-chip-label">' + _proyGanttEsc(u.nombre) + '</span>' +
                    '<button type="button" class="proy-act-chip-remove" data-remove-user="' + u.id + '" aria-label="Quitar">×</button>' +
                    '</span>';
        });
        wrap.innerHTML = html;
        Array.prototype.forEach.call(wrap.querySelectorAll('[data-remove-user]'), function(btn) {
            btn.addEventListener('click', function() {
                var uid = btn.getAttribute('data-remove-user');
                delete _actividadSelectedUsers[uid];
                _proyActRenderUsuariosChips();
            });
        });
    }

    function _proyActRenderRecursosChips() {
        var wrap = el('proyActRecursosChips');
        if (!wrap) return;
        var ids = Object.keys(_actividadSelectedRecursos);
        if (!ids.length) {
            wrap.innerHTML = '<span class="proy-act-chips-empty">Sin recursos asignados</span>';
            return;
        }
        var html = '';
        ids.forEach(function(rid) {
            var r = _actividadSelectedRecursos[rid];
            html += '<span class="proy-act-chip proy-act-chip-recurso" data-id="' + r.id + '">' +
                    '<span class="proy-act-chip-tipo">' + _proyGanttEsc(r.tipo_label || r.tipo || '') + '</span>' +
                    '<span class="proy-act-chip-label">' + _proyGanttEsc(r.nombre) + '</span>' +
                    '<button type="button" class="proy-act-chip-remove" data-remove-recurso="' + r.id + '" aria-label="Quitar">×</button>' +
                    '</span>';
        });
        wrap.innerHTML = html;
        Array.prototype.forEach.call(wrap.querySelectorAll('[data-remove-recurso]'), function(btn) {
            btn.addEventListener('click', function() {
                var rid = btn.getAttribute('data-remove-recurso');
                delete _actividadSelectedRecursos[rid];
                _proyActRenderRecursosChips();
            });
        });
    }

    var _proyActAutoBound = false;
    function _proyActBindAutocompletes() {
        // Binding idempotente — sólo una vez por sesión.
        if (_proyActAutoBound) {
            // Reset visual de los inputs
            var u = el('proyActUsuarioSearch'); if (u) u.value = '';
            var r = el('proyActRecursoSearch'); if (r) r.value = '';
            var ud = el('proyActUsuarioDropdown'); if (ud) ud.style.display = 'none';
            var rd = el('proyActRecursoDropdown'); if (rd) rd.style.display = 'none';
            return;
        }
        _proyActAutoBound = true;

        var userInput = el('proyActUsuarioSearch');
        var userDrop = el('proyActUsuarioDropdown');
        var recInput = el('proyActRecursoSearch');
        var recDrop = el('proyActRecursoDropdown');

        if (userInput && userDrop) {
            var ut = null;
            userInput.addEventListener('input', function() {
                clearTimeout(ut);
                var q = userInput.value;
                ut = setTimeout(function() { _proyActSearchUsers(q, userDrop); }, 200);
            });
            userInput.addEventListener('focus', function() {
                _proyActSearchUsers(userInput.value, userDrop);
            });
        }

        if (recInput && recDrop) {
            var rt = null;
            recInput.addEventListener('input', function() {
                clearTimeout(rt);
                var q = recInput.value;
                rt = setTimeout(function() { _proyActSearchRecursos(q, recDrop, recInput); }, 200);
            });
            recInput.addEventListener('focus', function() {
                _proyActSearchRecursos(recInput.value, recDrop, recInput);
            });
            recInput.addEventListener('keydown', function(e) {
                // Enter sin selección: ofrecer crear nuevo
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var q = recInput.value.trim();
                    if (q) _proyActCrearNuevoRecurso(q);
                }
            });
        }

        // Cierra dropdowns al click fuera
        document.addEventListener('click', function(e) {
            if (userDrop && !e.target.closest('#proyActUsuarioSearch') && !e.target.closest('#proyActUsuarioDropdown')) {
                userDrop.style.display = 'none';
            }
            if (recDrop && !e.target.closest('#proyActRecursoSearch') && !e.target.closest('#proyActRecursoDropdown')) {
                recDrop.style.display = 'none';
            }
        });
    }

    function _proyActSearchUsers(q, dropEl) {
        var url = '/app/api/iamet/usuarios/buscar/?limit=10';
        if (q && q.trim()) url += '&q=' + encodeURIComponent(q.trim());
        _fetch(url).then(function(resp) {
            if (!resp || !resp.success) {
                dropEl.innerHTML = '<div class="proy-act-ac-empty">Sin resultados</div>';
                dropEl.style.display = 'block';
                return;
            }
            var results = (resp.results || []).filter(function(u) { return !_actividadSelectedUsers[u.id]; });
            if (!results.length) {
                dropEl.innerHTML = '<div class="proy-act-ac-empty">' +
                    (q ? 'Sin coincidencias para "' + _proyGanttEsc(q) + '"' : 'Sin más usuarios') +
                    '</div>';
                dropEl.style.display = 'block';
                return;
            }
            var html = '';
            results.forEach(function(u) {
                html += '<button type="button" class="proy-act-ac-item" data-add-user="' + u.id + '">' +
                        '<span class="proy-act-ac-avatar" style="background:' + (u.color || '#6366f1') + ';">' +
                        _proyGanttEsc(u.initials || '·') + '</span>' +
                        '<span class="proy-act-ac-info">' +
                        '<span class="proy-act-ac-name">' + _proyGanttEsc(u.nombre) + '</span>' +
                        (u.rol ? '<span class="proy-act-ac-meta">' + _proyGanttEsc(u.rol) + '</span>' : '') +
                        '</span>' +
                        '</button>';
            });
            dropEl.innerHTML = html;
            dropEl.style.display = 'block';
            Array.prototype.forEach.call(dropEl.querySelectorAll('[data-add-user]'), function(btn) {
                btn.addEventListener('click', function() {
                    var uid = btn.getAttribute('data-add-user');
                    var u = results.filter(function(x) { return String(x.id) === String(uid); })[0];
                    if (u) {
                        _actividadSelectedUsers[u.id] = { id: u.id, nombre: u.nombre };
                        _proyActRenderUsuariosChips();
                    }
                    dropEl.style.display = 'none';
                    var inp = el('proyActUsuarioSearch'); if (inp) { inp.value = ''; inp.focus(); }
                });
            });
        }).catch(function(err) {
            console.error('[gantt] error buscando usuarios:', err);
            dropEl.innerHTML = '<div class="proy-act-ac-empty">Error al buscar</div>';
            dropEl.style.display = 'block';
        });
    }

    function _proyActSearchRecursos(q, dropEl, recInput) {
        var url = '/app/api/iamet/recursos/buscar/?limit=10';
        if (q && q.trim()) url += '&q=' + encodeURIComponent(q.trim());
        _fetch(url).then(function(resp) {
            var results = (resp && resp.success) ? (resp.results || []) : [];
            // Filtrar los ya seleccionados
            results = results.filter(function(r) { return !_actividadSelectedRecursos[r.id]; });

            var html = '';
            if (!results.length) {
                if (q && q.trim()) {
                    html += '<button type="button" class="proy-act-ac-item proy-act-ac-create" data-create-recurso="' + _proyGanttEsc(q.trim()) + '">' +
                            '<span class="proy-act-ac-avatar" style="background:#16a34a;">+</span>' +
                            '<span class="proy-act-ac-info">' +
                            '<span class="proy-act-ac-name">Crear "' + _proyGanttEsc(q.trim()) + '"</span>' +
                            '<span class="proy-act-ac-meta">Recurso material nuevo</span>' +
                            '</span>' +
                            '</button>';
                } else {
                    html = '<div class="proy-act-ac-empty">Empieza a escribir para buscar</div>';
                }
            } else {
                results.forEach(function(r) {
                    html += '<button type="button" class="proy-act-ac-item" data-add-recurso="' + r.id + '">' +
                            '<span class="proy-act-ac-tipo">' + _proyGanttEsc(r.tipo_label || r.tipo || '') + '</span>' +
                            '<span class="proy-act-ac-info">' +
                            '<span class="proy-act-ac-name">' + _proyGanttEsc(r.nombre) + '</span>' +
                            (r.descripcion ? '<span class="proy-act-ac-meta">' + _proyGanttEsc(r.descripcion.slice(0, 60)) + '</span>' : '') +
                            '</span>' +
                            '</button>';
                });
                if (q && q.trim()) {
                    html += '<button type="button" class="proy-act-ac-item proy-act-ac-create" data-create-recurso="' + _proyGanttEsc(q.trim()) + '">' +
                            '<span class="proy-act-ac-avatar" style="background:#16a34a;">+</span>' +
                            '<span class="proy-act-ac-info">' +
                            '<span class="proy-act-ac-name">Crear nuevo: "' + _proyGanttEsc(q.trim()) + '"</span>' +
                            '</span>' +
                            '</button>';
                }
            }
            dropEl.innerHTML = html;
            dropEl.style.display = 'block';

            Array.prototype.forEach.call(dropEl.querySelectorAll('[data-add-recurso]'), function(btn) {
                btn.addEventListener('click', function() {
                    var rid = btn.getAttribute('data-add-recurso');
                    var r = results.filter(function(x) { return String(x.id) === String(rid); })[0];
                    if (r) _proyActIntentarAgregarRecurso(r);
                    dropEl.style.display = 'none';
                });
            });
            Array.prototype.forEach.call(dropEl.querySelectorAll('[data-create-recurso]'), function(btn) {
                btn.addEventListener('click', function() {
                    var nombre = btn.getAttribute('data-create-recurso');
                    if (nombre) _proyActCrearNuevoRecurso(nombre);
                    dropEl.style.display = 'none';
                });
            });
        }).catch(function(err) {
            console.error('[gantt] error buscando recursos:', err);
            dropEl.innerHTML = '<div class="proy-act-ac-empty">Error al buscar</div>';
            dropEl.style.display = 'block';
        });
    }

    function _proyActCrearNuevoRecurso(nombre) {
        // Pregunta tipo en un prompt rápido (mantener simple, sin modal).
        var tipo = window.prompt(
            'Tipo de recurso para "' + nombre + '":\n' +
            '1) Equipo\n2) Herramienta\n3) Material\n4) Vehículo\n5) Otro\n\n' +
            'Escribe 1-5 (default 5):',
            '5'
        );
        if (tipo === null) return;  // cancelado
        var map = { '1': 'equipo', '2': 'herramienta', '3': 'material', '4': 'vehiculo', '5': 'otro' };
        var tipoVal = map[String(tipo).trim()] || 'otro';

        _fetch('/app/api/iamet/recursos/', {
            method: 'POST',
            body: { nombre: nombre, tipo: tipoVal }
        }).then(function(resp) {
            if (resp && resp.success && resp.recurso) {
                _proyActIntentarAgregarRecurso(resp.recurso);
                var inp = el('proyActRecursoSearch'); if (inp) { inp.value = ''; inp.focus(); }
            } else {
                alert('No se pudo crear el recurso: ' + ((resp && resp.error) || 'Error'));
            }
        }).catch(function(err) {
            console.error('[gantt] error creando recurso:', err);
            alert('Error de conexión al crear recurso.');
        });
    }

    // Verifica conflictos en el rango de fechas de la actividad antes de
    // agregar el recurso. Si hay conflictos, abre modal de advertencia.
    function _proyActIntentarAgregarRecurso(recurso) {
        var iniEl = el('proyActFechaInicio');
        var finEl = el('proyActFechaFin');
        var hitoChk = el('proyActEsHito');
        var fi = iniEl ? iniEl.value : '';
        var ff = (hitoChk && hitoChk.checked) ? fi : (finEl ? finEl.value : fi);
        if (!fi || !ff) {
            // Sin fechas válidas: solo agregar sin chequear conflicto
            _proyActAgregarRecurso(recurso);
            return;
        }
        var url = '/app/api/iamet/recursos/' + recurso.id + '/conflictos/' +
                  '?fecha_inicio=' + encodeURIComponent(fi) +
                  '&fecha_fin=' + encodeURIComponent(ff);
        if (_proyActEditId) url += '&exclude_actividad=' + _proyActEditId;

        _fetch(url).then(function(resp) {
            if (resp && resp.success && Array.isArray(resp.conflictos) && resp.conflictos.length) {
                _proyActMostrarConflictoRecurso(recurso, resp.conflictos);
            } else {
                _proyActAgregarRecurso(recurso);
            }
        }).catch(function() {
            // Si falla la verificación, agregar de todos modos (no bloquear)
            _proyActAgregarRecurso(recurso);
        });
    }

    function _proyActAgregarRecurso(recurso) {
        _actividadSelectedRecursos[recurso.id] = {
            id: recurso.id,
            nombre: recurso.nombre,
            tipo: recurso.tipo,
            tipo_label: recurso.tipo_label || '',
        };
        _proyActRenderRecursosChips();
        var inp = el('proyActRecursoSearch'); if (inp) inp.value = '';
    }

    function _proyActMostrarConflictoRecurso(recurso, conflictos) {
        var dlg = el('proyDialogoConflictoRecurso');
        if (!dlg) {
            // Fallback a confirm() si el modal no existe
            var msg = 'El recurso "' + recurso.nombre + '" ya está asignado en ' +
                      conflictos.length + ' actividad(es) que se solapan. ¿Asignarlo de todos modos?';
            if (confirm(msg)) _proyActAgregarRecurso(recurso);
            return;
        }
        var intro = el('proyConflictoIntro');
        var lista = el('proyConflictoLista');
        if (intro) {
            intro.innerHTML = 'El recurso <strong>' + _proyGanttEsc(recurso.nombre) + '</strong> ya está asignado en ' +
                              conflictos.length + ' actividad' + (conflictos.length === 1 ? '' : 'es') +
                              ' que se solapan con el rango seleccionado:';
        }
        if (lista) {
            var html = '';
            conflictos.forEach(function(c) {
                html += '<div style="padding:8px 10px;border-bottom:1px solid #fee2e2;">' +
                        '<div style="font-size:0.84rem;font-weight:600;color:#1d1d1f;">' +
                        _proyGanttEsc(c.actividad_nombre) + '</div>' +
                        '<div style="font-size:0.74rem;color:#6E6E73;margin-top:2px;">' +
                        _proyGanttEsc(c.proyecto_nombre || ('Proyecto #' + c.proyecto_id)) +
                        ' &middot; ' + _proyGanttEsc(c.fecha_inicio) + ' → ' + _proyGanttEsc(c.fecha_fin) +
                        '</div></div>';
            });
            lista.innerHTML = html;
        }
        var btn = el('proyConflictoConfirmBtn');
        if (btn) {
            btn.onclick = function() {
                _proyActAgregarRecurso(recurso);
                dlg.style.display = 'none';
            };
        }
        dlg.style.display = 'flex';
    }

    window.proyectosGuardarActividad = function() {
        if (!currentProjectId) { alert('No hay proyecto activo.'); return; }
        var titulo = el('proyActTitulo') ? el('proyActTitulo').value.trim() : '';
        if (!titulo) {
            if (el('proyActTitulo')) {
                el('proyActTitulo').style.borderColor = '#FF3B30';
                el('proyActTitulo').focus();
            }
            return;
        }
        if (el('proyActTitulo')) el('proyActTitulo').style.borderColor = '';

        var fechaIni = el('proyActFechaInicio') ? el('proyActFechaInicio').value : '';
        var fechaFin = el('proyActFechaFin') ? el('proyActFechaFin').value : '';
        var esHito = el('proyActEsHito') ? el('proyActEsHito').checked : false;
        if (!fechaIni) { alert('La fecha de inicio es obligatoria.'); return; }
        var duracionDias;
        if (esHito) duracionDias = 1;
        else {
            if (!fechaFin) { alert('La fecha de fin es obligatoria.'); return; }
            duracionDias = Math.max(1, _diffDays(fechaIni, fechaFin));
        }

        var faseId = el('proyActFase') ? el('proyActFase').value : '';
        var progreso = el('proyActProgreso') ? parseInt(el('proyActProgreso').value, 10) : 0;
        if (isNaN(progreso)) progreso = 0;
        progreso = Math.max(0, Math.min(100, progreso));
        var costo = el('proyActCosto') ? parseFloat(el('proyActCosto').value) : 0;
        if (isNaN(costo) || costo < 0) costo = 0;
        var ingreso = el('proyActIngreso') ? parseFloat(el('proyActIngreso').value) : 0;
        if (isNaN(ingreso) || ingreso < 0) ingreso = 0;

        var descripcionVal = el('proyActDescripcion') ? el('proyActDescripcion').value : '';
        var responsables = Object.keys(_actividadSelectedUsers).map(function(k) { return parseInt(k, 10); });
        var recursosMaterialesIds = Object.keys(_actividadSelectedRecursos).map(function(k) { return parseInt(k, 10); });
        var dependencias = Object.keys(_proyActDeps).map(function(k) { return parseInt(k, 10); });

        var payloadCrear = {
            nombre: titulo,
            descripcion: descripcionVal,
            fecha_inicio: fechaIni,
            duracion_dias: duracionDias,
            progreso: progreso, costo_estimado: costo, ingreso_estimado: ingreso,
            fase_id: faseId ? parseInt(faseId, 10) : null,
            // Estos M2M también se aceptan en POST (atajo para crear con todo de una)
            recursos: responsables,
            recursos_materiales: recursosMaterialesIds,
            dependencias: dependencias,
        };

        var btn = el('proyActBtnCrear');
        var lblOriginal = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

        var url, method, body;
        if (_proyActEditId) {
            url = '/app/api/gantt/actividad/' + _proyActEditId + '/';
            method = 'PUT';
            body = payloadCrear;
        } else {
            url = '/app/api/proyecto/' + currentProjectId + '/gantt/';
            method = 'POST';
            body = payloadCrear;
        }

        _fetch(url, { method: method, body: body }).then(function(resp) {
            if (!resp || !resp.success) {
                if (btn) { btn.disabled = false; btn.textContent = lblOriginal; }
                alert('Error al guardar actividad: ' + ((resp && resp.error) || 'Error desconocido'));
                return;
            }
            _onActividadGuardada(btn, lblOriginal, _proyActEditId ? 'Actividad actualizada' : 'Actividad creada');
        }).catch(function(err) {
            if (btn) { btn.disabled = false; btn.textContent = lblOriginal; }
            console.error('[gantt] error guardando actividad:', err);
            alert('Error de conexión al guardar la actividad.');
        });
    };

    function _onActividadGuardada(btn, lblOriginal, msg) {
        if (btn) { btn.disabled = false; btn.textContent = lblOriginal; }
        proyectosCerrarDialogo('proyDialogoActividad');
        _proyActEditId = null;
        renderProgramaObra(currentProjectId);
        _showToast(msg || 'Actividad guardada');
    }

    window.proyectosEliminarActividadGantt = function() {
        if (!_proyActEditId) return;
        var id = _proyActEditId;
        proyConfirm('Eliminar actividad', '¿Seguro que quieres eliminar esta actividad del cronograma?', {
            textoConfirmar: 'Eliminar',
            onConfirm: function() {
                _fetch('/app/api/gantt/actividad/' + id + '/', { method: 'DELETE' }).then(function(resp) {
                    if (resp && resp.success) {
                        proyectosCerrarDialogo('proyDialogoActividad');
                        _proyActEditId = null;
                        renderProgramaObra(currentProjectId);
                        _showToast('Actividad eliminada');
                    } else { alert('Error al eliminar actividad'); }
                }).catch(function() { alert('Error de conexión al eliminar.'); });
            }
        });
    };

    window.proyectosAbrirNuevaActividad = function(dateStr) {
        _openActividadForm(dateStr || _isoToday(), {});
    };
    window.proyectosEditarActividadGantt = function(actId) {
        _openActividadForm(null, { editId: actId });
    };


    // =========================================
    //  FASE FORM (PROGRAMA DE OBRA)
    // =========================================

    function _openFaseForm(faseId) {
        var dlg = el('proyDialogoFase');
        if (!dlg) {
            console.error('[gantt] modal #proyDialogoFase no encontrado');
            alert('No se pudo abrir el formulario de fase. Recarga la página.');
            return;
        }
        _proyFaseEditId = faseId || null;
        var isEdit = !!faseId;

        var fase = null;
        if (isEdit && _proyGanttData && Array.isArray(_proyGanttData.fases)) {
            fase = _proyGanttData.fases.filter(function(f) { return f.id === faseId; })[0] || null;
        }

        var titEl = el('proyFaseDialogTitle');
        if (titEl) titEl.textContent = isEdit ? 'Editar Fase' : 'Nueva Fase';
        var btnCrear = el('proyFaseBtnCrear');
        if (btnCrear) btnCrear.textContent = isEdit ? 'Guardar cambios' : 'Crear Fase';
        var btnElim = el('proyFaseBtnEliminar');
        if (btnElim) btnElim.style.display = isEdit ? 'inline-flex' : 'none';

        var nombreEl = el('proyFaseNombre');
        if (nombreEl) {
            nombreEl.value = fase ? (fase.nombre || '') : '';
            nombreEl.style.borderColor = '';
            nombreEl.oninput = _refreshFaseCategoriaPreview;
        }

        // Sugerencias rápidas
        _renderFaseSugerencias();

        _refreshFaseCategoriaPreview();

        dlg.style.display = 'flex';
        setTimeout(function() {
            var t = el('proyFaseNombre'); if (t) t.focus();
        }, 50);
    }

    function _renderFaseSugerencias() {
        var list = el('proyFaseSugList');
        if (!list) return;
        var html = '';
        var sugs = ['Planificación', 'Permisos', 'Cimentación', 'Estructura', 'Instalaciones', 'Acabados', 'Pruebas y Puesta en Marcha', 'Entrega'];
        sugs.forEach(function(s) {
            var c = _proyGanttCategoryFor(s);
            html += '<button type="button" class="proy-gantt-sug-chip" style="border-color:' + c.color + '40;color:' + c.color + ';" data-name="' + _proyGanttEsc(s) + '">' +
                    '<span style="width:7px;height:7px;border-radius:2px;background:' + c.color + ';display:inline-block;margin-right:5px;"></span>' +
                    s + '</button>';
        });
        list.innerHTML = html;
        Array.prototype.forEach.call(list.querySelectorAll('.proy-gantt-sug-chip'), function(b) {
            b.addEventListener('click', function() {
                var nombreEl = el('proyFaseNombre');
                if (nombreEl) { nombreEl.value = b.getAttribute('data-name'); _refreshFaseCategoriaPreview(); }
            });
        });
    }

    function _refreshFaseCategoriaPreview() {
        var nombreEl = el('proyFaseNombre');
        var dot = el('proyFaseCategoriaDot');
        var lbl = el('proyFaseCategoriaLabel');
        var name = nombreEl ? nombreEl.value : '';
        var c = _proyGanttCategoryFor(name);
        if (dot) dot.style.background = c.color;
        if (lbl) { lbl.textContent = c.label; lbl.style.color = c.color; }
    }

    window.proyectosGuardarFase = function() {
        if (!currentProjectId) { alert('No hay proyecto activo.'); return; }
        var nombreEl = el('proyFaseNombre');
        var nombre = nombreEl ? nombreEl.value.trim() : '';
        if (!nombre) {
            if (nombreEl) { nombreEl.style.borderColor = '#FF3B30'; nombreEl.focus(); }
            return;
        }
        if (nombreEl) nombreEl.style.borderColor = '';

        var btn = el('proyFaseBtnCrear');
        var lblOriginal = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

        var url, method, body;
        if (_proyFaseEditId) {
            url = '/app/api/gantt/fase/' + _proyFaseEditId + '/';
            method = 'PUT';
            body = { nombre: nombre };
        } else {
            url = '/app/api/proyecto/' + currentProjectId + '/gantt/fase/';
            method = 'POST';
            body = { nombre: nombre };
        }

        _fetch(url, { method: method, body: body }).then(function(resp) {
            if (btn) { btn.disabled = false; btn.textContent = lblOriginal; }
            if (!resp || !resp.success) {
                alert('Error al guardar fase: ' + ((resp && resp.error) || 'Error desconocido'));
                return;
            }
            var wasEdit = !!_proyFaseEditId;
            proyectosCerrarDialogo('proyDialogoFase');
            _proyFaseEditId = null;
            renderProgramaObra(currentProjectId);
            _showToast(wasEdit ? 'Fase actualizada' : 'Fase creada');
        }).catch(function(err) {
            if (btn) { btn.disabled = false; btn.textContent = lblOriginal; }
            console.error('[gantt] error guardando fase:', err);
            alert('Error de conexión al guardar la fase.');
        });
    };

    window.proyectosEliminarFase = function() {
        if (!_proyFaseEditId) return;
        var id = _proyFaseEditId;
        // Contar actividades antes de eliminar
        var n = 0;
        if (_proyGanttData && Array.isArray(_proyGanttData.actividades)) {
            n = _proyGanttData.actividades.filter(function(a) { return a.fase_id === id; }).length;
        }
        var msg = n > 0
            ? '¿Eliminar la fase y sus ' + n + ' actividad' + (n === 1 ? '' : 'es') + '? Esta acción no se puede deshacer.'
            : '¿Eliminar la fase?';
        proyConfirm('Eliminar fase', msg, {
            textoConfirmar: 'Eliminar fase',
            onConfirm: function() {
                _fetch('/app/api/gantt/fase/' + id + '/', { method: 'DELETE' }).then(function(resp) {
                    if (resp && resp.success) {
                        proyectosCerrarDialogo('proyDialogoFase');
                        _proyFaseEditId = null;
                        renderProgramaObra(currentProjectId);
                        _showToast('Fase eliminada');
                    } else { alert('Error al eliminar fase'); }
                }).catch(function() { alert('Error de conexión al eliminar.'); });
            }
        });
    };

    function _showToast(message) {
        var existing = document.getElementById('proyToast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'proyToast';
        toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:#1D1D1F;color:#fff;padding:12px 24px;border-radius:12px;font-size:0.85rem;font-weight:600;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.2);transition:opacity 0.3s;font-family:Plus Jakarta Sans,sans-serif;';
        toast.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>' +
            message + '</div>';
        document.body.appendChild(toast);

        setTimeout(function() { toast.style.opacity = '0'; }, 2500);
        setTimeout(function() { toast.remove(); }, 3000);
    }

    // =========================================
    //  CONFIRM DIALOG (reemplaza confirm() del navegador)
    // =========================================
    var _proyConfirmCallback = null;

    function proyConfirm(titulo, mensaje, opts) {
        opts = opts || {};
        var dlg = el('proyConfirmDialog');
        if (!dlg) { // Fallback si el widget no esta en el DOM
            if (window.confirm(mensaje)) { if (opts.onConfirm) opts.onConfirm(); }
            return;
        }
        el('proyConfirmTitle').textContent = titulo || 'Confirmar';
        el('proyConfirmText').textContent = mensaje || '';
        var btn = el('proyConfirmBtnOk');
        btn.textContent = opts.textoConfirmar || 'Eliminar';
        var color = opts.color || '#EF4444';
        btn.style.background = color;
        btn.style.borderColor = color;
        _proyConfirmCallback = opts.onConfirm || null;
        dlg.style.display = 'flex';
    }

    window.proyConfirmAceptar = function() {
        var dlg = el('proyConfirmDialog');
        if (dlg) dlg.style.display = 'none';
        var cb = _proyConfirmCallback;
        _proyConfirmCallback = null;
        if (cb) cb();
    };

    window.proyConfirmCancelar = function() {
        var dlg = el('proyConfirmDialog');
        if (dlg) dlg.style.display = 'none';
        _proyConfirmCallback = null;
    };

    // Exponer el confirm bonito para que otros widgets (wizard del
    // levantamiento, etc.) puedan reutilizar el mismo modal en lugar de
    // usar window.confirm() feo del navegador.
    window.proyConfirm = proyConfirm;


    // =========================================
    //  DETALLE / COMPLETAR ACTIVIDAD (PROGRAMA DE OBRA)
    // =========================================

    var _currentActDetalleId = null;

    function _esc(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.proyectosVerActividadDetalle = function(actividadId) {
        if (!actividadId) return;
        _currentActDetalleId = actividadId;

        var overlay = el('proyDialogoActDetalle');
        if (!overlay) return;

        // Reset fields a "Cargando"
        el('proyDetalleActTitulo').textContent = 'Cargando...';
        el('proyDetalleActFechaTxt').textContent = '';
        el('proyDetalleActHorario').textContent = '—';
        el('proyDetalleActCreador').textContent = '—';
        el('proyDetalleActDesc').textContent = 'Sin descripción';
        el('proyDetalleActPersonal').innerHTML = '';
        el('proyDetalleActEstadoRow').style.display = 'none';
        el('proyDetalleActVehiculosRow').style.display = 'none';
        el('proyDetalleActEvidenciaRow').style.display = 'none';
        el('proyDetalleActEvidenciaTexto').style.display = 'none';
        el('proyDetalleActEvidenciaArchivos').innerHTML = '';
        el('proyDetalleActBtnCompletar').style.display = '';

        overlay.style.display = 'flex';

        _fetch('/app/api/programacion/actividad/' + actividadId + '/').then(function(resp) {
            if (!resp.success) {
                el('proyDetalleActTitulo').textContent = 'Error al cargar';
                return;
            }
            var it = resp.item || {};

            // Título
            el('proyDetalleActTitulo').textContent = it.titulo || 'Actividad';

            // Fecha legible
            var fechaStr = it.fecha || '';
            if (fechaStr) {
                var d = new Date(fechaStr + 'T12:00:00');
                var meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
                var dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
                el('proyDetalleActFechaTxt').textContent = dias[d.getDay()] + ', ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
            } else {
                el('proyDetalleActFechaTxt').textContent = it.dia_semana || '';
            }

            // Horario + Creador
            el('proyDetalleActHorario').textContent = (it.hora_inicio || '—') + ' – ' + (it.hora_fin || '—');
            el('proyDetalleActCreador').textContent = it.creado_por || '—';

            // Descripción
            el('proyDetalleActDesc').textContent = it.descripcion || 'Sin descripción';

            // Estado badge
            var estadoRow = el('proyDetalleActEstadoRow');
            var estadoBadge = el('proyDetalleActEstadoBadge');
            if (it.completada) {
                estadoRow.style.display = '';
                var completedByStr = it.completada_por ? ' por ' + _esc(it.completada_por) : '';
                var completedDateStr = '';
                if (it.fecha_completada) {
                    var fc = new Date(it.fecha_completada);
                    completedDateStr = ' · ' + fc.toLocaleDateString('es-MX') + ' ' + fc.getHours().toString().padStart(2,'0') + ':' + fc.getMinutes().toString().padStart(2,'0');
                }
                estadoBadge.style.background = 'rgba(52,199,89,0.14)';
                estadoBadge.style.color = '#16A34A';
                estadoBadge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>Completada' + completedByStr + completedDateStr;
            } else {
                estadoRow.style.display = '';
                estadoBadge.style.background = 'rgba(146,64,14,0.12)';
                estadoBadge.style.color = '#92400E';
                estadoBadge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/></svg>Pendiente';
            }

            // Personal
            var personalEl = el('proyDetalleActPersonal');
            personalEl.innerHTML = '';
            if (it.responsables && it.responsables.length) {
                it.responsables.forEach(function(r) {
                    var chip = document.createElement('div');
                    chip.style.cssText = 'display:flex;align-items:center;gap:6px;background:#F3F4F6;border-radius:20px;padding:4px 12px 4px 4px;';
                    chip.innerHTML = '<div style="width:26px;height:26px;border-radius:50%;background:#92400E;color:#fff;font-size:0.65rem;line-height:26px;text-align:center;font-weight:700;">' + _esc(r.iniciales) + '</div>' +
                        '<span style="font-size:0.85rem;color:#1D1D1F;">' + _esc(r.nombre) + '</span>';
                    personalEl.appendChild(chip);
                });
            } else {
                personalEl.innerHTML = '<span style="color:#86868B;font-size:0.85rem;font-style:italic;">Sin personal asignado</span>';
            }

            // Vehículos
            if (it.vehiculos) {
                el('proyDetalleActVehiculosRow').style.display = '';
                el('proyDetalleActVehiculos').textContent = it.vehiculos;
            }

            // Evidencia (si está completada)
            if (it.completada) {
                var evidenciaRow = el('proyDetalleActEvidenciaRow');
                var textoEl = el('proyDetalleActEvidenciaTexto');
                var archivosEl = el('proyDetalleActEvidenciaArchivos');
                var hasAny = false;

                if (it.evidencia_texto) {
                    textoEl.textContent = it.evidencia_texto;
                    textoEl.style.display = '';
                    hasAny = true;
                }
                if (it.evidencias && it.evidencias.length) {
                    hasAny = true;
                    it.evidencias.forEach(function(e) {
                        var isImg = (e.tipo_mime || '').indexOf('image/') === 0;
                        var icon = isImg
                            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400E" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
                            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#92400E" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
                        var a = document.createElement('a');
                        a.href = e.url;
                        a.target = '_blank';
                        a.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;text-decoration:none;color:#1D1D1F;font-size:0.85rem;transition:background 0.15s;';
                        a.onmouseover = function() { this.style.background = '#F9FAFB'; };
                        a.onmouseout = function() { this.style.background = 'transparent'; };
                        a.innerHTML = icon + '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(e.nombre_archivo) + '</span>';
                        archivosEl.appendChild(a);
                    });
                }
                if (hasAny) {
                    evidenciaRow.style.display = '';
                } else {
                    evidenciaRow.style.display = '';
                    textoEl.textContent = 'Sin evidencia registrada';
                    textoEl.style.display = '';
                    textoEl.style.fontStyle = 'italic';
                    textoEl.style.color = '#9CA3AF';
                    textoEl.style.background = 'transparent';
                    textoEl.style.border = 'none';
                    textoEl.style.padding = '0';
                }
            }

            // Botón Completar
            var btn = el('proyDetalleActBtnCompletar');
            if (it.completada) {
                btn.style.display = 'none';
            } else {
                btn.style.display = 'inline-flex';
            }
        }).catch(function(err) {
            el('proyDetalleActTitulo').textContent = 'Error de conexión';
            console.error('Error cargando detalle actividad:', err);
        });
    };

    window.proyectosIniciarCompletar = function() {
        if (!_currentActDetalleId) return;
        // Resetear form
        var txt = el('proyEvidenciaTexto');
        var files = el('proyEvidenciaArchivos');
        var list = el('proyEvidenciaFileList');
        if (txt) txt.value = '';
        if (files) files.value = '';
        if (list) list.textContent = '';

        // Listener para mostrar archivos seleccionados
        if (files && !files._hasListener) {
            files.addEventListener('change', function() {
                var names = [];
                for (var i = 0; i < this.files.length; i++) names.push(this.files[i].name);
                if (list) list.textContent = names.length ? (names.length + ' archivo(s): ' + names.join(', ')) : '';
            });
            files._hasListener = true;
        }

        var overlay = el('proyDialogoEvidencia');
        if (overlay) overlay.style.display = 'flex';
    };

    window.proyectosEnviarEvidencia = function() {
        if (!_currentActDetalleId) return;
        var txt = el('proyEvidenciaTexto');
        var files = el('proyEvidenciaArchivos');
        var btn = el('proyEvidenciaBtnEnviar');

        var texto = txt ? txt.value.trim() : '';
        var archivos = files ? files.files : [];

        if (!texto && (!archivos || archivos.length === 0)) {
            alert('Debes agregar evidencia escrita o al menos un archivo.');
            return;
        }

        var formData = new FormData();
        formData.append('evidencia_texto', texto);
        if (archivos && archivos.length) {
            for (var i = 0; i < archivos.length; i++) {
                formData.append('archivos', archivos[i]);
            }
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

        _fetch('/app/api/programacion/actividad/' + _currentActDetalleId + '/completar/', {
            method: 'POST',
            body: formData
        }).then(function(resp) {
            if (btn) { btn.disabled = false; btn.textContent = 'Completar Actividad'; }
            if (resp.success) {
                proyectosCerrarDialogo('proyDialogoEvidencia');
                proyectosCerrarDialogo('proyDialogoActDetalle');
                _showToast('Actividad completada');
                if (currentProjectId) renderProgramaObra(currentProjectId);
                // Refrescar calendario si existe
                if (typeof calGlobalRefetch === 'function') { try { calGlobalRefetch(); } catch(e) {} }
            } else {
                alert('Error al completar: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            if (btn) { btn.disabled = false; btn.textContent = 'Completar Actividad'; }
            alert('Error de conexión al completar actividad');
            console.error('Error completando actividad:', err);
        });
    };


    // =========================================
    //  RENDER: FINANCIERO
    // =========================================
    //
    //   Layout (rediseñado, look "warm modern" inspirado en Finance.jsx
    //   del Claude Design):
    //
    //     [ Header: Finanzas del proyecto + Sincronizar Drive + + Nueva factura ]
    //     [ Sub-tabs: Resumen | Facturas | Órdenes de Compra | Facturas Proveedor ]
    //
    //     RESUMEN     → 4 KPI cards + Distribución por partida + Gastos operativos
    //     FACTURAS    → Tabla de facturas de ingreso (cliente) + filtros + upload
    //     OC          → Tabla de órdenes de compra (igual a antes, con look nuevo)
    //     PROVEEDOR   → Tabla de facturas de proveedor + upload
    //
    //   Las 4 sub-panes coexisten en el DOM; alternamos `display:none/block`
    //   para que el cambio entre sub-tabs sea instantáneo. Los datos solo se
    //   recargan cuando entramos al pane Financiero (renderFinanciero) o
    //   cuando se hace una mutación (upload/eliminar).
    // =========================================

    // Filtro actual de facturas de ingreso (all / pending / paid)
    var _proyFinFacturasFilter = 'all';
    // Cache de facturas de ingreso para filtrado client-side
    var _proyFinFacturasCache = [];

    function renderFinanciero(projectId) {
        // Sub-tab por defecto = Resumen
        if (typeof window.proyFinSetSubTab === 'function') {
            // No forzar reset si el usuario ya está navegando dentro;
            // solo aseguramos que un sub-tab esté visible.
            var anyActive = document.querySelector('#proyPane_financiero .proy-fin-subtab.is-active');
            if (!anyActive) window.proyFinSetSubTab('resumen');
        }

        _renderFinResumen();           // KPIs + distribución + subtitle
        renderOC(projectId);
        renderSupplierInvoices(projectId);
        renderRevenueInvoices(projectId);
        renderExpenses(projectId);
    }

    // ── Cambia el sub-tab activo dentro del pane Financiero ──
    // Solo manipula visibilidad/clases — los datos ya están en el DOM.
    window.proyFinSetSubTab = function(tabName) {
        var pane = el('proyPane_financiero');
        if (!pane) return;
        var validTabs = ['resumen', 'facturas', 'oc', 'proveedor'];
        if (validTabs.indexOf(tabName) === -1) tabName = 'resumen';

        // Actualizar pills
        var pills = pane.querySelectorAll('.proy-fin-subtab');
        for (var i = 0; i < pills.length; i++) {
            var p = pills[i];
            if (p.getAttribute('data-subtab') === tabName) {
                p.classList.add('is-active');
            } else {
                p.classList.remove('is-active');
            }
        }
        // Mostrar/ocultar sub-panes
        var panes = pane.querySelectorAll('.proy-fin-subpane');
        for (var j = 0; j < panes.length; j++) {
            var sp = panes[j];
            sp.style.display = (sp.getAttribute('data-subpane') === tabName) ? '' : 'none';
        }
    };

    // ── Render del sub-pane Resumen: KPIs + distribución por partida ──
    function _renderFinResumen() {
        var ov = (_cachedProjectDetail && _cachedProjectDetail.overview) ? _cachedProjectDetail.overview : null;
        var fin = (ov && ov.financiero) ? ov.financiero : {};
        var contratado = Number(fin.contratado || 0);
        var gastado    = Number(fin.gastado || 0);
        var cobrado    = Number(fin.cobrado || 0);
        var disponible = Math.max(0, contratado - gastado);

        var spentPct = contratado > 0 ? Math.round((gastado / contratado) * 100) : 0;
        var invPct   = contratado > 0 ? Math.round((cobrado / contratado) * 100) : 0;
        var dispPct  = contratado > 0 ? Math.max(0, 100 - spentPct) : 100;

        // Subtitle del header
        var sub = el('proyFinSubtitle');
        if (sub) {
            var nombre = (_cachedProjectDetail && _cachedProjectDetail.nombre) ? _cachedProjectDetail.nombre : 'Proyecto';
            sub.textContent = nombre + ' · Presupuesto base: ' + _fmtMoneyShort(contratado) + ' MXN';
        }

        // KPI 1 — Presupuesto total
        _setText('proyFinKpiPresupuesto', _fmtMoneyShort(contratado));
        _setText('proyFinKpiPresupuestoSub', 'Aprobado cliente');

        // KPI 2 — Ejecutado
        _setText('proyFinKpiEjecutado', _fmtMoneyShort(gastado));
        _setText('proyFinKpiEjecutadoSub', spentPct + '% del presupuesto');

        // KPI 3 — Facturado
        _setText('proyFinKpiFacturado', _fmtMoneyShort(cobrado));
        _setText('proyFinKpiFacturadoSub', invPct + '% del presupuesto');

        // KPI 4 — Disponible (color cambia si < 20% restante)
        var dispEl = el('proyFinKpiDisponible');
        var dispKpi = dispEl ? dispEl.closest('.proy-fin-kpi') : null;
        _setText('proyFinKpiDisponible', _fmtMoneyShort(disponible));
        _setText('proyFinKpiDisponibleSub', dispPct + '% restante');
        if (dispKpi) {
            dispKpi.classList.remove('is-warn', 'is-danger', 'is-ok');
            if (contratado <= 0) {
                /* sin clase */
            } else if (dispPct <= 0) {
                dispKpi.classList.add('is-danger');
            } else if (dispPct < 20) {
                dispKpi.classList.add('is-warn');
            } else {
                dispKpi.classList.add('is-ok');
            }
        }

        // ── Distribución por partida ──
        var listEl = el('proyFinBreakdownList');
        var metaEl = el('proyFinBreakdownMeta');
        if (!listEl) return;

        var breakdown = (ov && Array.isArray(ov.breakdown_presupuesto)) ? ov.breakdown_presupuesto : [];
        var totalBreak = breakdown.reduce(function(s, b) { return s + Number(b.monto || 0); }, 0);

        if (!breakdown.length || totalBreak <= 0) {
            listEl.innerHTML = '<div class="proy-fin-empty">' +
                'Aún no hay partidas con monto. Captura el levantamiento para ver el desglose.' +
                '</div>';
            if (metaEl) metaEl.textContent = '';
            return;
        }

        if (metaEl) metaEl.textContent = 'Total: ' + _fmtMoneyShort(totalBreak);

        var html = '';
        breakdown.forEach(function(b) {
            var monto = Number(b.monto || 0);
            var pct = totalBreak > 0 ? (monto / totalBreak) * 100 : 0;
            var cat = (b.categoria || 'otros').toString();
            // Capitalizar primera letra
            var label = cat.charAt(0).toUpperCase() + cat.slice(1);
            html += '<div class="proy-fin-bd-row">' +
                '<div class="proy-fin-bd-head">' +
                    '<span class="proy-fin-bd-label">' + _esc(label) + '</span>' +
                    '<span class="proy-fin-bd-amounts">' +
                        '<span class="proy-fin-bd-amount">' + _fmtMoneyShort(monto) + '</span>' +
                        '<span class="proy-fin-bd-pct">' + Math.round(pct) + '%</span>' +
                    '</span>' +
                '</div>' +
                '<div class="proy-fin-bd-bar">' +
                    '<div class="proy-fin-bd-bar-fill" style="width:' + pct.toFixed(2) + '%"></div>' +
                '</div>' +
            '</div>';
        });
        listEl.innerHTML = html;
    }

    function _setText(id, text) {
        var n = el(id);
        if (n) n.textContent = text;
    }

    // ── Filtro de facturas de ingreso (client-side) ──
    window.proyFinFilterFacturas = function(filter) {
        _proyFinFacturasFilter = filter || 'all';
        // Actualizar pills de filtro
        var pills = document.querySelectorAll('#proyFinSub_facturas .proy-fin-filter');
        for (var i = 0; i < pills.length; i++) {
            var p = pills[i];
            if (p.getAttribute('data-fac-filter') === _proyFinFacturasFilter) {
                p.classList.add('is-active');
            } else {
                p.classList.remove('is-active');
            }
        }
        _renderFacIngFromCache();
    };

    // ── Sync Drive ──
    window.proyFinSyncDrive = function() {
        if (!currentProjectId) return;
        var btn = el('proyFinSyncBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><path d="M23 4v6h-6"/></svg> Sincronizando...'; }
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/financiero/sync-drive/', {
            method: 'POST'
        }).then(function(resp) {
            if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Sincronizar Drive'; }
            if (resp.success) {
                var msg = resp.procesados + ' archivo(s) importado(s)';
                if (resp.errores > 0) msg += ', ' + resp.errores + ' con error';
                _showToast(msg);
                renderFinanciero(currentProjectId);
            } else {
                _showToast(resp.error || 'Error al sincronizar');
            }
        }).catch(function() {
            if (btn) { btn.disabled = false; btn.textContent = 'Sincronizar Drive'; }
            _showToast('Error de conexión');
        });
    };

    // ── Upload OC manual ──
    window.proyFinUploadOC = function(input) {
        if (!input.files || !input.files.length || !currentProjectId) return;
        var formData = new FormData();
        formData.append('archivo', input.files[0]);
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/financiero/upload-oc/', {
            method: 'POST',
            body: formData
        }).then(function(resp) {
            input.value = '';
            if (resp.success) {
                var msg = 'OC importada';
                if (resp.monto_extraido > 0) msg += ' ($' + Number(resp.monto_extraido).toLocaleString('en-US', {minimumFractionDigits:2}) + ' extraído del PDF)';
                _showToast(msg);
                renderFinanciero(currentProjectId);
            } else {
                _showToast(resp.error || 'Error al subir OC');
            }
        }).catch(function() { input.value = ''; _showToast('Error de conexión'); });
    };

    // ── Eliminar OC ──
    window.proyFinEliminarOC = function(ocId) {
        proyConfirm('Eliminar Orden de Compra', '¿Estas seguro que deseas eliminar esta orden de compra? Esta accion no se puede deshacer.', {
            onConfirm: function() {
                _fetch('/app/api/iamet/oc/' + ocId + '/eliminar/', {
                    method: 'DELETE'
                }).then(function(resp) {
                    if (resp.success) {
                        _showToast('OC eliminada');
                        if (currentProjectId) renderFinanciero(currentProjectId);
                    } else {
                        _showToast(resp.error || 'Error al eliminar');
                    }
                }).catch(function() { _showToast('Error de conexion'); });
            }
        });
    };

    // ── Eliminar Factura Proveedor ──
    window.proyFinEliminarFacturaProveedor = function(facturaId) {
        proyConfirm('Eliminar Factura Proveedor', '¿Estas seguro que deseas eliminar esta factura de proveedor?', {
            onConfirm: function() {
                _fetch('/app/api/iamet/facturas-proveedor/' + facturaId + '/eliminar/', {
                    method: 'DELETE'
                }).then(function(resp) {
                    if (resp.success) {
                        _showToast('Factura eliminada');
                        if (currentProjectId) renderFinanciero(currentProjectId);
                    } else {
                        _showToast(resp.error || 'Error al eliminar');
                    }
                }).catch(function() { _showToast('Error de conexion'); });
            }
        });
    };

    // ── Eliminar Factura Ingreso ──
    window.proyFinEliminarFacturaIngreso = function(facturaId) {
        proyConfirm('Eliminar Factura de Ingreso', '¿Estas seguro que deseas eliminar esta factura de ingreso?', {
            onConfirm: function() {
                _fetch('/app/api/iamet/facturas-ingreso/' + facturaId + '/eliminar/', {
                    method: 'DELETE'
                }).then(function(resp) {
                    if (resp.success) {
                        _showToast('Factura eliminada');
                        if (currentProjectId) renderFinanciero(currentProjectId);
                    } else {
                        _showToast(resp.error || 'Error al eliminar');
                    }
                }).catch(function() { _showToast('Error de conexion'); });
            }
        });
    };

    // ── Upload Factura Proveedor manual ──
    window.proyFinUploadFacturaProveedor = function(input) {
        if (!input.files || !input.files.length || !currentProjectId) return;
        var formData = new FormData();
        formData.append('archivo', input.files[0]);
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/financiero/upload-factura-proveedor/', {
            method: 'POST',
            body: formData
        }).then(function(resp) {
            input.value = '';
            if (resp.success) {
                var msg = 'Factura de proveedor importada';
                if (resp.monto_extraido > 0) msg += ' ($' + Number(resp.monto_extraido).toLocaleString('en-US', {minimumFractionDigits:2}) + ' extraido del PDF)';
                _showToast(msg);
                renderFinanciero(currentProjectId);
            } else {
                _showToast(resp.error || 'Error al subir factura');
            }
        }).catch(function() { input.value = ''; _showToast('Error de conexion'); });
    };

    // ── Upload Factura Ingreso manual ──
    window.proyFinUploadFactura = function(input) {
        if (!input.files || !input.files.length || !currentProjectId) return;
        var formData = new FormData();
        formData.append('archivo', input.files[0]);
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/financiero/upload-factura/', {
            method: 'POST',
            body: formData
        }).then(function(resp) {
            input.value = '';
            if (resp.success) {
                var msg = 'Factura importada';
                if (resp.monto_extraido > 0) msg += ' ($' + Number(resp.monto_extraido).toLocaleString('en-US', {minimumFractionDigits:2}) + ' extraído del PDF)';
                _showToast(msg);
                renderFinanciero(currentProjectId);
            } else {
                _showToast(resp.error || 'Error al subir factura');
            }
        }).catch(function() { input.value = ''; _showToast('Error de conexión'); });
    };

    function _btnEliminarIcon(onclickExpr) {
        return '<button onclick="event.stopPropagation();' + onclickExpr + '" title="Eliminar" style="background:none;border:none;cursor:pointer;color:#9CA3AF;padding:4px;border-radius:4px;transition:all 0.15s;" onmouseenter="this.style.color=\'#EF4444\';this.style.background=\'#FEE2E2\'" onmouseleave="this.style.color=\'#9CA3AF\';this.style.background=\'transparent\'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    }

    function _btnEditarIcon(onclickExpr) {
        return '<button onclick="event.stopPropagation();' + onclickExpr + '" title="Editar" style="background:none;border:none;cursor:pointer;color:#9CA3AF;padding:4px;border-radius:4px;margin-right:4px;transition:all 0.15s;" onmouseenter="this.style.color=\'#0052D4\';this.style.background=\'#DBEAFE\'" onmouseleave="this.style.color=\'#9CA3AF\';this.style.background=\'transparent\'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>';
    }

    function renderSupplierInvoices(projectId) {
        var container = el('proyFacProvBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/facturas-proveedor/').then(function(resp) {
            if (resp.ok || resp.success) {
                var invoices = resp.data || [];
                if (invoices.length === 0) {
                    container.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#8e8e93">No hay facturas de proveedores</td></tr>';
                    return;
                }

                var html = '';
                invoices.forEach(function(inv) {
                    var amount = inv.monto || 0;
                    var budgeted = inv.monto_presupuestado || 0;
                    var variance = amount - budgeted;
                    var variancePct = budgeted > 0 ? Math.round(variance / budgeted * 1000) / 10 : 0;
                    var varianceColor = variance > 0 ? '#ef4444' : (variance < 0 ? '#10b981' : '#8e8e93');

                    html += '<tr>' +
                        '<td style="font-weight:600;color:#007aff">' + (inv.numero_factura || '\u2014') + '</td>' +
                        '<td>' + (inv.proveedor || '\u2014') + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(amount) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(budgeted) + '</td>' +
                        '<td style="text-align:right;color:' + varianceColor + '">' + (variance > 0 ? '+' : '') + fmtMoney(variance) + '</td>' +
                        '<td style="text-align:right;color:' + varianceColor + '">' + (variancePct > 0 ? '+' : '') + variancePct + '%</td>' +
                        '<td><span class="proy-badge ' + statusClass(inv.status) + '">' + statusLabel(inv.status) + '</span></td>' +
                        '<td>' + fmtDate(inv.fecha_factura) + '</td>' +
                        '<td style="text-align:center">' + _btnEliminarIcon('proyFinEliminarFacturaProveedor(' + inv.id + ')') + '</td>' +
                    '</tr>';
                });

                container.innerHTML = html;
            } else {
                container.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#ef4444">Error al cargar facturas</td></tr>';
                console.error('Error cargando facturas proveedor:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando facturas proveedor:', err);
        });
    }

    function renderRevenueInvoices(projectId) {
        var container = el('proyFacIngBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/facturas-ingreso/').then(function(resp) {
            if (resp.ok || resp.success) {
                _proyFinFacturasCache = resp.data || [];
                _renderFacIngFromCache();
            } else {
                container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#ef4444">Error al cargar facturas</td></tr>';
                console.error('Error cargando facturas ingreso:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando facturas ingreso:', err);
        });
    }

    // Pinta las facturas de ingreso desde cache, aplicando _proyFinFacturasFilter.
    function _renderFacIngFromCache() {
        var container = el('proyFacIngBody');
        var foot = el('proyFacIngFoot');
        if (!container) return;

        var all = _proyFinFacturasCache || [];
        var filter = _proyFinFacturasFilter || 'all';

        function _isPaid(inv) {
            var s = (inv.status || '').toLowerCase();
            return s === 'paid' || s === 'cobrada' || s === 'pagada' || !!inv.fecha_pago;
        }
        function _isOverdue(inv) {
            if (_isPaid(inv)) return false;
            if (!inv.fecha_vencimiento) return false;
            var d = new Date(inv.fecha_vencimiento);
            return !isNaN(d.getTime()) && d.getTime() < Date.now();
        }

        var invoices;
        if (filter === 'paid') {
            invoices = all.filter(_isPaid);
        } else if (filter === 'pending') {
            invoices = all.filter(function(i) { return !_isPaid(i); });
        } else {
            invoices = all.slice();
        }

        if (!invoices.length) {
            var msg = (filter === 'all')
                ? 'No hay facturas de ingreso'
                : 'No hay facturas con ese filtro';
            container.innerHTML = '<tr><td colspan="6" class="proy-fin-table-empty">' + msg + '</td></tr>';
            if (foot) foot.innerHTML = '';
            return;
        }

        var html = '';
        var total = 0;
        invoices.forEach(function(inv) {
            var amount = Number(inv.monto || 0);
            total += amount;
            var paid = _isPaid(inv);
            var overdue = _isOverdue(inv);
            var pillClass, pillLabel;
            if (paid) { pillClass = 'is-ok'; pillLabel = 'Cobrada'; }
            else if (overdue) { pillClass = 'is-danger'; pillLabel = 'Vencida'; }
            else { pillClass = 'is-warn'; pillLabel = 'Pendiente'; }
            var concepto = (inv.notas || inv.metodo_pago || '\u2014');
            html += '<tr>' +
                '<td><span class="proy-fin-folio">' + _esc(inv.numero_factura || '\u2014') + '</span></td>' +
                '<td><span class="proy-fin-concepto" title="' + _esc(concepto) + '">' + _esc(concepto) + '</span></td>' +
                '<td style="text-align:right" class="proy-fin-amount">' + fmtMoney(amount) + '</td>' +
                '<td class="proy-fin-date">' + fmtDate(inv.fecha_factura) + '</td>' +
                '<td><span class="proy-fin-pill ' + pillClass + '">' + pillLabel + '</span></td>' +
                '<td style="text-align:center">' + _btnEliminarIcon('proyFinEliminarFacturaIngreso(' + inv.id + ')') + '</td>' +
            '</tr>';
        });
        container.innerHTML = html;

        if (foot) {
            var pagadas = invoices.filter(_isPaid).length;
            foot.innerHTML = '<tr class="proy-fin-totalrow">' +
                '<td colspan="2" style="color:#78716c">' + invoices.length + ' factura(s) \u00b7 ' + pagadas + ' cobrada(s)</td>' +
                '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                '<td colspan="3"></td>' +
            '</tr>';
        }
    }

    var _CATEGORIA_LABEL = {
        viatics: 'Viaticos', fuel: 'Combustible', lodging: 'Hospedaje', meals: 'Comidas',
        equipment: 'Equipo', labor: 'Mano de Obra', other: 'Otro'
    };

    function renderExpenses(projectId) {
        var container = el('proyGastosBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/gastos/').then(function(resp) {
            if (resp.ok || resp.success) {
                var expenses = resp.data || [];
                if (expenses.length === 0) {
                    container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#8e8e93">No hay gastos registrados</td></tr>';
                    var foot = el('proyGastosFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var isSupervisor = !!(_cachedProjectDetail && _cachedProjectDetail.current_user_is_supervisor);
                var html = '';
                var total = 0;
                expenses.forEach(function(exp) {
                    var amount = exp.monto || 0;
                    total += amount;
                    var cat = _CATEGORIA_LABEL[exp.categoria] || exp.categoria || '\u2014';
                    var estado = exp.estado_aprobacion || 'pending';
                    var editData = JSON.stringify(exp).replace(/"/g, '&quot;');
                    var estadoCell = '<span class="proy-badge ' + statusClass(estado) + '">' + statusLabel(estado) + '</span>';
                    if (isSupervisor && estado === 'pending') {
                        estadoCell += ' <button onclick="event.stopPropagation();proyectosAprobarGasto(' + exp.id + ', \'approved\')" title="Aprobar" style="background:#DCFCE7;border:1px solid #86EFAC;color:#166534;cursor:pointer;padding:3px 6px;border-radius:6px;margin-left:4px;font-size:0.7rem;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Aprobar</button>';
                        estadoCell += '<button onclick="event.stopPropagation();proyectosAprobarGasto(' + exp.id + ', \'rejected\')" title="Rechazar" style="background:#FEE2E2;border:1px solid #FCA5A5;color:#991B1B;cursor:pointer;padding:3px 6px;border-radius:6px;margin-left:4px;font-size:0.7rem;display:inline-flex;align-items:center;gap:3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Rechazar</button>';
                    } else if (isSupervisor && estado !== 'pending') {
                        var aprobador = exp.aprobado_por_nombre ? ' por ' + exp.aprobado_por_nombre : '';
                        estadoCell += '<span style="font-size:0.68rem;color:#9CA3AF;margin-left:6px;">' + aprobador + '</span>';
                    }
                    var acciones = _btnEditarIcon('proyGastoAbrirDialogo(JSON.parse(this.closest(\'tr\').dataset.gasto))') +
                                   _btnEliminarIcon('proyGastoEliminar(' + exp.id + ')');
                    html += '<tr data-gasto="' + editData + '">' +
                        '<td>' + cat + '</td>' +
                        '<td>' + (exp.descripcion || '\u2014') + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(amount) + '</td>' +
                        '<td>' + fmtDate(exp.fecha_gasto) + '</td>' +
                        '<td style="white-space:nowrap">' + estadoCell + '</td>' +
                        '<td style="text-align:center;white-space:nowrap">' + acciones + '</td>' +
                    '</tr>';
                });

                container.innerHTML = html;

                var foot = el('proyGastosFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td colspan="2" style="text-align:right;color:#8e8e93">Total Gastos</td>' +
                        '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                        '<td colspan="3"></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#ef4444">Error al cargar gastos</td></tr>';
                console.error('Error cargando gastos:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando gastos:', err);
        });
    }


    // =========================================
    //  RENDER: TAREAS
    // =========================================

    function renderTareas(projectId) {
        var container = el('proyTareasBody');
        if (!container) return;

        container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/tareas/').then(function(resp) {
            if (resp.ok || resp.success) {
                var tasks = resp.data || [];
                if (tasks.length === 0) {
                    container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#8e8e93">No hay tareas registradas</td></tr>';
                    return;
                }

                var html = '';
                tasks.forEach(function(t) {
                    var titleCell;
                    var sourceBadge;
                    if (t.source === 'oportunidad') {
                        titleCell = '<span style="color:#007aff;cursor:pointer;font-weight:600;" onclick="var m=document.getElementById(\'crmTaskDetailModal\');if(m){m.classList.add(\'z-elevated\');m.style.zIndex=\'10800\';}if(typeof crmTaskVerDetalle===\'function\')crmTaskVerDetalle(' + t.id + ');">' + truncate(t.titulo, 40) + '</span>';
                        sourceBadge = '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:0.68rem;font-weight:600;background:#dbeafe;color:#2563eb;">CRM</span>';
                    } else {
                        titleCell = '<span style="font-weight:600;color:#1d1d1f;">' + truncate(t.titulo, 40) + '</span>';
                        sourceBadge = '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:0.68rem;font-weight:600;background:#f3e8ff;color:#7c3aed;">Proyecto</span>';
                    }
                    html += '<tr>' +
                        '<td>' + titleCell + '</td>' +
                        '<td>' + sourceBadge + '</td>' +
                        '<td><span class="proy-badge ' + priorityClass(t.prioridad) + '">' + priorityLabel(t.prioridad) + '</span></td>' +
                        '<td>' + (t.asignado_a || t.asignado_a_nombre || t.asignado_nombre || 'Sin asignar') + '</td>' +
                        '<td>' + fmtDate(t.fecha_limite) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(t.status) + '">' + statusLabel(t.status) + '</span></td>' +
                    '</tr>';
                });

                container.innerHTML = html;
            } else {
                container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Error al cargar tareas</td></tr>';
                console.error('Error cargando tareas:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando tareas:', err);
        });
    }


    // =========================================
    //  RENDER: ALERTAS
    // =========================================

    function renderAlertas(projectId) {
        var container = el('proyAlertasContainer');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:40px;color:#8e8e93">Cargando...</div>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/alertas/').then(function(resp) {
            if (resp.ok || resp.success) {
                var alerts = resp.data || [];
                if (alerts.length === 0) {
                    container.innerHTML = '<div style="text-align:center;padding:40px;color:#8e8e93">No hay alertas</div>';
                    return;
                }

                var html = '';
                alerts.forEach(function(a) {
                    var severity = a.severity || a.severidad || 'info';
                    var resolved = a.resolved || a.resuelta || false;
                    var severityColors = { critical:'#ef4444', warning:'#f59e0b', info:'#3b82f6' };
                    var bgColors = { critical:'rgba(239,68,68,0.06)', warning:'rgba(245,158,11,0.06)', info:'rgba(59,130,246,0.06)' };
                    var borderColor = severityColors[severity] || '#3b82f6';
                    var bgColor = bgColors[severity] || bgColors.info;

                    html += '<div class="proy-alert-item' + (resolved ? ' resolved' : '') + '" style="border-left-color:' + borderColor + ';background:' + bgColor + '">' +
                        '<div style="color:' + borderColor + ';flex-shrink:0;margin-top:1px">' + severityIcon(severity) + '</div>' +
                        '<div style="flex:1;min-width:0">' +
                            '<div style="font-weight:600;font-size:0.82rem;color:#1c1c1e;margin-bottom:3px">' + (a.title || a.titulo || '') + '</div>' +
                            '<div style="font-size:0.75rem;color:#636366">' + (a.message || a.mensaje || '') + '</div>' +
                        '</div>' +
                        (!resolved ? '<button class="proy-btn-sm" onclick="event.stopPropagation();proyectosResolverAlerta(' + projectId + ',' + a.id + ')" title="Marcar resuelta">Resolver</button>' : '<span style="font-size:0.7rem;color:#8e8e93;white-space:nowrap">Resuelta</span>') +
                    '</div>';
                });

                container.innerHTML = html;
            } else {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444">Error al cargar alertas</div>';
                console.error('Error cargando alertas:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444">Error de conexion</div>';
            console.error('Error de red cargando alertas:', err);
        });
    }

    window.proyectosResolverAlerta = function(projectId, alertId) {
        _fetch('/app/api/iamet/alertas/' + alertId + '/resolver/', { method: 'POST' }).then(function(resp) {
            if (resp.ok || resp.success) {
                renderAlertas(projectId);
                renderKPIsFromAPI(projectId);
            } else {
                console.error('Error resolviendo alerta:', resp.error);
            }
        }).catch(function(err) {
            console.error('Error de red resolviendo alerta:', err);
        });
    };


    // =========================================
    //  RENDER: INFORMACION
    // =========================================

    function renderInfo() {
        var container = el('proyPane_info_body');
        if (!container) return;

        var p = _cachedProjectDetail;
        if (!p) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#8e8e93">Cargando informacion...</div>';
            return;
        }

        var oppLink = '';
        var _isLevApp = document.body.classList.contains('lev-app');
        if (p.oportunidad_id && p.oportunidad_nombre) {
            if (_isLevApp) {
                oppLink = '<span style="color:#1E293B;font-weight:500">' + _esc(p.oportunidad_nombre || '') + '</span>';
            } else {
                oppLink = '<a href="javascript:void(0)" onclick="var d=document.getElementById(\'widgetDetalle\');if(d){d.classList.add(\'z-elevated\');d.style.zIndex=\'10800\';}if(typeof openDetalle===\'function\')openDetalle(' + p.oportunidad_id + ')" style="color:#007aff;text-decoration:none;font-weight:500">' + (p.oportunidad_nombre || '') + '</a>';
            }
        } else {
            oppLink = '<span style="color:#8e8e93">Sin oportunidad vinculada</span>';
        }

        var startVal = p.fecha_inicio ? p.fecha_inicio.split('T')[0] : '';
        var endVal = p.fecha_fin ? p.fecha_fin.split('T')[0] : '';

        container.innerHTML =
            '<div class="proy-info-form">' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Nombre del proyecto</label>' +
                    '<input type="text" id="proyInfoNombre" class="proy-info-input" value="' + (p.nombre || '').replace(/"/g, '&quot;') + '">' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Cliente</label>' +
                    '<input type="text" id="proyInfoCliente" class="proy-info-input" value="' + (p.cliente_nombre || '').replace(/"/g, '&quot;') + '">' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Descripcion</label>' +
                    '<textarea id="proyInfoDescripcion" class="proy-info-input" rows="3">' + (p.descripcion || '') + '</textarea>' +
                '</div>' +
                '<div class="proy-info-grid">' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Status</label>' +
                        '<select id="proyInfoStatus" class="proy-info-input">' +
                            '<option value="planning"' + (p.status === 'planning' ? ' selected' : '') + '>Planificacion</option>' +
                            '<option value="active"' + (p.status === 'active' ? ' selected' : '') + '>Activo</option>' +
                            '<option value="paused"' + (p.status === 'paused' ? ' selected' : '') + '>Pausado</option>' +
                            '<option value="completed"' + (p.status === 'completed' ? ' selected' : '') + '>Completado</option>' +
                            '<option value="archived"' + (p.status === 'archived' ? ' selected' : '') + '>Archivado</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Utilidad presupuestada</label>' +
                        '<input type="number" id="proyInfoUtilidad" class="proy-info-input" value="' + (p.utilidad_presupuestada || 0) + '" step="0.01">' +
                    '</div>' +
                '</div>' +
                '<div class="proy-info-grid">' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Fecha inicio</label>' +
                        '<input type="date" id="proyInfoInicio" class="proy-info-input" value="' + startVal + '">' +
                    '</div>' +
                    '<div class="proy-info-row">' +
                        '<label class="proy-info-label">Fecha fin</label>' +
                        '<input type="date" id="proyInfoFin" class="proy-info-input" value="' + endVal + '">' +
                    '</div>' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Oportunidad vinculada</label>' +
                    '<div style="padding:8px 0">' + oppLink + '</div>' +
                '</div>' +
                '<div class="proy-info-row">' +
                    '<label class="proy-info-label">Creado</label>' +
                    '<div style="padding:8px 0;color:#8e8e93;font-size:0.82rem">' + fmtDate(p.created_at) + '</div>' +
                '</div>' +
                '<div style="margin-top:24px;display:flex;justify-content:space-between;align-items:center;">' +
                    '<button style="padding:8px 18px;border-radius:10px;border:1.5px solid #FF3B30;background:none;color:#FF3B30;font-size:0.82rem;font-weight:600;cursor:pointer;" onclick="proyectosMostrarEliminar()">Eliminar proyecto</button>' +
                    '<button class="proy-btn proy-btn-primary" onclick="proyectosGuardarInfo()">Guardar cambios</button>' +
                '</div>' +
            '</div>';
    }

    window.proyectosMostrarEliminar = function() {
        var d = document.getElementById('proyDialogoEliminar');
        if (d) {
            d.style.display = 'flex';
            var ta = document.getElementById('proyEliminarMotivo');
            if (ta) ta.value = '';
        }
    };

    window.proyectosConfirmarEliminar = function() {
        if (!currentProjectId) return;
        var motivo = (document.getElementById('proyEliminarMotivo') || {}).value || '';
        if (!motivo.trim()) {
            _showToast('Debes documentar el motivo de eliminacion', 'error');
            return;
        }
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/eliminar/', {
            method: 'POST',
            body: { motivo: motivo.trim() }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoEliminar');
                proyectosVolverLista();
                proyectosCargarLista();
                _showToast('Proyecto eliminado', 'success');
            } else {
                _showToast(resp.error || 'Error al eliminar', 'error');
            }
        });
    };

    window.proyectosGuardarInfo = function() {
        if (!currentProjectId) return;

        var nombre = el('proyInfoNombre') ? el('proyInfoNombre').value.trim() : '';
        var cliente = el('proyInfoCliente') ? el('proyInfoCliente').value.trim() : '';
        var desc = el('proyInfoDescripcion') ? el('proyInfoDescripcion').value.trim() : '';
        var status = el('proyInfoStatus') ? el('proyInfoStatus').value : '';
        var utilidad = el('proyInfoUtilidad') ? parseFloat(el('proyInfoUtilidad').value) || 0 : 0;
        var inicio = el('proyInfoInicio') ? el('proyInfoInicio').value : '';
        var fin = el('proyInfoFin') ? el('proyInfoFin').value : '';

        if (!nombre) {
            alert('El nombre del proyecto es obligatorio');
            return;
        }

        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/actualizar/', {
            method: 'POST',
            body: {
                nombre: nombre,
                cliente_nombre: cliente,
                descripcion: desc,
                status: status,
                utilidad_presupuestada: utilidad,
                fecha_inicio: inicio,
                fecha_fin: fin
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                var project = resp.data;
                _cachedProjectDetail = project;

                // Refresh header + KPIs (consume project.overview si vino)
                renderProjectOverview(project);

                // Show toast
                _showToast('Proyecto actualizado correctamente');
            } else {
                alert('Error al guardar: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al guardar proyecto');
            console.error('Error guardando proyecto:', err);
        });
    };

    window.proyectosTareaToast = function() {
        _showToast('Detalle de tarea \u2014 proximamente');
    };

    function _showToast(message) {
        var existing = document.getElementById('proyToast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'proyToast';
        toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:#1c1c1e;color:#fff;padding:10px 24px;border-radius:10px;font-size:0.82rem;z-index:99999;opacity:0;transition:opacity 0.3s;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '1'; }, 10);
        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() { toast.remove(); }, 300);
        }, 2500);
    }


    // =========================================
    //  DIALOGS
    // =========================================

    window.proyectosCrearDialogo = function() {
        var d = el('proyDialogoCrear');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCerrarDialogo = function(dialogId) {
        var d = el(dialogId);
        if (d) d.style.display = 'none';
    };

    window.proyectosCrearPartidaDialogo = function() {
        var d = el('proyDialogoPartida');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearOCDialogo = function() {
        var d = el('proyDialogoOC');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearTareaDialogo = function() {
        var d = el('proyDialogoTarea');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearFacturaProveedorDialogo = function() {
        var d = el('proyDialogoFacProv');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearFacturaIngresoDialogo = function() {
        var d = el('proyDialogoFacIng');
        if (d) d.style.display = 'flex';
    };

    window.proyectosCrearGastoDialogo = function() {
        var d = el('proyDialogoGasto');
        if (d) d.style.display = 'flex';
    };

    window.proyectosImportarExcel = function() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.onchange = function(e) {
            var file = e.target.files[0];
            if (!file) return;

            var formData = new FormData();
            formData.append('archivo', file);
            formData.append('proyecto_id', currentProjectId);

            _fetch('/app/api/iamet/partidas/importar-excel/', {
                method: 'POST',
                body: formData
            }).then(function(resp) {
                if (resp.ok || resp.success) {
                    // Recargar detalle del proyecto para actualizar utilidad_presupuestada
                    _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/').then(function(r2) {
                        if (r2.ok || r2.success) _cachedProjectDetail = r2.data;
                        renderPartidas(currentProjectId);
                    });
                    _showImportResult(true, resp.items_created || 0, resp.ganancia_mxn || 0, resp.exchange_rate || 0, file.name);
                } else {
                    _showImportResult(false, 0, 0, 0, '', resp.error || 'Error desconocido');
                }
            }).catch(function(err) {
                _showImportResult(false, 0, 0, 0, '', 'Error de conexion');
                console.error('Error importando Excel:', err);
            });
        };
        input.click();
    };

    // --- Widget de confirmacion de importacion ---
    function _showImportResult(ok, items, ganancia, tc, filename, errorMsg) {
        var existing = document.getElementById('proyImportResultOverlay');
        if (existing) existing.remove();
        var ov = document.createElement('div');
        ov.id = 'proyImportResultOverlay';
        ov.className = 'widget-overlay';
        ov.style.cssText = 'z-index:10400;display:flex;';
        ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
        var icon = ok
            ? '<svg width="40" height="40" fill="none" stroke="#10B981" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>'
            : '<svg width="40" height="40" fill="none" stroke="#FF3B30" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
        var body = ok
            ? '<div style="font-size:1.1rem;font-weight:700;color:#1D1D1F;margin:12px 0 4px;">Importacion exitosa</div>' +
              '<div style="font-size:0.85rem;color:#6E6E73;margin-bottom:16px;">' + filename + '</div>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
                '<div style="background:#F5F5F7;border-radius:10px;padding:10px;text-align:center;"><div style="font-size:0.7rem;color:#8E8E93;text-transform:uppercase;">Partidas</div><div style="font-size:1.3rem;font-weight:700;">' + items + '</div></div>' +
                '<div style="background:#F5F5F7;border-radius:10px;padding:10px;text-align:center;"><div style="font-size:0.7rem;color:#8E8E93;text-transform:uppercase;">Ganancia</div><div style="font-size:1.3rem;font-weight:700;color:#10B981;">' + fmtMoney(ganancia) + '</div></div>' +
              '</div>' +
              '<div style="font-size:0.75rem;color:#8E8E93;text-align:center;">T.C. USD→MXN: $' + Number(tc).toFixed(2) + '</div>'
            : '<div style="font-size:1.1rem;font-weight:700;color:#FF3B30;margin:12px 0 4px;">Error en la importacion</div>' +
              '<div style="font-size:0.85rem;color:#6E6E73;">' + (errorMsg || 'Error desconocido') + '</div>';
        ov.innerHTML = '<div style="background:#fff;border-radius:20px;padding:32px;text-align:center;max-width:360px;box-shadow:0 24px 60px rgba(0,0,0,0.2);">' +
            icon + body +
            '<button onclick="this.closest(\'.widget-overlay\').remove();" style="margin-top:16px;padding:10px 32px;border-radius:12px;border:none;background:#007AFF;color:#fff;font-size:0.88rem;font-weight:700;cursor:pointer;">Aceptar</button>' +
        '</div>';
        document.body.appendChild(ov);
    }

    // --- Historial de versiones de volumetria ---

    window.proyectosVerHistorialVolumetria = function() {
        if (!currentProjectId) return;

        var overlay = document.getElementById('proyHistorialOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'proyHistorialOverlay';
            overlay.className = 'widget-overlay';
            overlay.style.cssText = 'z-index:10300;display:flex;';
            overlay.onclick = function(e) { if (e.target === overlay) overlay.style.display = 'none'; };
            overlay.innerHTML = '<div class="wco-card" style="width:min(800px,94vw);max-height:80vh;">' +
                '<div class="wco-header"><div style="display:flex;align-items:center;gap:10px;">' +
                '<div class="wco-icon"><svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>' +
                '<h1 class="wco-title">Historial de Volumetria</h1></div>' +
                '<button class="wco-close" onclick="document.getElementById(\'proyHistorialOverlay\').style.display=\'none\'">&times;</button></div>' +
                '<div class="wco-list" style="flex:1;overflow-y:auto;"><table class="wco-table"><thead><tr class="wco-thead-row">' +
                '<th>Version</th><th>Archivo</th><th>Subido por</th><th>Fecha</th><th style="text-align:right">Costo</th><th style="text-align:right">Venta</th><th style="text-align:right">Ganancia</th><th style="text-align:right">Margen</th><th>Partidas</th>' +
                '</tr></thead><tbody id="proyHistorialTbody"></tbody></table></div></div>';
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = 'flex';
        }

        var tbody = document.getElementById('proyHistorialTbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/volumetria-versiones/').then(function(resp) {
            if ((resp.ok || resp.success) && resp.data && resp.data.length > 0) {
                var html = '';
                resp.data.forEach(function(v) {
                    var isCurrent = v.is_current;
                    var rowStyle = isCurrent ? 'background:rgba(0,122,255,0.05);font-weight:600;' : 'cursor:pointer;';
                    var clickAttr = isCurrent ? '' : ' onclick="proyectosVerVersionDetalle(' + v.version + ')"';
                    html += '<tr style="' + rowStyle + '"' + clickAttr + '>' +
                        '<td>' + (isCurrent ? '<span style="color:#007AFF;">Actual</span>' : '<span style="color:#007AFF;">v' + v.version + '</span>') + '</td>' +
                        '<td style="font-size:0.78rem;">' + (v.archivo || '—') + '</td>' +
                        '<td>' + (v.subido_por || '—') + '</td>' +
                        '<td style="color:#8e8e93;font-size:0.78rem;">' + (v.fecha ? fmtDate(v.fecha) : '—') + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(v.total_costo) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(v.total_venta) + '</td>' +
                        '<td style="text-align:right;color:#10b981">' + fmtMoney(v.ganancia) + '</td>' +
                        '<td style="text-align:right">' + Math.round(v.margen) + '%</td>' +
                        '<td style="text-align:center">' + v.num_partidas + '</td>' +
                    '</tr>';
                });
                if (tbody) tbody.innerHTML = html;
                // Store versions data for detail view
                window._proyVersionesData = resp.data;
            } else {
                if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#8e8e93">No hay versiones anteriores</td></tr>';
            }
        });
    };

    window.proyectosVerVersionDetalle = function(versionNum) {
        // Find version data
        var versions = window._proyVersionesData || [];
        var ver = null;
        for (var i = 0; i < versions.length; i++) {
            if (versions[i].version === versionNum && !versions[i].is_current) {
                ver = versions[i];
                break;
            }
        }
        if (!ver) return;

        // Update the partidas table behind the overlay with version data
        var container = el('proyPartidasBody');
        if (container && ver.partidas_json && ver.partidas_json.length > 0) {
            var html = '';
            ver.partidas_json.forEach(function(item) {
                var totalProfit = item.ganancia || ((item.precio_venta_unitario || 0) - (item.costo_unitario || 0)) * (item.cantidad || 0);
                html += '<tr style="opacity:0.7;">' +
                    '<td>' + categoryDot(item.categoria) + (item.categoria || '\u2014') + '</td>' +
                    '<td title="' + (item.descripcion || '') + '">' + truncate(item.descripcion, 28) + '</td>' +
                    '<td>' + (item.marca || '\u2014') + '</td>' +
                    '<td style="font-size:0.72rem;color:#aeaeb2">' + (item.numero_parte || '\u2014') + '</td>' +
                    '<td style="text-align:center">' + (item.cantidad || 0) + '</td>' +
                    '<td style="text-align:center">' + (item.cantidad || 0) + '</td>' +
                    '<td style="text-align:right">' + fmtMoney(item.precio_lista) + '</td>' +
                    '<td style="text-align:center">' + (item.descuento || 0) + '%</td>' +
                    '<td style="text-align:right">' + fmtMoney(item.costo_unitario) + '</td>' +
                    '<td style="text-align:right">' + fmtMoney(item.precio_venta_unitario) + '</td>' +
                    '<td style="text-align:right;color:#10b981">' + fmtMoney(totalProfit) + '</td>' +
                    '<td>' + truncate(item.proveedor, 16) + '</td>' +
                    '<td><span class="proy-badge proy-status-archived">' + statusLabel(item.status) + '</span></td>' +
                    '<td></td>' +
                '</tr>';
            });
            container.innerHTML = html;

            // KPIs vienen de overview; el preview de versión solo afecta footer.
            // Update totals footer
            var foot = el('proyPartidasFoot');
            if (foot) {
                foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                    '<td colspan="8" style="text-align:right;color:#8e8e93">Totales v' + ver.version + '</td>' +
                    '<td style="text-align:right">' + fmtMoney(ver.total_costo) + '</td>' +
                    '<td style="text-align:right">' + fmtMoney(ver.total_venta) + '</td>' +
                    '<td style="text-align:right;color:#10b981">' + fmtMoney(ver.ganancia) + '</td>' +
                    '<td colspan="3"><button style="font-size:0.72rem;padding:4px 10px;border-radius:6px;border:1px solid #007AFF;background:rgba(0,122,255,0.08);color:#007AFF;cursor:pointer;font-weight:600;" onclick="proyectosRestaurarVersion(' + ver.version + ')">Restaurar</button></td>' +
                '</tr>';
            }
        }

        // Close historial overlay
        var histOverlay = document.getElementById('proyHistorialOverlay');
        if (histOverlay) histOverlay.style.display = 'none';
    };

    window.proyectosRestaurarVersion = function(versionNum) {
        if (!currentProjectId) return;
        // Widget de confirmacion
        var existing = document.getElementById('proyRestaurarOverlay');
        if (existing) existing.remove();
        var ov = document.createElement('div');
        ov.id = 'proyRestaurarOverlay';
        ov.className = 'widget-overlay';
        ov.style.cssText = 'z-index:10500;display:flex;';
        ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
        ov.innerHTML = '<div style="background:#fff;border-radius:20px;padding:32px;text-align:center;max-width:400px;box-shadow:0 24px 60px rgba(0,0,0,0.2);">' +
            '<svg width="40" height="40" fill="none" stroke="#FF9500" stroke-width="2" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
            '<div style="font-size:1.1rem;font-weight:700;color:#1D1D1F;margin:12px 0 8px;">Restaurar a Version ' + versionNum + '</div>' +
            '<div style="font-size:0.85rem;color:#6E6E73;margin-bottom:20px;">La volumetria actual se guardara en el historial antes de restaurar. Esta accion se puede revertir.</div>' +
            '<div style="display:flex;gap:10px;justify-content:center;">' +
                '<button onclick="this.closest(\'.widget-overlay\').remove();" style="padding:10px 24px;border-radius:12px;border:1px solid #E5E5EA;background:#F5F5F7;color:#3C3C43;font-size:0.85rem;font-weight:600;cursor:pointer;">Cancelar</button>' +
                '<button onclick="this.closest(\'.widget-overlay\').remove();proyectosEjecutarRestauracion(' + versionNum + ');" style="padding:10px 24px;border-radius:12px;border:none;background:#FF9500;color:#fff;font-size:0.85rem;font-weight:700;cursor:pointer;">Restaurar</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(ov);
    };

    window.proyectosEjecutarRestauracion = function(versionNum) {
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/restaurar-version/', {
            method: 'POST',
            body: { version: versionNum }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                _showImportResult(true, resp.restored || 0, 0, 0, 'Restaurado desde v' + versionNum);
                renderPartidas(currentProjectId);
            } else {
                _showToast(resp.error || 'Error al restaurar', 'error');
            }
        });
    };

    // --- Dialog form submissions ---

    window.proyectosGuardarProyecto = function() {
        var name = el('proyFormNombre') ? el('proyFormNombre').value.trim() : '';
        var client = el('proyFormCliente') ? el('proyFormCliente').value.trim() : '';
        var desc = el('proyFormDescripcion') ? el('proyFormDescripcion').value.trim() : '';
        var budget = el('proyFormPresupuesto') ? parseFloat(el('proyFormPresupuesto').value) || 0 : 0;
        var startDate = el('proyFormInicio') ? el('proyFormInicio').value : '';
        var endDate = el('proyFormFin') ? el('proyFormFin').value : '';

        if (!name || !client) return;

        _fetch('/app/api/iamet/proyectos/crear/', {
            method: 'POST',
            body: {
                nombre: name,
                descripcion: desc,
                cliente_nombre: client,
                utilidad_presupuestada: budget,
                fecha_inicio: startDate,
                fecha_fin: endDate
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoCrear');
                // Clear form
                if (el('proyFormNombre')) el('proyFormNombre').value = '';
                if (el('proyFormCliente')) el('proyFormCliente').value = '';
                if (el('proyFormDescripcion')) el('proyFormDescripcion').value = '';
                if (el('proyFormPresupuesto')) el('proyFormPresupuesto').value = '';
                if (el('proyFormInicio')) el('proyFormInicio').value = '';
                if (el('proyFormFin')) el('proyFormFin').value = '';
                proyectosCargarLista();
            } else {
                alert('Error al crear proyecto: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear proyecto');
            console.error('Error creando proyecto:', err);
        });
    };

    window.proyectosGuardarPartida = function() {
        if (!currentProjectId) return;

        var category = el('proyPartCategoria') ? el('proyPartCategoria').value : '';
        var desc = el('proyPartDescripcion') ? el('proyPartDescripcion').value.trim() : '';
        var brand = el('proyPartMarca') ? el('proyPartMarca').value.trim() : '';
        var partNumber = el('proyPartNumParte') ? el('proyPartNumParte').value.trim() : '';
        var quantity = el('proyPartCantidad') ? parseInt(el('proyPartCantidad').value) || 0 : 0;
        var listPrice = el('proyPartPrecioLista') ? parseFloat(el('proyPartPrecioLista').value) || 0 : 0;
        var discount = el('proyPartDescuento') ? parseFloat(el('proyPartDescuento').value) || 0 : 0;
        var unitCost = el('proyPartCostoUnit') ? parseFloat(el('proyPartCostoUnit').value) || 0 : 0;
        var unitSale = el('proyPartVentaUnit') ? parseFloat(el('proyPartVentaUnit').value) || 0 : 0;
        var supplier = el('proyPartProveedor') ? el('proyPartProveedor').value.trim() : '';

        if (!desc || quantity <= 0) return;

        _fetch('/app/api/iamet/partidas/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                categoria: category || 'Equipamiento',
                descripcion: desc,
                marca: brand,
                numero_parte: partNumber,
                cantidad: quantity,
                precio_lista: listPrice,
                descuento: discount,
                costo_unitario: unitCost,
                precio_venta_unitario: unitSale,
                proveedor: supplier
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoPartida');
                // Clear form
                if (el('proyPartCategoria')) el('proyPartCategoria').value = '';
                if (el('proyPartDescripcion')) el('proyPartDescripcion').value = '';
                if (el('proyPartMarca')) el('proyPartMarca').value = '';
                if (el('proyPartNumParte')) el('proyPartNumParte').value = '';
                if (el('proyPartCantidad')) el('proyPartCantidad').value = '';
                if (el('proyPartPrecioLista')) el('proyPartPrecioLista').value = '';
                if (el('proyPartDescuento')) el('proyPartDescuento').value = '';
                if (el('proyPartCostoUnit')) el('proyPartCostoUnit').value = '';
                if (el('proyPartVentaUnit')) el('proyPartVentaUnit').value = '';
                if (el('proyPartProveedor')) el('proyPartProveedor').value = '';
                renderPartidas(currentProjectId);
            } else {
                alert('Error al crear partida: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear partida');
            console.error('Error creando partida:', err);
        });
    };

    window.proyectosGuardarOC = function() {
        if (!currentProjectId) return;

        var partidaId = el('proyOCPartida') ? el('proyOCPartida').value : '';
        var supplier = el('proyOCProveedor') ? el('proyOCProveedor').value.trim() : '';
        var quantity = el('proyOCCantidad') ? parseInt(el('proyOCCantidad').value) || 0 : 0;
        var unitPrice = el('proyOCPrecioUnit') ? parseFloat(el('proyOCPrecioUnit').value) || 0 : 0;
        var deliveryDate = el('proyOCFechaEntrega') ? el('proyOCFechaEntrega').value : '';
        var notes = el('proyOCNotas') ? el('proyOCNotas').value.trim() : '';

        if (!supplier) return;

        _fetch('/app/api/iamet/oc/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                partida_id: partidaId || null,
                proveedor: supplier,
                cantidad: quantity,
                precio_unitario: unitPrice,
                fecha_entrega_esperada: deliveryDate,
                notas: notes
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoOC');
                // Clear form
                if (el('proyOCPartida')) el('proyOCPartida').value = '';
                if (el('proyOCProveedor')) el('proyOCProveedor').value = '';
                if (el('proyOCCantidad')) el('proyOCCantidad').value = '';
                if (el('proyOCPrecioUnit')) el('proyOCPrecioUnit').value = '';
                if (el('proyOCFechaEntrega')) el('proyOCFechaEntrega').value = '';
                if (el('proyOCNotas')) el('proyOCNotas').value = '';
                renderOC(currentProjectId);
            } else {
                alert('Error al crear OC: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear OC');
            console.error('Error creando OC:', err);
        });
    };

    window.proyectosGuardarTarea = function() {
        if (!currentProjectId) return;

        var title = el('proyTareaTitulo') ? el('proyTareaTitulo').value.trim() : '';
        var desc = el('proyTareaDescripcion') ? el('proyTareaDescripcion').value.trim() : '';
        var priority = el('proyTareaPrioridad') ? el('proyTareaPrioridad').value : 'medium';
        var assignedTo = el('proyTareaAsignado') ? el('proyTareaAsignado').value.trim() : '';
        var dueDate = el('proyTareaFecha') ? el('proyTareaFecha').value : '';

        if (!title) return;

        _fetch('/app/api/iamet/tareas/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                titulo: title,
                descripcion: desc,
                prioridad: priority,
                asignado_a: assignedTo,
                fecha_limite: dueDate
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoTarea');
                // Clear form
                if (el('proyTareaTitulo')) el('proyTareaTitulo').value = '';
                if (el('proyTareaDescripcion')) el('proyTareaDescripcion').value = '';
                if (el('proyTareaPrioridad')) el('proyTareaPrioridad').value = 'medium';
                if (el('proyTareaAsignado')) el('proyTareaAsignado').value = '';
                if (el('proyTareaFecha')) el('proyTareaFecha').value = '';
                renderTareas(currentProjectId);
            } else {
                alert('Error al crear tarea: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear tarea');
            console.error('Error creando tarea:', err);
        });
    };

    window.proyectosGuardarFacturaProveedor = function() {
        if (!currentProjectId) return;

        var invoiceNumber = el('proyFacProvNumero') ? el('proyFacProvNumero').value.trim() : '';
        var supplier = el('proyFacProvProveedor') ? el('proyFacProvProveedor').value.trim() : '';
        var amount = el('proyFacProvMonto') ? parseFloat(el('proyFacProvMonto').value) || 0 : 0;
        var budgeted = el('proyFacProvPresupuestado') ? parseFloat(el('proyFacProvPresupuestado').value) || 0 : 0;
        var invoiceDate = el('proyFacProvFecha') ? el('proyFacProvFecha').value : '';
        var notes = el('proyFacProvNotas') ? el('proyFacProvNotas').value.trim() : '';

        if (!invoiceNumber || !supplier) return;

        _fetch('/app/api/iamet/facturas-proveedor/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                numero_factura: invoiceNumber,
                proveedor: supplier,
                monto: amount,
                monto_presupuestado: budgeted,
                fecha_factura: invoiceDate,
                notas: notes
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoFacProv');
                // Clear form
                if (el('proyFacProvNumero')) el('proyFacProvNumero').value = '';
                if (el('proyFacProvProveedor')) el('proyFacProvProveedor').value = '';
                if (el('proyFacProvMonto')) el('proyFacProvMonto').value = '';
                if (el('proyFacProvPresupuestado')) el('proyFacProvPresupuestado').value = '';
                if (el('proyFacProvFecha')) el('proyFacProvFecha').value = '';
                if (el('proyFacProvNotas')) el('proyFacProvNotas').value = '';
                renderSupplierInvoices(currentProjectId);
            } else {
                alert('Error al crear factura: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear factura proveedor');
            console.error('Error creando factura proveedor:', err);
        });
    };

    window.proyectosGuardarFacturaIngreso = function() {
        if (!currentProjectId) return;

        var invoiceNumber = el('proyFacIngNumero') ? el('proyFacIngNumero').value.trim() : '';
        var amount = el('proyFacIngMonto') ? parseFloat(el('proyFacIngMonto').value) || 0 : 0;
        var invoiceDate = el('proyFacIngFecha') ? el('proyFacIngFecha').value : '';
        var paymentMethod = el('proyFacIngMetodo') ? el('proyFacIngMetodo').value.trim() : '';
        var notes = el('proyFacIngNotas') ? el('proyFacIngNotas').value.trim() : '';

        if (!invoiceNumber) return;

        _fetch('/app/api/iamet/facturas-ingreso/crear/', {
            method: 'POST',
            body: {
                proyecto_id: currentProjectId,
                numero_factura: invoiceNumber,
                monto: amount,
                fecha_factura: invoiceDate,
                metodo_pago: paymentMethod,
                notas: notes
            }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoFacIng');
                // Clear form
                if (el('proyFacIngNumero')) el('proyFacIngNumero').value = '';
                if (el('proyFacIngMonto')) el('proyFacIngMonto').value = '';
                if (el('proyFacIngFecha')) el('proyFacIngFecha').value = '';
                if (el('proyFacIngMetodo')) el('proyFacIngMetodo').value = '';
                if (el('proyFacIngNotas')) el('proyFacIngNotas').value = '';
                renderRevenueInvoices(currentProjectId);
            } else {
                alert('Error al crear factura: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            alert('Error de conexion al crear factura ingreso');
            console.error('Error creando factura ingreso:', err);
        });
    };

    // ── Gastos Operativos: abrir dialogo (crear/editar) ──
    window.proyGastoAbrirDialogo = function(gastoData) {
        var dlg = el('proyDialogoGasto');
        if (!dlg) return;

        var isEdit = !!gastoData;
        if (el('proyGastoDialogTitle')) el('proyGastoDialogTitle').textContent = isEdit ? 'Editar Gasto Operativo' : 'Agregar Gasto Operativo';
        if (el('proyGastoBtnGuardar')) el('proyGastoBtnGuardar').textContent = isEdit ? 'Actualizar' : 'Guardar';

        if (el('proyGastoId')) el('proyGastoId').value = isEdit ? gastoData.id : '';
        if (el('proyGastoCategoria')) el('proyGastoCategoria').value = isEdit ? (gastoData.categoria || 'other') : 'other';
        if (el('proyGastoDescripcion')) el('proyGastoDescripcion').value = isEdit ? (gastoData.descripcion || '') : '';
        if (el('proyGastoMonto')) el('proyGastoMonto').value = isEdit && gastoData.monto != null ? gastoData.monto : '';
        if (el('proyGastoPresupuesto')) el('proyGastoPresupuesto').value = isEdit && gastoData.monto_presupuestado != null ? gastoData.monto_presupuestado : '';
        if (el('proyGastoFecha')) el('proyGastoFecha').value = isEdit && gastoData.fecha_gasto ? gastoData.fecha_gasto : new Date().toISOString().slice(0, 10);
        if (el('proyGastoNotas')) el('proyGastoNotas').value = isEdit ? (gastoData.notas || '') : '';

        dlg.style.display = 'flex';
    };

    // ── Gastos Operativos: guardar (crear o actualizar) ──
    window.proyGastoGuardar = function() {
        if (!currentProjectId) return;

        var gastoId = el('proyGastoId') ? el('proyGastoId').value : '';
        var categoria = el('proyGastoCategoria') ? el('proyGastoCategoria').value : 'other';
        var descripcion = el('proyGastoDescripcion') ? el('proyGastoDescripcion').value.trim() : '';
        var monto = el('proyGastoMonto') ? parseFloat(el('proyGastoMonto').value) || 0 : 0;
        var montoPresup = el('proyGastoPresupuesto') && el('proyGastoPresupuesto').value !== '' ? parseFloat(el('proyGastoPresupuesto').value) : null;
        var fechaGasto = el('proyGastoFecha') ? el('proyGastoFecha').value : '';
        var notas = el('proyGastoNotas') ? el('proyGastoNotas').value.trim() : '';

        if (!descripcion) { _showToast('La descripcion es obligatoria'); return; }
        if (monto <= 0) { _showToast('El monto debe ser mayor a 0'); return; }
        if (!fechaGasto) { _showToast('La fecha es obligatoria'); return; }

        var url = gastoId ? '/app/api/iamet/gastos/' + gastoId + '/actualizar/' : '/app/api/iamet/gastos/crear/';
        var body = {
            categoria: categoria,
            descripcion: descripcion,
            monto: monto,
            monto_presupuestado: montoPresup,
            fecha_gasto: fechaGasto,
            notas: notas
        };
        if (!gastoId) body.proyecto_id = currentProjectId;

        _fetch(url, { method: 'POST', body: body }).then(function(resp) {
            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoGasto');
                _showToast(gastoId ? 'Gasto actualizado' : 'Gasto creado');
                renderExpenses(currentProjectId);
                if (typeof renderKPIsFromAPI === 'function') renderKPIsFromAPI(currentProjectId);
            } else {
                _showToast(resp.error || 'Error al guardar gasto');
            }
        }).catch(function() { _showToast('Error de conexion'); });
    };

    // ── Gastos Operativos: eliminar ──
    window.proyGastoEliminar = function(gastoId) {
        proyConfirm('Eliminar Gasto', '¿Estas seguro que deseas eliminar este gasto operativo?', {
            onConfirm: function() {
                _fetch('/app/api/iamet/gastos/' + gastoId + '/eliminar/', {
                    method: 'DELETE'
                }).then(function(resp) {
                    if (resp.success) {
                        _showToast('Gasto eliminado');
                        if (currentProjectId) {
                            renderExpenses(currentProjectId);
                            if (typeof renderKPIsFromAPI === 'function') renderKPIsFromAPI(currentProjectId);
                        }
                    } else {
                        _showToast(resp.error || 'Error al eliminar');
                    }
                }).catch(function() { _showToast('Error de conexion'); });
            }
        });
    };

    window.proyectosAprobarGasto = function(gastoId, accion) {
        _fetch('/app/api/iamet/gastos/' + gastoId + '/aprobar/', {
            method: 'POST',
            body: { accion: accion }
        }).then(function(resp) {
            if (resp.ok || resp.success) {
                _showToast(accion === 'approved' ? 'Gasto aprobado' : 'Gasto rechazado');
                if (currentProjectId) {
                    // Refrescar expenses y KPIs (para actualizar Gastado)
                    renderExpenses(currentProjectId);
                    if (typeof renderKPIsFromAPI === 'function') renderKPIsFromAPI(currentProjectId);
                }
            } else {
                _showToast(resp.error || 'Sin permisos para aprobar');
            }
        }).catch(function() { _showToast('Error de conexion'); });
    };

    window.proyectosEliminarProyecto = function(projectId) {
        proyConfirm('Eliminar Proyecto', '¿Estas seguro que deseas eliminar este proyecto? Todas las partidas, ordenes de compra, facturas y gastos relacionados se eliminaran tambien.', {
            onConfirm: function() {
                _fetch('/app/api/iamet/proyectos/' + projectId + '/eliminar/', {
                    method: 'POST'
                }).then(function(resp) {
                    if (resp.ok || resp.success) {
                        _showToast('Proyecto eliminado');
                        proyectosVolverLista();
                        proyectosCargarLista();
                    } else {
                        _showToast(resp.error || 'Error al eliminar');
                    }
                }).catch(function() { _showToast('Error de conexion'); });
            }
        });
    };

    window.proyectosEliminarPartida = function(partidaId) {
        proyConfirm('Eliminar Partida', '¿Estas seguro que deseas eliminar esta partida?', {
            onConfirm: function() {
                _fetch('/app/api/iamet/partidas/' + partidaId + '/eliminar/', {
                    method: 'POST'
                }).then(function(resp) {
                    if (resp.ok || resp.success) {
                        _showToast('Partida eliminada');
                        if (currentProjectId) renderPartidas(currentProjectId);
                    } else {
                        _showToast(resp.error || 'Error al eliminar');
                    }
                }).catch(function() { _showToast('Error de conexion'); });
            }
        });
    };


    // =========================================
    //  BACKDROP CLICK TO CLOSE (overlays only)
    // =========================================

    document.addEventListener('click', function(e) {
        // El detalle ya no es overlay (se navega como template), así que
        // el backdrop-click-to-close no aplica. Volver al listado se hace
        // con el breadcrumb o el botón "Portafolio". Solo manejamos los
        // sub-diálogos modales que sí siguen siendo overlay.
        if (e.target && e.target.classList.contains('proy-dialog-overlay')) {
            e.target.style.display = 'none';
        }
    });


    // =========================================
    //  MAIN TABS: Dashboard / Programa / Financiero
    // =========================================

    // proySetMainTab quedó como shim de compatibilidad. Antes alternaba
    // entre Dashboard/Programa/Financiero a nivel listado; esos modos
    // se migraron al Dashboard global. Ahora siempre carga la lista de
    // proyectos y deja el topbar del listado visible (sólo "Proyectos"
    // como cápsula informativa). Se mantiene en window para no romper
    // a quien la siga llamando externamente.
    window.proySetMainTab = function(tab) {
        _currentMainTab = 'programa';
        var topLeft = el('proyTopbarLeft');
        var topRight = el('proyTopbarRight');
        if (topLeft) topLeft.style.display = '';
        if (topRight) topRight.style.display = '';
        proyectosCargarLista();
    };

    // ── Dashboard ──
    function _getFilterParams() {
        var mesEl = document.getElementById('mesFilter');
        var anioEl = document.getElementById('anioFilter');
        var mes = mesEl ? mesEl.value : '';
        var anio = anioEl ? anioEl.value : '';
        var params = '';
        if (anio) params += 'anio=' + anio;
        if (mes) params += (params ? '&' : '') + 'mes=' + mes;
        return params;
    }

    function _loadDashboard() {
        var kpiContainer = el('proyDashKpis');
        var listContainer = el('proyDashList');
        if (kpiContainer) kpiContainer.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#8e8e93;padding:20px;">Cargando...</div>';

        var params = _getFilterParams();
        _fetch('/app/api/iamet/proyectos/dashboard/' + (params ? '?' + params : '')).then(function(resp) {
            if (!resp.success) return;
            var d = resp.data;
            if (kpiContainer) {
                kpiContainer.innerHTML =
                    _dashKpiCard('Proyectos en Ejecucion', d.proyectos_ejecucion, '#007AFF', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>', '+' + d.proyectos_programados + ' programados') +
                    _dashKpiCard('Total Proyectos', d.total_proyectos, '#6366f1', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>', d.proyectos_completados + ' completados') +
                    _dashKpiCard('Venta Total', fmtMoney(d.venta_total), '#007AFF', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>', 'Costo: ' + fmtMoney(d.costo_total)) +
                    _dashKpiCard('Utilidad Total', fmtMoney(d.utilidad_total), '#059669', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>', d.venta_total > 0 ? Math.round(d.utilidad_total / d.venta_total * 100) + '% margen' : '');
            }
        });

        // Load ALL projects (not just active)
        _fetch('/app/api/iamet/proyectos/').then(function(resp) {
            if (!resp.ok && !resp.success) return;
            var projects = resp.data || [];
            if (listContainer) {
                if (projects.length === 0) {
                    listContainer.innerHTML = '<div style="text-align:center;color:#8e8e93;padding:40px;">No hay proyectos en este periodo</div>';
                    return;
                }
                listContainer.innerHTML = projects.map(function(p) {
                    var budgeted = p.utilidad_presupuestada || 0;
                    var actual = p.utilidad_real || 0;
                    var pct = budgeted > 0 ? Math.min(Math.round(actual / budgeted * 100), 100) : 0;
                    var barColor = pct >= 70 ? '#10b981' : (pct >= 30 ? '#f59e0b' : '#e5e7eb');
                    var statusLabels = {active:'En Ejecucion', planning:'Planificacion', completed:'Completado', paused:'Pausado', archived:'Archivado'};
                    var statusColors = {active:'#10b981', planning:'#f59e0b', completed:'#6366f1', paused:'#8e8e93', archived:'#6B7280'};
                    var sLabel = statusLabels[p.status] || p.status;
                    var statusColor = statusColors[p.status] || '#6B7280';

                    // Equipo: show project owner name
                    var equipoHtml = p.usuario_nombre ? p.usuario_nombre : '\u2014';

                    // Fechas: start date + days active
                    var fechaHtml = '\u2014';
                    if (p.fecha_inicio) {
                        var startParts = p.fecha_inicio.split('T')[0].split('-');
                        var startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
                        var dias;
                        if (p.status === 'completed' && p.fecha_fin) {
                            var endParts = p.fecha_fin.split('T')[0].split('-');
                            var endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
                            dias = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
                        } else {
                            var today = new Date();
                            today.setHours(0,0,0,0);
                            dias = Math.round((today - startDate) / (1000 * 60 * 60 * 24));
                        }
                        fechaHtml = fmtDate(p.fecha_inicio) + ' &middot; ' + dias + ' dias';
                    }

                    return '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:12px;cursor:pointer;transition:box-shadow 0.15s;" onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.08)\'" onmouseout="this.style.boxShadow=\'none\'" onclick="proyectosVerDetalle(' + p.id + ')">' +
                        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">' +
                            '<div><div style="font-weight:700;font-size:0.9rem;">' + p.nombre + '</div>' +
                            '<div style="font-size:0.78rem;color:#6E6E73;">' + (p.cliente_nombre || '') + '</div></div>' +
                            '<span style="font-size:0.7rem;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid ' + statusColor + ';color:' + statusColor + ';">' + sLabel + '</span>' +
                        '</div>' +
                        '<div style="margin:10px 0 8px;">' +
                            '<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:#6E6E73;margin-bottom:4px;"><span>Avance</span><span>' + pct + '%</span></div>' +
                            '<div style="height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:3px;transition:width 0.3s;"></div></div>' +
                        '</div>' +
                        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;border-top:1px solid #f3f4f6;padding-top:10px;margin-top:6px;">' +
                            '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Equipo</div><div style="font-weight:600;font-size:0.82rem;">' + equipoHtml + '</div></div>' +
                            '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Presupuesto</div><div style="font-weight:600;font-size:0.82rem;">' + fmtMoney(budgeted) + '</div></div>' +
                            '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Gastado</div><div style="font-weight:600;font-size:0.82rem;">' + fmtMoney(actual) + '</div></div>' +
                            '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Fechas</div><div style="font-weight:600;font-size:0.78rem;">' + fechaHtml + '</div></div>' +
                        '</div>' +
                    '</div>';
                }).join('');
            }
        });
    }

    function _dashKpiCard(label, value, color, iconSvg, subtitle) {
        return '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div><div style="font-size:0.72rem;color:#6E6E73;margin-bottom:4px;">' + label + '</div>' +
            '<div style="font-size:1.4rem;font-weight:700;">' + value + '</div>' +
            (subtitle ? '<div style="font-size:0.68rem;color:#8e8e93;margin-top:2px;">' + subtitle + '</div>' : '') +
            '</div>' +
            '<div style="color:' + color + ';opacity:0.7;">' + iconSvg + '</div>' +
        '</div>';
    }

    // ── Financiero ──
    var _finStatus = 'active';

    window.proyFinFilter = function(status) {
        _finStatus = status;
        document.querySelectorAll('.proy-fin-tab').forEach(function(btn) {
            var isActive = btn.getAttribute('data-status') === status;
            btn.style.background = isActive ? '#fff' : '#f9fafb';
            btn.style.color = isActive ? '#007AFF' : '#6B7280';
            btn.style.fontWeight = isActive ? '600' : '500';
            btn.style.borderBottom = isActive ? '2px solid #007AFF' : '2px solid transparent';
            btn.classList.toggle('active', isActive);
        });
        _loadFinanciero(status);
    };

    function _loadFinanciero(status) {
        var container = el('proyFinList');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;color:#8e8e93;padding:40px;">Cargando...</div>';

        _fetch('/app/api/iamet/proyectos/financiero/?status=' + status).then(function(resp) {
            if (!resp.success) return;
            var projects = resp.data || [];
            if (projects.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:#8e8e93;padding:40px;">No hay proyectos en este estado</div>';
                return;
            }
            container.innerHTML = projects.map(function(p) {
                var margenColor = p.margen >= 20 ? '#059669' : (p.margen >= 10 ? '#f59e0b' : '#DC2626');
                return '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:12px;cursor:pointer;display:flex;align-items:center;transition:box-shadow 0.15s;" onmouseover="this.style.boxShadow=\'0 2px 8px rgba(0,0,0,0.08)\'" onmouseout="this.style.boxShadow=\'none\'" onclick="proyectosVerDetalle(' + p.id + ')">' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:700;font-size:0.9rem;">' + p.nombre + '</div>' +
                        '<div style="font-size:0.78rem;color:#6E6E73;">' + (p.cliente_nombre || '') + '</div>' +
                    '</div>' +
                    '<div style="display:grid;grid-template-columns:repeat(4,minmax(100px,1fr));gap:16px;text-align:left;">' +
                        '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Utilidad Presupuestada</div><div style="font-weight:700;font-size:0.88rem;">' + fmtMoney(p.utilidad_presupuestada) + '</div></div>' +
                        '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Costo Total</div><div style="font-weight:700;font-size:0.88rem;color:#DC2626;">' + fmtMoney(p.costo_total) + '</div></div>' +
                        '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Venta Total</div><div style="font-weight:700;font-size:0.88rem;color:#007AFF;">' + fmtMoney(p.venta_total) + '</div></div>' +
                        '<div><div style="font-size:0.65rem;color:#8e8e93;text-transform:uppercase;">Margen</div><div style="font-weight:700;font-size:0.88rem;color:' + margenColor + ';">' + p.margen + '%</div></div>' +
                    '</div>' +
                    '<div style="margin-left:12px;color:#c7c7cc;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>' +
                '</div>';
            }).join('');
        });
    }


    // ════════════════════════════════════════════════════════════
    //  LEVANTAMIENTOS (reemplaza Partidas en la pestaña)
    //  Lista de filas clickables. Click abre el wizard de 5 fases.
    // ════════════════════════════════════════════════════════════

    function _statusPillHtml(status, label) {
        var cls = 'proy-tv2-status proy-tv2-status-' + status;
        return '<span class="' + cls + '"><i></i>' + _esc(label) + '</span>';
    }

    // Permiso global de edición de levantamientos (lo manda el backend con
    // cada lista). Si está en false, el frontend renderiza la tabla y el
    // wizard en modo lectura — vendedores no editan ni borran.
    var _levPuedeEditar = true;

    function renderLevantamientos(projectId) {
        var body = el('levListBody');
        var emptyEl = el('levListEmpty');
        if (!body) return;
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#94A3B8;font-size:12.5px;">Cargando levantamientos…</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/levantamientos/').then(function (resp) {
            if (!(resp.ok || resp.success)) {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#EF4444;font-size:12.5px;">Error cargando: ' + _esc(resp.error || '') + '</td></tr>';
                return;
            }
            var items = resp.data || [];
            _cachedLevantamientos = items;
            // El backend dice si este usuario puede editar (no vendedor).
            _levPuedeEditar = (resp.puede_editar !== false);
            // Ocultar botón "Iniciar levantamiento" para vendedores.
            var btnIniciar = el('btnIniciarLevantamiento');
            if (btnIniciar) btnIniciar.style.display = _levPuedeEditar ? '' : 'none';
            // Ocultar/mostrar header de la columna "acciones" según rol.
            var thAction = document.querySelector('.lev-list-th-action');
            if (thAction) thAction.style.display = _levPuedeEditar ? '' : 'none';

            if (items.length === 0) {
                body.innerHTML = '';
                if (emptyEl) emptyEl.style.display = '';
                return;
            }
            if (emptyEl) emptyEl.style.display = 'none';
            var html = items.map(function (l) {
                var fecha = _fmtShortDate(l.fecha_actualizacion || l.fecha_creacion);
                var creador = l.creado_por_nombre || '—';
                // "Editado por": muestra quién hizo la última modificación.
                // Si es el mismo creador (o aún nadie modificó), mostramos "—".
                var editor = l.actualizado_por_nombre && l.actualizado_por_id !== l.creado_por_id
                    ? l.actualizado_por_nombre
                    : (l.actualizado_por_nombre || '—');
                var faseLbl = 'Fase ' + (l.fase_actual || 1) + '/5';
                var idArg = JSON.stringify(l.id);
                var trashCell = _levPuedeEditar
                    ? ('<td><button class="lev-row-del" title="Eliminar" onclick="event.stopPropagation(); levantamientoEliminar(' + idArg + ')">' +
                       '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                       '</button></td>')
                    : '';
                return '<tr class="lev-row" onclick="levantamientoAbrir(' + idArg + ')">' +
                    '<td><div class="lev-row-name">' + _esc(l.nombre || 'Sin nombre') +
                        (l._offline ? ' <span style="background:#FEF3C7;color:#92400E;font-size:10px;font-weight:700;padding:2px 6px;border-radius:100px;margin-left:6px;">Sin subir</span>' : '') +
                        '</div></td>' +
                    '<td>' + _statusPillHtml(l.status, l.status_label) + '</td>' +
                    '<td><span class="lev-row-fase">' + faseLbl + '</span></td>' +
                    '<td><span class="lev-row-creador">' + _esc(creador) + '</span></td>' +
                    '<td><span class="lev-row-creador">' + _esc(editor) + '</span></td>' +
                    '<td class="date"><span class="proy-tv2-fecha">' + fecha + '</span></td>' +
                    trashCell +
                    '</tr>';
            }).join('');
            body.innerHTML = html;
        }).catch(function (err) {
            console.error('Error levantamientos:', err);
            body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#EF4444;font-size:12.5px;">Error de red</td></tr>';
        });
    }

    var _cachedLevantamientos = [];

    // Crea un levantamiento nuevo y abre el wizard
    // ═══════════════════════════════════════════════════════════
    //  PLANTILLAS DE LEVANTAMIENTO (para matar la parálisis de
    //  la hoja en blanco. Cada plantilla pre-puebla fase1_data con
    //  servicios, componentes y productos típicos — el ingeniero
    //  solo ajusta cantidades y detalles.)
    // ═══════════════════════════════════════════════════════════

    var LEVANTAMIENTO_TEMPLATES = {
        cctv16: {
            nombre: 'Instalación CCTV 16 cámaras',
            servicios: ['CCTV'],
            componentes: ['Cámara IP', 'NVR', 'Gabinete/Rack', 'Switches', 'UPS', 'Cable Cat6'],
            productos: [
                { desc: 'Cámara IP Domo 4MP IR 30m', marca: 'Hikvision', modelo: 'DS-2CD2347G2-LU', unidad: 'PZA', qty: 16, precio: 2850 },
                { desc: 'NVR 32 canales 4K H.265+', marca: 'Hikvision', modelo: 'DS-7732NI-I4/16P', unidad: 'PZA', qty: 1, precio: 18500 },
                { desc: 'Disco Duro Surveillance 4TB', marca: 'Seagate', modelo: 'SkyHawk ST4000VX016', unidad: 'PZA', qty: 2, precio: 1650 },
                { desc: 'Cable UTP Cat6 CCA 305m', marca: 'Belden', modelo: '1700A', unidad: 'BOB', qty: 3, precio: 890 },
                { desc: 'Switch PoE 24 puertos Gigabit', marca: 'TP-Link', modelo: 'TL-SG1224PE', unidad: 'PZA', qty: 1, precio: 5400 },
                { desc: 'Gabinete Rack 12U Pared', marca: 'Linkedpro', modelo: 'LP-GB-12U-W', unidad: 'PZA', qty: 1, precio: 3200 },
            ],
        },
        cableado32: {
            nombre: 'Cableado Estructurado 32 nodos',
            servicios: ['Cableado Estructurado'],
            componentes: ['Cable Cat6', 'Gabinete/Rack', 'Switches', 'Tubería', 'Canalización'],
            productos: [
                { desc: 'Cable UTP Cat6 CCA 305m', marca: 'PANDUIT', modelo: 'NetKey NUC6C04BU-CEG', unidad: 'BOB', qty: 5, precio: 950 },
                { desc: 'Jack Cat6 Mini-Com TG Blanco', marca: 'PANDUIT', modelo: 'CJ688TGWH', unidad: 'PZA', qty: 32, precio: 115 },
                { desc: 'Faceplate 2 puertos blanco', marca: 'PANDUIT', modelo: 'CFPE2IWY', unidad: 'PZA', qty: 16, precio: 42 },
                { desc: 'Patch Panel Cat6 24 puertos', marca: 'PANDUIT', modelo: 'DP24688TGY', unidad: 'PZA', qty: 2, precio: 1800 },
                { desc: 'Patch Cord Cat6 2m azul', marca: 'PANDUIT', modelo: 'UTP6X7BU', unidad: 'PZA', qty: 32, precio: 95 },
                { desc: 'Gabinete Rack 24U Piso', marca: 'Linkedpro', modelo: 'LP-GB-24U-F', unidad: 'PZA', qty: 1, precio: 6200 },
                { desc: 'Switch 48 puertos Gigabit', marca: 'TP-Link', modelo: 'TL-SG1048', unidad: 'PZA', qty: 1, precio: 7800 },
            ],
        },
        acceso: {
            nombre: 'Control de Acceso básico',
            servicios: ['Control de Acceso'],
            componentes: ['Controladora', 'Cable Cat6', 'Gabinete/Rack', 'UPS', 'Fuentes de Poder'],
            productos: [
                { desc: 'Controladora 2 puertas IP', marca: 'Hikvision', modelo: 'DS-K2602T', unidad: 'PZA', qty: 1, precio: 8500 },
                { desc: 'Lector de tarjeta Mifare', marca: 'Hikvision', modelo: 'DS-K1102MK', unidad: 'PZA', qty: 2, precio: 1450 },
                { desc: 'Cerradura electromagnética 600 lbs', marca: 'Yli', modelo: 'YM-600', unidad: 'PZA', qty: 2, precio: 2200 },
                { desc: 'Botón de salida metálico', marca: 'Yli', modelo: 'PBK-815', unidad: 'PZA', qty: 2, precio: 380 },
                { desc: 'Fuente 12V 5A respaldo', marca: 'Syscom', modelo: 'PL1250', unidad: 'PZA', qty: 1, precio: 950 },
                { desc: 'Cable multipar 4x22 AWG 305m', marca: 'Syscom', modelo: 'SPT-4X22', unidad: 'BOB', qty: 1, precio: 720 },
            ],
        },
    };

    // Abre el modal-picker de plantillas y delega la creación a
    // _crearLevantamientoConPlantilla() según lo que elija el usuario.
    window.levantamientoIniciar = function () {
        if (!currentProjectId) return;
        _abrirPickerPlantillas();
    };

    // Realmente crea el levantamiento (con o sin plantilla).
    //   templateKey:  clave de LEVANTAMIENTO_TEMPLATES o 'blank' o 'copy-<id>'
    function _crearLevantamientoConPlantilla(templateKey) {
        var btn = el('btnIniciarLevantamiento');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
        var body = {};
        if (templateKey && templateKey !== 'blank') {
            if (templateKey.indexOf('copy-') === 0) {
                var levId = templateKey.substring(5);
                // Caso copiar: fetchea el levantamiento origen y pasa su data
                _fetch('/app/api/iamet/levantamientos/' + levId + '/').then(function (resp) {
                    if (resp.ok || resp.success) {
                        var src = resp.data;
                        var copyBody = {
                            nombre: (src.nombre || 'Levantamiento') + ' (copia)',
                            fase1_data: src.fase1_data || {},
                        };
                        _postCrearLev(copyBody);
                    } else {
                        if (typeof showToast === 'function') showToast('No se pudo leer el levantamiento original', 'error');
                        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
                    }
                });
                return;
            }
            var tpl = LEVANTAMIENTO_TEMPLATES[templateKey];
            if (tpl) {
                body = {
                    nombre: tpl.nombre,
                    fase1_data: {
                        servicios: tpl.servicios.slice(),
                        componentes: tpl.componentes.slice(),
                        productos: tpl.productos.map(function (p, i) {
                            return Object.assign({}, p, { partida: i + 1 });
                        }),
                    },
                };
            }
        }
        _postCrearLev(body);
    }

    function _postCrearLev(body) {
        var btn = el('btnIniciarLevantamiento');
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/levantamientos/crear/', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body),
        }).then(function (resp) {
            if (resp.success) {
                renderLevantamientos(currentProjectId);
                if (typeof window.levantamientoWizardOpen === 'function') {
                    window.levantamientoWizardOpen(resp.data);
                }
            } else {
                if (typeof showToast === 'function') showToast(resp.error || 'No se pudo crear el levantamiento', 'error');
            }
        }).catch(function () {
            if (typeof showToast === 'function') showToast('Error de red', 'error');
        }).finally(function () {
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        });
    }

    // Renderea el modal-picker con las 3 plantillas + "copiar" + "en blanco"
    function _abrirPickerPlantillas() {
        var existing = el('levTplPicker');
        if (existing) existing.remove();

        // Construir lista de levantamientos existentes del proyecto para "copiar"
        var copyOptions = (_cachedLevantamientos || []).slice(0, 5).map(function (l) {
            return '<button type="button" class="lev-tpl-copy-row" onclick="_levTplPick(\'copy-' + l.id + '\')">' +
                '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
                '<span class="lev-tpl-copy-name">' + _esc(l.nombre || 'Sin nombre') + '</span>' +
                '<span class="lev-tpl-copy-sub">' + _esc(l.status_label || '') + ' · Fase ' + (l.fase_actual || 1) + '/5</span>' +
            '</button>';
        }).join('');

        var html = '' +
        '<div class="lev-tpl-backdrop" id="levTplPicker" onclick="if(event.target===this)_levTplClose()">' +
            '<div class="lev-tpl-modal">' +
                '<div class="lev-tpl-head">' +
                    '<div>' +
                        '<div class="lev-tpl-title">¿Con qué quieres empezar?</div>' +
                        '<div class="lev-tpl-sub">Elige una plantilla para ahorrar tiempo, o arranca desde cero.</div>' +
                    '</div>' +
                    '<button type="button" class="lev-tpl-close" onclick="_levTplClose()" aria-label="Cerrar">' +
                        '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
                    '</button>' +
                '</div>' +

                '<div class="lev-tpl-grid">' +
                    _tplCard('cctv16', '📹', 'CCTV 16 cámaras', 'Hikvision · NVR 32ch · Cable Cat6', '$110k estimado') +
                    _tplCard('cableado32', '🔌', 'Cableado 32 nodos', 'PANDUIT Cat6 · Gabinete 24U · Switch 48p', '$28k estimado') +
                    _tplCard('acceso', '🔐', 'Control de Acceso básico', '2 puertas · Lectores Mifare · Cerraduras 600lb', '$18k estimado') +
                    _tplCard('blank', '✏️', 'En blanco', 'Sin datos pre-llenados — captura todo manual', 'Para casos especiales') +
                '</div>' +

                (copyOptions ? '<div class="lev-tpl-copy-wrap">' +
                    '<div class="lev-tpl-copy-label">O duplicar un levantamiento previo</div>' +
                    '<div class="lev-tpl-copy-list">' + copyOptions + '</div>' +
                '</div>' : '') +
            '</div>' +
        '</div>';

        var wrap = document.createElement('div');
        wrap.innerHTML = html;
        document.body.appendChild(wrap.firstChild);
    }

    function _tplCard(key, emoji, title, detail, price) {
        return '<button type="button" class="lev-tpl-card" onclick="_levTplPick(\'' + key + '\')">' +
            '<div class="lev-tpl-emoji">' + emoji + '</div>' +
            '<div class="lev-tpl-card-title">' + title + '</div>' +
            '<div class="lev-tpl-card-detail">' + detail + '</div>' +
            '<div class="lev-tpl-card-price">' + price + '</div>' +
        '</button>';
    }

    window._levTplPick = function (key) {
        _levTplClose();
        _crearLevantamientoConPlantilla(key);
    };
    window._levTplClose = function () {
        var m = el('levTplPicker');
        if (m) m.remove();
    };

    // Abre el wizard cargando el detalle del levantamiento
    window.levantamientoAbrir = function (levId) {
        _fetch('/app/api/iamet/levantamientos/' + levId + '/').then(function (resp) {
            if (!(resp.ok || resp.success)) {
                if (typeof showToast === 'function') showToast(resp.error || 'No se pudo abrir', 'error');
                return;
            }
            var puedeEditar = (resp.puede_editar !== false) && _levPuedeEditar;
            if (puedeEditar) {
                // Ingeniero / supervisor / admin → wizard editable.
                if (typeof window.levantamientoWizardOpen === 'function') {
                    window.levantamientoWizardOpen(resp.data, { puedeEditar: true });
                }
            } else {
                // Vendedor → overlay de consulta (NO carga el wizard, no
                // dispara autosave que daría 403).
                if (typeof window.levantamientoConsultaAbrir === 'function') {
                    window.levantamientoConsultaAbrir(resp.data);
                }
            }
        });
    };

    // Elimina un levantamiento (con confirmación custom)
    window.levantamientoEliminar = function (levId) {
        proyConfirm('Eliminar levantamiento', 'Esta acción es permanente. Se perderán los datos capturados en las 5 fases (propuesta técnica, volumetría, fotos, etc.). ¿Seguro que quieres eliminarlo?', {
            textoConfirmar: 'Eliminar levantamiento',
            onConfirm: function () {
                _fetch('/app/api/iamet/levantamientos/' + levId + '/eliminar/', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: '{}',
                }).then(function (resp) {
                    if (resp.success) {
                        renderLevantamientos(currentProjectId);
                        if (typeof showToast === 'function') showToast('Levantamiento eliminado', 'success');
                    } else if (typeof showToast === 'function') {
                        showToast(resp.error || 'Error al eliminar', 'error');
                    }
                });
            },
        });
    };

    // Refresca la lista tras cambios en el wizard
    window.levantamientoRefrescarLista = function () {
        if (currentProjectId) renderLevantamientos(currentProjectId);
    };

    // Exponer ID del proyecto actual para módulos externos (Gantt, etc.)
    window.proyGetCurrentProjectId = function() { return currentProjectId; };

    // ── Drive: archivos de la oportunidad vinculada ──────────────
    var _driveOppId = null;
    var _driveParentStack = []; // stack de IDs de carpetas para "atrás"

    function _renderDrive(projectId) {
        var container = document.getElementById('proyDriveContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#94A3B8;font-size:0.85rem;">Cargando...</div>';
        _driveParentStack = [];
        _updateDriveBackBtn();

        // Obtener detalle del proyecto para saber la oportunidad vinculada
        _fetch('/app/api/iamet/proyectos/' + projectId + '/').then(function(resp) {
            var data = resp.data || resp;
            _driveOppId = data.oportunidad_id || null;
            if (!_driveOppId) {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#94A3B8;">' +
                    '<svg width="40" height="40" fill="none" stroke="#CBD5E1" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 12px;display:block;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
                    '<div style="font-weight:600;margin-bottom:4px;">Sin oportunidad vinculada</div>' +
                    '<div style="font-size:0.78rem;">Este proyecto no tiene una oportunidad asociada con archivos.</div></div>';
                return;
            }
            _loadDriveFolder(null);
        }).catch(function() {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#EF4444;">Error cargando proyecto</div>';
        });
    }

    function _loadDriveFolder(parentId) {
        var container = document.getElementById('proyDriveContainer');
        if (!container || !_driveOppId) return;
        container.innerHTML = '<div style="text-align:center;padding:20px;color:#94A3B8;">Cargando...</div>';
        var url = '/app/api/oportunidad/' + _driveOppId + '/drive/';
        if (parentId) url += '?parent=' + parentId;

        _fetch(url).then(function(data) {
            var items = (data.carpetas || []).concat(data.archivos || []);
            if (items.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:40px;color:#94A3B8;">' +
                    '<svg width="36" height="36" fill="none" stroke="#CBD5E1" stroke-width="1.5" viewBox="0 0 24 24" style="margin:0 auto 10px;display:block;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
                    '<div style="font-size:0.82rem;">Sin archivos en esta carpeta</div></div>';
                return;
            }

            var html = '<div style="display:flex;flex-direction:column;gap:2px;">';
            // Carpetas primero
            (data.carpetas || []).forEach(function(c) {
                html += '<div class="proy-drive-item" onclick="proyDriveOpenFolder(' + c.id + ')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background 0.1s;" onmouseover="this.style.background=\'#F8FAFC\'" onmouseout="this.style.background=\'transparent\'">' +
                    '<svg width="20" height="20" fill="#FBBF24" stroke="#F59E0B" stroke-width="1" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
                    '<span style="flex:1;font-size:0.85rem;font-weight:600;color:#1E293B;">' + _esc(c.nombre) + '</span>' +
                    '<svg width="14" height="14" fill="none" stroke="#94A3B8" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>' +
                '</div>';
            });
            // Archivos
            (data.archivos || []).forEach(function(a) {
                var icon = _driveFileIcon(a.extension || a.tipo_archivo);
                var size = a.tamaño ? _formatFileSize(a.tamaño) : '';
                // El backend manda la URL correcta según la tabla de origen
                // (ArchivoOportunidad → /oportunidad/.../drive/archivo/...,
                //  ArchivoProyecto    → /proyecto/.../archivo/...).
                // Reconstruirla aquí 404eaba los archivos de proyecto.
                var streamUrl = a.url || ('/app/api/oportunidad/' + _driveOppId + '/drive/archivo/' + a.id + '/stream/');
                html += '<div class="proy-drive-item" onclick="window.open(\'' + streamUrl + '\',\'_blank\')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;transition:background 0.1s;" onmouseover="this.style.background=\'#F8FAFC\'" onmouseout="this.style.background=\'transparent\'">' +
                    icon +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:0.85rem;font-weight:500;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(a.nombre) + '</div>' +
                        (size ? '<div style="font-size:0.7rem;color:#94A3B8;">' + size + '</div>' : '') +
                    '</div>' +
                    '<a href="' + streamUrl + '?dl=1" onclick="event.stopPropagation()" style="padding:4px;color:#64748B;" title="Descargar"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></a>' +
                '</div>';
            });
            html += '</div>';
            container.innerHTML = html;
        }).catch(function(err) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#EF4444;">Error: ' + (err.message || err) + '</div>';
        });
    }

    window.proyDriveOpenFolder = function(folderId) {
        _driveParentStack.push(folderId);
        _updateDriveBackBtn();
        _loadDriveFolder(folderId);
    };

    window.proyDriveNavBack = function() {
        _driveParentStack.pop();
        var parentId = _driveParentStack.length > 0 ? _driveParentStack[_driveParentStack.length - 1] : null;
        _updateDriveBackBtn();
        _loadDriveFolder(parentId);
    };

    function _updateDriveBackBtn() {
        var btn = document.getElementById('proyDriveBackBtn');
        if (btn) btn.style.display = _driveParentStack.length > 0 ? '' : 'none';
    }

    function _driveFileIcon(ext) {
        var color = '#64748B';
        if (['pdf'].indexOf(ext) !== -1) color = '#EF4444';
        else if (['doc','docx','txt'].indexOf(ext) !== -1) color = '#3B82F6';
        else if (['xls','xlsx','csv'].indexOf(ext) !== -1) color = '#10B981';
        else if (['jpg','jpeg','png','gif','svg','webp'].indexOf(ext) !== -1) color = '#8B5CF6';
        else if (['ppt','pptx'].indexOf(ext) !== -1) color = '#F59E0B';
        return '<svg width="20" height="20" fill="none" stroke="' + color + '" stroke-width="1.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }

    function _formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    // ═════════════════════════════════════════════════════════════
    //  OC: menú contextual (Editar / Eliminar)
    // ═════════════════════════════════════════════════════════════
    window.proyOcMenuToggle = function (btn) {
        _closeOcMenu();
        var oc = JSON.parse(decodeURIComponent(btn.getAttribute('data-oc')));
        var partida = JSON.parse(decodeURIComponent(btn.getAttribute('data-partida') || '%7B%7D'));
        var menu = document.createElement('div');
        menu.id = 'proyOcContextMenu';
        menu.style.cssText = 'position:absolute;right:0;top:24px;z-index:10600;background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.18);padding:6px 0;min-width:170px;';
        var items = [
            { label: 'Editar', color: '#1d1d1f', action: 'edit' },
            { label: 'Eliminar', color: '#EF4444', action: 'delete' },
        ];
        var h = '';
        items.forEach(function (mi) {
            h += '<button data-action="' + mi.action + '" style="display:flex;align-items:center;width:100%;padding:9px 16px;border:none;background:none;cursor:pointer;font-size:0.8rem;color:' + mi.color + ';text-align:left;" onmouseover="this.style.background=\'#f5f5f7\'" onmouseout="this.style.background=\'none\'">' +
                 '<span style="font-weight:500;">' + mi.label + '</span></button>';
        });
        menu.innerHTML = h;
        btn.parentElement.appendChild(menu);
        menu.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var action = b.getAttribute('data-action');
                _closeOcMenu();
                if (action === 'edit') _openEditOcDialog(oc, partida);
                else if (action === 'delete') _confirmDeleteOc(oc);
            });
        });
    };

    function _closeOcMenu() {
        var existing = document.getElementById('proyOcContextMenu');
        if (existing) existing.remove();
    }
    document.addEventListener('click', _closeOcMenu);

    function _openEditOcDialog(oc, partida) {
        var existing = document.getElementById('proyDialogoEditarOc');
        if (existing) existing.remove();
        var pendiente = (partida && partida.cantidad_pendiente) || 0;
        var ocCantActual = parseFloat(oc.cantidad || 0);
        var maxCant = pendiente + ocCantActual; // pendiente actual + lo que ya tenía esta OC

        var ov = document.createElement('div');
        ov.id = 'proyDialogoEditarOc';
        ov.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:10700;align-items:center;justify-content:center;';
        ov.onclick = function (e) { if (e.target === ov) ov.remove(); };

        ov.innerHTML =
            '<div style="background:#fff;border-radius:16px;padding:24px;width:min(460px,92vw);max-height:85vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,0.25);">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">' +
                    '<h3 style="margin:0;font-size:1.05rem;">Editar orden de compra ' + (oc.numero_oc ? '(' + oc.numero_oc + ')' : '') + '</h3>' +
                    '<button onclick="document.getElementById(\'proyDialogoEditarOc\').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#8e8e93;">×</button>' +
                '</div>' +
                (partida && partida.descripcion ? '<div style="font-size:0.74rem;color:#86868B;margin-bottom:14px;">Partida: <b>' + (partida.descripcion || '') + '</b> · Pendiente actual: ' + pendiente + ' · Cantidad disponible para esta OC: hasta <b>' + maxCant + '</b></div>' : '') +
                '<div style="display:flex;flex-direction:column;gap:12px;">' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                        '<div><label style="font-size:0.72rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Cantidad</label>' +
                            '<input type="number" id="proyOcEditCant" class="proy-info-input" min="0.01" step="0.01" max="' + maxCant + '" value="' + ocCantActual + '"></div>' +
                        '<div><label style="font-size:0.72rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Precio unitario</label>' +
                            '<input type="number" id="proyOcEditPrecio" class="proy-info-input" min="0" step="0.01" value="' + parseFloat(oc.precio_unitario || 0) + '"></div>' +
                    '</div>' +
                    '<div><label style="font-size:0.72rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Proveedor</label>' +
                        '<input type="text" id="proyOcEditProv" class="proy-info-input" value="' + (oc.proveedor || '').replace(/"/g, '&quot;') + '"></div>' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                        '<div><label style="font-size:0.72rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Fecha emisión</label>' +
                            '<input type="date" id="proyOcEditFEmi" class="proy-info-input" value="' + (oc.fecha_emision || '') + '"></div>' +
                        '<div><label style="font-size:0.72rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Entrega esperada</label>' +
                            '<input type="date" id="proyOcEditFEnt" class="proy-info-input" value="' + (oc.fecha_entrega_esperada || '') + '"></div>' +
                    '</div>' +
                    '<div><label style="font-size:0.72rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Estado</label>' +
                        '<select id="proyOcEditStatus" class="proy-info-input">' +
                            ['draft','sent','received','cancelled'].map(function (s) {
                                var labels = { draft: 'Borrador', sent: 'Enviada', received: 'Recibida', cancelled: 'Cancelada' };
                                return '<option value="' + s + '"' + (oc.status === s ? ' selected' : '') + '>' + (labels[s] || s) + '</option>';
                            }).join('') +
                        '</select></div>' +
                    '<div><label style="font-size:0.72rem;font-weight:600;color:#636366;display:block;margin-bottom:4px;">Notas</label>' +
                        '<textarea id="proyOcEditNotas" class="proy-info-input" rows="2">' + (oc.notas || '') + '</textarea></div>' +
                '</div>' +
                '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">' +
                    '<button class="proy-btn proy-btn-outline" onclick="document.getElementById(\'proyDialogoEditarOc\').remove()">Cancelar</button>' +
                    '<button class="proy-btn proy-btn-primary" onclick="proyOcGuardar(' + oc.id + ')">Guardar</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(ov);
    }

    window.proyOcGuardar = function (ocId) {
        var payload = {
            cantidad: parseFloat(document.getElementById('proyOcEditCant').value || 0),
            precio_unitario: parseFloat(document.getElementById('proyOcEditPrecio').value || 0),
            proveedor: document.getElementById('proyOcEditProv').value || '',
            fecha_emision: document.getElementById('proyOcEditFEmi').value || null,
            fecha_entrega_esperada: document.getElementById('proyOcEditFEnt').value || null,
            status: document.getElementById('proyOcEditStatus').value || 'draft',
            notas: document.getElementById('proyOcEditNotas').value || '',
        };
        if (!payload.cantidad || payload.cantidad <= 0) {
            alert('La cantidad debe ser mayor a 0');
            return;
        }
        var csrf = (document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)') || [])[2] || '';
        fetch('/app/api/iamet/oc/' + ocId + '/actualizar/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf, 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.success) {
                var d = document.getElementById('proyDialogoEditarOc');
                if (d) d.remove();
                if (typeof renderPartidas === 'function') renderPartidas(currentProjectId);
            } else {
                alert((j && j.error) || 'No se pudo guardar.');
            }
        }).catch(function () { alert('Error de red.'); });
    };

    function _confirmDeleteOc(oc) {
        var msg = 'Eliminar la orden de compra' + (oc.numero_oc ? ' "' + oc.numero_oc + '"' : '') +
                  '?\n\nLas ' + (oc.cantidad || 0) + ' unidades regresarán al pendiente de la partida.';
        if (!confirm(msg)) return;
        var csrf = (document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)') || [])[2] || '';
        fetch('/app/api/iamet/oc/' + oc.id + '/eliminar/', {
            method: 'DELETE',
            headers: { 'X-CSRFToken': csrf },
            credentials: 'same-origin',
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.success) {
                if (typeof renderPartidas === 'function') renderPartidas(currentProjectId);
            } else {
                alert((j && j.error) || 'No se pudo eliminar.');
            }
        }).catch(function () { alert('Error de red.'); });
    }

    // ── Sync manual de partidas desde la última volumetría ───────
    window.proyPartidasSync = function () {
        if (!currentProjectId) return;
        var csrf = (document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)') || [])[2] || '';
        fetch('/app/api/iamet/proyectos/' + currentProjectId + '/partidas/sync/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf, 'Content-Type': 'application/json' },
            credentials: 'same-origin',
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.success) {
                if (typeof renderPartidas === 'function') renderPartidas(currentProjectId);
                var r = j.resumen || {};
                var vol = j.volumetria || {};
                var msg = 'Sincronizado desde "' + (vol.nombre || ('Vol #' + vol.id)) + '" · ' +
                          (r.creadas || 0) + ' nuevas, ' +
                          (r.actualizadas || 0) + ' actualizadas, ' +
                          (r.eliminadas || 0) + ' eliminadas, ' +
                          (r.preservadas || 0) + ' con OCs preservadas.';
                if (typeof window.lwToast === 'function') window.lwToast(msg, 'ok');
                else alert(msg);
            } else {
                alert((j && j.error) || 'No se pudo sincronizar.');
            }
        }).catch(function () { alert('Error de red al sincronizar.'); });
    };

    // ── Historial de partidas (modal) ────────────────────────────
    window.proyPartidasHistorialAbrir = function () {
        if (!currentProjectId) return;
        var bd = document.getElementById('proyPartidasHistorialBackdrop');
        var body = document.getElementById('proyPartidasHistorialBody');
        if (!bd || !body) return;
        bd.style.display = 'flex';
        _historialBodyCache = null;
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#86868B;">Cargando…</div>';
        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/volumetria-versiones/').then(function (resp) {
            if (!(resp.ok || resp.success) || !Array.isArray(resp.data)) {
                body.innerHTML = '<div style="padding:30px;text-align:center;color:#EF4444;">No se pudo cargar el historial.</div>';
                return;
            }
            var versiones = resp.data;
            if (!versiones.length) {
                body.innerHTML = '<div style="padding:30px;text-align:center;color:#86868B;">' +
                    'Aún no hay versiones registradas. Cada vez que el ingeniero importa una volumetría o marca una como completada, ' +
                    'se guarda un snapshot que aparecerá aquí.' +
                    '</div>';
                return;
            }
            var html = '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;">';
            html += '<thead><tr style="background:#F8F9FB;text-align:left;">' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">Versión</th>' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">Origen</th>' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">Subido por</th>' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">Fecha</th>' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:center;">Partidas</th>' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:right;">Costo</th>' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:right;">Venta</th>' +
                '<th style="padding:10px 12px;font-weight:600;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:right;">Ganancia</th>' +
                '<th style="padding:10px 12px;width:36px;"></th>' +
                '</tr></thead><tbody>';
            versiones.forEach(function (v) {
                var fechaStr = v.fecha ? new Date(v.fecha).toLocaleString('es-MX', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
                var esActual = !!v.is_current;
                html += '<tr style="border-bottom:1px solid rgba(0,0,0,0.04);' + (esActual ? 'background:rgba(0,122,255,0.05);' : '') + '">' +
                    '<td style="padding:12px 12px;font-weight:600;">' + (esActual ? '<span style="color:#007AFF;">Actual</span>' : ('v' + v.version)) + '</td>' +
                    '<td style="padding:12px 12px;color:#48484A;">' + (v.archivo || '—') + '</td>' +
                    '<td style="padding:12px 12px;color:#48484A;">' + (v.subido_por || '—') + '</td>' +
                    '<td style="padding:12px 12px;color:#86868B;">' + fechaStr + '</td>' +
                    '<td style="padding:12px 12px;text-align:center;">' + (v.num_partidas || 0) + '</td>' +
                    '<td style="padding:12px 12px;text-align:right;">' + fmtMoney(v.total_costo || 0) + '</td>' +
                    '<td style="padding:12px 12px;text-align:right;">' + fmtMoney(v.total_venta || 0) + '</td>' +
                    '<td style="padding:12px 12px;text-align:right;color:#10B981;">' + fmtMoney(v.ganancia || 0) + '</td>' +
                    '<td style="padding:12px 12px;text-align:right;white-space:nowrap;">' +
                        (esActual ? '' :
                            '<button class="proy-btn proy-btn-outline" type="button" onclick="proyPartidasPrevisualizar(' + v.version + ')" style="font-size:0.7rem;padding:5px 10px;margin-right:6px;">Previsualizar</button>' +
                            '<button class="proy-btn proy-btn-outline" type="button" onclick="proyPartidasRestaurar(' + v.version + ')" style="font-size:0.7rem;padding:5px 10px;">Restaurar</button>') +
                    '</td>' +
                    '</tr>';
            });
            html += '</tbody></table>';
            body.innerHTML = html;
        }).catch(function () {
            body.innerHTML = '<div style="padding:30px;text-align:center;color:#EF4444;">Error de red.</div>';
        });
    };

    window.proyPartidasHistorialCerrar = function () {
        var bd = document.getElementById('proyPartidasHistorialBackdrop');
        if (bd) bd.style.display = 'none';
        _historialBodyCache = null;
    };

    // Click en backdrop cierra el modal
    document.addEventListener('click', function (e) {
        var bd = document.getElementById('proyPartidasHistorialBackdrop');
        if (bd && e.target === bd) bd.style.display = 'none';
    });

    // Previsualizar las partidas de una versión específica (solo lectura).
    // Reusa el mismo backdrop del Historial pero reemplaza el body con
    // la tabla de partidas snapshot — sin modificar nada en BD.
    var _historialBodyCache = null;
    window.proyPartidasPrevisualizar = function (versionNum) {
        if (!currentProjectId) return;
        var body = document.getElementById('proyPartidasHistorialBody');
        if (!body) return;
        if (_historialBodyCache === null) _historialBodyCache = body.innerHTML;
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#86868B;">Cargando…</div>';

        _fetch('/app/api/iamet/proyectos/' + currentProjectId + '/volumetria-versiones/').then(function (resp) {
            if (!(resp.ok || resp.success) || !Array.isArray(resp.data)) {
                body.innerHTML = '<div style="padding:30px;text-align:center;color:#EF4444;">No se pudo cargar la versión.</div>';
                return;
            }
            var v = resp.data.filter(function (x) { return x.version === versionNum && !x.is_current; })[0];
            if (!v) {
                body.innerHTML = '<div style="padding:30px;text-align:center;color:#EF4444;">Versión no encontrada.</div>';
                return;
            }
            var partidas = v.partidas_json || [];
            var fechaStr = v.fecha ? new Date(v.fecha).toLocaleString('es-MX', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

            var html = '';
            // Header con back + datos de la versión + acciones
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:12px;flex-wrap:wrap;">';
            html += '<div style="display:flex;align-items:center;gap:10px;">';
            html += '<button type="button" onclick="proyPartidasHistorialVolver()" class="proy-btn proy-btn-outline" style="font-size:0.74rem;display:inline-flex;align-items:center;gap:4px;padding:5px 10px;">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>' +
                    'Volver al historial</button>';
            html += '<div>';
            html += '<div style="font-size:0.95rem;font-weight:700;">Vista previa · v' + v.version + '</div>';
            html += '<div style="font-size:0.72rem;color:#86868B;">' + (v.archivo || 'Sin nombre') + ' · ' + (v.subido_por || '—') + ' · ' + fechaStr + '</div>';
            html += '</div></div>';
            html += '<button type="button" class="proy-btn proy-btn-primary" onclick="proyPartidasRestaurar(' + v.version + ')" style="font-size:0.74rem;padding:6px 14px;">Restaurar esta versión</button>';
            html += '</div>';

            // Resumen de totales
            html += '<div style="display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap;">';
            html += '<div style="flex:1;min-width:130px;padding:10px 14px;background:#F8F9FB;border-radius:10px;"><div style="font-size:0.65rem;color:#86868B;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Partidas</div><div style="font-size:1.1rem;font-weight:700;margin-top:2px;">' + (v.num_partidas || partidas.length) + '</div></div>';
            html += '<div style="flex:1;min-width:130px;padding:10px 14px;background:#F8F9FB;border-radius:10px;"><div style="font-size:0.65rem;color:#86868B;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Costo total</div><div style="font-size:1.1rem;font-weight:700;margin-top:2px;">' + fmtMoney(v.total_costo || 0) + '</div></div>';
            html += '<div style="flex:1;min-width:130px;padding:10px 14px;background:#F8F9FB;border-radius:10px;"><div style="font-size:0.65rem;color:#86868B;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Venta total</div><div style="font-size:1.1rem;font-weight:700;margin-top:2px;">' + fmtMoney(v.total_venta || 0) + '</div></div>';
            html += '<div style="flex:1;min-width:130px;padding:10px 14px;background:#ECFDF5;border-radius:10px;"><div style="font-size:0.65rem;color:#047857;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Ganancia</div><div style="font-size:1.1rem;font-weight:700;margin-top:2px;color:#10B981;">' + fmtMoney(v.ganancia || 0) + '</div></div>';
            html += '</div>';

            // Tabla de partidas snapshot (solo lectura)
            if (!partidas.length) {
                html += '<div style="padding:30px;text-align:center;color:#86868B;border:1px dashed #E5E7EB;border-radius:10px;">Esta versión quedó sin partidas.</div>';
            } else {
                html += '<div style="overflow-x:auto;border:1px solid rgba(0,0,0,0.06);border-radius:10px;">';
                html += '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;">';
                html += '<thead><tr style="background:#F8F9FB;text-align:left;border-bottom:1px solid rgba(0,0,0,0.06);">' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">Categoría</th>' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">Descripción</th>' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">Marca</th>' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;">No. Parte</th>' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:center;">Cant.</th>' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:right;">Costo Un.</th>' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:right;">P. Venta</th>' +
                    '<th style="padding:10px 12px;font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#48484A;text-align:right;">Ganancia</th>' +
                    '</tr></thead><tbody>';
                partidas.forEach(function (p) {
                    var ganancia = p.ganancia != null ? p.ganancia : ((p.precio_venta_unitario || 0) - (p.costo_unitario || 0)) * (p.cantidad || 0);
                    html += '<tr style="border-bottom:1px solid rgba(0,0,0,0.04);">' +
                        '<td style="padding:11px 12px;">' + (p.categoria || '—') + '</td>' +
                        '<td style="padding:11px 12px;" title="' + (p.descripcion || '') + '">' + truncate(p.descripcion || '—', 38) + '</td>' +
                        '<td style="padding:11px 12px;">' + (p.marca || '—') + '</td>' +
                        '<td style="padding:11px 12px;font-size:0.72rem;color:#aeaeb2;">' + (p.numero_parte || '—') + '</td>' +
                        '<td style="padding:11px 12px;text-align:center;">' + (p.cantidad || 0) + '</td>' +
                        '<td style="padding:11px 12px;text-align:right;">' + fmtMoney(p.costo_unitario || 0) + '</td>' +
                        '<td style="padding:11px 12px;text-align:right;">' + fmtMoney(p.precio_venta_unitario || 0) + '</td>' +
                        '<td style="padding:11px 12px;text-align:right;color:#10B981;">' + fmtMoney(ganancia) + '</td>' +
                        '</tr>';
                });
                html += '</tbody></table></div>';
            }
            body.innerHTML = html;
        }).catch(function () {
            body.innerHTML = '<div style="padding:30px;text-align:center;color:#EF4444;">Error de red.</div>';
        });
    };

    // Volver del preview al listado de versiones
    window.proyPartidasHistorialVolver = function () {
        var body = document.getElementById('proyPartidasHistorialBody');
        if (!body) return;
        if (_historialBodyCache !== null) {
            body.innerHTML = _historialBodyCache;
            _historialBodyCache = null;
        } else {
            // Fallback: re-fetchea desde cero
            window.proyPartidasHistorialAbrir();
        }
    };

    window.proyPartidasRestaurar = function (versionNum) {
        if (!currentProjectId) return;
        if (!confirm('¿Restaurar las partidas a la versión v' + versionNum + '?\n\nEl estado actual quedará guardado en el historial como una versión nueva, así que esta acción es reversible.')) return;
        var csrf = (document.cookie.match('(^|;)\\s*csrftoken\\s*=\\s*([^;]+)') || [])[2] || '';
        fetch('/app/api/iamet/proyectos/' + currentProjectId + '/restaurar-version/', {
            method: 'POST',
            headers: { 'X-CSRFToken': csrf, 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ version: versionNum }),
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.ok) {
                window.proyPartidasHistorialCerrar();
                if (typeof renderPartidas === 'function') renderPartidas(currentProjectId);
                alert('Partidas restauradas a la versión v' + versionNum + '.');
            } else {
                alert((j && j.error) || 'No se pudo restaurar.');
            }
        }).catch(function () { alert('Error de red al restaurar.'); });
    };

    // Auto-abrir el detalle si la URL trae ?open_proyecto=N. Esto permite
    // compartir un link directo al proyecto (botón Compartir).
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            setTimeout(window.proyectosOpenFromUrl, 500);
        });
    } else {
        setTimeout(window.proyectosOpenFromUrl, 500);
    }

})();

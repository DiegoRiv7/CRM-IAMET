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
        if (hName) hName.textContent = (project && project.nombre) || (ov && ov.nombre) || '';

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
            } else {
                oppChip.style.display = 'none';
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
    // ?open_proyecto=N. Espera a que el listado termine de cargar para
    // que proyectosVerDetalle pueda hidratar el estado correctamente.
    window.proyectosOpenFromUrl = function() {
        try {
            var qs = window.location.search;
            var m = qs.match(/[?&]open_proyecto=(\d+)/);
            if (!m) return;
            var pid = parseInt(m[1], 10);
            if (!pid) return;
            // Esperamos un tick para que el DOM del proyecto esté listo
            setTimeout(function () {
                if (typeof window.proyectosVerDetalle === 'function') {
                    window.proyectosVerDetalle(pid);
                }
                // Limpiar el query param sin reload para no re-disparar
                try {
                    var newUrl = window.location.pathname + qs.replace(/[?&]open_proyecto=\d+/, '').replace(/^&/, '?');
                    if (newUrl.endsWith('?')) newUrl = newUrl.slice(0, -1);
                    window.history.replaceState({}, '', newUrl);
                } catch (e) {}
            }, 200);
        } catch (e) { /* noop */ }
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

    window.proyectosVerDetalle = function(projectId) {
        currentProjectId = projectId;
        currentTab = 'partidas';

        // Open the detail overlay + lock body scroll
        var overlay = el('widgetProyectoDetalle');
        if (overlay) overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

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

        proyectosSetTab('partidas');
    };

    window.proyectosVolverLista = function() {
        currentProjectId = null;
        // Close the detail overlay + unlock body scroll
        var overlay = el('widgetProyectoDetalle');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
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

    window.proyectosSetTab = function(tabName) {
        currentTab = tabName;

        // Toggle tab buttons
        var tabs = document.querySelectorAll('.proy-tab-btn');
        tabs.forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
        });

        // Hide all panes
        var panes = document.querySelectorAll('.proy-tab-pane');
        panes.forEach(function(pane) {
            pane.style.display = 'none';
        });

        // Show the selected pane
        var activePane = el('proyPane_' + tabName);
        if (activePane) activePane.style.display = '';

        // Render data
        if (!currentProjectId) return;
        switch (tabName) {
            case 'info':       renderInfo(); break;
            case 'partidas':   renderLevantamientos(currentProjectId); break;
            case 'financiero': renderFinanciero(currentProjectId); break;
            case 'programa':   renderProgramaObra(currentProjectId); break;
            case 'tareas':     renderTareas(currentProjectId); break;
            case 'drive':      _renderDrive(currentProjectId); break;
        }

        // Update KPIs based on active tab
        if (tabName === 'partidas' || tabName === 'programa') {
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
                    container.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:40px;color:#8e8e93">No hay partidas registradas</td></tr>';
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

                    html += '<tr class="proy-partida-row" data-partida-idx="' + idx + '">' +
                        '<td>' + categoryDot(item.categoria) + (item.categoria || '\u2014') + '</td>' +
                        '<td title="' + (item.descripcion || '') + '">' + truncate(item.descripcion, 28) + '</td>' +
                        '<td>' + (item.marca || '\u2014') + '</td>' +
                        '<td style="font-size:0.72rem;color:#aeaeb2">' + (item.numero_parte || '\u2014') + '</td>' +
                        '<td style="text-align:center">' + (item.cantidad || 0) + '</td>' +
                        '<td style="text-align:center;color:' + ((item.cantidad_pendiente || 0) > 0 ? '#f59e0b' : '#10b981') + '">' + (item.cantidad_pendiente || 0) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(item.precio_lista) + '</td>' +
                        '<td style="text-align:center">' + (item.descuento || 0) + '%</td>' +
                        '<td style="text-align:right">' + fmtMoney(item.costo_unitario) + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(item.precio_venta_unitario) + '</td>' +
                        '<td style="text-align:right;color:#10b981">' + fmtMoney(totalProfit) + '</td>' +
                        '<td>' + truncate(item.proveedor, 16) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(item.status) + '">' + statusLabel(item.status) + '</span></td>' +
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
                            html += '<div style="display:flex;align-items:center;gap:12px;font-size:0.75rem;color:#636366;padding:4px 8px;border-radius:6px;background:rgba(0,122,255,0.04);">' +
                                '<span style="color:#007aff;font-weight:600;">' + (oc.numero_oc || 'OC') + '</span>' +
                                '<span>' + (oc.cantidad || 0) + ' uds</span>' +
                                '<span>' + (oc.proveedor || '\u2014') + '</span>' +
                                '<span class="proy-badge ' + statusClass(oc.status) + '" style="font-size:0.68rem;padding:1px 6px;">' + statusLabel(oc.status) + '</span>' +
                                '<span style="color:#8e8e93;">' + fmtDate(oc.fecha_emision) + '</span>' +
                                '<span style="margin-left:auto;font-weight:600;">' + fmtMoney(ocAmount) + '</span>' +
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
    //  RENDER: PROGRAMA DE OBRA
    // =========================================

    // opts (opcional): { containerId, projectDetail }
    //   containerId  — ID alternativo donde renderizar (default: 'proyProgramaContainer')
    //   projectDetail — usa estos datos en lugar de _cachedProjectDetail (útil cuando
    //                   el wizard del levantamiento llama esta función sin haber
    //                   pasado por proyectosVerDetalle primero).
    function renderProgramaObra(projectId, opts) {
        opts = opts || {};
        var containerId = opts.containerId || 'proyProgramaContainer';
        var container = el(containerId);
        if (!container) return;

        var detail = opts.projectDetail || _cachedProjectDetail;
        if (!detail || !detail.fecha_inicio || !detail.fecha_fin) {
            container.innerHTML = '<div style="text-align:center;color:#8e8e93;padding:40px;">Define las fechas de inicio y fin del proyecto para usar el Programa de Obra</div>';
            return;
        }
        // Mantener _cachedProjectDetail sincronizado para que _openActividadForm
        // y el guardado puedan usar detail.nombre, etc.
        if (opts.projectDetail) { _cachedProjectDetail = detail; currentProjectId = projectId; }

        // Calculate weeks from fecha_inicio to fecha_fin
        var start = new Date(detail.fecha_inicio);
        var end = new Date(detail.fecha_fin);
        // Adjust to Monday of the start week
        var dayOfWeek = start.getDay();
        var mondayStart = new Date(start);
        mondayStart.setDate(start.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

        var weeks = [];
        var current = new Date(mondayStart);
        var weekNum = 1;
        while (current <= end) {
            var weekStart = new Date(current);
            var weekEnd = new Date(current);
            weekEnd.setDate(weekEnd.getDate() + 6);
            weeks.push({ num: weekNum, start: weekStart, end: weekEnd });
            current.setDate(current.getDate() + 7);
            weekNum++;
        }

        // State
        var currentWeekIdx = 0;
        var showWeekend = false;

        function renderWeek() {
            var week = weeks[currentWeekIdx];
            if (!week) return;

            var fmtShort = function(d) {
                var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
                return d.getDate() + ' ' + months[d.getMonth()];
            };

            var days = ['Lunes','Martes','\u004Di\u00E9rcoles','Jueves','Viernes'];
            if (showWeekend) days.push('S\u00E1bado', 'Domingo');

            var html = '';
            // Navigation header
            html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;margin-bottom:12px;">';
            html += '<button onclick="proyProgramaPrev()" style="background:none;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:1rem;color:#1d1d1f;' + (currentWeekIdx === 0 ? 'opacity:0.3;pointer-events:none;' : '') + '">\u2190</button>';
            html += '<div style="text-align:center;"><div style="font-weight:700;font-size:0.95rem;">Semana ' + week.num + '</div>';
            html += '<div style="font-size:0.75rem;color:#6E6E73;">' + fmtShort(week.start) + ' \u2014 ' + fmtShort(new Date(week.start.getTime() + 4*86400000)) + '</div></div>';
            html += '<button onclick="proyProgramaNext()" style="background:none;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:1rem;color:#1d1d1f;' + (currentWeekIdx >= weeks.length - 1 ? 'opacity:0.3;pointer-events:none;' : '') + '">\u2192</button>';
            html += '</div>';

            // Toggle weekend button
            html += '<div style="text-align:right;margin-bottom:8px;"><button onclick="proyProgramaToggleWeekend()" style="font-size:0.72rem;background:none;border:1px solid #e5e7eb;border-radius:6px;padding:4px 10px;cursor:pointer;color:#6B7280;">' + (showWeekend ? 'Ocultar fin de semana' : 'Mostrar fin de semana') + '</button></div>';

            // Day columns
            html += '<div style="display:grid;grid-template-columns:repeat(' + days.length + ',1fr);gap:8px;">';
            days.forEach(function(dayName, i) {
                var dayDate = new Date(week.start);
                dayDate.setDate(dayDate.getDate() + i);
                var dateStr = dayDate.toISOString().split('T')[0];
                var isToday = dateStr === new Date().toISOString().split('T')[0];

                html += '<div style="border:1px solid ' + (isToday ? '#007AFF' : '#e5e7eb') + ';border-radius:10px;min-height:200px;padding:8px;">';
                html += '<div style="font-size:0.72rem;font-weight:700;color:' + (isToday ? '#007AFF' : '#6E6E73') + ';text-transform:uppercase;margin-bottom:4px;">' + dayName + '</div>';
                html += '<div style="font-size:0.68rem;color:#9CA3AF;margin-bottom:8px;">' + fmtShort(dayDate) + '</div>';
                html += '<div id="proyProgDay_' + dateStr + '">';
                html += '</div>';
                html += '<button onclick="proyProgramaAddActivity(\'' + dateStr + '\')" style="width:100%;padding:6px;border:1px dashed #D1D5DB;border-radius:8px;background:none;color:#9CA3AF;font-size:0.72rem;cursor:pointer;margin-top:4px;">+ A\u00F1adir</button>';
                html += '</div>';
            });
            html += '</div>';

            container.innerHTML = html;

            // Load activities for this week
            _fetch('/app/api/programacion/actividades/?proyecto_key=proy_' + projectId).then(function(resp) {
                if (!resp.success) return;
                var items = resp.items || [];
                // Group by date
                items.forEach(function(act) {
                    if (!act.fecha) return;
                    var dayEl = document.getElementById('proyProgDay_' + act.fecha);
                    if (!dayEl) return;
                    var respHtml = (act.responsables || []).map(function(r) {
                        return '<span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:#007AFF;color:#fff;font-size:0.55rem;line-height:20px;text-align:center;margin-right:2px;" title="' + r.nombre + '">' + r.iniciales + '</span>';
                    }).join('');
                    var completed = act.completada === true;
                    var cardBg = '#F0F7FF';
                    var cardBorder = '#BFDBFE';
                    var cardColor = '#1E40AF';
                    var cardOpacity = completed ? '0.42' : '1';
                    var checkIcon = completed
                        ? '<span style="display:inline-block;margin-right:4px;color:#059669;font-weight:800;">&#10003;</span>'
                        : '';
                    var tituloStyle = completed ? 'text-decoration:line-through;' : '';
                    var card = document.createElement('div');
                    card.style.cssText = 'background:' + cardBg + ';border:1px solid ' + cardBorder + ';border-radius:8px;padding:6px 8px;margin-bottom:4px;font-size:0.7rem;cursor:pointer;transition:transform 0.15s, box-shadow 0.15s, opacity 0.2s;opacity:' + cardOpacity + ';';
                    card.setAttribute('data-act-id', act.id);
                    card.onmouseover = function() { this.style.transform = 'translateY(-1px)'; this.style.boxShadow = '0 4px 10px rgba(0,0,0,0.08)'; if (completed) this.style.opacity = '0.85'; };
                    card.onmouseout = function() { this.style.transform = ''; this.style.boxShadow = ''; if (completed) this.style.opacity = '0.42'; };
                    card.onclick = function() { window.proyectosVerActividadDetalle(act.id); };
                    card.innerHTML = '<div style="font-weight:600;color:' + cardColor + ';margin-bottom:2px;' + tituloStyle + '">' + checkIcon + act.titulo + '</div>' +
                        '<div style="display:flex;align-items:center;justify-content:space-between;">' +
                            '<span style="color:#6B7280;">' + act.hora_inicio + ' - ' + act.hora_fin + '</span>' +
                            '<div>' + respHtml + '</div>' +
                        '</div>';
                    dayEl.appendChild(card);
                });
            });
        }

        // Navigation functions
        window.proyProgramaPrev = function() { if (currentWeekIdx > 0) { currentWeekIdx--; renderWeek(); } };
        window.proyProgramaNext = function() { if (currentWeekIdx < weeks.length - 1) { currentWeekIdx++; renderWeek(); } };
        window.proyProgramaToggleWeekend = function() { showWeekend = !showWeekend; renderWeek(); };
        window.proyProgramaAddActivity = function(dateStr) { _openActividadForm(dateStr); };

        renderWeek();
    }

    // Exponer para reutilización desde el wizard del levantamiento.
    window.proyectosRenderProgramaObra = renderProgramaObra;


    // =========================================
    //  ACTIVIDAD FORM (PROGRAMA DE OBRA)
    // =========================================

    var _actividadFechaSeleccionada = null;
    var _actividadSelectedUsers = {};

    function _getDayNameSpanish(dateStr) {
        var d = new Date(dateStr + 'T12:00:00');
        var names = ['Domingo','Lunes','Martes','Mi\u00E9rcoles','Jueves','Viernes','S\u00E1bado'];
        return names[d.getDay()];
    }

    function _fmtDateLong(dateStr) {
        var d = new Date(dateStr + 'T12:00:00');
        var months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return d.getDate() + ' de ' + months[d.getMonth()] + ' de ' + d.getFullYear();
    }

    function _openActividadForm(dateStr) {
        _actividadFechaSeleccionada = dateStr;
        _actividadSelectedUsers = {};

        // Set date label
        var label = el('proyActFechaLabel');
        if (label) label.textContent = _getDayNameSpanish(dateStr) + ', ' + _fmtDateLong(dateStr);

        // Reset form fields
        if (el('proyActTitulo')) el('proyActTitulo').value = '';
        if (el('proyActDescripcion')) el('proyActDescripcion').value = '';
        if (el('proyActHoraInicio')) el('proyActHoraInicio').value = '07:00';
        if (el('proyActHoraFin')) el('proyActHoraFin').value = '16:00';
        if (el('proyActVehiculos')) el('proyActVehiculos').value = '';

        // Show dialog
        var d = el('proyDialogoActividad');
        if (d) d.style.display = 'flex';

        // Load availability
        _loadPersonalDisponibilidad(dateStr);

        // Re-load on time change
        var hiEl = el('proyActHoraInicio');
        var hfEl = el('proyActHoraFin');
        if (hiEl) hiEl.onchange = function() { _loadPersonalDisponibilidad(dateStr); };
        if (hfEl) hfEl.onchange = function() { _loadPersonalDisponibilidad(dateStr); };
    }

    function _loadPersonalDisponibilidad(dateStr) {
        var container = el('proyActPersonalList');
        if (!container) return;

        container.innerHTML = '<div style="text-align:center;padding:16px;color:#8e8e93;font-size:0.8rem;">Cargando disponibilidad...</div>';

        var horaInicio = el('proyActHoraInicio') ? el('proyActHoraInicio').value : '07:00';
        var horaFin = el('proyActHoraFin') ? el('proyActHoraFin').value : '16:00';
        var diaSemana = _getDayNameSpanish(dateStr);

        var url = '/app/api/programacion/disponibilidad/?dia_semana=' + encodeURIComponent(diaSemana) +
            '&hora_inicio=' + encodeURIComponent(horaInicio) +
            '&hora_fin=' + encodeURIComponent(horaFin) +
            '&fecha=' + encodeURIComponent(dateStr);

        _fetch(url).then(function(resp) {
            if (!resp.success && !resp.ok) {
                container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:0.8rem;">Error al cargar personal</div>';
                return;
            }
            var users = resp.usuarios || resp.data || [];
            if (users.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:16px;color:#8e8e93;font-size:0.8rem;">No hay personal registrado</div>';
                return;
            }

            var html = '';
            users.forEach(function(u) {
                var available = u.disponible !== false;
                var conflict = u.conflicto || u.conflict || '';
                var checked = _actividadSelectedUsers[u.id] ? ' checked' : '';
                var opacity = available ? '1' : '0.5';

                html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:' + (available ? 'pointer' : 'default') + ';opacity:' + opacity + ';transition:background 0.15s;" ' +
                    'onmouseover="this.style.background=\'#F5F5F7\'" onmouseout="this.style.background=\'transparent\'">' +
                    '<input type="checkbox" value="' + u.id + '"' + checked + (available ? '' : ' disabled') +
                    ' onchange="proyActToggleUser(' + u.id + ', this.checked)" ' +
                    'style="width:16px;height:16px;accent-color:#007AFF;flex-shrink:0;">' +
                    '<div style="width:28px;height:28px;border-radius:50%;background:' + (available ? '#007AFF' : '#D1D5DB') + ';color:#fff;font-size:0.6rem;line-height:28px;text-align:center;flex-shrink:0;font-weight:600;">' + (u.iniciales || u.initials || '??') + '</div>' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:0.8rem;font-weight:500;color:#1D1D1F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (u.nombre || u.name || 'Usuario ' + u.id) + '</div>' +
                        (conflict ? '<div style="font-size:0.68rem;color:#EF4444;margin-top:1px;">' + conflict + '</div>' : '') +
                        (available && !conflict ? '<div style="font-size:0.68rem;color:#10B981;margin-top:1px;">Disponible</div>' : '') +
                    '</div>' +
                '</label>';
            });

            container.innerHTML = html;
        }).catch(function(err) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444;font-size:0.8rem;">Error de conexion</div>';
            console.error('Error cargando disponibilidad:', err);
        });
    }

    window.proyActToggleUser = function(userId, checked) {
        if (checked) {
            _actividadSelectedUsers[userId] = true;
        } else {
            delete _actividadSelectedUsers[userId];
        }
    };

    window.proyectosGuardarActividad = function() {
        if (!currentProjectId) return;

        var titulo = el('proyActTitulo') ? el('proyActTitulo').value.trim() : '';
        if (!titulo) {
            el('proyActTitulo').style.borderColor = '#FF3B30';
            el('proyActTitulo').focus();
            return;
        }
        el('proyActTitulo').style.borderColor = '';

        var horaInicio = el('proyActHoraInicio') ? el('proyActHoraInicio').value : '07:00';
        var horaFin = el('proyActHoraFin') ? el('proyActHoraFin').value : '16:00';
        var diaSemana = _getDayNameSpanish(_actividadFechaSeleccionada);

        var responsables = Object.keys(_actividadSelectedUsers).map(function(k) { return parseInt(k); });

        // Nombre real del proyecto (si se cargo el detalle), si no fallback a la key
        var proyectoNombre = (_cachedProjectDetail && _cachedProjectDetail.nombre)
            ? _cachedProjectDetail.nombre
            : ('proy_' + currentProjectId);

        var payload = {
            proyecto_key: 'proy_' + currentProjectId,
            proyecto_titulo: proyectoNombre,
            titulo: titulo,
            dia_semana: diaSemana,
            hora_inicio: horaInicio,
            hora_fin: horaFin,
            fecha: _actividadFechaSeleccionada,
            responsables: responsables
        };

        // Include optional fields if filled
        var desc = el('proyActDescripcion') ? el('proyActDescripcion').value.trim() : '';
        if (desc) payload.descripcion = desc;

        var vehiculos = el('proyActVehiculos') ? el('proyActVehiculos').value.trim() : '';
        if (vehiculos) payload.vehiculos = vehiculos;

        // Disable button while submitting
        var btn = el('proyActBtnCrear');
        if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }

        _fetch('/app/api/programacion/actividades/', {
            method: 'POST',
            body: payload
        }).then(function(resp) {
            if (btn) { btn.disabled = false; btn.textContent = 'Crear Actividad'; }

            if (resp.ok || resp.success) {
                proyectosCerrarDialogo('proyDialogoActividad');
                // Re-render programa de obra to show new activity
                renderProgramaObra(currentProjectId);
                // Show toast
                _showToast('Actividad creada');
            } else {
                alert('Error al crear actividad: ' + (resp.error || 'Error desconocido'));
            }
        }).catch(function(err) {
            if (btn) { btn.disabled = false; btn.textContent = 'Crear Actividad'; }
            alert('Error de conexion al crear actividad');
            console.error('Error creando actividad:', err);
        });
    };

    function _showToast(message) {
        var existing = document.getElementById('proyToast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'proyToast';
        toast.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:#1D1D1F;color:#fff;padding:12px 24px;border-radius:12px;font-size:0.85rem;font-weight:600;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.2);transition:opacity 0.3s;';
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

    function renderFinanciero(projectId) {
        renderOC(projectId);
        renderSupplierInvoices(projectId);
        renderRevenueInvoices(projectId);
        renderExpenses(projectId);
    }

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

        container.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#8e8e93">Cargando...</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/facturas-ingreso/').then(function(resp) {
            if (resp.ok || resp.success) {
                var invoices = resp.data || [];
                if (invoices.length === 0) {
                    container.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#8e8e93">No hay facturas de ingreso</td></tr>';
                    var foot = el('proyFacIngFoot');
                    if (foot) foot.innerHTML = '';
                    return;
                }

                var html = '';
                var total = 0;
                invoices.forEach(function(inv) {
                    var amount = inv.monto || 0;
                    total += amount;
                    html += '<tr>' +
                        '<td style="font-weight:600;color:#007aff">' + (inv.numero_factura || '\u2014') + '</td>' +
                        '<td style="text-align:right">' + fmtMoney(amount) + '</td>' +
                        '<td><span class="proy-badge ' + statusClass(inv.status || inv.metodo_pago || 'emitted') + '">' + statusLabel(inv.status || inv.metodo_pago || 'emitted') + '</span></td>' +
                        '<td>' + fmtDate(inv.fecha_factura) + '</td>' +
                        '<td style="text-align:center">' + _btnEliminarIcon('proyFinEliminarFacturaIngreso(' + inv.id + ')') + '</td>' +
                    '</tr>';
                });

                container.innerHTML = html;

                var foot = el('proyFacIngFoot');
                if (foot) {
                    foot.innerHTML = '<tr style="font-weight:600;border-top:2px solid rgba(0,0,0,0.1)">' +
                        '<td style="text-align:right;color:#8e8e93">Total</td>' +
                        '<td style="text-align:right">' + fmtMoney(total) + '</td>' +
                        '<td colspan="3"></td>' +
                    '</tr>';
                }
            } else {
                container.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#ef4444">Error al cargar facturas</td></tr>';
                console.error('Error cargando facturas ingreso:', resp.error);
            }
        }).catch(function(err) {
            container.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:#ef4444">Error de conexion</td></tr>';
            console.error('Error de red cargando facturas ingreso:', err);
        });
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
        // Close detail overlay when clicking on its backdrop
        if (e.target && e.target.id === 'widgetProyectoDetalle') {
            proyectosVolverLista();
        }
        // Close sub-dialogs when clicking on their backdrop
        if (e.target && e.target.classList.contains('proy-dialog-overlay')) {
            e.target.style.display = 'none';
        }
    });


    // =========================================
    //  MAIN TABS: Dashboard / Programa / Financiero
    // =========================================

    window.proySetMainTab = function(tab) {
        _currentMainTab = tab;
        // Toggle tab buttons
        document.querySelectorAll('.proy-main-tab').forEach(function(btn) {
            var isActive = btn.getAttribute('data-tab') === tab;
            btn.style.background = isActive ? '#fff' : '#f9fafb';
            btn.style.color = isActive ? '#007AFF' : '#6B7280';
            btn.style.fontWeight = isActive ? '600' : '500';
            btn.style.borderBottom = isActive ? '2px solid #007AFF' : '2px solid transparent';
            btn.classList.toggle('active', isActive);
        });
        // Toggle tab content
        var tabs = ['Dashboard', 'Programa', 'Financiero'];
        tabs.forEach(function(t) {
            var panel = el('proyTab' + t);
            if (panel) panel.style.display = t.toLowerCase() === tab ? '' : 'none';
        });
        // Topbar lateral (Filtro/Ordenar/Buscar/+Nuevo) solo aplica al tab "Proyectos".
        var isPrograma = (tab === 'programa');
        var topLeft = el('proyTopbarLeft');
        var topRight = el('proyTopbarRight');
        if (topLeft) topLeft.style.display = isPrograma ? '' : 'none';
        if (topRight) topRight.style.display = isPrograma ? '' : 'none';
        // Load data for the active tab
        if (tab === 'dashboard') _loadDashboard();
        else if (tab === 'programa') proyectosCargarLista();
        else if (tab === 'financiero') _loadFinanciero('active');
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

    function renderLevantamientos(projectId) {
        var body = el('levListBody');
        var emptyEl = el('levListEmpty');
        if (!body) return;
        body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:#94A3B8;font-size:12.5px;">Cargando levantamientos…</td></tr>';

        _fetch('/app/api/iamet/proyectos/' + projectId + '/levantamientos/').then(function (resp) {
            if (!(resp.ok || resp.success)) {
                body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:#EF4444;font-size:12.5px;">Error cargando: ' + _esc(resp.error || '') + '</td></tr>';
                return;
            }
            var items = resp.data || [];
            _cachedLevantamientos = items;
            if (items.length === 0) {
                body.innerHTML = '';
                if (emptyEl) emptyEl.style.display = '';
                return;
            }
            if (emptyEl) emptyEl.style.display = 'none';
            var html = items.map(function (l) {
                var fecha = _fmtShortDate(l.fecha_actualizacion || l.fecha_creacion);
                var creador = l.creado_por_nombre || '—';
                var faseLbl = 'Fase ' + (l.fase_actual || 1) + '/5';
                // Usamos JSON.stringify para quotear el id — sirve para ints
                // del servidor Y para strings 'offline:<uuid>' del PWA offline.
                var idArg = JSON.stringify(l.id);
                return '<tr class="lev-row" onclick="levantamientoAbrir(' + idArg + ')">' +
                    '<td><div class="lev-row-name">' + _esc(l.nombre || 'Sin nombre') +
                        (l._offline ? ' <span style="background:#FEF3C7;color:#92400E;font-size:10px;font-weight:700;padding:2px 6px;border-radius:100px;margin-left:6px;">Sin subir</span>' : '') +
                        '</div></td>' +
                    '<td>' + _statusPillHtml(l.status, l.status_label) + '</td>' +
                    '<td><span class="lev-row-fase">' + faseLbl + '</span></td>' +
                    '<td><span class="lev-row-creador">' + _esc(creador) + '</span></td>' +
                    '<td class="date"><span class="proy-tv2-fecha">' + fecha + '</span></td>' +
                    '<td><button class="lev-row-del" title="Eliminar" onclick="event.stopPropagation(); levantamientoEliminar(' + idArg + ')">' +
                    '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                    '</button></td>' +
                    '</tr>';
            }).join('');
            body.innerHTML = html;
        }).catch(function (err) {
            console.error('Error levantamientos:', err);
            body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:#EF4444;font-size:12.5px;">Error de red</td></tr>';
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
            if (resp.ok || resp.success) {
                if (typeof window.levantamientoWizardOpen === 'function') {
                    window.levantamientoWizardOpen(resp.data);
                }
            } else {
                if (typeof showToast === 'function') showToast(resp.error || 'No se pudo abrir', 'error');
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

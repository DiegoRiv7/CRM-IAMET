// crm_prospectos_kanban.js — Kanban de Prospectos (tab=prospectos)
(function() {
    'use strict';

    var kanbanRoot = document.getElementById('pkKanban');
    if (!kanbanRoot) return; // Solo corre en tab=prospectos

    var ETAPA_TO_COL = {
        'identificado':     { body: 'pkColIdentificado', count: 'pkCountIdentificado' },
        'calificado':       { body: 'pkColCalificado',   count: 'pkCountCalificado' },
        'reunion':          { body: 'pkColReunion',      count: 'pkCountReunion' },
        'en_progreso':      { body: 'pkColEnProgreso',   count: 'pkCountEnProgreso' },
        'procesado':        { body: 'pkColProcesado',    count: 'pkCountProcesado' },
        'cerrado_ganado':   { body: 'pkColCerrado',      count: 'pkCountCerrado' }
    };

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(String(text)));
        return div.innerHTML;
    }

    function getInitials(name) {
        if (!name) return '??';
        var parts = String(name).trim().split(/\s+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return (parts[0][0] || '?').toUpperCase();
    }

    function tipoChipClass(tipo) {
        return tipo === 'proyecto' ? 'pk-card-chip--proyecto' : 'pk-card-chip--runrate';
    }

    function tipoLabel(tipo) {
        return tipo === 'proyecto' ? 'Proyecto' : 'Runrate';
    }

    function renderCard(p) {
        var ownerName = p.usuario_nombre || '';
        var avatarText = getInitials(ownerName);
        return '<div class="pk-card" data-prospecto-id="' + p.id + '">' +
            '<div class="pk-card-title">' + escapeHtml(p.nombre || '(sin título)') + '</div>' +
            '<div class="pk-card-cliente" title="' + escapeHtml(p.cliente) + '">' +
                '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>' +
                escapeHtml(p.cliente || '- Sin Cliente -') +
            '</div>' +
            '<div class="pk-card-meta">' +
                '<span class="pk-card-chip ' + tipoChipClass(p.tipo_pipeline) + '">' + tipoLabel(p.tipo_pipeline) + '</span>' +
                (p.producto ? '<span class="pk-card-chip">' + escapeHtml(p.producto) + '</span>' : '') +
            '</div>' +
            '<div class="pk-card-footer">' +
                '<div class="pk-card-owner" title="' + escapeHtml(ownerName) + '">' +
                    '<span class="pk-card-avatar">' + avatarText + '</span>' +
                    '<span class="pk-card-owner-name">' + escapeHtml(ownerName) + '</span>' +
                '</div>' +
                '<span class="pk-card-fecha">' + escapeHtml(p.fecha_iso || '') + '</span>' +
            '</div>' +
        '</div>';
    }

    function renderKanban(prospectos) {
        // Resetear columnas
        Object.keys(ETAPA_TO_COL).forEach(function(etapa) {
            var body = document.getElementById(ETAPA_TO_COL[etapa].body);
            if (body) body.innerHTML = '';
        });

        // Agrupar por etapa
        var grupos = {};
        Object.keys(ETAPA_TO_COL).forEach(function(e) { grupos[e] = []; });
        (prospectos || []).forEach(function(p) {
            if (grupos.hasOwnProperty(p.etapa)) {
                grupos[p.etapa].push(p);
            }
        });

        // Renderizar
        Object.keys(ETAPA_TO_COL).forEach(function(etapa) {
            var items = grupos[etapa];
            var body = document.getElementById(ETAPA_TO_COL[etapa].body);
            var countEl = document.getElementById(ETAPA_TO_COL[etapa].count);
            if (countEl) countEl.textContent = items.length;
            if (!body) return;
            if (items.length === 0) {
                body.innerHTML = '<div class="pk-col-empty">Sin prospectos</div>';
            } else {
                body.innerHTML = items.map(renderCard).join('');
            }
        });

        // Empty state global
        var totalVisibles = Object.keys(grupos).reduce(function(acc, k) { return acc + grupos[k].length; }, 0);
        var empty = document.getElementById('pkEmpty');
        var wrap = document.getElementById('pkKanban');
        if (empty && wrap) {
            if (totalVisibles === 0) {
                empty.style.display = 'block';
                wrap.style.opacity = '0.4';
            } else {
                empty.style.display = 'none';
                wrap.style.opacity = '1';
            }
        }
    }

    function cargarProspectos() {
        var params = new URLSearchParams(window.location.search);
        var mes = params.get('mes') || '';
        var anio = params.get('anio') || '';
        var vendedores = params.get('vendedores') || '';
        var url = '/app/api/prospectos/?mes=' + encodeURIComponent(mes) +
                  '&anio=' + encodeURIComponent(anio) +
                  '&vendedores=' + encodeURIComponent(vendedores);

        fetch(url, { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                renderKanban(data.rows || data.prospectos || []);
            })
            .catch(function(err) {
                console.error('[PROSPECTOS-KANBAN] Error cargando prospectos:', err);
                renderKanban([]);
            });
    }

    // Click en card → abrir widget de detalle del prospecto
    kanbanRoot.addEventListener('click', function(ev) {
        var card = ev.target.closest('.pk-card');
        if (!card) return;
        var id = parseInt(card.getAttribute('data-prospecto-id'), 10);
        if (!id) return;
        if (typeof window.abrirWidgetProspecto === 'function') {
            window.abrirWidgetProspecto(id);
        } else {
            console.warn('[PROSPECTOS-KANBAN] abrirWidgetProspecto no definido');
        }
    });

    // Exponer para recarga externa (ej. después de crear un prospecto nuevo)
    window.recargarProspectosKanban = cargarProspectos;

    // Carga inicial
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cargarProspectos);
    } else {
        cargarProspectos();
    }
})();

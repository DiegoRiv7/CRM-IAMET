    /* ══════════════════════════════════════════════ WIDGET MAIL ══════════════════════════════════════════════ */
    (function () {
        'use strict';

        var _mailCarpeta = 'INBOX';
        var _mailPagina = 1;
        var _mailCorreoActual = null;
        var _mailBodyHtml = '';
        var _mailBodyTexto = '';
        var _mailTodos = [];
        var _mailFiltrado = [];
        var _mailHayMas = false;
        var _mailBusqTimeout = null;
        var _mailPollInterval = null;
        var _mailPendingBadge = 0;
        var _mailConexionId = null;
        var _mailConexiones = [];

        window.mailCambiarConexion = function () {
            var sel = document.getElementById('mailWidgetEmailSelect');
            if (sel) {
                _mailConexionId = sel.value;
                mailCargarLista(_mailCarpeta);
            }
        };

        function csrf() {
            var el = document.querySelector('[name=csrfmiddlewaretoken]');
            return el ? el.value : '';
        }

        function _showToastMail(msg, ok) {
            try {
                var t = document.createElement('div');
                t.textContent = msg;
                t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 22px;border-radius:10px;font-size:0.84rem;font-weight:600;z-index:10500;color:#fff;background:' + (ok ? '#059669' : '#DC2626') + ';box-shadow:0 4px 16px rgba(0,0,0,0.18);pointer-events:none;';
                document.body.appendChild(t);
                setTimeout(function () { t.remove(); }, 3000);
            } catch (e) { }
        }

        /* ── Open / Close ──────────────────────────── */
        window.mailAbrir = function () {
            var w = document.getElementById('widgetMail');
            if (!w) return;
            w.classList.add('active');
            w.classList.remove('closing');
            _mailPendingBadge = 0;
            _mailUpdateNavBadge();
            _mailInitState();
            // Scroll lock
            var sy = window.scrollY;
            document.body.style.position = 'fixed';
            document.body.style.top = '-' + sy + 'px';
            document.body.style.width = '100%';
            document.body.dataset.mailScrollY = sy;
        };

        window.mailCerrar = function () {
            var w = document.getElementById('widgetMail');
            if (!w) return;
            w.classList.add('closing');
            setTimeout(function () {
                w.classList.remove('active', 'closing');
            }, 200);
            // Restore scroll
            var sy = parseInt(document.body.dataset.mailScrollY || '0');
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            window.scrollTo(0, sy);
        };

        window.mailCerrarModal = function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        };

        window.mailTogglePanel = function (id) {
            var p = document.getElementById(id);
            if (!p) return;
            p.style.display = p.style.display === 'flex' ? 'none' : 'flex';
        };

        /* ── Load connection state on open ─────────── */
        function _mailInitState() {
            fetch('/app/api/mail/conexion/', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var selectEl = document.getElementById('mailWidgetEmailSelect');
                    var syncBtn = document.getElementById('mailWidgetSyncBtn');
                    var composeBtn = document.getElementById('mailComposeBtn');
                    var sidebarNote = document.getElementById('mailSidebarNote');
                    var btnText = document.getElementById('mailBtnConfigText');

                    if (data.tiene_conexion && data.conexiones && data.conexiones.length > 0) {
                        _mailConexiones = data.conexiones;
                        if (!_mailConexionId || !data.conexiones.find(function(c){ return c.id == _mailConexionId; })) {
                            _mailConexionId = data.conexiones[0].id;
                        }
                        // Legacy select (hidden but kept for compat)
                        if (selectEl) { selectEl.style.display = 'none'; }
                        if (btnText) btnText.style.display = 'none';
                        if (syncBtn) syncBtn.style.display = 'flex';
                        if (composeBtn) composeBtn.style.display = 'flex';
                        if (sidebarNote) sidebarNote.style.display = 'none';

                        // User info at sidebar bottom
                        var activeConn2 = data.conexiones.find(function(c){ return c.id == _mailConexionId; }) || data.conexiones[0];
                        var userNameEl = document.getElementById('mailUserName');
                        var userEmailEl = document.getElementById('mailUserEmail');
                        if (userNameEl) userNameEl.textContent = activeConn2.correo_electronico.split('@')[0];
                        if (userEmailEl) userEmailEl.textContent = '@' + activeConn2.correo_electronico.split('@')[1];

                        // Populate account switch list
                        _renderAccountSwitchList();

                        var activeConn = data.conexiones.find(c => c.id == _mailConexionId) || data.conexiones[0];
                        var cfgEmail = document.getElementById('mailCfgEmail');
                        var cfgImapSrv = document.getElementById('mailCfgImapSrv');
                        var cfgImapPort = document.getElementById('mailCfgImapPort');
                        var cfgSmtpSrv = document.getElementById('mailCfgSmtpSrv');
                        var cfgSmtpPort = document.getElementById('mailCfgSmtpPort');

                        if (cfgEmail) cfgEmail.value = activeConn.correo_electronico;
                        if (cfgImapSrv) cfgImapSrv.value = activeConn.imap_servidor || 'mail.iamet.mx';
                        if (cfgImapPort) cfgImapPort.value = activeConn.imap_puerto || 993;
                        if (cfgSmtpSrv) cfgSmtpSrv.value = activeConn.smtp_servidor || 'mail.iamet.mx';
                        if (cfgSmtpPort) cfgSmtpPort.value = activeConn.smtp_puerto || 465;

                        mailCargarLista(_mailCarpeta);
                        _mailStartPolling();
                    } else {
                        if (selectEl) selectEl.style.display = 'none';
                        if (btnText) btnText.style.display = 'inline';
                        if (syncBtn) syncBtn.style.display = 'none';
                        if (composeBtn) composeBtn.style.display = 'none';
                        if (sidebarNote) sidebarNote.style.display = 'block';
                        var listEl = document.getElementById('mailList');
                        if (listEl) listEl.innerHTML = '<div style="padding:30px;text-align:center;color:#9CA3AF;font-size:0.84rem;">Configura tu cuenta para ver correos.</div>';
                    }
                })
                .catch(function () { });
        }

        /* ── Carpeta switch ─────────────────────────── */
        var _folderLabels = { INBOX: 'Bandeja de entrada', SENT: 'Enviados', STARRED: 'Destacados', ARCHIVE: 'Archivo', TRASH: 'Papelera' };

        window.mailCambiarCarpeta = function (carpeta, btn) {
            _mailCarpeta = carpeta;
            _mailPagina = 1;
            document.querySelectorAll('.mail-folder-wb').forEach(function (b) { b.classList.remove('active'); });
            if (btn) btn.classList.add('active');
            var titleEl = document.getElementById('mailListTitle');
            if (titleEl) titleEl.textContent = _folderLabels[carpeta] || carpeta;
            mailCargarLista(carpeta);
        };

        /* ── Load list ──────────────────────────────── */
        window.mailCargarLista = function (carpeta) {
            carpeta = carpeta || _mailCarpeta;
            var listEl = document.getElementById('mailList');
            if (listEl) listEl.innerHTML = '<div style="padding:30px;text-align:center;color:#9CA3AF;font-size:0.83rem;">Cargando...</div>';
            var loadMore = document.getElementById('mailLoadMore');
            if (loadMore) loadMore.style.display = 'none';

            var url = '/app/api/mail/lista/?carpeta=' + carpeta + '&pagina=1';
            if (_mailConexionId) url += '&conexion_id=' + _mailConexionId;
            fetch(url)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    _mailTodos = data.correos || [];
                    _mailFiltrado = _mailTodos;
                    _mailHayMas = data.hay_mas || false;
                    _mailPagina = 1;
                    _renderLista(_mailFiltrado);

                    var unread = _mailTodos.filter(function (c) { return !c.leido; }).length;
                    var badge = document.getElementById('mailUnreadBadge');
                    if (badge) {
                        if (unread > 0 && carpeta === 'INBOX') {
                            badge.textContent = unread;
                            badge.style.display = 'inline-block';
                        } else {
                            badge.style.display = 'none';
                        }
                    }
                })
                .catch(function () {
                    if (listEl) listEl.innerHTML = '<div style="padding:30px;text-align:center;color:#DC2626;font-size:0.83rem;">Error al cargar correos.</div>';
                });
        };

        /* ── Render list ────────────────────────────── */
        function _renderLista(correos) {
            var listEl = document.getElementById('mailList');
            if (!listEl) return;
            if (!correos || correos.length === 0) {
                listEl.innerHTML = '<div style="padding:30px;text-align:center;color:#9CA3AF;font-size:0.83rem;">No hay correos.</div>';
                return;
            }

            var h = '';
            correos.forEach(function (c) {
                var unreadCls = c.leido ? '' : ' unread';
                var adjIcon = c.tiene_adjuntos ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' : '';
                var starIcon = c.destacado ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="#F59E0B" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : '';
                var oppBadge = c.oportunidad_nombre ? '<span style="display:inline-block;margin-top:3px;background:rgba(0,82,212,0.1);color:#0052D4;border-radius:4px;font-size:0.65rem;font-weight:600;padding:1px 6px;">' + _esc(c.oportunidad_nombre) + '</span>' : '';
                var dot = !c.leido ? '<span style="width:7px;height:7px;border-radius:50%;background:#007AFF;flex-shrink:0;margin-top:5px;"></span>' : '<span style="width:7px;height:7px;flex-shrink:0;"></span>';
                var fecha = c.fecha_envio ? _formatFecha(c.fecha_envio) : '';

                h += '<div class="mail-card-wb' + unreadCls + '" onclick="mailVerCorreo(' + c.id + ')" id="mailCard_' + c.id + '">';
                h += dot;
                h += '<div style="flex:1;min-width:0;">';
                h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">';
                h += '<span class="mw-from" style="font-size:0.82rem;color:#1A1A2E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;">' + _esc(c.remitente_nombre || c.remitente_email) + '</span>';
                h += '<span style="font-size:0.7rem;color:#9CA3AF;flex-shrink:0;">' + fecha + '</span>';
                h += '</div>';
                h += '<div style="display:flex;align-items:center;gap:4px;margin-top:1px;">';
                h += '<span class="mw-subject" style="font-size:0.79rem;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">' + _esc(c.asunto || '(Sin asunto)') + '</span>';
                h += starIcon;
                h += adjIcon;
                h += '</div>';
                if (oppBadge) h += '<div>' + oppBadge + '</div>';
                h += '</div></div>';
            });
            listEl.innerHTML = h;
            var loadMore = document.getElementById('mailLoadMore');
            if (loadMore) loadMore.style.display = _mailHayMas ? 'block' : 'none';
        }

        /* ── Load more ──────────────────────────────── */
        window.mailCargarMas = function () {
            _mailPagina++;
            var url = '/app/api/mail/lista/?carpeta=' + _mailCarpeta + '&pagina=' + _mailPagina;
            if (_mailConexionId) url += '&conexion_id=' + _mailConexionId;
            fetch(url)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var mas = data.correos || [];
                    _mailTodos = _mailTodos.concat(mas);
                    _mailFiltrado = _mailTodos;
                    _mailHayMas = data.hay_mas || false;
                    _renderLista(_mailFiltrado);
                });
        };

        /* ── Filter ─────────────────────────────────── */
        window.mailFiltrar = function (q) {
            q = (q || '').toLowerCase().trim();
            if (!q) {
                _mailFiltrado = _mailTodos;
            } else {
                _mailFiltrado = _mailTodos.filter(function (c) {
                    return (c.asunto || '').toLowerCase().includes(q) ||
                        (c.remitente_nombre || '').toLowerCase().includes(q) ||
                        (c.remitente_email || '').toLowerCase().includes(q);
                });
            }
            _renderLista(_mailFiltrado);
        };

        /* ── View email ─────────────────────────────── */
        window.mailVerCorreo = function (id) {
            document.querySelectorAll('.mail-card-wb').forEach(function (el) { el.classList.remove('selected'); });
            var card = document.getElementById('mailCard_' + id);
            if (card) card.classList.add('selected');

            var panelVincular = document.getElementById('mailPanelVincular');
            if (panelVincular) panelVincular.style.display = 'none';

            // Close compose panel if open
            var composePanel = document.getElementById('mailComposePanel');
            if (composePanel) composePanel.style.display = 'none';

            var detailEmpty = document.getElementById('mailDetailEmpty');
            var detailContent = document.getElementById('mailDetailContent');
            if (detailEmpty) detailEmpty.style.display = 'none';
            if (detailContent) detailContent.style.display = 'flex';
            var island = document.getElementById('mailHeaderIsland');
            if (island) island.style.display = 'inline-flex';


            fetch('/app/api/mail/detalle/' + id + '/')
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    _mailCorreoActual = d;
                    _mailBodyHtml = d.cuerpo_html || '';
                    _mailBodyTexto = d.cuerpo_texto || '';

                    // Store destinatarios for reply-all
                    _mailCorreoActual.destinatarios_json = JSON.stringify(d.destinatarios || []);

                    document.getElementById('mailDetailSubject').textContent = d.asunto || '(Sin asunto)';
                    document.getElementById('mailDetailFrom').textContent = d.remitente_nombre ? d.remitente_nombre + ' <' + d.remitente_email + '>' : d.remitente_email;
                    document.getElementById('mailDetailTo').textContent = (d.destinatarios || []).map(function (x) { return x.nombre ? x.nombre + ' <' + x.email + '>' : x.email; }).join(', ') || '—';
                    document.getElementById('mailDetailDate').textContent = d.fecha_envio ? new Date(d.fecha_envio).toLocaleString('es-MX') : '';

                    // Star state
                    var starBtn = document.getElementById('mailDetailStarBtn');
                    var starIcon = document.getElementById('mailDetailStarIcon');
                    var actionStar = document.getElementById('mailIslandStarBtn');
                    if (d.destacado) {
                        if (starBtn) starBtn.style.color = '#F59E0B';
                        if (starIcon) starIcon.setAttribute('fill', '#F59E0B');
                        if (actionStar) actionStar.classList.add('active');
                    } else {
                        if (starBtn) starBtn.style.color = '#D1D5DB';
                        if (starIcon) starIcon.setAttribute('fill', 'none');
                        if (actionStar) actionStar.classList.remove('active');
                    }

                    // Close any open reply/forward panels
                    mailCerrarReply();
                    mailCerrarForward();

                    var oppBar = document.getElementById('mailDetailOppBar');
                    var oppName = document.getElementById('mailDetailOppName');
                    if (d.oportunidad_nombre) {
                        oppName.textContent = d.oportunidad_nombre;
                        oppBar.style.display = 'flex';
                    } else {
                        oppBar.style.display = 'none';
                    }

                    var iframe = document.getElementById('mailDetailIframe');
                    var plain = document.getElementById('mailDetailPlain');
                    if (d.cuerpo_html) {
                        var cspMeta = '<meta http-equiv="Content-Security-Policy" content="default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:;">';
                        iframe.srcdoc = cspMeta + d.cuerpo_html;
                        iframe.style.display = 'block';
                        plain.style.display = 'none';
                    } else {
                        plain.textContent = d.cuerpo_texto || '(Sin contenido)';
                        plain.style.display = 'block';
                        iframe.style.display = 'none';
                    }

                    if (card) card.classList.remove('unread');
                });
        };

        /* ── Actions ────────────────────────────────── */
        window.mailSincronizar = function () {
            var btn = document.getElementById('mailWidgetSyncBtn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Sincronizando...';
            }
            fetch('/app/api/mail/sincronizar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ conexion_id: _mailConexionId })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'Sincronizar';
                    }
                    _showToastMail(data.nuevos + ' nuevos correos', true);
                    mailCargarLista(_mailCarpeta);
                })
                .catch(function () {
                    if (btn) btn.disabled = false;
                });
        };

        window.mailConfigurar = function () {
            var m = document.getElementById('mailModalConfig');
            if (!m) return;
            var titleEl = document.getElementById('mailConfigTitle');
            if (titleEl) titleEl.textContent = 'Configurar cuenta de correo';
            var errEl = document.getElementById('mailCfgErr');
            var okEl = document.getElementById('mailCfgOk');
            if (errEl) errEl.style.display = 'none';
            if (okEl) okEl.style.display = 'none';
            m.style.display = 'flex';
            // Check if current config looks like google workspace
            var imapSrv = document.getElementById('mailCfgImapSrv');
            if (imapSrv && imapSrv.value === 'imap.gmail.com') {
                mailSetConfigTpl('bajanet', true);
            } else {
                mailSetConfigTpl('iamet', true);
            }
        };

        window.mailAbrirConfig = function () {
            var m = document.getElementById('mailModalConfig');
            if (!m) return;
            var cfgEmail = document.getElementById('mailCfgEmail');
            var cfgPass = document.getElementById('mailCfgPass');
            var errEl = document.getElementById('mailCfgErr');
            var okEl = document.getElementById('mailCfgOk');
            var titleEl = document.getElementById('mailConfigTitle');
            if (cfgEmail) cfgEmail.value = '';
            if (cfgPass) cfgPass.value = '';
            if (errEl) errEl.style.display = 'none';
            if (okEl) okEl.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Agregar cuenta de correo';
            m.style.display = 'flex';
            mailSetConfigTpl('iamet', true);
            if (cfgEmail) cfgEmail.focus();
        };

        window.mailSetConfigTpl = function (type, noClear) {
            var btnIamet = document.getElementById('mailCfgBtnIamet');
            var btnBajanet = document.getElementById('mailCfgBtnBajanet');
            var infoIamet = document.getElementById('mailCfgInfoIamet');
            var infoBajanet = document.getElementById('mailCfgInfoBajanet');
            var infoBajanetPass = document.getElementById('mailCfgInfoBajanetPass');

            var imapSrv = document.getElementById('mailCfgImapSrv');
            var imapPort = document.getElementById('mailCfgImapPort');
            var smtpSrv = document.getElementById('mailCfgSmtpSrv');
            var smtpPort = document.getElementById('mailCfgSmtpPort');
            var emailInput = document.getElementById('mailCfgEmail');

            if (type === 'iamet') {
                // UI
                if (btnIamet) { btnIamet.style.border = '1px solid #007AFF'; btnIamet.style.background = 'rgba(0,122,255,0.1)'; btnIamet.style.color = '#007AFF'; }
                if (btnBajanet) { btnBajanet.style.border = '1px solid #E5E7EB'; btnBajanet.style.background = '#F9FAFB'; btnBajanet.style.color = '#6B7280'; }
                if (infoIamet) infoIamet.style.display = 'block';
                if (infoBajanet) infoBajanet.style.display = 'none';
                if (infoBajanetPass) infoBajanetPass.style.display = 'none';
                // Form
                if (imapSrv) imapSrv.value = 'mail.iamet.mx';
                if (imapPort) imapPort.value = '993';
                if (smtpSrv) smtpSrv.value = 'mail.iamet.mx';
                if (smtpPort) smtpPort.value = '465';
                if (!noClear && emailInput && !emailInput.value.includes('@iamet.mx')) emailInput.value = '';
                if (emailInput && !emailInput.value) emailInput.placeholder = 'tu@iamet.mx';
            } else if (type === 'bajanet') {
                // UI
                if (btnBajanet) { btnBajanet.style.border = '1px solid #007AFF'; btnBajanet.style.background = 'rgba(0,122,255,0.1)'; btnBajanet.style.color = '#007AFF'; }
                if (btnIamet) { btnIamet.style.border = '1px solid #E5E7EB'; btnIamet.style.background = '#F9FAFB'; btnIamet.style.color = '#6B7280'; }
                if (infoBajanet) infoBajanet.style.display = 'block';
                if (infoIamet) infoIamet.style.display = 'none';
                if (infoBajanetPass) infoBajanetPass.style.display = 'block';
                // Form
                if (imapSrv) imapSrv.value = 'imap.gmail.com';
                if (imapPort) imapPort.value = '993';
                if (smtpSrv) smtpSrv.value = 'smtp.gmail.com';
                if (smtpPort) smtpPort.value = '465';
                if (!noClear && emailInput && !emailInput.value.includes('@baja-net.com')) emailInput.value = '';
                if (emailInput && !emailInput.value) emailInput.placeholder = 'tu@baja-net.com';
            }
        };

        window.mailGuardarConexion = function () {
            var email = document.getElementById('mailCfgEmail').value.trim();
            var pass = document.getElementById('mailCfgPass').value;
            var imapSrv = document.getElementById('mailCfgImapSrv').value.trim();
            var imapPort = parseInt(document.getElementById('mailCfgImapPort').value, 10);
            var smtpSrv = document.getElementById('mailCfgSmtpSrv').value.trim();
            var smtpPort = parseInt(document.getElementById('mailCfgSmtpPort').value, 10);
            var errEl = document.getElementById('mailCfgErr');
            var okEl = document.getElementById('mailCfgOk');
            var btn = document.getElementById('mailBtnCfgGuardar');

            if (!email || !pass) {
                errEl.textContent = 'Correo y contraseña son requeridos.';
                errEl.style.display = 'block';
                return;
            }

            errEl.style.display = 'none';
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

            fetch('/app/api/mail/conexion/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({
                    correo_electronico: email, password: pass,
                    imap_servidor: imapSrv, imap_puerto: imapPort,
                    smtp_servidor: smtpSrv, smtp_puerto: smtpPort
                })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Guardar y Conectar'; }
                    if (data.ok) {
                        okEl.textContent = '¡Conexión guardada!';
                        okEl.style.display = 'block';
                        setTimeout(function () {
                            mailCerrarModal('mailModalConfig');
                            _mailInitState();
                        }, 1200);
                    } else {
                        errEl.textContent = data.error || 'Error al guardar';
                        errEl.style.display = 'block';
                    }
                });
        };

        window.mailRedactar = function () {
            var panel = document.getElementById('mailComposePanel');
            var empty = document.getElementById('mailDetailEmpty');
            var content = document.getElementById('mailDetailContent');
            var editor = document.getElementById('mailCompEditor');
            var para = document.getElementById('mailCompPara');
            var asunto = document.getElementById('mailCompAsunto');
            if (empty) empty.style.display = 'none';
            if (content) content.style.display = 'none';
            if (panel) panel.style.display = 'flex';
            if (editor) editor.innerHTML = '';
            if (para) para.value = '';
            if (asunto) asunto.value = '';
        };

        window.mailCerrarCompose = function () {
            var panel = document.getElementById('mailComposePanel');
            var empty = document.getElementById('mailDetailEmpty');
            if (panel) panel.style.display = 'none';
            _mailComposeAttachments = [];
            var chips = document.getElementById('mailComposeAttachChips');
            if (chips) { chips.innerHTML = ''; chips.style.display = 'none'; }
            var fi = document.getElementById('mailComposeFileInput');
            if (fi) fi.value = '';
            if (_mailCorreoActual) {
                var content = document.getElementById('mailDetailContent');
                if (content) content.style.display = 'flex';
            } else {
                if (empty) empty.style.display = 'flex';
            }
        };

        window.mailToggleComposeCc = function () {
            var row = document.getElementById('mailComposeCcRow');
            if (!row) return;
            row.style.display = row.style.display === 'flex' ? 'none' : 'flex';
        };

        window.mailEnviarCorreo = function () {
            var para = document.getElementById('mailCompPara').value.trim();
            var asunto = document.getElementById('mailCompAsunto').value.trim();
            var editor = document.getElementById('mailCompEditor');
            var cuerpo_html = editor ? editor.innerHTML.trim() : '';
            var cuerpo_texto = editor ? (editor.innerText || editor.textContent || '').trim() : '';
            var btn = document.getElementById('mailBtnEnviar');

            if (!para || !asunto) return;
            if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

            var fd = new FormData();
            fd.append('para', para);
            fd.append('asunto', asunto);
            fd.append('cuerpo_html', cuerpo_html);
            fd.append('cuerpo_texto', cuerpo_texto);
            _mailComposeAttachments.forEach(function (f) { fd.append('adjuntos', f); });

            fetch('/app/api/mail/enviar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf() },
                body: fd
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar'; }
                    if (data.ok) {
                        // If this was a campaign email, register it
                        if (window._campanaEnvioContext && window._campanaEnvioContext.templateId) {
                            var ctx = window._campanaEnvioContext;
                            fetch('/app/api/campana/registrar-envio/', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                                body: JSON.stringify({
                                    template_id: ctx.templateId,
                                    contacto_email: para,
                                    message_id: data.message_id || ''
                                })
                            }).catch(function() {});
                            window._campanaEnvioContext = null;
                        }
                        _mailComposeAttachments = [];
                        mailCerrarCompose();
                        _showToastMail('Correo enviado', true);
                    }
                });
        };

        window.mailResponder = function (replyAll) {
            if (!_mailCorreoActual) return;
            var panel = document.getElementById('mailReplyPanel');
            var backBtn = document.getElementById('mailBodyBackBtn');
            var editor = document.getElementById('mailRespEditor');
            var paraLabel = document.getElementById('mailRespParaLabel');
            var quoteBlock = document.getElementById('mailQuoteBlock');
            var quoteText = document.getElementById('mailQuoteText');
            var quoteCollapsed = document.getElementById('mailQuoteCollapsed');
            var quoteSnippet = document.getElementById('mailQuoteSnippet');
            var ccRow = document.getElementById('mailRespCcRow');
            var bccRow = document.getElementById('mailRespBccRow');
            var paraRow = document.getElementById('mailRespParaRow');
            var paraIn = document.getElementById('mailRespPara');
            var ccIn = document.getElementById('mailRespCc');
            var bccIn = document.getElementById('mailRespBcc');
            if (!panel) return;

            // Reset position/size to default
            panel.style.top = '12px'; panel.style.left = '12px';
            panel.style.right = '12px'; panel.style.bottom = '12px';
            panel.style.width = ''; panel.style.height = '';

            var remit = _mailCorreoActual.remitente_nombre || _mailCorreoActual.remitente_email;
            if (paraLabel) paraLabel.textContent = 'Re: ' + (_mailCorreoActual.asunto || '');
            if (editor) editor.innerHTML = '';
            if (ccRow) ccRow.style.display = 'none';
            if (bccRow) bccRow.style.display = 'none';
            if (ccIn) ccIn.value = '';
            if (bccIn) bccIn.value = '';

            // Reply-all: show Para field with all recipients
            if (replyAll && paraRow && paraIn) {
                try {
                    var dests = JSON.parse(_mailCorreoActual.destinatarios_json || '[]');
                    var all = [remit].concat(dests.map(function(d){ return d.email || ''; })).filter(function(x){ return x; });
                    paraIn.value = all.join(', ');
                } catch(e) { paraIn.value = remit; }
                paraRow.style.display = 'flex';
            } else {
                if (paraRow) paraRow.style.display = 'none';
            }

            // Quoted text
            var qt = (_mailBodyTexto || '').trim();
            if (qt && quoteText) {
                quoteText.textContent = qt.length > 1500 ? qt.substring(0, 1500) + '\n[...]' : qt;
                if (quoteBlock) quoteBlock.style.display = 'none'; // collapsed by default
                if (quoteCollapsed) quoteCollapsed.style.display = 'block';
                if (quoteSnippet) quoteSnippet.textContent = 'De: ' + remit + '  —  ' + (_mailCorreoActual.asunto || '');
            } else {
                if (quoteBlock) quoteBlock.style.display = 'none';
                if (quoteCollapsed) quoteCollapsed.style.display = 'none';
            }

            // Reset attachments
            _mailReplyAttachments = [];
            _renderAttachChips();

            // Close forward if open
            var fp = document.getElementById('mailForwardPanel');
            if (fp) fp.style.display = 'none';

            panel.style.display = 'flex';
            if (backBtn) backBtn.style.display = 'flex';
            if (editor) editor.focus();
        };

        window.mailCerrarReply = function () {
            var panel = document.getElementById('mailReplyPanel');
            var backBtn = document.getElementById('mailBodyBackBtn');
            if (panel) panel.style.display = 'none';
            if (backBtn) backBtn.style.display = 'none';
            _mailReplyAttachments = [];
            var chips = document.getElementById('mailReplyAttachChips');
            if (chips) { chips.innerHTML = ''; chips.style.display = 'none'; }
            var fi = document.getElementById('mailReplyFileInput');
            if (fi) fi.value = '';
        };

        window.mailRestoreEmailBody = function () {
            mailCerrarReply();
        };

        window.mailToggleCcBcc = function () {
            var ccRow = document.getElementById('mailRespCcRow');
            var bccRow = document.getElementById('mailRespBccRow');
            var visible = ccRow && ccRow.style.display !== 'none';
            if (visible) {
                if (ccRow) ccRow.style.display = 'none';
                if (bccRow) bccRow.style.display = 'none';
            } else {
                if (ccRow) ccRow.style.display = 'flex';
                if (bccRow) bccRow.style.display = 'flex';
                var ccIn = document.getElementById('mailRespCc');
                if (ccIn) ccIn.focus();
            }
        };

        window.mailToggleQuote = function () {
            var block = document.getElementById('mailQuoteBlock');
            var btn = document.getElementById('mailQuoteToggleBtn');
            if (!block) return;
            var showing = block.style.display !== 'none';
            block.style.display = showing ? 'none' : 'block';
            if (btn) btn.textContent = showing ? '⋯ mostrar mensaje original' : '⋯ ocultar mensaje original';
        };

        window.mailEditorCmd = function (cmd) {
            var editor = document.getElementById('mailRespEditor');
            if (!editor) return;
            editor.focus();
            document.execCommand(cmd, false, null);
        };

        window.mailEnviarRespuesta = function () {
            if (!_mailCorreoActual) return;
            var editor = document.getElementById('mailRespEditor');
            var btn = document.getElementById('mailBtnRespEnviar');
            if (!editor) return;

            var cuerpoHtml = editor.innerHTML.trim();
            var cuerpoTexto = editor.innerText.trim();
            if (!cuerpoTexto) return;

            var quoteText = document.getElementById('mailQuoteText');
            if (quoteText && quoteText.style.display !== 'none' && quoteText.textContent) {
                var qc = quoteText.textContent;
                cuerpoHtml += '<br><br><blockquote style="border-left:3px solid #D1D5DB;padding-left:12px;margin:0;color:#6B7280;font-size:0.85em;">' + _esc(qc) + '</blockquote>';
                cuerpoTexto += '\n\n--- Mensaje original ---\n' + qc;
            }

            var ccRow = document.getElementById('mailRespCcRow');
            var bccRow = document.getElementById('mailRespBccRow');
            var ccVal = (ccRow && ccRow.style.display !== 'none') ? ((document.getElementById('mailRespCc') || {}).value || '').trim() : '';
            var bccVal = (bccRow && bccRow.style.display !== 'none') ? ((document.getElementById('mailRespBcc') || {}).value || '').trim() : '';

            if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

            var fd = new FormData();
            fd.append('cuerpo_html', cuerpoHtml);
            fd.append('cuerpo_texto', cuerpoTexto);
            if (_mailConexionId) fd.append('conexion_id', _mailConexionId);
            if (ccVal) fd.append('cc', ccVal);
            if (bccVal) fd.append('bcc', bccVal);
            _mailReplyAttachments.forEach(function (f) { fd.append('adjuntos', f); });

            fetch('/app/api/mail/responder/' + _mailCorreoActual.id + '/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf() },
                body: fd
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Enviar respuesta'; }
                    if (data.ok) {
                        _mailReplyAttachments = [];
                        mailCerrarReply();
                        _showToastMail('Respuesta enviada', true);
                    } else {
                        _showToastMail(data.error || 'Error al enviar', false);
                    }
                })
                .catch(function () {
                    if (btn) { btn.disabled = false; btn.textContent = 'Enviar respuesta'; }
                    _showToastMail('Error de conexión', false);
                });
        };

        /* ── Vincular a Oportunidad ─────────────────── */
        window.mailBuscarOpps = function (q) {
            clearTimeout(_mailBusqTimeout);
            var resultsEl = document.getElementById('mailOppResults');
            if (!q || q.trim().length < 2) {
                if (resultsEl) resultsEl.style.display = 'none';
                return;
            }
            _mailBusqTimeout = setTimeout(function () {
                fetch('/app/api/buscar-oportunidades-proyecto/?q=' + encodeURIComponent(q.trim()))
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        var opps = data.oportunidades || [];
                        if (!resultsEl) return;
                        if (!opps.length) {
                            resultsEl.innerHTML = '<div style="padding:12px 14px;font-size:0.82rem;color:#9CA3AF;">Sin resultados</div>';
                            resultsEl.style.display = 'block';
                            return;
                        }
                        var h = '';
                        opps.forEach(function (o) {
                            var nombre = _esc(o.titulo || '');
                            var cliente = _esc(o.cliente__nombre_empresa || '');
                            var safeNombre = nombre.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                            h += '<div onclick="mailVincularOpp(' + o.id + ',\'' + safeNombre + '\')" ';
                            h += 'style="padding:9px 14px;font-size:0.82rem;cursor:pointer;border-bottom:1px solid #F0F2F5;" ';
                            h += 'onmouseenter="this.style.background=\'#F0F9FF\'" onmouseleave="this.style.background=\'\'">';
                            h += '<div style="font-weight:600;color:#1A1A2E;">' + nombre + '</div>';
                            if (cliente) h += '<div style="font-size:0.74rem;color:#9CA3AF;margin-top:2px;">' + cliente + '</div>';
                            h += '</div>';
                        });
                        resultsEl.innerHTML = h;
                        resultsEl.style.display = 'block';
                    })
                    .catch(function () { });
            }, 350);
        };

        window.mailVincularOpp = function (oppId, oppNombre) {
            if (!_mailCorreoActual) return;
            fetch('/app/api/mail/vincular/' + _mailCorreoActual.id + '/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ oportunidad_id: oppId })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.ok) {
                        var bar = document.getElementById('mailDetailOppBar');
                        var name = document.getElementById('mailDetailOppName');
                        var panel = document.getElementById('mailPanelVincular');
                        if (name) name.textContent = oppNombre;
                        if (bar) bar.style.display = 'flex';
                        if (panel) panel.style.display = 'none';
                        if (_mailCorreoActual) _mailCorreoActual.oportunidad_nombre = oppNombre;
                        _showToastMail('Vinculado a ' + oppNombre, true);
                    } else {
                        _showToastMail(data.error || 'Error al vincular', false);
                    }
                })
                .catch(function () { _showToastMail('Error de conexión', false); });
        };

        /* ── Crear Oportunidad desde correo ─────────── */
        window.mailAbrirFormNuevaOpp = function () {
            var overlay = document.getElementById('widgetNegociacion');
            if (!overlay) return;

            // Guardar ID del correo para vincularlo tras crear la oportunidad
            window._mailOppFromCorreoId = _mailCorreoActual ? _mailCorreoActual.id : null;

            // Pre-rellenar campos con datos del correo activo
            if (_mailCorreoActual) {
                var asunto = _mailCorreoActual.asunto || '';
                var nombreRemitente = _mailCorreoActual.remitente_nombre || '';

                var wfOportunidad = document.getElementById('wfOportunidad');
                if (wfOportunidad && asunto) wfOportunidad.value = asunto;

                var wfContacto = document.getElementById('wfContacto');
                if (wfContacto && nombreRemitente) wfContacto.value = nombreRemitente;
            }

            // Abrir el widget
            overlay.classList.add('active');
            overlay.classList.remove('closing');
            var wfCliente = document.getElementById('wfCliente');
            if (wfCliente) wfCliente.focus();
        };

        /* ── Destacar / Eliminar ────────────────────── */
        window.mailDestacar = function () {
            if (!_mailCorreoActual) return;
            fetch('/app/api/mail/destacar/' + _mailCorreoActual.id + '/', {
                method: 'POST', headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' }
            })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.ok) return;
                    _mailCorreoActual.destacado = d.destacado;
                    var starBtn = document.getElementById('mailDetailStarBtn');
                    var starIcon = document.getElementById('mailDetailStarIcon');
                    var actionStar = document.getElementById('mailIslandStarBtn');
                    if (d.destacado) {
                        if (starBtn) starBtn.style.color = '#F59E0B';
                        if (starIcon) starIcon.setAttribute('fill', '#F59E0B');
                        if (actionStar) actionStar.classList.add('active');
                    } else {
                        if (starBtn) starBtn.style.color = '#D1D5DB';
                        if (starIcon) starIcon.setAttribute('fill', 'none');
                        if (actionStar) actionStar.classList.remove('active');
                    }
                    _showToastMail(d.destacado ? 'Correo destacado' : 'Quitado de destacados', true);
                });
        };

        window.mailEliminar = function () {
            if (!_mailCorreoActual) return;
            if (!confirm('¿Mover este correo a la Papelera?')) return;
            fetch('/app/api/mail/eliminar/' + _mailCorreoActual.id + '/', {
                method: 'POST', headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (!d.ok) return;
                    var card = document.getElementById('mailCard_' + _mailCorreoActual.id);
                    if (card) card.remove();
                    document.getElementById('mailDetailContent').style.display = 'none';
                    document.getElementById('mailDetailEmpty').style.display = 'flex';
                    _mailCorreoActual = null;
                    var island = document.getElementById('mailHeaderIsland');
                    if (island) island.style.display = 'none';
                    _showToastMail('Movido a Papelera', true);
                });
        };

        /* ── Reenviar ──────────────────────────────── */
        window.mailAbrirReenvio = function () {
            if (!_mailCorreoActual) return;
            var p = document.getElementById('mailForwardPanel');
            var para = document.getElementById('mailFwdPara');
            var ed = document.getElementById('mailFwdEditor');
            if (!p) return;
            if (para) para.value = '';
            if (ed) ed.innerHTML = '';
            p.style.display = 'flex';
            var backBtn = document.getElementById('mailBodyBackBtn');
            if (backBtn) backBtn.style.display = 'flex';
            if (para) para.focus();
        };

        window.mailCerrarForward = function () {
            var p = document.getElementById('mailForwardPanel');
            var backBtn = document.getElementById('mailBodyBackBtn');
            if (p) p.style.display = 'none';
            if (backBtn) backBtn.style.display = 'none';
            _mailFwdAttachments = [];
            var chips = document.getElementById('mailFwdAttachChips');
            if (chips) { chips.innerHTML = ''; chips.style.display = 'none'; }
            var fi = document.getElementById('mailFwdFileInput');
            if (fi) fi.value = '';
        };

        window.mailEditorFwdCmd = function (cmd) {
            var ed = document.getElementById('mailFwdEditor');
            if (ed) { ed.focus(); document.execCommand(cmd, false, null); }
        };

        window.mailEnviarReenvio = function () {
            if (!_mailCorreoActual) return;
            var para = (document.getElementById('mailFwdPara') || {}).value || '';
            var btn = document.getElementById('mailBtnFwdEnviar');
            var ed = document.getElementById('mailFwdEditor');
            if (!para.trim()) { _showToastMail('Indica un destinatario', false); return; }
            if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

            var fd = new FormData();
            fd.append('para', para.trim());
            fd.append('cuerpo_html', ed ? ed.innerHTML : '');
            fd.append('cuerpo_texto', ed ? ed.innerText : '');
            if (_mailConexionId) fd.append('conexion_id', _mailConexionId);
            _mailFwdAttachments.forEach(function (f) { fd.append('adjuntos', f); });

            fetch('/app/api/mail/reenviar/' + _mailCorreoActual.id + '/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf() },
                body: fd
            })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Reenviar'; }
                    if (d.ok) { _mailFwdAttachments = []; mailCerrarForward(); _showToastMail('Correo reenviado', true); }
                    else _showToastMail(d.error || 'Error al reenviar', false);
                })
                .catch(function () { if (btn) { btn.disabled = false; btn.textContent = 'Reenviar'; } });
        };

        /* ── Reply panel drag & resize ─────────────── */
        (function () {
            var _dragging = false, _resizing = false;
            var _startX, _startY, _startTop, _startLeft, _startW, _startH;

            function _isInteractive(el) {
                return el.closest('button, input, select, label, a') !== null;
            }

            document.addEventListener('mousedown', function (e) {
                var handle = document.getElementById('mailReplyDragHandle');
                var resizeHandle = document.getElementById('mailReplyResizeHandle');
                var panel = document.getElementById('mailReplyPanel');
                if (!panel || panel.style.display === 'none') return;

                if (resizeHandle && resizeHandle.contains(e.target)) {
                    _resizing = true;
                    _startX = e.clientX;
                    _startY = e.clientY;
                    _startW = panel.offsetWidth;
                    _startH = panel.offsetHeight;
                    // Anchor top/left so resize doesn't jump
                    _startTop = panel.offsetTop;
                    _startLeft = panel.offsetLeft;
                    panel.style.right = 'auto';
                    panel.style.bottom = 'auto';
                    panel.style.top = _startTop + 'px';
                    panel.style.left = _startLeft + 'px';
                    e.preventDefault();
                    return;
                }

                if (handle && handle.contains(e.target) && !_isInteractive(e.target)) {
                    _dragging = true;
                    _startX = e.clientX;
                    _startY = e.clientY;
                    // Use offsetTop/offsetLeft (parent-relative) not getBoundingClientRect
                    _startTop = panel.offsetTop;
                    _startLeft = panel.offsetLeft;
                    panel.style.right = 'auto';
                    panel.style.bottom = 'auto';
                    panel.style.top = _startTop + 'px';
                    panel.style.left = _startLeft + 'px';
                    e.preventDefault();
                }
            });

            document.addEventListener('mousemove', function (e) {
                var panel = document.getElementById('mailReplyPanel');
                if (!panel) return;
                if (_dragging) {
                    var dx = e.clientX - _startX;
                    var dy = e.clientY - _startY;
                    var par = panel.parentElement;
                    var maxT = par ? Math.max(0, par.offsetHeight - 60) : 9999;
                    var maxL = par ? Math.max(0, par.offsetWidth - 120) : 9999;
                    panel.style.top = Math.max(0, Math.min(maxT, _startTop + dy)) + 'px';
                    panel.style.left = Math.max(0, Math.min(maxL, _startLeft + dx)) + 'px';
                }
                if (_resizing) {
                    var dx = e.clientX - _startX;
                    var dy = e.clientY - _startY;
                    panel.style.width = Math.max(300, _startW + dx) + 'px';
                    panel.style.height = Math.max(260, _startH + dy) + 'px';
                }
            });

            document.addEventListener('mouseup', function () {
                _dragging = false;
                _resizing = false;
            });
        })();

        /* ── Attachments system (compose, reply, forward) ── */
        var _mailComposeAttachments = [];
        var _mailReplyAttachments = [];
        var _mailFwdAttachments = [];

        // Generic handler: context = 'compose' | 'reply' | 'fwd'
        function _getAttachContext(context) {
            if (context === 'compose') return { arr: _mailComposeAttachments, chipsId: 'mailComposeAttachChips', setArr: function(a) { _mailComposeAttachments = a; } };
            if (context === 'fwd') return { arr: _mailFwdAttachments, chipsId: 'mailFwdAttachChips', setArr: function(a) { _mailFwdAttachments = a; } };
            return { arr: _mailReplyAttachments, chipsId: 'mailReplyAttachChips', setArr: function(a) { _mailReplyAttachments = a; } };
        }

        function _handleAttachFiles(files, context) {
            if (!files) return;
            var ctx = _getAttachContext(context);
            for (var i = 0; i < files.length; i++) {
                ctx.arr.push(files[i]);
            }
            _renderAttachChipsFor(context);
        }

        function _renderAttachChipsFor(context) {
            var ctx = _getAttachContext(context);
            var container = document.getElementById(ctx.chipsId);
            if (!container) return;
            if (!ctx.arr.length) {
                container.style.display = 'none';
                return;
            }
            container.style.display = 'flex';
            container.innerHTML = '';
            ctx.arr.forEach(function (f, idx) {
                var chip = document.createElement('div');
                chip.className = 'mail-attach-chip';
                chip.innerHTML = _esc(f.name) + ' <button onclick="mailRemoveAttachFrom(\'' + context + '\',' + idx + ')">✕</button>';
                container.appendChild(chip);
            });
        }

        window.mailRemoveAttachFrom = function (context, idx) {
            var ctx = _getAttachContext(context);
            ctx.arr.splice(idx, 1);
            _renderAttachChipsFor(context);
        };

        // Backward compat for existing reply file input
        window.mailHandleAttachFiles = function (files) { _handleAttachFiles(files, 'reply'); };
        window.mailRemoveAttach = function (idx) { window.mailRemoveAttachFrom('reply', idx); };

        // Compose attach handler
        window.mailHandleComposeAttach = function (files) { _handleAttachFiles(files, 'compose'); };
        // Forward attach handler
        window.mailHandleFwdAttach = function (files) { _handleAttachFiles(files, 'fwd'); };

        function _setupDropZone(editorId, panelId, context) {
            var editor = document.getElementById(editorId);
            if (!editor) return;
            editor.addEventListener('dragover', function (e) {
                e.preventDefault();
                editor.style.background = '#F0F9FF';
            });
            editor.addEventListener('dragleave', function () {
                editor.style.background = '';
            });
            editor.addEventListener('drop', function (e) {
                e.preventDefault();
                editor.style.background = '';
                var files = e.dataTransfer.files;
                if (files && files.length) {
                    _handleAttachFiles(files, context);
                    e.stopPropagation();
                }
            });
            if (panelId) {
                var panel = document.getElementById(panelId);
                if (panel) {
                    panel.addEventListener('dragover', function (e) { e.preventDefault(); });
                    panel.addEventListener('drop', function (e) {
                        e.preventDefault();
                        var files = e.dataTransfer.files;
                        if (files && files.length) _handleAttachFiles(files, context);
                    });
                }
            }
        }

        function _setupReplyDropZone() {
            _setupDropZone('mailRespEditor', 'mailReplyPanel', 'reply');
            _setupDropZone('mailCompEditor', 'mailComposePanel', 'compose');
            _setupDropZone('mailFwdEditor', 'mailFwdPanel', 'fwd');
        }

        /* ── Account menu ────────────────────────────── */
        function _renderAccountSwitchList() {
            var container = document.getElementById('mailAccountSwitchList');
            if (!container) return;
            var others = _mailConexiones.filter(function(c){ return c.id != _mailConexionId; });
            if (!others.length) { container.innerHTML = ''; return; }
            var h = '<div style="padding:6px 14px 2px;font-size:0.67rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;">Cambiar de cuenta</div>';
            others.forEach(function(c) {
                h += '<button onclick="event.stopPropagation();mailCambiarCuenta(' + c.id + ')" style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 14px;background:none;border:none;font-size:0.81rem;color:#374151;cursor:pointer;font-family:inherit;text-align:left;" onmouseenter="this.style.background=\'#F3F4F8\'" onmouseleave="this.style.background=\'\'">';
                h += '<div style="width:24px;height:24px;border-radius:50%;background:#E5E7EB;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.7rem;font-weight:700;color:#6B7280;">' + (c.correo_electronico[0] || '?').toUpperCase() + '</div>';
                h += '<div style="min-width:0;"><div style="font-size:0.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(c.correo_electronico) + '</div></div>';
                h += '</button>';
            });
            container.innerHTML = h;
        }

        window.mailCambiarCuenta = function (conexionId) {
            _mailConexionId = conexionId;
            var menu = document.getElementById('mailAccountMenu');
            if (menu) menu.style.display = 'none';
            // Update user info display
            var conn = _mailConexiones.find(function(c){ return c.id == conexionId; });
            if (conn) {
                var userNameEl = document.getElementById('mailUserName');
                var userEmailEl = document.getElementById('mailUserEmail');
                if (userNameEl) userNameEl.textContent = conn.correo_electronico.split('@')[0];
                if (userEmailEl) userEmailEl.textContent = '@' + conn.correo_electronico.split('@')[1];
            }
            _renderAccountSwitchList();
            mailCargarLista('INBOX');
            // Reset to inbox
            document.querySelectorAll('.mail-folder-wb').forEach(function(b){ b.classList.remove('active'); });
            var inbox = document.getElementById('mwFolderInbox');
            if (inbox) inbox.classList.add('active');
            var title = document.getElementById('mailListTitle');
            if (title) title.textContent = 'Bandeja de entrada';
            _mailCarpeta = 'INBOX';
        };

        window.mailEliminarCuenta = function () {
            var conn = _mailConexiones.find(function(c){ return c.id == _mailConexionId; });
            var email = conn ? conn.correo_electronico : 'esta cuenta';
            if (!confirm('¿Eliminar la cuenta ' + email + '?\nSe eliminarán todos los correos sincronizados de esta cuenta.')) return;
            var menu = document.getElementById('mailAccountMenu');
            if (menu) menu.style.display = 'none';
            fetch('/app/api/mail/conexion/' + _mailConexionId + '/eliminar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }
            })
                .then(function(r){ return r.json(); })
                .then(function(d){
                    if (d.ok) {
                        _mailConexiones = _mailConexiones.filter(function(c){ return c.id != _mailConexionId; });
                        if (_mailConexiones.length > 0) {
                            mailCambiarCuenta(_mailConexiones[0].id);
                        } else {
                            _mailConexionId = null;
                            _mailInitState();
                        }
                        _showToastMail('Cuenta eliminada', true);
                    } else {
                        _showToastMail(d.error || 'Error al eliminar', false);
                    }
                });
        };

        window.mailToggleAccountMenu = function () {
            var menu = document.getElementById('mailAccountMenu');
            if (!menu) return;
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        };

        document.addEventListener('click', function (e) {
            var btn = document.getElementById('mailUserInfoBtn');
            var menu = document.getElementById('mailAccountMenu');
            if (menu && btn && !btn.contains(e.target)) menu.style.display = 'none';
        });

        /* ── Polling & Badges ──────────────────────── */
        function _mailStartPolling() {
            if (_mailPollInterval) return;
            _mailPollInterval = setInterval(_mailPollUnreadCount, 30000);
        }

        function _mailPollUnreadCount() {
            fetch('/app/api/mail/auto-sync/')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data.ok) return;

                    // Update badge
                    _mailPendingBadge = data.total_no_leidos || 0;
                    _mailUpdateNavBadge();

                    // If new emails, auto-sync and show notification
                    if (data.should_sync && data.nuevos > 0) {
                        // Show Mac-style notification
                        _showMailNotification(data.nuevos);

                        // Auto-trigger sync
                        fetch('/app/api/mail/sincronizar/', {
                            method: 'POST',
                            headers: { 'X-CSRFToken': csrf() }
                        }).then(function (r) { return r.json(); }).then(function (syncData) {
                            // If mail widget is open, refresh the list
                            var widget = document.getElementById('widgetMail');
                            if (widget && widget.classList.contains('active')) {
                                mailCargarLista(_mailCarpeta);
                            }
                        });
                    }
                })
                .catch(function () {});
        }

        function _showMailNotification(count) {
            // Don't show if mail widget is already open
            var widget = document.getElementById('widgetMail');
            if (widget && widget.classList.contains('active')) return;

            // Create notification element
            var notif = document.createElement('div');
            notif.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.05);padding:14px 18px;display:flex;align-items:center;gap:12px;max-width:340px;cursor:pointer;transform:translateX(400px);transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);';

            notif.innerHTML =
                '<div style="width:36px;height:36px;border-radius:8px;background:#007AFF22;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
                    '<svg width="18" height="18" fill="none" stroke="#007AFF" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' +
                '</div>' +
                '<div>' +
                    '<div style="font-size:13px;font-weight:700;color:#1D1D1F;">Nuevo' + (count > 1 ? 's' : '') + ' correo' + (count > 1 ? 's' : '') + '</div>' +
                    '<div style="font-size:12px;color:#86868B;">' + count + ' correo' + (count > 1 ? 's' : '') + ' sin leer en tu bandeja</div>' +
                '</div>';

            notif.addEventListener('click', function () {
                notif.remove();
                if (typeof mailAbrir === 'function') mailAbrir();
            });

            document.body.appendChild(notif);

            // Slide in
            setTimeout(function () { notif.style.transform = 'translateX(0)'; }, 50);

            // Auto-dismiss after 5 seconds
            setTimeout(function () {
                notif.style.transform = 'translateX(400px)';
                setTimeout(function () { if (notif.parentNode) notif.remove(); }, 400);
            }, 5000);
        }

        function _mailUpdateNavBadge() {
            var btn = document.getElementById('btnMail');
            if (!btn) return;
            var existing = btn.querySelector('.mail-nav-badge');
            if (_mailPendingBadge > 0) {
                if (!existing) {
                    var badge = document.createElement('span');
                    badge.className = 'mail-nav-badge';
                    badge.style.cssText = 'position:absolute;top:-7px;right:-4px;background:#FF3B30;color:#fff;border-radius:50%;min-width:16px;height:16px;padding:0 3px;font-size:0.6rem;font-weight:800;display:flex;align-items:center;justify-content:center;pointer-events:none;border:1.5px solid #fff;line-height:1;box-sizing:border-box;';
                    btn.style.position = 'relative';
                    btn.style.overflow = 'visible';
                    btn.appendChild(badge);
                    existing = badge;
                }
                existing.textContent = _mailPendingBadge > 9 ? '9+' : _mailPendingBadge;
            } else if (existing) {
                existing.remove();
            }
        }

        /* ── Utils ──────────────────────────────────── */
        function _esc(str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function _formatFecha(iso) {
            try {
                var d = new Date(iso);
                var now = new Date();
                if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
            } catch (e) { return ''; }
        }

        // Events
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') mailCerrar();
        });

        document.addEventListener('DOMContentLoaded', function () {
            var w = document.getElementById('widgetMail');
            if (w) {
                w.addEventListener('click', function (e) {
                    if (e.target === w) mailCerrar();
                });
            }
            _mailPollUnreadCount();
            _setupReplyDropZone();
        });

    })();

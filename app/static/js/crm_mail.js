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
        };

        window.mailCerrar = function () {
            var w = document.getElementById('widgetMail');
            if (!w) return;
            w.classList.add('closing');
            setTimeout(function () {
                w.classList.remove('active', 'closing');
            }, 200);
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
                        if (selectEl) {
                            selectEl.innerHTML = '';
                            data.conexiones.forEach(function (c) {
                                var opt = document.createElement('option');
                                opt.value = c.id;
                                opt.textContent = c.correo_electronico;
                                selectEl.appendChild(opt);
                            });
                            selectEl.style.display = 'block';
                            if (!_mailConexionId || !data.conexiones.find(c => c.id == _mailConexionId)) {
                                _mailConexionId = data.conexiones[0].id;
                            }
                            selectEl.value = _mailConexionId;
                        }
                        if (btnText) btnText.style.display = 'none';
                        if (syncBtn) syncBtn.style.display = 'flex';
                        if (composeBtn) composeBtn.style.display = 'flex';
                        if (sidebarNote) sidebarNote.style.display = 'none';

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
        window.mailCambiarCarpeta = function (carpeta, btn) {
            _mailCarpeta = carpeta;
            _mailPagina = 1;
            document.querySelectorAll('.mail-folder-wb').forEach(function (b) { b.classList.remove('active'); });
            if (btn) btn.classList.add('active');
            var titleEl = document.getElementById('mailListTitle');
            if (titleEl) titleEl.textContent = carpeta === 'INBOX' ? 'Bandeja de entrada' : 'Enviados';
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

            var detailEmpty = document.getElementById('mailDetailEmpty');
            var detailContent = document.getElementById('mailDetailContent');
            if (detailEmpty) detailEmpty.style.display = 'none';
            if (detailContent) detailContent.style.display = 'flex';

            fetch('/app/api/mail/detalle/' + id + '/')
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    _mailCorreoActual = d;
                    _mailBodyHtml = d.cuerpo_html || '';
                    _mailBodyTexto = d.cuerpo_texto || '';

                    document.getElementById('mailDetailSubject').textContent = d.asunto || '(Sin asunto)';
                    document.getElementById('mailDetailFrom').textContent = d.remitente_nombre ? d.remitente_nombre + ' <' + d.remitente_email + '>' : d.remitente_email;
                    document.getElementById('mailDetailTo').textContent = (d.destinatarios || []).map(function (x) { return x.nombre ? x.nombre + ' <' + x.email + '>' : x.email; }).join(', ') || '—';
                    document.getElementById('mailDetailDate').textContent = d.fecha_envio ? new Date(d.fecha_envio).toLocaleString('es-MX') : '';

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
                        iframe.srcdoc = d.cuerpo_html;
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
            document.getElementById('mailModalRedactar').style.display = 'flex';
        };

        window.mailEnviarCorreo = function () {
            var para = document.getElementById('mailCompPara').value.trim();
            var asunto = document.getElementById('mailCompAsunto').value.trim();
            var cuerpo = document.getElementById('mailCompCuerpo').value.trim();
            var btn = document.getElementById('mailBtnEnviar');

            if (!para || !asunto) return;
            if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

            fetch('/app/api/mail/enviar/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify({ para: para, asunto: asunto, cuerpo_texto: cuerpo })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
                    if (data.ok) {
                        mailCerrarModal('mailModalRedactar');
                        _showToastMail('Correo enviado', true);
                    }
                });
        };

        window.mailResponder = function () {
            if (!_mailCorreoActual) return;
            var panel = document.getElementById('mailReplyPanel');
            var backBtn = document.getElementById('mailBodyBackBtn');
            var editor = document.getElementById('mailRespEditor');
            var paraLabel = document.getElementById('mailRespParaLabel');
            var quoteBlock = document.getElementById('mailQuoteBlock');
            var quoteText = document.getElementById('mailQuoteText');
            var ccRow = document.getElementById('mailRespCcRow');
            var bccRow = document.getElementById('mailRespBccRow');
            var ccIn = document.getElementById('mailRespCc');
            var bccIn = document.getElementById('mailRespBcc');
            if (!panel) return;

            if (paraLabel) paraLabel.textContent = _mailCorreoActual.remitente_nombre || _mailCorreoActual.remitente_email;
            if (editor) editor.innerHTML = '';
            if (ccRow) ccRow.style.display = 'none';
            if (bccRow) bccRow.style.display = 'none';
            if (ccIn) ccIn.value = '';
            if (bccIn) bccIn.value = '';

            if (_mailBodyTexto && quoteText) {
                var qt = _mailBodyTexto.trim();
                quoteText.textContent = qt.length > 1200 ? qt.substring(0, 1200) + '\n[...]' : qt;
                if (quoteBlock) quoteBlock.style.display = 'block';
                quoteText.style.display = 'none';
            } else {
                if (quoteBlock) quoteBlock.style.display = 'none';
            }

            panel.style.display = 'flex';
            if (backBtn) backBtn.style.display = 'flex';
            if (editor) editor.focus();
        };

        window.mailCerrarReply = function () {
            var panel = document.getElementById('mailReplyPanel');
            var backBtn = document.getElementById('mailBodyBackBtn');
            if (panel) panel.style.display = 'none';
            if (backBtn) backBtn.style.display = 'none';
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
            var qt = document.getElementById('mailQuoteText');
            if (!qt) return;
            qt.style.display = qt.style.display === 'none' ? 'block' : 'none';
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

            var payload = { cuerpo_html: cuerpoHtml, cuerpo_texto: cuerpoTexto, conexion_id: _mailConexionId };
            if (ccVal) payload.cc = ccVal;
            if (bccVal) payload.bcc = bccVal;

            fetch('/app/api/mail/responder/' + _mailCorreoActual.id + '/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Enviar respuesta'; }
                    if (data.ok) {
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

        /* ── Polling & Badges ──────────────────────── */
        function _mailStartPolling() {
            if (_mailPollInterval) return;
            _mailPollInterval = setInterval(_mailPollUnreadCount, 120000);
        }

        function _mailPollUnreadCount() {
            var url = '/app/api/mail/lista/?carpeta=INBOX&pagina=1';
            if (_mailConexionId) url += '&conexion_id=' + _mailConexionId;
            fetch(url)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var unread = (data.correos || []).filter(function (c) { return !c.leido; }).length;
                    _mailPendingBadge = unread;
                    _mailUpdateNavBadge();
                });
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
        });

    })();

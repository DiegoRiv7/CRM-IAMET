import sys
import re

with open('app/templates/crm/_scripts_mail.html', 'r') as f:
    text = f.read()

# 1. Add _mailConexionId variable
text = text.replace(
'''        var _mailHayMas = false;
        var _mailBusqTimeout = null;''',
'''        var _mailHayMas = false;
        var _mailBusqTimeout = null;
        var _mailConexionId = null;'''
)

# 2. Add mailCambiarConexion function
cambiar_fn = '''
        window.mailCambiarConexion = function() {
            var sel = document.getElementById('mailWidgetEmailSelect');
            if(sel) {
                _mailConexionId = sel.value;
                mailCargarLista(_mailCarpeta);
            }
        };
'''
text = text.replace('window.mailCerrarModal = function (id) {', cambiar_fn + '\n        window.mailCerrarModal = function (id) {')

# 3. Update _mailInitState
init_state_old = '''        function _mailInitState() {
            fetch('/app/api/mail/conexion/', {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var emailEl = document.getElementById('mailWidgetEmail');
                    var syncBtn = document.getElementById('mailWidgetSyncBtn');
                    var composeBtn = document.getElementById('mailComposeBtn');
                    var sidebarNote = document.getElementById('mailSidebarNote');

                    if (data.correo_electronico) {
                        if (emailEl) emailEl.textContent = data.correo_electronico;'''

init_state_new = '''        function _mailInitState() {
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
                            data.conexiones.forEach(function(c) {
                                var opt = document.createElement('option');
                                opt.value = c.id;
                                opt.textContent = c.correo_electronico;
                                selectEl.appendChild(opt);
                            });
                            selectEl.style.display = 'block';
                            if(!_mailConexionId) _mailConexionId = data.conexiones[0].id;
                            selectEl.value = _mailConexionId;
                        }
                        if (btnText) btnText.style.display = 'none';

                        // Fill config values for the active connection (or first)
                        var activeConn = data.conexiones.find(c => c.id == _mailConexionId) || data.conexiones[0];'''
text = text.replace(init_state_old, init_state_new)

fill_cfg_old = '''                        if (cfgEmail) cfgEmail.value = data.correo_electronico;
                        if (cfgImapSrv) cfgImapSrv.value = data.imap_servidor || 'mail.iamet.mx';
                        if (cfgImapPort) cfgImapPort.value = data.imap_puerto || 993;
                        if (cfgSmtpSrv) cfgSmtpSrv.value = data.smtp_servidor || 'mail.iamet.mx';
                        if (cfgSmtpPort) cfgSmtpPort.value = data.smtp_puerto || 465;

                        mailCargarLista(_mailCarpeta);
                        _mailStartPolling();
                    } else {
                        if (emailEl) emailEl.textContent = 'Sin cuenta configurada';
                        if (syncBtn) syncBtn.style.display = 'none';
                        if (composeBtn) composeBtn.style.display = 'none';
                        if (sidebarNote) sidebarNote.style.display = 'block';
                    }
                });
        }'''

fill_cfg_new = '''                        if (cfgEmail) cfgEmail.value = activeConn.correo_electronico;
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
                    }
                });
        }'''
text = text.replace(fill_cfg_old, fill_cfg_new)

# 4. mailCargarLista parameter
cl_old = '''            var url = '/app/api/mail/lista/?carpeta=' + _mailCarpeta + '&pagina=' + _mailPagina;'''
cl_new = '''            var url = '/app/api/mail/lista/?carpeta=' + _mailCarpeta + '&pagina=' + _mailPagina;
            if(_mailConexionId) url += '&conexion_id=' + _mailConexionId;'''
text = text.replace(cl_old, cl_new)

# 5. mailSincronizar pass conexion_id
sync_old = '''            fetch('/app/api/mail/sincronizar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf() }
            })'''
sync_new = '''            fetch('/app/api/mail/sincronizar/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ conexion_id: _mailConexionId })
            })'''
text = text.replace(sync_old, sync_new)

# 6. mailCheckNuevos pass conexion_id
check_old = '''            fetch('/app/api/mail/check/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf() }
            })'''
check_new = '''            fetch('/app/api/mail/check/', {
                method: 'POST',
                headers: { 'X-CSRFToken': csrf(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ conexion_id: _mailConexionId })
            })'''
text = text.replace(check_old, check_new)

# 7. mailSendEnviar pass conexion_id
send_old = '''            var payload = {
                para: document.getElementById('mailRedPara').value,
                asunto: document.getElementById('mailRedAsunto').value,
                cc: document.getElementById('mailRedCc').value,
                cuerpo_html: document.getElementById('mailRedTexto').value,
                cuerpo_texto: document.getElementById('mailRedTexto').value
            };'''
send_new = '''            var payload = {
                conexion_id: _mailConexionId,
                para: document.getElementById('mailRedPara').value,
                asunto: document.getElementById('mailRedAsunto').value,
                cc: document.getElementById('mailRedCc').value,
                cuerpo_html: document.getElementById('mailRedTexto').value,
                cuerpo_texto: document.getElementById('mailRedTexto').value
            };'''
text = text.replace(send_old, send_new)

# 8. Download attached file - pass conexion_id
dnl_old = '''        window.mailDescargarAdjunto = function (adjId, inline) {
            var url = '/app/api/mail/adjunto/' + adjId + '/';
            if (inline) url += '?inline=1';
            window.open(url, '_blank');
        };'''
dnl_new = '''        window.mailDescargarAdjunto = function (adjId, inline) {
            var url = '/app/api/mail/adjunto/' + adjId + '/';
            var params = [];
            if (inline) params.push('inline=1');
            if (_mailConexionId) params.push('conexion_id=' + _mailConexionId);
            if(params.length > 0) url += '?' + params.join('&');
            window.open(url, '_blank');
        };'''
text = text.replace(dnl_old, dnl_new)


with open('app/templates/crm/_scripts_mail.html', 'w') as f:
    f.write(text)

print("done")

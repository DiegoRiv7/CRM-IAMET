"""
PORTAL MAESTRO — puerta de entrada del producto multiempresa (Fase 5).

Corre EN EL HOST (fuera de las instancias) porque crea empresas con
scripts/nueva_empresa.sh (docker, nginx, certbot). Servicio systemd `crm-portal`,
gunicorn en 127.0.0.1:8090, nginx delante con HTTPS. Instalación: instalar_portal.sh.

Público:
  /                 portada: "Entrar a mi CRM" y "Crear mi empresa"
  /entrar           busca la empresa (nombre, slug o correo) y redirige a su login
  /registro         formulario de alta → solicitud (aprobación manual o automática)
  /solicitud/<tok>  estado de la solicitud (pendiente / creando / lista / error)
Interno (/panel, con contraseña de portal.env):
  solicitudes pendientes (aprobar / rechazar), empresas activas, baja, interruptor de
  aprobación automática y tope de capacidad.

Un hilo trabajador ejecuta las altas/bajas de una en una y guarda el log en SQLite.
"""
import hmac
import os
import re
import secrets
import sqlite3
import subprocess
import threading
import time
from datetime import datetime, timedelta

import yaml
from flask import (Flask, abort, flash, g, jsonify, redirect, render_template, request,
                   session, url_for)

# ── Configuración (portal.env → systemd EnvironmentFile) ────────────────────
CFG = {
    'SECRET': os.environ.get('PORTAL_SECRET') or secrets.token_hex(32),
    'ADMIN_USER': os.environ.get('PORTAL_ADMIN_USER', 'iamet'),
    'ADMIN_PASSWORD': os.environ.get('PORTAL_ADMIN_PASSWORD', ''),
    'APROBACION_AUTOMATICA': os.environ.get('PORTAL_APROBACION_AUTOMATICA', '0') == '1',
    'MAX_EMPRESAS': int(os.environ.get('PORTAL_MAX_EMPRESAS', '5')),
    'DOMINIO_BASE': os.environ.get('PORTAL_DOMINIO_BASE', '').strip().strip('.'),
    'IP': os.environ.get('PORTAL_IP', '82.223.44.29'),
    'SRC_DIR': os.environ.get('PORTAL_SRC_DIR', '/home/iamet2026/crm-producto'),
    'EMPRESAS_DIR': os.environ.get('PORTAL_EMPRESAS_DIR', '/home/iamet2026/crm-empresas'),
    'NOMBRE_PRODUCTO': os.environ.get('PORTAL_NOMBRE_PRODUCTO', 'IAMET CRM'),
    'HTTPS': os.environ.get('PORTAL_HTTPS', '1') == '1',
    'CONTACTO': os.environ.get('PORTAL_CONTACTO', 'ventas@iamet.mx'),
}
DB_PATH = os.path.join(CFG['EMPRESAS_DIR'], 'portal.db')
INVENTARIO = os.path.join(CFG['EMPRESAS_DIR'], 'empresas.yml')
SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9-]{1,29}$')
SLUGS_RESERVADOS = {'iamet', 'core', 'pruebas', 'demo-iamet', 'portal', 'www', 'admin', 'api', 'crm'}

app = Flask(__name__)
app.secret_key = CFG['SECRET']
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
                  SESSION_COOKIE_SECURE=CFG['HTTPS'], PERMANENT_SESSION_LIFETIME=timedelta(hours=12))


# ── Base de datos ───────────────────────────────────────────────────────────
def db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def _cerrar(_exc):
    d = g.pop('db', None)
    if d is not None:
        d.close()


def db_init():
    con = sqlite3.connect(DB_PATH)
    con.executescript('''
        CREATE TABLE IF NOT EXISTS solicitudes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'alta',        -- alta | baja
            slug TEXT NOT NULL,
            nombre TEXT NOT NULL DEFAULT '',
            nombre_corto TEXT NOT NULL DEFAULT '',
            responsable TEXT NOT NULL DEFAULT '',
            correo TEXT NOT NULL DEFAULT '',
            telefono TEXT NOT NULL DEFAULT '',
            admin_password TEXT,                      -- solo hasta que se crea la instancia
            purgar INTEGER NOT NULL DEFAULT 0,
            estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente|aprobada|creando|lista|error|rechazada
            log TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL DEFAULT '',
            mensaje TEXT NOT NULL DEFAULT '',
            ip TEXT NOT NULL DEFAULT '',
            creado_en TEXT NOT NULL,
            actualizado_en TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    ''')
    con.commit(); con.close()
    os.chmod(DB_PATH, 0o600)


def ahora():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def ajuste(clave, default):
    r = db().execute('SELECT valor FROM ajustes WHERE clave=?', (clave,)).fetchone()
    return r['valor'] if r else default


def set_ajuste(clave, valor):
    db().execute('INSERT INTO ajustes(clave, valor) VALUES(?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor', (clave, str(valor)))
    db().commit()


def aprobacion_automatica():
    return ajuste('aprobacion_automatica', '1' if CFG['APROBACION_AUTOMATICA'] else '0') == '1'


def max_empresas():
    try:
        return int(ajuste('max_empresas', str(CFG['MAX_EMPRESAS'])))
    except ValueError:
        return CFG['MAX_EMPRESAS']


# ── Inventario y URLs ───────────────────────────────────────────────────────
def inventario():
    try:
        with open(INVENTARIO) as f:
            return yaml.safe_load(f) or []
    except FileNotFoundError:
        return []


def empresas_activas():
    return [e for e in inventario() if e.get('activa', True)]


def host_de(slug, dominio=''):
    if dominio:
        return dominio
    if CFG['DOMINIO_BASE']:
        return f"{slug}.{CFG['DOMINIO_BASE']}"
    return f"{slug}.{CFG['IP'].replace('.', '-')}.nip.io"


def url_login(slug, dominio=''):
    return f"{'https' if CFG['HTTPS'] else 'http'}://{host_de(slug, dominio)}/app/login/"


def slug_desde(nombre):
    s = nombre.lower()
    for a, b in (('á', 'a'), ('é', 'e'), ('í', 'i'), ('ó', 'o'), ('ú', 'u'), ('ñ', 'n'), ('ü', 'u')):
        s = s.replace(a, b)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    for palabra in ('-sa-de-cv', '-s-a-de-c-v', '-sa', '-de-cv', '-s-de-rl', '-srl'):
        if s.endswith(palabra):
            s = s[: -len(palabra)]
    return s[:30].strip('-') or 'empresa'


def slug_en_uso(slug):
    if any(e['slug'] == slug for e in inventario()):
        return True
    r = db().execute("SELECT 1 FROM solicitudes WHERE tipo='alta' AND slug=? AND estado IN ('pendiente','aprobada','creando','lista')", (slug,)).fetchone()
    return bool(r)


def cupo_disponible():
    activas = len(empresas_activas())
    en_cola = db().execute("SELECT COUNT(*) c FROM solicitudes WHERE tipo='alta' AND estado IN ('pendiente','aprobada','creando')").fetchone()['c']
    return activas + en_cola < max_empresas(), activas, en_cola


# ── Anti-abuso sencillo ─────────────────────────────────────────────────────
_intentos = {}


def rate_ok(ip, limite=5, ventana=3600):
    t = time.time()
    _intentos[ip] = [x for x in _intentos.get(ip, []) if t - x < ventana]
    if len(_intentos[ip]) >= limite:
        return False
    _intentos[ip].append(t)
    return True


def csrf_token():
    if 'csrf' not in session:
        session['csrf'] = secrets.token_hex(16)
    return session['csrf']


def csrf_ok():
    return hmac.compare_digest(request.form.get('csrf', ''), session.get('csrf', '-'))


@app.context_processor
def _ctx():
    return {'CFG': CFG, 'csrf_token': csrf_token, 'es_admin': session.get('admin', False)}


# ── Público ─────────────────────────────────────────────────────────────────
@app.get('/favicon.ico')
def favicon():
    return ('', 204)


@app.get('/')
def index():
    return render_template('index.html', activas=len(empresas_activas()))


@app.route('/entrar', methods=['GET', 'POST'])
def entrar():
    resultados = None
    if request.method == 'POST':
        q = (request.form.get('q') or '').strip().lower()
        if q:
            resultados = []
            for e in empresas_activas():
                if q in e['slug'].lower() or q in e['nombre'].lower():
                    resultados.append(e)
            if not resultados and '@' in q:
                rows = db().execute("SELECT slug FROM solicitudes WHERE tipo='alta' AND estado='lista' AND lower(correo)=?", (q,)).fetchall()
                slugs = {r['slug'] for r in rows}
                dom = q.split('@')[-1]
                resultados = [e for e in empresas_activas() if e['slug'] in slugs]
                if not resultados:
                    # último recurso: dominio del correo coincide con el dominio configurado de la empresa
                    for e in empresas_activas():
                        if e.get('dominio') and dom in e['dominio']:
                            resultados.append(e)
            if len(resultados) == 1:
                e = resultados[0]
                return redirect(url_login(e['slug'], e.get('dominio', '')))
    return render_template('entrar.html', resultados=resultados, url_login=url_login)


@app.route('/registro', methods=['GET', 'POST'])
def registro():
    hay_cupo, activas, en_cola = cupo_disponible()
    if request.method == 'POST':
        if not csrf_ok():
            abort(400)
        if request.form.get('sitio_web_url'):  # honeypot
            abort(400)
        ip = request.headers.get('X-Real-IP') or request.remote_addr or ''
        f = {k: (request.form.get(k) or '').strip() for k in ('nombre', 'slug', 'responsable', 'correo', 'telefono', 'password', 'password2', 'suma')}
        errores = []
        if len(f['nombre']) < 3:
            errores.append('Escribe el nombre de la empresa.')
        slug = (f['slug'] or slug_desde(f['nombre'])).lower()
        if not SLUG_RE.match(slug) or slug in SLUGS_RESERVADOS:
            errores.append('El identificador solo puede llevar letras minúsculas, números y guiones (2 a 30 caracteres).')
        elif slug_en_uso(slug):
            errores.append(f'El identificador "{slug}" ya está en uso; elige otro.')
        if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', f['correo']):
            errores.append('Escribe un correo válido.')
        if len(f['responsable']) < 3:
            errores.append('Escribe el nombre del responsable.')
        if len(f['password']) < 8:
            errores.append('La contraseña debe tener al menos 8 caracteres.')
        elif f['password'] != f['password2']:
            errores.append('Las contraseñas no coinciden.')
        if str(session.get('suma_resp', '')) != f['suma']:
            errores.append('La suma de verificación no es correcta.')
        if not request.form.get('acepto'):
            errores.append('Debes aceptar los términos del servicio.')
        if not hay_cupo:
            errores.append('Por ahora no hay cupo para empresas nuevas; escríbenos y te avisamos.')
        if not rate_ok(ip):
            errores.append('Demasiados intentos desde esta conexión; inténtalo más tarde.')
        if errores:
            for e in errores:
                flash(e, 'error')
            return render_template('registro.html', f=f, slug_sugerido=slug, hay_cupo=hay_cupo, suma=_nueva_suma())
        token = secrets.token_urlsafe(24)
        estado = 'aprobada' if aprobacion_automatica() else 'pendiente'
        db().execute('''INSERT INTO solicitudes(token,tipo,slug,nombre,nombre_corto,responsable,correo,telefono,admin_password,estado,ip,creado_en,actualizado_en)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                     (token, 'alta', slug, f['nombre'][:120], f['nombre'].split(' ')[0][:40], f['responsable'][:120], f['correo'][:254],
                      f['telefono'][:40], f['password'], estado, ip, ahora(), ahora()))
        db().commit()
        session.pop('suma_resp', None)
        return redirect(url_for('solicitud', token=token))
    return render_template('registro.html', f={}, slug_sugerido='', hay_cupo=hay_cupo, suma=_nueva_suma())


def _nueva_suma():
    a, b = secrets.randbelow(8) + 1, secrets.randbelow(8) + 1
    session['suma_resp'] = a + b
    return f'{a} + {b}'


@app.get('/api/slug')
def api_slug():
    nombre = (request.args.get('nombre') or '').strip()
    s = slug_desde(nombre) if nombre else ''
    return jsonify({'slug': s, 'disponible': bool(s) and SLUG_RE.match(s) is not None and s not in SLUGS_RESERVADOS and not slug_en_uso(s)})


def _solicitud_por_token(token):
    r = db().execute('SELECT * FROM solicitudes WHERE token=?', (token,)).fetchone()
    if not r:
        abort(404)
    return r


@app.get('/solicitud/<token>')
def solicitud(token):
    s = _solicitud_por_token(token)
    return render_template('solicitud.html', s=s)


@app.get('/api/solicitud/<token>')
def api_solicitud(token):
    s = _solicitud_por_token(token)
    return jsonify({'estado': s['estado'], 'url': s['url'], 'mensaje': s['mensaje'],
                    'log': _log_limpio(s['log'])[-2500:], 'correo': s['correo']})


def _log_limpio(texto):
    return re.sub(r'\x1b\[[0-9;]*m', '', texto or '')


# ── Panel interno ───────────────────────────────────────────────────────────
def requiere_admin(f):
    from functools import wraps

    @wraps(f)
    def w(*a, **k):
        if not session.get('admin'):
            return redirect(url_for('panel_login', next=request.path))
        return f(*a, **k)
    return w


@app.route('/panel/login', methods=['GET', 'POST'])
def panel_login():
    if request.method == 'POST':
        if not csrf_ok():
            abort(400)
        ip = request.headers.get('X-Real-IP') or request.remote_addr or ''
        u = request.form.get('usuario', ''); p = request.form.get('password', '')
        if rate_ok('login:' + ip, limite=10, ventana=900) and CFG['ADMIN_PASSWORD'] and \
                hmac.compare_digest(u, CFG['ADMIN_USER']) and hmac.compare_digest(p, CFG['ADMIN_PASSWORD']):
            session['admin'] = True
            session.permanent = True
            return redirect(request.args.get('next') or url_for('panel'))
        flash('Usuario o contraseña incorrectos.', 'error')
    return render_template('panel_login.html')


@app.get('/panel/salir')
def panel_salir():
    session.pop('admin', None)
    return redirect(url_for('index'))


@app.get('/panel')
@requiere_admin
def panel():
    sols = db().execute("SELECT * FROM solicitudes ORDER BY id DESC LIMIT 100").fetchall()
    empresas = []
    for e in inventario():
        estado_web = _estado_contenedor(f"crm-{e['slug']}-web")
        empresas.append({**e, 'web': estado_web, 'url': url_login(e['slug'], e.get('dominio', ''))})
    hay_cupo, activas, en_cola = cupo_disponible()
    return render_template('panel.html', sols=sols, empresas=empresas, auto=aprobacion_automatica(),
                           maximo=max_empresas(), activas=activas, en_cola=en_cola, url_login=url_login)


def _estado_contenedor(nombre):
    try:
        out = subprocess.run(['docker', 'inspect', '-f', '{{.State.Status}}', nombre], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or '-'
    except Exception:
        return '?'


@app.post('/panel/solicitud/<int:sid>/<accion>')
@requiere_admin
def panel_accion(sid, accion):
    if not csrf_ok():
        abort(400)
    s = db().execute('SELECT * FROM solicitudes WHERE id=?', (sid,)).fetchone()
    if not s:
        abort(404)
    if accion == 'aprobar' and s['estado'] == 'pendiente':
        db().execute("UPDATE solicitudes SET estado='aprobada', actualizado_en=? WHERE id=?", (ahora(), sid))
        flash(f"Solicitud de {s['nombre']} aprobada: se crea en unos segundos.", 'ok')
    elif accion == 'rechazar' and s['estado'] in ('pendiente', 'error'):
        db().execute("UPDATE solicitudes SET estado='rechazada', admin_password=NULL, actualizado_en=? WHERE id=?", (ahora(), sid))
        flash(f"Solicitud de {s['nombre']} rechazada.", 'ok')
    elif accion == 'reintentar' and s['estado'] == 'error':
        db().execute("UPDATE solicitudes SET estado='aprobada', log='', mensaje='', actualizado_en=? WHERE id=?", (ahora(), sid))
        flash('Se reintentará el alta.', 'ok')
    else:
        flash('Acción no válida para ese estado.', 'error')
    db().commit()
    return redirect(url_for('panel'))


@app.post('/panel/ajustes')
@requiere_admin
def panel_ajustes():
    if not csrf_ok():
        abort(400)
    set_ajuste('aprobacion_automatica', '1' if request.form.get('auto') else '0')
    try:
        set_ajuste('max_empresas', max(1, min(50, int(request.form.get('maximo', max_empresas())))))
    except ValueError:
        pass
    flash('Ajustes guardados.', 'ok')
    return redirect(url_for('panel'))


@app.post('/panel/baja/<slug>')
@requiere_admin
def panel_baja(slug):
    if not csrf_ok():
        abort(400)
    if not SLUG_RE.match(slug) or not any(e['slug'] == slug for e in inventario()):
        abort(404)
    purgar = 1 if request.form.get('purgar') else 0
    db().execute('''INSERT INTO solicitudes(token,tipo,slug,nombre,purgar,estado,ip,creado_en,actualizado_en)
                    VALUES(?,?,?,?,?,?,?,?,?)''', (secrets.token_urlsafe(16), 'baja', slug, slug, purgar, 'aprobada', 'panel', ahora(), ahora()))
    db().commit()
    flash(f"Baja de {slug} en cola{' (con purga de datos)' if purgar else ' (datos conservados)'}.", 'ok')
    return redirect(url_for('panel'))


# ── Trabajador: altas y bajas de una en una ─────────────────────────────────
def _worker():
    time.sleep(3)
    while True:
        try:
            con = sqlite3.connect(DB_PATH, timeout=10); con.row_factory = sqlite3.Row
            s = con.execute("SELECT * FROM solicitudes WHERE estado='aprobada' ORDER BY id LIMIT 1").fetchone()
            if not s:
                con.close(); time.sleep(3); continue
            con.execute("UPDATE solicitudes SET estado='creando', log='', actualizado_en=? WHERE id=?", (ahora(), s['id']))
            con.commit()
            if s['tipo'] == 'baja':
                cmd = [os.path.join(CFG['SRC_DIR'], 'scripts', 'baja_empresa.sh'), s['slug'], '--si'] + (['--purge'] if s['purgar'] else [])
            else:
                cmd = [os.path.join(CFG['SRC_DIR'], 'scripts', 'nueva_empresa.sh'), s['slug'], '--nombre', s['nombre'],
                       '--correo', s['correo'], '--admin-email', s['correo'], '--admin-password', s['admin_password'] or secrets.token_hex(6)]
                if CFG['HTTPS']:
                    cmd.append('--https')
                if CFG['DOMINIO_BASE']:
                    cmd += ['--dominio', f"{s['slug']}.{CFG['DOMINIO_BASE']}"]
            log = []
            try:
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=CFG['SRC_DIR'])
                for linea in p.stdout:
                    log.append(linea.rstrip('\n'))
                    if len(log) % 3 == 0:
                        con.execute("UPDATE solicitudes SET log=?, actualizado_en=? WHERE id=?", ('\n'.join(log[-400:]), ahora(), s['id'])); con.commit()
                rc = p.wait(timeout=1200)
            except Exception as e:  # noqa: BLE001
                log.append(f'ERROR interno: {e}'); rc = 99
            texto = '\n'.join(log[-400:])
            if rc == 0:
                if s['tipo'] == 'baja':
                    con.execute("UPDATE solicitudes SET estado='lista', log=?, mensaje='Baja completada', actualizado_en=? WHERE id=?", (texto, ahora(), s['id']))
                else:
                    url = url_login(s['slug'], f"{s['slug']}.{CFG['DOMINIO_BASE']}" if CFG['DOMINIO_BASE'] else '')
                    con.execute("UPDATE solicitudes SET estado='lista', log=?, url=?, admin_password=NULL, actualizado_en=? WHERE id=?", (texto, url, ahora(), s['id']))
            else:
                msg = next((l for l in reversed(log) if 'ERROR' in l), 'El alta no terminó bien; revisa el registro.')
                con.execute("UPDATE solicitudes SET estado='error', log=?, mensaje=?, actualizado_en=? WHERE id=?", (texto, _log_limpio(msg)[:300], ahora(), s['id']))
            con.commit(); con.close()
        except Exception as e:  # noqa: BLE001
            print('worker:', e, flush=True)
            time.sleep(5)


def arrancar():
    os.makedirs(CFG['EMPRESAS_DIR'], exist_ok=True)
    db_init()
    # Reanudar lo que quedó a medias si el servicio se reinició
    con = sqlite3.connect(DB_PATH)
    con.execute("UPDATE solicitudes SET estado='aprobada' WHERE estado='creando'"); con.commit(); con.close()
    t = threading.Thread(target=_worker, daemon=True, name='portal-worker')
    t.start()


arrancar()

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8090, debug=False)

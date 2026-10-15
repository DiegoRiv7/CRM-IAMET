#!/bin/bash
# MULTIEMPRESA — funciones y rutas comunes de los scripts de operación.
# Se ejecuta EN EL SERVIDOR (82.223.44.29). Se carga con `source`.
#
# Rutas (todas sobreescribibles por variable de entorno):
#   SRC_DIR       árbol LIMPIO del código del producto (worktree en un commit).
#   EMPRESAS_DIR  datos de operación: .env.core, .env.<slug>, empresas.yml, nginx/.
set -o pipefail

SRC_DIR="${SRC_DIR:-/home/iamet2026/crm-producto}"
EMPRESAS_DIR="${EMPRESAS_DIR:-/home/iamet2026/crm-empresas}"
BACKUPS_DIR="${BACKUPS_DIR:-/home/iamet2026/backups/empresas}"
DEPLOY_DIR="$SRC_DIR/deploy/empresas"
CORE_ENV="$EMPRESAS_DIR/.env.core"
INVENTARIO="$EMPRESAS_DIR/empresas.yml"
IMAGEN_ACTUAL_FILE="$EMPRESAS_DIR/IMAGEN_ACTUAL"
PUERTO_BASE=8010          # 8000 prod, 8001 pruebas, 3005 sitio web
NGINX_AVAIL=/etc/nginx/sites-available
NGINX_ENABLED=/etc/nginx/sites-enabled

log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

validar_slug() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]{1,29}$ ]] || die "slug inválido '$1' (minúsculas, dígitos y guiones, 2-30 caracteres)"
  [[ "$1" == "iamet" || "$1" == "core" || "$1" == "pruebas" ]] && die "slug reservado: $1"
  return 0
}

aleatorio() { openssl rand -hex "${1:-16}"; }

cargar_core_env() {
  [[ -f "$CORE_ENV" ]] || die "Falta $CORE_ENV (lo crea nueva_empresa.sh la primera vez)"
  # shellcheck disable=SC1090
  set -a; source "$CORE_ENV"; set +a
  [[ -n "$MYSQL_ROOT_PASSWORD" ]] || die "MYSQL_ROOT_PASSWORD vacío en $CORE_ENV"
  IP_PUBLICA="${IP_PUBLICA:-82.223.44.29}"
}

# Ejecuta SQL como root en el MySQL compartido (la contraseña viaja por variable, no por argv).
mysql_root() {
  docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" crm-mysql mysql -uroot --batch --skip-column-names "$@"
}

compose_core() {
  docker compose -p crm-core --env-file "$CORE_ENV" -f "$DEPLOY_DIR/docker-compose.core.yml" "$@"
}

compose_tenant() {  # compose_tenant <slug> <args...>  (modelo viejo: un stack por empresa)
  local slug="$1"; shift
  docker compose -p "crm-$slug" --env-file "$EMPRESAS_DIR/.env.$slug" -f "$DEPLOY_DIR/docker-compose.tenant.yml" "$@"
}

# ── Multitenant bridge (Fase 6): UNA app para todas las empresas ──────────
BRIDGE_ENV="$EMPRESAS_DIR/.env.bridge"
CONTROL_ENV="$EMPRESAS_DIR/.env.control"
BRIDGE_PUERTO="${BRIDGE_PUERTO:-8009}"   # 8000 prod, 8001 pruebas, 8010+ tenants viejos

compose_bridge() {
  docker compose -p crm-bridge --env-file "$BRIDGE_ENV" -f "$DEPLOY_DIR/docker-compose.bridge.yml" "$@"
}

# Ejecuta manage.py DENTRO del contenedor compartido (o, si no está arriba, en
# un contenedor efímero con el mismo .env). Así el alta funciona aun antes del
# primer `up`.
#
# Reenvía los secretos de empresa que estén exportados (TENANT_*) sin pasarlos
# por argv. BRIDGE_RUN_OPTS permite opciones extra de docker (p. ej. montar un
# árbol de código al probar: BRIDGE_RUN_OPTS="-v /ruta:/app").
bridge_manage() {
  local -a sec=()
  local v
  for v in TENANT_DB_PASSWORD TENANT_SSO_SECRET TENANT_MAIL_KEY; do
    [[ -n "${!v:-}" ]] && sec+=(-e "$v=${!v}")
  done
  # shellcheck disable=SC2206
  local -a extra=(${BRIDGE_RUN_OPTS:-})
  if docker ps --format '{{.Names}}' | grep -qx crm-bridge-web; then
    docker exec "${sec[@]}" crm-bridge-web python manage.py "$@"
  else
    docker run --rm --network crm_tenants --env-file "$BRIDGE_ENV" "${sec[@]}" "${extra[@]}" \
      --entrypoint python "$(grep -E '^IMAGEN=' "$BRIDGE_ENV" | cut -d= -f2-)" manage.py "$@"
  fi
}

# Crea base + usuario con permisos SOLO sobre esa base. Idempotente.
crear_bd_empresa() {  # crear_bd_empresa <slug> <password>
  local slug="$1" pw="$2"
  mysql_root <<SQL
CREATE DATABASE IF NOT EXISTS \`crm_$slug\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'u_$slug'@'%' IDENTIFIED BY '$pw';
ALTER USER 'u_$slug'@'%' IDENTIFIED BY '$pw';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'u_$slug'@'%';
GRANT ALL PRIVILEGES ON \`crm_$slug\`.* TO 'u_$slug'@'%';
FLUSH PRIVILEGES;
SQL
}

# Secretos de una empresa: se guardan en $EMPRESAS_DIR/.secretos.<slug> (chmod 600)
# para poder re-correr el alta sin cambiarlos. Nunca viajan por argv.
cargar_o_crear_secretos() {  # cargar_o_crear_secretos <slug>  → exporta TENANT_DB_PASSWORD/SSO/MAIL
  # OJO: `local a="$1" b="...$a"` NO sirve — bash expande los argumentos del
  # builtin antes de ejecutarlo, así que $a todavía no existe (y con set -u, truena).
  local slug="$1"
  local f="$EMPRESAS_DIR/.secretos.$slug"
  if [[ -f "$f" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$f"; set +a
  else
    TENANT_DB_PASSWORD="$(aleatorio 16)"
    TENANT_SSO_SECRET="$(aleatorio 32)"
    TENANT_MAIL_KEY="$(bridge_manage shell -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())' 2>/dev/null | tail -1)"
    [[ -n "$TENANT_MAIL_KEY" ]] || die "no pude generar la llave de correo (¿imagen disponible?)"
    umask 077
    printf 'TENANT_DB_PASSWORD=%s\nTENANT_SSO_SECRET=%s\nTENANT_MAIL_KEY=%s\n' \
      "$TENANT_DB_PASSWORD" "$TENANT_SSO_SECRET" "$TENANT_MAIL_KEY" > "$f"
    export TENANT_DB_PASSWORD TENANT_SSO_SECRET TENANT_MAIL_KEY
  fi
}

asegurar_core() {
  log "Núcleo compartido (red crm_tenants + MySQL crm-mysql)"
  compose_core up -d >/dev/null
  local i
  for i in $(seq 1 60); do
    if docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" crm-mysql mysqladmin ping -h127.0.0.1 -uroot --silent >/dev/null 2>&1; then
      ok "MySQL compartido listo"; return 0
    fi
    sleep 2
  done
  die "crm-mysql no respondió en 120 s (docker logs crm-mysql)"
}

imagen_actual() {
  [[ -f "$IMAGEN_ACTUAL_FILE" ]] && cat "$IMAGEN_ACTUAL_FILE"
}

# Inventario empresas.yml (lista YAML). Requiere python3 + pyyaml en el host.
inventario_upsert() {  # inventario_upsert <slug> <nombre> <puerto> <dominio> <imagen>
  python3 - "$INVENTARIO" "$@" <<'PY'
import sys, yaml, datetime
ruta, slug, nombre, puerto, dominio, imagen = sys.argv[1:7]
try:
    data = yaml.safe_load(open(ruta)) or []
except FileNotFoundError:
    data = []
data = [e for e in data if e.get('slug') != slug]
data.append({'slug': slug, 'nombre': nombre, 'puerto': int(puerto), 'dominio': dominio,
             'imagen': imagen, 'alta': datetime.date.today().isoformat(), 'activa': True})
data.sort(key=lambda e: e['puerto'])
yaml.safe_dump(data, open(ruta, 'w'), allow_unicode=True, sort_keys=False)
PY
}

inventario_quitar() {  # inventario_quitar <slug>
  [[ -f "$INVENTARIO" ]] || return 0
  python3 - "$INVENTARIO" "$1" <<'PY'
import sys, yaml
ruta, slug = sys.argv[1:3]
data = [e for e in (yaml.safe_load(open(ruta)) or []) if e.get('slug') != slug]
yaml.safe_dump(data, open(ruta, 'w'), allow_unicode=True, sort_keys=False)
PY
}

inventario_puerto_de() {  # imprime el puerto registrado para el slug (vacío si no existe)
  [[ -f "$INVENTARIO" ]] || return 0
  python3 - "$INVENTARIO" "$1" <<'PY'
import sys, yaml
ruta, slug = sys.argv[1:3]
for e in (yaml.safe_load(open(ruta)) or []):
    if e.get('slug') == slug:
        print(e.get('puerto', '')); break
PY
}

siguiente_puerto_libre() {
  local p="$PUERTO_BASE" usados
  usados="$( { [[ -f "$INVENTARIO" ]] && python3 -c "import sys,yaml;print(' '.join(str(e['puerto']) for e in (yaml.safe_load(open('$INVENTARIO')) or [])))"; ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://'; } | tr '\n' ' ')"
  while grep -qw "$p" <<<"$usados"; do p=$((p+1)); done
  echo "$p"
}

esperar_web() {  # esperar_web <puerto> [segundos]
  local puerto="$1" max="${2:-150}" i code
  for i in $(seq 1 $((max/3))); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$puerto/app/login/" || true)
    if [[ "$code" == "200" || "$code" == "302" ]]; then ok "web responde $code en :$puerto"; return 0; fi
    sleep 3
  done
  return 1
}

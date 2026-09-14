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

compose_tenant() {  # compose_tenant <slug> <args...>
  local slug="$1"; shift
  docker compose -p "crm-$slug" --env-file "$EMPRESAS_DIR/.env.$slug" -f "$DEPLOY_DIR/docker-compose.tenant.yml" "$@"
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

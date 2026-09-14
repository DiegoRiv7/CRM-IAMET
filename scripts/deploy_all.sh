#!/bin/bash
# MULTIEMPRESA — Actualiza TODAS las empresas activas a una imagen nueva (Fase 4).
#
#   scripts/deploy_all.sh                      construye la imagen del HEAD del worktree y actualiza todas
#   scripts/deploy_all.sh --ref producto       primero mueve el worktree a esa rama/commit (git fetch si hay acceso)
#   scripts/deploy_all.sh --imagen crm-producto:abc123   usa una imagen ya construida
#   scripts/deploy_all.sh --solo demo          solo esa empresa
#   scripts/deploy_all.sh --continuar          no abortar si una empresa falla
#
# Por empresa: actualiza IMAGEN en su .env → `up -d` (el entrypoint migra al arrancar) →
# espera al login → verifica que no queden migraciones pendientes → registra la imagen en
# empresas.yml. Si una falla, se detiene (salvo --continuar) y deja las demás como estaban.
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
INICIO=$(date +%s)
REF=""; IMAGEN=""; SOLO=""; CONTINUAR=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2;;
    --imagen) IMAGEN="$2"; shift 2;;
    --solo) SOLO="$2"; shift 2;;
    --continuar) CONTINUAR=1; shift;;
    *) die "opción desconocida: $1";;
  esac
done
cargar_core_env
[[ -f "$INVENTARIO" ]] || die "No hay inventario $INVENTARIO (aún no se ha dado de alta ninguna empresa)"

# ── 1. Código e imagen ───────────────────────────────────────────────────
if [[ -n "$REF" ]]; then
  cd "$SRC_DIR"
  if git ls-remote --exit-code origin >/dev/null 2>&1; then
    git fetch -q origin && ok "git fetch origin"
  else
    warn "sin acceso a origin (llave del server no autorizada en GitHub): usando refs locales; trae el código con bundle si falta"
  fi
  git rev-parse --verify "$REF^{commit}" >/dev/null 2>&1 || die "ref desconocido: $REF"
  git checkout -q --detach "$REF"
  ok "worktree en $(git rev-parse --short HEAD) ($REF)"
fi
if [[ -z "$IMAGEN" ]]; then
  "$(dirname "$0")/construir_imagen.sh" | tail -1
  IMAGEN="$(imagen_actual)"
fi
docker image inspect "$IMAGEN" >/dev/null 2>&1 || die "la imagen $IMAGEN no existe"
log "Imagen a desplegar: $IMAGEN"

# ── 2. Empresas ──────────────────────────────────────────────────────────
SLUGS="$(python3 -c "import yaml;print(' '.join(e['slug'] for e in (yaml.safe_load(open('$INVENTARIO')) or []) if e.get('activa', True)))")"
[[ -n "$SOLO" ]] && SLUGS="$SOLO"
[[ -n "$SLUGS" ]] || die "no hay empresas activas en el inventario"
OK_LIST=(); FAIL_LIST=()
for SLUG in $SLUGS; do
  ENV_FILE="$EMPRESAS_DIR/.env.$SLUG"
  if [[ ! -f "$ENV_FILE" ]]; then warn "$SLUG: sin $ENV_FILE, se omite"; FAIL_LIST+=("$SLUG"); continue; fi
  PUERTO="$(grep -E '^PUERTO=' "$ENV_FILE" | cut -d= -f2-)"
  ANTES="$(grep -E '^IMAGEN=' "$ENV_FILE" | cut -d= -f2-)"
  log "[$SLUG] $ANTES → $IMAGEN (puerto $PUERTO)"
  sed -i -e "s|^IMAGEN=.*|IMAGEN=$IMAGEN|" "$ENV_FILE"
  if compose_tenant "$SLUG" up -d --remove-orphans >/dev/null 2>&1 && esperar_web "$PUERTO" 180; then
    PEND="$(docker exec "crm-$SLUG-web" python manage.py showmigrations --plan 2>/dev/null | grep -c '\[ \]' || true)"
    if [[ "${PEND:-0}" == "0" ]]; then
      ok "[$SLUG] actualizada, sin migraciones pendientes"
      NOMBRE="$(python3 -c "import yaml;print(next((e['nombre'] for e in yaml.safe_load(open('$INVENTARIO')) if e['slug']=='$SLUG'),''))")"
      DOMINIO="$(python3 -c "import yaml;print(next((e.get('dominio','') for e in yaml.safe_load(open('$INVENTARIO')) if e['slug']=='$SLUG'),''))")"
      inventario_upsert "$SLUG" "$NOMBRE" "$PUERTO" "$DOMINIO" "$IMAGEN"
      OK_LIST+=("$SLUG")
      continue
    fi
    warn "[$SLUG] arrancó pero quedan $PEND migraciones pendientes"
  else
    warn "[$SLUG] no respondió tras el despliegue"
    docker logs --tail 15 "crm-$SLUG-web" 2>&1 | sed 's/^/    /'
  fi
  FAIL_LIST+=("$SLUG")
  if [[ $CONTINUAR -eq 0 ]]; then
    warn "Regresando $SLUG a $ANTES y deteniendo el despliegue (usa --continuar para seguir con las demás)"
    sed -i -e "s|^IMAGEN=.*|IMAGEN=$ANTES|" "$ENV_FILE"
    compose_tenant "$SLUG" up -d --remove-orphans >/dev/null 2>&1 || true
    break
  fi
done

SEG=$(( $(date +%s) - INICIO ))
echo
printf '\033[1;32m══════ deploy_all: %d OK, %d con error, %d s ══════\033[0m\n' "${#OK_LIST[@]}" "${#FAIL_LIST[@]}" "$SEG"
[[ ${#OK_LIST[@]} -gt 0 ]] && echo "  OK:     ${OK_LIST[*]}"
[[ ${#FAIL_LIST[@]} -gt 0 ]] && echo "  ERROR:  ${FAIL_LIST[*]}" && exit 1
exit 0

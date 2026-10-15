#!/bin/bash
# MULTITENANT (Fase 6.4) — Despliega una imagen nueva en el CRM COMPARTIDO.
#
#   scripts/deploy_bridge.sh                     construye del HEAD del worktree y despliega
#   scripts/deploy_bridge.sh --ref producto      mueve el worktree a esa rama/commit y construye
#   scripts/deploy_bridge.sh --imagen crm-producto:abc  usa una imagen ya construida
#   scripts/deploy_bridge.sh --continuar         no abortar si una empresa falla al migrar
#
# A diferencia del modelo viejo (que levantaba N stacks), aquí hay UN solo
# contenedor: se actualiza una vez y luego se migra la base de CADA empresa.
# Si algo sale mal se regresa a la imagen anterior.
#
# Orden a propósito: primero la PLANTILLA (para que las altas nuevas nazcan al
# día), luego control, luego cada empresa.
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
INICIO=$(date +%s)

REF=""; IMAGEN=""; CONTINUAR=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2;;
    --imagen) IMAGEN="$2"; shift 2;;
    --continuar) CONTINUAR=1; shift;;
    *) die "opción desconocida: $1";;
  esac
done
[[ -f "$BRIDGE_ENV" ]] || die "Falta $BRIDGE_ENV: corre primero scripts/instalar_bridge.sh"
cargar_core_env

# ── 1. Código e imagen ───────────────────────────────────────────────────
if [[ -n "$REF" ]]; then
  cd "$SRC_DIR"
  if git ls-remote --exit-code origin >/dev/null 2>&1; then git fetch -q origin && ok "git fetch origin"
  else warn "sin acceso a origin: usando refs locales (trae el código por bundle si falta)"; fi
  git rev-parse --verify "$REF^{commit}" >/dev/null 2>&1 || die "ref desconocido: $REF"
  git checkout -q --detach "$REF"
  ok "worktree en $(git rev-parse --short HEAD) ($REF)"
fi
if [[ -z "$IMAGEN" ]]; then
  "$(dirname "$0")/construir_imagen.sh" | tail -1
  IMAGEN="$(imagen_actual)"
fi
docker image inspect "$IMAGEN" >/dev/null 2>&1 || die "la imagen $IMAGEN no existe"
ANTES="$(grep -E '^IMAGEN=' "$BRIDGE_ENV" | cut -d= -f2-)"
log "Imagen: $ANTES → $IMAGEN"

# ── 2. Levantar la app compartida con la imagen nueva ───────────────────
PUERTO="$(grep -E '^PUERTO=' "$BRIDGE_ENV" | cut -d= -f2-)"
sed -i -e "s|^IMAGEN=.*|IMAGEN=$IMAGEN|" "$BRIDGE_ENV"
compose_bridge up -d --remove-orphans >/dev/null
arriba=0
for i in $(seq 1 40); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/healthz/" || true)" == "200" ]] && { arriba=1; break; }
  sleep 3
done
if [[ $arriba -eq 0 ]]; then
  docker logs --tail 30 crm-bridge-web 2>&1 | sed 's/^/    /'
  warn "la app no arrancó: regresando a $ANTES"
  sed -i -e "s|^IMAGEN=.*|IMAGEN=$ANTES|" "$BRIDGE_ENV"
  compose_bridge up -d >/dev/null || true
  die "despliegue abortado (nada se migró)"
fi
ok "app compartida arriba con $IMAGEN"

# ── 3. Migraciones: plantilla, control y cada empresa ───────────────────
log "Plantilla al día (para que las altas nuevas nazcan con el esquema nuevo)"
asegurar_plantilla
log "BD de control"
bridge_manage migrate --database control --noinput 2>&1 | tail -2 | sed 's/^/  /'

SLUGS="$(bridge_manage shell -c 'from tenants.models import Tenant;print(" ".join(Tenant.objects.filter(activo=True).values_list("slug",flat=True)))' 2>/dev/null | tail -1)"
log "Empresas activas: ${SLUGS:-(ninguna)}"
OK_LIST=(); FAIL_LIST=()
for SLUG in $SLUGS; do
  if bridge_manage tenant_run "$SLUG" migrate --noinput >/dev/null 2>&1; then
    PEND="$(bridge_manage tenant_run "$SLUG" showmigrations --plan 2>/dev/null | grep -c '\[ \]' || true)"
    if [[ "${PEND:-0}" == "0" ]]; then ok "[$SLUG] al día"; OK_LIST+=("$SLUG"); continue; fi
    warn "[$SLUG] quedan $PEND migraciones pendientes"
  else
    warn "[$SLUG] falló al migrar"
  fi
  FAIL_LIST+=("$SLUG")
  [[ $CONTINUAR -eq 0 ]] && { warn "deteniendo (usa --continuar para seguir con las demás)"; break; }
done

SEG=$(( $(date +%s) - INICIO ))
echo
printf '\033[1;32m══════ deploy_bridge: %d empresas al día, %d con error, %d s ══════\033[0m\n' "${#OK_LIST[@]}" "${#FAIL_LIST[@]}" "$SEG"
[[ ${#FAIL_LIST[@]} -gt 0 ]] && { echo "  ERROR: ${FAIL_LIST[*]}"; echo "  La app quedó en $IMAGEN; revisa esas empresas (sus datos no se tocaron)."; exit 1; }
exit 0

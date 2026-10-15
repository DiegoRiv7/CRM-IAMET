#!/bin/bash
# MULTITENANT (Fase 6.4) — Pasa las empresas del modelo VIEJO (un contenedor por
# empresa) al CRM COMPARTIDO. Idempotente y SIN mover sus datos: cada empresa ya
# vive en su propia base (crm_<slug>), así que solo hay que registrarla en
# control y copiar su media a la carpeta compartida.
#
#   scripts/migrar_a_bridge.sh                 registra todas las empresas activas (no apaga nada)
#   scripts/migrar_a_bridge.sh --solo demo     solo esa
#   scripts/migrar_a_bridge.sh --apagar        además detiene sus contenedores viejos
#   scripts/migrar_a_bridge.sh --apagar --borrar-contenedores   los elimina (la base NO se toca)
#
# Lo que hace por empresa:
#   1. lee sus secretos del .env.<slug> (contraseña de BD, SSO, llave de correo)
#      y los guarda en .secretos.<slug> para que el resto de scripts los reuse
#   2. la registra en la BD de control con sus hostnames (nip.io y dominio propio)
#   3. copia su media del volumen crm-<slug>_media a la carpeta <slug>/ del
#      volumen compartido (el storage del bridge separa por carpeta)
#   4. verifica que la app compartida la sirva por su hostname
#   5. con --apagar, detiene sus contenedores (la base y la media quedan intactas)
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
INICIO=$(date +%s)

SOLO=""; APAGAR=0; BORRAR=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --solo) SOLO="$2"; shift 2;;
    --apagar) APAGAR=1; shift;;
    --borrar-contenedores) BORRAR=1; APAGAR=1; shift;;
    *) die "opción desconocida: $1";;
  esac
done

[[ -f "$BRIDGE_ENV" ]] || die "Falta $BRIDGE_ENV: corre primero scripts/instalar_bridge.sh"
cargar_core_env
PUERTO_BRIDGE="$(grep -E '^PUERTO=' "$BRIDGE_ENV" | cut -d= -f2-)"
VOL_BRIDGE="${VOL_BRIDGE:-crm-bridge_media}"

if [[ -n "$SOLO" ]]; then
  SLUGS="$SOLO"
else
  [[ -f "$INVENTARIO" ]] || die "No hay inventario $INVENTARIO"
  SLUGS="$(python3 -c "import yaml;print(' '.join(e['slug'] for e in (yaml.safe_load(open('$INVENTARIO')) or []) if e.get('activa', True)))")"
fi
[[ -n "$SLUGS" ]] || die "no hay empresas que migrar"
log "Empresas a migrar: $SLUGS"

OK_LIST=(); FAIL_LIST=()
for SLUG in $SLUGS; do
  echo
  log "══ $SLUG ══"
  ENV_FILE="$EMPRESAS_DIR/.env.$SLUG"
  if [[ ! -f "$ENV_FILE" ]]; then warn "$SLUG: sin $ENV_FILE, se omite"; FAIL_LIST+=("$SLUG"); continue; fi

  # ── 1. Secretos existentes → .secretos.<slug> (se CONSERVAN, no se regeneran) ──
  valor() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
  DB_PW="$(valor DB_PASSWORD)"; SSO="$(valor PORTAL_SSO_SECRET)"; MAILK="$(valor MAIL_ENCRYPTION_KEY)"
  DB_NAME="$(valor DB_NAME)"; DB_USER="$(valor DB_USER)"
  DB_NAME="${DB_NAME:-crm_$SLUG}"; DB_USER="${DB_USER:-u_$SLUG}"
  if [[ -z "$DB_PW" ]]; then warn "$SLUG: sin DB_PASSWORD en su .env, se omite"; FAIL_LIST+=("$SLUG"); continue; fi
  SEC="$EMPRESAS_DIR/.secretos.$SLUG"
  if [[ ! -f "$SEC" ]]; then
    umask 077
    printf 'TENANT_DB_PASSWORD=%s\nTENANT_SSO_SECRET=%s\nTENANT_MAIL_KEY=%s\n' "$DB_PW" "$SSO" "$MAILK" > "$SEC"
    ok "secretos guardados en $SEC (los mismos de siempre: su correo cifrado sigue leyéndose)"
  else
    ok "secretos ya guardados"
  fi
  export TENANT_DB_PASSWORD="$DB_PW" TENANT_SSO_SECRET="$SSO" TENANT_MAIL_KEY="$MAILK"

  # ── 2. Hostnames: el nip.io de siempre y, si tiene, su dominio propio ──
  NIP="$SLUG.$(tr . - <<<"$IP_PUBLICA").nip.io"
  DOMINIO="$(python3 -c "import yaml;print(next((e.get('dominio','') or '' for e in (yaml.safe_load(open('$INVENTARIO')) or []) if e['slug']=='$SLUG'),''))" 2>/dev/null || true)"
  NOMBRE="$(python3 -c "import yaml;print(next((e['nombre'] for e in (yaml.safe_load(open('$INVENTARIO')) or []) if e['slug']=='$SLUG'),''))" 2>/dev/null || true)"
  ARGS=("$SLUG" --host "$NIP" --db-name "$DB_NAME" --db-user "$DB_USER")
  [[ -n "$NOMBRE" ]] && ARGS+=(--nombre "$NOMBRE")
  [[ -n "$DOMINIO" ]] && ARGS+=(--host "$DOMINIO")
  log "Registrando en control (sus datos NO se mueven: ya están en $DB_NAME)"
  bridge_manage tenant_alta "${ARGS[@]}" | sed 's/^/  /'

  # ── 2b. Poner su esquema al día ──
  # Su base la creó una imagen anterior; la app compartida corre código nuevo,
  # así que puede faltarle alguna columna. Sus DATOS no se tocan: migrate solo
  # aplica lo que falte (y si ya está al día, no hace nada).
  log "Aplicando migraciones pendientes de $SLUG (sus datos no se tocan)"
  if bridge_manage tenant_run "$SLUG" migrate --noinput >/dev/null 2>&1; then
    PEND="$(bridge_manage tenant_run "$SLUG" showmigrations --plan 2>/dev/null | grep -c '\[ \]' || true)"
    [[ "${PEND:-0}" == "0" ]] && ok "esquema al día" || warn "quedan $PEND migraciones pendientes"
  else
    warn "$SLUG: falló el migrate — NO se apaga nada de esta empresa"
    FAIL_LIST+=("$SLUG"); continue
  fi

  # ── 3. Media: del volumen propio a la carpeta <slug>/ del volumen compartido ──
  VOL_VIEJO="crm-${SLUG}_media"
  if docker volume inspect "$VOL_VIEJO" >/dev/null 2>&1; then
    log "Copiando media de $VOL_VIEJO → $VOL_BRIDGE/$SLUG/"
    docker run --rm -v "$VOL_VIEJO":/orig:ro -v "$VOL_BRIDGE":/dest alpine \
      sh -c "mkdir -p /dest/$SLUG && cp -a /orig/. /dest/$SLUG/ 2>/dev/null; echo \$(find /dest/$SLUG -type f | wc -l) archivos" | sed 's/^/  /'
  else
    warn "sin volumen $VOL_VIEJO (nada que copiar)"
  fi

  # ── 4. Verificación por hostname contra la app compartida ──
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -H "Host: $NIP" "http://127.0.0.1:$PUERTO_BRIDGE/app/login/" || true)
  if [[ "$CODE" == "200" || "$CODE" == "302" ]]; then
    ok "la app compartida sirve $SLUG por $NIP (HTTP $CODE)"
  else
    warn "la app compartida devolvió $CODE para $NIP — NO se apaga nada de esta empresa"
    FAIL_LIST+=("$SLUG"); continue
  fi

  # ── 5. Apagar lo viejo (solo si la verificación pasó) ──
  if [[ $APAGAR -eq 1 ]]; then
    for C in "crm-$SLUG-web" "crm-$SLUG-mailsync"; do
      if docker inspect "$C" >/dev/null 2>&1; then
        docker stop "$C" >/dev/null 2>&1 && ok "$C detenido"
        if [[ $BORRAR -eq 1 ]]; then docker rm "$C" >/dev/null 2>&1 && ok "$C eliminado (su base y su media siguen intactas)"; fi
      fi
    done
    # El vhost propio ya no hace falta: el comodín del bridge cubre el nip.io.
    if [[ -L "$NGINX_ENABLED/crm-$SLUG.conf" ]] && ! grep -q "managed by Certbot" "$NGINX_AVAIL/crm-$SLUG.conf" 2>/dev/null; then
      rm -f "$NGINX_ENABLED/crm-$SLUG.conf"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "vhost propio retirado (lo cubre el comodín)"
    fi
  fi
  OK_LIST+=("$SLUG")
done

SEG=$(( $(date +%s) - INICIO ))
echo
printf '\033[1;32m══════ migrar_a_bridge: %d OK, %d con error, %d s ══════\033[0m\n' "${#OK_LIST[@]}" "${#FAIL_LIST[@]}" "$SEG"
[[ ${#OK_LIST[@]} -gt 0 ]] && echo "  OK:     ${OK_LIST[*]}"
[[ ${#FAIL_LIST[@]} -gt 0 ]] && echo "  ERROR:  ${FAIL_LIST[*]}"
[[ $APAGAR -eq 0 ]] && echo "  (nada se apagó: corre otra vez con --apagar cuando lo hayas revisado)"
[[ ${#FAIL_LIST[@]} -gt 0 ]] && exit 1
exit 0

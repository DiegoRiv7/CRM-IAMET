#!/bin/bash
# MULTIEMPRESA — Construye la imagen del producto desde un árbol LIMPIO.
#
#   scripts/construir_imagen.sh [commit|rama]   (default: HEAD del worktree)
#
# - Usa $SRC_DIR (worktree de git en un commit, sin cambios sueltos).
# - Build ACOTADO (--cpuset-cpus 2,3 --memory 3g) para no alentar el CRM de
#   producción que vive en el mismo servidor.
# - Etiqueta crm-producto:<sha corto> y la deja en $EMPRESAS_DIR/IMAGEN_ACTUAL
#   para que nueva_empresa.sh la use por defecto.
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
mkdir -p "$EMPRESAS_DIR"

[[ -d "$SRC_DIR/.git" || -f "$SRC_DIR/.git" ]] || die "$SRC_DIR no es un checkout de git (crea el worktree primero, ver deploy/empresas/README.md)"
cd "$SRC_DIR"

if [[ -n "${1:-}" ]]; then
  git rev-parse --verify "$1^{commit}" >/dev/null 2>&1 || die "commit/rama desconocido: $1"
  git checkout -q --detach "$1"
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  die "El árbol $SRC_DIR tiene cambios sin commitear; la imagen debe salir de un commit limpio"
fi
SHA="$(git rev-parse --short HEAD)"
TAG="crm-producto:$SHA"

if pgrep -f "docker build" >/dev/null 2>&1; then
  die "Hay otro 'docker build' en curso en el servidor; espera a que termine para no saturar la CPU"
fi

log "Construyendo $TAG desde $SRC_DIR ($(git log -1 --format='%s' | cut -c1-60))"
docker build --cpuset-cpus="2,3" --memory=3g -t "$TAG" . | tail -3
docker tag "$TAG" crm-producto:latest
echo "$TAG" > "$IMAGEN_ACTUAL_FILE"
ok "Imagen lista: $TAG (guardada como imagen actual)"

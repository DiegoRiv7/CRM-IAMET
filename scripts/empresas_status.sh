#!/bin/bash
# MULTIEMPRESA — Estado de todas las empresas: contenedores, imagen, migraciones, URL.
set -uo pipefail
source "$(dirname "$0")/empresas_lib.sh"
cargar_core_env
echo "Imagen actual: $(imagen_actual)   |   MySQL: $(docker inspect -f '{{.State.Status}}' crm-mysql 2>/dev/null || echo 'apagado')"
printf '%-12s %-26s %-6s %-24s %-9s %-9s %-5s %s\n' SLUG NOMBRE PUERTO IMAGEN WEB MAILSYNC MIGR URL
python3 -c "import yaml;[print(e['slug'],'|',e['nombre'],'|',e['puerto'],'|',e.get('imagen',''),'|',e.get('dominio','') or '', '|', 'si' if e.get('activa',True) else 'no') for e in (yaml.safe_load(open('$INVENTARIO')) or [])]" 2>/dev/null | while IFS='|' read -r slug nombre puerto imagen dominio activa; do
  slug="$(echo $slug)"; puerto="$(echo $puerto)"; imagen="$(echo $imagen)"; dominio="$(echo $dominio)"
  web="$(docker inspect -f '{{.State.Status}}' "crm-$slug-web" 2>/dev/null || echo '-')"
  ms="$(docker inspect -f '{{.State.Status}}' "crm-$slug-mailsync" 2>/dev/null || echo '-')"
  migr='-'; [[ "$web" == "running" ]] && { migr="$(docker exec "crm-$slug-web" python manage.py showmigrations --plan 2>/dev/null | grep -c '\[ \]' || true)"; [[ -z "$migr" ]] && migr='?'; }
  url="https://${dominio:-$slug.$(tr . - <<<"$IP_PUBLICA").nip.io}/app/login/"
  [[ "$(echo $activa)" == "no" ]] && web="(baja)"
  printf '%-12s %-26s %-6s %-24s %-9s %-9s %-5s %s\n' "$slug" "$(echo $nombre | cut -c1-26)" "$puerto" "${imagen#crm-producto:}" "$web" "$ms" "$migr" "$url"
done

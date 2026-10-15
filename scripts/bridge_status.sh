#!/bin/bash
# MULTITENANT (Fase 6.4) — Estado del CRM COMPARTIDO y de sus empresas.
#   scripts/bridge_status.sh
set -euo pipefail
source "$(dirname "$0")/empresas_lib.sh"
cargar_core_env
[[ -f "$BRIDGE_ENV" ]] || die "Falta $BRIDGE_ENV: corre scripts/instalar_bridge.sh"
PUERTO="$(grep -E '^PUERTO=' "$BRIDGE_ENV" | cut -d= -f2-)"
IMAGEN="$(grep -E '^IMAGEN=' "$BRIDGE_ENV" | cut -d= -f2-)"

est() { docker inspect -f '{{.State.Status}}' "$1" 2>/dev/null || echo '-'; }
mem() { docker stats --no-stream --format '{{.MemUsage}}' "$1" 2>/dev/null || echo '-'; }

echo "CRM compartido  : $(est crm-bridge-web)  ·  imagen $IMAGEN  ·  :$PUERTO  ·  salud $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PUERTO/healthz/" || echo '000')"
echo "Correo (1 worker): $(est crm-bridge-mailsync)"
echo "MySQL           : $(est crm-mysql)"
echo "Memoria total   : $(mem crm-bridge-web)   ← para TODAS las empresas"
echo "Plantilla       : $PLANTILLA_DB ($(tablas_de "$PLANTILLA_DB" 2>/dev/null || echo '?') tablas)"
echo
printf '%-14s %-26s %-16s %-7s %-6s %s\n' SLUG NOMBRE BASE TABLAS HTTP HOSTNAME
printf '%s\n' "----------------------------------------------------------------------------------------"
bridge_manage shell -c '
from tenants.models import Tenant
for t in Tenant.objects.filter(activo=True).prefetch_related("hosts").order_by("slug"):
    print(t.slug, t.nombre, t.db_name, (t.hosts.first().hostname if t.hosts.exists() else "-"), sep="\t")
' 2>/dev/null | grep -P '^\S+\t' | while IFS=$'\t' read -r slug nombre base host; do
  tabs="$(tablas_de "$base" 2>/dev/null || echo '?')"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -H "Host: $host" "http://127.0.0.1:$PUERTO/app/login/" || echo '000')"
  printf '%-14s %-26s %-16s %-7s %-6s %s\n' "$slug" "$(cut -c1-26 <<<"$nombre")" "$base" "$tabs" "$code" "$host"
done

echo
echo "Contenedores del modelo VIEJO que sigan vivos (ya no hacen falta):"
docker ps --format '{{.Names}}' | grep -E '^crm-[a-z0-9-]+-(web|mailsync)$' | grep -v '^crm-bridge-' | grep -v '^crm-pruebas-' | sed 's/^/  /' || echo "  (ninguno)"

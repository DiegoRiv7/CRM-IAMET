"""
Reporte de proyectos Bitrix NO vinculados a ninguna oportunidad.

Por cada grupo sin vincular consulta su drive y clasifica:
  - VACÍO   : 0 archivos en drive (descartar)
  - CON DRIVE: ≥1 archivos (candidatos a vinculación manual o fase extra)

Salida en pantalla igual al estilo del resto de comandos.

Uso:
    python manage.py report_unlinked_projects
    python manage.py report_unlinked_projects --limit 100   # solo primeros N sin vincular
    python manage.py report_unlinked_projects --csv reporte.csv
"""

import csv
import os
import re
import time

import requests
from django.core.management.base import BaseCommand

from app.models import OportunidadProyecto

WEBHOOK_BASE = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)


# ── API helpers ────────────────────────────────────────────────────────────────

def _base():
    return WEBHOOK_BASE.rsplit("/", 1)[0] + "/"


def _call(endpoint, payload=None, retries=3):
    url = _base() + endpoint + ".json"
    for attempt in range(retries):
        try:
            resp = requests.post(url, json=payload or {}, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                return {}
            return data
        except requests.RequestException:
            if attempt == retries - 1:
                return {}
            time.sleep(2 ** attempt)
    return {}


def _pages(endpoint, payload):
    records, start = [], 0
    while True:
        p = dict(payload, start=start)
        data = _call(endpoint, p)
        batch = data.get("result") or []
        if not batch:
            break
        records.extend(batch)
        if len(records) >= data.get("total", 0):
            break
        start += 50
    return records


# ── Contar archivos en drive de un grupo ──────────────────────────────────────

def _count_files(group_id) -> int:
    """Cuenta archivos en el drive del grupo (sin bajar el contenido)."""
    try:
        storage_data = _call("disk.storage.getlist",
                              {"filter": {"ENTITY_TYPE": "group", "ENTITY_ID": group_id}})
        storages = (storage_data.get("result") or [])
        if not storages:
            return 0
        storage_id = storages[0]["ID"]
        root = _call("disk.storage.getchildren", {"id": storage_id}).get("result") or []
        return _count_recursive(root, depth=0)
    except Exception:
        return -1  # -1 = error al consultar


def _count_recursive(items, depth) -> int:
    if depth > 6:
        return 0
    total = 0
    for item in items:
        t = (item.get("TYPE") or "").lower()
        if t == "folder":
            try:
                sub = _call("disk.folder.getchildren", {"id": item["ID"]}).get("result") or []
                total += _count_recursive(sub, depth + 1)
            except Exception:
                pass
        else:
            total += 1
    return total


# ── Extraer cliente sugerido del nombre del grupo ─────────────────────────────

_PO_RE = re.compile(r'\bPO\b', re.IGNORECASE)


def _sugerir_cliente(nombre: str) -> str:
    """Extrae el prefijo antes de 'PO', '//' o primer espacio largo."""
    for sep in ('//', ' PO ', ' po ', '//'):
        if sep in nombre:
            return nombre.split(sep)[0].strip()
    # Si contiene "PO" como palabra, tomar lo que está antes
    m = _PO_RE.search(nombre)
    if m:
        return nombre[:m.start()].strip()
    # Sin pistas: primeras 2 palabras
    parts = nombre.split()
    return ' '.join(parts[:2]) if len(parts) >= 2 else nombre


# ── Comando ───────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Reporte de proyectos Bitrix sin vincular: cuántos tienen drive y cuántos están vacíos'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit', type=int, default=0,
            help='Procesar solo los primeros N grupos sin vincular (0 = todos)'
        )
        parser.add_argument(
            '--csv', type=str, default='',
            help='Ruta de archivo CSV donde guardar el reporte (opcional)'
        )

    def handle(self, *args, **options):
        limit = options['limit']
        csv_path = options['csv']

        # IDs de grupos ya vinculados en el sistema
        vinculados_ids = set(
            OportunidadProyecto.objects.values_list('proyecto__bitrix_group_id', flat=True)
            .exclude(proyecto__bitrix_group_id=None)
        )
        self.stdout.write(f"Grupos ya vinculados en DB: {len(vinculados_ids)}")

        # Traer todos los grupos de Bitrix
        self.stdout.write("Descargando lista de grupos Bitrix...")
        grupos = _pages("sonet_group.get", {"select": ["ID", "NAME"]})
        self.stdout.write(f"Grupos totales en Bitrix: {len(grupos)}\n")

        # Filtrar los NO vinculados
        sin_vincular = [g for g in grupos if int(g["ID"]) not in vinculados_ids]
        self.stdout.write(f"Sin vincular: {len(sin_vincular)}")

        if limit:
            sin_vincular = sin_vincular[:limit]
            self.stdout.write(f"(Procesando primeros {limit})\n")
        else:
            self.stdout.write("")

        con_drive = []
        vacios = []
        errores_api = []

        total = len(sin_vincular)
        for i, grupo in enumerate(sin_vincular, 1):
            gid = int(grupo["ID"])
            nombre = (grupo.get("NAME") or f"Grupo {gid}").strip()
            n_archivos = _count_files(gid)

            prefix = f"[{total - i + 1:>4}]"
            if n_archivos == -1:
                self.stdout.write(f"{prefix} ⚠ error API : {nombre[:80]}")
                errores_api.append({'id': gid, 'nombre': nombre, 'archivos': 'error'})
            elif n_archivos == 0:
                self.stdout.write(f"{prefix} ○ vacío     : {nombre[:80]}")
                vacios.append({'id': gid, 'nombre': nombre, 'archivos': 0,
                               'cliente': _sugerir_cliente(nombre)})
            else:
                self.stdout.write(
                    f"{prefix} ● {n_archivos:>4} archivos: {nombre[:70]}"
                )
                con_drive.append({'id': gid, 'nombre': nombre, 'archivos': n_archivos,
                                  'cliente': _sugerir_cliente(nombre)})

        # ── Resumen ───────────────────────────────────────────────────────────
        self.stdout.write("\n" + "─" * 60)
        self.stdout.write(f"Total sin vincular analizados : {total}")
        self.stdout.write(f"○ Drive vacío (descartar)      : {len(vacios)}")
        self.stdout.write(f"● Con archivos (rescatables)   : {len(con_drive)}")
        self.stdout.write(f"⚠ Error al consultar API       : {len(errores_api)}")

        if con_drive:
            total_arch = sum(r['archivos'] for r in con_drive)
            self.stdout.write(f"\nArchivos totales rescatables   : {total_arch}")
            self.stdout.write("\nTop 20 con más archivos:")
            for r in sorted(con_drive, key=lambda x: x['archivos'], reverse=True)[:20]:
                self.stdout.write(
                    f"  [{r['archivos']:>4}] {r['nombre'][:70]}"
                    f"  (cliente: {r['cliente'][:20]})"
                )

        # ── CSV opcional ──────────────────────────────────────────────────────
        if csv_path:
            all_rows = con_drive + vacios + errores_api
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=['id', 'nombre', 'archivos', 'cliente'])
                writer.writeheader()
                for row in all_rows:
                    writer.writerow({
                        'id': row.get('id', ''),
                        'nombre': row.get('nombre', ''),
                        'archivos': row.get('archivos', ''),
                        'cliente': row.get('cliente', ''),
                    })
            self.stdout.write(f"\nCSV guardado en: {csv_path}")

        self.stdout.write("\n=== FIN REPORTE ===")

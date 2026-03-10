"""
Sincroniza proyectos y drive de Bitrix24 vinculando oportunidades en 3 fases:

  FASE 1 — Documento compartido
    El nombre de un archivo en el drive del proyecto coincide (normalizado)
    con el nombre_cotizacion de alguna Cotizacion del sistema.
    Normalización: quitar extensión, quitar sufijo Bitrix " (N)", minúsculas, strip.

  FASE 2 — Número PO
    El nombre del proyecto contiene un número PO (≥4 dígitos tras "PO")
    y alguna oportunidad menciona ese mismo número.

  FASE 3 — Nombre
    El nombre limpio del proyecto coincide exactamente o está contenido
    en el nombre de una oportunidad (mínimo 8 caracteres).

Para que el vínculo no se mezcle:
  - Un proyecto sin match en Fase 1 NO lleva archivos (se saltan sus archivos).
  - Si Fase 2 o Fase 3 lo vinculan, SÍ se importan sus archivos.
  - Los archivos de proyectos sin ningún vínculo NO se guardan (Drive limpio).

Uso:
    python manage.py sync_bitrix_drive_smart --dry-run
    python manage.py sync_bitrix_drive_smart --reset --dry-run
    python manage.py sync_bitrix_drive_smart --reset
    python manage.py sync_bitrix_drive_smart --group-ids 1234 5678
"""

import os
import re
import time
import requests
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.db import connection
from django.utils.dateparse import parse_datetime

from app.models import (
    Proyecto, TodoItem, Cotizacion, OportunidadProyecto,
    CarpetaOportunidad, ArchivoOportunidad,
)

WEBHOOK_BASE = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)


# ── API helpers ───────────────────────────────────────────────────────────────

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
                raise ValueError(f"Bitrix: {data['error']} – {data.get('error_description','')}")
            return data
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
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


# ── Normalización de nombre de archivo ───────────────────────────────────────

_EXT_RE = re.compile(r'\.[a-zA-Z0-9]{2,5}$')
_VERSION_RE = re.compile(r'\s*\(\d+\)\s*$')


def _norm(name: str) -> str:
    """Quita extensión, sufijo Bitrix (N), pasa a minúsculas y strip."""
    s = _EXT_RE.sub('', name.strip())
    s = _VERSION_RE.sub('', s)
    return s.lower().strip()


# ── Catálogo de cotizaciones del sistema ─────────────────────────────────────

def _build_cotizacion_index():
    """
    Devuelve dict: nombre_normalizado → TodoItem
    Usa nombre_cotizacion (campo personalizado) y también titulo como fallback.
    """
    index = {}
    for cot in Cotizacion.objects.select_related('oportunidad').exclude(oportunidad=None):
        names = []
        if cot.nombre_cotizacion:
            names.append(cot.nombre_cotizacion)
        if cot.titulo and cot.titulo != "Cotización":
            names.append(cot.titulo)
        for n in names:
            key = _norm(n)
            if key and len(key) >= 4:
                index[key] = cot.oportunidad
    return index


# ── Matching helpers ──────────────────────────────────────────────────────────
#
# Prioridad (de más a menos confiable):
#   1. Nombre exacto completo  — proyecto == oportunidad (sin limpiar)
#   2. Número largo compartido — ≥7 dígitos seguidos en ambos títulos
#   3. Documento compartido    — archivo del drive == nombre_cotizacion del sistema
#   4. Nombre limpio           — nombre sin prefijo PO/RFQ contenido en oportunidad
# ─────────────────────────────────────────────────────────────────────────────

# Regex para extraer todos los números ≥7 dígitos de un texto (PO, OC, serial, etc.)
_NUM_RE = re.compile(r'\b(\d{7,})\b')


def _extract_numbers(text: str) -> list:
    """Extrae todos los números ≥7 dígitos del texto (únicos)."""
    return list(dict.fromkeys(_NUM_RE.findall(text or '')))


def _clean_name(name):
    clean = re.sub(r'^(\d{4,}\s+|PO\s+\S+\s+|RFQ[-\s]\S+\s+)', '', name or '', flags=re.IGNORECASE).strip()
    segment = re.split(r'\s*(?://|–|—)\s*', clean)[0].strip()
    return segment if len(segment) >= 5 else clean


# ─── Fase 1: mismo nombre completo ───────────────────────────────────────────

def _find_opp_by_exact_name(nombre):
    """Nombre del proyecto == nombre de oportunidad (sin tocar)."""
    opps = TodoItem.objects.filter(oportunidad__iexact=nombre.strip())
    if opps.count() == 1:
        return opps.first(), "nombre idéntico"
    return None, None


# ─── Fase 2: número largo compartido ─────────────────────────────────────────

def _find_opp_by_number(nombre):
    """Un número ≥7 dígitos del nombre del proyecto aparece en exactamente una oportunidad."""
    for num in _extract_numbers(nombre):
        opps = TodoItem.objects.filter(oportunidad__icontains=num)
        if opps.count() == 1:
            return opps.first(), f"número {num}"
        # Si hay más de una, verificar que el número aparezca como palabra completa
        if opps.count() > 1:
            exactas = [o for o in opps if re.search(r'\b' + re.escape(num) + r'\b', o.oportunidad or '')]
            if len(exactas) == 1:
                return exactas[0], f"número {num} exacto"
    return None, None


# ─── Fase 3: documento compartido ────────────────────────────────────────────

def _find_opp_by_doc(file_names, cot_index):
    """Nombre normalizado de un archivo del drive coincide con nombre_cotizacion."""
    for fname in file_names:
        key = _norm(fname)
        if key in cot_index:
            return cot_index[key], fname
    return None, None


# ─── Fase 4: nombre limpio ────────────────────────────────────────────────────

def _find_opp_by_clean_name(nombre):
    """Nombre sin prefijo PO/RFQ contenido en exactamente una oportunidad."""
    clean = _clean_name(nombre)
    if len(clean) < 8:
        return None, None
    opps = TodoItem.objects.filter(oportunidad__icontains=clean)
    if opps.count() == 1:
        return opps.first(), f"nombre limpio '{clean[:40]}'"
    return None, None


# ── Detección de tipo de archivo ─────────────────────────────────────────────

_TIPO_MAP = {
    "pdf": "pdf", "doc": "documento", "docx": "documento",
    "xls": "hoja_calculo", "xlsx": "hoja_calculo", "csv": "hoja_calculo",
    "ppt": "presentacion", "pptx": "presentacion",
    "jpg": "imagen", "jpeg": "imagen", "png": "imagen", "gif": "imagen",
    "mp4": "video", "avi": "video", "mov": "video",
    "zip": "archivo_comprimido", "rar": "archivo_comprimido",
}


def _tipo(nombre):
    ext = nombre.rsplit(".", 1)[-1].lower() if "." in nombre else ""
    return _TIPO_MAP.get(ext, "otro"), ext


# ── Obtener default user ──────────────────────────────────────────────────────

def _default_user():
    u, _ = User.objects.get_or_create(
        username="bitrix_import",
        defaults={"first_name": "Bitrix", "last_name": "Import", "is_active": False},
    )
    return u


# ── Comando ───────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = "Sync drive de Bitrix24: vincula proyectos→oportunidades por documento, PO o nombre"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--reset", action="store_true",
                            help="Limpia datos Bitrix anteriores antes de importar")
        parser.add_argument("--group-ids", nargs="+", type=int,
                            help="Solo estos IDs de grupo")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if dry_run:
            self.stdout.write(self.style.WARNING("── DRY RUN — nada se guardará ──"))

        if options["reset"] and not dry_run:
            self._reset()

        cot_index = _build_cotizacion_index()
        self.stdout.write(f"Cotizaciones en índice de matching: {len(cot_index)}")

        payload = {"select": ["ID", "NAME", "DATE_CREATE", "UF_CRM"]}
        if options.get("group_ids"):
            payload["filter"] = {"ID": options["group_ids"]}
        groups = _pages("sonet_group.get", payload)
        self.stdout.write(f"Grupos Bitrix: {len(groups)}\n")

        default_user = _default_user()
        stats = dict(
            f_nombre=0, f_numero=0, f_doc=0, f_clean=0, sin_vincular=0,
            archivos=0, carpetas=0, errores=0
        )

        for group in groups:
            try:
                self._process_group(group, cot_index, default_user, dry_run, stats)
            except Exception as e:
                stats["errores"] += 1
                self.stderr.write(self.style.ERROR(f"  Error grupo {group.get('ID')}: {e}"))

        self.stdout.write("\n" + "─" * 55)
        self.stdout.write(f"✅ Nombre idéntico          : {stats['f_nombre']}")
        self.stdout.write(f"✅ Número compartido        : {stats['f_numero']}")
        self.stdout.write(f"✅ Documento compartido     : {stats['f_doc']}")
        self.stdout.write(f"✅ Nombre limpio            : {stats['f_clean']}")
        self.stdout.write(f"⏭  Sin vincular            : {stats['sin_vincular']}")
        self.stdout.write(f"📁 Carpetas importadas      : {stats['carpetas']}")
        self.stdout.write(f"📄 Archivos importados      : {stats['archivos']}")
        self.stdout.write(f"❌ Errores                  : {stats['errores']}")

    # ── Reset ─────────────────────────────────────────────────────────────────

    def _reset(self):
        self.stdout.write(self.style.WARNING("Limpiando datos Bitrix anteriores..."))
        # MySQL revalida todos los FK en cada UPDATE/DELETE aunque la columna no cambie.
        # Hay filas huérfanas (oportunidad_id → TodoItem borrado), así que usamos
        # FOREIGN_KEY_CHECKS=0 para saltarlas de forma segura.
        with connection.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            cur.execute(
                "DELETE FROM app_archivoorportunidad WHERE bitrix_file_id IS NOT NULL"
            )
            n_arch = cur.rowcount
            cur.execute("DELETE FROM app_carpetaoportunidad")
            n_carp = cur.rowcount
            cur.execute("SET FOREIGN_KEY_CHECKS=1")
        self.stdout.write(f"  ArchivoOportunidad (Bitrix) borrados: {n_arch}")
        self.stdout.write(f"  CarpetaOportunidad borradas: {n_carp}")
        n = OportunidadProyecto.objects.all().delete()[0]
        self.stdout.write(f"  OportunidadProyecto borrados: {n}")
        for p in Proyecto.objects.filter(bitrix_group_id__isnull=False):
            p.oportunidades_ligadas.clear()
        self.stdout.write("  oportunidades_ligadas M2M: limpiadas")
        self.stdout.write(self.style.SUCCESS("  Reset completado.\n"))

    # ── Procesar grupo ────────────────────────────────────────────────────────

    def _process_group(self, group, cot_index, default_user, dry_run, stats):
        group_id = int(group["ID"])
        nombre = (group.get("NAME") or f"Grupo {group_id}").strip()

        # ── Fase 1: nombre idéntico (más confiable) ──
        opp, motivo = _find_opp_by_exact_name(nombre)
        if opp:
            stats["f_nombre"] += 1
            fase_lbl = f"NOMBRE ({motivo})"
        else:
            # ── Fase 2: número largo compartido ──
            opp, motivo = _find_opp_by_number(nombre)
            if opp:
                stats["f_numero"] += 1
                fase_lbl = f"NÚMERO ({motivo})"
            else:
                # ── Obtener archivos del drive solo si hace falta para Fase 3 ──
                file_names = self._get_drive_file_names(group_id)

                # ── Fase 3: documento compartido ──
                opp, motivo = _find_opp_by_doc(file_names, cot_index)
                if opp:
                    stats["f_doc"] += 1
                    fase_lbl = f"DOCUMENTO ({motivo})"
                else:
                    # ── Fase 4: nombre limpio ──
                    opp, motivo = _find_opp_by_clean_name(nombre)
                    if opp:
                        stats["f_clean"] += 1
                        fase_lbl = f"NOMBRE-LIMPIO ({motivo})"
                    else:
                        stats["sin_vincular"] += 1
                        self.stdout.write(f"  [{group_id}] ⊘ sin vincular: {nombre[:65]}")
                        return  # Sin oportunidad → no importamos nada

        # Para fases 1 y 2 (sin drive aún) necesitamos los nombres para dry-run
        if 'file_names' not in dir():
            file_names = self._get_drive_file_names(group_id) if dry_run else []

        self.stdout.write(
            self.style.SUCCESS(f"  [{group_id}] {fase_lbl} → {opp.oportunidad[:50]}")
        )
        self.stdout.write(f"           {nombre[:70]}")

        if dry_run:
            self.stdout.write(f"           archivos encontrados: {len(file_names)}")
            return

        # Crear/actualizar Proyecto local
        proyecto, _ = Proyecto.objects.update_or_create(
            bitrix_group_id=group_id,
            defaults={"nombre": nombre, "creado_por": default_user},
        )
        proyecto.oportunidades_ligadas.add(opp)

        # Registrar OportunidadProyecto
        OportunidadProyecto.objects.get_or_create(
            oportunidad=opp,
            bitrix_project_id=str(group_id),
            defaults={
                "proyecto_nombre": nombre,
                "bitrix_deal_id": str(opp.bitrix_deal_id or ""),
                "created_by": default_user,
            },
        )

        # Importar archivos/carpetas del drive
        self._import_drive(group_id, opp, default_user, stats)

    # ── Drive ─────────────────────────────────────────────────────────────────

    def _get_drive_file_names(self, group_id) -> list:
        """Devuelve solo los nombres de archivos del drive (sin guardar nada)."""
        names = []
        try:
            storage_data = _call("disk.storage.getlist",
                                  {"filter": {"ENTITY_TYPE": "group", "ENTITY_ID": group_id}})
            storages = storage_data.get("result") or []
            if not storages:
                return names
            storage_id = storages[0]["ID"]
            root = _call("disk.storage.getchildren", {"id": storage_id}).get("result") or []
            self._collect_names(root, names, depth=0)
        except Exception:
            pass
        return names

    def _collect_names(self, items, names, depth):
        if depth > 6:
            return
        for item in items:
            t = (item.get("TYPE") or "").lower()
            n = (item.get("NAME") or "").strip()
            if not n:
                continue
            if t == "folder":
                try:
                    sub = _call("disk.folder.getchildren", {"id": item["ID"]}).get("result") or []
                    self._collect_names(sub, names, depth + 1)
                except Exception:
                    pass
            else:
                names.append(n)

    def _import_drive(self, group_id, opp, default_user, stats):
        """Importa carpetas y archivos del drive asociándolos a la oportunidad."""
        try:
            storage_data = _call("disk.storage.getlist",
                                  {"filter": {"ENTITY_TYPE": "group", "ENTITY_ID": group_id}})
            storages = storage_data.get("result") or []
            if not storages:
                return
            storage_id = storages[0]["ID"]
            root = _call("disk.storage.getchildren", {"id": storage_id}).get("result") or []
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"    Drive no disponible: {e}"))
            return

        self._process_items(root, opp, default_user, carpeta_padre=None, depth=0, stats=stats)

    def _process_items(self, items, opp, default_user, carpeta_padre, depth, stats):
        if depth > 6:
            return
        for item in items:
            t = (item.get("TYPE") or "").lower()
            nombre = (item.get("NAME") or "").strip()
            if not nombre:
                continue
            if t == "folder":
                carpeta, _ = CarpetaOportunidad.objects.get_or_create(
                    oportunidad=opp,
                    nombre=nombre,
                    carpeta_padre=carpeta_padre,
                    defaults={"creado_por": default_user},
                )
                stats["carpetas"] += 1
                try:
                    sub = _call("disk.folder.getchildren", {"id": item["ID"]}).get("result") or []
                    self._process_items(sub, opp, default_user, carpeta, depth + 1, stats)
                except Exception:
                    pass
            else:
                bfid = int(item.get("ID") or 0)
                if not bfid or ArchivoOportunidad.objects.filter(bitrix_file_id=bfid).exists():
                    continue
                tipo, ext = _tipo(nombre)
                ArchivoOportunidad.objects.create(
                    oportunidad=opp,
                    carpeta=carpeta_padre,
                    nombre_original=nombre,
                    tipo_archivo=tipo,
                    extension=ext,
                    tamaño=int(item.get("SIZE") or 0),
                    bitrix_file_id=bfid,
                    bitrix_download_url=item.get("DOWNLOAD_URL") or "",
                    subido_por=default_user,
                )
                stats["archivos"] += 1

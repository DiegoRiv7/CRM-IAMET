"""
Comando para importar proyectos, tareas y archivos desde Bitrix24.

Estrategia de vinculación proyecto → oportunidad:
  1. Número PO: extrae número después de "PO " → busca en nombre de oportunidad
  2. Nombre: busca el nombre limpio del proyecto dentro del nombre de oportunidad

Con oportunidad vinculada:
  - Tareas   → TareaOportunidad  (aparecen en widget de oportunidad)
  - Carpetas → CarpetaOportunidad (aparecen en Drive del widget)
  - Archivos → ArchivoOportunidad  (metadata + URL Bitrix, sin descarga)

Sin oportunidad vinculada:
  - Tareas   → Tarea  (aparecen en sección proyectos/tareas general)
  - Carpetas → CarpetaProyecto

Uso:
    python manage.py sync_bitrix_projects_tasks
    python manage.py sync_bitrix_projects_tasks --dry-run
    python manage.py sync_bitrix_projects_tasks --skip-tasks
    python manage.py sync_bitrix_projects_tasks --skip-files
    python manage.py sync_bitrix_projects_tasks --group-ids 1764 1810
"""

import os
import re
import time
import requests
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils.dateparse import parse_datetime

from app.models import (
    Proyecto, Tarea, TareaOportunidad,
    TodoItem, Cliente, UserProfile,
    OportunidadProyecto,
    CarpetaOportunidad, ArchivoOportunidad,
    CarpetaProyecto,
)

# ── Webhook base ─────────────────────────────────────────────────────────────────
WEBHOOK_BASE = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)


def _base_url():
    return WEBHOOK_BASE.rsplit("/", 1)[0] + "/"


def _call(endpoint, payload=None, retries=3):
    url = _base_url() + endpoint + ".json"
    for attempt in range(retries):
        try:
            resp = requests.post(url, json=payload or {}, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                raise ValueError(f"Bitrix error: {data['error']} - {data.get('error_description', '')}")
            return data
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return {}


def _get_all_pages(endpoint, payload):
    records = []
    start = 0
    while True:
        p = dict(payload)
        p["start"] = start
        data = _call(endpoint, p)
        batch = data.get("result") or []
        if not batch:
            break
        records.extend(batch)
        if len(records) >= data.get("total", 0):
            break
        start += 50
    return records


# ── Helpers de mapeo ─────────────────────────────────────────────────────────────

def _find_oportunidad_por_nombre(project_name):
    """
    Intenta vincular el proyecto a una oportunidad usando dos métodos:
    1. Número PO: extrae el número después de "PO " y busca en el nombre de la oportunidad.
    2. Nombre limpio: busca el nombre del proyecto dentro del nombre de la oportunidad.
    """
    if not project_name:
        return None

    # Intento 1: número después de "PO XXXXXXX"
    m_po = re.search(r'\bPO\s+(\d{4,})', project_name, re.IGNORECASE)
    if m_po:
        po_num = m_po.group(1)
        opp = TodoItem.objects.filter(oportunidad__icontains=po_num).first()
        if opp:
            return opp

    # Intento 2: nombre limpio del proyecto dentro del nombre de la oportunidad
    clean = re.sub(r'^(\d+\s+|RFQ[-\s]\S+\s+|PO\s+\S+\s+)', '', project_name, flags=re.IGNORECASE).strip()
    segment = re.split(r'\s*(?://|–|-)\s*', clean)[0].strip()
    if len(segment) < 5:
        segment = clean
    if len(segment) >= 5:
        opps = TodoItem.objects.filter(oportunidad__icontains=segment[:40])
        if opps.count() == 1:
            return opps.first()
        # Si hay múltiples, afinar con más contexto
        if opps.count() > 1 and len(segment) >= 15:
            opps2 = TodoItem.objects.filter(oportunidad__icontains=segment[:60])
            if opps2.count() == 1:
                return opps2.first()

    return None


def _map_prioridad_opp(bitrix_priority):
    """Bitrix: 0=baja, 1=media, 2=alta → TareaOportunidad: 'normal' / 'alta'"""
    return "alta" if str(bitrix_priority) == "2" else "normal"


def _map_estado_opp(bitrix_status):
    """Bitrix status → TareaOportunidad: 'pendiente' / 'completada'"""
    return "completada" if str(bitrix_status) == "3" else "pendiente"


def _map_status_tarea(bitrix_status):
    """Bitrix status → Tarea.estado"""
    mapping = {
        "1": "pendiente", "2": "iniciada", "3": "completada",
        "4": "en_progreso", "5": "cancelada", "6": "cancelada",
    }
    return mapping.get(str(bitrix_status), "pendiente")


def _map_priority_tarea(bitrix_priority):
    """Bitrix priority → Tarea.prioridad"""
    return {"0": "baja", "1": "media", "2": "alta"}.get(str(bitrix_priority), "media")


def _detect_tipo_archivo(nombre):
    ext = nombre.rsplit(".", 1)[-1].lower() if "." in nombre else ""
    mapping = {
        "pdf": "pdf", "doc": "documento", "docx": "documento",
        "xls": "hoja_calculo", "xlsx": "hoja_calculo", "csv": "hoja_calculo",
        "ppt": "presentacion", "pptx": "presentacion",
        "jpg": "imagen", "jpeg": "imagen", "png": "imagen", "gif": "imagen", "bmp": "imagen",
        "mp4": "video", "avi": "video", "mov": "video",
        "mp3": "audio", "wav": "audio",
        "zip": "archivo_comprimido", "rar": "archivo_comprimido", "7z": "archivo_comprimido",
    }
    return mapping.get(ext, "otro"), ext


def _get_or_create_default_user():
    user, _ = User.objects.get_or_create(
        username="bitrix_import",
        defaults={"first_name": "Bitrix", "last_name": "Import", "is_active": False},
    )
    return user


# ── Comando ──────────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = "Importa proyectos, tareas y archivos desde Bitrix24 al widget de oportunidades"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Muestra acciones sin guardar")
        parser.add_argument("--skip-tasks", action="store_true", help="No importa tareas")
        parser.add_argument("--skip-files", action="store_true", help="No importa archivos/carpetas")
        parser.add_argument(
            "--group-ids", nargs="+", type=int,
            help="Importar solo estos IDs de grupo (para pruebas)"
        )

    def handle(self, *args, **options):
        if not WEBHOOK_BASE:
            self.stderr.write(self.style.ERROR("BITRIX_PROJECTS_WEBHOOK_URL no configurado."))
            return

        dry_run = options["dry_run"]
        if dry_run:
            self.stdout.write(self.style.WARNING("MODO DRY-RUN — no se guardará nada"))

        self.stats = {
            "proyectos_creados": 0, "proyectos_actualizados": 0,
            "oportunidades_vinculadas": 0,
            "saltados_ya_vinculados": 0,
            "tareas_opp_creadas": 0, "tareas_opp_actualizadas": 0,
            "tareas_gral_creadas": 0,
            "carpetas_opp": 0, "carpetas_gral": 0,
            "archivos_opp": 0,
            "errores": 0,
        }

        self._run(
            dry_run=dry_run,
            skip_tasks=options["skip_tasks"],
            skip_files=options["skip_files"],
            only_ids=options.get("group_ids"),
        )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=== Sincronización completada ==="))
        for k, v in self.stats.items():
            self.stdout.write(f"  {k}: {v}")

    # ── Loop principal ────────────────────────────────────────────────────────────

    def _run(self, dry_run, skip_tasks, skip_files, only_ids):
        self.stdout.write("Descargando grupos de Bitrix24...")
        payload = {
            "select": ["ID", "NAME", "DESCRIPTION", "DATE_CREATE", "OWNER_ID", "UF_CRM"],
            "filter": {},
        }
        if only_ids:
            payload["filter"]["ID"] = only_ids

        try:
            groups = _get_all_pages("sonet_group.get", payload)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Error al descargar grupos: {e}"))
            return

        self.stdout.write(f"  Total grupos: {len(groups)}")
        default_user = _get_or_create_default_user()

        for group in groups:
            try:
                self._process_group(group, dry_run, skip_tasks, skip_files, default_user)
            except Exception as e:
                self.stats["errores"] += 1
                self.stderr.write(self.style.ERROR(f"  Error grupo {group.get('ID')}: {e}"))

    # ── Procesar grupo ────────────────────────────────────────────────────────────

    def _process_group(self, group, dry_run, skip_tasks, skip_files, default_user):
        bitrix_group_id = int(group["ID"])
        nombre = (group.get("NAME") or f"Proyecto {bitrix_group_id}").strip()
        descripcion = (group.get("DESCRIPTION") or "").strip()
        bitrix_date = parse_datetime(group.get("DATE_CREATE") or "")

        self.stdout.write(f"\n  [{bitrix_group_id}] {nombre[:70]}")

        # Saltar proyectos que ya tienen oportunidad vinculada
        existing = Proyecto.objects.filter(bitrix_group_id=bitrix_group_id).first()
        if existing and existing.oportunidades_ligadas.exists():
            self.stdout.write("    → Ya vinculado, saltando")
            self.stats["saltados_ya_vinculados"] += 1
            return

        # Buscar oportunidad usando nuevos métodos (PO number + nombre)
        oportunidad = _find_oportunidad_por_nombre(nombre)
        if oportunidad:
            self.stdout.write(self.style.SUCCESS(f"    → Oportunidad: {oportunidad.oportunidad[:55]}"))
        else:
            self.stdout.write("    → Sin oportunidad vinculada")

        # Crear/actualizar Proyecto local
        if not dry_run:
            proyecto, created = Proyecto.objects.update_or_create(
                bitrix_group_id=bitrix_group_id,
                defaults={"nombre": nombre, "descripcion": descripcion, "creado_por": default_user},
            )
            # Corregir fecha_creacion con la fecha real de Bitrix
            if bitrix_date:
                Proyecto.objects.filter(pk=proyecto.pk).update(fecha_creacion=bitrix_date)

            if oportunidad:
                proyecto.oportunidades_ligadas.add(oportunidad)
            if created:
                self.stats["proyectos_creados"] += 1
            else:
                self.stats["proyectos_actualizados"] += 1
        else:
            proyecto = None
            exists = Proyecto.objects.filter(bitrix_group_id=bitrix_group_id).exists()
            self.stdout.write(f"    [DRY] {'ACTUALIZAR' if exists else 'CREAR'} Proyecto")

        # Registrar OportunidadProyecto
        if oportunidad and not dry_run:
            OportunidadProyecto.objects.get_or_create(
                oportunidad=oportunidad,
                bitrix_project_id=str(bitrix_group_id),
                defaults={
                    "proyecto_nombre": nombre,
                    "bitrix_deal_id": str(oportunidad.bitrix_deal_id or ""),
                    "created_by": default_user,
                },
            )
            self.stats["oportunidades_vinculadas"] += 1

        # Tareas
        if not skip_tasks:
            self._sync_tasks(bitrix_group_id, proyecto, oportunidad, default_user, dry_run)

        # Archivos / Carpetas
        if not skip_files:
            self._sync_drive(bitrix_group_id, proyecto, oportunidad, default_user, dry_run)

    # ── Tareas ────────────────────────────────────────────────────────────────────

    def _sync_tasks(self, group_id, proyecto, oportunidad, default_user, dry_run):
        try:
            data = _call("tasks.task.list", {
                "filter": {"GROUP_ID": group_id},
                "select": ["ID", "TITLE", "DESCRIPTION", "STATUS", "PRIORITY",
                           "DEADLINE", "CREATED_DATE", "RESPONSIBLE_ID"],
                "order": {"ID": "ASC"},
                "limit": 50,
            })
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"    Tareas no disponibles: {e}"))
            return

        tasks = (data.get("result") or {}).get("tasks") or []
        if not tasks:
            return
        self.stdout.write(f"    Tareas: {len(tasks)}")

        for t in tasks:
            try:
                self._process_task(t, proyecto, oportunidad, default_user, dry_run)
            except Exception as e:
                self.stats["errores"] += 1
                self.stderr.write(self.style.ERROR(f"      Error tarea {t.get('id')}: {e}"))

    def _process_task(self, t, proyecto, oportunidad, default_user, dry_run):
        bitrix_task_id = int(t["id"])
        titulo = (t.get("title") or f"Tarea {bitrix_task_id}").strip()
        descripcion = (t.get("description") or "").strip()

        fecha_limite = None
        if t.get("deadline"):
            fecha_limite = parse_datetime(t["deadline"])

        bitrix_created = None
        created_str = t.get("createdDate") or t.get("CREATED_DATE")
        if created_str:
            bitrix_created = parse_datetime(created_str)

        # Responsable → usuario local
        responsable = default_user
        bitrix_resp = t.get("responsibleId") or t.get("RESPONSIBLE_ID")
        if bitrix_resp:
            up = UserProfile.objects.filter(bitrix_user_id=str(bitrix_resp)).first()
            if up:
                responsable = up.user

        if oportunidad:
            prioridad = _map_prioridad_opp(t.get("priority", "1"))
            estado = _map_estado_opp(t.get("status", "1"))

            if not dry_run:
                tarea, created = TareaOportunidad.objects.update_or_create(
                    bitrix_task_id=bitrix_task_id,
                    defaults={
                        "oportunidad": oportunidad,
                        "titulo": titulo,
                        "descripcion": descripcion,
                        "prioridad": prioridad,
                        "estado": estado,
                        "fecha_limite": fecha_limite,
                        "creado_por": default_user,
                        "responsable": responsable,
                    },
                )
                # Corregir fecha_creacion con la fecha real de Bitrix
                if bitrix_created and created:
                    TareaOportunidad.objects.filter(pk=tarea.pk).update(fecha_creacion=bitrix_created)

                if created:
                    self.stats["tareas_opp_creadas"] += 1
                else:
                    self.stats["tareas_opp_actualizadas"] += 1
            else:
                self.stdout.write(f"      [DRY] TAREA-OPP '{titulo[:50]}'")
        else:
            if not dry_run and proyecto:
                _, created = Tarea.objects.update_or_create(
                    bitrix_task_id=bitrix_task_id,
                    defaults={
                        "titulo": titulo,
                        "descripcion": descripcion,
                        "estado": _map_status_tarea(t.get("status", "1")),
                        "prioridad": _map_priority_tarea(t.get("priority", "1")),
                        "fecha_limite": fecha_limite,
                        "proyecto": proyecto,
                        "creado_por": default_user,
                        "asignado_a": responsable,
                    },
                )
                if created:
                    self.stats["tareas_gral_creadas"] += 1
            else:
                self.stdout.write(f"      [DRY] TAREA-GRAL '{titulo[:50]}'")

    # ── Drive (carpetas + archivos) ───────────────────────────────────────────────

    def _sync_drive(self, group_id, proyecto, oportunidad, default_user, dry_run):
        try:
            storage_data = _call("disk.storage.getlist",
                                  {"filter": {"ENTITY_TYPE": "group", "ENTITY_ID": group_id}})
            storages = storage_data.get("result") or []
            if not storages:
                return
            storage_id = storages[0]["ID"]
            root_data = _call("disk.storage.getchildren", {"id": storage_id})
            children = root_data.get("result") or []
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"    Drive no disponible: {e}"))
            return

        if not children:
            return
        self.stdout.write(f"    Drive: {len(children)} items en raíz")
        self._process_children(children, oportunidad, proyecto, default_user,
                               carpeta_opp_padre=None, carpeta_proj_padre=None,
                               dry_run=dry_run, depth=0)

    def _process_children(self, children, oportunidad, proyecto, default_user,
                          carpeta_opp_padre, carpeta_proj_padre, dry_run, depth):
        if depth > 6:
            return

        for item in children:
            item_type = (item.get("TYPE") or item.get("type") or "").lower()
            nombre = (item.get("NAME") or item.get("name") or "").strip()
            if not nombre:
                continue

            if item_type == "folder":
                self._process_folder(item, nombre, oportunidad, proyecto, default_user,
                                     carpeta_opp_padre, carpeta_proj_padre, dry_run, depth)
            else:
                self._process_file(item, nombre, oportunidad, default_user,
                                   carpeta_opp_padre, dry_run)

    def _process_folder(self, item, nombre, oportunidad, proyecto, default_user,
                        carpeta_opp_padre, carpeta_proj_padre, dry_run, depth):
        nueva_opp = None
        nueva_proj = None

        if oportunidad:
            if not dry_run:
                nueva_opp, _ = CarpetaOportunidad.objects.get_or_create(
                    oportunidad=oportunidad,
                    nombre=nombre,
                    carpeta_padre=carpeta_opp_padre,
                    defaults={"creado_por": default_user},
                )
                self.stats["carpetas_opp"] += 1
            else:
                self.stdout.write("  " * (depth + 2) + f"[DRY] CARPETA-OPP  {nombre}")
        else:
            if not dry_run and proyecto:
                nueva_proj, _ = CarpetaProyecto.objects.get_or_create(
                    proyecto=proyecto,
                    nombre=nombre,
                    carpeta_padre=carpeta_proj_padre,
                    defaults={"creado_por": default_user},  # fix: creado_por_id cannot be null
                )
                self.stats["carpetas_gral"] += 1
            else:
                self.stdout.write("  " * (depth + 2) + f"[DRY] CARPETA-GRAL {nombre}")

        # Recursión en hijos
        try:
            sub_data = _call("disk.folder.getchildren", {"id": item["ID"]})
            sub_children = sub_data.get("result") or []
            if sub_children:
                self._process_children(sub_children, oportunidad, proyecto, default_user,
                                       carpeta_opp_padre=nueva_opp,
                                       carpeta_proj_padre=nueva_proj,
                                       dry_run=dry_run, depth=depth + 1)
        except Exception:
            pass

    def _process_file(self, item, nombre, oportunidad, default_user, carpeta_opp_padre, dry_run):
        if not oportunidad:
            return

        bitrix_file_id = int(item.get("ID") or item.get("id") or 0)
        tamaño = int(item.get("SIZE") or item.get("size") or 0)
        download_url = item.get("DOWNLOAD_URL") or item.get("downloadUrl") or ""
        tipo, ext = _detect_tipo_archivo(nombre)

        if not dry_run:
            _, created = ArchivoOportunidad.objects.get_or_create(
                bitrix_file_id=bitrix_file_id,
                defaults={
                    "oportunidad": oportunidad,
                    "carpeta": carpeta_opp_padre,
                    "nombre_original": nombre,
                    "tipo_archivo": tipo,
                    "extension": ext,
                    "tamaño": tamaño,
                    "bitrix_download_url": download_url,
                    "subido_por": default_user,
                },
            )
            if created:
                self.stats["archivos_opp"] += 1
        else:
            self.stdout.write(f"        [DRY] ARCHIVO-OPP {nombre} ({tamaño} bytes)")

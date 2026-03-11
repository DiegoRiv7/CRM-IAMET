"""
Comando para importar proyectos, tareas y archivos desde Bitrix24 de manera INDEPENDIENTE.
No liga proyectos a oportunidades, simplemente trae todo al sistema para que
luego puedan ser vinculados manualmente o con otro script posterior.
Se enfoca en asegurar creadores, responsables, participantes, observadores y fechas
en base a los IDs de usuarios.

Uso:
    python manage.py sync_bitrix_projects_standalone
    python manage.py sync_bitrix_projects_standalone --dry-run
    python manage.py sync_bitrix_projects_standalone --skip-tasks
    python manage.py sync_bitrix_projects_standalone --skip-files
    python manage.py sync_bitrix_projects_standalone --group-ids 1764 1810
"""

import os
import time
import requests
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils.dateparse import parse_datetime

from app.models import (
    Proyecto, Tarea, UserProfile,
    CarpetaProyecto, ArchivoProyecto
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
        if isinstance(batch, dict) and "tasks" in batch:
            batch = batch["tasks"] # Para endpoints de tasks
        elif isinstance(batch, dict):
            batch = [] # Fallback
            
        if not batch:
            break
        records.extend(batch)
        if len(records) >= data.get("total", 0):
            break
        start += 50
    return records

# ── Helpers de mapeo ─────────────────────────────────────────────────────────────

def _map_status_tarea(bitrix_status):
    mapping = {
        "1": "pendiente", "2": "iniciada", "3": "completada",
        "4": "en_progreso", "5": "cancelada", "6": "cancelada",
    }
    return mapping.get(str(bitrix_status), "pendiente")

def _map_priority_tarea(bitrix_priority):
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
    help = "Importa proyectos, tareas y archivos desde Bitrix24 de forma independiente sin ligar a oportunidades"

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
            "tareas_creadas": 0, "tareas_actualizadas": 0,
            "carpetas": 0, "archivos": 0, "errores": 0,
        }
        
        # Pre-cargar mapa de usuarios: Bitrix ID -> Django User
        self.user_map = {}
        for up in UserProfile.objects.filter(bitrix_user_id__isnull=False):
            self.user_map[str(up.bitrix_user_id)] = up.user

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
            "select": ["ID", "NAME", "DESCRIPTION", "DATE_CREATE", "OWNER_ID"],
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

        owner = default_user
        if group.get("OWNER_ID") and str(group.get("OWNER_ID")) in self.user_map:
            owner = self.user_map[str(group.get("OWNER_ID"))]

        # Crear/actualizar Proyecto local
        if not dry_run:
            proyecto, created = Proyecto.objects.update_or_create(
                bitrix_group_id=bitrix_group_id,
                defaults={
                    "nombre": nombre,
                    "descripcion": descripcion,
                    "creado_por": owner,
                    "es_ingenieria": True,
                },
            )
            if bitrix_date:
                Proyecto.objects.filter(pk=proyecto.pk).update(fecha_creacion=bitrix_date)
            
            if created:
                self.stats["proyectos_creados"] += 1
            else:
                self.stats["proyectos_actualizados"] += 1
                
            # Sincronizar miembros del grupo si no es dry run
            self._sync_group_members(bitrix_group_id, proyecto)
        else:
            proyecto = None
            exists = Proyecto.objects.filter(bitrix_group_id=bitrix_group_id).exists()
            self.stdout.write(f"    [DRY] {'ACTUALIZAR' if exists else 'CREAR'} Proyecto")

        # Tareas
        if not skip_tasks:
            self._sync_tasks(bitrix_group_id, proyecto, default_user, dry_run)

        # Archivos / Carpetas
        if not skip_files:
            self._sync_drive(bitrix_group_id, proyecto, default_user, dry_run)


    def _sync_group_members(self, bitrix_group_id, proyecto):
        try:
            data = _call("sonet_group.user.get", {"ID": bitrix_group_id})
            members_data = data.get("result") or []
            member_users = []
            for m in members_data:
                u_id = str(m.get("USER_ID"))
                if u_id in self.user_map:
                    member_users.append(self.user_map[u_id])
            if member_users:
                proyecto.miembros.set(member_users)
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"    No se pudieron sincronizar miembros: {e}"))


    # ── Tareas ────────────────────────────────────────────────────────────────────

    def _sync_tasks(self, group_id, proyecto, default_user, dry_run):
        try:
            tasks = _get_all_pages("tasks.task.list", {
                "filter": {"GROUP_ID": group_id},
                "select": [
                    "ID", "TITLE", "DESCRIPTION", "STATUS", "PRIORITY",
                    "DEADLINE", "CREATED_DATE", "RESPONSIBLE_ID", "CREATED_BY",
                    "ACCOMPLICES", "AUDITORS", "CLOSED_DATE"
                ],
            })
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"    Tareas no disponibles: {e}"))
            return

        if not tasks:
            return
        self.stdout.write(f"    Tareas encontradas: {len(tasks)}")

        for t in tasks:
            try:
                self._process_task(t, proyecto, default_user, dry_run)
            except Exception as e:
                self.stats["errores"] += 1
                self.stderr.write(self.style.ERROR(f"      Error tarea {t.get('id')}: {e}"))

    def _process_task(self, t, proyecto, default_user, dry_run):
        bitrix_task_id = int(t["id"])
        titulo = (t.get("title") or t.get("TITLE") or f"Tarea {bitrix_task_id}").strip()
        descripcion = (t.get("description") or t.get("DESCRIPTION") or "").strip()

        fecha_limite = None
        deadline_str = t.get("deadline") or t.get("DEADLINE")
        if deadline_str:
            fecha_limite = parse_datetime(deadline_str)

        bitrix_created = None
        created_str = t.get("createdDate") or t.get("CREATED_DATE")
        if created_str:
            bitrix_created = parse_datetime(created_str)
            
        fecha_completada = None
        closed_str = t.get("closedDate") or t.get("CLOSED_DATE")
        if closed_str:
            fecha_completada = parse_datetime(closed_str)

        # Usuarios
        creador_id = str(t.get("createdBy") or t.get("CREATED_BY") or "")
        responsable_id = str(t.get("responsibleId") or t.get("RESPONSIBLE_ID") or "")
        accomplices_ids = t.get("accomplices") or t.get("ACCOMPLICES") or []
        auditors_ids = t.get("auditors") or t.get("AUDITORS") or []

        creador = self.user_map.get(creador_id, default_user)
        responsable = self.user_map.get(responsable_id, default_user)
        
        estado = _map_status_tarea(t.get("status") or t.get("STATUS") or "1")
        prioridad = _map_priority_tarea(t.get("priority") or t.get("PRIORITY") or "1")

        if not dry_run and proyecto:
            tarea, created = Tarea.objects.update_or_create(
                bitrix_task_id=bitrix_task_id,
                defaults={
                    "titulo": titulo,
                    "descripcion": descripcion,
                    "estado": estado,
                    "prioridad": prioridad,
                    "fecha_limite": fecha_limite,
                    "fecha_completada": fecha_completada,
                    "proyecto": proyecto,
                    "creado_por": creador,
                    "asignado_a": responsable,
                },
            )
            
            # Participantes y Observadores
            participantes = [self.user_map[str(uid)] for uid in accomplices_ids if str(uid) in self.user_map]
            if participantes:
                tarea.participantes.set(participantes)
                
            observadores = [self.user_map[str(uid)] for uid in auditors_ids if str(uid) in self.user_map]
            if observadores:
                tarea.observadores.set(observadores)

            if bitrix_created and created:
                Tarea.objects.filter(pk=tarea.pk).update(fecha_creacion=bitrix_created)
                
            if created:
                self.stats["tareas_creadas"] += 1
            else:
                self.stats["tareas_actualizadas"] += 1
        else:
            self.stdout.write(f"      [DRY] TAREA '{titulo[:50]}' [{estado}] - Responsable: {responsable.username}")

    # ── Drive (carpetas + archivos) ───────────────────────────────────────────────

    def _sync_drive(self, group_id, proyecto, default_user, dry_run):
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
        self._process_children(children, proyecto, default_user,
                               carpeta_padre=None, dry_run=dry_run, depth=0)

    def _process_children(self, children, proyecto, default_user,
                          carpeta_padre, dry_run, depth):
        if depth > 6:
            return

        for item in children:
            item_type = (item.get("TYPE") or item.get("type") or "").lower()
            nombre = (item.get("NAME") or item.get("name") or "").strip()
            if not nombre:
                continue

            if item_type == "folder":
                self._process_folder(item, nombre, proyecto, default_user,
                                     carpeta_padre, dry_run, depth)
            else:
                self._process_file(item, nombre, proyecto, default_user,
                                   carpeta_padre, dry_run)

    def _process_folder(self, item, nombre, proyecto, default_user,
                        carpeta_padre, dry_run, depth):
        bitrix_folder_id = int(item.get("ID") or item.get("id") or 0)
        nueva_carpeta = None
        
        if not dry_run and proyecto:
            nueva_carpeta, created = CarpetaProyecto.objects.get_or_create(
                bitrix_folder_id=bitrix_folder_id,
                proyecto=proyecto,
                defaults={
                    "nombre": nombre,
                    "carpeta_padre": carpeta_padre,
                    "creado_por": default_user
                },
            )
            # En caso de que se haya movido de padre o cambiado de nombre
            if not created:
                nueva_carpeta.nombre = nombre
                nueva_carpeta.carpeta_padre = carpeta_padre
                nueva_carpeta.save()
            self.stats["carpetas"] += 1
        else:
            self.stdout.write("  " * (depth + 2) + f"[DRY] CARPETA {nombre}")

        try:
            sub_data = _call("disk.folder.getchildren", {"id": item["ID"]})
            sub_children = sub_data.get("result") or []
            if sub_children:
                self._process_children(sub_children, proyecto, default_user,
                                       carpeta_padre=nueva_carpeta,
                                       dry_run=dry_run, depth=depth + 1)
        except Exception:
            pass

    def _process_file(self, item, nombre, proyecto, default_user, carpeta_padre, dry_run):
        bitrix_file_id = int(item.get("ID") or item.get("id") or 0)
        tamaño = int(item.get("SIZE") or item.get("size") or 0)
        download_url = item.get("DOWNLOAD_URL") or item.get("downloadUrl") or ""
        tipo, ext = _detect_tipo_archivo(nombre)
        
        creador = default_user
        created_by_id = str(item.get("CREATED_BY") or item.get("createdBy") or "")
        if created_by_id in self.user_map:
            creador = self.user_map[created_by_id]

        if not dry_run and proyecto:
            _, created = ArchivoProyecto.objects.get_or_create(
                bitrix_file_id=bitrix_file_id,
                defaults={
                    "proyecto": proyecto,
                    "carpeta": carpeta_padre,
                    "nombre_original": nombre,
                    "tipo_archivo": tipo,
                    "extension": ext,
                    "tamaño": tamaño,
                    "bitrix_download_url": download_url,
                    "subido_por": creador,
                },
            )
            if created:
                self.stats["archivos"] += 1
        else:
            self.stdout.write(f"        [DRY] ARCHIVO {nombre} ({tamaño} bytes)")

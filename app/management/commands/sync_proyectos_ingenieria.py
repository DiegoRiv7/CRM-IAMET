"""
Importa proyectos de ingeniería desde Bitrix24.

Un proyecto se considera de ingeniería si su Drive contiene archivos o carpetas
con nombres que incluyan: volumetría, propuesta técnica, memoria técnica, etc.

Uso:
    python manage.py sync_proyectos_ingenieria
    python manage.py sync_proyectos_ingenieria --dry-run
    python manage.py sync_proyectos_ingenieria --reset
    python manage.py sync_proyectos_ingenieria --group-ids 1764 1810
    python manage.py sync_proyectos_ingenieria --skip-tasks
    python manage.py sync_proyectos_ingenieria --skip-feed
"""

import os
import re
import time
import requests
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils.dateparse import parse_datetime
from django.utils import timezone

from app.models import (
    Proyecto, CarpetaProyecto, ArchivoProyecto,
    ProyectoComentario, Tarea, UserProfile,
)

# ── Webhook ───────────────────────────────────────────────────────────────────
WEBHOOK_BASE = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)

# ── Palabras clave de archivos importantes ────────────────────────────────────
_KEYWORDS = [
    r'volumetr[íi]a',
    r'vol[-_\s]?\d',
    r'propuesta.?t[eé]cn',
    r'pt[-_\s]',
    r'pt[-_\s]?\d',
    r'memoria.?t[eé]cn',
    r'mt[-_\s]',
    r'especificaci[oó]n',
    r'especificaciones',
    r'planos?',
    r'diagrama',
    r'topolog[íi]a',
    r'cableado.?estructurado',
    r'site.?survey',
    r'rack.?diagram',
    r'noc',
    r'fibra.?[oó]ptica',
    r'dise[ñn]o.?t[eé]cn',
    r'presupuesto.?t[eé]cn',
    r'levantamiento',
    r'nodos?',
    r'reubicaci[oó]n',
    r'instalaci[oó]n',
    r'configuraci[oó]n',
    r'infraestructura',
    r'switch',
    r'router',
    r'access.?point',
    r'ups',
    r'servidor',
    r'datacenter',
    r'data.?center',
    r'backbone',
    r'propuesta',
    r'compra',
    r'cotizaci[oó]n',
    r'orden.?de.?compra',
    r'oc[-_\s]?\d',
    r'po[-_\s]?\d',
]
_PATTERN_IMP = re.compile('|'.join(_KEYWORDS), re.IGNORECASE)

# Extensiones que califican POR SÍ SOLAS (sin importar el nombre del archivo)
_ALWAYS_IMPORTANT_EXTS = {'.xlsx', '.xls', '.numbers', '.ods', '.csv'}

# Extensiones que califican solo si el nombre también contiene palabras técnicas
_IMPORTANT_EXTS = {'.docx', '.doc', '.pptx', '.ppt', '.pdf', '.dwg', '.dxf', '.vsdx', '.vsd'}

# ── Tipos de archivo ──────────────────────────────────────────────────────────
_EXT_TYPE = {
    'pdf': 'pdf', 'doc': 'documento', 'docx': 'documento',
    'xls': 'hoja_calculo', 'xlsx': 'hoja_calculo', 'csv': 'hoja_calculo',
    'ppt': 'presentacion', 'pptx': 'presentacion',
    'jpg': 'imagen', 'jpeg': 'imagen', 'png': 'imagen', 'gif': 'imagen',
    'mp4': 'video', 'avi': 'video', 'mov': 'video',
    'mp3': 'audio', 'wav': 'audio',
    'zip': 'archivo_comprimido', 'rar': 'archivo_comprimido', '7z': 'archivo_comprimido',
    'dwg': 'documento', 'dxf': 'documento', 'vsd': 'presentacion', 'vsdx': 'presentacion',
}


# ── Helpers de API ────────────────────────────────────────────────────────────

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
    records, start = [], 0
    while True:
        p = dict(payload)
        p["start"] = start
        data = _call(endpoint, p)
        batch = data.get("result") or []
        if not batch:
            break
        records.extend(batch)
        if len(records) >= data.get("total", len(records)):
            break
        start += 50
    return records


# ── Filtro de importancia ─────────────────────────────────────────────────────

def _es_importante(nombre):
    """Devuelve True si el nombre de un archivo o carpeta indica documento de ingeniería."""
    if not nombre:
        return False
    if _PATTERN_IMP.search(nombre):
        return True
    ext = ('.' + nombre.rsplit('.', 1)[-1].lower()) if '.' in nombre else ''
    # Excel, Numbers y similares califican por sí solos sin importar el nombre
    if ext in _ALWAYS_IMPORTANT_EXTS:
        return True
    # Otros documentos califican solo si el nombre también contiene palabras técnicas
    if ext in _IMPORTANT_EXTS:
        palabras_tecnicas = re.compile(
            r'ingenier[íi]|t[eé]cni|propuesta|cotizaci|especif|plano|diagrama|noc|cableado|rack|fibra'
            r'|levantamiento|nodos?|reubicaci[oó]n|instalaci[oó]n|configuraci[oó]n|switch|router|ups|servidor',
            re.IGNORECASE
        )
        if palabras_tecnicas.search(nombre):
            return True
    return False


def _get_tipo_archivo(nombre):
    ext = nombre.rsplit('.', 1)[-1].lower() if '.' in nombre else ''
    return _EXT_TYPE.get(ext, 'otro'), ext


# ── Drive: verificar si el proyecto tiene archivos importantes ────────────────

def _get_storage_id(group_id):
    """Devuelve el storage_id del drive del grupo usando ENTITY_TYPE=group (igual que sync_bitrix_projects_tasks)."""
    try:
        data = _call("disk.storage.getlist", {"filter": {"ENTITY_TYPE": "group", "ENTITY_ID": group_id}})
        storages = data.get("result") or []
        if storages:
            return storages[0]["ID"]
    except Exception:
        pass
    return None


def _check_folder_importante(folder_id, depth=0, max_depth=3, debug_out=None):
    """
    Revisa recursivamente si hay archivos/carpetas importantes en el drive.
    Devuelve True en cuanto encuentra uno.
    """
    if depth > max_depth:
        return False
    try:
        data = _call("disk.folder.getchildren", {"id": folder_id})
        children = data.get("result") or []
        if debug_out and depth == 0:
            debug_out(f"    [drive-debug] {len(children)} elementos en raíz")
        for item in children:
            nombre = item.get("NAME", "")
            tipo = item.get("TYPE", "")
            if debug_out and depth == 0:
                debug_out(f"    [drive-debug]   '{nombre}' tipo={tipo} match={_es_importante(nombre)}")
            if _es_importante(nombre):
                return True
            if tipo == "folder":
                if _check_folder_importante(item["ID"], depth + 1, max_depth, debug_out):
                    return True
    except Exception as e:
        if debug_out:
            debug_out(f"    [drive-debug] Excepción: {e}")
    return False


def _proyecto_es_ingenieria(group_id, debug_out=None):
    """Devuelve True si el drive del grupo contiene archivos de ingeniería."""
    storage_id = _get_storage_id(group_id)
    if debug_out:
        debug_out(f"    [drive-debug] storage_id={storage_id}")
    if not storage_id:
        if debug_out:
            debug_out("    [drive-debug] Sin storage encontrado")
        return False
    try:
        data = _call("disk.storage.getchildren", {"id": storage_id})
        children = data.get("result") or []
        if debug_out:
            debug_out(f"    [drive-debug] {len(children)} elementos en raíz")
        for item in children:
            nombre = item.get("NAME", "")
            tipo = (item.get("TYPE") or "").lower()
            if debug_out:
                debug_out(f"    [drive-debug]   '{nombre}' tipo={tipo} match={_es_importante(nombre)}")
            if _es_importante(nombre):
                return True
            if tipo == "folder":
                if _check_folder_importante(item["ID"], depth=1, debug_out=debug_out):
                    return True
    except Exception as e:
        if debug_out:
            debug_out(f"    [drive-debug] Error: {e}")
    return False


# ── Importar Drive ────────────────────────────────────────────────────────────

def _import_drive(grupo_id, proyecto, default_user, dry_run, stdout):
    """Importa estructura de carpetas y archivos del drive de Bitrix al proyecto."""
    storage_id = _get_storage_id(grupo_id)
    if not storage_id:
        stdout.write("    [drive] Sin storage encontrado")
        return 0, 0
    try:
        root_data = _call("disk.storage.getchildren", {"id": storage_id})
        root_children = root_data.get("result") or []
    except Exception as e:
        stdout.write(f"    [drive] Error obteniendo raíz: {e}")
        return 0, 0

    carpetas_count, archivos_count = 0, 0

    def _process_folder(folder_id, carpeta_padre_django=None, depth=0):
        nonlocal carpetas_count, archivos_count
        if depth > 5:
            return
        try:
            data = _call("disk.folder.getchildren", {"id": folder_id})
            children = data.get("result") or []
        except Exception as e:
            stdout.write(f"    [drive] Error obteniendo hijos de {folder_id}: {e}")
            return

        for item in children:
            nombre = item.get("NAME", "Sin nombre")
            tipo = item.get("TYPE", "")

            if tipo == "folder":
                if not dry_run:
                    carpeta_obj, _ = CarpetaProyecto.objects.get_or_create(
                        proyecto=proyecto,
                        carpeta_padre=carpeta_padre_django,
                        nombre=nombre[:255],
                        defaults={
                            'creado_por': default_user,
                            'bitrix_folder_id': item.get("ID"),
                        }
                    )
                    # Actualizar bitrix_folder_id si estaba vacío
                    if not carpeta_obj.bitrix_folder_id:
                        CarpetaProyecto.objects.filter(pk=carpeta_obj.pk).update(
                            bitrix_folder_id=item.get("ID")
                        )
                else:
                    carpeta_obj = None
                carpetas_count += 1
                _process_folder(item["ID"], carpeta_obj, depth + 1)

            elif tipo == "file":
                tipo_archivo, ext = _get_tipo_archivo(nombre)
                download_url = item.get("DOWNLOAD_URL") or item.get("DETAIL_URL") or ""
                bitrix_file_id = item.get("ID")
                tamaño = int(item.get("SIZE") or 0)

                if not dry_run:
                    existing = ArchivoProyecto.objects.filter(
                        proyecto=proyecto,
                        bitrix_file_id=bitrix_file_id
                    ).first() if bitrix_file_id else None

                    if not existing:
                        ArchivoProyecto.objects.create(
                            nombre_original=nombre[:255],
                            archivo='',
                            tipo_archivo=tipo_archivo,
                            tamaño=tamaño,
                            proyecto=proyecto,
                            carpeta=carpeta_padre_django,
                            subido_por=default_user,
                            extension=ext[:10],
                            bitrix_file_id=bitrix_file_id,
                            bitrix_download_url=download_url,
                        )
                archivos_count += 1

    # Procesar los hijos de la raíz del storage directamente
    def _process_children(children, carpeta_padre_django=None, depth=0):
        nonlocal carpetas_count, archivos_count
        if depth > 5:
            return
        for item in children:
            nombre = item.get("NAME", "Sin nombre")
            tipo = (item.get("TYPE") or "").lower()
            if tipo == "folder":
                if not dry_run:
                    carpeta_obj, _ = CarpetaProyecto.objects.get_or_create(
                        proyecto=proyecto,
                        carpeta_padre=carpeta_padre_django,
                        nombre=nombre[:255],
                        defaults={'creado_por': default_user, 'bitrix_folder_id': item.get("ID")},
                    )
                    if not carpeta_obj.bitrix_folder_id:
                        CarpetaProyecto.objects.filter(pk=carpeta_obj.pk).update(bitrix_folder_id=item.get("ID"))
                else:
                    carpeta_obj = None
                carpetas_count += 1
                try:
                    sub = _call("disk.folder.getchildren", {"id": item["ID"]})
                    _process_children(sub.get("result") or [], carpeta_obj, depth + 1)
                except Exception:
                    pass
            else:
                tipo_archivo, ext = _get_tipo_archivo(nombre)
                download_url = item.get("DOWNLOAD_URL") or item.get("DETAIL_URL") or ""
                bitrix_file_id = item.get("ID")
                tamaño = int(item.get("SIZE") or 0)
                if not dry_run:
                    existing = ArchivoProyecto.objects.filter(proyecto=proyecto, bitrix_file_id=bitrix_file_id).first() if bitrix_file_id else None
                    if not existing:
                        ArchivoProyecto.objects.create(
                            nombre_original=nombre[:255], archivo='', tipo_archivo=tipo_archivo,
                            tamaño=tamaño, proyecto=proyecto, carpeta=carpeta_padre_django,
                            subido_por=default_user, extension=ext[:10],
                            bitrix_file_id=bitrix_file_id, bitrix_download_url=download_url,
                        )
                archivos_count += 1

    _process_children(root_children)
    return carpetas_count, archivos_count


# ── Importar Tareas ────────────────────────────────────────────────────────────

def _import_tasks(group_id, proyecto, bitrix_user_map, default_user, dry_run, stdout):
    """Importa tareas de Bitrix al proyecto Django."""
    try:
        data = _call("tasks.task.list", {
            "filter": {"GROUP_ID": group_id},
            "select": ["ID", "TITLE", "DESCRIPTION", "STATUS", "PRIORITY",
                       "DEADLINE", "CREATED_DATE", "RESPONSIBLE_ID", "CREATED_BY"],
        })
        tasks = (data.get("result") or {}).get("tasks") or []
    except Exception as e:
        stdout.write(f"    [tasks] Error: {e}")
        return 0

    # Bitrix24 status codes:
    # 1=New, 2=Pending, 3=In Progress, 4=Supposedly Completed, 5=Completed, 6=Deferred, 7=Declined
    _status_map = {
        "1": "pendiente", "2": "pendiente", "3": "en_progreso",
        "4": "en_progreso", "5": "completada", "6": "pendiente", "7": "cancelada",
    }
    _priority_map = {"0": "baja", "1": "media", "2": "alta"}
    count = 0

    for t in tasks:
        bitrix_task_id = int(t.get("id") or t.get("ID") or 0)
        if not bitrix_task_id:
            continue

        resp_id = str(t.get("responsibleId") or t.get("RESPONSIBLE_ID") or "")
        responsable = bitrix_user_map.get(resp_id) or default_user

        created_by_id = str(t.get("createdBy") or t.get("CREATED_BY") or "")
        creador = bitrix_user_map.get(created_by_id) or default_user

        status_val = str(t.get("status") or t.get("STATUS") or "1")
        priority_val = str(t.get("priority") if t.get("priority") is not None else (t.get("PRIORITY") or "1"))

        if not dry_run:
            Tarea.objects.update_or_create(
                bitrix_task_id=bitrix_task_id,
                defaults={
                    'titulo': (t.get("title") or t.get("TITLE") or "Sin título")[:255],
                    'descripcion': t.get("description") or t.get("DESCRIPTION") or "",
                    'estado': _status_map.get(status_val, "pendiente"),
                    'prioridad': _priority_map.get(priority_val, "media"),
                    'asignado_a': responsable,
                    'creado_por': creador,
                    'proyecto': proyecto,
                    'fecha_limite': parse_datetime(t.get("deadline") or t.get("DEADLINE") or "") or None,
                }
            )
        count += 1

    return count


# ── Importar Feed ─────────────────────────────────────────────────────────────

def _import_feed(group_id, proyecto, bitrix_user_map, default_user, dry_run, stdout):
    """Importa posts del muro del grupo como comentarios de proyecto."""
    try:
        data = _call("sonet.log.get", {
            "ENTITY_TYPE": "G",
            "ENTITY_ID": group_id,
            "LOG_SOURCE_ID": "BLOG",
        })
        posts = data.get("result") or []
    except Exception as e:
        stdout.write(f"    [feed] No disponible: {e}")
        return 0

    count = 0
    for post in posts:
        bitrix_id = int(post.get("ID") or 0)
        if not bitrix_id:
            continue

        if ProyectoComentario.objects.filter(bitrix_comment_id=bitrix_id).exists():
            continue

        author_id = int(post.get("AUTHOR_ID") or 0)
        usuario = bitrix_user_map.get(author_id)
        autor_nombre = post.get("AUTHOR_NAME") or ""
        contenido = post.get("MESSAGE") or post.get("TEXT_MESSAGE") or ""
        fecha = parse_datetime(post.get("LOG_DATE") or "") or timezone.now()

        if not dry_run:
            c = ProyectoComentario(
                proyecto=proyecto,
                usuario=usuario,
                contenido=contenido or "(sin contenido)",
                bitrix_comment_id=bitrix_id,
                bitrix_autor_nombre=autor_nombre[:255],
            )
            c.save()
            if fecha:
                ProyectoComentario.objects.filter(pk=c.pk).update(fecha_creacion=fecha)
        count += 1

    return count


# ── Importar Miembros ─────────────────────────────────────────────────────────

def _import_members(group_id, proyecto, bitrix_user_map, dry_run):
    """Importa miembros del grupo Bitrix al proyecto Django."""
    try:
        data = _call("sonet_group.user.get", {"ID": group_id})
        members = data.get("result") or []
        for m in members:
            uid = int(m.get("USER_ID") or 0)
            if uid and uid in bitrix_user_map:
                if not dry_run:
                    proyecto.miembros.add(bitrix_user_map[uid])
        return len(members)
    except Exception:
        return 0


# ── Comando principal ─────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = "Importa proyectos de ingeniería desde Bitrix24 (filtrados por contenido de Drive)"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--reset", action="store_true",
                            help="Limpia proyectos de ingeniería previos antes de importar")
        parser.add_argument("--skip-tasks", action="store_true")
        parser.add_argument("--skip-feed", action="store_true")
        parser.add_argument("--skip-drive", action="store_true")
        parser.add_argument("--group-ids", nargs="+", type=int)
        parser.add_argument("--debug-drive", action="store_true",
                            help="Muestra qué archivos encuentra en el drive de cada grupo")

    def handle(self, *args, **options):
        if not WEBHOOK_BASE:
            self.stderr.write(self.style.ERROR("BITRIX_PROJECTS_WEBHOOK_URL no configurado."))
            return

        dry_run = options["dry_run"]
        if dry_run:
            self.stdout.write(self.style.WARNING("MODO DRY-RUN — no se guardará nada"))

        if options["reset"] and not dry_run:
            count = Proyecto.objects.filter(es_ingenieria=True).delete()[0]
            self.stdout.write(self.style.WARNING(f"Reset: {count} proyectos de ingeniería eliminados"))

        # Mapa bitrix_user_id → Django User
        bitrix_user_map = {}
        for profile in UserProfile.objects.filter(bitrix_user_id__isnull=False).select_related('user'):
            bitrix_user_map[str(profile.bitrix_user_id)] = profile.user

        self.stdout.write(f"Usuarios mapeados con Bitrix: {len(bitrix_user_map)}")

        default_user = User.objects.filter(username="bitrix_import").first()
        if not default_user:
            default_user, _ = User.objects.get_or_create(
                username="bitrix_import",
                defaults={"first_name": "Bitrix", "last_name": "Import", "is_active": False},
            )

        # Obtener grupos de Bitrix
        self.stdout.write("Descargando grupos de Bitrix24...")
        payload = {"select": ["ID", "NAME", "DESCRIPTION", "DATE_CREATE", "OWNER_ID"]}
        if options.get("group_ids"):
            payload["filter"] = {"ID": options["group_ids"]}

        try:
            groups = _get_all_pages("sonet_group.get", payload)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Error descargando grupos: {e}"))
            return

        self.stdout.write(f"Total grupos en Bitrix: {len(groups)}")

        # Filtrar por IDs específicos si se indicaron (la API no lo filtra correctamente)
        if options.get("group_ids"):
            ids_set = set(options["group_ids"])
            groups = [g for g in groups if int(g["ID"]) in ids_set]
            self.stdout.write(f"Filtrando a {len(groups)} grupo(s): {options['group_ids']}")

        stats = {
            "evaluados": 0,
            "importantes": 0,
            "descartados": 0,
            "proyectos_creados": 0,
            "proyectos_actualizados": 0,
            "tareas": 0,
            "carpetas": 0,
            "archivos": 0,
            "feed": 0,
            "errores": 0,
        }

        for group in groups:
            stats["evaluados"] += 1
            group_id = int(group["ID"])
            nombre = (group.get("NAME") or f"Proyecto {group_id}").strip()

            self.stdout.write(f"\n  [{group_id}] {nombre[:70]}")

            # ── Filtro de importancia ──────────────────────────────────────
            forzar_ids = bool(options.get("group_ids"))
            debug_drive = bool(options.get("debug_drive"))
            # Si se usa --debug-drive, siempre corre el check (aunque se especifiquen IDs)
            run_drive_check = (not forzar_ids or debug_drive) and not options["skip_drive"]

            if run_drive_check:
                self.stdout.write("    Verificando drive...", ending="")
                debug_fn = self.stdout.write if debug_drive else None
                if debug_fn:
                    self.stdout.write("")  # newline antes del debug
                try:
                    importante = _proyecto_es_ingenieria(group_id, debug_out=debug_fn)
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f" Error: {e}"))
                    stats["errores"] += 1
                    continue

                if not importante:
                    if forzar_ids:
                        # Con --group-ids + --debug-drive: muestra el resultado pero no descarta
                        self.stdout.write(self.style.WARNING(" [DRIVE: sin match] — importando igualmente por --group-ids"))
                    else:
                        self.stdout.write(self.style.WARNING(" [DESCARTADO] Sin archivos de ingeniería"))
                        stats["descartados"] += 1
                        continue
                else:
                    self.stdout.write(self.style.SUCCESS(" [IMPORTANTE]"))


            stats["importantes"] += 1

            # ── Crear/actualizar Proyecto ──────────────────────────────────
            try:
                if not dry_run:
                    proyecto, created = Proyecto.objects.update_or_create(
                        bitrix_group_id=group_id,
                        defaults={
                            "nombre": nombre,
                            "descripcion": (group.get("DESCRIPTION") or "").strip(),
                            "creado_por": default_user,
                            "tipo": "ingenieria",
                            "es_ingenieria": True,
                        },
                    )
                    fecha_bitrix = parse_datetime(group.get("DATE_CREATE") or "")
                    if fecha_bitrix:
                        Proyecto.objects.filter(pk=proyecto.pk).update(fecha_creacion=fecha_bitrix)
                    if created:
                        stats["proyectos_creados"] += 1
                        self.stdout.write(self.style.SUCCESS("    Proyecto CREADO"))
                    else:
                        stats["proyectos_actualizados"] += 1
                        self.stdout.write("    Proyecto actualizado")
                else:
                    proyecto = None
                    exists = Proyecto.objects.filter(bitrix_group_id=group_id).exists()
                    self.stdout.write(f"    [DRY] {'ACTUALIZAR' if exists else 'CREAR'} Proyecto")

                # ── Miembros ───────────────────────────────────────────────
                if proyecto:
                    _import_members(group_id, proyecto, bitrix_user_map, dry_run)

                # ── Drive ─────────────────────────────────────────────────
                if not options["skip_drive"] and proyecto:
                    c, a = _import_drive(group_id, proyecto, default_user, dry_run, self.stdout)
                    stats["carpetas"] += c
                    stats["archivos"] += a
                    self.stdout.write(f"    Drive: {c} carpetas, {a} archivos")

                # ── Tareas ────────────────────────────────────────────────
                if not options["skip_tasks"] and proyecto:
                    t = _import_tasks(group_id, proyecto, bitrix_user_map, default_user, dry_run, self.stdout)
                    stats["tareas"] += t
                    self.stdout.write(f"    Tareas: {t}")

                # ── Feed ──────────────────────────────────────────────────
                if not options["skip_feed"] and proyecto:
                    f = _import_feed(group_id, proyecto, bitrix_user_map, default_user, dry_run, self.stdout)
                    stats["feed"] += f
                    if f:
                        self.stdout.write(f"    Feed: {f} entradas")

            except Exception as e:
                stats["errores"] += 1
                self.stderr.write(self.style.ERROR(f"    Error procesando grupo {group_id}: {e}"))

        # ── Resumen ────────────────────────────────────────────────────────
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=== Sincronización de Proyectos de Ingeniería Completada ==="))
        for k, v in stats.items():
            self.stdout.write(f"  {k}: {v}")

"""
Comando para importar absolutamente TODAS las tareas desde Bitrix24.
Se encargará de:
1. Extraer todas las tareas (pertenezcan o no a un proyecto).
2. Asignarlas correctamente a Creador, Responsable, y Participantes/Observadores.
3. Si la tarea pertenece a un Grupo/Proyecto que ya importamos, la vinculará automáticamente a ese Proyecto local.

Uso:
    python manage.py sync_bitrix_all_tasks
    python manage.py sync_bitrix_all_tasks --dry-run
"""

import os
import time
import requests
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils.dateparse import parse_datetime

from app.models import Proyecto, Tarea, UserProfile, TodoItem

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
        except requests.RequestException:
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
            batch = batch["tasks"] # Formato especial de tasks.task.list
        elif isinstance(batch, dict):
            batch = []
            
        if not batch:
            break
        records.extend(batch)
        
        # En tasks.task.list a veces 'total' no viene o viene distinto, pero 'next' indica si hay más
        if "next" in data:
            start = data["next"]
        elif len(records) >= data.get("total", 0):
            break
        else:
            start += 50
    return records

def _map_status_tarea(bitrix_status):
    mapping = {
        "1": "pendiente", "2": "iniciada", "3": "completada",
        "4": "en_progreso", "5": "cancelada", "6": "cancelada",
    }
    return mapping.get(str(bitrix_status), "pendiente")

def _map_priority_tarea(bitrix_priority):
    return {"0": "baja", "1": "media", "2": "alta"}.get(str(bitrix_priority), "media")

def _get_or_create_default_user():
    user, _ = User.objects.get_or_create(
        username="bitrix_import",
        defaults={"first_name": "Bitrix", "last_name": "Import", "is_active": False},
    )
    return user


class Command(BaseCommand):
    help = "Importa todas las tareas de Bitrix24 y las asigna a proyectos y usuarios"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Muestra acciones sin guardar")

    def handle(self, *args, **options):
        if not WEBHOOK_BASE:
            self.stderr.write(self.style.ERROR("Webhook de Bitrix no configurado."))
            return

        dry_run = options["dry_run"]
        if dry_run:
            self.stdout.write(self.style.WARNING("MODO DRY-RUN — no se guardará nada"))

        self.stats = {
            "tareas_creadas": 0,
            "tareas_actualizadas": 0,
            "errores": 0,
            "vinculadas_proyecto": 0,
            "vinculadas_oportunidad": 0,
            "ignoradas": 0
        }
        
        # 1. Mapa de Usuarios
        self.user_map = {}
        for up in UserProfile.objects.filter(bitrix_user_id__isnull=False):
            self.user_map[str(up.bitrix_user_id)] = up.user
            
        # 2. Mapa de Proyectos (Bitrix Group ID -> Django Proyecto)
        self.proyecto_map = {}
        for p in Proyecto.objects.filter(bitrix_group_id__isnull=False):
            self.proyecto_map[str(p.bitrix_group_id)] = p

        # 3. Mapa de Oportunidades (Deals)
        self.deal_map = {}
        for d in TodoItem.objects.filter(bitrix_deal_id__isnull=False):
            self.deal_map[str(d.bitrix_deal_id)] = d

        default_user = _get_or_create_default_user()

        self.stdout.write("Descargando TODAS las tareas de Bitrix24...")
        try:
            # Traemos TODAS las tareas (sin filtrar por GROUP_ID)
            tasks = _get_all_pages("tasks.task.list", {
                "select": [
                    "ID", "TITLE", "DESCRIPTION", "STATUS", "PRIORITY",
                    "DEADLINE", "CREATED_DATE", "RESPONSIBLE_ID", "CREATED_BY",
                    "ACCOMPLICES", "AUDITORS", "CLOSED_DATE", "GROUP_ID", "UF_CRM_TASK"
                ],
            })
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Error fatal al descargar tareas: {e}"))
            return

        self.stdout.write(f"Total de tareas descubiertas: {len(tasks)}")

        for t in tasks:
            try:
                self._process_task(t, default_user, dry_run)
            except Exception as e:
                self.stats["errores"] += 1
                self.stderr.write(self.style.ERROR(f"Error procesando tarea {t.get('id')}: {e}"))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=== Sincronización Global de Tareas Completada ==="))
        for k, v in self.stats.items():
            self.stdout.write(f"  {k}: {v}")

    def _process_task(self, t, default_user, dry_run):
        bitrix_task_id = int(t["id"])
        titulo = (t.get("title") or t.get("TITLE") or f"Tarea {bitrix_task_id}").strip()
        descripcion = (t.get("description") or t.get("DESCRIPTION") or "").strip()

        fecha_limite = None
        if t.get("deadline") or t.get("DEADLINE"):
            fecha_limite = parse_datetime(t.get("deadline") or t.get("DEADLINE"))

        bitrix_created = None
        if t.get("createdDate") or t.get("CREATED_DATE"):
            bitrix_created = parse_datetime(t.get("createdDate") or t.get("CREATED_DATE"))
            
        fecha_completada = None
        if t.get("closedDate") or t.get("CLOSED_DATE"):
            fecha_completada = parse_datetime(t.get("closedDate") or t.get("CLOSED_DATE"))

        # Usuarios
        creador_id = str(t.get("createdBy") or t.get("CREATED_BY") or "")
        responsable_id = str(t.get("responsibleId") or t.get("RESPONSIBLE_ID") or "")
        accomplices_ids = t.get("accomplices") or t.get("ACCOMPLICES") or []
        auditors_ids = t.get("auditors") or t.get("AUDITORS") or []

        creador = self.user_map.get(creador_id, default_user)
        responsable = self.user_map.get(responsable_id, default_user)
        
        estado = _map_status_tarea(t.get("status") or t.get("STATUS") or "1")
        prioridad = _map_priority_tarea(t.get("priority") or t.get("PRIORITY") or "1")

        # Vincular a Proyecto si existe
        group_id = str(t.get("groupId") or t.get("GROUP_ID") or "")
        proyecto = self.proyecto_map.get(group_id)

        # Vincular a Oportunidad si existe en UF_CRM_TASK
        uf_crm = t.get("ufCrmTask") or t.get("UF_CRM_TASK") or []
        if isinstance(uf_crm, str):
            uf_crm = [uf_crm]

        oportunidad = None
        for item in uf_crm:
            # Bitrix deals guardan el formato "D_1234"
            if item.startswith("D_"):
                deal_id = item.replace("D_", "")
                oportunidad = self.deal_map.get(deal_id)
                if oportunidad:
                    break

        # Regla de Negocio: 
        # 1. Prioridad: Oportunidad. Si tiene ambos, se liga a oportunidad y se le quita el proyecto.
        # 2. Si no tiene oportunidad, se queda en proyecto.
        # 3. Si no tiene NINGÚN vínculo válido (ni proy ni opp), no la traemos.
        
        if oportunidad:
            proyecto = None  # Se da prioridad absoluta a la oportunidad
        
        if not oportunidad and not proyecto:
            self.stats["ignoradas"] += 1
            if dry_run:
                self.stdout.write(f"  [DRY/OMITIDA] TAREA '{titulo[:40]}' - Sin Oportunidad ni Proyecto local.")
            return

        if not dry_run:
            tarea, created = Tarea.objects.update_or_create(
                bitrix_task_id=bitrix_task_id,
                defaults={
                    "titulo": titulo,
                    "descripcion": descripcion,
                    "estado": estado,
                    "prioridad": prioridad,
                    "fecha_limite": fecha_limite,
                    "fecha_completada": fecha_completada,
                    "proyecto": proyecto, # Se vincula directo aquí
                    "oportunidad": oportunidad, # Se vincula a la oportunidad
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
                
            if oportunidad:
                self.stats["vinculadas_oportunidad"] += 1
            elif proyecto:
                self.stats["vinculadas_proyecto"] += 1
        else:
            vinculos = []
            if proyecto: vinculos.append(f"Proy: {proyecto.nombre[:15]}...")
            if oportunidad: vinculos.append(f"Opp: {oportunidad.oportunidad[:15]}...")
            
            vinculos_str = " | ".join(vinculos)
            if vinculos_str:
                vinculos_str = "| " + vinculos_str
            else:
                vinculos_str = "| Sin Vínculos"

            creator_name = creador.username
            resp_name = responsable.username
            
            part_names = [self.user_map[str(uid)].username for uid in accomplices_ids if str(uid) in self.user_map]
            obs_names = [self.user_map[str(uid)].username for uid in auditors_ids if str(uid) in self.user_map]

            part_str = f" | Part: {','.join(part_names)}" if part_names else ""
            obs_str = f" | Obs: {','.join(obs_names)}" if obs_names else ""

            self.stdout.write(f"  [DRY] TAREA '{titulo[:40]}' - Creador: {creator_name} -> Resp: {resp_name}{part_str}{obs_str} {vinculos_str}")

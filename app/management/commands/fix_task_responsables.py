"""
Corrige tareas (Tarea + TareaOportunidad) cuyo responsable/creador es el usuario
ficticio "bitrix_import", buscando en Bitrix el nombre real del responsable y
mapeándolo al usuario Django correspondiente.

También puede re-importar tareas de proyectos vinculados que aún no tengan
responsable correcto usando --re-import.

Uso:
    python manage.py fix_task_responsables --dry-run
    python manage.py fix_task_responsables
    python manage.py fix_task_responsables --re-import   # vuelve a importar tareas sin responsable real
"""

import os
import time
from difflib import SequenceMatcher

import requests
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from app.models import Tarea, TareaOportunidad, UserProfile

WEBHOOK_BASE = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)


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


def _get_bitrix_users() -> dict:
    """Devuelve {bitrix_id_str: {'nombre': ..., 'email': ...}}"""
    result = {}
    start = 0
    while True:
        data = _call("user.get", {"start": start, "filter": {"ACTIVE": True}})
        items = data.get("result") or []
        if not items:
            break
        for u in items:
            uid = str(u.get("ID", ""))
            nombre = (u.get("NAME", "") + " " + u.get("LAST_NAME", "")).strip()
            result[uid] = {"nombre": nombre, "email": u.get("EMAIL", "")}
        if len(result) >= data.get("total", 0):
            break
        start += 50
    return result


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _match_django_user(bitrix_nombre: str, bitrix_email: str, django_users: list) -> User | None:
    """Intenta encontrar el usuario Django más parecido por nombre o email."""
    if bitrix_email:
        by_email = next((u for u in django_users if u.email.lower() == bitrix_email.lower()), None)
        if by_email:
            return by_email

    best_user = None
    best_score = 0.0
    for u in django_users:
        full = (u.first_name + " " + u.last_name).strip()
        score = _similarity(bitrix_nombre, full)
        if score > best_score:
            best_score = score
            best_user = u

    return best_user if best_score >= 0.70 else None


class Command(BaseCommand):
    help = 'Corrige el responsable "bitrix_import" en tareas, mapeando al usuario real de Bitrix'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Solo muestra qué cambiaría, sin guardar')
        parser.add_argument('--re-import', action='store_true',
                            help='También re-importa TareaOportunidad con bitrix_task_id usando la API de Bitrix')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        if dry_run:
            self.stdout.write(self.style.WARNING("── DRY RUN ──\n"))

        # Usuario ficticio que queremos reemplazar
        bitrix_import_user = User.objects.filter(username="bitrix_import").first()
        if not bitrix_import_user:
            self.stdout.write("No existe usuario 'bitrix_import' en el sistema.")
            return

        self.stdout.write(f"Usuario ficticio a reemplazar: {bitrix_import_user.username} (id={bitrix_import_user.id})")

        # Construir mapa de usuarios existentes: bitrix_id → Django User
        existing_map = {}
        for p in UserProfile.objects.select_related('user').exclude(bitrix_user_id=None):
            existing_map[str(p.bitrix_user_id)] = p.user
        self.stdout.write(f"Usuarios mapeados por UserProfile: {len(existing_map)}")

        # Obtener todos los usuarios de Bitrix para intentar match por nombre
        self.stdout.write("Descargando usuarios de Bitrix...")
        bitrix_users = _get_bitrix_users()
        self.stdout.write(f"Usuarios Bitrix obtenidos: {len(bitrix_users)}")

        django_users = list(User.objects.filter(is_active=True).exclude(username="bitrix_import"))

        # Expandir el mapa con matches por nombre/email para los IDs no mapeados
        name_map = dict(existing_map)
        for bid, bdata in bitrix_users.items():
            if bid not in name_map:
                matched = _match_django_user(bdata['nombre'], bdata['email'], django_users)
                if matched:
                    name_map[bid] = matched

        self.stdout.write(f"Mapa total (id + nombre): {len(name_map)}\n")

        # ── Corregir Tarea ─────────────────────────────────────────────────────
        self.stdout.write("=== Corrigiendo Tarea ===")
        tareas_q = Tarea.objects.filter(asignado_a=bitrix_import_user).select_related('oportunidad')
        self.stdout.write(f"Tareas con responsable bitrix_import: {tareas_q.count()}")

        cnt_fix = cnt_skip = cnt_no_map = 0
        for tarea in tareas_q:
            # Las tareas importadas de Bitrix tienen bitrix_task_id si existe;
            # sino intentamos usar el proyecto para inferir el responsable de la opp
            new_user = None

            # Intentar por el bitrix_task_id almacenado en el título o descripción
            # (no hay campo bitrix_task_id en Tarea, así que usamos el responsable de la oportunidad)
            if tarea.oportunidad and tarea.oportunidad.usuario:
                opp_user = tarea.oportunidad.usuario
                if opp_user != bitrix_import_user:
                    new_user = opp_user

            if new_user:
                self.stdout.write(f"  [{tarea.id}] {tarea.titulo[:50]} → {new_user.get_full_name() or new_user.username}")
                if not dry_run:
                    tarea.asignado_a = new_user
                    tarea.save(update_fields=['asignado_a'])
                cnt_fix += 1
            else:
                self.stdout.write(f"  [{tarea.id}] {tarea.titulo[:50]} → sin mapeo")
                cnt_no_map += 1

        self.stdout.write(f"Tarea: {cnt_fix} corregidas, {cnt_no_map} sin mapeo\n")

        # ── Corregir TareaOportunidad ──────────────────────────────────────────
        self.stdout.write("=== Corrigiendo TareaOportunidad ===")
        topp_q = TareaOportunidad.objects.filter(
            responsable=bitrix_import_user
        ).select_related('oportunidad')
        self.stdout.write(f"TareaOportunidad con responsable bitrix_import: {topp_q.count()}")

        cnt_fix2 = cnt_no_map2 = 0

        if options['re_import']:
            # Con --re-import: busca en Bitrix el responsable real por bitrix_task_id
            for topp in topp_q:
                if not topp.bitrix_task_id:
                    cnt_no_map2 += 1
                    continue
                real_bitrix_id = -(topp.bitrix_task_id + 100_000_000)  # revertir offset
                task_data = _call("tasks.task.get", {"taskId": real_bitrix_id})
                task = (task_data.get("result") or {}).get("task") or {}
                resp_bid = str(task.get("responsibleId") or task.get("RESPONSIBLE_ID") or "")
                new_user2 = name_map.get(resp_bid)
                if new_user2:
                    self.stdout.write(f"  [{topp.id}] {topp.titulo[:50]} → {new_user2.get_full_name() or new_user2.username} (Bitrix ID {resp_bid})")
                    if not dry_run:
                        topp.responsable = new_user2
                        topp.save(update_fields=['responsable'])
                    cnt_fix2 += 1
                else:
                    # Fallback: responsable de la oportunidad
                    if topp.oportunidad and topp.oportunidad.usuario != bitrix_import_user:
                        new_user2 = topp.oportunidad.usuario
                        self.stdout.write(f"  [{topp.id}] {topp.titulo[:50]} → {new_user2.get_full_name()} (fallback opp)")
                        if not dry_run:
                            topp.responsable = new_user2
                            topp.save(update_fields=['responsable'])
                        cnt_fix2 += 1
                    else:
                        cnt_no_map2 += 1
        else:
            # Sin --re-import: usa responsable de la oportunidad como fallback
            for topp in topp_q:
                new_user2 = None
                if topp.oportunidad and topp.oportunidad.usuario != bitrix_import_user:
                    new_user2 = topp.oportunidad.usuario
                if new_user2:
                    self.stdout.write(f"  [{topp.id}] {topp.titulo[:50]} → {new_user2.get_full_name() or new_user2.username}")
                    if not dry_run:
                        topp.responsable = new_user2
                        topp.save(update_fields=['responsable'])
                    cnt_fix2 += 1
                else:
                    cnt_no_map2 += 1

        self.stdout.write(f"TareaOportunidad: {cnt_fix2} corregidas, {cnt_no_map2} sin mapeo\n")

        self.stdout.write("─" * 50)
        self.stdout.write(f"✅ Total corregidas : {cnt_fix + cnt_fix2}")
        self.stdout.write(f"⚠  Sin mapeo       : {cnt_no_map + cnt_no_map2}")
        if dry_run:
            self.stdout.write(self.style.WARNING("\n(DRY RUN: no se guardó nada)"))
        self.stdout.write("\n=== FIN ===")

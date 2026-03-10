"""
Importa tareas de proyectos Bitrix ya vinculados a oportunidades.

Requisito: haber corrido sync_bitrix_drive_smart primero para que existan
los registros OportunidadProyecto con bitrix_project_id.

Por cada proyecto vinculado consulta tasks.task.list con GROUP_ID y crea
TareaOportunidad + Actividad calendario (si pendiente) + mensaje en conversación.

Anti-duplicados: TareaOportunidad.bitrix_task_id (negativo, mismo offset que
import_bitrix_timeline para tareas Bitrix).

Uso:
    python manage.py import_project_tasks --dry-run
    python manage.py import_project_tasks
    python manage.py import_project_tasks --project-id 1234
"""

import os
import time
from datetime import datetime, timedelta, timezone as dt_timezone

import requests
from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import (
    Actividad, MensajeOportunidad, OportunidadProyecto,
    TareaOportunidad, UserProfile,
)

BITRIX_PROJECTS_WEBHOOK_URL = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)

TASK_STATUS_COMPLETADA = {'5', '4'}
BITRIX_TASK_ID_OFFSET = -100_000_000  # mismo que import_bitrix_timeline


def _tasks_url():
    base = BITRIX_PROJECTS_WEBHOOK_URL.rsplit("/", 1)[0] + "/"
    return base + "tasks.task.list.json"


def _parse_date(raw):
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=dt_timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def _dates_for_task(task: dict):
    inicio = _parse_date(task.get('startDatePlan') or task.get('START_DATE_PLAN'))
    fin = (
        _parse_date(task.get('endDatePlan') or task.get('END_DATE_PLAN'))
        or _parse_date(task.get('deadline') or task.get('DEADLINE'))
        or _parse_date(task.get('closedDate') or task.get('CLOSED_DATE'))
    )
    if not inicio:
        inicio = fin or timezone.now()
    if not fin or fin <= inicio:
        fin = inicio + timedelta(hours=1)
    return inicio, fin


def _fmt_fecha(dt) -> str:
    return dt.astimezone().strftime('%d/%m/%Y') if dt else ''


def _fmt_hora(dt) -> str:
    return dt.astimezone().strftime('%H:%M') if dt else ''


def _fetch_group_tasks(group_id: int) -> list:
    tasks, start = [], 0
    while True:
        try:
            resp = requests.post(_tasks_url(), json={
                'filter': {'GROUP_ID': group_id},
                'select': ['ID', 'TITLE', 'DESCRIPTION', 'STATUS',
                           'RESPONSIBLE_ID', 'CREATOR_ID',
                           'CREATED_DATE', 'CLOSED_DATE', 'DEADLINE',
                           'START_DATE_PLAN', 'END_DATE_PLAN'],
                'start': start,
            }, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            result = data.get('result', {})
            items = result.get('tasks', result) if isinstance(result, dict) else result
            if not isinstance(items, list):
                break
            tasks.extend(items)
            if 'next' in data:
                start = data['next']
            else:
                break
        except requests.RequestException as e:
            print(f"  ⚠ tasks grupo {group_id}: {e}")
            break
    return tasks


def _get_user_map():
    mapping = {}
    for p in UserProfile.objects.select_related('user').exclude(bitrix_user_id=None):
        mapping[str(p.bitrix_user_id)] = p.user
    return mapping


class Command(BaseCommand):
    help = 'Importa tareas de proyectos Bitrix vinculados a oportunidades'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Solo mostrar qué se importaría, sin guardar')
        parser.add_argument('--project-id', type=int, default=0,
                            help='Procesar solo este bitrix_project_id')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        only_project = options['project_id']

        if dry_run:
            self.stdout.write(self.style.WARNING("── DRY RUN (no se guarda nada) ──\n"))

        user_map = _get_user_map()
        self.stdout.write(f"Usuarios mapeados: {len(user_map)}")

        qs = OportunidadProyecto.objects.select_related('oportunidad').exclude(
            bitrix_project_id=None
        )
        if only_project:
            qs = qs.filter(bitrix_project_id=only_project)

        links = list(qs)
        self.stdout.write(f"Proyectos vinculados a procesar: {len(links)}\n")

        cnt_new = cnt_skip = cnt_err = 0
        unmapped_ids = set()

        for link in links:
            opp = link.oportunidad
            group_id = link.bitrix_project_id
            self.stdout.write(f"── Proyecto {group_id} → Oportunidad #{opp.id} {opp.oportunidad[:50]}")

            try:
                tasks = _fetch_group_tasks(group_id)
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"  Error fetch: {e}"))
                cnt_err += 1
                continue

            self.stdout.write(f"  Tareas en Bitrix: {len(tasks)}")

            for task in tasks:
                task_id = int(task.get('id') or task.get('ID') or 0)
                if not task_id:
                    continue

                stored_id = BITRIX_TASK_ID_OFFSET - task_id

                # Anti-duplicado
                if TareaOportunidad.objects.filter(bitrix_task_id=stored_id).exists():
                    cnt_skip += 1
                    continue

                status = str(task.get('status') or task.get('STATUS') or '')
                completada = status in TASK_STATUS_COMPLETADA
                titulo = (task.get('title') or task.get('TITLE') or '').strip() or '(sin título)'
                desc = (task.get('description') or task.get('DESCRIPTION') or '').strip()
                resp_id = str(task.get('responsibleId') or task.get('RESPONSIBLE_ID') or
                              task.get('creatorId') or task.get('CREATOR_ID') or '')
                autor = user_map.get(resp_id)
                if not autor and resp_id:
                    unmapped_ids.add(resp_id)

                fecha_bitrix = _parse_date(
                    task.get('createdDate') or task.get('CREATED_DATE', '')
                ) or timezone.now()
                inicio_dt, fin_dt = _dates_for_task(task)

                lbl = '✓' if completada else '⏳'
                self.stdout.write(f"  {lbl} {task_id}: {titulo[:60]}")

                if dry_run:
                    cnt_new += 1
                    continue

                try:
                    tarea = TareaOportunidad.objects.create(
                        oportunidad=opp,
                        titulo=titulo,
                        descripcion=desc,
                        estado='completada' if completada else 'pendiente',
                        fecha_limite=fin_dt if not completada else None,
                        creado_por=autor or opp.usuario,
                        responsable=autor or opp.usuario,
                        bitrix_task_id=stored_id,
                    )
                    TareaOportunidad.objects.filter(pk=tarea.pk).update(fecha_creacion=fecha_bitrix)

                    if not completada:
                        actividad = Actividad.objects.create(
                            titulo=titulo,
                            tipo_actividad='tarea',
                            descripcion=desc,
                            fecha_inicio=inicio_dt,
                            fecha_fin=fin_dt,
                            creado_por=autor or opp.usuario,
                            color='#0052D4',
                            oportunidad=opp,
                        )
                        tarea.actividad_calendario = actividad
                        tarea.save(update_fields=['actividad_calendario'])

                    if completada:
                        chat_texto = f'[ACT_COMPLETADA:{tarea.id}]{titulo}'
                    else:
                        chat_texto = (
                            f'[ACT:{tarea.id}]{titulo}'
                            f'|{_fmt_fecha(inicio_dt)}|{_fmt_hora(inicio_dt)}'
                            f'|{_fmt_hora(fin_dt)}|{desc[:100]}'
                        )
                    msg = MensajeOportunidad.objects.create(
                        oportunidad=opp, usuario=autor or opp.usuario, texto=chat_texto
                    )
                    MensajeOportunidad.objects.filter(pk=msg.pk).update(fecha=fecha_bitrix)

                    cnt_new += 1
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"    ERROR: {e}"))
                    cnt_err += 1

        self.stdout.write("\n" + "─" * 55)
        self.stdout.write(f"✅ Tareas importadas  : {cnt_new}")
        self.stdout.write(f"⏭  Duplicadas        : {cnt_skip}")
        self.stdout.write(f"❌ Errores           : {cnt_err}")

        if unmapped_ids:
            self.stdout.write(
                f"\n⚠ IDs Bitrix sin mapear ({len(unmapped_ids)}): {', '.join(sorted(unmapped_ids))}"
            )
            self.stdout.write("  → Las tareas se asignaron al responsable de la oportunidad.")

        self.stdout.write("\n=== FIN ===")

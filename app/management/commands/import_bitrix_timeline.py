"""
Importa el historial (timeline) de oportunidades ACTIVAS de Bitrix24.

Qué se salta:
  - Oportunidades con etapa cerrada/perdida/pagada/cancelada
  - Actividades de tipo Email (TYPE_ID=6) — son cotizaciones ya en el sistema
  - Comentarios vacíos o de archivos adjuntos Bitrix [DISK FILE...]
  - Actividades/Tareas PENDIENTES (se importarán del calendario en otro paso)

Fuentes de datos:
  - crm.activity.list  → llamadas, reuniones, actividades CRM
  - tasks.task.list    → tareas del módulo Tasks vinculadas al deal (UF_CRM_TASK)
  - crm.timeline.comment.list → comentarios del timeline

Comportamiento:
  - Actividades/Tareas PENDIENTES → se ignoran (vendrán del calendario)
  - Actividades/Tareas COMPLETADAS → solo un MensajeOportunidad con resumen
    formato: [BITRIX_HIST:ID] ✓ Titulo\nDetalle
  - Comentarios del timeline → MensajeOportunidad normal (texto plano)

Anti-duplicados:
  - Actividades/Tareas completadas: texto empieza con [BITRIX_HIST:ID]
  - Comentarios: texto empieza con [BITRIX_CMT:ID]

Uso:
    python manage.py import_bitrix_timeline
    python manage.py import_bitrix_timeline --dry-run
    python manage.py import_bitrix_timeline --deal-id 12345
    python manage.py import_bitrix_timeline --limit 50
"""

from datetime import datetime, timedelta, timezone as dt_timezone

import os

import requests
from django.core.management.base import BaseCommand
from django.utils import timezone

from app.bitrix_integration import BITRIX_WEBHOOK_URL
from app.models import MensajeOportunidad, TodoItem

# Webhook de proyectos (tiene scope 'task') — el mismo que usa sync_bitrix_projects_tasks
BITRIX_PROJECTS_WEBHOOK_URL = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)


# Etapas que indican oportunidad cerrada — se ignoran
ETAPAS_CERRADAS = {
    'cerrado ganado', 'cerrado perdido', 'perdido', 'pagado',
    'cancelado', 'cancelada', 'ganado', 'perdida',
    'closed won', 'closed lost',
}

# Palabras en el asunto que indican cotización generada por el sistema (se ignoran).
# Las actividades manuales tipo "Cotizando con proveedor" no tienen este patrón.
# El formato de cotizaciones del sistema es: "Cliente - AcciónCotización - Proyecto"
_COTIZACION_KEYWORDS = (
    '- solicitar cotización', '- generar cotización', '- envío de cotización',
    '- envio de cotizacion', '- cotización enviada', '- cotizacion enviada',
    'solicitar cotizaci', 'generar cotizaci', 'envío de cotizaci', 'envio de cotizaci',
)

# Bitrix task STATUS: 5 = completada
TASK_STATUS_COMPLETADA = {'5', '4'}  # 4=supposedly_completed, 5=completed

# Prefijo negativo para tareas Bitrix (separar del namespace de actividades CRM)
BITRIX_TASK_ID_OFFSET = -100_000_000

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _url(method: str) -> str:
    return BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", f"{method}.json")


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


def _get_user_map():
    from app.models import UserProfile
    mapping = {}
    for p in UserProfile.objects.select_related('user').exclude(bitrix_user_id=None):
        mapping[str(p.bitrix_user_id)] = p.user
    return mapping




def _es_cotizacion_sistema(subject: str) -> bool:
    """Detecta si una actividad es una cotización generada por el sistema (no importar)."""
    s = subject.lower()
    return any(kw in s for kw in _COTIZACION_KEYWORDS)


def _is_etapa_cerrada(opp: TodoItem) -> bool:
    etapa = (opp.etapa_corta or opp.etapa_completa or '').lower().strip()
    if not etapa:
        return False
    for clave in ETAPAS_CERRADAS:
        if clave in etapa:
            return True
    return False


def _fetch_activities(deal_id: int) -> list:
    """Actividades CRM: llamadas, reuniones, etc. (crm.activity.list)"""
    url = _url("crm.activity.list")
    activities = []
    start = 0
    while True:
        try:
            resp = requests.post(url, json={
                'filter': {'OWNER_TYPE_ID': 2, 'OWNER_ID': deal_id},
                'select': ['ID', 'SUBJECT', 'DESCRIPTION', 'RESPONSIBLE_ID',
                           'CREATED', 'DEADLINE', 'START_TIME', 'END_TIME',
                           'TYPE_ID', 'COMPLETED'],
                'start': start,
            }, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            activities.extend(data.get('result', []))
            if 'next' in data:
                start = data['next']
            else:
                break
        except requests.exceptions.RequestException as e:
            print(f"  ⚠ activities deal {deal_id}: {e}")
            break
    return activities


def _tasks_url() -> str:
    """URL base del webhook de proyectos (tiene scope 'task')."""
    base = BITRIX_PROJECTS_WEBHOOK_URL.rsplit("/", 1)[0] + "/"
    return base + "tasks.task.list.json"


def _fetch_tasks(deal_id: int) -> list:
    """Tareas del módulo Tasks vinculadas al deal (tasks.task.list).
    Usa el webhook de proyectos (BITRIX_PROJECTS_WEBHOOK_URL) que tiene scope 'task'.
    """
    url = _tasks_url()
    tasks = []
    start = 0
    crm_ref = f"D_{deal_id}"
    while True:
        try:
            resp = requests.post(url, json={
                'filter': {'UF_CRM_TASK': crm_ref},
                'select': ['ID', 'TITLE', 'DESCRIPTION', 'RESPONSIBLE_ID',
                           'CREATED_DATE', 'CLOSED_DATE', 'DEADLINE',
                           'START_DATE_PLAN', 'END_DATE_PLAN', 'STATUS',
                           'CREATOR_ID'],
                'start': start,
            }, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            result = data.get('result', {})
            # tasks.task.list retorna {"result": {"tasks": [...]}}
            if isinstance(result, dict):
                items = result.get('tasks', [])
            elif isinstance(result, list):
                items = result
            else:
                items = []
            tasks.extend(items)
            if 'next' in data:
                start = data['next']
            else:
                break
        except requests.exceptions.RequestException as e:
            print(f"  ⚠ tasks deal {deal_id}: {e}")
            break
    return tasks


def _fetch_timeline_comments(deal_id: int) -> list:
    """Comentarios del timeline del deal."""
    url = _url("crm.timeline.comment.list")
    comments = []
    start = 0
    while True:
        try:
            resp = requests.post(url, json={
                'filter': {'ENTITY_TYPE': 'deal', 'ENTITY_ID': deal_id},
                'start': start,
            }, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            items = data.get('result', [])
            if isinstance(items, dict):
                items = list(items.values())
            comments.extend(items)
            if 'next' in data:
                start = data['next']
            else:
                break
        except requests.exceptions.RequestException as e:
            print(f"  ⚠ comments deal {deal_id}: {e}")
            break
    return comments


ACTIVITY_TYPES = {
    '1': 'Llamada', '2': 'Reunión', '4': 'Tarea', '10': 'Actividad',
}


def _dates_for_activity(act: dict):
    inicio = (_parse_date(act.get('START_TIME'))
              or _parse_date(act.get('DEADLINE'))
              or _parse_date(act.get('CREATED')))
    fin = _parse_date(act.get('END_TIME')) or _parse_date(act.get('DEADLINE'))
    if not inicio:
        inicio = timezone.now()
    if not fin or fin <= inicio:
        fin = inicio + timedelta(hours=1)
    return inicio, fin


def _dates_for_task(task: dict):
    inicio = (_parse_date(task.get('START_DATE_PLAN'))
              or _parse_date(task.get('CREATED_DATE')))
    fin = (_parse_date(task.get('END_DATE_PLAN'))
           or _parse_date(task.get('DEADLINE'))
           or _parse_date(task.get('CLOSED_DATE')))
    if not inicio:
        inicio = timezone.now()
    if not fin or fin <= inicio:
        fin = inicio + timedelta(hours=1)
    return inicio, fin


def _fmt_fecha(dt) -> str:
    return dt.astimezone().strftime('%d/%m/%Y') if dt else ''


def _fmt_hora(dt) -> str:
    return dt.astimezone().strftime('%H:%M') if dt else ''


def _import_actividad_completada(
    opp, bitrix_id, titulo, desc, autor, fecha_bitrix, dry_run, stdout
):
    """Importa una actividad/tarea completada como solo un mensaje en la conversación."""
    stdout.write(f'  ✓ {bitrix_id}: {titulo[:60]}')

    if dry_run:
        return True

    texto = f'[BITRIX_HIST:{bitrix_id}] ✓ {titulo}'
    if desc:
        texto += f'\n{desc[:300]}'
    msg = MensajeOportunidad.objects.create(
        oportunidad=opp, usuario=autor, texto=texto
    )
    MensajeOportunidad.objects.filter(pk=msg.pk).update(fecha=fecha_bitrix)
    return True


# ──────────────────────────────────────────────
# Command
# ──────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Importa el historial de Bitrix24 en oportunidades activas'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--deal-id', type=int, default=None)
        parser.add_argument('--limit', type=int, default=None)

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        single_deal = options['deal_id']
        limit = options['limit']

        if not BITRIX_WEBHOOK_URL:
            self.stderr.write('❌ BITRIX_WEBHOOK_URL no configurada.')
            return

        user_map = _get_user_map()
        self.stdout.write(f'Usuarios mapeados: {len(user_map)}')
        bitrix_ids_sin_mapear = set()  # para reporte final

        qs = TodoItem.objects.exclude(bitrix_deal_id=None).order_by('id')
        if single_deal:
            qs = qs.filter(bitrix_deal_id=single_deal)
        if limit:
            qs = qs[:limit]

        # Filtrar oportunidades activas en Python (más flexible que ORM para etapas)
        opps = [o for o in qs if not _is_etapa_cerrada(o)]
        total_orig = qs.count()
        total = len(opps)
        self.stdout.write(
            f'Oportunidades: {total_orig} total → {total_orig - total} cerradas ignoradas → {total} a procesar\n'
        )

        cnt_act_new = cnt_act_skip = cnt_act_pend_skip = cnt_act_tipo_skip = 0
        cnt_task_new = cnt_task_skip = cnt_task_pend_skip = 0
        cnt_cmt_new = cnt_cmt_skip = 0

        for i, opp in enumerate(opps, 1):
            deal_id = opp.bitrix_deal_id
            self.stdout.write(f'[{i}/{total}] #{opp.id} Deal#{deal_id} {opp.oportunidad[:55]}')

            # ── ACTIVIDADES CRM (llamadas, reuniones, etc.) ──
            activities = _fetch_activities(deal_id)
            for act in activities:
                tipo_id = str(act.get('TYPE_ID', ''))
                bitrix_act_id = int(act['ID'])
                completada = act.get('COMPLETED') == 'Y'

                # Saltar pendientes — vendrán del calendario
                if not completada:
                    cnt_act_pend_skip += 1
                    continue

                tipo_str = ACTIVITY_TYPES.get(tipo_id, 'Actividad')
                subject = (act.get('SUBJECT') or '').strip() or '(sin título)'

                # Ignorar cotizaciones generadas por el sistema
                if _es_cotizacion_sistema(subject):
                    cnt_act_tipo_skip += 1
                    continue

                # Anti-duplicado
                if MensajeOportunidad.objects.filter(
                    oportunidad_id=opp.id,
                    texto__startswith=f'[BITRIX_HIST:{bitrix_act_id}]'
                ).exists():
                    cnt_act_skip += 1
                    continue

                desc = (act.get('DESCRIPTION') or '').strip()
                responsable_id = str(act.get('RESPONSIBLE_ID', ''))
                autor = user_map.get(responsable_id)
                if not autor and responsable_id:
                    bitrix_ids_sin_mapear.add(responsable_id)
                fecha_bitrix = _parse_date(act.get('CREATED')) or timezone.now()
                titulo = f'[{tipo_str}] {subject}' if tipo_str != 'Actividad' else subject
                _import_actividad_completada(
                    opp, bitrix_act_id, titulo, desc, autor, fecha_bitrix, dry_run, self.stdout
                )
                cnt_act_new += 1

            # ── TAREAS BITRIX (módulo Tasks vinculadas al deal) ──
            btasks = _fetch_tasks(deal_id)
            for task in btasks:
                task_id = int(task.get('id', task.get('ID', 0)))
                if not task_id:
                    continue

                status = str(task.get('status', task.get('STATUS', '')))
                completada = status in TASK_STATUS_COMPLETADA

                # Saltar pendientes — vendrán de la tabla de tareas
                if not completada:
                    cnt_task_pend_skip += 1
                    continue

                # ID único para anti-duplicado (negativo para separar namespace)
                stored_id = BITRIX_TASK_ID_OFFSET - task_id

                # Anti-duplicado
                if MensajeOportunidad.objects.filter(
                    oportunidad_id=opp.id,
                    texto__startswith=f'[BITRIX_HIST:{stored_id}]'
                ).exists():
                    cnt_task_skip += 1
                    continue

                titulo = (task.get('title', task.get('TITLE', '')) or '').strip() or '(sin título)'
                desc = (task.get('description', task.get('DESCRIPTION', '')) or '').strip()
                responsable_id = str(task.get('responsibleId', task.get('RESPONSIBLE_ID', task.get('CREATOR_ID', ''))))
                autor = user_map.get(responsable_id)
                if not autor and responsable_id:
                    bitrix_ids_sin_mapear.add(responsable_id)
                fecha_bitrix = _parse_date(task.get('createdDate', task.get('CREATED_DATE', ''))) or timezone.now()

                _import_actividad_completada(
                    opp, stored_id, titulo, desc, autor, fecha_bitrix, dry_run, self.stdout
                )
                cnt_task_new += 1

            # ── COMENTARIOS TIMELINE ──
            comments = _fetch_timeline_comments(deal_id)
            for cmt in comments:
                cmt_id = cmt.get('ID', cmt.get('id', ''))
                if not cmt_id:
                    continue

                # Anti-duplicado
                if MensajeOportunidad.objects.filter(
                    oportunidad_id=opp.id,
                    texto__startswith=f'[BITRIX_CMT:{cmt_id}]'
                ).exists():
                    cnt_cmt_skip += 1
                    continue

                content = (cmt.get('COMMENT', cmt.get('comment', '')) or '').strip()
                # Ignorar vacíos y adjuntos de Bitrix
                if not content or content.startswith('[DISK FILE'):
                    cnt_cmt_skip += 1
                    continue

                fecha = _parse_date(cmt.get('CREATED', cmt.get('created', ''))) or timezone.now()
                author_id = str(cmt.get('AUTHOR_ID', cmt.get('author_id', '')))
                autor = user_map.get(author_id)

                self.stdout.write(f'  💬 Comentario {cmt_id}: {content[:60]}')

                if not dry_run:
                    msg = MensajeOportunidad.objects.create(
                        oportunidad=opp,
                        usuario=autor,
                        texto=f'[BITRIX_CMT:{cmt_id}] {content}',
                    )
                    MensajeOportunidad.objects.filter(pk=msg.pk).update(fecha=fecha)

                cnt_cmt_new += 1

        self.stdout.write('\n' + '─' * 55)
        self.stdout.write(f'✅ Actividades completadas importadas : {cnt_act_new}')
        self.stdout.write(f'⏭  Actividades pendientes ignoradas  : {cnt_act_pend_skip}')
        self.stdout.write(f'⏭  Actividades duplicadas            : {cnt_act_skip}')
        self.stdout.write(f'⏭  Cotizaciones ignoradas            : {cnt_act_tipo_skip}')
        self.stdout.write(f'✅ Tareas completadas importadas      : {cnt_task_new}')
        self.stdout.write(f'⏭  Tareas pendientes ignoradas       : {cnt_task_pend_skip}')
        self.stdout.write(f'⏭  Tareas duplicadas                 : {cnt_task_skip}')
        self.stdout.write(f'✅ Comentarios importados             : {cnt_cmt_new}')
        self.stdout.write(f'⏭  Comentarios duplicados            : {cnt_cmt_skip}')
        if bitrix_ids_sin_mapear:
            self.stdout.write(self.style.WARNING(
                f'\n⚠ IDs de Bitrix SIN usuario mapeado ({len(bitrix_ids_sin_mapear)}): '
                + ', '.join(sorted(bitrix_ids_sin_mapear))
            ))
            self.stdout.write(
                '  → Las actividades/tareas de estos usuarios se importaron SIN calendario.\n'
                '  → Para corregirlo: Admin → UserProfile → asigna bitrix_user_id a cada usuario.'
            )
        if dry_run:
            self.stdout.write(self.style.WARNING('\nDRY RUN — nada guardado'))

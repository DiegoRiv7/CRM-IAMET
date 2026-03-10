"""
Importa el historial (timeline) de oportunidades ACTIVAS de Bitrix24.

Qué se salta:
  - Oportunidades con etapa cerrada/perdida/pagada/cancelada
  - Actividades de tipo Email (TYPE_ID=6) — son cotizaciones ya en el sistema
  - Comentarios vacíos o de archivos adjuntos Bitrix [DISK FILE...]

Fuentes de datos:
  - crm.activity.list  → llamadas, reuniones, actividades CRM
  - tasks.task.list    → tareas del módulo Tasks vinculadas al deal (UF_CRM_TASK)
  - crm.timeline.comment.list → comentarios del timeline

Comportamiento:
  - Actividades/Tareas ABIERTAS → TareaOportunidad (pendiente) + Actividad calendario
    + mensaje [ACT:ID] (tarjeta azul clickeable en conversación)
  - Actividades/Tareas CERRADAS → TareaOportunidad (completada)
    + mensaje [ACT_COMPLETADA:ID] (historial verde)
  - Comentarios del timeline → MensajeOportunidad normal (texto plano)

Anti-duplicados:
  - Actividades CRM: TareaOportunidad.bitrix_task_id (positivo)
  - Tareas Bitrix:   TareaOportunidad.bitrix_task_id (negativo, para separar namespaces)
  - Comentarios: texto empieza con [BITRIX_CMT:ID]

Uso:
    python manage.py import_bitrix_timeline
    python manage.py import_bitrix_timeline --dry-run
    python manage.py import_bitrix_timeline --deal-id 12345
    python manage.py import_bitrix_timeline --limit 50
"""

from datetime import datetime, timedelta, timezone as dt_timezone

import requests
from django.core.management.base import BaseCommand
from django.utils import timezone

from app.bitrix_integration import BITRIX_WEBHOOK_URL
from app.models import Actividad, MensajeOportunidad, TareaOportunidad, TodoItem


# Etapas que indican oportunidad cerrada — se ignoran
ETAPAS_CERRADAS = {
    'cerrado ganado', 'cerrado perdido', 'perdido', 'pagado',
    'cancelado', 'cancelada', 'ganado', 'perdida',
    'closed won', 'closed lost',
}

# TYPE_ID de actividades CRM que se ignoran (Emails = cotizaciones ya en el sistema)
TIPOS_IGNORADOS = {'6'}

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


def _fetch_tasks(deal_id: int) -> list:
    """Tareas del módulo Tasks vinculadas al deal (tasks.task.list).

    REQUIERE que el webhook de Bitrix tenga el scope 'task' habilitado.
    Si retorna 401, edita el webhook en Bitrix24 → Desarrolladores → Webhooks
    y activa la casilla 'task' (Tareas y Proyectos).
    """
    url = _url("tasks.task.list")
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
            if resp.status_code == 401:
                print("  ⚠ tasks: 401 Unauthorized — el webhook no tiene scope 'task'.")
                print("    → En Bitrix24: Desarrolladores → Webhooks entrantes → edita el webhook")
                print("      y activa la casilla 'task' (Tareas y Proyectos). Luego reintenta.")
                break
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


def _import_actividad_o_tarea(
    opp, bitrix_id, titulo, desc, autor, fecha_bitrix,
    inicio_dt, fin_dt, completada, dry_run, stdout
):
    """Lógica compartida para importar una actividad CRM o una tarea Bitrix."""
    lbl = '✓' if completada else '⏳'
    stdout.write(f'  {lbl} {bitrix_id}: {titulo[:60]}')

    if dry_run:
        return True

    tarea = TareaOportunidad.objects.create(
        oportunidad=opp,
        titulo=titulo,
        descripcion=desc,
        estado='completada' if completada else 'pendiente',
        fecha_limite=fin_dt if not completada else None,
        creado_por=autor,
        responsable=autor,
        bitrix_task_id=bitrix_id,
    )
    TareaOportunidad.objects.filter(pk=tarea.pk).update(fecha_creacion=fecha_bitrix)

    if not completada:
        actividad = Actividad.objects.create(
            titulo=tarea.titulo,
            tipo_actividad='tarea',
            descripcion=desc,
            fecha_inicio=inicio_dt,
            fecha_fin=fin_dt,
            creado_por=autor,
            color='#0052D4',
            oportunidad=opp,
        )
        tarea.actividad_calendario = actividad
        tarea.save(update_fields=['actividad_calendario'])

    if completada:
        chat_texto = f'[ACT_COMPLETADA:{tarea.id}]{tarea.titulo}'
    else:
        chat_texto = (
            f'[ACT:{tarea.id}]{tarea.titulo}'
            f'|{_fmt_fecha(inicio_dt)}|{_fmt_hora(inicio_dt)}'
            f'|{_fmt_hora(fin_dt)}|{desc[:100]}'
        )
    msg = MensajeOportunidad.objects.create(
        oportunidad=opp, usuario=autor, texto=chat_texto
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

        cnt_act_new = cnt_act_skip = cnt_act_tipo_skip = 0
        cnt_task_new = cnt_task_skip = 0
        cnt_cmt_new = cnt_cmt_skip = 0

        for i, opp in enumerate(opps, 1):
            deal_id = opp.bitrix_deal_id
            self.stdout.write(f'[{i}/{total}] #{opp.id} Deal#{deal_id} {opp.oportunidad[:55]}')

            # ── ACTIVIDADES CRM (llamadas, reuniones, etc.) ──
            activities = _fetch_activities(deal_id)
            for act in activities:
                tipo_id = str(act.get('TYPE_ID', ''))

                # Ignorar emails (cotizaciones)
                if tipo_id in TIPOS_IGNORADOS:
                    cnt_act_tipo_skip += 1
                    continue

                bitrix_act_id = int(act['ID'])
                completada = act.get('COMPLETED') == 'Y'
                tipo_str = ACTIVITY_TYPES.get(tipo_id, 'Actividad')
                subject = (act.get('SUBJECT') or '').strip() or '(sin título)'
                desc = (act.get('DESCRIPTION') or '').strip()
                responsable_id = str(act.get('RESPONSIBLE_ID', ''))
                autor = user_map.get(responsable_id)
                fecha_bitrix = _parse_date(act.get('CREATED')) or timezone.now()
                inicio_dt, fin_dt = _dates_for_activity(act)

                # Anti-duplicado (ID positivo para actividades CRM)
                if TareaOportunidad.objects.filter(bitrix_task_id=bitrix_act_id).exists():
                    cnt_act_skip += 1
                    continue

                titulo = f'[{tipo_str}] {subject}' if tipo_str != 'Actividad' else subject
                _import_actividad_o_tarea(
                    opp, bitrix_act_id, titulo, desc, autor, fecha_bitrix,
                    inicio_dt, fin_dt, completada, dry_run, self.stdout
                )
                cnt_act_new += 1

            # ── TAREAS BITRIX (módulo Tasks vinculadas al deal) ──
            btasks = _fetch_tasks(deal_id)
            for task in btasks:
                task_id = int(task.get('id', task.get('ID', 0)))
                if not task_id:
                    continue

                # Usamos ID negativo para separar namespace de actividades CRM
                stored_id = BITRIX_TASK_ID_OFFSET - task_id

                # Anti-duplicado
                if TareaOportunidad.objects.filter(bitrix_task_id=stored_id).exists():
                    cnt_task_skip += 1
                    continue

                status = str(task.get('status', task.get('STATUS', '')))
                completada = status in TASK_STATUS_COMPLETADA
                titulo = (task.get('title', task.get('TITLE', '')) or '').strip() or '(sin título)'
                desc = (task.get('description', task.get('DESCRIPTION', '')) or '').strip()
                responsable_id = str(task.get('responsibleId', task.get('RESPONSIBLE_ID', task.get('CREATOR_ID', ''))))
                autor = user_map.get(responsable_id)
                fecha_bitrix = _parse_date(task.get('createdDate', task.get('CREATED_DATE', ''))) or timezone.now()
                inicio_dt, fin_dt = _dates_for_task(task)

                _import_actividad_o_tarea(
                    opp, stored_id, titulo, desc, autor, fecha_bitrix,
                    inicio_dt, fin_dt, completada, dry_run, self.stdout
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
        self.stdout.write(f'✅ Actividades CRM importadas : {cnt_act_new}')
        self.stdout.write(f'⏭  Actividades duplicadas    : {cnt_act_skip}')
        self.stdout.write(f'⏭  Emails ignorados (cotz.)  : {cnt_act_tipo_skip}')
        self.stdout.write(f'✅ Tareas Bitrix importadas   : {cnt_task_new}')
        self.stdout.write(f'⏭  Tareas duplicadas         : {cnt_task_skip}')
        self.stdout.write(f'✅ Comentarios importados     : {cnt_cmt_new}')
        self.stdout.write(f'⏭  Comentarios duplicados    : {cnt_cmt_skip}')
        if dry_run:
            self.stdout.write(self.style.WARNING('\nDRY RUN — nada guardado'))

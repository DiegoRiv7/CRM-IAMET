"""
Importa el historial (timeline) de cada oportunidad en Bitrix24.

Comportamiento:
  - Actividades ABIERTAS → TareaOportunidad (pendiente) + Actividad en calendario
    + MensajeOportunidad [ACT:ID] (tarjeta azul clickeable)
  - Actividades CERRADAS → TareaOportunidad (completada, sin calendario)
    + MensajeOportunidad [ACT_COMPLETADA:ID] (historial verde)
  - Comentarios del timeline → MensajeOportunidad estilo Bitrix (tarjeta naranja)

Anti-duplicados:
  - Actividades: TareaOportunidad.bitrix_task_id
  - Comentarios: texto empieza con [BITRIX_CMT:ID]

Uso:
    python manage.py import_bitrix_timeline
    python manage.py import_bitrix_timeline --dry-run
    python manage.py import_bitrix_timeline --deal-id 12345
    python manage.py import_bitrix_timeline --limit 50
"""

import time
from datetime import datetime, timedelta, timezone as dt_timezone

import requests
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from app.bitrix_integration import BITRIX_WEBHOOK_URL
from app.models import Actividad, MensajeOportunidad, TareaOportunidad, TodoItem


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
    for profile in UserProfile.objects.select_related('user').exclude(bitrix_user_id=None):
        mapping[str(profile.bitrix_user_id)] = profile.user
    return mapping


def _fetch_activities(deal_id: int) -> list:
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
            print(f"  ⚠ Error activities deal {deal_id}: {e}")
            break
        time.sleep(0.2)
    return activities


def _fetch_timeline_comments(deal_id: int) -> list:
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
            print(f"  ⚠ Error timeline comments deal {deal_id}: {e}")
            break
        time.sleep(0.2)
    return comments


ACTIVITY_TYPES = {
    '1': 'Llamada', '2': 'Reunión', '4': 'Tarea',
    '6': 'Email', '10': 'Actividad',
}


def _dates_for_activity(act: dict):
    """Devuelve (fecha_inicio, fecha_fin) para la actividad."""
    # Intentar START_TIME / END_TIME primero, luego DEADLINE, luego CREATED
    inicio = _parse_date(act.get('START_TIME')) or _parse_date(act.get('DEADLINE')) or _parse_date(act.get('CREATED'))
    fin = _parse_date(act.get('END_TIME')) or _parse_date(act.get('DEADLINE'))
    if not inicio:
        inicio = timezone.now()
    if not fin or fin <= inicio:
        fin = inicio + timedelta(hours=1)
    return inicio, fin


def _format_fecha(dt) -> str:
    if not dt:
        return ''
    local = dt.astimezone()
    return local.strftime('%d/%m/%Y')


def _format_hora(dt) -> str:
    if not dt:
        return ''
    local = dt.astimezone()
    return local.strftime('%H:%M')


def _comment_already_imported(opp_id: int, cmt_id) -> bool:
    return MensajeOportunidad.objects.filter(
        oportunidad_id=opp_id,
        texto__startswith=f'[BITRIX_CMT:{cmt_id}]',
    ).exists()


# ──────────────────────────────────────────────
# Command
# ──────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Importa el historial de Bitrix24 replicando el flujo nativo de actividades'

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

        total = qs.count()
        self.stdout.write(f'Procesando {total} oportunidades...\n')

        cnt_act_new = cnt_act_skip = cnt_cmt_new = cnt_cmt_skip = 0

        for i, opp in enumerate(qs, 1):
            deal_id = opp.bitrix_deal_id
            self.stdout.write(
                f'[{i}/{total}] #{opp.id} Deal#{deal_id} {opp.oportunidad[:55]}'
            )

            # ── ACTIVIDADES ──
            activities = _fetch_activities(deal_id)
            for act in activities:
                bitrix_act_id = int(act['ID'])
                completada = act.get('COMPLETED') == 'Y'
                tipo_str = ACTIVITY_TYPES.get(str(act.get('TYPE_ID', '')), 'Actividad')
                subject = (act.get('SUBJECT') or '').strip() or '(sin título)'
                desc = (act.get('DESCRIPTION') or '').strip()
                responsable_id = str(act.get('RESPONSIBLE_ID', ''))
                autor = user_map.get(responsable_id)
                fecha_creacion_bitrix = _parse_date(act.get('CREATED')) or timezone.now()
                inicio_dt, fin_dt = _dates_for_activity(act)

                # Verificar duplicado por bitrix_task_id
                if TareaOportunidad.objects.filter(bitrix_task_id=bitrix_act_id).exists():
                    cnt_act_skip += 1
                    self.stdout.write(f'  ⏭ Act {bitrix_act_id} ya existe')
                    continue

                estado_label = '✓ Completada' if completada else '⏳ Pendiente'
                self.stdout.write(
                    f'  + Act {bitrix_act_id} [{tipo_str}] {estado_label}: {subject[:55]}'
                )

                if dry_run:
                    cnt_act_new += 1
                    continue

                # 1. Crear TareaOportunidad
                tarea = TareaOportunidad.objects.create(
                    oportunidad=opp,
                    titulo=f'[{tipo_str}] {subject}' if tipo_str != 'Actividad' else subject,
                    descripcion=desc,
                    estado='completada' if completada else 'pendiente',
                    prioridad='normal',
                    fecha_limite=fin_dt if not completada else None,
                    creado_por=autor,
                    responsable=autor,
                    bitrix_task_id=bitrix_act_id,
                )
                # Sobreescribir fecha_creacion con la de Bitrix
                TareaOportunidad.objects.filter(pk=tarea.pk).update(
                    fecha_creacion=fecha_creacion_bitrix
                )

                # 2. Crear Actividad en calendario solo si está abierta
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

                # 3. Crear MensajeOportunidad en la conversación
                if completada:
                    chat_texto = f'[ACT_COMPLETADA:{tarea.id}]{tarea.titulo}'
                else:
                    fecha_fmt = _format_fecha(inicio_dt)
                    hora_ini = _format_hora(inicio_dt)
                    hora_fin = _format_hora(fin_dt)
                    chat_texto = f'[ACT:{tarea.id}]{tarea.titulo}|{fecha_fmt}|{hora_ini}|{hora_fin}|{desc[:100]}'

                msg = MensajeOportunidad.objects.create(
                    oportunidad=opp,
                    usuario=autor,
                    texto=chat_texto,
                )
                MensajeOportunidad.objects.filter(pk=msg.pk).update(fecha=fecha_creacion_bitrix)

                cnt_act_new += 1

            # ── COMENTARIOS DEL TIMELINE ──
            comments = _fetch_timeline_comments(deal_id)
            for cmt in comments:
                cmt_id = cmt.get('ID', cmt.get('id', ''))
                if not cmt_id:
                    continue

                if _comment_already_imported(opp.id, cmt_id):
                    cnt_cmt_skip += 1
                    continue

                content = (cmt.get('COMMENT', cmt.get('comment', '')) or '').strip()
                # Saltar comentarios vacíos o de archivos adjuntos de Bitrix
                if not content or content.startswith('[DISK FILE'):
                    cnt_cmt_skip += 1
                    continue

                fecha_raw = cmt.get('CREATED', cmt.get('created', ''))
                fecha = _parse_date(fecha_raw) or timezone.now()
                author_id = str(cmt.get('AUTHOR_ID', cmt.get('author_id', '')))
                autor = user_map.get(author_id)

                self.stdout.write(f'  + Comentario {cmt_id}: {content[:60]}')

                if not dry_run:
                    msg = MensajeOportunidad.objects.create(
                        oportunidad=opp,
                        usuario=autor,
                        texto=f'[BITRIX_CMT:{cmt_id}] {content}',
                    )
                    MensajeOportunidad.objects.filter(pk=msg.pk).update(fecha=fecha)

                cnt_cmt_new += 1

            time.sleep(0.3)

        self.stdout.write('\n' + '─' * 55)
        self.stdout.write(f'✅ Actividades importadas  : {cnt_act_new}')
        self.stdout.write(f'⏭  Actividades ya existían : {cnt_act_skip}')
        self.stdout.write(f'✅ Comentarios importados  : {cnt_cmt_new}')
        self.stdout.write(f'⏭  Comentarios ya existían : {cnt_cmt_skip}')
        if dry_run:
            self.stdout.write(self.style.WARNING('\nDRY RUN — nada guardado'))

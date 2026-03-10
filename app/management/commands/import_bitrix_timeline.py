"""
Importa el historial (timeline) de cada oportunidad en Bitrix24
y lo mete en MensajeOportunidad para que aparezca en la Conversación.

Qué importa:
  1. crm.activity.list  → actividades (tareas internas, llamadas, reuniones)
  2. crm.timeline.comment.list → comentarios del timeline

Cada entrada se guarda como mensaje con prefijo [BITRIX] para identificarlo.
No duplica: busca mensajes con el mismo bitrix_activity_id (almacenado como
prefijo en el texto) antes de insertar.

Uso:
    python manage.py import_bitrix_timeline
    python manage.py import_bitrix_timeline --dry-run
    python manage.py import_bitrix_timeline --deal-id 12345   # solo 1 deal
    python manage.py import_bitrix_timeline --limit 50        # max N oportunidades
"""

import time
from datetime import datetime, timezone as dt_timezone

import requests
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from app.bitrix_integration import BITRIX_WEBHOOK_URL
from app.models import MensajeOportunidad, TodoItem


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _url(method: str) -> str:
    """Construye la URL de la API cambiando el método en el webhook."""
    return BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", f"{method}.json")


def _parse_date(raw):
    """Parsea fecha Bitrix a datetime aware."""
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
    """Mapa bitrix_user_id → Django User para asignar autor."""
    from app.models import UserProfile
    mapping = {}
    for profile in UserProfile.objects.select_related('user').exclude(bitrix_user_id=None):
        mapping[str(profile.bitrix_user_id)] = profile.user
    return mapping


def _fetch_activities(deal_id: int) -> list:
    """Trae actividades de un deal desde crm.activity.list."""
    url = _url("crm.activity.list")
    activities = []
    start = 0

    while True:
        try:
            resp = requests.post(url, json={
                'filter': {
                    'OWNER_TYPE_ID': 2,   # 2 = Deal/Oportunidad
                    'OWNER_ID': deal_id,
                },
                'select': ['ID', 'SUBJECT', 'DESCRIPTION', 'RESPONSIBLE_ID',
                           'CREATED', 'DEADLINE', 'TYPE_ID', 'COMPLETED'],
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
    """Trae comentarios del timeline desde crm.timeline.comment.list."""
    url = _url("crm.timeline.comment.list")
    comments = []
    start = 0

    while True:
        try:
            resp = requests.post(url, json={
                'filter': {
                    'ENTITY_TYPE': 'deal',
                    'ENTITY_ID': deal_id,
                },
                'start': start,
            }, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            # Puede devolver lista directa o dentro de 'result'
            items = data.get('result', data) if isinstance(data.get('result'), list) else []
            if not items and isinstance(data, list):
                items = data
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
    '1': 'Llamada',
    '2': 'Reunión',
    '4': 'Tarea',
    '6': 'Email',
    '10': 'Actividad',
}


def _activity_to_texto(act: dict) -> str:
    """Formatea una actividad Bitrix como texto para MensajeOportunidad."""
    tipo = ACTIVITY_TYPES.get(str(act.get('TYPE_ID', '')), 'Actividad')
    subject = act.get('SUBJECT', '').strip()
    desc = act.get('DESCRIPTION', '').strip()
    deadline = act.get('DEADLINE', '')
    completada = act.get('COMPLETED') == 'Y'

    lines = [f"[BITRIX_ACT:{act['ID']}] {tipo}: {subject}"]
    if desc:
        lines.append(desc)
    if deadline:
        dt = _parse_date(deadline)
        if dt:
            lines.append(f"Fecha límite: {dt.strftime('%d/%m/%Y %H:%M')}")
    if completada:
        lines.append("✓ Completada")
    return '\n'.join(lines)


def _comment_to_texto(comment: dict) -> str:
    """Formatea un comentario del timeline como texto."""
    comment_id = comment.get('ID', comment.get('id', ''))
    content = comment.get('COMMENT', comment.get('comment', '')).strip()
    return f"[BITRIX_CMT:{comment_id}] {content}"


def _already_imported(oportunidad_id: int, bitrix_ref: str) -> bool:
    """Verifica si ya existe un mensaje con esa referencia Bitrix."""
    return MensajeOportunidad.objects.filter(
        oportunidad_id=oportunidad_id,
        texto__startswith=bitrix_ref,
    ).exists()


# ──────────────────────────────────────────────
# Command
# ──────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Importa el historial de Bitrix24 a la Conversación de cada oportunidad'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Muestra qué se importaría sin guardar nada')
        parser.add_argument('--deal-id', type=int, default=None,
                            help='Procesar solo este deal ID de Bitrix')
        parser.add_argument('--limit', type=int, default=None,
                            help='Máximo de oportunidades a procesar')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        single_deal = options['deal_id']
        limit = options['limit']

        if not BITRIX_WEBHOOK_URL:
            self.stderr.write('❌ BITRIX_WEBHOOK_URL no configurada.')
            return

        user_map = _get_user_map()
        self.stdout.write(f'Mapa de usuarios: {len(user_map)} encontrados')

        # Obtener oportunidades con bitrix_deal_id
        qs = TodoItem.objects.exclude(bitrix_deal_id=None).order_by('id')
        if single_deal:
            qs = qs.filter(bitrix_deal_id=single_deal)
        if limit:
            qs = qs[:limit]

        total = qs.count()
        self.stdout.write(f'Procesando {total} oportunidades...\n')

        total_acts = 0
        total_cmts = 0
        total_skip = 0

        for i, opp in enumerate(qs, 1):
            deal_id = opp.bitrix_deal_id
            self.stdout.write(f'[{i}/{total}] Opp #{opp.id} | Deal Bitrix #{deal_id} | {opp.oportunidad[:50]}')

            # ── Actividades ──
            activities = _fetch_activities(deal_id)
            for act in activities:
                ref = f"[BITRIX_ACT:{act['ID']}]"
                if _already_imported(opp.id, ref):
                    total_skip += 1
                    continue

                fecha = _parse_date(act.get('CREATED')) or timezone.now()
                texto = _activity_to_texto(act)
                responsable_id = str(act.get('RESPONSIBLE_ID', ''))
                autor = user_map.get(responsable_id)

                if not dry_run:
                    msg = MensajeOportunidad.objects.create(
                        oportunidad=opp,
                        usuario=autor,
                        texto=texto,
                    )
                    # Sobreescribir fecha con la de Bitrix
                    MensajeOportunidad.objects.filter(pk=msg.pk).update(fecha=fecha)

                total_acts += 1
                self.stdout.write(f'  + Actividad {act["ID"]}: {act.get("SUBJECT", "")[:60]}')

            # ── Comentarios del timeline ──
            comments = _fetch_timeline_comments(deal_id)
            for cmt in comments:
                cmt_id = cmt.get('ID', cmt.get('id', ''))
                if not cmt_id:
                    continue
                ref = f"[BITRIX_CMT:{cmt_id}]"
                if _already_imported(opp.id, ref):
                    total_skip += 1
                    continue

                fecha_raw = cmt.get('CREATED', cmt.get('created', ''))
                fecha = _parse_date(fecha_raw) or timezone.now()
                texto = _comment_to_texto(cmt)
                author_id = str(cmt.get('AUTHOR_ID', cmt.get('author_id', '')))
                autor = user_map.get(author_id)

                if not dry_run:
                    msg = MensajeOportunidad.objects.create(
                        oportunidad=opp,
                        usuario=autor,
                        texto=texto,
                    )
                    MensajeOportunidad.objects.filter(pk=msg.pk).update(fecha=fecha)

                total_cmts += 1
                self.stdout.write(f'  + Comentario {cmt_id}: {texto[:60]}')

            time.sleep(0.3)  # cortesía al API de Bitrix

        self.stdout.write('\n' + '─' * 50)
        self.stdout.write(f'✅ Actividades importadas : {total_acts}')
        self.stdout.write(f'✅ Comentarios importados : {total_cmts}')
        self.stdout.write(f'⏭  Ya existían (skip)     : {total_skip}')
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — nada guardado'))

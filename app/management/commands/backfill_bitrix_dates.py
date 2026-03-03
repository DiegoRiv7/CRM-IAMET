"""
Backfill correct Bitrix dates into existing TodoItem opportunities.

Problems fixed:
  1. fecha_creacion was set to import date (March 2026) because of auto_now_add.
     Now updated from Bitrix DATE_CREATE using QuerySet.update() to bypass auto_now_add.
  2. mes_cierre was stored as "Enero" (display name) instead of "01" (model key).
     Now corrected to numeric two-digit format.

Usage:
    python manage.py backfill_bitrix_dates
    python manage.py backfill_bitrix_dates --dry-run   # show what would change
"""

from django.core.management.base import BaseCommand
from django.utils import timezone
from app.models import TodoItem
from app.bitrix_integration import BITRIX_WEBHOOK_URL
import requests
from datetime import datetime, timezone as dt_timezone


MES_NAME_TO_CODE = {
    "enero": "01", "febrero": "02", "marzo": "03", "abril": "04",
    "mayo": "05", "junio": "06", "julio": "07", "agosto": "08",
    "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12",
}


def _parse_bitrix_date(raw):
    """Parse a Bitrix date string and return a timezone-aware datetime."""
    if not raw:
        return None
    try:
        # Bitrix returns e.g. "2023-05-15T10:00:00+00:00" or "2023-05-15T10:00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=dt_timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def _fetch_deals_with_dates():
    """Fetch all Bitrix deals with DATE_CREATE and CLOSEDATE."""
    if not BITRIX_WEBHOOK_URL:
        return []

    list_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.list.json")
    deals = []
    start = 0

    while True:
        try:
            response = requests.post(list_url, json={
                'select': [
                    'ID', 'DATE_CREATE', 'CLOSEDATE',
                    'UF_CRM_1752859877756',  # Mes de Cobro (custom field)
                ],
                'start': start,
            }, timeout=30)
            response.raise_for_status()
            result = response.json()
            deals.extend(result.get('result', []))

            if 'next' in result:
                start = result['next']
            else:
                break
        except requests.exceptions.RequestException as e:
            print(f"Error al obtener deals de Bitrix24: {e}")
            break

    return deals


# Mapping from custom field Bitrix ID -> month code
MES_COBRO_BITRIX_ID_TO_CODE = {
    "196": "01", "198": "02", "200": "03", "202": "04",
    "204": "05", "206": "06", "208": "07", "210": "08",
    "212": "09", "214": "10", "216": "11", "218": "12",
}


class Command(BaseCommand):
    help = 'Backfills correct Bitrix creation dates and fixes mes_cierre format in opportunities.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be updated without making changes.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no changes will be saved.\n'))

        # ── Step 1: Fix mes_cierre format (no API needed) ────────────────────
        self.stdout.write('Paso 1: Corrigiendo formato de mes_cierre ("Enero" → "01")...')
        mes_fixed = 0
        for item in TodoItem.objects.all():
            mes_lower = (item.mes_cierre or '').strip().lower()
            code = MES_NAME_TO_CODE.get(mes_lower)
            if code and item.mes_cierre != code:
                if not dry_run:
                    TodoItem.objects.filter(pk=item.pk).update(mes_cierre=code)
                self.stdout.write(
                    f'  #{item.pk} "{item.oportunidad[:50]}" '
                    f'mes_cierre: "{item.mes_cierre}" → "{code}"'
                )
                mes_fixed += 1

        self.stdout.write(self.style.SUCCESS(
            f'  mes_cierre corregido en {mes_fixed} oportunidades.\n'
        ))

        # ── Step 2: Fetch dates from Bitrix ──────────────────────────────────
        self.stdout.write('Paso 2: Obteniendo fechas de Bitrix24...')
        if not BITRIX_WEBHOOK_URL:
            self.stdout.write(self.style.ERROR(
                'BITRIX_WEBHOOK_URL no configurada. No se puede continuar con fecha_creacion.'
            ))
            return

        deals = _fetch_deals_with_dates()
        if not deals:
            self.stdout.write(self.style.WARNING('No se obtuvieron deals de Bitrix24.'))
            return

        self.stdout.write(f'  Deals obtenidos de Bitrix: {len(deals)}\n')

        # ── Step 3: Update fecha_creacion from DATE_CREATE ───────────────────
        self.stdout.write('Paso 3: Actualizando fecha_creacion y mes_cierre desde Bitrix...')
        updated = 0
        skipped_no_match = 0
        skipped_no_date = 0

        for deal in deals:
            bitrix_id = deal.get('ID')
            if not bitrix_id:
                continue

            date_create_raw = deal.get('DATE_CREATE')
            closedate_raw = deal.get('CLOSEDATE')
            mes_cobro_id = str(deal.get('UF_CRM_1752859877756') or '')

            fecha_creacion = _parse_bitrix_date(date_create_raw)
            fecha_cierre = _parse_bitrix_date(closedate_raw)

            if not fecha_creacion and not fecha_cierre:
                skipped_no_date += 1
                continue

            try:
                item = TodoItem.objects.get(bitrix_deal_id=bitrix_id)
            except TodoItem.DoesNotExist:
                skipped_no_match += 1
                continue

            update_fields = {}

            # fecha_creacion from DATE_CREATE
            if fecha_creacion:
                update_fields['fecha_creacion'] = fecha_creacion

            # mes_cierre from custom field (preferred) or from CLOSEDATE month
            mes_code = MES_COBRO_BITRIX_ID_TO_CODE.get(mes_cobro_id)
            if mes_code:
                update_fields['mes_cierre'] = mes_code
            elif fecha_cierre:
                update_fields['mes_cierre'] = str(fecha_cierre.month).zfill(2)

            if not update_fields:
                continue

            if dry_run:
                fc_str = fecha_creacion.strftime('%Y-%m-%d') if fecha_creacion else '—'
                mc_str = update_fields.get('mes_cierre', item.mes_cierre)
                self.stdout.write(
                    f'  [DRY] #{item.pk} "{item.oportunidad[:50]}" '
                    f'fecha_creacion → {fc_str}  mes_cierre → {mc_str}'
                )
            else:
                # Use update() to bypass auto_now_add and auto_now on fecha_actualizacion
                TodoItem.objects.filter(pk=item.pk).update(**update_fields)

            updated += 1

        self.stdout.write(self.style.SUCCESS(
            f'\nResumen:'
            f'\n  Actualizados:          {updated}'
            f'\n  Sin match local:       {skipped_no_match}'
            f'\n  Sin fecha en Bitrix:   {skipped_no_date}'
        ))
        if dry_run:
            self.stdout.write(self.style.WARNING('\nDRY RUN completado — ningún cambio fue guardado.'))
        else:
            self.stdout.write(self.style.SUCCESS('\nBackfill completado exitosamente.'))

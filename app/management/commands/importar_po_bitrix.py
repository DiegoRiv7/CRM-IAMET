"""
Comando de una sola vez: importa PO y Factura desde Bitrix a TodoItem.

Uso:
    python manage.py importar_po_bitrix
    python manage.py importar_po_bitrix --dry-run        (solo muestra, no guarda)
    python manage.py importar_po_bitrix --limit 5        (solo los primeros 5)
    python manage.py importar_po_bitrix --dry-run --limit 5
"""
import time
import requests
from django.core.management.base import BaseCommand
from app.models import TodoItem
from app.bitrix_integration import BITRIX_WEBHOOK_URL

BITRIX_PO_FIELD = 'UF_CRM_1753472612145'
BITRIX_FACTURA_FIELD = 'UF_CRM_1753897001662'


class Command(BaseCommand):
    help = 'Importa PO y Factura desde Bitrix al campo po_number / factura_numero de cada oportunidad (ejecución única)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Muestra qué se haría sin guardar nada',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Limita el número de oportunidades a procesar (0 = todas)',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        limit = options['limit']

        if dry_run:
            self.stdout.write(self.style.WARNING('=== DRY RUN — no se guardará nada ==='))

        if not BITRIX_WEBHOOK_URL:
            self.stderr.write(self.style.ERROR('BITRIX_WEBHOOK_URL no configurada'))
            return

        get_url = BITRIX_WEBHOOK_URL.replace('crm.deal.add.json', 'crm.deal.get.json')

        qs = TodoItem.objects.filter(
            bitrix_deal_id__isnull=False
        ).exclude(
            bitrix_deal_id=0
        ).only('id', 'oportunidad', 'bitrix_deal_id', 'po_number', 'factura_numero')

        if limit:
            qs = qs[:limit]

        total = qs.count()
        self.stdout.write(f'Oportunidades con bitrix_deal_id: {total}{f" (límite: {limit})" if limit else ""}')

        po_actualizadas = 0
        factura_actualizadas = 0
        sin_datos = 0
        errores = 0

        for todo in qs:
            try:
                response = requests.post(
                    get_url,
                    json={'id': todo.bitrix_deal_id, 'select': ['ID', BITRIX_PO_FIELD, BITRIX_FACTURA_FIELD]},
                    timeout=10,
                )
                response.raise_for_status()
                deal = response.json().get('result') or {}

                po = (deal.get(BITRIX_PO_FIELD) or '').strip()

                # Factura viene como double (ej. 836.0) — convertir a entero si es número entero
                factura_raw = deal.get(BITRIX_FACTURA_FIELD)
                if factura_raw is not None and factura_raw != '':
                    try:
                        f = float(factura_raw)
                        factura = str(int(f)) if f == int(f) else str(f)
                    except (ValueError, TypeError):
                        factura = str(factura_raw).strip()
                else:
                    factura = ''

                tiene_algo = bool(po or factura)

                if tiene_algo:
                    partes = []
                    if po:
                        partes.append(f'PO: {po}')
                    if factura:
                        partes.append(f'Factura: {factura}')
                    self.stdout.write(
                        self.style.SUCCESS(f'  [#{todo.id}] {todo.oportunidad[:35]!r} — {" | ".join(partes)}')
                    )
                    if not dry_run:
                        update = {}
                        if po:
                            update['po_number'] = po
                            po_actualizadas += 1
                        if factura:
                            update['factura_numero'] = factura
                            factura_actualizadas += 1
                        if update:
                            TodoItem.objects.filter(pk=todo.pk).update(**update)
                    else:
                        if po:
                            po_actualizadas += 1
                        if factura:
                            factura_actualizadas += 1
                else:
                    self.stdout.write(f'  [#{todo.id}] {todo.oportunidad[:35]!r} — sin datos')
                    sin_datos += 1

            except requests.exceptions.RequestException as e:
                self.stderr.write(f'  [#{todo.id}] Error Bitrix deal {todo.bitrix_deal_id}: {e}')
                errores += 1

            time.sleep(0.2)

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            f'Listo: {po_actualizadas} POs, {factura_actualizadas} facturas, {sin_datos} sin datos, {errores} errores'
        ))
        if dry_run:
            self.stdout.write(self.style.WARNING('(dry-run: nada fue guardado)'))

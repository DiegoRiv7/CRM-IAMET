"""
Comando de una sola vez: importa el campo PO desde Bitrix a TodoItem.po_number.

Uso:
    python manage.py importar_po_bitrix
    python manage.py importar_po_bitrix --dry-run   (solo muestra, no guarda)
"""
import time
import requests
from django.core.management.base import BaseCommand
from django.conf import settings
from app.models import TodoItem
from app.bitrix_integration import BITRIX_WEBHOOK_URL

BITRIX_PO_FIELD = 'UF_CRM_1753472612145'


class Command(BaseCommand):
    help = 'Importa el número PO desde Bitrix al campo po_number de cada oportunidad (ejecución única)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Muestra qué se haría sin guardar nada',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
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
        ).only('id', 'oportunidad', 'bitrix_deal_id', 'po_number')

        total = qs.count()
        self.stdout.write(f'Oportunidades con bitrix_deal_id: {total}')

        actualizadas = 0
        sin_po = 0
        errores = 0

        for todo in qs:
            try:
                response = requests.post(
                    get_url,
                    json={'id': todo.bitrix_deal_id, 'select': ['ID', BITRIX_PO_FIELD]},
                    timeout=10,
                )
                response.raise_for_status()
                deal = response.json().get('result') or {}
                po = (deal.get(BITRIX_PO_FIELD) or '').strip()

                if po:
                    self.stdout.write(
                        f'  [#{todo.id}] {todo.oportunidad[:40]!r} — PO: {po}'
                    )
                    if not dry_run:
                        TodoItem.objects.filter(pk=todo.pk).update(po_number=po)
                    actualizadas += 1
                else:
                    sin_po += 1

            except requests.exceptions.RequestException as e:
                self.stderr.write(f'  [#{todo.id}] Error Bitrix deal {todo.bitrix_deal_id}: {e}')
                errores += 1

            # Pausa pequeña para no saturar la API de Bitrix
            time.sleep(0.2)

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            f'Listo: {actualizadas} actualizadas, {sin_po} sin PO, {errores} errores'
        ))
        if dry_run:
            self.stdout.write(self.style.WARNING('(dry-run: nada fue guardado)'))

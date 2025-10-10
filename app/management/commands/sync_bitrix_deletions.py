from django.core.management.base import BaseCommand
from app.models import TodoItem
from app.bitrix_integration import get_all_bitrix_deals
import requests
import os

class Command(BaseCommand):
    help = 'Sincroniza eliminaciones de Bitrix24 - elimina oportunidades locales que ya no existen en Bitrix24'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Solo muestra qué se eliminaría sin hacer cambios reales',
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Iniciando sincronización de eliminaciones con Bitrix24...'))
        
        dry_run = options['dry_run']
        if dry_run:
            self.stdout.write(self.style.WARNING('MODO DRY-RUN: No se harán cambios reales'))
        
        # Obtener todas las oportunidades locales que tienen bitrix_deal_id
        local_opportunities = TodoItem.objects.filter(bitrix_deal_id__isnull=False)
        self.stdout.write(f'Oportunidades locales con Bitrix ID: {local_opportunities.count()}')
        
        # Obtener todos los deals de Bitrix24
        bitrix_deals = get_all_bitrix_deals()
        if not bitrix_deals:
            self.stdout.write(self.style.ERROR('No se pudieron obtener deals de Bitrix24'))
            return
        
        # Crear set de IDs que existen en Bitrix24
        bitrix_deal_ids = {str(deal['ID']) for deal in bitrix_deals}
        self.stdout.write(f'Deals activos en Bitrix24: {len(bitrix_deal_ids)}')
        
        # Encontrar oportunidades locales que ya no existen en Bitrix24
        opportunities_to_delete = []
        for opportunity in local_opportunities:
            if str(opportunity.bitrix_deal_id) not in bitrix_deal_ids:
                opportunities_to_delete.append(opportunity)
        
        if not opportunities_to_delete:
            self.stdout.write(self.style.SUCCESS('No hay oportunidades para eliminar. Todo está sincronizado.'))
            return
        
        self.stdout.write(f'Oportunidades para eliminar: {len(opportunities_to_delete)}')
        
        # Mostrar qué se va a eliminar
        for opportunity in opportunities_to_delete:
            self.stdout.write(
                f'  - {opportunity.oportunidad} (ID local: {opportunity.id}, Bitrix ID: {opportunity.bitrix_deal_id})'
            )
        
        if dry_run:
            self.stdout.write(self.style.WARNING('Modo dry-run activo. No se eliminó nada.'))
            return
        
        # Confirmar antes de eliminar
        if not options.get('verbosity', 1) == 0:  # Si no es modo silencioso
            confirm = input(f'¿Estás seguro de eliminar {len(opportunities_to_delete)} oportunidades? (yes/no): ')
            if confirm.lower() != 'yes':
                self.stdout.write(self.style.WARNING('Operación cancelada.'))
                return
        
        # Eliminar las oportunidades
        deleted_count = 0
        for opportunity in opportunities_to_delete:
            try:
                opportunity_name = opportunity.oportunidad
                opportunity_id = opportunity.id
                opportunity.delete()
                deleted_count += 1
                self.stdout.write(
                    self.style.SUCCESS(f'✓ Eliminada: {opportunity_name} (ID: {opportunity_id})')
                )
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f'✗ Error eliminando {opportunity.oportunidad}: {e}')
                )
        
        self.stdout.write(
            self.style.SUCCESS(f'Sincronización completada. {deleted_count} oportunidades eliminadas.')
        )
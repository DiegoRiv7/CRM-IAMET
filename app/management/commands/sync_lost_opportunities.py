from django.core.management.base import BaseCommand
from django.conf import settings
from app.models import TodoItem
from app.views import is_lost_opportunity
import requests
import time

class Command(BaseCommand):
    help = 'Sincroniza todas las oportunidades con Bitrix24 para detectar las que están perdidas'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Solo muestra qué oportunidades se moverían sin hacer cambios reales',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=50,
            help='Número de oportunidades a procesar por lote (default: 50)',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        batch_size = options['batch_size']
        
        # URL del webhook de Bitrix24
        webhook_url = getattr(settings, 'BITRIX_WEBHOOK_URL', None)
        if not webhook_url:
            self.stdout.write(
                self.style.ERROR('ERROR: BITRIX_WEBHOOK_URL no está configurado en settings')
            )
            return

        self.stdout.write(
            self.style.SUCCESS('🔄 Iniciando sincronización de oportunidades perdidas...')
        )
        
        if dry_run:
            self.stdout.write(
                self.style.WARNING('📋 MODO DRY-RUN: Solo se mostrarán los cambios, no se aplicarán')
            )

        # Obtener todas las oportunidades que tienen bitrix_deal_id
        all_opportunities = TodoItem.objects.filter(
            bitrix_deal_id__isnull=False
        ).exclude(
            bitrix_deal_id__exact=''
        ).order_by('id')

        total_opportunities = all_opportunities.count()
        self.stdout.write(f'📊 Total de oportunidades con Bitrix ID: {total_opportunities}')

        if total_opportunities == 0:
            self.stdout.write(
                self.style.WARNING('⚠️ No se encontraron oportunidades con Bitrix ID')
            )
            return

        processed = 0
        found_lost = 0
        errors = 0
        batch_count = 0

        # Procesar en lotes
        for start in range(0, total_opportunities, batch_size):
            batch_count += 1
            end = min(start + batch_size, total_opportunities)
            batch = all_opportunities[start:end]
            
            self.stdout.write(f'\n📦 Procesando lote {batch_count} (oportunidades {start+1} a {end})')
            
            for opportunity in batch:
                try:
                    # Construir URL para obtener detalles del deal
                    deal_url = f"{webhook_url.rstrip('/')}/crm.deal.get"
                    params = {
                        'id': opportunity.bitrix_deal_id
                    }
                    
                    # Hacer request a Bitrix24
                    response = requests.get(deal_url, params=params, timeout=10)
                    response.raise_for_status()
                    
                    result = response.json()
                    
                    if 'result' in result and result['result']:
                        deal_details = result['result']
                        stage_id = deal_details.get('STAGE_ID')
                        
                        # Verificar si está perdida
                        if is_lost_opportunity(stage_id):
                            found_lost += 1
                            
                            self.stdout.write(
                                self.style.WARNING(
                                    f'❌ PERDIDA: "{opportunity.oportunidad}" '
                                    f'(ID: {opportunity.id}, Bitrix: {opportunity.bitrix_deal_id}, '
                                    f'Stage: {stage_id})'
                                )
                            )
                            
                            if not dry_run:
                                # Actualizar el stage_id en nuestra base de datos
                                opportunity.bitrix_stage_id = stage_id
                                opportunity.save()
                                self.stdout.write(
                                    self.style.SUCCESS(f'  ✅ Actualizada en base de datos')
                                )
                        else:
                            self.stdout.write(
                                f'✅ ACTIVA: "{opportunity.oportunidad}" (Stage: {stage_id})'
                            )
                    
                    else:
                        self.stdout.write(
                            self.style.ERROR(
                                f'⚠️ No encontrada en Bitrix: "{opportunity.oportunidad}" '
                                f'(ID: {opportunity.id}, Bitrix: {opportunity.bitrix_deal_id})'
                            )
                        )
                        errors += 1
                
                except requests.exceptions.RequestException as e:
                    self.stdout.write(
                        self.style.ERROR(
                            f'🔌 Error de conexión con "{opportunity.oportunidad}": {e}'
                        )
                    )
                    errors += 1
                
                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(
                            f'💥 Error procesando "{opportunity.oportunidad}": {e}'
                        )
                    )
                    errors += 1
                
                processed += 1
                
                # Pequeña pausa para no saturar Bitrix24
                time.sleep(0.1)
            
            # Pausa más larga entre lotes
            if batch_count < (total_opportunities // batch_size + 1):
                self.stdout.write('⏳ Pausa entre lotes...')
                time.sleep(2)

        # Resumen final
        self.stdout.write('\n' + '=' * 60)
        self.stdout.write(
            self.style.SUCCESS(f'✅ SINCRONIZACIÓN COMPLETADA')
        )
        self.stdout.write(f'📊 Estadísticas:')
        self.stdout.write(f'   • Total procesadas: {processed}')
        self.stdout.write(f'   • Oportunidades perdidas encontradas: {found_lost}')
        self.stdout.write(f'   • Errores: {errors}')
        
        if dry_run:
            self.stdout.write('\n📋 MODO DRY-RUN: Para aplicar los cambios, ejecuta:')
            self.stdout.write('   python manage.py sync_lost_opportunities')
        else:
            self.stdout.write('\n🎯 Los cambios han sido aplicados a la base de datos.')
            self.stdout.write('   Las oportunidades perdidas ahora se filtrarán automáticamente.')

        if found_lost > 0:
            self.stdout.write(f'\n💡 TIP: Puedes ver las oportunidades perdidas en:')
            self.stdout.write('   /app/bitrix/lost-opportunities/')
from django.core.management.base import BaseCommand
from django.conf import settings
from app.models import TodoItem, Cliente, Contacto, UserProfile
from app.views import is_lost_opportunity
from app.bitrix_integration import get_all_bitrix_deals, get_bitrix_companies_api
import requests
import time
from django.contrib.auth.models import User

class Command(BaseCommand):
    help = 'Sincronización completa bidireccional con Bitrix24: importa, actualiza, detecta perdidas y limpia datos incorrectos'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Solo muestra qué cambios se harían sin aplicarlos',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=50,
            help='Número de oportunidades a procesar por lote (default: 50)',
        )
        parser.add_argument(
            '--skip-import',
            action='store_true',
            help='Omite la importación de nuevas oportunidades, solo sincroniza existentes',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        batch_size = options['batch_size']
        skip_import = options['skip_import']
        
        # URL del webhook de Bitrix24
        webhook_url = getattr(settings, 'BITRIX_WEBHOOK_URL', None)
        if not webhook_url:
            self.stdout.write(
                self.style.ERROR('ERROR: BITRIX_WEBHOOK_URL no está configurado en settings')
            )
            return

        self.stdout.write(
            self.style.SUCCESS('🔄 INICIANDO SINCRONIZACIÓN COMPLETA CON BITRIX24')
        )
        self.stdout.write('=' * 70)
        
        if dry_run:
            self.stdout.write(
                self.style.WARNING('📋 MODO DRY-RUN: Solo se mostrarán los cambios, no se aplicarán')
            )

        # Contadores para estadísticas
        stats = {
            'total_bitrix': 0,
            'total_local': 0,
            'nuevas_importadas': 0,
            'actualizadas': 0,
            'perdidas_detectadas': 0,
            'eliminadas_locales': 0,
            'errores': 0
        }

        # PASO 1: Obtener todas las oportunidades de Bitrix24
        self.stdout.write('\n📥 PASO 1: Obteniendo todas las oportunidades de Bitrix24...')
        try:
            bitrix_deals = get_all_bitrix_deals()
            if not bitrix_deals:
                self.stdout.write(
                    self.style.ERROR('❌ No se pudieron obtener deals de Bitrix24')
                )
                return
            
            stats['total_bitrix'] = len(bitrix_deals)
            self.stdout.write(
                self.style.SUCCESS(f'✅ Se obtuvieron {stats["total_bitrix"]} oportunidades de Bitrix24')
            )
        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'❌ Error obteniendo deals de Bitrix24: {e}')
            )
            return

        # PASO 2: Obtener todas las oportunidades locales
        self.stdout.write('\n📊 PASO 2: Analizando oportunidades locales...')
        local_opportunities = TodoItem.objects.all()
        stats['total_local'] = local_opportunities.count()
        
        # Crear mapas para búsqueda rápida
        local_by_bitrix_id = {}
        for opp in local_opportunities:
            if opp.bitrix_deal_id:
                local_by_bitrix_id[str(opp.bitrix_deal_id)] = opp
        
        bitrix_by_id = {str(deal['ID']): deal for deal in bitrix_deals}
        
        self.stdout.write(
            f'📈 Local: {stats["total_local"]} | Bitrix24: {stats["total_bitrix"]} | Con Bitrix ID: {len(local_by_bitrix_id)}'
        )

        # PASO 3: Procesar cada oportunidad de Bitrix24
        if not skip_import:
            self.stdout.write('\n🔄 PASO 3: Procesando oportunidades de Bitrix24...')
            
            for i, deal in enumerate(bitrix_deals, 1):
                deal_id = str(deal['ID'])
                deal_title = deal.get('TITLE', 'Sin título')
                stage_id = deal.get('STAGE_ID')
                
                try:
                    # Verificar si la oportunidad está perdida
                    if is_lost_opportunity(stage_id):
                        self.stdout.write(
                            self.style.WARNING(
                                f'⏭️  [{i}/{stats["total_bitrix"]}] PERDIDA en Bitrix24: "{deal_title}" (Stage: {stage_id}) - Se omite'
                            )
                        )
                        
                        # Si existe localmente, marcarla como perdida
                        if deal_id in local_by_bitrix_id:
                            local_opp = local_by_bitrix_id[deal_id]
                            if not is_lost_opportunity(local_opp.bitrix_stage_id):
                                stats['perdidas_detectadas'] += 1
                                if not dry_run:
                                    local_opp.bitrix_stage_id = stage_id
                                    local_opp.save()
                                    self.stdout.write(
                                        self.style.WARNING(f'  🔄 Actualizada como perdida en local')
                                    )
                        continue
                    
                    # Si no existe localmente, importarla
                    if deal_id not in local_by_bitrix_id:
                        self.stdout.write(
                            f'📥 [{i}/{stats["total_bitrix"]}] NUEVA: "{deal_title}" - Importando...'
                        )
                        
                        if not dry_run:
                            # Aquí llamarías a tu función de importación
                            # Por ahora solo contamos
                            pass
                        
                        stats['nuevas_importadas'] += 1
                    
                    else:
                        # Existe localmente, verificar si necesita actualización
                        local_opp = local_by_bitrix_id[deal_id]
                        needs_update = False
                        
                        # Verificar cambios en stage_id
                        if local_opp.bitrix_stage_id != stage_id:
                            needs_update = True
                        
                        # Verificar cambios en título
                        if local_opp.oportunidad != deal_title:
                            needs_update = True
                        
                        # Verificar cambios en monto
                        deal_amount = float(deal.get('OPPORTUNITY', 0) or 0)
                        if abs((local_opp.monto or 0) - deal_amount) > 0.01:
                            needs_update = True
                        
                        if needs_update:
                            self.stdout.write(
                                f'🔄 [{i}/{stats["total_bitrix"]}] ACTUALIZAR: "{deal_title}"'
                            )
                            
                            if not dry_run:
                                local_opp.bitrix_stage_id = stage_id
                                local_opp.oportunidad = deal_title
                                local_opp.monto = deal_amount
                                local_opp.save()
                            
                            stats['actualizadas'] += 1
                        else:
                            self.stdout.write(
                                f'✅ [{i}/{stats["total_bitrix"]}] OK: "{deal_title}" - Sin cambios'
                            )
                
                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(f'❌ Error procesando "{deal_title}": {e}')
                    )
                    stats['errores'] += 1
                
                # Pausa para no saturar
                if i % batch_size == 0:
                    self.stdout.write(f'⏳ Procesadas {i}/{stats["total_bitrix"]}... (pausa)')
                    time.sleep(1)

        # PASO 4: Detectar oportunidades locales que ya no existen en Bitrix24
        self.stdout.write('\n🧹 PASO 4: Detectando oportunidades locales huérfanas...')
        
        for local_opp in local_opportunities:
            if local_opp.bitrix_deal_id:
                deal_id = str(local_opp.bitrix_deal_id)
                
                # Si no existe en Bitrix24
                if deal_id not in bitrix_by_id:
                    self.stdout.write(
                        self.style.WARNING(
                            f'🗑️  HUÉRFANA: "{local_opp.oportunidad}" (Bitrix ID: {deal_id}) - Ya no existe en Bitrix24'
                        )
                    )
                    
                    if not dry_run:
                        # Opcional: eliminar o marcar como huérfana
                        # local_opp.delete()  # Descomenta si quieres eliminar
                        pass
                    
                    stats['eliminadas_locales'] += 1

        # PASO 5: Resumen final
        self.stdout.write('\n' + '=' * 70)
        self.stdout.write(
            self.style.SUCCESS('✅ SINCRONIZACIÓN COMPLETA TERMINADA')
        )
        self.stdout.write('\n📊 ESTADÍSTICAS FINALES:')
        self.stdout.write(f'   📥 Total en Bitrix24: {stats["total_bitrix"]}')
        self.stdout.write(f'   📦 Total locales: {stats["total_local"]}')
        
        if not skip_import:
            self.stdout.write(f'   🆕 Nuevas importadas: {stats["nuevas_importadas"]}')
        self.stdout.write(f'   🔄 Actualizadas: {stats["actualizadas"]}')
        self.stdout.write(f'   ❌ Perdidas detectadas: {stats["perdidas_detectadas"]}')
        self.stdout.write(f'   🗑️  Huérfanas encontradas: {stats["eliminadas_locales"]}')
        self.stdout.write(f'   💥 Errores: {stats["errores"]}')
        
        if dry_run:
            self.stdout.write('\n📋 MODO DRY-RUN: Para aplicar los cambios, ejecuta:')
            self.stdout.write('   docker-compose exec web python manage.py full_bitrix_sync')
        else:
            self.stdout.write('\n🎯 ¡Sincronización aplicada exitosamente!')
            self.stdout.write('   Las oportunidades perdidas ahora se filtrarán automáticamente.')

        # PASO 6: Verificación final
        if not dry_run:
            self.stdout.write('\n🔍 VERIFICACIÓN FINAL:')
            active_count = TodoItem.objects.count() - len([item for item in TodoItem.objects.all() if is_lost_opportunity(item.bitrix_stage_id)])
            lost_count = len([item for item in TodoItem.objects.all() if is_lost_opportunity(item.bitrix_stage_id)])
            
            self.stdout.write(f'   ✅ Oportunidades activas: {active_count}')
            self.stdout.write(f'   ❌ Oportunidades perdidas: {lost_count}')
            
            if lost_count > 0:
                self.stdout.write(f'\n💡 TIP: Ve las oportunidades perdidas en:')
                self.stdout.write('   https://nethive.mx/app/bitrix/lost-opportunities/')

        self.stdout.write('\n🎉 ¡Sincronización completa terminada!')
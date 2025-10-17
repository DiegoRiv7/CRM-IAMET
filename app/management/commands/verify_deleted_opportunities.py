"""
Comando para verificar si las oportunidades locales aún existen en Bitrix24.
Elimina las oportunidades que ya no existen en Bitrix24.
"""

from django.core.management.base import BaseCommand
from app.models import TodoItem
from app.bitrix_integration import get_bitrix_deal_by_id
import time

class Command(BaseCommand):
    help = 'Verifica y elimina oportunidades que ya no existen en Bitrix24'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Solo muestra qué oportunidades serían eliminadas, sin eliminarlas realmente',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        
        self.stdout.write("🔍 Iniciando verificación de oportunidades eliminadas en Bitrix24...")
        
        # Obtener todas las oportunidades que tienen bitrix_deal_id
        opportunities = TodoItem.objects.filter(bitrix_deal_id__isnull=False).exclude(bitrix_deal_id='')
        total_opportunities = opportunities.count()
        
        self.stdout.write(f"📊 Total de oportunidades a verificar: {total_opportunities}")
        
        deleted_count = 0
        verified_count = 0
        error_count = 0
        
        for opportunity in opportunities:
            try:
                # Verificar si la oportunidad aún existe en Bitrix24
                deal_data = get_bitrix_deal_by_id(opportunity.bitrix_deal_id)
                
                if deal_data is None:
                    # La oportunidad no existe en Bitrix24
                    self.stdout.write(
                        self.style.WARNING(
                            f"❌ Oportunidad '{opportunity.oportunidad}' (ID: {opportunity.bitrix_deal_id}) "
                            f"no existe en Bitrix24"
                        )
                    )
                    
                    if not dry_run:
                        opportunity.delete()
                        self.stdout.write(
                            self.style.SUCCESS(f"🗑️  Eliminada: '{opportunity.oportunidad}'")
                        )
                    else:
                        self.stdout.write(f"🔸 [DRY RUN] Se eliminaría: '{opportunity.oportunidad}'")
                    
                    deleted_count += 1
                else:
                    verified_count += 1
                    self.stdout.write(f"✅ Verificada: '{opportunity.oportunidad}'")
                
                # Pequeña pausa para no sobrecargar la API de Bitrix24
                time.sleep(0.1)
                
            except Exception as e:
                error_count += 1
                self.stdout.write(
                    self.style.ERROR(
                        f"❗ Error verificando '{opportunity.oportunidad}': {str(e)}"
                    )
                )
        
        # Resumen final
        self.stdout.write("\n" + "="*50)
        self.stdout.write("📋 RESUMEN DE VERIFICACIÓN:")
        self.stdout.write(f"   • Total verificadas: {verified_count}")
        self.stdout.write(f"   • Eliminadas: {deleted_count}")
        self.stdout.write(f"   • Errores: {error_count}")
        
        if dry_run and deleted_count > 0:
            self.stdout.write(
                self.style.WARNING(
                    f"\n⚠️  [DRY RUN] Se eliminarían {deleted_count} oportunidades. "
                    f"Ejecuta sin --dry-run para eliminarlas realmente."
                )
            )
        elif deleted_count > 0:
            self.stdout.write(
                self.style.SUCCESS(f"\n✅ Proceso completado. {deleted_count} oportunidades eliminadas.")
            )
        else:
            self.stdout.write(
                self.style.SUCCESS("\n✅ Todas las oportunidades están sincronizadas.")
            )
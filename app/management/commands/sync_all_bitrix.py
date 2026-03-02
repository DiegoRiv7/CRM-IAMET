from django.core.management.base import BaseCommand
from django.core.management import call_command
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Sincroniza todos los datos de Bitrix: usuarios, clientes, contactos y oportunidades'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force', 
            action='store_true',
            help='Fuerza la sincronización aunque haya errores'
        )

    def handle(self, *args, **options):
        start_time = timezone.now()
        self.stdout.write(
            self.style.SUCCESS(f'🚀 Iniciando sincronización completa de Bitrix - {start_time}')
        )
        
        sync_commands = [
            ('sync_bitrix_users', '👥 Sincronizando usuarios de Bitrix'),
            ('sync_bitrix', '🏢 Sincronizando empresas/clientes de Bitrix'),
            ('sync_bitrix_contacts', '📞 Sincronizando contactos de Bitrix'),
            ('import_bitrix_opportunities', '🎯 Importando oportunidades de Bitrix'),
            ('sync_bitrix_projects_tasks', '📂 Importando proyectos y tareas de Bitrix'),
        ]
        
        results = {
            'success': [],
            'errors': []
        }
        
        for command, description in sync_commands:
            self.stdout.write(f'\n{description}...')
            try:
                call_command(command)
                self.stdout.write(
                    self.style.SUCCESS(f'✅ {description} - COMPLETADO')
                )
                results['success'].append(command)
            except Exception as e:
                error_msg = f'❌ Error en {command}: {str(e)}'
                self.stdout.write(self.style.ERROR(error_msg))
                results['errors'].append((command, str(e)))
                
                if not options['force']:
                    self.stdout.write(
                        self.style.ERROR('💥 Deteniendo sincronización por error. Usa --force para continuar.')
                    )
                    break
        
        # Resumen final
        end_time = timezone.now()
        duration = end_time - start_time
        
        self.stdout.write(f'\n{"="*50}')
        self.stdout.write(f'🏁 SINCRONIZACIÓN COMPLETADA en {duration}')
        self.stdout.write(f'✅ Comandos exitosos: {len(results["success"])}')
        self.stdout.write(f'❌ Comandos con errores: {len(results["errors"])}')
        
        if results['success']:
            self.stdout.write('\n🎉 Comandos exitosos:')
            for cmd in results['success']:
                self.stdout.write(f'  - {cmd}')
        
        if results['errors']:
            self.stdout.write(self.style.WARNING('\n⚠️  Comandos con errores:'))
            for cmd, error in results['errors']:
                self.stdout.write(f'  - {cmd}: {error[:100]}...')
        
        # Log para seguimiento
        logger.info(f'Bitrix sync completed. Success: {len(results["success"])}, Errors: {len(results["errors"])}')
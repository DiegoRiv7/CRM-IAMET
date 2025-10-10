from django.core.management.base import BaseCommand
from django.conf import settings
import requests
import os

class Command(BaseCommand):
    help = 'Configura webhooks en Bitrix24 para sincronización automática'

    def add_arguments(self, parser):
        parser.add_argument(
            '--webhook-url',
            type=str,
            help='URL del webhook que recibirá las notificaciones (ej: https://tudominio.com/app/bitrix/webhook/)',
            required=True
        )
        parser.add_argument(
            '--bitrix-webhook',
            type=str,
            help='URL del webhook de Bitrix24 (ej: https://tubitrix.bitrix24.mx/rest/123/abc123/)',
            required=True
        )

    def handle(self, *args, **options):
        webhook_url = options['webhook_url']
        bitrix_webhook = options['bitrix_webhook']
        
        self.stdout.write(self.style.SUCCESS('Configurando webhooks en Bitrix24...'))
        self.stdout.write(f'URL de notificación: {webhook_url}')
        self.stdout.write(f'Bitrix webhook: {bitrix_webhook}')
        
        # Eventos que queremos escuchar
        events = [
            'ONCRMDEALADD',      # Cuando se crea una oportunidad
            'ONCRMDEALUPDATE',   # Cuando se actualiza una oportunidad  
            'ONCRMDEALDEL',      # Cuando se elimina una oportunidad
        ]
        
        success_count = 0
        error_count = 0
        
        for event in events:
            try:
                # URL para registrar webhook en Bitrix24
                register_url = bitrix_webhook.rstrip('/') + '/event.bind.json'
                
                # Datos para registrar el webhook
                data = {
                    'event': event,
                    'handler': webhook_url,
                    'auth_type': 'webhook'  # Usar autenticación por webhook
                }
                
                self.stdout.write(f'Registrando evento: {event}...')
                
                response = requests.post(register_url, json=data, timeout=10)
                response.raise_for_status()
                
                result = response.json()
                if result.get('result'):
                    self.stdout.write(
                        self.style.SUCCESS(f'✓ {event} registrado exitosamente')
                    )
                    success_count += 1
                else:
                    error_msg = result.get('error_description', 'Error desconocido')
                    self.stdout.write(
                        self.style.ERROR(f'✗ Error registrando {event}: {error_msg}')
                    )
                    error_count += 1
                    
            except requests.exceptions.RequestException as e:
                self.stdout.write(
                    self.style.ERROR(f'✗ Error de conexión registrando {event}: {e}')
                )
                error_count += 1
            except Exception as e:
                self.stdout.write(
                    self.style.ERROR(f'✗ Error inesperado registrando {event}: {e}')
                )
                error_count += 1
        
        # Resumen
        self.stdout.write('')
        self.stdout.write('=' * 50)
        self.stdout.write(f'Eventos registrados exitosamente: {success_count}')
        self.stdout.write(f'Errores: {error_count}')
        
        if success_count > 0:
            self.stdout.write('')
            self.stdout.write(self.style.SUCCESS('Configuración completada!'))
            self.stdout.write('')
            self.stdout.write('Ahora tu sistema recibirá notificaciones automáticas cuando:')
            if success_count >= 1:
                self.stdout.write('  • Se cree una nueva oportunidad en Bitrix24')
            if success_count >= 2:
                self.stdout.write('  • Se actualice una oportunidad existente')
            if success_count >= 3:
                self.stdout.write('  • Se elimine una oportunidad')
            self.stdout.write('')
            self.stdout.write('Asegúrate de que:')
            self.stdout.write(f'  1. La URL {webhook_url} sea accesible desde internet')
            self.stdout.write('  2. Tu servidor esté ejecutándose')
            self.stdout.write('  3. Las variables de entorno BITRIX_WEBHOOK_URL estén configuradas')
            
        if error_count > 0:
            self.stdout.write('')
            self.stdout.write(self.style.WARNING('Algunos eventos no se pudieron registrar.'))
            self.stdout.write('Verifica:')
            self.stdout.write('  1. Que la URL del webhook de Bitrix24 sea correcta')
            self.stdout.write('  2. Que tengas permisos para registrar webhooks')
            self.stdout.write('  3. Que la conexión a internet funcione correctamente')
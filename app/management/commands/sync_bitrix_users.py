from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from app.models import UserProfile
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Sincroniza usuarios de Bitrix24 con usuarios de Django'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Iniciando sincronización de usuarios de Bitrix24...'))

        # Datos de usuarios de Bitrix24 (hardcodeados porque API no tiene permisos)
        bitrix_users_data = [
            {"ID": "1", "NAME": "Alvaro Rivera"},
            {"ID": "10", "NAME": "Diego Rivera Torrijo"},
            {"ID": "14", "NAME": "Roberto Lopez"},
            {"ID": "16", "NAME": "Eduardo Rivera"},
            {"ID": "18", "NAME": "Eduardo Rivera Cordova"},
            {"ID": "32", "NAME": "Alondra Santamaria Medina"},
            {"ID": "86", "NAME": "Jafet Rivera"},
            {"ID": "100", "NAME": "Viridiana Santana"},
            {"ID": "120", "NAME": "Stefanny Corral"},
            {"ID": "152", "NAME": "Arceli Bihouet"},
            {"ID": "156", "NAME": "Zebra IAMET"},
        ]

        bitrix_users = bitrix_users_data

        total_processed = 0
        created_count = 0
        updated_count = 0

        for bitrix_user in bitrix_users:
            total_processed += 1
            bitrix_user_id = bitrix_user.get('ID')
            user_name = bitrix_user.get('NAME', f'Usuario {bitrix_user_id}')
            
            self.stdout.write(f'Procesando Usuario Bitrix ID: {bitrix_user_id} - {user_name}')

            try:
                # Verificar si ya existe un UserProfile con este bitrix_user_id
                try:
                    user_profile = UserProfile.objects.get(bitrix_user_id=bitrix_user_id)
                    existing_user = user_profile.user
                    self.stdout.write(f'  Usuario existente encontrado: {existing_user.username}')
                    updated_count += 1
                except UserProfile.DoesNotExist:
                    # Crear nuevo usuario Django
                    username_base = ''.join(c.lower() for c in user_name if c.isalnum())[:20]
                    if not username_base:
                        username_base = f'user{bitrix_user_id}'
                    
                    # Asegurar username único
                    username = username_base
                    counter = 1
                    while User.objects.filter(username=username).exists():
                        username = f"{username_base}{counter}"
                        counter += 1
                    
                    # Crear usuario Django
                    user_obj, created = User.objects.get_or_create(
                        username=username,
                        defaults={
                            'first_name': user_name[:30],
                            'last_name': '',
                            'is_active': True,
                            'email': f'{username}@empresa.local'
                        }
                    )

                    # Crear UserProfile asociado
                    user_profile, profile_created = UserProfile.objects.get_or_create(
                        user=user_obj,
                        defaults={'bitrix_user_id': bitrix_user_id}
                    )
                    
                    if profile_created:
                        created_count += 1
                        self.stdout.write(self.style.SUCCESS(f'  Usuario creado: {user_obj.username} -> Bitrix ID: {bitrix_user_id}'))
                    else:
                        updated_count += 1
                        self.stdout.write(self.style.SUCCESS(f'  UserProfile actualizado con Bitrix ID: {bitrix_user_id}'))

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  Error procesando Usuario Bitrix ID {bitrix_user_id}: {e}'))

        self.stdout.write(self.style.SUCCESS('--- Sincronización de usuarios de Bitrix24 completada ---'))
        self.stdout.write(self.style.SUCCESS(f'Total usuarios procesados: {total_processed}'))
        self.stdout.write(self.style.SUCCESS(f'Usuarios nuevos creados: {created_count}'))
        self.stdout.write(self.style.SUCCESS(f'Usuarios actualizados: {updated_count}'))
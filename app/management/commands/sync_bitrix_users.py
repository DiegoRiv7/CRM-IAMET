from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from app.models import UserProfile
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Sincroniza usuarios de Bitrix24 con usuarios de Django'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Iniciando sincronización de usuarios de Bitrix24...'))

        # Todos los usuarios ACTIVOS de Bitrix24
        bitrix_users_data = [
            {"ID": "1", "NAME": "Alvaro Rivera", "EMAIL": "alvaro@baja-net.com"},
            {"ID": "6", "NAME": "Julio Cesar Sanchez", "EMAIL": "julio@baja-net.com"},
            {"ID": "8", "NAME": "Jose Manuel Naguatt Perez", "EMAIL": "jose.naguatt@baja-net.com"},
            {"ID": "10", "NAME": "Diego Rivera Torrijo", "EMAIL": "diego@baja-net.com"},
            {"ID": "14", "NAME": "Roberto Lopez", "EMAIL": "roberto.lopez@baja-net.com"},
            {"ID": "16", "NAME": "Eduardo Rivera", "EMAIL": "eduardo@baja-net.com"},
            {"ID": "18", "NAME": "Eduardo Rivera Cordova", "EMAIL": "eduardo.rivera@baja-net.com"},
            {"ID": "24", "NAME": "Alejandra Naguatt", "EMAIL": "alejandra.naguatt@iamet.mx"},
            {"ID": "32", "NAME": "Alondra Santamaria Medina", "EMAIL": "alondra.santamaria@baja-net.com"},
            {"ID": "36", "NAME": "Gregorio Cruz Ignacio", "EMAIL": "gregorio.cruz@baja-net.com"},
            {"ID": "38", "NAME": "Jorge Sandoval", "EMAIL": "jorge.sandoval@baja-net.com"},
            {"ID": "40", "NAME": "Uriel Mendivil", "EMAIL": "uriel.mendivil@baja-net.com"},
            {"ID": "44", "NAME": "Alvaro Rivera Petriz", "EMAIL": "alvaro.petriz@baja-net.com"},
            {"ID": "60", "NAME": "Adan Cervantes", "EMAIL": "adan.cervantes@baja-net.com"},
            {"ID": "86", "NAME": "Jafet Rivera", "EMAIL": "Jafet.rivera@iamet.mx"},
            {"ID": "94", "NAME": "Art", "EMAIL": "alvaro.rivera@iamet.mx"},
            {"ID": "100", "NAME": "Viridiana Santana", "EMAIL": "Ventas2@iamet.mx"},
            {"ID": "102", "NAME": "Jose Lopez", "EMAIL": "joselo134199@gmail.com"},
            {"ID": "120", "NAME": "Stefanny Corral", "EMAIL": "Ventas1@iamet.mx"},
            {"ID": "134", "NAME": "Aaron Casillas", "EMAIL": "aaron.casillas@iamet.mx"},
            {"ID": "152", "NAME": "Arceli Bihouet", "EMAIL": "ventas3@iamet.mx"},
            {"ID": "156", "NAME": "Zebra IAMET", "EMAIL": "zebra@iamet.mx"},
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
                    # Crear nuevo usuario Django basado en datos de Bitrix24
                    user_email = bitrix_user.get('EMAIL', '')
                    
                    # Generar username único basado en el nombre
                    names = user_name.split()
                    if len(names) >= 2:
                        username_base = f"{names[0].lower()}.{names[-1].lower()}"
                    else:
                        username_base = user_name.lower().replace(' ', '.')
                    
                    # Limpiar caracteres especiales del username
                    username_base = ''.join(c for c in username_base if c.isalnum() or c == '.').replace('..', '.')[:30]
                    if not username_base:
                        username_base = f'user{bitrix_user_id}'
                    
                    # Asegurar username único
                    username = username_base
                    counter = 1
                    while User.objects.filter(username=username).exists():
                        username = f"{username_base}{counter}"
                        counter += 1
                    
                    # Separar nombre y apellido
                    name_parts = user_name.split()
                    first_name = name_parts[0] if name_parts else ''
                    last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
                    
                    # Crear usuario Django
                    user_obj, user_created = User.objects.get_or_create(
                        username=username,
                        defaults={
                            'first_name': first_name[:30],
                            'last_name': last_name[:30],
                            'email': user_email,
                            'is_active': True
                        }
                    )

                    # Crear o actualizar UserProfile asociado
                    user_profile, profile_created = UserProfile.objects.get_or_create(
                        user=user_obj,
                        defaults={'bitrix_user_id': bitrix_user_id}
                    )
                    
                    # Si el UserProfile ya existía pero sin bitrix_user_id, actualizarlo
                    if not profile_created and user_profile.bitrix_user_id != bitrix_user_id:
                        user_profile.bitrix_user_id = bitrix_user_id
                        user_profile.save()
                        self.stdout.write(self.style.SUCCESS(f'  UserProfile actualizado con Bitrix ID: {user_obj.username} -> Bitrix ID: {bitrix_user_id}'))
                        updated_count += 1
                    elif user_created and profile_created:
                        created_count += 1
                        self.stdout.write(self.style.SUCCESS(f'  Usuario creado: {user_obj.username} ({user_name}) -> Bitrix ID: {bitrix_user_id}'))
                    else:
                        updated_count += 1
                        self.stdout.write(self.style.SUCCESS(f'  UserProfile ya tenía Bitrix ID: {user_obj.username} -> Bitrix ID: {bitrix_user_id}'))

            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  Error procesando Usuario Bitrix ID {bitrix_user_id}: {e}'))

        self.stdout.write(self.style.SUCCESS('--- Sincronización de usuarios de Bitrix24 completada ---'))
        self.stdout.write(self.style.SUCCESS(f'Total usuarios procesados: {total_processed}'))
        self.stdout.write(self.style.SUCCESS(f'Usuarios nuevos creados: {created_count}'))
        self.stdout.write(self.style.SUCCESS(f'Usuarios actualizados: {updated_count}'))
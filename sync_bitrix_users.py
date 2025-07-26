import json
from django.contrib.auth.models import User
from app.models import UserProfile
from django.db import transaction
from django.core.exceptions import ValidationError
from django.contrib.auth.password_validation import validate_password

# Datos de usuarios de Bitrix24 proporcionados por ti
bitrix_users_data = [
    {"ID": "1", "NAME": "Alvaro", "LAST_NAME": "Rivera", "EMAIL": "alvaro@baja-net.com", "ACTIVE": True},
    {"ID": "4", "NAME": "Fernando", "LAST_NAME": "Arvizu", "EMAIL": "fernando.arvizu@baja-net.com", "ACTIVE": False},
    {"ID": "6", "NAME": "Julio Cesar", "LAST_NAME": "Sanchez", "EMAIL": "julio@baja-net.com", "ACTIVE": True},
    {"ID": "8", "NAME": "Jose Manuel", "LAST_NAME": "Naguatt Perez", "EMAIL": "jose.naguatt@baja-net.com", "ACTIVE": True},
    {"ID": "10", "NAME": "Diego", "LAST_NAME": "Rivera Torrijo", "EMAIL": "diego@baja-net.com", "ACTIVE": True},
    {"ID": "12", "NAME": "Fernando", "LAST_NAME": "Arvizu", "EMAIL": "", "ACTIVE": False},
    {"ID": "14", "NAME": "Roberto", "LAST_NAME": "Lopez", "EMAIL": "roberto.lopez@baja-net.com", "ACTIVE": True},
    {"ID": "16", "NAME": "Eduardo", "LAST_NAME": "Rivera", "EMAIL": "eduardo@baja-net.com", "ACTIVE": True},
    {"ID": "18", "NAME": "Eduardo", "LAST_NAME": "Rivera Cordova", "EMAIL": "eduardo.rivera@baja-net.com", "ACTIVE": True},
    {"ID": "20", "NAME": "Dana", "LAST_NAME": "Llerenas", "EMAIL": "dana.llerenas@baja-net.com", "ACTIVE": False},
    {"ID": "22", "NAME": "Alexis", "LAST_NAME": "Lona", "EMAIL": "ventas1@iamet.com.mx", "ACTIVE": False},
    {"ID": "24", "NAME": "Alejandra", "LAST_NAME": "Naguatt", "EMAIL": "alejandra.naguatt@iamet.mx", "ACTIVE": True},
    {"ID": "26", "NAME": "VIRIDIANA", "LAST_NAME": "SANTANA", "EMAIL": "ventas2@iamet.com.mx", "ACTIVE": False},
    {"ID": "28", "NAME": "Carolina", "LAST_NAME": "Cárdenas", "EMAIL": "carolina.cardenas@baja-net.com", "ACTIVE": False},
    {"ID": "32", "NAME": "ALONDRA", "LAST_NAME": "SANTAMARIA MEDINA", "EMAIL": "alondra.santamaria@baja-net.com", "ACTIVE": True},
    {"ID": "36", "NAME": "Gregorio ", "LAST_NAME": "Cruz Ignacio ", "EMAIL": "gregorio.cruz@baja-net.com", "ACTIVE": True},
    {"ID": "38", "NAME": "Jorge", "LAST_NAME": "Sandoval", "EMAIL": "jorge.sandoval@baja-net.com", "ACTIVE": True},
    {"ID": "40", "NAME": "uriel", "LAST_NAME": "mendivil", "EMAIL": "uriel.mendivil@baja-net.com", "ACTIVE": True},
    {"ID": "42", "NAME": "Edgar", "LAST_NAME": "Flores Magallanes", "EMAIL": "edgar.flores@baja-net.com", "ACTIVE": False},
    {"ID": "44", "NAME": "Alvaro", "LAST_NAME": "Rivera Petriz", "EMAIL": "alvaro.petriz@baja-net.com", "ACTIVE": True},
    {"ID": "46", "NAME": "Evelyn", "LAST_NAME": "Gonzalez", "EMAIL": "evelyn.gonzalez@baja-net.com", "ACTIVE": False},
    {"ID": "60", "NAME": "Adan", "LAST_NAME": "Cervantes", "EMAIL": "adan.cervantes@baja-net.com", "ACTIVE": True},
    {"ID": "66", "NAME": "Prueba", "LAST_NAME": "1", "EMAIL": "prueba@baja-net.com", "ACTIVE": False},
    {"ID": "68", "NAME": "Jesús Manuel", "LAST_NAME": "Hernández Zatarain", "EMAIL": "jesus.hernandez@baja-net.com", "ACTIVE": False},
    {"ID": "80", "NAME": "Miguel Angel", "LAST_NAME": "Pedroza", "EMAIL": "ventas3@iamet.mx", "ACTIVE": False},
    {"ID": "82", "NAME": "PRISCILLA ", "LAST_NAME": "GARCIA", "EMAIL": "Ventas4@iamet.mx", "ACTIVE": False},
    {"ID": "86", "NAME": "JAFET", "LAST_NAME": "RIVERA", "EMAIL": "Jafet.rivera@iamet.mx", "ACTIVE": True},
    {"ID": "94", "NAME": "art", "LAST_NAME": "", "EMAIL": "alvaro.rivera@iamet.mx", "ACTIVE": True},
    {"ID": "100", "NAME": "VIRIDIANA ", "LAST_NAME": "SANTANA", "EMAIL": "Ventas2@iamet.mx", "ACTIVE": True},
    {"ID": "102", "NAME": "Jose", "LAST_NAME": "Lopez", "EMAIL": "joselo134199@gmail.com", "ACTIVE": True},
    {"ID": "118", "NAME": "JANETTE", "LAST_NAME": "ANAYA", "EMAIL": "janette.anaya@iamet.mx", "ACTIVE": False},
    {"ID": "120", "NAME": "Stefanny", "LAST_NAME": "Corral", "EMAIL": "Ventas1@iamet.mx", "ACTIVE": True},
    {"ID": "134", "NAME": "Aaron", "LAST_NAME": "Casillas", "EMAIL": "aaron.casillas@iamet.mx", "ACTIVE": True},
    {"ID": "152", "NAME": "Arceli", "LAST_NAME": "Bihouet", "EMAIL": "arceli.bihouet@iamet.mx", "ACTIVE": True},
    {"ID": "156", "NAME": "Zebra", "LAST_NAME": "IAMET", "EMAIL": "zebra@iamet.mx", "ACTIVE": True}
]

new_users_created = []

with transaction.atomic():
    for bitrix_user in bitrix_users_data:
        bitrix_id = int(bitrix_user['ID'])
        bitrix_name = bitrix_user['NAME'].strip()
        bitrix_last_name = bitrix_user['LAST_NAME'].strip()
        bitrix_email = bitrix_user['EMAIL'].strip().lower()
        is_active_bitrix = bitrix_user['ACTIVE']

        if not is_active_bitrix:
            print(f"⏩ Saltando usuario inactivo de Bitrix: {bitrix_name} {bitrix_last_name} (ID: {bitrix_id})")
            continue

        # Generar username basado en el nombre, asegurando unicidad
        base_username = ''.join(filter(str.isalnum, bitrix_name)).lower()
        if not base_username: # Si el nombre está vacío o no tiene caracteres alfanuméricos
            if bitrix_email:
                base_username = bitrix_email.split('@')[0]
            else:
                print(f"❌ No se pudo determinar un nombre de usuario para Bitrix ID: {bitrix_id}. Saltando.")
                continue

        django_username = base_username
        counter = 1
        while User.objects.filter(username=django_username).exists():
            if counter == 1 and bitrix_last_name: # Intentar con nombre + apellido
                temp_username = ''.join(filter(str.isalnum, bitrix_last_name)).lower()
                django_username = f"{base_username}{temp_username}"
            elif counter == 1 and bitrix_email: # Si no hay apellido, intentar con parte del email
                temp_username = bitrix_email.split('@')[0]
                django_username = f"{base_username}{temp_username}"
            else: # Si sigue existiendo, añadir un número
                django_username = f"{base_username}{counter}"
            counter += 1
            if counter > 100: # Evitar bucles infinitos en caso de problemas
                print(f"❌ Demasiados intentos para generar username único para Bitrix ID: {bitrix_id}. Saltando.")
                django_username = "" # Marcar como fallido
                break
        
        if not django_username:
            continue

        try:
            user, created = User.objects.get_or_create(
                username=django_username,
                defaults={
                    'email': bitrix_email,
                    'first_name': bitrix_name,
                    'last_name': bitrix_last_name,
                    'is_active': True,
                }
            )
            if created:
                user.set_unusable_password() # Establecer una contraseña inutilizable
                user.save()
                new_users_created.append(user.username)
                print(f"✅ Creado nuevo usuario de Django: '{user.username}' (Email: {user.email})")
            else:
                # Si el usuario ya existía, actualizar sus datos si es necesario
                updated = False
                if user.email != bitrix_email:
                    user.email = bitrix_email
                    updated = True
                if user.first_name != bitrix_name:
                    user.first_name = bitrix_name
                    updated = True
                if user.last_name != bitrix_last_name:
                    user.last_name = bitrix_last_name
                    updated = True
                if updated:
                    user.save()
                    print(f"🔄 Actualizado usuario de Django existente: '{user.username}'")
                else:
                    print(f"✅ Usuario de Django existente: '{user.username}'")

            # Vincular o actualizar UserProfile
            user_profile, profile_created = UserProfile.objects.get_or_create(user=user)
            if user_profile.bitrix_user_id != bitrix_id:
                user_profile.bitrix_user_id = bitrix_id
                user_profile.save()
                print(f"🔗 Vinculado/Actualizado UserProfile para '{user.username}' con Bitrix ID: {bitrix_id}")
            else:
                print(f"🔗 UserProfile para '{user.username}' ya vinculado con Bitrix ID: {bitrix_id}")

        except ValidationError as e:
            print(f"❌ Error de validación al crear/actualizar usuario '{django_username}': {e.message_dict}")
        except Exception as e:
            print(f"❌ Error inesperado al procesar usuario Bitrix ID {bitrix_id} ({bitrix_name} {bitrix_last_name}): {e}")

print("\n--- Resumen del Proceso ---")
if new_users_created:
    print("Se crearon los siguientes usuarios nuevos en Django:")
    for username in new_users_created:
        print(f"- {username}")
    print("\nIMPORTANTE: Estos usuarios tienen una contraseña inutilizable. Para que puedan iniciar sesión, debes establecer una contraseña para cada uno. Puedes hacerlo con el comando:")
    print("  python3 manage.py changepassword <username>")
    print("O a través del panel de administración de Django.")
else:
    print("No se crearon usuarios nuevos en Django.")

print("\nProceso de sincronización de usuarios de Bitrix completado.")
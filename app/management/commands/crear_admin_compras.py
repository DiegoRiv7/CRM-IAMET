from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from app.models import UserProfile


USERNAME = 'admin_compras'
EMAIL = 'admin_compras@iamet.mx'
FIRST_NAME = 'Admin'
LAST_NAME = 'Compras'
PASSWORD = 'IametAdmin2026!'


class Command(BaseCommand):
    help = "Crea/actualiza el usuario administrador del módulo Compras (idempotente)."

    @transaction.atomic
    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(
            username=USERNAME,
            defaults={
                'email': EMAIL,
                'first_name': FIRST_NAME,
                'last_name': LAST_NAME,
                'is_active': True,
            },
        )

        # Asegurar campos en cada corrida
        user.email = EMAIL
        user.first_name = FIRST_NAME
        user.last_name = LAST_NAME
        user.is_active = True
        user.set_password(PASSWORD)
        user.save()

        profile, profile_created = UserProfile.objects.get_or_create(user=user)
        profile.rol = 'administrador'
        profile.save(update_fields=['rol'])

        action = "Creado" if created else "Actualizado"
        profile_action = "creado" if profile_created else "actualizado"
        self.stdout.write(self.style.SUCCESS(
            f"Usuario {action}: {USERNAME} ({EMAIL}) | Perfil {profile_action} con rol='administrador'."
        ))

"""
Siembra el catálogo inicial de técnicos del Plan de Trabajo Bajanet
(URIEL, ARMANDO, GOYO, CHUY, EDGAR, JULIO, TOÑO, JORGE).

Idempotente: si el técnico ya existe (match por nombre, case-insensitive),
no lo duplica ni lo modifica.
"""
from django.core.management.base import BaseCommand
from app.models import Tecnico


TECNICOS_SEED = [
    # (nombre, rol)
    ('URIEL', 'tecnico'),
    ('ARMANDO', 'tecnico'),
    ('GOYO', 'tecnico'),
    ('CHUY', 'tecnico'),
    ('EDGAR', 'tecnico'),
    ('JULIO', 'tecnico'),
    ('TOÑO', 'tecnico'),
    ('JORGE', 'tecnico'),
]


class Command(BaseCommand):
    help = 'Siembra los técnicos iniciales del Plan de Trabajo Bajanet.'

    def handle(self, *args, **options):
        creados = 0
        existentes = 0
        for nombre, rol in TECNICOS_SEED:
            if Tecnico.objects.filter(nombre__iexact=nombre).exists():
                existentes += 1
                self.stdout.write(f'  · {nombre} (ya existía)')
                continue
            Tecnico.objects.create(nombre=nombre, rol=rol, activo=True)
            creados += 1
            self.stdout.write(self.style.SUCCESS(f'  + {nombre}'))

        self.stdout.write(self.style.SUCCESS(
            f'\nTotal: {creados} creados, {existentes} ya existían.'
        ))

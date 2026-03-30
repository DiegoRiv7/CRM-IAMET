from django.core.management.base import BaseCommand
from app.models import EtapaPipeline


ETAPAS = {
    'runrate': [
        ('En Solicitud', '#FFFFFF'),
        ('Cotizando', '#FFEB3B'),
        ('Enviada', '#2196F3'),
        ('Seguimiento', '#FF9800'),
        ('Vendido s/PO', '#9C27B0'),
        ('Vendido c/PO', '#9C27B0'),
        ('En Tránsito', '#673AB7'),
        ('Facturado', '#00BCD4'),
        ('Programado', '#03DAC6'),
        ('Entregado', '#4CAF50'),
        ('Esperando Pago', '#8BC34A'),
        ('Sin Respuesta', '#607D8B'),
        ('Ganado', '#4CAF50'),
        ('Perdido', '#F44336'),
    ],
    'proyecto': [
        ('Oportunidad', '#FFFFFF'),
        ('Levantamiento', '#FF5C5A'),
        ('Base Cotización', '#55D0E0'),
        ('Cotizando', '#2FC6F6'),
        ('Enviada', '#2FC6F6'),
        ('Seguimiento', '#39A8EF'),
        ('Vendido s/PO', '#FF00FF'),
        ('Vendido c/PO', '#FF00FF'),
        ('Cotiz. Proveedor', '#a861ab'),
        ('Comprando', '#2FC6F6'),
        ('En Tránsito', '#2FC6F6'),
        ('Ejecutando', '#FFFF00'),
        ('Entregado', '#2FC6F6'),
        ('Facturado', '#55D0E0'),
        ('Reportes', '#47E4C2'),
        ('Pagado', '#7BD500'),
        ('Perdido', '#FF0000'),
    ],
}


class Command(BaseCommand):
    help = 'Limpia y pobla EtapaPipeline con las etapas definidas por pipeline'

    def handle(self, *args, **options):
        # Limpiar tabla
        deleted, _ = EtapaPipeline.objects.all().delete()
        if deleted:
            self.stdout.write(f'Eliminadas {deleted} etapas existentes.')

        creadas = 0
        for pipeline, etapas in ETAPAS.items():
            self.stdout.write(f'\n  Pipeline: {pipeline}')
            for orden, (nombre, color) in enumerate(etapas, 1):
                EtapaPipeline.objects.create(
                    pipeline=pipeline,
                    nombre=nombre,
                    color=color,
                    orden=orden,
                    activo=True,
                )
                creadas += 1
                self.stdout.write(f'    #{orden} {nombre} ({color})')

        self.stdout.write(self.style.SUCCESS(f'\nListo: {creadas} etapas creadas.'))

from django.core.management.base import BaseCommand
from app.models import TodoItem, EtapaPipeline


class Command(BaseCommand):
    help = 'Pobla EtapaPipeline con las etapas existentes en las oportunidades'

    def handle(self, *args, **options):
        # Obtener combinaciones únicas de tipo_negociacion + etapa_corta + etapa_color
        etapas_existentes = (
            TodoItem.objects
            .exclude(etapa_corta__isnull=True)
            .exclude(etapa_corta='')
            .values('tipo_negociacion', 'etapa_corta', 'etapa_color')
            .distinct()
        )

        creadas = 0
        existentes = 0

        for row in etapas_existentes:
            pipeline = row['tipo_negociacion'] or 'runrate'
            nombre = row['etapa_corta']
            color = row['etapa_color'] or '#6B7280'

            ya_existe = EtapaPipeline.objects.filter(
                pipeline=pipeline, nombre=nombre
            ).exists()

            if ya_existe:
                existentes += 1
                self.stdout.write(f'  Ya existe: {pipeline} → {nombre}')
                continue

            # Determinar orden basado en cuántas etapas ya tiene este pipeline
            orden = EtapaPipeline.objects.filter(pipeline=pipeline).count() + 1

            EtapaPipeline.objects.create(
                pipeline=pipeline,
                nombre=nombre,
                color=color,
                orden=orden,
                activo=True,
            )
            creadas += 1
            self.stdout.write(f'  Creada: {pipeline} → {nombre} (color: {color}, orden: {orden})')

        self.stdout.write(self.style.SUCCESS(
            f'\nListo: {creadas} etapas creadas, {existentes} ya existían.'
        ))

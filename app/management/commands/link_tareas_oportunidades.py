"""
Vincula las Tareas de proyectos Bitrix24 a la oportunidad correspondiente,
usando los registros de OportunidadProyecto como puente.

Uso:
    python manage.py link_tareas_oportunidades
    python manage.py link_tareas_oportunidades --dry-run
"""
from django.core.management.base import BaseCommand
from app.models import OportunidadProyecto, Proyecto, Tarea


class Command(BaseCommand):
    help = 'Vincula Tareas de proyectos a sus oportunidades via OportunidadProyecto'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Muestra qué cambiaría sin guardar')
        parser.add_argument('--limit', type=int, default=0,
                            help='Procesar solo los primeros N proyectos (0 = todos)')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        limit = options['limit']
        if dry_run:
            self.stdout.write(self.style.WARNING('── DRY RUN ──\n'))
        if limit:
            self.stdout.write(self.style.WARNING(f'── LIMIT {limit} proyecto(s) ──\n'))

        cnt_ok = cnt_skip_ya = cnt_skip_no_proyecto = 0

        qs = OportunidadProyecto.objects.select_related('oportunidad').all()
        if limit:
            qs = qs[:limit]

        for link in qs:
            try:
                proyecto = Proyecto.objects.get(bitrix_group_id=int(link.bitrix_project_id))
            except (Proyecto.DoesNotExist, ValueError):
                cnt_skip_no_proyecto += 1
                continue

            tareas = Tarea.objects.filter(proyecto=proyecto, oportunidad__isnull=True)
            count = tareas.count()
            if not count:
                cnt_skip_ya += 1
                continue

            self.stdout.write(
                f'  Proyecto {link.bitrix_project_id} → Opp #{link.oportunidad_id} '
                f'"{link.oportunidad.oportunidad[:45]}" — {count} tarea(s)'
            )
            if not dry_run:
                tareas.update(oportunidad=link.oportunidad)
            cnt_ok += count

        self.stdout.write(f'\n✅ Tareas vinculadas  : {cnt_ok}')
        self.stdout.write(f'⏭  Ya tenían opp      : {cnt_skip_ya} proyectos')
        self.stdout.write(f'⚠  Proyecto no hallado: {cnt_skip_no_proyecto}')
        if dry_run:
            self.stdout.write(self.style.WARNING('\n(DRY RUN: no se guardó nada)'))
        self.stdout.write('\n=== FIN ===')

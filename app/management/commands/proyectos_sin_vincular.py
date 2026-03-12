"""
Muestra cuántos proyectos tienen archivos/carpetas en el drive
pero NO están vinculados a ninguna oportunidad.

Uso:
    python manage.py proyectos_sin_vincular
    python manage.py proyectos_sin_vincular --lista
"""
from django.core.management.base import BaseCommand
from django.db.models import Q
from app.models import Proyecto, OportunidadProyecto, CarpetaProyecto, ArchivoProyecto


class Command(BaseCommand):
    help = 'Cuenta proyectos con drive pero sin oportunidad vinculada'

    def add_arguments(self, parser):
        parser.add_argument('--lista', action='store_true',
                            help='Muestra el detalle de cada proyecto')
        parser.add_argument('--desde', type=int, default=0,
                            help='Solo proyectos creados en este año o después (ej. 2025)')

    def handle(self, *args, **options):
        desde = options['desde']

        # Proyectos que ya tienen vínculo
        vinculados_ids = OportunidadProyecto.objects.values_list('bitrix_project_id', flat=True)
        vinculados_group_ids = set()
        for bid in vinculados_ids:
            try:
                vinculados_group_ids.add(int(bid))
            except (ValueError, TypeError):
                pass

        # Proyectos con al menos 1 carpeta o archivo en su drive
        con_carpeta = CarpetaProyecto.objects.values_list('proyecto_id', flat=True).distinct()
        con_archivo = ArchivoProyecto.objects.values_list('proyecto_id', flat=True).distinct()
        con_drive_ids = set(con_carpeta) | set(con_archivo)

        # Filtrar los que NO están vinculados
        qs = Proyecto.objects.filter(id__in=con_drive_ids).exclude(
            bitrix_group_id__in=vinculados_group_ids
        )
        if desde:
            qs = qs.filter(fecha_creacion__year__gte=desde)
        proyectos_sin_vincular = qs.order_by('nombre')

        total = proyectos_sin_vincular.count()
        total_con_drive = len(con_drive_ids)
        total_vinculados = Proyecto.objects.filter(bitrix_group_id__in=vinculados_group_ids).count()

        self.stdout.write(f'\n{"="*55}')
        self.stdout.write(f'  Proyectos con drive           : {total_con_drive}')
        self.stdout.write(f'  Proyectos vinculados a opp    : {total_vinculados}')
        self.stdout.write(self.style.WARNING(
            f'  Proyectos SIN vincular (drive) : {total}'
        ))
        self.stdout.write(f'{"="*55}')

        if options['lista'] and total:
            self.stdout.write('')
            for p in proyectos_sin_vincular:
                ncarpetas = CarpetaProyecto.objects.filter(proyecto=p).count()
                narchivos = ArchivoProyecto.objects.filter(proyecto=p).count()
                self.stdout.write(
                    f'  [{p.bitrix_group_id}] {p.nombre[:50]:<50} '
                    f'carpetas:{ncarpetas}  archivos:{narchivos}'
                )

        self.stdout.write('')

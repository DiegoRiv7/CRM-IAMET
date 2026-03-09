"""
Reporte de estado del sistema de vínculos proyecto-oportunidad.

Uso:
  python manage.py link_proyectos_status
  python manage.py link_proyectos_status --sin-vinculo      # lista solo las oportunidades sin ningún vínculo
  python manage.py link_proyectos_status --rechazadas       # lista oportunidades con todas sugerencias rechazadas
  python manage.py link_proyectos_status --proyectos-solos  # proyectos sin oportunidad confirmada
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Reporte de estado de vínculos proyecto-oportunidad'

    def add_arguments(self, parser):
        parser.add_argument(
            '--sin-vinculo',
            action='store_true',
            help='Lista oportunidades sin ningún vínculo (ni sugerencia ni confirmado)',
        )
        parser.add_argument(
            '--rechazadas',
            action='store_true',
            help='Lista oportunidades donde todas las sugerencias fueron rechazadas',
        )
        parser.add_argument(
            '--proyectos-solos',
            action='store_true',
            help='Lista proyectos de ingeniería sin oportunidad confirmada',
        )
        parser.add_argument(
            '--pendientes',
            action='store_true',
            help='Lista oportunidades con sugerencias pendientes de revisar',
        )

    def handle(self, *args, **options):
        from app.models import TodoItem, Proyecto, ProyectoOportunidadLink
        from django.db.models import Count, Q

        self.stdout.write('\n' + '═' * 60)
        self.stdout.write('  ESTADO DE VÍNCULOS PROYECTO ↔ OPORTUNIDAD')
        self.stdout.write('═' * 60 + '\n')

        total_opps = TodoItem.objects.count()
        total_proyectos = Proyecto.objects.filter(es_ingenieria=True).count()

        # IDs de oportunidades con al menos un link confirmado
        opps_confirmadas_ids = set(
            ProyectoOportunidadLink.objects.filter(confirmado=True)
            .values_list('oportunidad_id', flat=True).distinct()
        )

        # IDs de oportunidades con al menos una sugerencia pendiente (no confirmada, no rechazada)
        opps_pendientes_ids = set(
            ProyectoOportunidadLink.objects.filter(confirmado=False, rechazado=False)
            .values_list('oportunidad_id', flat=True).distinct()
        ) - opps_confirmadas_ids  # excluir las ya confirmadas

        # IDs de oportunidades con SOLO rechazadas (sin confirmadas ni pendientes)
        opps_con_links_ids = set(
            ProyectoOportunidadLink.objects.values_list('oportunidad_id', flat=True).distinct()
        )
        opps_solo_rechazadas_ids = (
            opps_con_links_ids - opps_confirmadas_ids - opps_pendientes_ids
        )

        # Oportunidades sin NINGÚN link
        opps_sin_vinculo_ids = set(
            TodoItem.objects.exclude(id__in=opps_con_links_ids)
            .values_list('id', flat=True)
        )

        # Proyectos con oportunidad confirmada
        proyectos_confirmados_ids = set(
            ProyectoOportunidadLink.objects.filter(confirmado=True)
            .values_list('proyecto_id', flat=True).distinct()
        )
        proyectos_sin_confirmar_ids = set(
            Proyecto.objects.filter(es_ingenieria=True)
            .exclude(id__in=proyectos_confirmados_ids)
            .values_list('id', flat=True)
        )

        # ── RESUMEN GENERAL ──────────────────────────────────────
        self.stdout.write(self.style.SUCCESS('OPORTUNIDADES'))
        self.stdout.write(f'  Total:                      {total_opps:>6}')
        self.stdout.write(self.style.SUCCESS(
            f'  Con vínculo confirmado:     {len(opps_confirmadas_ids):>6}'
        ))
        self.stdout.write(self.style.WARNING(
            f'  Con sugerencias pendientes: {len(opps_pendientes_ids):>6}  ← por revisar'
        ))
        self.stdout.write(self.style.ERROR(
            f'  Con todas rechazadas:       {len(opps_solo_rechazadas_ids):>6}  ← sin match aceptado'
        ))
        self.stdout.write(
            f'  Sin ningún vínculo:         {len(opps_sin_vinculo_ids):>6}  ← no aparecen en matching'
        )

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS('PROYECTOS DE INGENIERÍA'))
        self.stdout.write(f'  Total:                      {total_proyectos:>6}')
        self.stdout.write(self.style.SUCCESS(
            f'  Con oportunidad confirmada: {len(proyectos_confirmados_ids):>6}'
        ))
        self.stdout.write(
            f'  Sin oportunidad confirmada: {len(proyectos_sin_confirmar_ids):>6}'
        )

        pct_opps = (len(opps_confirmadas_ids) / total_opps * 100) if total_opps else 0
        pct_proy = (len(proyectos_confirmados_ids) / total_proyectos * 100) if total_proyectos else 0
        self.stdout.write('')
        self.stdout.write(f'  Progreso oportunidades:     {pct_opps:>5.1f}%')
        self.stdout.write(f'  Progreso proyectos:         {pct_proy:>5.1f}%')
        self.stdout.write('\n' + '═' * 60 + '\n')

        # ── DETALLE OPCIONALES ───────────────────────────────────
        if options['sin_vinculo']:
            opps = TodoItem.objects.filter(id__in=opps_sin_vinculo_ids).order_by('oportunidad')
            self.stdout.write(self.style.WARNING(
                f'\nOPORTUNIDADES SIN NINGÚN VÍNCULO ({opps.count()})'
            ))
            self.stdout.write('─' * 60)
            for opp in opps:
                cliente = opp.cliente.nombre_empresa if opp.cliente else '—'
                self.stdout.write(f'  [{opp.id:>6}] {opp.oportunidad[:55]:<55}  ({cliente})')
            self.stdout.write('')

        if options['rechazadas']:
            opps = TodoItem.objects.filter(id__in=opps_solo_rechazadas_ids).order_by('oportunidad')
            self.stdout.write(self.style.ERROR(
                f'\nOPORTUNIDADES CON TODAS SUGERENCIAS RECHAZADAS ({opps.count()})'
            ))
            self.stdout.write('─' * 60)
            for opp in opps:
                cliente = opp.cliente.nombre_empresa if opp.cliente else '—'
                self.stdout.write(f'  [{opp.id:>6}] {opp.oportunidad[:55]:<55}  ({cliente})')
            self.stdout.write('')

        if options['proyectos_solos']:
            proyectos = Proyecto.objects.filter(
                id__in=proyectos_sin_confirmar_ids, es_ingenieria=True
            ).order_by('nombre')
            self.stdout.write(
                f'\nPROYECTOS SIN OPORTUNIDAD CONFIRMADA ({proyectos.count()})'
            )
            self.stdout.write('─' * 60)
            for p in proyectos:
                tiene_sugerencias = ProyectoOportunidadLink.objects.filter(
                    proyecto=p, confirmado=False, rechazado=False
                ).exists()
                estado = self.style.WARNING('[sugerencia]') if tiene_sugerencias else '            '
                self.stdout.write(f'  [{p.id:>6}] {estado} {p.nombre[:60]}')
            self.stdout.write('')

        if options['pendientes']:
            links = ProyectoOportunidadLink.objects.filter(
                confirmado=False, rechazado=False
            ).select_related('proyecto', 'oportunidad').order_by('-score')
            self.stdout.write(self.style.WARNING(
                f'\nSUGERENCIAS PENDIENTES DE REVISAR ({links.count()})'
            ))
            self.stdout.write('─' * 60)
            for lk in links:
                self.stdout.write(
                    f'  [{lk.score:>3.0f}%] {lk.proyecto.nombre[:40]:<40}  ↔  {lk.oportunidad.oportunidad[:40]}'
                )
            self.stdout.write('')

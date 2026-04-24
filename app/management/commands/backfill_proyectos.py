"""
Management command: crea ProyectoIAMET para oportunidades tipo 'proyecto'
que ya están en etapa Levantamiento o posterior y aún no tienen proyecto.

Uso:
    python manage.py backfill_proyectos          # dry-run (solo muestra)
    python manage.py backfill_proyectos --apply   # aplica los cambios
"""
from datetime import date, timedelta
from django.core.management.base import BaseCommand
from app.models import TodoItem, ProyectoIAMET, ProyectoConfiguracion, TareaOportunidad, ProyectoTarea


# Etapas que están en Levantamiento o posterior en el pipeline de proyecto
ETAPAS_POST_LEVANTAMIENTO = [
    'Levantamiento',
    'Base Cotización',
    'Cotizando',
    'Enviada',
    'Seguimiento',
    'Vendido s/PO',
    'Vendido c/PO',
    'Cotiz. Proveedor',
    'Comprando',
    'En Tránsito',
    'Ejecutando',
    'Entregado',
    'Facturado',
    'Reportes',
    'Pagado',
]


class Command(BaseCommand):
    help = 'Crea ProyectoIAMET para oportunidades tipo proyecto en etapa >= Levantamiento sin proyecto existente'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Aplica los cambios (sin este flag solo muestra lo que haría)',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        hoy = date.today()

        # Buscar oportunidades tipo proyecto en etapas post-levantamiento
        opps = TodoItem.objects.filter(
            tipo_negociacion__in=['proyecto', 'bitrix_proyecto'],
            etapa_corta__in=ETAPAS_POST_LEVANTAMIENTO,
        ).select_related('cliente', 'usuario')

        created = 0
        skipped = 0

        for opp in opps:
            # Verificar que no tenga proyecto ya
            if ProyectoIAMET.objects.filter(oportunidad=opp).exists():
                skipped += 1
                continue

            if apply:
                proyecto = ProyectoIAMET.objects.create(
                    usuario=opp.usuario,
                    oportunidad=opp,
                    nombre=opp.oportunidad,
                    cliente_nombre=opp.cliente.nombre_empresa if opp.cliente else '',
                    descripcion=opp.comentarios or opp.oportunidad,
                    utilidad_presupuestada=opp.monto or 0,
                    status='active',
                    fecha_inicio=hoy,
                    fecha_fin=hoy + timedelta(days=30),
                )
                ProyectoConfiguracion.objects.create(proyecto=proyecto)

                # Sync tareas existentes de la oportunidad
                for t in opp.tareas_oportunidad.all():
                    ProyectoTarea.objects.create(
                        proyecto=proyecto,
                        titulo=t.titulo,
                        descripcion=t.descripcion or '',
                        status='completed' if t.estado == 'completada' else 'pending',
                        prioridad='high' if t.prioridad == 'alta' else 'medium',
                        asignado_a=t.responsable,
                        fecha_limite=t.fecha_limite.date() if t.fecha_limite else None,
                    )

                self.stdout.write(self.style.SUCCESS(
                    f'  ✓ Creado: {opp.oportunidad[:50]} → etapa: {opp.etapa_corta} → proyecto #{proyecto.id}'
                ))
            else:
                self.stdout.write(
                    f'  → {opp.oportunidad[:50]} | etapa: {opp.etapa_corta} | vendedor: {opp.usuario}'
                )

            created += 1

        mode = 'CREADOS' if apply else 'POR CREAR (dry-run)'
        self.stdout.write('')
        self.stdout.write(self.style.WARNING(f'{mode}: {created} | Ya tenían proyecto: {skipped}'))
        if not apply and created > 0:
            self.stdout.write(self.style.NOTICE('Ejecuta con --apply para crear los proyectos.'))

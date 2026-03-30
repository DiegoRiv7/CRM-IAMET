from django.core.management.base import BaseCommand
from app.models import TodoItem, Cotizacion


class Command(BaseCommand):
    help = 'Actualiza el monto de cada oportunidad con el subtotal de su última cotización'

    def handle(self, *args, **options):
        # Obtener oportunidades que tienen al menos una cotización
        oportunidades_con_cotizacion = TodoItem.objects.filter(
            cotizaciones__isnull=False
        ).distinct()

        total = oportunidades_con_cotizacion.count()
        actualizadas = 0

        for opp in oportunidades_con_cotizacion:
            ultima_cotizacion = opp.cotizaciones.order_by('-fecha_creacion').first()
            if ultima_cotizacion and ultima_cotizacion.subtotal > 0:
                opp.monto = ultima_cotizacion.subtotal
                opp.save(update_fields=['monto', 'fecha_actualizacion'])
                actualizadas += 1
                self.stdout.write(
                    f'  {opp.oportunidad}: monto actualizado a ${ultima_cotizacion.subtotal:,.2f}'
                )

        self.stdout.write(self.style.SUCCESS(
            f'\nListo: {actualizadas} de {total} oportunidades actualizadas.'
        ))

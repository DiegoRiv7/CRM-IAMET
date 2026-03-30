from decimal import Decimal
from django.conf import settings
from django.core.management.base import BaseCommand
from app.models import TodoItem, Cotizacion


class Command(BaseCommand):
    help = 'Actualiza el monto de cada oportunidad con el subtotal de su última cotización (convertido a MXN si es USD)'

    def handle(self, *args, **options):
        tc = Decimal(str(getattr(settings, 'TIPO_CAMBIO_USD_MXN', '20.00')))
        self.stdout.write(f'Tipo de cambio USD→MXN: {tc}')

        oportunidades_con_cotizacion = TodoItem.objects.filter(
            cotizaciones__isnull=False
        ).distinct()

        total = oportunidades_con_cotizacion.count()
        actualizadas = 0

        for opp in oportunidades_con_cotizacion:
            ultima_cot = opp.cotizaciones.order_by('-fecha_creacion').first()
            if ultima_cot and ultima_cot.subtotal > 0:
                monto_mxn = ultima_cot.subtotal
                moneda = (ultima_cot.moneda or '').upper()
                if moneda == 'USD':
                    monto_mxn = (ultima_cot.subtotal * tc).quantize(Decimal('0.01'))
                opp.monto = monto_mxn
                opp.save(update_fields=['monto', 'fecha_actualizacion'])
                actualizadas += 1
                tag = f' (USD×{tc})' if moneda == 'USD' else ' (MXN)'
                self.stdout.write(
                    f'  {opp.oportunidad}: ${monto_mxn:,.2f}{tag}'
                )

        self.stdout.write(self.style.SUCCESS(
            f'\nListo: {actualizadas} de {total} oportunidades actualizadas.'
        ))

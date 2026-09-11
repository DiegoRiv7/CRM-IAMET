from decimal import Decimal
from django.core.management.base import BaseCommand
from app.models import TodoItem, Cotizacion


class Command(BaseCommand):
    help = 'Actualiza el monto de cada oportunidad con el total (con IVA) de su última cotización (convertido a MXN si es USD)'

    def handle(self, *args, **options):
        from app.views_cotizaciones import get_tipo_cambio_usd_mxn
        from app.services_financiero import oportunidad_tiene_po
        tc = get_tipo_cambio_usd_mxn()
        self.stdout.write(f'Tipo de cambio USD→MXN: {tc}')

        oportunidades_con_cotizacion = TodoItem.objects.filter(
            cotizaciones__isnull=False
        ).distinct()

        total = oportunidades_con_cotizacion.count()
        actualizadas = 0
        saltadas_po = 0

        for opp in oportunidades_con_cotizacion:
            # No pisar el monto de oportunidades con PO: ahí el monto real lo
            # manda la PO del cliente, no la última cotización.
            if oportunidad_tiene_po(opp.id):
                saltadas_po += 1
                continue
            ultima_cot = opp.cotizaciones.order_by('-fecha_creacion').first()
            if ultima_cot and ultima_cot.total > 0:
                monto_mxn = ultima_cot.total
                moneda = (ultima_cot.moneda or '').upper()
                if moneda == 'USD':
                    monto_mxn = (ultima_cot.total * tc).quantize(Decimal('0.01'))
                opp.monto = monto_mxn
                opp.save(update_fields=['monto', 'fecha_actualizacion'])
                actualizadas += 1
                tag = f' (USD×{tc})' if moneda == 'USD' else ' (MXN)'
                self.stdout.write(
                    f'  {opp.oportunidad}: ${monto_mxn:,.2f}{tag}'
                )

        self.stdout.write(self.style.SUCCESS(
            f'\nListo: {actualizadas} de {total} oportunidades actualizadas '
            f'({saltadas_po} saltadas por tener PO).'
        ))

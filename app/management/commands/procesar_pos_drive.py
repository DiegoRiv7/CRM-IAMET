"""Revisa los PDF que YA están en los Drives y detecta las POs del cliente.

El análisis nuevo corre al subir un archivo, así que todo lo que se subió antes
quedaría sin monto. Este comando hace la pasada hacia atrás.

    python manage.py procesar_pos_drive --dry-run          # solo reporta
    python manage.py procesar_pos_drive                    # aplica
    python manage.py procesar_pos_drive --oportunidad 1291 # una sola
    python manage.py procesar_pos_drive --rehacer          # reanaliza las ya marcadas

Por defecto NO toca los archivos que ya tienen tipo_financiero: respeta lo que
el módulo financiero clasificó como OC de proveedor o factura.
"""

from django.core.management.base import BaseCommand

from app.models import ArchivoOportunidad
from app.services_financiero import (
    TIPO_PO_CLIENTE, analizar_po_cliente, recalcular_monto_por_po,
)


class Command(BaseCommand):
    help = 'Detecta las POs del cliente en los PDF ya subidos y actualiza el monto de sus oportunidades.'

    def add_arguments(self, parser):
        parser.add_argument('--oportunidad', type=int, default=None,
                            help='Procesar solo esta oportunidad.')
        parser.add_argument('--rehacer', action='store_true',
                            help='Reanalizar también los que ya están marcados como PO.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Reporta lo que haría, sin escribir.')

    def handle(self, *args, **opts):
        seco = opts['dry_run']

        qs = ArchivoOportunidad.objects.filter(extension__iexact='pdf')
        if opts['oportunidad']:
            qs = qs.filter(oportunidad_id=opts['oportunidad'])
        if opts['rehacer']:
            qs = qs.filter(tipo_financiero__in=['', TIPO_PO_CLIENTE])
        else:
            # Sin --rehacer no se pisa lo que el módulo financiero ya clasificó.
            qs = qs.filter(tipo_financiero='')
        qs = qs.select_related('oportunidad').order_by('oportunidad_id', 'id')

        total = qs.count()
        self.stdout.write('PDF por revisar: %d' % total)
        if not total:
            return

        encontradas = 0
        opps = set()
        for archivo in qs.iterator():
            if seco:
                # En seco solo se mira si PARECE PO; no se abre para extraer.
                from app.services_financiero import _texto_pdf, es_po_de_cliente
                if es_po_de_cliente(archivo.nombre_original, _texto_pdf(archivo.archivo)):
                    encontradas += 1
                    self.stdout.write('  [PO?] opp %-6s %s' % (
                        archivo.oportunidad_id, archivo.nombre_original))
                continue

            try:
                monto = analizar_po_cliente(archivo)
            except Exception as e:
                self.stderr.write('  error en archivo %s: %s' % (archivo.id, e))
                continue
            if monto is not None:
                encontradas += 1
                opps.add(archivo.oportunidad_id)
                self.stdout.write('  [PO ] opp %-6s %-45s $%s' % (
                    archivo.oportunidad_id, archivo.nombre_original[:45], monto))

        if seco:
            self.stdout.write(self.style.WARNING(
                '--dry-run: %d parecen PO. No se escribió nada.' % encontradas))
            return

        for opp_id in sorted(opps):
            archivo = ArchivoOportunidad.objects.filter(oportunidad_id=opp_id).first()
            if archivo and archivo.oportunidad:
                nuevo = recalcular_monto_por_po(archivo.oportunidad)
                self.stdout.write('  opp %-6s monto -> $%s' % (opp_id, nuevo))

        self.stdout.write(self.style.SUCCESS(
            'Listo: %d POs detectadas en %d oportunidades.' % (encontradas, len(opps))))

"""Dice paso por paso por qué un PDF del Drive se detecta (o no) como PO.

Sirve para no adivinar: corre contra el archivo real y reporta cada etapa de la
cadena — se encuentra el archivo, se abre, se le saca texto, parece PO, se le
saca monto — señalando en cuál se cae.

    python manage.py diagnosticar_po --oportunidad 1254
    python manage.py diagnosticar_po --archivo 21200
    python manage.py diagnosticar_po --oportunidad 1254 --texto   # vuelca el texto
"""

from django.core.management.base import BaseCommand

from app.models import ArchivoOportunidad


class Command(BaseCommand):
    help = 'Diagnostica por qué un PDF del Drive se detecta o no como PO del cliente.'

    def add_arguments(self, parser):
        parser.add_argument('--oportunidad', type=int, default=None)
        parser.add_argument('--archivo', type=int, default=None)
        parser.add_argument('--texto', action='store_true',
                            help='Vuelca el texto extraído del PDF (para ver qué lee).')

    def handle(self, *args, **opts):
        if not opts['oportunidad'] and not opts['archivo']:
            self.stderr.write('Usa --oportunidad <id> o --archivo <id>.')
            return

        # ── 0. ¿pdfplumber está instalado? ──
        try:
            import pdfplumber  # noqa: F401
            self.stdout.write(self.style.SUCCESS('0. pdfplumber: instalado'))
        except ImportError as e:
            self.stdout.write(self.style.ERROR('0. pdfplumber NO está: %s' % e))
            return

        qs = ArchivoOportunidad.objects.all()
        if opts['archivo']:
            qs = qs.filter(id=opts['archivo'])
        else:
            qs = qs.filter(oportunidad_id=opts['oportunidad'])
        archivos = list(qs.select_related('oportunidad'))

        if not archivos:
            self.stdout.write(self.style.ERROR('1. No hay archivos con ese criterio.'))
            return
        self.stdout.write('1. Archivos encontrados: %d' % len(archivos))

        from app.services_financiero import (
            _texto_pdf, es_po_de_cliente, monto_de_po, moneda_de_po,
            TIPO_PO_CLIENTE,
        )

        for a in archivos:
            self.stdout.write('')
            self.stdout.write(self.style.HTTP_INFO(
                '── archivo %s · opp %s · %s' % (a.id, a.oportunidad_id, a.nombre_original)))
            self.stdout.write('   extension guardada : %r' % a.extension)
            self.stdout.write('   tipo_financiero    : %r' % a.tipo_financiero)
            self.stdout.write('   monto_extraido     : %r' % a.monto_extraido)
            self.stdout.write('   procesado          : %r' % a.procesado_financiero)

            if (a.extension or '').lower().lstrip('.') != 'pdf':
                self.stdout.write(self.style.WARNING(
                    '   → SE DESCARTA aquí: la extensión no es "pdf".'))
                continue

            # ── ¿se puede abrir y leer? ──
            try:
                with a.archivo.open('rb') as fh:
                    crudo = fh.read()
                self.stdout.write('   bytes leídos       : %d' % len(crudo))
                if not crudo:
                    self.stdout.write(self.style.ERROR(
                        '   → SE CAE aquí: el archivo está vacío en disco.'))
                    continue
            except Exception as e:
                self.stdout.write(self.style.ERROR(
                    '   → SE CAE aquí: no se puede abrir el archivo. %s: %s'
                    % (type(e).__name__, e)))
                self.stdout.write('     ruta en el modelo: %r' % getattr(a.archivo, 'name', None))
                continue

            texto = _texto_pdf(a.archivo)
            self.stdout.write('   caracteres de texto: %d' % len(texto))
            if not texto.strip():
                self.stdout.write(self.style.ERROR(
                    '   → SE CAE aquí: pdfplumber no sacó texto. Suele ser un PDF '
                    'escaneado (imagen), que necesitaría OCR.'))
                continue
            if opts['texto']:
                self.stdout.write('   ── texto ──')
                for linea in texto.splitlines()[:40]:
                    self.stdout.write('     | %s' % linea)

            espo = es_po_de_cliente(a.nombre_original, texto)
            self.stdout.write('   ¿parece PO?        : %s' % ('SÍ' if espo else 'NO'))
            if not espo:
                self.stdout.write(self.style.ERROR(
                    '   → SE CAE aquí: ni el nombre ni el texto traen una pista de PO '
                    '(nombre tipo PO-123, "orden de compra" o "purchase order").'))
                continue

            monto = monto_de_po(texto)
            moneda = moneda_de_po(texto)
            self.stdout.write('   monto detectado    : %s %s' % (monto, moneda))
            if monto is None:
                self.stdout.write(self.style.ERROR(
                    '   → SE CAE aquí: es PO pero ningún importe convenció. '
                    'Corre otra vez con --texto y mándame el volcado.'))
                continue

            self.stdout.write(self.style.SUCCESS(
                '   → TODO BIEN: debería quedar como %s con monto %s'
                % (TIPO_PO_CLIENTE, monto)))

        # ── Estado de la oportunidad ──
        if opts['oportunidad']:
            from django.db.models import Sum
            opp = archivos[0].oportunidad
            agg = (ArchivoOportunidad.objects
                   .filter(oportunidad=opp, tipo_financiero=TIPO_PO_CLIENTE)
                   .exclude(monto_extraido__isnull=True)
                   .aggregate(t=Sum('monto_extraido')))
            self.stdout.write('')
            self.stdout.write('Oportunidad %s: monto actual = %s | suma de POs registradas = %s'
                              % (opp.id, opp.monto, agg['t']))

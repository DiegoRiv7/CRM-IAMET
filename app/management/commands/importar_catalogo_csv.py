# Importa el catálogo semilla a CatalogoCableado desde un CSV revisado
# por un humano (línea roja del plan: la AI no escribe sola en el catálogo).
#
# CSV esperado (headers): marca,parte,desc,precio_lista,costo,veces,fuente
# (el que genera el análisis de volumetrías reales — catalogo_candidato.csv)
#
# Uso:
#   python manage.py importar_catalogo_csv /ruta/catalogo.csv           # preview
#   python manage.py importar_catalogo_csv /ruta/catalogo.csv --aplicar # escribe

import csv
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError


def _inferir_tipo(desc):
    d = (desc or '').upper()
    reglas = [
        ('FIBRA', ['FIBRA', 'FIBER', 'OM3', 'OM4', 'LC ', ' SC ']),
        ('JACK', ['JACK']),
        ('PATCHCORD', ['PATCHCORD', 'PATCH CORD', 'CABLE DE PARCHEO']),
        ('FACEPLATE', ['FACEPLATE', 'FACE PLATE', 'PLACA DE PARED']),
        ('CHAROLA', ['CHAROLA', 'ESCALERILLA', 'CABLE TRAY', 'MALLA']),
        ('TUBERIA', ['TUBER', 'CONDUIT', 'TUBO ', 'STEEL 3/4', 'STEEL 1/2', 'MONITOR PVC', 'COPLE', 'CONECTOR STEEL']),
        ('SOPORTERIA', ['VARILLA', 'MORDAZA', 'TUERCA', 'ABRAZADERA', 'ANCLA', 'SUJETADOR', 'HEX NUT', 'FASTENER', 'CLIP']),
        ('CABLE', ['CABLE', 'UTP', 'CAT6', 'CAT5']),
        ('EQUIPO', ['UPS', 'SWITCH', 'NVR', 'CAMARA', 'CÁMARA', 'CAMERA', 'ACCESS POINT', 'ROUTER', 'PATCH PANEL', 'ORGANIZADOR']),
    ]
    for tipo, kws in reglas:
        if any(k in d for k in kws):
            return tipo
    return 'OTRO'


class Command(BaseCommand):
    help = 'Importa/actualiza CatalogoCableado desde un CSV revisado por humano.'

    def add_arguments(self, parser):
        parser.add_argument('csv_path', type=str)
        parser.add_argument('--aplicar', action='store_true',
                            help='Sin esta bandera solo muestra el preview.')
        parser.add_argument('--solo-con-precio', action='store_true',
                            help='Ignora filas con precio_lista 0 (default: se importan inactivas).')

    def handle(self, *args, **opts):
        from app.models import CatalogoCableado

        try:
            with open(opts['csv_path'], encoding='utf-8') as fh:
                filas = list(csv.DictReader(fh))
        except OSError as e:
            raise CommandError(f'No se pudo leer el CSV: {e}')

        nuevos = actualizados = saltados = 0
        for fila in filas:
            parte = (fila.get('parte') or '').strip()
            desc = (fila.get('desc') or '').strip()
            if not parte or not desc:
                saltados += 1
                continue
            try:
                precio = Decimal(str(fila.get('precio_lista') or '0'))
                costo = Decimal(str(fila.get('costo') or '0'))
            except InvalidOperation:
                saltados += 1
                continue
            if precio <= 0 and opts['solo_con_precio']:
                saltados += 1
                continue
            tipo = _inferir_tipo(desc)
            existente = CatalogoCableado.objects.filter(numero_parte__iexact=parte).first()
            accion = 'ACTUALIZA' if existente else 'NUEVO'
            # Sin precio → se importa inactivo: visible para completar, no cotizable.
            activo = precio > 0
            self.stdout.write(
                f"{accion:9} | {tipo:10} | {parte[:22]:22} | ${precio:<9} | "
                f"{'activo' if activo else 'INACTIVO':8} | {desc[:55]}")
            if not opts['aplicar']:
                continue
            if existente:
                # No pisar precios ya capturados a mano con ceros del CSV.
                if precio > 0:
                    existente.precio_unitario = precio
                if costo > 0:
                    existente.precio_proveedor = costo
                existente.descripcion = existente.descripcion or desc
                existente.marca = existente.marca or (fila.get('marca') or '').strip()
                existente.save()
                actualizados += 1
            else:
                CatalogoCableado.objects.create(
                    numero_parte=parte,
                    tipo_producto=tipo,
                    descripcion=desc,
                    marca=(fila.get('marca') or '').strip() or 'GENERICO',
                    precio_unitario=precio,
                    precio_proveedor=costo,
                    activo=activo,
                )
                nuevos += 1

        if opts['aplicar']:
            self.stdout.write(self.style.SUCCESS(
                f'Listo: {nuevos} nuevos, {actualizados} actualizados, {saltados} saltados.'))
        else:
            self.stdout.write(self.style.WARNING(
                f'PREVIEW ({len(filas)} filas, {saltados} se saltarían). '
                'Corre de nuevo con --aplicar para escribir.'))

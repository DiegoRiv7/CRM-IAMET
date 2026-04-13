"""
services_financiero.py — Análisis automático de PDFs del drive
para importar OCC y Facturas al módulo financiero del proyecto.

Cuando se sube un archivo al drive de una oportunidad:
1. Si el nombre empieza con "OCC" → es una Orden de Compra
2. Si el nombre empieza con "Factura" → es una Factura de Ingreso
3. Si es PDF, se parsea con pdfplumber para extraer el subtotal
4. Se crea automáticamente el registro financiero en el proyecto vinculado
"""

import re
import logging
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)


def analizar_archivo_drive(archivo_oportunidad):
    """
    Analiza un ArchivoOportunidad recién subido.
    Si es un OCC o Factura PDF, extrae el monto y crea el registro financiero.

    Retorna dict con { procesado: bool, tipo: str, monto: Decimal|None, error: str|None }
    """
    from .models import (
        ArchivoOportunidad, ProyectoIAMET, ProyectoOrdenCompra,
        ProyectoFacturaIngreso,
    )

    nombre = (archivo_oportunidad.nombre_original or '').strip()
    ext = (archivo_oportunidad.extension or '').lower()
    oportunidad = archivo_oportunidad.oportunidad

    # Ya procesado? No repetir
    if archivo_oportunidad.procesado_financiero:
        return {'procesado': False, 'tipo': '', 'monto': None, 'error': 'Ya procesado'}

    # Detectar tipo por nombre
    nombre_upper = nombre.upper()
    if nombre_upper.startswith('OCC'):
        tipo = 'oc'
    elif nombre_upper.startswith('FACTURA'):
        tipo = 'factura'
    else:
        return {'procesado': False, 'tipo': '', 'monto': None, 'error': None}

    # Buscar proyecto IAMET vinculado a esta oportunidad
    proyecto = ProyectoIAMET.objects.filter(oportunidad=oportunidad).first()
    if not proyecto:
        logger.info(f"[Financiero] Archivo '{nombre}' detectado como {tipo} pero la oportunidad {oportunidad.id} no tiene proyecto IAMET vinculado.")
        # Marcar como procesado para no reintentar, pero sin crear registro
        archivo_oportunidad.procesado_financiero = True
        archivo_oportunidad.tipo_financiero = tipo
        archivo_oportunidad.save(update_fields=['procesado_financiero', 'tipo_financiero'])
        return {'procesado': True, 'tipo': tipo, 'monto': None, 'error': 'Sin proyecto vinculado'}

    # Verificar que no exista ya un registro vinculado a este archivo
    if tipo == 'oc' and ProyectoOrdenCompra.objects.filter(archivo_drive=archivo_oportunidad).exists():
        archivo_oportunidad.procesado_financiero = True
        archivo_oportunidad.save(update_fields=['procesado_financiero'])
        return {'procesado': False, 'tipo': tipo, 'monto': None, 'error': 'Ya importado'}
    if tipo == 'factura' and ProyectoFacturaIngreso.objects.filter(archivo_drive=archivo_oportunidad).exists():
        archivo_oportunidad.procesado_financiero = True
        archivo_oportunidad.save(update_fields=['procesado_financiero'])
        return {'procesado': False, 'tipo': tipo, 'monto': None, 'error': 'Ya importado'}

    # Extraer monto del PDF
    monto = None
    if ext == 'pdf':
        try:
            monto = _extraer_monto_pdf(archivo_oportunidad.archivo)
        except Exception as exc:
            logger.warning(f"[Financiero] Error al parsear PDF '{nombre}': {exc}")

    # Crear registro financiero
    try:
        if tipo == 'oc':
            oc = ProyectoOrdenCompra(
                proyecto=proyecto,
                partida=None,  # Se puede vincular manualmente después
                numero_oc=_extraer_numero_oc(nombre),
                proveedor=_extraer_proveedor_de_nombre(nombre),
                cantidad=Decimal('1'),
                precio_unitario=monto or Decimal('0'),
                monto_total=monto or Decimal('0'),
                status='emitted',
                archivo_drive=archivo_oportunidad,
                notas=f'Importado automáticamente del drive. Archivo: {nombre}',
            )
            oc.save()
            logger.info(f"[Financiero] OC '{oc.numero_oc}' creada desde '{nombre}' con monto ${monto}")

        elif tipo == 'factura':
            from django.utils import timezone
            factura = ProyectoFacturaIngreso(
                proyecto=proyecto,
                numero_factura=_extraer_numero_factura(nombre),
                monto=monto or Decimal('0'),
                fecha_factura=timezone.localdate(),
                status='emitted',
                archivo_drive=archivo_oportunidad,
                notas=f'Importada automáticamente del drive. Archivo: {nombre}',
            )
            factura.save()
            logger.info(f"[Financiero] Factura '{factura.numero_factura}' creada desde '{nombre}' con monto ${monto}")

    except Exception as exc:
        logger.exception(f"[Financiero] Error al crear registro desde '{nombre}': {exc}")
        return {'procesado': False, 'tipo': tipo, 'monto': monto, 'error': str(exc)}

    # Marcar archivo como procesado
    archivo_oportunidad.procesado_financiero = True
    archivo_oportunidad.tipo_financiero = tipo
    archivo_oportunidad.monto_extraido = monto
    archivo_oportunidad.save(update_fields=['procesado_financiero', 'tipo_financiero', 'monto_extraido'])

    return {'procesado': True, 'tipo': tipo, 'monto': monto, 'error': None}


def _extraer_monto_pdf(archivo_field):
    """
    Abre un PDF con pdfplumber y busca el subtotal.
    Busca patrones como:
      - "SUBTOTAL" seguido de un monto
      - "SUB TOTAL" seguido de un monto
      - "TOTAL" seguido de un monto (fallback)
    Retorna Decimal o None.
    """
    try:
        import pdfplumber
    except ImportError:
        logger.warning("[Financiero] pdfplumber no está instalado")
        return None

    # Patrones para encontrar montos (variantes comunes en facturas MX)
    # Busca: SUBTOTAL / SUB TOTAL / SUB-TOTAL seguido de $ y/o número
    monto_pattern = re.compile(
        r'(?:SUB\s*-?\s*TOTAL|SUBTOTAL)\s*:?\s*\$?\s*([\d,]+\.?\d*)',
        re.IGNORECASE
    )
    # Fallback: buscar "TOTAL" (sin "SUB") — usar solo si no se encontró subtotal
    total_pattern = re.compile(
        r'\bTOTAL\b\s*:?\s*\$?\s*([\d,]+\.?\d*)',
        re.IGNORECASE
    )

    subtotal = None
    total_fallback = None

    try:
        with archivo_field.open('rb') as f:
            with pdfplumber.open(f) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ''

                    # Buscar subtotal
                    for m in monto_pattern.finditer(text):
                        val = _parse_monto_str(m.group(1))
                        if val and val > 0:
                            if subtotal is None or val > subtotal:
                                subtotal = val

                    # Buscar total (fallback)
                    if subtotal is None:
                        for m in total_pattern.finditer(text):
                            val = _parse_monto_str(m.group(1))
                            if val and val > 0:
                                if total_fallback is None or val > total_fallback:
                                    total_fallback = val
    except Exception as exc:
        logger.warning(f"[Financiero] Error leyendo PDF: {exc}")
        return None

    return subtotal or total_fallback


def _parse_monto_str(s):
    """Convierte '12,345.67' o '12345.67' a Decimal."""
    try:
        cleaned = s.replace(',', '').strip()
        if not cleaned:
            return None
        val = Decimal(cleaned)
        return val if val > 0 else None
    except (InvalidOperation, ValueError):
        return None


def _extraer_numero_oc(nombre):
    """Extrae el número de OC del nombre del archivo.
    Ej: 'OCC 12345 - Proveedor.pdf' → 'OCC 12345'
    """
    # Quitar extensión
    base = re.sub(r'\.\w+$', '', nombre).strip()
    # Buscar patrón OCC seguido de número
    m = re.match(r'(OCC\s*[\w\-]+)', base, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Fallback: usar el nombre completo sin extensión (truncado)
    return base[:80]


def _extraer_proveedor_de_nombre(nombre):
    """Intenta extraer el proveedor del nombre del archivo.
    Ej: 'OCC 12345 - PANDUIT.pdf' → 'PANDUIT'
    """
    base = re.sub(r'\.\w+$', '', nombre).strip()
    # Si hay " - " o " _ ", tomar lo que viene después del OCC
    parts = re.split(r'\s*[-_]\s*', base, maxsplit=1)
    if len(parts) > 1:
        return parts[1].strip()[:100]
    return 'Proveedor (pendiente)'


def _extraer_numero_factura(nombre):
    """Extrae el número de factura del nombre del archivo.
    Ej: 'Factura 1234 - Cliente.pdf' → 'Factura 1234'
    """
    base = re.sub(r'\.\w+$', '', nombre).strip()
    m = re.match(r'(Factura\s*[\w\-]+)', base, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return base[:80]


def procesar_archivos_pendientes_oportunidad(oportunidad_id):
    """
    Escanea todos los archivos del drive de una oportunidad que NO hayan
    sido procesados aún y los analiza. Útil para procesar archivos que se
    subieron antes de que el auto-import existiera.

    Retorna dict con { total, procesados, errores }
    """
    from .models import ArchivoOportunidad

    archivos = ArchivoOportunidad.objects.filter(
        oportunidad_id=oportunidad_id,
        procesado_financiero=False,
    )

    total = archivos.count()
    procesados = 0
    errores = 0

    for archivo in archivos:
        result = analizar_archivo_drive(archivo)
        if result.get('procesado'):
            procesados += 1
        elif result.get('error'):
            errores += 1

    return {'total': total, 'procesados': procesados, 'errores': errores}

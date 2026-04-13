"""
services_financiero.py — Análisis automático de PDFs del drive
para importar OCC y Facturas al módulo financiero del proyecto.

Cuando se sube un archivo al drive de una oportunidad:
1. Si el nombre empieza con "OCC" → es una Orden de Compra
2. Si el nombre empieza con "Factura" → es una Factura de Ingreso
3. Si es PDF, se parsea con pdfplumber para extraer:
   - Subtotal / Total (monto)
   - Proveedor (nombre de la empresa, sin RFC ni teléfono)
   - Fecha del documento
   - Número de OC/Factura
4. Se crea automáticamente el registro financiero en el proyecto vinculado
"""

import re
import logging
from decimal import Decimal, InvalidOperation
from datetime import datetime

logger = logging.getLogger(__name__)


def analizar_archivo_drive(archivo_oportunidad):
    """
    Analiza un ArchivoOportunidad recién subido.
    Si es un OCC o Factura PDF, extrae datos y crea el registro financiero.

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

    # Extraer datos del PDF
    pdf_data = {}
    if ext == 'pdf':
        try:
            pdf_data = _extraer_datos_pdf(archivo_oportunidad.archivo)
        except Exception as exc:
            logger.warning(f"[Financiero] Error al parsear PDF '{nombre}': {exc}")

    monto = pdf_data.get('monto')
    proveedor = pdf_data.get('proveedor') or _extraer_proveedor_de_nombre(nombre)
    fecha_doc = pdf_data.get('fecha')
    numero_doc = pdf_data.get('numero_oc') or _extraer_numero_oc(nombre)

    # Crear registro financiero
    try:
        if tipo == 'oc':
            oc = ProyectoOrdenCompra(
                proyecto=proyecto,
                partida=None,
                numero_oc=numero_doc,
                proveedor=_acortar_nombre(proveedor),
                cantidad=Decimal('1'),
                precio_unitario=monto or Decimal('0'),
                monto_total=monto or Decimal('0'),
                status='emitted',
                fecha_emision=fecha_doc,
                archivo_drive=archivo_oportunidad,
                notas=f'Importado automáticamente del drive. Archivo: {nombre}',
            )
            oc.save()
            logger.info(f"[Financiero] OC '{oc.numero_oc}' creada: proveedor={proveedor}, monto=${monto}, fecha={fecha_doc}")

        elif tipo == 'factura':
            from django.utils import timezone
            factura = ProyectoFacturaIngreso(
                proyecto=proyecto,
                numero_factura=_extraer_numero_factura(nombre) if not pdf_data.get('numero_factura') else pdf_data['numero_factura'],
                monto=monto or Decimal('0'),
                fecha_factura=fecha_doc or timezone.localdate(),
                status='emitted',
                archivo_drive=archivo_oportunidad,
                notas=f'Importada automáticamente del drive. Archivo: {nombre}',
            )
            factura.save()
            logger.info(f"[Financiero] Factura '{factura.numero_factura}' creada: monto=${monto}, fecha={fecha_doc}")

    except Exception as exc:
        logger.exception(f"[Financiero] Error al crear registro desde '{nombre}': {exc}")
        return {'procesado': False, 'tipo': tipo, 'monto': monto, 'error': str(exc)}

    # Marcar archivo como procesado
    archivo_oportunidad.procesado_financiero = True
    archivo_oportunidad.tipo_financiero = tipo
    archivo_oportunidad.monto_extraido = monto
    archivo_oportunidad.save(update_fields=['procesado_financiero', 'tipo_financiero', 'monto_extraido'])

    return {'procesado': True, 'tipo': tipo, 'monto': monto, 'error': None}


# ═══════════════════════════════════════════════════════════════
#  EXTRACCIÓN DE DATOS DEL PDF
# ═══════════════════════════════════════════════════════════════

def _extraer_datos_pdf(archivo_field):
    """
    Abre un PDF con pdfplumber y extrae:
    - monto (subtotal/total)
    - proveedor (nombre de la empresa)
    - fecha del documento
    - numero de OC/factura

    Retorna dict con las claves encontradas.
    """
    try:
        import pdfplumber
    except ImportError:
        logger.warning("[Financiero] pdfplumber no está instalado")
        return {}

    result = {
        'monto': None,
        'proveedor': None,
        'fecha': None,
        'numero_oc': None,
        'numero_factura': None,
    }

    # Patrones
    subtotal_re = re.compile(
        r'(?:SUB\s*-?\s*TOTAL|SUBTOTAL)\s*:?\s*\$?\s*([\d,]+\.?\d*)',
        re.IGNORECASE
    )
    total_re = re.compile(
        r'\bTOTAL\b\s*:?\s*\$?\s*([\d,]+\.?\d*)',
        re.IGNORECASE
    )
    # "Fecha Documento: 24-03-2026" o "Fecha: 24/03/2026" o "Fecha Documento - 24-03-2026"
    fecha_re = re.compile(
        r'Fecha\s*(?:Documento)?\s*[:.\-]\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})',
        re.IGNORECASE
    )
    # "Orden de Compra - TIJ13781" o "OCC-TIJ13781" o "Orden de Compra: TIJ13781"
    oc_re = re.compile(
        r'(?:Orden\s+de\s+Compra|OCC)\s*[-:]\s*([\w\-]+)',
        re.IGNORECASE
    )
    # RFC pattern para limpiar del proveedor
    rfc_re = re.compile(r'\bRFC\s*:\s*\S+', re.IGNORECASE)
    tel_re = re.compile(r'\bTel\b\.?\s*:?\s*[\d\s\-\(\)]*', re.IGNORECASE)

    all_text = ''

    try:
        with archivo_field.open('rb') as f:
            with pdfplumber.open(f) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ''
                    all_text += text + '\n'
    except Exception as exc:
        logger.warning(f"[Financiero] Error leyendo PDF: {exc}")
        return result

    # ── Extraer monto (subtotal preferido, total como fallback) ──
    subtotal = None
    total_fallback = None
    for m in subtotal_re.finditer(all_text):
        val = _parse_monto_str(m.group(1))
        if val and val > 0:
            if subtotal is None or val > subtotal:
                subtotal = val
    if subtotal is None:
        for m in total_re.finditer(all_text):
            val = _parse_monto_str(m.group(1))
            if val and val > 0:
                if total_fallback is None or val > total_fallback:
                    total_fallback = val
    result['monto'] = subtotal or total_fallback

    # ── Extraer fecha ──
    m_fecha = fecha_re.search(all_text)
    if m_fecha:
        result['fecha'] = _parse_fecha(m_fecha.group(1))

    # ── Extraer número de OC ──
    m_oc = oc_re.search(all_text)
    if m_oc:
        result['numero_oc'] = m_oc.group(1).strip()

    # ── Extraer proveedor ──
    # El proveedor generalmente aparece en las primeras líneas del PDF
    # después del encabezado de la empresa emisora. Buscamos la sección
    # "Proveedor" seguida del nombre, o la primera línea larga en mayúsculas
    # que parezca un nombre de empresa.
    result['proveedor'] = _extraer_proveedor_pdf(all_text)

    return result


def _extraer_proveedor_pdf(text):
    """
    Extrae el nombre del proveedor del texto del PDF de OCC.

    En el formato de IAMET, el layout del PDF tiene 2 columnas pero
    pdfplumber lo extrae como texto lineal. La estructura típica es:

        Proveedor Elaboradopor: ...
        Aprobadopor: ...
        NOMBRE DE LA EMPRESA
        RFC:XXX Tel.: ...           Estado: Aprobada
        DIRECCION No.XXX
        ...
        Cód Cantidad Unidad ...

    El nombre del proveedor es la primera línea en mayúsculas que aparece
    DESPUÉS de la línea que contiene "Proveedor" y ANTES de "Cód",
    excluyendo líneas que empiezan con RFC, Tel, Col, BLVD, direcciones, etc.
    """
    lines = text.split('\n')

    # Buscar el rango de líneas entre "Proveedor" y "Cód"
    start_idx = None
    end_idx = len(lines)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if 'proveedor' in stripped.lower() and start_idx is None:
            start_idx = i + 1  # empezar desde la siguiente
        if re.match(r'^C[oó]d\b', stripped, re.IGNORECASE) and start_idx is not None:
            end_idx = i
            break

    if start_idx is None:
        return None

    # Patrones que NO son el nombre del proveedor
    skip_patterns = [
        r'^RFC\s*:',
        r'^Tel\b',
        r'^BLVD\b',
        r'^AV\b',
        r'^CALLE\b',
        r'^Col\b',
        r'^C\.?\s*P\b',
        r'^\d{5}',           # CP
        r'^Elaborado',
        r'^Aprobado',
        r'^Estado\s*:',
        r'^Almac[eé]n',
        r',\s*(Tijuana|México|Mexico|Monterrey|Guadalajara|Ensenada)',
        r'^No\.',
    ]
    skip_re = re.compile('|'.join(skip_patterns), re.IGNORECASE)

    # Buscar la primera línea "limpia" que parezca nombre de empresa
    for i in range(start_idx, min(end_idx, start_idx + 8)):
        line = lines[i].strip()
        if not line or len(line) < 4:
            continue
        if skip_re.search(line):
            continue
        # Limpiar: quitar "Elaboradopor:..." si viene pegado
        line = re.sub(r'Elaborado\s*por\s*:.*', '', line, flags=re.IGNORECASE).strip()
        line = re.sub(r'Aprobado\s*por\s*:.*', '', line, flags=re.IGNORECASE).strip()
        if not line or len(line) < 4:
            continue
        nombre = _limpiar_nombre_proveedor(line)
        if nombre and len(nombre) > 3:
            return _acortar_nombre(nombre)

    return None


def _limpiar_nombre_proveedor(nombre):
    """Quita RFC, teléfono y otros datos del nombre del proveedor."""
    if not nombre:
        return ''
    # Quitar RFC
    nombre = re.sub(r'\bRFC\s*:?\s*\S+', '', nombre, flags=re.IGNORECASE).strip()
    # Quitar teléfono
    nombre = re.sub(r'\bTel\b\.?\s*:?\s*[\d\s\-\(\)]+', '', nombre, flags=re.IGNORECASE).strip()
    # Quitar email
    nombre = re.sub(r'\S+@\S+', '', nombre).strip()
    # Quitar caracteres sueltos al final
    nombre = nombre.rstrip('.,;:-_ ')
    return nombre


def _acortar_nombre(nombre, max_len=50):
    """
    Acorta nombres de empresa largos de forma inteligente.
    Ej: "PRO RENTAS, VENTAS Y SERVICIOS PARA LA CONSTRUCCION S.A. DE C.V."
      → "Pro Rentas, Ventas y Servicios"
    """
    if not nombre or len(nombre) <= max_len:
        return nombre or ''

    # Quitar sufijos legales comunes
    sufijos = [
        r'\s*,?\s*S\.?\s*A\.?\s*(DE\s*C\.?\s*V\.?)?',
        r'\s*,?\s*S\.?\s*DE\s*R\.?\s*L\.?\s*(DE\s*C\.?\s*V\.?)?',
        r'\s*,?\s*S\.?\s*C\.?',
        r'\s*,?\s*S\.?\s*A\.?\s*P\.?\s*I\.?',
    ]
    cleaned = nombre
    for suf in sufijos:
        cleaned = re.sub(suf + r'\s*$', '', cleaned, flags=re.IGNORECASE).strip()

    # Si sigue siendo largo, truncar en la última palabra completa
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rsplit(' ', 1)[0] + '...'

    return cleaned


# ═══════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════

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


def _parse_fecha(fecha_str):
    """Convierte '24-03-2026' o '24/03/2026' a date object."""
    fecha_str = fecha_str.strip().replace('/', '-')
    for fmt in ('%d-%m-%Y', '%d-%m-%y', '%Y-%m-%d'):
        try:
            return datetime.strptime(fecha_str, fmt).date()
        except ValueError:
            continue
    return None


def _extraer_numero_oc(nombre):
    """Extrae el número de OC del nombre del archivo.
    Ej: 'OCC TIJ13781.pdf' → 'OCC-TIJ13781'
    """
    base = re.sub(r'\.\w+$', '', nombre).strip()
    m = re.match(r'(OCC\s*[-_]?\s*[\w\-]+)', base, re.IGNORECASE)
    if m:
        return m.group(1).strip().replace(' ', '-')
    return base[:80]


def _extraer_proveedor_de_nombre(nombre):
    """Fallback: intenta extraer el proveedor del nombre del archivo."""
    base = re.sub(r'\.\w+$', '', nombre).strip()
    parts = re.split(r'\s*[-_]\s*', base, maxsplit=1)
    if len(parts) > 1:
        return _acortar_nombre(parts[1].strip())
    return 'Proveedor (pendiente)'


def _extraer_numero_factura(nombre):
    """Extrae el número de factura del nombre del archivo."""
    base = re.sub(r'\.\w+$', '', nombre).strip()
    m = re.match(r'(Factura\s*[\w\-]+)', base, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return base[:80]


def procesar_archivos_pendientes_oportunidad(oportunidad_id):
    """
    Escanea todos los archivos del drive de una oportunidad que NO hayan
    sido procesados aún y los analiza.
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

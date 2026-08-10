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

import io
import re
import logging
from decimal import Decimal, InvalidOperation
from datetime import datetime

logger = logging.getLogger(__name__)


# Folio IAMET tipo "IAMET-2026-0358" / "IAMET 2026 0358" / "IAMET_2026_0358".
# Sin \b final: el '_' cuenta como carácter de palabra y rompería el boundary.
_FACTURA_FOLIO_RE = re.compile(r'\bIAMET[\s\-_]*\d{2,4}[\s\-_]*\d+', re.IGNORECASE)


def _detectar_tipo_financiero(nombre):
    """
    Clasifica un archivo del drive por su NOMBRE.
    Retorna 'oc', 'factura' o '' (no aplica).

    Las facturas llegan en varios formatos porque provienen de 2 empresas distintas:
      - Nombre que empieza con 'Factura'   (ej. 'Factura IAMET-2026-0358.pdf')
      - Folio IAMET                        (ej. 'IAMET-2026-0358.pdf', 'IAMET 2026 0358.pdf')
    Las órdenes de compra (BAJANET e IAMET) llegan con nombres flexibles:
      'OCC-POIAM1637.pdf', 'OC-123.pdf', 'OC 123.pdf', 'Orden de compra TIJ....pdf'.
    Si el nombre no coincide, _detectar_tipo_por_contenido lo cubre por el PDF.
    """
    n = (nombre or '').strip().upper()
    if not n:
        return ''
    if n.startswith('OCC') or re.match(r'OC[\s\-_]', n) or 'ORDEN DE COMPRA' in n:
        return 'oc'
    if n.startswith('FACTURA'):
        return 'factura'
    if _FACTURA_FOLIO_RE.search(n):
        return 'factura'
    return ''


def _detectar_tipo_por_contenido(text):
    """
    Clasifica un PDF por su CONTENIDO cuando el nombre del archivo no basta.
    Los 2 formatos de OC (BAJANET e IAMET) comparten el título 'Orden de compra',
    aunque el número (ej. 'TIJ13933') no lleve prefijo 'OCC' en el nombre.
    Retorna 'oc', 'factura' o ''.
    """
    if not text:
        return ''
    t = text.upper()
    if 'ORDEN DE COMPRA' in t:
        return 'oc'
    if 'FACTURA' in t or _FACTURA_FOLIO_RE.search(t):
        return 'factura'
    return ''


def _vincular_pdf_a_factura(factura, archivo_oportunidad, ext):
    """
    Enlaza un PDF del drive a una factura de ingreso YA existente que no tenía
    documento (para que el folio sea clickeable) y, si aún no se había evaluado,
    extrae monto + moneda del PDF y recalcula el monto en pesos.
    """
    from decimal import Decimal
    factura.archivo_drive = archivo_oportunidad
    if (ext or '').lower() == 'pdf' and factura.monto_original is None:
        try:
            pdf_data = _extraer_datos_pdf(archivo_oportunidad.archivo)
            moneda = pdf_data.get('moneda') or 'MXN'
            monto_orig = pdf_data.get('monto') or factura.monto or Decimal('0')
            monto_mxn, tc_usado = _convertir_a_mxn(monto_orig, moneda, pdf_data.get('tipo_cambio'))
            factura.moneda = moneda
            factura.monto_original = monto_orig
            factura.tipo_cambio = tc_usado
            factura.monto = monto_mxn or factura.monto
        except Exception as exc:
            logger.warning(f"[Financiero] Vincular PDF a factura {factura.id}: {exc}")
    factura.save()


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

    # Extraer datos del PDF una sola vez (se reutiliza para detección por
    # contenido, dedup por número y creación del registro).
    pdf_data = {}
    if ext == 'pdf':
        try:
            pdf_data = _extraer_datos_pdf(archivo_oportunidad.archivo)
        except Exception as exc:
            logger.warning(f"[Financiero] Error al parsear PDF '{nombre}': {exc}")

    # Detectar tipo: primero por nombre; si no basta, por contenido del PDF.
    # (Los 2 formatos de OC de BAJANET/IAMET no siempre traen 'OCC' en el nombre.)
    tipo = _detectar_tipo_financiero(nombre)
    if not tipo:
        tipo = _detectar_tipo_por_contenido(pdf_data.get('_texto', ''))
    if not tipo:
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

    # Verificar duplicado por número de OC/Factura. Preferimos el número extraído
    # del PDF (fiable para los formatos que no traen 'OCC'/folio en el nombre).
    if tipo == 'oc':
        numero_doc_check = pdf_data.get('numero_oc') or _extraer_numero_oc(nombre)
    else:
        numero_doc_check = pdf_data.get('numero_factura') or _extraer_numero_factura(nombre)
    if tipo == 'oc' and ProyectoOrdenCompra.objects.filter(proyecto=proyecto, numero_oc=numero_doc_check).exists():
        archivo_oportunidad.procesado_financiero = True
        archivo_oportunidad.tipo_financiero = tipo
        archivo_oportunidad.save(update_fields=['procesado_financiero', 'tipo_financiero'])
        logger.info(f"[Financiero] Duplicado detectado: OC '{numero_doc_check}' ya existe en proyecto {proyecto.id}")
        return {'procesado': False, 'tipo': tipo, 'monto': None, 'error': f'Duplicado: OC {numero_doc_check} ya existe'}
    if tipo == 'factura':
        existente = ProyectoFacturaIngreso.objects.filter(proyecto=proyecto, numero_factura=numero_doc_check).first()
        if existente:
            archivo_oportunidad.procesado_financiero = True
            archivo_oportunidad.tipo_financiero = tipo
            archivo_oportunidad.save(update_fields=['procesado_financiero', 'tipo_financiero'])
            # Si la factura ya existía pero SIN documento (creada a mano), enlazamos
            # este PDF del drive para que el folio se pueda abrir y re-evaluamos su monto/moneda.
            if not existente.archivo_drive_id:
                _vincular_pdf_a_factura(existente, archivo_oportunidad, ext)
                logger.info(f"[Financiero] Factura existente '{numero_doc_check}' vinculada al PDF del drive")
                return {'procesado': True, 'tipo': tipo, 'monto': existente.monto, 'error': None}
            logger.info(f"[Financiero] Duplicado detectado: Factura '{numero_doc_check}' ya existe en proyecto {proyecto.id}")
            return {'procesado': False, 'tipo': tipo, 'monto': None, 'error': f'Duplicado: Factura {numero_doc_check} ya existe'}

    monto = pdf_data.get('monto')
    proveedor = pdf_data.get('proveedor') or _extraer_proveedor_de_nombre(nombre)
    fecha_doc = pdf_data.get('fecha')
    numero_doc = pdf_data.get('numero_oc') or _extraer_numero_oc(nombre)

    # Crear registro financiero
    try:
        if tipo == 'oc':
            moneda = pdf_data.get('moneda') or 'MXN'
            monto_original = monto  # lo extraído está en la moneda original del PDF
            monto_mxn, tc_usado = _convertir_a_mxn(monto_original, moneda, pdf_data.get('tipo_cambio'))
            oc = ProyectoOrdenCompra(
                proyecto=proyecto,
                partida=None,
                numero_oc=numero_doc,
                proveedor=_acortar_nombre(proveedor),
                cantidad=Decimal('1'),
                precio_unitario=monto_mxn or Decimal('0'),
                monto_total=monto_mxn or Decimal('0'),
                moneda=moneda,
                monto_original=monto_original,
                tipo_cambio=tc_usado,
                status='emitted',
                fecha_emision=fecha_doc,
                archivo_drive=archivo_oportunidad,
                notas=f'Importado automáticamente del drive. Archivo: {nombre}',
            )
            oc.save()
            logger.info(f"[Financiero] OC '{oc.numero_oc}' creada: {moneda} ${monto_original} → MXN ${monto_mxn} (TC {tc_usado}), fecha={fecha_doc}")

        elif tipo == 'factura':
            from django.utils import timezone
            moneda = pdf_data.get('moneda') or 'MXN'
            monto_original = monto  # lo extraído está en la moneda original del PDF
            monto_mxn, tc_usado = _convertir_a_mxn(monto_original, moneda, pdf_data.get('tipo_cambio'))
            factura = ProyectoFacturaIngreso(
                proyecto=proyecto,
                numero_factura=_extraer_numero_factura(nombre) if not pdf_data.get('numero_factura') else pdf_data['numero_factura'],
                monto=monto_mxn or Decimal('0'),
                moneda=moneda,
                monto_original=monto_original,
                tipo_cambio=tc_usado,
                fecha_factura=fecha_doc or timezone.localdate(),
                status='emitted',
                archivo_drive=archivo_oportunidad,
                notas=f'Importada automáticamente del drive. Archivo: {nombre}',
            )
            factura.save()
            logger.info(f"[Financiero] Factura '{factura.numero_factura}' creada: {moneda} ${monto_original} → MXN ${monto_mxn} (TC {tc_usado}), fecha={fecha_doc}")

    except Exception as exc:
        logger.exception(f"[Financiero] Error al crear registro desde '{nombre}': {exc}")
        return {'procesado': False, 'tipo': tipo, 'monto': monto, 'error': str(exc)}

    # Marcar archivo como procesado
    archivo_oportunidad.procesado_financiero = True
    archivo_oportunidad.tipo_financiero = tipo
    archivo_oportunidad.monto_extraido = monto
    archivo_oportunidad.save(update_fields=['procesado_financiero', 'tipo_financiero', 'monto_extraido'])

    return {'procesado': True, 'tipo': tipo, 'monto': monto, 'error': None}


def analizar_archivo_proyecto(archivo_proyecto):
    """
    Analiza un ArchivoProyecto recién subido (desde el drive de un proyecto).
    Busca el ProyectoIAMET vinculado a través de Proyecto → OportunidadProyecto → TodoItem.
    Si es un OCC o Factura PDF, extrae datos y crea el registro financiero.

    Retorna dict con { procesado: bool, tipo: str, monto: Decimal|None, error: str|None }
    """
    from .models import (
        OportunidadProyecto, ProyectoIAMET, ProyectoOrdenCompra,
        ProyectoFacturaIngreso,
    )

    nombre = (archivo_proyecto.nombre_original or '').strip()
    ext = (archivo_proyecto.extension or '').lower()
    proyecto_obj = archivo_proyecto.proyecto  # Proyecto (Bitrix)

    # Extraer datos del PDF una sola vez (detección por contenido, dedup y creación).
    pdf_data = {}
    if ext == 'pdf':
        try:
            pdf_data = _extraer_datos_pdf(archivo_proyecto.archivo)
        except Exception as exc:
            logger.warning(f"[Financiero-Proyecto] Error al parsear PDF '{nombre}': {exc}")

    # Detectar tipo: por nombre y, si no basta, por contenido del PDF
    # (los 2 formatos de OC de BAJANET/IAMET no siempre traen 'OCC' en el nombre).
    tipo = _detectar_tipo_financiero(nombre)
    if not tipo:
        tipo = _detectar_tipo_por_contenido(pdf_data.get('_texto', ''))
    if not tipo:
        return {'procesado': False, 'tipo': '', 'monto': None, 'error': None}

    # Buscar oportunidad vinculada al Proyecto (vía OportunidadProyecto)
    opp_proy = OportunidadProyecto.objects.filter(
        bitrix_project_id=str(proyecto_obj.bitrix_group_id)
    ).first()
    oportunidad = opp_proy.oportunidad if opp_proy else None

    # Buscar ProyectoIAMET vinculado
    proyecto_iamet = None
    if oportunidad:
        proyecto_iamet = ProyectoIAMET.objects.filter(oportunidad=oportunidad).first()

    if not proyecto_iamet:
        logger.info(f"[Financiero-Proyecto] Archivo '{nombre}' detectado como {tipo} pero no se encontró ProyectoIAMET vinculado al proyecto {proyecto_obj.id}.")
        return {'procesado': False, 'tipo': tipo, 'monto': None, 'error': 'Sin proyecto IAMET vinculado'}

    # Verificar duplicado por número de OC/Factura (preferimos el número del PDF)
    if tipo == 'oc':
        numero_doc_check = pdf_data.get('numero_oc') or _extraer_numero_oc(nombre)
    else:
        numero_doc_check = pdf_data.get('numero_factura') or _extraer_numero_factura(nombre)
    if tipo == 'oc' and ProyectoOrdenCompra.objects.filter(proyecto=proyecto_iamet, numero_oc=numero_doc_check).exists():
        logger.info(f"[Financiero-Proyecto] Duplicado detectado: OC '{numero_doc_check}' ya existe en proyecto {proyecto_iamet.id}")
        return {'procesado': False, 'tipo': tipo, 'monto': None, 'error': f'Duplicado: OC {numero_doc_check} ya existe'}
    if tipo == 'factura' and ProyectoFacturaIngreso.objects.filter(proyecto=proyecto_iamet, numero_factura=numero_doc_check).exists():
        logger.info(f"[Financiero-Proyecto] Duplicado detectado: Factura '{numero_doc_check}' ya existe en proyecto {proyecto_iamet.id}")
        return {'procesado': False, 'tipo': tipo, 'monto': None, 'error': f'Duplicado: Factura {numero_doc_check} ya existe'}

    monto = pdf_data.get('monto')
    proveedor = pdf_data.get('proveedor') or _extraer_proveedor_de_nombre(nombre)
    fecha_doc = pdf_data.get('fecha')
    numero_doc = pdf_data.get('numero_oc') or _extraer_numero_oc(nombre)

    # Crear registro financiero
    try:
        if tipo == 'oc':
            moneda = pdf_data.get('moneda') or 'MXN'
            monto_original = monto  # lo extraído está en la moneda original del PDF
            monto_mxn, tc_usado = _convertir_a_mxn(monto_original, moneda, pdf_data.get('tipo_cambio'))
            oc = ProyectoOrdenCompra(
                proyecto=proyecto_iamet,
                partida=None,
                numero_oc=numero_doc,
                proveedor=_acortar_nombre(proveedor),
                cantidad=Decimal('1'),
                precio_unitario=monto_mxn or Decimal('0'),
                monto_total=monto_mxn or Decimal('0'),
                moneda=moneda,
                monto_original=monto_original,
                tipo_cambio=tc_usado,
                status='emitted',
                fecha_emision=fecha_doc,
                notas=f'Importado automáticamente del drive del proyecto. Archivo: {nombre}',
            )
            oc.save()
            logger.info(f"[Financiero-Proyecto] OC '{oc.numero_oc}' creada: {moneda} ${monto_original} → MXN ${monto_mxn} (TC {tc_usado}), fecha={fecha_doc}")

        elif tipo == 'factura':
            from django.utils import timezone
            moneda = pdf_data.get('moneda') or 'MXN'
            monto_original = monto  # lo extraído está en la moneda original del PDF
            monto_mxn, tc_usado = _convertir_a_mxn(monto_original, moneda, pdf_data.get('tipo_cambio'))
            factura = ProyectoFacturaIngreso(
                proyecto=proyecto_iamet,
                numero_factura=_extraer_numero_factura(nombre) if not pdf_data.get('numero_factura') else pdf_data['numero_factura'],
                monto=monto_mxn or Decimal('0'),
                moneda=moneda,
                monto_original=monto_original,
                tipo_cambio=tc_usado,
                fecha_factura=fecha_doc or timezone.localdate(),
                status='emitted',
                notas=f'Importada automáticamente del drive del proyecto. Archivo: {nombre}',
            )
            factura.save()
            logger.info(f"[Financiero-Proyecto] Factura '{factura.numero_factura}' creada: {moneda} ${monto_original} → MXN ${monto_mxn} (TC {tc_usado}), fecha={fecha_doc}")

    except Exception as exc:
        logger.exception(f"[Financiero-Proyecto] Error al crear registro desde '{nombre}': {exc}")
        return {'procesado': False, 'tipo': tipo, 'monto': monto, 'error': str(exc)}

    return {'procesado': True, 'tipo': tipo, 'monto': monto, 'error': None}


# ═══════════════════════════════════════════════════════════════
#  EXTRACCIÓN DE DATOS DEL PDF
# ═══════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════
# PO DEL CLIENTE → MONTO DE LA OPORTUNIDAD
# ══════════════════════════════════════════════════════════════════════
# OJO CON LA PALABRA "OC": en este módulo tipo_financiero='oc' significa la
# orden que NOSOTROS le emitimos a un proveedor, y alimenta el gasto del
# proyecto. La PO del cliente es lo contrario —es lo que nos van a comprar—,
# así que lleva su propio tipo: 'po_cliente'.

#: Marca del archivo cuando resulta ser una PO del cliente.
TIPO_PO_CLIENTE = 'po_cliente'

#: Pistas de que un PDF es una PO del cliente y no otra cosa.
_PO_PISTAS_NOMBRE = re.compile(r'\bP\.?\s?O\.?[-_ #]?\s?\d|orden\s*de\s*compra|purchase\s*order', re.I)
_PO_PISTAS_TEXTO = re.compile(r'purchase\s+order|orden\s+de\s+compra|p\.\s?o\.\s*(?:no|num|#)', re.I)


def _texto_pdf(archivo_field, max_paginas=6):
    """Texto plano de un PDF ya guardado. '' si no se puede leer."""
    try:
        import pdfplumber
        with archivo_field.open('rb') as fh:
            datos = fh.read()
        partes = []
        with pdfplumber.open(io.BytesIO(datos)) as pdf:
            for pagina in pdf.pages[:max_paginas]:
                partes.append(pagina.extract_text() or '')
        return '\n'.join(partes)
    except Exception as e:
        logger.warning('PO: no se pudo leer el PDF %s: %s', getattr(archivo_field, 'name', '?'), e)
        return ''


def es_po_de_cliente(nombre, texto):
    """¿Este PDF es una orden de compra que nos manda el cliente?

    Se exige una pista explícita —en el nombre o en el cuerpo— para no marcar
    como PO cualquier PDF con un número grande. Precisión sobre cobertura: es
    peor inflar el monto de una oportunidad que dejar una PO sin detectar.
    """
    nombre = nombre or ''
    texto = texto or ''
    if _PO_PISTAS_NOMBRE.search(nombre):
        return True
    return bool(_PO_PISTAS_TEXTO.search(texto))


def analizar_po_cliente(archivo):
    """Si el archivo es una PO del cliente, le saca el monto y lo deja guardado.

    Devuelve el monto (Decimal) o None. NO recalcula la oportunidad: de eso se
    encarga recalcular_monto_por_po, para poder subir varios archivos y sumar
    una sola vez al final.
    """
    from decimal import Decimal as _D

    if (archivo.extension or '').lower().lstrip('.') != 'pdf':
        return None

    texto = _texto_pdf(archivo.archivo)
    if not es_po_de_cliente(archivo.nombre_original, texto):
        return None

    # ── El monto sale del SUBTOTAL, no del total ──
    # El monto de la oportunidad siempre ha sido sin IVA (venía del subtotal de
    # la cotización), y la utilidad futura —POs menos OCs— también tiene que
    # compararse sin impuesto. Por eso manda _extraer_datos_pdf, que prefiere
    # SUBTOTAL y solo cae al TOTAL si no lo encuentra. El extractor del correo
    # toma el importe MAYOR del documento, que en una PO es el total CON IVA:
    # sirve para el número de orden, no para la cifra.
    datos_finos = {}
    try:
        from .views_crm import _pdf_datos_finos   # import diferido: views_crm carga modelos
        datos_finos = _pdf_datos_finos(texto, [archivo.nombre_original]) or {}
    except Exception as e:
        logger.warning('PO: fallo el extractor fino: %s', e)

    monto = None
    moneda = datos_finos.get('moneda')
    try:
        fin = _extraer_datos_pdf(archivo.archivo) or {}
        monto = fin.get('monto')
        moneda = fin.get('moneda') or moneda
    except Exception as e:
        logger.warning('PO: fallo el extractor financiero: %s', e)

    if monto is None:
        # Último recurso: el importe mayor del documento. Queda anotado en el
        # log porque puede traer IVA incluido.
        monto = datos_finos.get('monto')
        if monto is not None:
            logger.info('PO %s: sin SUBTOTAL legible, se usa el importe mayor (%s) — puede incluir IVA',
                        archivo.nombre_original, monto)

    if monto is None:
        logger.info('PO: %s parece PO pero no se le pudo sacar monto', archivo.nombre_original)
        return None

    monto = _D(str(monto))
    # Las POs en dólares se guardan en pesos, que es la moneda del CRM.
    if (moneda or '').upper() == 'USD':
        monto = _convertir_a_mxn(monto, 'USD', None)

    archivo.tipo_financiero = TIPO_PO_CLIENTE
    archivo.monto_extraido = monto
    archivo.procesado_financiero = True
    archivo.save(update_fields=['tipo_financiero', 'monto_extraido', 'procesado_financiero'])
    logger.info('PO detectada en opp %s: %s = %s', archivo.oportunidad_id,
                archivo.nombre_original, monto)
    return monto


def recalcular_monto_por_po(oportunidad):
    """Pone en la oportunidad la SUMA de todas sus POs. None si no hay ninguna.

    Es la fuente de verdad del monto en cuanto entra la primera PO: mientras no
    haya, el monto lo sigue mandando la cotización.
    """
    from django.db.models import Sum
    from decimal import Decimal as _D
    from .models import ArchivoOportunidad

    agg = (ArchivoOportunidad.objects
           .filter(oportunidad=oportunidad, tipo_financiero=TIPO_PO_CLIENTE)
           .exclude(monto_extraido__isnull=True)
           .aggregate(total=Sum('monto_extraido')))
    total = agg['total']
    if total is None:
        return None

    # TodoItem.monto es DecimalField(max_digits=10): tope 99,999,999.99. Sumar
    # varias POs puede pasarse y MySQL en modo estricto rechazaría el save.
    TOPE = _D('99999999.99')
    if total > TOPE:
        logger.error('PO: la suma de POs de la opp %s (%s) rebasa el tope del campo; se recorta',
                     oportunidad.id, total)
        total = TOPE

    if oportunidad.monto != total:
        oportunidad.monto = total
        oportunidad.save(update_fields=['monto', 'fecha_actualizacion'])
    return total


def oportunidad_tiene_po(oportunidad_id):
    """¿Ya entró al menos una PO con monto? Decide de dónde manda el monto."""
    from .models import ArchivoOportunidad
    return (ArchivoOportunidad.objects
            .filter(oportunidad_id=oportunidad_id, tipo_financiero=TIPO_PO_CLIENTE)
            .exclude(monto_extraido__isnull=True)
            .exists())


def _extraer_datos_pdf_from_bytes(content_bytes):
    """Versión que acepta bytes en vez de un FileField (para uploads manuales)."""
    import io

    class FakeField:
        def open(self, mode='rb'):
            return io.BytesIO(content_bytes)

    return _extraer_datos_pdf(FakeField())


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
        'moneda': 'MXN',
        'tipo_cambio': None,
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
    # "Orden de Compra - TIJ13781", "OCC-TIJ13781", "Orden de Compra: TIJ13781"
    # o "Orden de compra TIJ13933" (título sin separador, formato BAJANET/IAMET).
    # [ \t] (no \s) evita saltar de línea; el código debe contener al menos un
    # dígito para no capturar "BAJANET"/"Proveedor" cuando no hay separador.
    oc_re = re.compile(
        r'(?:Orden\s+de\s+Compra|OCC)[ \t]*[-:]?[ \t]*([A-Za-z]*\d[\w\-]*)',
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

    # ── Detectar moneda (USD vs MXN) y tipo de cambio ──
    result['moneda'] = _detectar_moneda(all_text)
    result['tipo_cambio'] = _extraer_tipo_cambio(all_text)

    # ── Extraer proveedor ──
    # El proveedor generalmente aparece en las primeras líneas del PDF
    # después del encabezado de la empresa emisora. Buscamos la sección
    # "Proveedor" seguida del nombre, o la primera línea larga en mayúsculas
    # que parezca un nombre de empresa.
    result['proveedor'] = _extraer_proveedor_pdf(all_text)

    # Texto crudo para detección por contenido (2 formatos de OC de 2 empresas)
    result['_texto'] = all_text

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


def _detectar_moneda(text):
    """
    Detecta si el documento está en USD o MXN.
    Prioriza el campo explícito 'Moneda:' de los CFDI; si no, busca señales
    fuertes de dólares. Default: MXN (moneda nacional).
    """
    if not text:
        return 'MXN'
    t = text.upper()
    # 1) Campo explícito "Moneda: USD" / "Moneda: MXN" / "Moneda: Peso Mexicano"
    m = re.search(r'MONEDA\s*:?\s*([A-Z\.\s]{2,25})', t)
    if m:
        val = m.group(1)
        if 'USD' in val or 'DOLAR' in val or 'DÓLAR' in val or 'DLL' in val:
            return 'USD'
        if 'MXN' in val or 'PESO' in val or 'M.N' in val or 'NACIONAL' in val:
            return 'MXN'
    # 2) Señales fuertes de USD en cualquier parte del documento
    if re.search(r'\bUSD\b|US\s?\$|\bD[OÓ]LARES?\b|\bDLLS?\b', t):
        return 'USD'
    return 'MXN'


def _extraer_tipo_cambio(text):
    """
    Extrae el tipo de cambio USD→MXN impreso en la factura.
    Ej: 'Tipo de cambio: 17.5000', 'TipoCambio 17.50', 'T.C. 17.4321'.
    Valida que caiga en un rango razonable (5–50) para no confundirlo con otro número.
    """
    if not text:
        return None
    patterns = [
        r'Tipo\s*de\s*[Cc]ambio\s*:?\s*\$?\s*([\d]+\.?\d*)',
        r'Tipo\s*Cambio\s*:?\s*\$?\s*([\d]+\.?\d*)',
        r'\bT\.?\s*C\.?\s*:?\s*\$?\s*([\d]+\.\d{2,4})',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            val = _parse_monto_str(m.group(1))
            if val and Decimal('5') <= val <= Decimal('50'):
                return val
    return None


def _tipo_cambio_fallback():
    """
    Tipo de cambio de respaldo cuando una factura en USD no trae el TC impreso.
    Configurable con la variable de entorno TIPO_CAMBIO_USD_FALLBACK.
    """
    import os
    try:
        return Decimal(str(os.getenv('TIPO_CAMBIO_USD_FALLBACK', '17.00')))
    except (InvalidOperation, ValueError):
        return Decimal('17.00')


def _convertir_a_mxn(monto_original, moneda, tipo_cambio):
    """
    Convierte un monto a pesos.
    Retorna (monto_mxn, tipo_cambio_usado). Para MXN el TC es None.
    """
    if monto_original is None:
        return None, None
    if (moneda or 'MXN').upper() == 'USD':
        tc = tipo_cambio or _tipo_cambio_fallback()
        return (monto_original * tc), tc
    return monto_original, None


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
    """
    Extrae el número/folio de factura del nombre del archivo.
    Normaliza el folio IAMET a 'IAMET-2026-0358' venga como venga escrito.
    """
    base = re.sub(r'\.\w+$', '', nombre).strip()
    # 1) Folio IAMET (funciona esté o no la palabra 'Factura' delante)
    m = _FACTURA_FOLIO_RE.search(base)
    if m:
        return re.sub(r'[\s_]+', '-', m.group(0).strip()).upper()
    # 2) 'Factura XXX'
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


def vincular_pdfs_faltantes(proyecto_iamet):
    """
    Para cada factura de ingreso del proyecto que NO tiene documento vinculado,
    busca en el drive de la oportunidad un PDF cuyo folio coincida y lo enlaza
    (haciendo el folio clickeable + extrayendo monto/moneda del PDF).

    Resuelve el caso de facturas creadas a mano cuyo PDF YA estaba en el drive,
    sin depender de la bandera `procesado_financiero` (que el sync viejo pudo
    haber puesto en True al saltar el archivo como duplicado).

    Retorna { revisadas, vinculadas }.
    """
    from .models import ProyectoFacturaIngreso, ArchivoOportunidad

    if not proyecto_iamet.oportunidad_id:
        return {'revisadas': 0, 'vinculadas': 0}

    facturas = list(ProyectoFacturaIngreso.objects.filter(
        proyecto=proyecto_iamet, archivo_drive__isnull=True,
    ))
    if not facturas:
        return {'revisadas': 0, 'vinculadas': 0}

    # Indexar los archivos del drive de la oportunidad por folio de factura.
    por_folio = {}
    for a in ArchivoOportunidad.objects.filter(oportunidad_id=proyecto_iamet.oportunidad_id):
        nombre = (a.nombre_original or '').strip()
        if _detectar_tipo_financiero(nombre) != 'factura':
            continue
        folio = _extraer_numero_factura(nombre)
        por_folio.setdefault(folio, a)  # primero gana si hay repetidos

    vinculadas = 0
    for f in facturas:
        arch = por_folio.get(f.numero_factura)
        if arch:
            _vincular_pdf_a_factura(f, arch, (arch.extension or '').lower())
            vinculadas += 1
            logger.info(f"[Financiero] Backfill: factura '{f.numero_factura}' vinculada al PDF del drive")

    return {'revisadas': len(facturas), 'vinculadas': vinculadas}


def reevaluar_facturas_moneda(proyecto_iamet=None):
    """
    Re-evalúa la moneda de facturas de ingreso YA importadas que todavía no
    tienen `monto_original` (se crearon antes de la función de moneda, asumiendo
    que el número del PDF estaba en pesos).

    Para cada una: si tiene PDF vinculado (archivo_drive), lo re-parsea para
    detectar USD/MXN + tipo de cambio y recalcula `monto` en pesos. Si no tiene
    PDF (factura manual), la marca como MXN dejando el monto tal cual.

    Es idempotente: una vez estampada (monto_original != NULL) ya no se vuelve a tocar.
    Retorna { total, actualizadas, usd }.
    """
    from .models import ProyectoFacturaIngreso

    qs = ProyectoFacturaIngreso.objects.filter(monto_original__isnull=True)
    if proyecto_iamet is not None:
        qs = qs.filter(proyecto=proyecto_iamet)

    total = qs.count()
    actualizadas = 0
    usd = 0

    for f in qs.select_related('archivo_drive'):
        moneda = 'MXN'
        tc_pdf = None
        pdf_monto = None

        arch = f.archivo_drive
        if arch and getattr(arch, 'archivo', None) and (arch.extension or '').lower() == 'pdf':
            try:
                pdf_data = _extraer_datos_pdf(arch.archivo)
                moneda = pdf_data.get('moneda') or 'MXN'
                tc_pdf = pdf_data.get('tipo_cambio')
                pdf_monto = pdf_data.get('monto')
            except Exception as exc:
                logger.warning(f"[Financiero] Reevaluar moneda factura {f.id}: {exc}")

        if moneda == 'USD':
            # El número guardado (o el del PDF) estaba en dólares → convertir a pesos.
            monto_orig = pdf_monto or f.monto or Decimal('0')
            monto_mxn, tc_usado = _convertir_a_mxn(monto_orig, 'USD', tc_pdf)
            usd += 1
        else:
            # MXN: el monto ya estaba bien; solo lo estampamos sin alterarlo.
            monto_orig = f.monto or Decimal('0')
            monto_mxn, tc_usado = monto_orig, None

        f.monto_original = monto_orig
        f.moneda = moneda
        f.tipo_cambio = tc_usado
        f.monto = monto_mxn or Decimal('0')
        f.save(update_fields=['monto_original', 'moneda', 'tipo_cambio', 'monto'])
        actualizadas += 1

    return {'total': total, 'actualizadas': actualizadas, 'usd': usd}


def reevaluar_ocs_moneda(proyecto_iamet=None):
    """
    Re-evalúa la moneda de Órdenes de Compra YA importadas que todavía no tienen
    `monto_original` (se crearon antes del soporte de moneda, asumiendo pesos).

    Si tienen PDF vinculado (archivo_drive), lo re-parsea para detectar USD/MXN +
    tipo de cambio y recalcula el monto en pesos; si están en pesos, solo estampa
    la moneda sin alterar el monto. Idempotente (monto_original != NULL ya no se toca).
    Retorna { total, actualizadas, usd }.
    """
    from .models import ProyectoOrdenCompra

    qs = ProyectoOrdenCompra.objects.filter(monto_original__isnull=True)
    if proyecto_iamet is not None:
        qs = qs.filter(proyecto=proyecto_iamet)

    total = qs.count()
    actualizadas = 0
    usd = 0

    for oc in qs.select_related('archivo_drive'):
        moneda = 'MXN'
        tc_pdf = None
        pdf_monto = None

        arch = oc.archivo_drive
        if arch and getattr(arch, 'archivo', None) and (arch.extension or '').lower() == 'pdf':
            try:
                pdf_data = _extraer_datos_pdf(arch.archivo)
                moneda = pdf_data.get('moneda') or 'MXN'
                tc_pdf = pdf_data.get('tipo_cambio')
                pdf_monto = pdf_data.get('monto')
            except Exception as exc:
                logger.warning(f"[Financiero] Reevaluar moneda OC {oc.id}: {exc}")

        if moneda == 'USD':
            # El monto guardado (o el del PDF) estaba en dólares → convertir a pesos.
            monto_orig = pdf_monto or oc.monto_total or Decimal('0')
            monto_mxn, tc_usado = _convertir_a_mxn(monto_orig, 'USD', tc_pdf)
            usd += 1
        else:
            # MXN: el monto ya estaba bien; lo estampamos sin alterarlo.
            monto_orig = oc.monto_total or Decimal('0')
            monto_mxn, tc_usado = monto_orig, None

        # save() recalcula monto_total = cantidad * precio_unitario. Ajustamos
        # precio_unitario para que el total quede en pesos, preservando la cantidad.
        cantidad = oc.cantidad or Decimal('1')
        if cantidad == 0:
            cantidad = Decimal('1')
        oc.moneda = moneda
        oc.monto_original = monto_orig
        oc.tipo_cambio = tc_usado
        oc.cantidad = cantidad
        oc.precio_unitario = (monto_mxn or Decimal('0')) / cantidad
        oc.save()
        actualizadas += 1

    return {'total': total, 'actualizadas': actualizadas, 'usd': usd}

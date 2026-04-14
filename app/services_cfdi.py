"""
services_cfdi.py — Conversion de CFDI 4.0 (XML) a PDF (representacion impresa).

Flujo:
1. parse_cfdi_xml(xml_bytes) → dict con toda la info estructurada
2. generate_cfdi_pdf(xml_bytes) → bytes del PDF renderizado con WeasyPrint

El template HTML vive en templates/crm/cfdi_pdf.html
"""

import io
import base64
import re
import logging
from decimal import Decimal
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)

# Namespaces CFDI 4.0
NS = {
    'cfdi': 'http://www.sat.gob.mx/cfd/4',
    'tfd': 'http://www.sat.gob.mx/TimbreFiscalDigital',
    'pago20': 'http://www.sat.gob.mx/Pagos20',
}

# ═══════════════════════════════════════════════════════════════
#  CATALOGOS SAT (subset minimo, suficiente para mostrar etiquetas)
# ═══════════════════════════════════════════════════════════════

REGIMEN_FISCAL = {
    '601': 'General de Ley Personas Morales',
    '603': 'Personas Morales con Fines no Lucrativos',
    '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
    '606': 'Arrendamiento',
    '607': 'Regimen de Enajenacion o Adquisicion de Bienes',
    '608': 'Demas ingresos',
    '610': 'Residentes en el Extranjero sin Establecimiento Permanente en Mexico',
    '611': 'Ingresos por Dividendos (socios y accionistas)',
    '612': 'Personas Fisicas con Actividades Empresariales y Profesionales',
    '614': 'Ingresos por intereses',
    '615': 'Regimen de los ingresos por obtencion de premios',
    '616': 'Sin obligaciones fiscales',
    '620': 'Sociedades Cooperativas de Produccion',
    '621': 'Incorporacion Fiscal',
    '622': 'Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras',
    '623': 'Opcional para Grupos de Sociedades',
    '624': 'Coordinados',
    '625': 'Regimen de las Actividades Empresariales con ingresos a traves de Plataformas Tecnologicas',
    '626': 'Regimen Simplificado de Confianza',
}

USO_CFDI = {
    'G01': 'Adquisicion de mercancias',
    'G02': 'Devoluciones, descuentos o bonificaciones',
    'G03': 'Gastos en general',
    'I01': 'Construcciones',
    'I02': 'Mobiliario y equipo de oficina por inversiones',
    'I03': 'Equipo de transporte',
    'I04': 'Equipo de computo y accesorios',
    'I05': 'Dados, troqueles, moldes, matrices y herramental',
    'I06': 'Comunicaciones telefonicas',
    'I07': 'Comunicaciones satelitales',
    'I08': 'Otra maquinaria y equipo',
    'D01': 'Honorarios medicos, dentales y gastos hospitalarios',
    'D02': 'Gastos medicos por incapacidad o discapacidad',
    'D03': 'Gastos funerales',
    'D04': 'Donativos',
    'D05': 'Intereses reales efectivamente pagados por creditos hipotecarios (casa habitacion)',
    'D06': 'Aportaciones voluntarias al SAR',
    'D07': 'Primas por seguros de gastos medicos',
    'D08': 'Gastos de transportacion escolar obligatoria',
    'D09': 'Depositos en cuentas para el ahorro, primas que tengan como base planes de pensiones',
    'D10': 'Pagos por servicios educativos (colegiaturas)',
    'S01': 'Sin efectos fiscales',
    'CP01': 'Pagos',
    'CN01': 'Nomina',
}

FORMA_PAGO = {
    '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia electronica de fondos',
    '04': 'Tarjeta de credito', '05': 'Monedero electronico', '06': 'Dinero electronico',
    '08': 'Vales de despensa', '12': 'Dacion en pago', '13': 'Pago por subrogacion',
    '14': 'Pago por consignacion', '15': 'Condonacion', '17': 'Compensacion',
    '23': 'Novacion', '24': 'Confusion', '25': 'Remision de deuda',
    '26': 'Prescripcion o caducidad', '27': 'A satisfaccion del acreedor',
    '28': 'Tarjeta de debito', '29': 'Tarjeta de servicios', '30': 'Aplicacion de anticipos',
    '31': 'Intermediario pagos', '99': 'Por Definir',
}

METODO_PAGO = {'PUE': 'Pago en una sola exhibicion', 'PPD': 'Pago en parcialidades o diferido'}

TIPO_COMPROBANTE = {
    'I': 'Ingreso', 'E': 'Egreso', 'T': 'Traslado', 'N': 'Nomina', 'P': 'Pago',
}

UNIDAD_CLAVE = {
    'H87': 'Pieza', 'E48': 'Unidad de servicio', 'KGM': 'Kilogramo', 'MTR': 'Metro',
    'LTR': 'Litro', 'XBX': 'Caja', 'ACT': 'Actividad', 'EA': 'Elemento',
    'HUR': 'Hora', 'DAY': 'Dia', 'MON': 'Mes', 'ANN': 'Anio',
}

IMPUESTO_LABEL = {'001': 'ISR', '002': 'IVA', '003': 'IEPS'}


# ═══════════════════════════════════════════════════════════════
#  PARSER XML
# ═══════════════════════════════════════════════════════════════

def parse_cfdi_xml(xml_content):
    """
    Parsea un XML CFDI 4.0 y retorna un dict con toda la info.
    xml_content puede ser bytes o string.
    """
    if isinstance(xml_content, bytes):
        root = ET.fromstring(xml_content)
    else:
        root = ET.fromstring(xml_content.encode('utf-8') if isinstance(xml_content, str) else xml_content)

    if not root.tag.endswith('Comprobante'):
        raise ValueError(f"Root no es Comprobante: {root.tag}")

    # Datos del comprobante
    data = {
        'version': root.get('Version'),
        'serie': root.get('Serie', ''),
        'folio': root.get('Folio', ''),
        'fecha': root.get('Fecha', ''),
        'forma_pago': root.get('FormaPago', ''),
        'metodo_pago': root.get('MetodoPago', ''),
        'condiciones_pago': root.get('CondicionesDePago', ''),
        'subtotal': Decimal(root.get('SubTotal', '0')),
        'descuento': Decimal(root.get('Descuento', '0') or '0'),
        'total': Decimal(root.get('Total', '0')),
        'moneda': root.get('Moneda', 'MXN'),
        'tipo_cambio': Decimal(root.get('TipoCambio', '1') or '1'),
        'tipo_comprobante': root.get('TipoDeComprobante', ''),
        'exportacion': root.get('Exportacion', ''),
        'lugar_expedicion': root.get('LugarExpedicion', ''),
        'no_certificado': root.get('NoCertificado', ''),
        'sello': root.get('Sello', ''),
    }

    # Emisor
    emisor_el = root.find('cfdi:Emisor', NS)
    if emisor_el is not None:
        data['emisor'] = {
            'rfc': emisor_el.get('Rfc', ''),
            'nombre': emisor_el.get('Nombre', ''),
            'regimen_fiscal': emisor_el.get('RegimenFiscal', ''),
            'regimen_fiscal_label': REGIMEN_FISCAL.get(emisor_el.get('RegimenFiscal', ''), ''),
        }
    else:
        data['emisor'] = {}

    # Receptor
    receptor_el = root.find('cfdi:Receptor', NS)
    if receptor_el is not None:
        data['receptor'] = {
            'rfc': receptor_el.get('Rfc', ''),
            'nombre': receptor_el.get('Nombre', ''),
            'domicilio_fiscal': receptor_el.get('DomicilioFiscalReceptor', ''),
            'regimen_fiscal': receptor_el.get('RegimenFiscalReceptor', ''),
            'regimen_fiscal_label': REGIMEN_FISCAL.get(receptor_el.get('RegimenFiscalReceptor', ''), ''),
            'uso_cfdi': receptor_el.get('UsoCFDI', ''),
            'uso_cfdi_label': USO_CFDI.get(receptor_el.get('UsoCFDI', ''), ''),
        }
    else:
        data['receptor'] = {}

    # Conceptos
    conceptos = []
    conceptos_el = root.find('cfdi:Conceptos', NS)
    if conceptos_el is not None:
        for c in conceptos_el.findall('cfdi:Concepto', NS):
            cdict = {
                'clave_prod_serv': c.get('ClaveProdServ', ''),
                'no_identificacion': c.get('NoIdentificacion', ''),
                'cantidad': Decimal(c.get('Cantidad', '0')),
                'clave_unidad': c.get('ClaveUnidad', ''),
                'clave_unidad_label': UNIDAD_CLAVE.get(c.get('ClaveUnidad', ''), ''),
                'unidad': c.get('Unidad', ''),
                'descripcion': c.get('Descripcion', ''),
                'valor_unitario': Decimal(c.get('ValorUnitario', '0')),
                'importe': Decimal(c.get('Importe', '0')),
                'descuento': Decimal(c.get('Descuento', '0') or '0'),
                'objeto_imp': c.get('ObjetoImp', ''),
                'impuestos': [],
            }
            # Impuestos del concepto
            imp_el = c.find('cfdi:Impuestos', NS)
            if imp_el is not None:
                for t in imp_el.findall('cfdi:Traslados/cfdi:Traslado', NS):
                    cdict['impuestos'].append({
                        'tipo': 'Traslado',
                        'base': Decimal(t.get('Base', '0')),
                        'impuesto': t.get('Impuesto', ''),
                        'impuesto_label': IMPUESTO_LABEL.get(t.get('Impuesto', ''), t.get('Impuesto', '')),
                        'tipo_factor': t.get('TipoFactor', ''),
                        'tasa_cuota': Decimal(t.get('TasaOCuota', '0') or '0'),
                        'importe': Decimal(t.get('Importe', '0') or '0'),
                    })
            conceptos.append(cdict)
    data['conceptos'] = conceptos

    # Impuestos totales
    data['total_impuestos_trasladados'] = Decimal('0')
    data['total_impuestos_retenidos'] = Decimal('0')
    imp_root = root.find('cfdi:Impuestos', NS)
    if imp_root is not None:
        data['total_impuestos_trasladados'] = Decimal(imp_root.get('TotalImpuestosTrasladados', '0') or '0')
        data['total_impuestos_retenidos'] = Decimal(imp_root.get('TotalImpuestosRetenidos', '0') or '0')

    # Timbre Fiscal Digital
    data['timbre'] = {}
    complemento = root.find('cfdi:Complemento', NS)
    if complemento is not None:
        tfd = complemento.find('tfd:TimbreFiscalDigital', NS)
        if tfd is not None:
            data['timbre'] = {
                'uuid': tfd.get('UUID', ''),
                'fecha_timbrado': tfd.get('FechaTimbrado', ''),
                'rfc_prov_certif': tfd.get('RfcProvCertif', ''),
                'sello_cfd': tfd.get('SelloCFD', ''),
                'no_certificado_sat': tfd.get('NoCertificadoSAT', ''),
                'sello_sat': tfd.get('SelloSAT', ''),
                'version': tfd.get('Version', '1.1'),
            }

    # Labels legibles
    data['forma_pago_label'] = FORMA_PAGO.get(data['forma_pago'], data['forma_pago'])
    data['metodo_pago_label'] = METODO_PAGO.get(data['metodo_pago'], data['metodo_pago'])
    data['tipo_comprobante_label'] = TIPO_COMPROBANTE.get(data['tipo_comprobante'], data['tipo_comprobante'])

    # Cadena original del timbre (para mostrar en el PDF)
    if data['timbre']:
        t = data['timbre']
        data['cadena_original_timbre'] = (
            f"||{t['version']}|{t['uuid']}|{t['fecha_timbrado']}|{t['rfc_prov_certif']}|{t['sello_cfd']}|{t['no_certificado_sat']}||"
        )
    else:
        data['cadena_original_timbre'] = ''

    # Importe con letra
    data['importe_con_letra'] = _numero_a_letras(data['total'], data['moneda'])

    return data


# ═══════════════════════════════════════════════════════════════
#  QR CODE SAT
# ═══════════════════════════════════════════════════════════════

def _generar_qr_sat_base64(cfdi_data):
    """Genera el QR del SAT con la URL estandar de verificacion y retorna como data URI base64."""
    try:
        import qrcode
    except ImportError:
        return ''

    uuid = cfdi_data.get('timbre', {}).get('uuid', '')
    rfc_emisor = cfdi_data.get('emisor', {}).get('rfc', '')
    rfc_receptor = cfdi_data.get('receptor', {}).get('rfc', '')
    total = cfdi_data.get('total', Decimal('0'))
    sello = cfdi_data.get('timbre', {}).get('sello_cfd', '')
    ultimos_8 = sello[-8:] if sello else ''

    if not uuid:
        return ''

    # Formato oficial SAT: total con 6 decimales, RFCs en mayusculas
    total_str = f"{total:.6f}"
    url = (
        f"https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx"
        f"?id={uuid}&re={rfc_emisor}&rr={rfc_receptor}&tt={total_str}&fe={ultimos_8}"
    )

    qr = qrcode.QRCode(version=None, box_size=4, border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return f"data:image/png;base64,{b64}"


# ═══════════════════════════════════════════════════════════════
#  NUMERO A LETRAS (MXN / USD)
# ═══════════════════════════════════════════════════════════════

_UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
             'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE',
             'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES',
             'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE']

_DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']

_CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
             'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']


def _convertir_grupo(n):
    """Convierte un numero 0-999 a letras."""
    if n == 0:
        return ''
    if n == 100:
        return 'CIEN'
    s = ''
    c = n // 100
    resto = n % 100
    if c > 0:
        s += _CENTENAS[c] + ' '
    if resto < 30:
        s += _UNIDADES[resto]
    else:
        d = resto // 10
        u = resto % 10
        s += _DECENAS[d]
        if u > 0:
            s += ' Y ' + _UNIDADES[u]
    return s.strip()


def _numero_a_letras(numero, moneda='MXN'):
    """Convierte un Decimal a 'DOS MIL TRESCIENTOS CUARENTA Y CINCO 67/100 MXN'."""
    try:
        numero = Decimal(str(numero))
    except Exception:
        return ''
    entero = int(numero)
    centavos = int(round((numero - entero) * 100))

    if entero == 0:
        letras = 'CERO'
    else:
        millones = entero // 1_000_000
        miles = (entero % 1_000_000) // 1000
        unidades = entero % 1000
        partes = []
        if millones > 0:
            p = _convertir_grupo(millones)
            partes.append(p + (' MILLON' if millones == 1 else ' MILLONES'))
        if miles > 0:
            p = _convertir_grupo(miles)
            if miles == 1:
                partes.append('MIL')
            else:
                partes.append(p + ' MIL')
        if unidades > 0:
            partes.append(_convertir_grupo(unidades))
        letras = ' '.join(partes).strip()

    return f"{letras} {centavos:02d}/100 {moneda}"


# ═══════════════════════════════════════════════════════════════
#  GENERAR PDF (usa Django templates + WeasyPrint)
# ═══════════════════════════════════════════════════════════════

def generate_cfdi_pdf(xml_content):
    """
    Parsea el XML, arma el contexto, renderiza el template y retorna bytes PDF.
    """
    from django.template.loader import render_to_string
    from weasyprint import HTML

    data = parse_cfdi_xml(xml_content)
    data['qr_sat_base64'] = _generar_qr_sat_base64(data)

    # Detectar si es BAJANET para activar branding
    rfc_emisor = data.get('emisor', {}).get('rfc', '').upper()
    data['is_bajanet'] = (rfc_emisor == 'BAJ100903KC6')

    html = render_to_string('crm/cfdi_pdf.html', {'cfdi': data})
    pdf_bytes = HTML(string=html).write_pdf()
    return pdf_bytes, data

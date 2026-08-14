"""Batería de formatos REALES de PO y OC, para que ningún ajuste rompa uno anterior.

Cada vez que aparece una PO de un cliente nuevo se agrega aquí un fragmento de
su texto —lo mínimo que necesita el extractor— con el monto y la moneda que
DEBE sacar. Así, al ampliar el lector para un formato, se comprueba de una
corrida que los demás siguen leyéndose igual.

    python manage.py probar_lector_po
    python manage.py probar_lector_po -v 2    # muestra también los que pasan

Los fragmentos son solo las líneas que intervienen en la extracción; no se
guardan los PDF de los clientes en el repositorio.

Cubre las dos mitades de la utilidad: las PO que nos manda el cliente (el
ingreso) y las OC que nosotros le emitimos a proveedores (el gasto).
"""

from django.core.management.base import BaseCommand


#: (cliente/formato, nombre de archivo, fragmento del texto, monto, moneda,
#:  ¿el texto viene de OCR?)
CASOS_REALES = [
    (
        'Schlage / Allegion — Oracle "Standard Purchase Order"',
        'PO_103_8175324_0_US.pdf',
        'Standard Purchase Order8175324, Rev 0\n'
        'Schlage de Mexico Planta Tecate Type Standard Purchase Order\n'
        'Supplier Payment Terms Freight Terms FOB Carrier Effective Start Date '
        'Effective End Date Currency Amount Agreed\n'
        'Number\n'
        '66800 3/15 N 75 FOB ORIGIN MXN\n'
        'Line Part Number / Description Rev Delivery Date/ Requester Quantity UOM Unit Price Amount\n'
        '1 PCB Digital Core Module 31-JUL-2026 100 EA 75 7,500.00\n'
        '2 COMPONENTES 31-JUL-2026 100 EA 68 6,800.00\n'
        '3 ENSAMBLE 31-JUL-2026 100 EA 49 4,900.00\n'
        'TOTAL: 19,200.00\n'
        # Las páginas 3 y 4 son términos legales; se incluye un trozo porque
        # contienen la palabra TOTAL y no deben generar falsos positivos.
        'NO OBSTANTE LO ANTERIOR, CUANDO SE TRATE DE SERVICIOS DE CONSTRUCCION, '
        'EL COMPRADOR RETENDRA EL 20% (VEINTE POR CIENTO) DEL PRECIO TOTAL DEL '
        'PROYECTO DE QUE SE TRATE HASTA EL MOMENTO EN QUE EL PROVEEDOR HAYA '
        'CULMINADO LA CONSTRUCCION.\n',
        19200.00, 'MXN', False,
    ),
    (
        'Eaton — Oracle, "Total:841.00 (USD)" sin espacio y MXN en el pie',
        'PO_500181_9014800042623_0_US.pdf',
        'Standard Purchase Order\n9014800042623, 0\n'
        'Supplier: BAJANET S DE RL DE CV\n'
        'Ship To: Eaton Industries, S. de R.L. de C.V.\n'
        'Notes: All prices and amounts on this order are expressed inUSD\n'
        'Line Part Number / Description Delivery Date/Time Quantity UOM Unit Price Tax Amount\n'
        '(USD) (USD)\n'
        '1 Needed: 1 EACH 841 N 841.00\n'
        'HPE 2.4TB Internal Hard Drive - SAS 12Gb/s\n'
        'Total:841.00 (USD)\n'
        # El pie de la pagina 2 trae MXN (codigo de unidad de negocio de Eaton).
        # Si la moneda se tomara del primer hallazgo del documento, o del
        # ultimo, aqui se convertiria mal por 17.
        'OU ETN IND MEX 0148 MXN Standard Purchase Order\n9014800042623, 0\n',
        841.00, 'USD', False,
    ),
    (
        'Baxter / Welch Allyn — SAP, "ValorNetoTotalUSD" con las palabras pegadas',
        'PO 65093562.pdf',
        # pdfplumber devuelve este PDF SIN espacios entre palabras. Es el caso
        # que obligó a usar \\s* en las etiquetas: en "ValorNetoTotal" no hay
        # frontera de palabra antes de "Total", asi que un \\btotal no lo ve.
        'Orden de Compra\n'
        'DireccióndelProveedor Información\n'
        'BajaNetSDeRl DeCv NúmeroOC 65093562\n'
        'DatosdeFacturación Condiciones:\n'
        'WelchAllyndeMexico(Tijuana) TérminosdePago Neto30días\n'
        'CalleEmilioFlores2471 IncoTerms 1RG\n'
        '22203Tijuana Moneda USD\n'
        'Artículo Material/ Cantidad Unidad Impuesto PrecioNeto ImporteNeto\n'
        '10 1 C/U Y 1,850.00Per1 1,850.00\n'
        'L5450LaptopDellLatitude5450,14"\n'
        'FechadeEntrega:\n06.07.2026 1\n'
        'ValorNetoTotalUSD 1,850.00\n',
        1850.00, 'USD', False,
    ),
    (
        'BD BuySmart (Becton Dickinson) — tabla con moneda de sufijo',
        'PO-6901595339_v1_20260109.pdf',
        'Becton, Dickinson and Company\nPURCHASE ORDER /Purchase Order\n'
        'PO NUMBER /PO Number 6901595339\nCURRENCY /Currency USD\n'
        'Line Description Delivery Date Qty Unit Price Total\n'
        '1 Epson Maintenance Box for SureColor P8570D 13/01/2026 3 each 180.00 540.00\n'
        '3 Units 540.00 USD\n',
        540.00, 'USD', False,
    ),
    (
        'Telnor (Teléfonos del Noroeste) — DESGLOSA IVA: manda el SUBTOTAL',
        # El nombre del archivo no dice nada de PO; esta se reconoce solo por su
        # contenido ("ORDEN DE COMPRA").
        '18325 Bajanet.pdf',
        'TELEFONOS DEL NOROESTE, S.A. DE C.V.\nORDEN DE COMPRA\nNo. 18325\n'
        'Proveedor: Bajanet, S. de RL de CV Fecha Tijuana, B.C. 25-jun-26\n'
        'PARTIDA CANTIDAD UNIDAD DESCRIPCION PRECIO UNIT TOTAL\n'
        'I 1 Pza Termostato para sistemas de una sola etapa calor y frio, no '
        'programable vertical PRO 1000$ 8 3.00 $ 83.00\n'
        'II Dimensiones compactas: 120x74x28 mm $ -\n'
        'III $ -\n'
        'SUBTOTAL 83.00\n'
        'I.V.A 13.28\n'
        'TOTAL USD 96.29\n'
        'Partida presupuestal\nObservaciones:\n',
        # 96.29 es CON IVA. El monto de la oportunidad va siempre neto, así que
        # de esta PO se toma el subtotal.
        83.00, 'USD', False,
    ),
    (
        'Essilor / EssilorLuxottica — SAP, "Importe Total MXN" y 2 páginas de T&C',
        'Purchase Order 4554923104 - 025139.pdf',
        'ESSILOR TIJUANA OPTICA ,S. de R.L. de C.V.\nRFC: ETO141009IN6\n'
        'IAMET S DE RL DE CV\n'
        'FECHA DEL PEDIDO 12.05.2026\nPEDIDO NUMERO 4554923104\n'
        'Incoterms: FOB Franco a bordo\n'
        'Condiciones de pago: Bank Transfer 60 days Invoice date\n'
        'Moneda: MXN\n'
        'Pos. Código material Descripción Cantidad UM Precio unitario Precio neto\n'
        '10 1000450 UPS APC BR700G 2 UN 3,383.82000 6,767.64\n'
        '700VA/450W 120V\nPlan de entregas:\n'
        'Cantidad UM Fecha de entrega\n2 UN 25.05.2026\n'
        '20 1000450 BATERIA APC 12V 9AH 2 UN 1,087.00000 2,174.00\n'
        'LEAD ACID HOTSWAP\nPlan de entregas:\n'
        'Cantidad UM Fecha de entrega\n2 UN 25.05.2026\n'
        'Importe Total MXN 8,941.64\n'
        # Las páginas 3 y 4 son términos legales en inglés, llenos de "price",
        # "amount" y numeración de cláusulas. Se incluye un trozo porque es el
        # tipo de texto que puede producir un importe falso.
        '9. PRICE: Products must not be shipped at a higher price than specified '
        'on the face of this P.O. unless there are changes to the P.O. in '
        'accordace with Section 2 above.\n'
        '25. LIABILITY; SET OFF: Purchaser may set off any amount due to Supplier '
        'form any of Purchaser\'s divisions or affiliates whether or not under '
        'this P.O. against any amounts due Supplier hereunder.\n'
        'ESSILOR OF AMERICA PO# N71980, Revision 0, Page 3 of 4\n',
        # 6,767.64 + 2,174.00 = 8,941.64 — sin IVA, como las demás.
        8941.64, 'MXN', False,
    ),
    (
        'CDA Industrial (Procore) — total dentro de una frase + TC pactado',
        '1097-ALLIUZ_ALAMAR-PO-1097-642-Alcance_de_Ingenier_a_Sistema_CCTV_'
        'Alluiz-2026-05-25.pdf',
        'Orden de Compra\nPO-1097-642\n'
        'CDA Industrial S.A. de C.V. Proyecto: 1097 - ALLIUZ ALAMAR\n'
        'R.F.C. CIN100528662 TIJUANA, Baja California 22476\n'
        'FECHA DE CREACIÓN: 25/05/2026\n'
        'COMPAÑÎA CONTRATADA: BAJANET S DE RL DE CV\n'
        'DESCRIPCIÓN:\n'
        # Esta frase es la trampa: trae un "total" y un importe MXN que no son
        # los de la orden. Si gana, el monto queda mal y la moneda también.
        'Por temas administrativos, esta PO se encuentra en dólares, considerando '
        'un tipo de cambio conforme al DOF de $17.3305 MXN por USD. Sin\n'
        'embargo, el pago se realizará en moneda nacional, por lo que el monto '
        'total a pagar será de $70,000.00 MXN.\n'
        # Y esta es la tasa, no un IVA desglosado.
        'Precios mas IVA del 16%\n'
        'N° Código Presupuestario Descripción Cantidad Unidad Monto\n'
        '01-180.S Obras y Servicios suma\n'
        '1 sembrado en AutoCAD, ingeniería de detalle de 1.0 $4,039.13 $4,039.13\n'
        'Total: $4,039.13\n'
        'CDA Industrial S.A. de C.V. Página 1 de 1 Impreso el: 25/05/2026 10:46 PDT\n',
        4039.13, 'USD', False,
    ),
    (
        'Carl Zeiss / POOL4TOOL (Jaggaer) — "PO Number:" y "incl. IVA" por partida',
        # Ni el nombre ni el cuerpo traían una pista conocida: se detectaba como
        # NO-PO y el archivo se ignoraba entero.
        'POOL4TOOL order request 1453140.pdf',
        '6/3/26, 4:42 p.m. POOL4TOOL order request 1453140\n'
        'PO Number: 1453140\nDate: 2026-03-07\nPurchaser: Cedillo, Ana\n'
        'BAJANET S DE RL DE CV\n'
        'Payment conditions:within 30 days due net\n'
        'Ship To:\nCarl Zeiss Vision Manufactura\n'
        'Item Your Material# Delivery date OrderOrder Confirm- Price/Unit Net Value\n'
        'Material Description Qty Unit ation\n'
        '1 FZ2ERLNLNSNM002Jumper de 40.00 EA 54.25 2,170.00 split\n'
        'V9 TX, Taxable Purchase\n'
        'Precio bruto 54.25 USD 2,170.00\n'
        'Valor neto incl. des 54.25 USD 2,170.00\n'
        # "incl. IVA" NO es un impuesto desglosado: la cifra es el valor neto.
        'Valor neto incl. IVA 54.25 USD 2,170.00\n'
        'Descuento 0.00 0.00\n'
        'Precio efectivo 54.25 USD 2,170.00\n'
        '2 Jumper de 10.00 EA 56.74 567.40 split\n'
        'Precio bruto 56.74 USD 567.40\n'
        'Valor neto incl. IVA 56.74 USD 567.40\n'
        'Precio efectivo 56.74 USD 567.40\n'
        'Total: 2,737.40 USD\n'
        'https://app11.jaggaer.com/order_request_3.php?id=47078115&print= 1/2\n',
        2737.40, 'USD', False,
    ),
    (
        'Lateral Fulfillment (PandaDoc) — desglosa IMPUESTOS: manda el SUB-TOTAL',
        # "PO#TJ00176": el folio empieza con letras.
        'IT PO#TJ00176 Orden de Compra - Iamet (1).pdf',
        'ORDEN DE COMPRA\nLF-CO-F-02 Rev.1\n'
        'Date: Thursday, July 02, 2026\nFolio: PO TJ00176\n'
        'PROVEEDOR: DIRECCION DE ENTREGA: FACTURAR A:\n'
        'Name: IAMET S de RL de CV Nombre: Lateral Fulfillment S de RL de CV\n'
        'CLAVE DEL ARTICULO DESCRIPCION CANTIDAD PRECIO UNITARIO TOTAL\n'
        'Monitor Samsung 27 Pulgadas\n'
        'LS27D360GALXZX Essential, FHD, Curvatura 1.00 $2,950.00 $2,950.00\n'
        '1800R, 75Hz, 4ms, color Negro,\n'
        'Soporte para CPU, ajustable,\n'
        '6001301 1.00 $280.00 $280.00\n'
        'SUB-TOTAL $3,230.00\n'
        'IMPUESTOS $516.80\n'
        'TOTAL $3,746.80\n'
        # La etiqueta de moneda viene pegada al texto de la plantilla.
        'MONEDAN(SELECT) MXN\n'
        'USO EXCLUSIVO DE FINANZAS\n'
        'SI __________ NO X NA 15 dias\n'
        'OPEX ____________ CAPEX ____X____ % INTERES ___________\n',
        # 2,950 + 280 = 3,230 neto; los $516.80 son el 16% y el total los trae.
        3230.00, 'MXN', False,
    ),
    (
        'Fisher & Paykel — PDF ESCANEADO: el texto sale de OCR',
        # Ni nombre ni capa de texto: tres páginas de pura imagen, cero
        # caracteres. Lo que sigue es lo que devuelve el OCR a 200dpi, con su
        # orden de cajas — la etiqueta y su importe quedan en renglones
        # distintos y "MXN" se cuela en medio.
        '4800097996.pdf',
        'Fisher &Paykel\nFisher & Paykel Healthcare S.A de C.V.\n'
        'Ave. Todos los Santos #12831\nTijuana 22643\nHEALTHCARE\nMexico\n'
        'Page 1 of 3\n2026-04-02 15:09:00\n'
        'PO Information\nYourVendorNumberwithus:1009005\n'
        'Purchase Order No: 4800097996\nDate: 30MAR2026\nIAMET S DE RLDECV\n'
        'Buyer / Telephone / Ext: Karen Gonzalez / (664) 231 3450 ext 3459\n'
        'Payment Terms: Within 15 days of invoice date\n'
        'Header Text:\nPLEASE CHECK REVISION CODE AS BELOW AND/OR DRAWING\n'
        'PLEASE SUPPLY THE FOLLOWING:\nCurrency: MXN\n'
        'Order Qty\nItem Code /\nRev\nUoM\nUnit Price\nItem\nRequired\n'
        'Line Total\nDescription\nCode\nDel. Date\n'
        '00010\nAU\n31MAR2026\n44,489.25\n44,489.25\n'
        'UnificarservidoresCCTVMX1\nCost Center: 193510061\n'
        'Total Value This Order:\nMXN\n44,489.25',
        44489.25, 'MXN', True,
    ),
    (
        'Autoliv — DESGLOSA impuesto y NO trae subtotal: hay que restarlo',
        # El nombre son puros números; se reconoce por "Purchase Order" adentro.
        '1852077_2026-05-07_629232_00000707.pdf',
        'Date Issued: 05/07/2026 Purchase Order 1852077 ON Date Printed: 05/07/2026\n'
        'Page 1 of 2\nAUTOLIV SAFETY TECHNOLOGY DE MEXICO\nCurrency: USD\n'
        'Vendor: BAJANET S DE RL DE CV Bill To: AUTOLIV SAFETY TECHNOLOGY DE MEXICO\n'
        '#629232 BLVD PASEO DEL RIO #16220 SA DE CV\n'
        'Payment Terms: 30th Prox Freight: FCA Free Carrier\n'
        'Line Qty Autoliv P/N Part Description Need Date Tax UOM Unit Cost Extended\n'
        'Y/N Amount\n'
        '1 3 Ugreen 65W USB CChargin Statio 05/20/2026 Y EA 85.6700 257.01\n'
        'Serequierenreguladoresdevoltaje.\n'
        '2 1 ugreen rigth angle usbc tousbc 05/20/2026 Y EA 22.1000 22.10\n'
        # Impuesto y total en el MISMO renglón, y en toda la hoja no hay
        # subtotal: el neto solo sale restando.
        'Sales Tax: 44.66 Total: 323.77\n'
        'Signature\n'
        '9)CostperUnitandTotalCost,withCurrencybeingused(USDdollars,MXPpesos,BRL,etc?)\n'
        '10)Unitarynetandgrossweight,aswellastotalnetandgrossweightofshipment\n',
        # 257.01 + 22.10 = 279.11 neto; 323.77 - 44.66 = 279.11 (16%).
        279.11, 'USD', False,
    ),
    (
        'Aptiv — título con las letras separadas y el neto solo por resta',
        'PT19702.pdf',
        # El título del documento viene letra por letra. Antes esta PO se
        # detectaba de milagro, por un "orden de compra" suelto en la letra
        # chica de los remarks, cuatro párrafos más abajo.
        'Aptiv Contract Services P U R C H A S E O R D E R\n'
        'Tijuana, S.A. de C.V.\n'
        'Parque Industrial Misiones Order Number: PT19702 Order Rev: 0\n'
        'de California #15351 Order Date: 03/17/26 Page: 1\n'
        'Supplier: 00060352 Ship To: tij1mn\nIAMET S DE RL DE CV\n'
        'Credit Terms: N30 Ship Via: Camion del proveedor\n'
        'Ln Item Number T Due Date Qty Open UM Unit Cost Extended\n'
        'Cost\n'
        '--- ------------------ - -------- ---------- -- ------------ ------------------\n'
        '1 Mouse Logi MX Mast Y 03/25/26 1.0 EA 145.00 145.00\n'
        '2 Logitech Wave Keys Y 03/25/26 2.0 EA 135.00 270.00\n'
        '3 3M Bright Screen P Y 03/25/26 1.0 EA 100.00 100.00\n'
        '4 Cable HDMI 2.0 4K@ Y 03/25/26 20.0 EA 8.26 165.20\n'
        '5 Cable DisplayPort Y 03/25/26 20.0 EA 13.60 272.00\n'
        '6 Microsoft Surface Y 03/25/26 1.0 EA 1,275.00 1,275.00\n'
        '--------------------------------------------------------------------------------\n'
        # Tres renglones que mezclan etiquetas e importes. "Taxable" y
        # "Non-Taxable" NO deben contar como impuesto; "Total Tax" sí.
        'Non-Taxable: 0.00 Currency: USD Line Total: 2,227.20\n'
        'Taxable: 2,227.20 Total Tax: 356.35\n'
        'Tax Date: 03/25/26 Total: 2,583.55\n'
        'Nayelie Silva\nBy: ______________________________\n'
        'Authorized Signature\n',
        # Suma de partidas = 2,227.20; 2,583.55 - 356.35 = 2,227.20 (16%).
        2227.20, 'USD', False,
    ),
    (
        'SDS de México — IVA, IEPS y Retención por separado; moneda en palabra',
        # Extensión en MAYÚSCULAS. Toda la cadena la normaliza antes de comparar.
        'ORD080134.PDF',
        'Fecha de Emision: 21/01/2026\n'
        'Orden de Compra / Purchase Order Fecha de Entrega: 21/01/2026\n'
        'SDS DE MEXICO, S DE RL. DE C.V. ORD080134\n'
        'SME-960529-AUA\nCIRCUITO SUR\nMEXICALI, B.CFA.\n'
        'Proveedor IAMET S DE RL DE CV Entregar en: SDS DE MEXICO, S DE RL. DE C.V.\n'
        'Dirección PASEO DEL RIO 16220 Dirección: MEXICALI, B.CFA. MEXICO C.P. 21395\n'
        # Dice la moneda con palabra, no con código.
        'Telefono: Fecha de Entrega: 0/0/0 Moneda: DOLARES\n'
        'ORD080134 Página: 1 de 1\n'
        'No. DESCRIPTION Cantidad U.M. Precio Total\n'
        '1 Revision y Diagnostico de Sistema Secur 1.00 SERVICI 490.00 490.00\n'
        'Clave: SER-2059\n'
        'Subtotal 490.00\n'
        'Horario de recepcion de mercancías:\n'
        'Lunes a Viernes 7:00am a 3:00pm IVA 78.40\n'
        'Indicar el número de orden de compra en la factura.\n'
        # IEPS y Retención NO son el IVA; van en cero y no deben contarse.
        'IEPS 0.00\n'
        'Estimados proveedores:\n'
        'Por Seguridad es obligatorio el uso de zapato cerrado, pantalón largo y camisa con Retención 0.00\n'
        'mangas.\n'
        'Total 568.40\n'
        'ORMCO % FORMATO A054-02\nDMC %\nPENTRO %\n',
        # 490.00 + 78.40 (16%) = 568.40. Manda el subtotal.
        490.00, 'USD', False,
    ),
    (
        'Skyworks Solutions — SAP Ariba: "Pedido de compra" y el IVA al 8%',
        # No se detectaba: el documento nunca dice "orden de compra" ni
        # "purchase order", dice "Pedido de compra", que es como SAP la nombra.
        '6000047858.pdf',
        'Pedido de compra: 6000047858\n'
        'Este pedido de compra fue entregado por SAP Business Network.\n'
        'Desde: Para: Pedido de compra\nIAMET S DE RL DE CV\n'
        'Skyworks Solutions de Mexico, S.\nPASEO DEL RIO 16220 (Nuevo)\n'
        'TIJUANA 6000047858\n'
        'Col.Rivera, CP 21259, Baja California Importe: $ 1,200.00 USD\n'
        'Condiciones de pago\nNETO 15\n'
        'Otra información\nTax registration number: R.F.C SSM060616J7A\n'
        'Tipo/Categoría de transacción: IndirectPO\n'
        'Artículos en línea\n'
        'Número de línea Tipo Devolución Precio Subtotal Impuesto\n'
        '1 No disponible Servicio 1 (EA) 30 abr. 2026 $1,200.00 $1,200.00 $96.00\n'
        'USD USD USD\n'
        'CORR_Revisión y Diagnóstico de sistema de control de Acceso\n'
        # Tasa fronteriza del 8%, no el 16% de siempre: la validación de la
        # resta tiene que dar margen para ambas.
        'IVA 8 $1,200.00 $96.00 USD Input\n'
        'Discount: $0.00 USD\n'
        'Este pedido ha sido enviado por Skyworks Solutions, Inc. AN11206486686 y Subtotal: $ 1,200.00 USD\n'
        'Total estimado de impuestos: $ 96.00 USD\n'
        'Suma total estimada: $ 1,296.00 USD\n',
        1200.00, 'USD', False,
    ),
]


#: Las OC las emitimos NOSOTROS, así que solo hay dos formatos y son estables.
#: Las lee _extraer_datos_pdf, no el lector de PO: es otra ruta y por eso van
#: en su propia lista.
#:
#: De cada fragmento se comprueba lo que decide la utilidad: que el documento
#: se clasifique como OC y que la MONEDA salga bien. El monto y el número de OC
#: los saca _extraer_datos_pdf del PDF completo —no de un fragmento de texto—,
#: así que se anotan como referencia y se verifican contra los archivos reales.
#: (empresa, nombre de archivo, fragmento, monto sin IVA, moneda, número)
CASOS_OC = [
    (
        'BAJANET — Orden de compra a proveedor',
        'OCC-TIJ13944.pdf',
        # pdfplumber devuelve este PDF con las palabras pegadas.
        'Orden de compra TIJ13944\nBAJANET\nRFC:BAJ100903KC6\n'
        'Proveedor Elaboradopor: AlvaroRiveraPetriz(29-07-2026)\n'
        'ADISES\nRFC:ADI091202U22Tel.: Estado: Aprobada\n'
        'Cód Cantidad Unidad Descripción PrecioUnitario Importe\n'
        '5.0C-H6M-D1-I\n2.00 Pieza LightCatcher;Day/Night;2.9mmf/2.0;IR 351.47 $702.94\n'
        '002IVA|TipoFactor:Tasa|Tasa:0.1600\n'
        'Documento:OrdendeCompra-TIJ13944 Subtotal: $702.94\n'
        'FechaDocumento:29-07-2026 Descuento: $0.00\n'
        'Vencimiento:28-08-2026 I.V.A. $112.47\n'
        # El ÚNICO "USD" del documento va pegado al importe con letra. Con una
        # frontera de palabra estricta no se ve, y la OC se tomaba por pesos:
        # 18 veces menos gasto, y la utilidad salía inflada.
        'Total:OCHOCIENTOSQUINCE41/100USD Total: $815.41\n'
        'Notas\nERCSK.6000044374\nPágina1de1\n',
        702.94, 'USD', 'TIJ13944',
    ),
    (
        'IAMET — Orden de compra a proveedor',
        'OCC-POIAM1593.pdf',
        'Orden de compra POIAM1593\nIAMET\nRFC:IAM170712NL7\n'
        'Proveedor Elaboradopor: AlvaroRiveraPetriz(15-01-2026)\n'
        'CTINTERNACIONALDELNOROESTE,S.A.DEC.V.\n'
        'RFC:CIN960904FQ2Tel.: Estado: Aprobada\n'
        'Cód Cantidad Unidad Descripción PrecioUnitario Importe\n'
        'ZD6A122-T01E0 TouchLCD:203dpi,USB,Host,Ethernet,\n'
        '8.00 pza 560.00 $4,480.00\n'
        '002IVA|TipoFactor:Tasa|Tasa:0.1600\n'
        'Documento:OrdendeCompra-POIAM1593 Subtotal: $4,480.00\n'
        'FechaDocumento:15-01-2026 Descuento: $0.00\n'
        # Ojo: el impuesto impreso es el 8% fronterizo (358.40 sobre 4,480),
        # aunque el renglón de arriba diga "Tasa:0.1600". No nos afecta porque
        # tomamos el subtotal, pero conviene no "corregirlo".
        'Vencimiento:14-02-2026 I.V.A. $358.40\n'
        'Total:CUATROMILOCHOCIENTOSTREINTAYOCHO40/100USD Total: $4,838.40\n'
        'Notas\nRL4548219523ESSLUXO\nPágina1de1\n',
        4480.00, 'USD', 'POIAM1593',
    ),
]


class Command(BaseCommand):
    help = 'Corre la batería de formatos reales de PO contra el lector.'

    def handle(self, *args, **opts):
        from app.services_financiero import (
            es_po_de_cliente, monto_de_po, moneda_de_po,
        )
        verboso = int(opts.get('verbosity', 1)) >= 2

        fallas = 0
        for desc, nombre, texto, monto_esp, moneda_esp, ocr in CASOS_REALES:
            detecta = es_po_de_cliente(nombre, texto)
            monto = monto_de_po(texto, ocr=ocr)
            moneda = moneda_de_po(texto)
            bien = detecta and monto == monto_esp and moneda == moneda_esp

            if bien and not verboso:
                continue
            estilo = self.style.SUCCESS if bien else self.style.ERROR
            self.stdout.write(estilo('%-5s %s' % ('ok' if bien else 'FALLA', desc)))
            if not bien:
                self.stdout.write('        archivo  : %s%s' % (
                    nombre, '   (texto de OCR)' if ocr else ''))
                self.stdout.write('        detecta  : %s' % detecta)
                self.stdout.write('        monto    : %s   (esperado %s)' % (monto, monto_esp))
                self.stdout.write('        moneda   : %s   (esperado %s)' % (moneda, moneda_esp))
                fallas += 1

        # ── Las OC de proveedor, que son la otra mitad de la utilidad ──
        from app.services_financiero import (
            _detectar_tipo_financiero, _detectar_tipo_por_contenido,
            _detectar_moneda,
        )
        for desc, nombre, texto, monto_esp, moneda_esp, num_esp in CASOS_OC:
            tipo = _detectar_tipo_financiero(nombre) or _detectar_tipo_por_contenido(texto)
            moneda = _detectar_moneda(texto)
            # Lo mas importante de estas dos: que NO se cuenten como PO del
            # cliente. Comparten el titulo "Orden de compra", y colarse ahi
            # inflaba el monto de la oportunidad y dejaba la utilidad sin
            # calcular, porque el archivo ya no llegaba al modulo financiero.
            como_po = es_po_de_cliente(nombre, texto)
            bien = tipo == 'oc' and moneda == moneda_esp and not como_po
            if bien and not verboso:
                continue
            estilo = self.style.SUCCESS if bien else self.style.ERROR
            self.stdout.write(estilo('%-5s %s' % ('ok' if bien else 'FALLA', desc)))
            if not bien:
                self.stdout.write('        archivo  : %s' % nombre)
                self.stdout.write('        tipo     : %s   (esperado oc)' % tipo)
                self.stdout.write('        moneda   : %s   (esperado %s)' % (moneda, moneda_esp))
                if como_po:
                    self.stdout.write(self.style.ERROR(
                        '        ¡SE CUENTA COMO PO DEL CLIENTE! Sumaria como ingreso.'))
                fallas += 1

        total = len(CASOS_REALES) + len(CASOS_OC)
        if fallas:
            self.stdout.write(self.style.ERROR(
                '\n%d de %d formatos reales FALLAN.' % (fallas, total)))
        else:
            self.stdout.write(self.style.SUCCESS(
                '\nLos %d formatos reales se leen correctamente '
                '(%d PO del cliente, %d OC a proveedor).'
                % (total, len(CASOS_REALES), len(CASOS_OC))))

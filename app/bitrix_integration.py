import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

BITRIX_WEBHOOK_URL = os.getenv("BITRIX_WEBHOOK_URL")

def get_or_create_bitrix_company(company_name):
    if not BITRIX_WEBHOOK_URL:
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    # La URL para buscar compañías es crm.company.list
    search_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.company.list.json")
    # La URL para crear compañías es crm.company.add
    add_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.company.add.json")

    # 1. Buscar la compañía
    try:
        search_response = requests.post(search_url, json={'filter': {'TITLE': company_name}})
        search_response.raise_for_status()
        companies = search_response.json().get('result', [])

        if companies:
            company_id = companies[0]['ID']
            print(f"DEBUG Bitrix: Compañía '{company_name}' encontrada con ID: {company_id}")
            return company_id
    except requests.exceptions.RequestException as e:
        print(f"Error al buscar compañía en Bitrix24: {e}")
        return None

    # 2. Si no se encuentra, crear la compañía
    try:
        add_response = requests.post(add_url, json={'fields': {'TITLE': company_name}})
        add_response.raise_for_status()
        new_company_id = add_response.json().get('result')
        print(f"DEBUG Bitrix: Compañía '{company_name}' creada con ID: {new_company_id}")
        return new_company_id
    except requests.exceptions.RequestException as e:
        print(f"Error al crear compañía en Bitrix24: {e}")
        return None

def send_opportunity_to_bitrix(opportunity_data):
    if not BITRIX_WEBHOOK_URL:
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return

    # Mapeo de valores de Django a IDs de Bitrix24
    producto_map = {
        'ZEBRA': '176',
        'PANDUIT': '178',
        'APC': '180',
        'AVIGILION': '182',
        'GENETEC': '184',
        'AXIS': '186',
        'SOFTWARE': '188',
        'RUNRATE': '190',
        'PÓLIZA': '192',
        'CISCO': '194',
    }

    area_map = {
        'SISTEMAS': '164',
        'Recursos Humanos': '166',
        'Compras': '168',
        'Seguridad': '170',
        'Mantenimiento': '172',
        'Almacén': '174',
    }

    mes_cierre_map = {
        '01': '196',
        '02': '198',
        '03': '200',
        '04': '202',
        '05': '204',
        '06': '206',
        '07': '208',
        '08': '210',
        '09': '212',
        '10': '214',
        '11': '216',
        '12': '218',
    }

    probabilidad_map = {
        0: '220',
        10: '124',
        20: '126',
        30: '128',
        40: '130',
        50: '132',
        60: '134',
        70: '136',
        80: '138',
        90: '140',
        100: '142',
    }

    # Obtener el ID de la compañía en Bitrix24
    bitrix_company_id = None
    if opportunity_data.get('cliente'):
        bitrix_company_id = get_or_create_bitrix_company(opportunity_data['cliente'])

    # Obtener el ID del producto mapeado
    product_value = opportunity_data.get('producto')
    bitrix_product_id = producto_map.get(product_value)
    print(f"DEBUG Bitrix: Valor de producto recibido: '{product_value}', Mapeado a ID: '{bitrix_product_id}'")

    # Obtener el ID del área mapeado
    area_value = opportunity_data.get('area')
    bitrix_area_id = area_map.get(area_value)
    print(f"DEBUG Bitrix: Valor de área recibido: '{area_value}', Mapeado a ID: '{bitrix_area_id}'")

    # Obtener el ID del mes de cierre mapeado
    mes_cierre_value = opportunity_data.get('mes_cierre')
    bitrix_mes_cierre_id = mes_cierre_map.get(mes_cierre_value)
    print(f"DEBUG Bitrix: Valor de mes de cierre recibido: '{mes_cierre_value}', Mapeado a ID: '{bitrix_mes_cierre_id}'")

    # Obtener el ID de la probabilidad mapeado
    probabilidad_value = opportunity_data.get('probabilidad_cierre')
    bitrix_probabilidad_id = probabilidad_map.get(probabilidad_value)
    print(f"DEBUG Bitrix: Valor de probabilidad recibido: '{probabilidad_value}', Mapeado a ID: '{bitrix_probabilidad_id}'")

    data = {
        'fields': {
            "TITLE": opportunity_data.get('oportunidad'),
            "OPPORTUNITY": opportunity_data.get('monto'),
            "CURRENCY_ID": "USD",
            "ASSIGNED_BY_ID": 1,
            "COMMENTS": opportunity_data.get('comentarios'),
        }
    }

    if bitrix_company_id:
        data['fields']["COMPANY_ID"] = bitrix_company_id

    if bitrix_product_id:
        data['fields']["UF_CRM_1752859685662"] = bitrix_product_id

    if bitrix_area_id:
        data['fields']["UF_CRM_1752859525038"] = bitrix_area_id

    if bitrix_mes_cierre_id:
        data['fields']["UF_CRM_1752859877756"] = bitrix_mes_cierre_id

    if bitrix_probabilidad_id:
        data['fields']["UF_CRM_1752855787179"] = bitrix_probabilidad_id

    print(f"DEBUG Bitrix: Datos finales enviados a Bitrix24: {json.dumps(data, indent=2)}")
    try:
        response = requests.post(BITRIX_WEBHOOK_URL, json=data)
        response.raise_for_status()
        print(f"DEBUG Bitrix: Oportunidad enviada a Bitrix24 con éxito: {response.json()}")
    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Error al enviar la oportunidad a Bitrix24: {e}")
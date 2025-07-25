import os
import requests
import json
from dotenv import load_dotenv

from django.http import JsonResponse

load_dotenv()

BITRIX_WEBHOOK_URL = os.getenv("BITRIX_WEBHOOK_URL")

def get_or_create_bitrix_company(company_name):
    normalized_company_name = company_name.strip().upper() # Normalizar el nombre

    if not BITRIX_WEBHOOK_URL:
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    # La URL para buscar compañías es crm.company.list
    search_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.company.list.json")
    # La URL para crear compañías es crm.company.add
    add_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.company.add.json")

    # 1. Buscar la compañía usando el nombre normalizado
    try:
        search_response = requests.post(search_url, json={'filter': {'TITLE': normalized_company_name}})
        search_response.raise_for_status()
        companies = search_response.json().get('result', [])

        if companies:
            company_id = companies[0]['ID']
            print(f"DEBUG Bitrix: Compañía '{normalized_company_name}' encontrada con ID: {company_id}")
            return company_id
    except requests.exceptions.RequestException as e:
        print(f"Error al buscar compañía en Bitrix24: {e}")
        return None

    # 2. Si no se encuentra, crear la compañía con el nombre normalizado
    try:
        add_response = requests.post(add_url, json={'fields': {'TITLE': normalized_company_name}})
        add_response.raise_for_status()
        new_company_id = add_response.json().get('result')
        print(f"DEBUG Bitrix: Compañía '{normalized_company_name}' creada con ID: {new_company_id}")
        return new_company_id
    except requests.exceptions.RequestException as e:
        print(f"Error al crear compañía en Bitrix24: {e}")
        return None

def _get_bitrix_mapped_data(opportunity_data):
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

    bitrix_company_id = opportunity_data.get('bitrix_company_id')
    if not bitrix_company_id and opportunity_data.get('cliente'):
        bitrix_company_id = get_or_create_bitrix_company(opportunity_data['cliente'])

    product_value = opportunity_data.get('producto')
    bitrix_product_id = producto_map.get(product_value)
    print(f"DEBUG Bitrix: Valor de producto recibido: '{product_value}', Mapeado a ID: '{bitrix_product_id}'")

    area_value = opportunity_data.get('area')
    bitrix_area_id = area_map.get(area_value)
    print(f"DEBUG Bitrix: Valor de área recibido: '{area_value}', Mapeado a ID: '{bitrix_area_id}'")

    mes_cierre_value = opportunity_data.get('mes_cierre')
    bitrix_mes_cierre_id = mes_cierre_map.get(mes_cierre_value)
    print(f"DEBUG Bitrix: Valor de mes de cierre recibido: '{mes_cierre_value}', Mapeado a ID: '{bitrix_mes_cierre_id}'")

    probabilidad_value = opportunity_data.get('probabilidad_cierre')
    bitrix_probabilidad_id = probabilidad_map.get(probabilidad_value)
    print(f"DEBUG Bitrix: Valor de probabilidad recibido: '{probabilidad_value}', Mapeado a ID: '{bitrix_probabilidad_id}'")

    fields = {
        "TITLE": opportunity_data.get('oportunidad'),
        "OPPORTUNITY": opportunity_data.get('monto'),
        "CURRENCY_ID": "USD",
        "ASSIGNED_BY_ID": 1,
        "COMMENTS": opportunity_data.get('comentarios'),
    }

    if bitrix_company_id:
        fields["COMPANY_ID"] = bitrix_company_id

    if bitrix_product_id:
        fields["UF_CRM_1752859685662"] = bitrix_product_id

    if bitrix_area_id:
        fields["UF_CRM_1752859525038"] = bitrix_area_id

    if bitrix_mes_cierre_id:
        fields["UF_CRM_1752859877756"] = bitrix_mes_cierre_id

    if bitrix_probabilidad_id:
        fields["UF_CRM_1752855787179"] = bitrix_probabilidad_id

    if opportunity_data.get('bitrix_stage_id'):
        fields["STAGE_ID"] = opportunity_data.get('bitrix_stage_id')

    return fields

def send_opportunity_to_bitrix(opportunity_data):
    if not BITRIX_WEBHOOK_URL:
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    fields = _get_bitrix_mapped_data(opportunity_data)
    data = {'fields': fields}

    print(f"DEBUG Bitrix: Datos finales enviados a Bitrix24 (ADD): {json.dumps(data, indent=2)}")
    try:
        response = requests.post(BITRIX_WEBHOOK_URL, json=data)
        response.raise_for_status()
        json_response = response.json()
        print(f"DEBUG Bitrix: Oportunidad enviada a Bitrix24 con éxito: {json_response}")
        return json_response
    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Error al enviar la oportunidad a Bitrix24: {e}")
        return None

def update_opportunity_in_bitrix(bitrix_deal_id, opportunity_data):
    if not BITRIX_WEBHOOK_URL:
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return False

    update_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.update.json")

    fields = _get_bitrix_mapped_data(opportunity_data)
    data = {
        'id': bitrix_deal_id,
        'fields': fields
    }

    print(f"DEBUG Bitrix: Datos finales enviados a Bitrix24 (UPDATE): {json.dumps(data, indent=2)}")
    try:
        response = requests.post(update_url, json=data)
        response.raise_for_status()
        json_response = response.json()
        print(f"DEBUG Bitrix: Oportunidad actualizada en Bitrix24 con éxito: {json_response}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Error al actualizar la oportunidad en Bitrix24: {e}")
        return False

def get_bitrix_companies_api(request):
    query = request.GET.get('q', '')
    if not BITRIX_WEBHOOK_URL:
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return JsonResponse({'error': 'Bitrix webhook URL not configured'}, status=500)

    search_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.company.list.json")
    
    payload = {'select': ['ID', 'TITLE']}
    if query:
        payload['filter'] = {'TITLE': f'%{query.upper()}%'}

    try:
        response = requests.post(search_url, json=payload)
        response.raise_for_status()
        companies = response.json().get('result', [])
        return JsonResponse([{'id': c['ID'], 'name': c['TITLE']} for c in companies], safe=False)
    except requests.exceptions.RequestException as e:
        print(f"Error al buscar compañías en Bitrix24: {e}")
        return JsonResponse({'error': str(e)}, status=500)
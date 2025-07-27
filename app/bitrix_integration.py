import os
import requests
import json
from dotenv import load_dotenv
from django.contrib import messages

from django.http import JsonResponse

load_dotenv()

BITRIX_WEBHOOK_URL = os.getenv("BITRIX_WEBHOOK_URL")

def get_or_create_bitrix_company(company_name, request=None):
    normalized_company_name = company_name.strip().upper() # Normalizar el nombre

    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
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

def get_bitrix_users(request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return []

    users_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "user.get.json")
    try:
        response = requests.post(users_url)
        response.raise_for_status()
        users = response.json().get('result', [])
        return [{'id': user['ID'], 'name': f"{user.get('NAME', '')} {user.get('LAST_NAME', '')}".strip()} for user in users]
    except requests.exceptions.RequestException as e:
        print(f"Error al obtener usuarios de Bitrix24: {e}")
        if request:
            messages.error(request, f"Error al obtener usuarios de Bitrix24: {e}")
        return []

def upload_file_to_bitrix_deal_field(bitrix_deal_id, file_field_id, file_name, file_content_base64, request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada para subir archivos.")
        print("Error: La URL del webhook de Bitrix24 no está configurada para subir archivos.")
        return False

    update_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.update.json")

    # El formato para subir archivos a campos de tipo 'file' es una lista de listas:
    # [[file_name, base64_content]]
    file_data_payload = [[file_name, file_content_base64]]

    data = {
        'id': bitrix_deal_id,
        'fields': {
            file_field_id: file_data_payload
        }
    }

    print(f"DEBUG Bitrix: Intentando subir archivo a Bitrix24 (UPDATE con archivo): {json.dumps(data, indent=2)}")
    try:
        response = requests.post(update_url, json=data)
        response.raise_for_status()
        json_response = response.json()
        if json_response.get('result'):
            print(f"DEBUG Bitrix: Archivo '{file_name}' subido con éxito a la negociación {bitrix_deal_id}.")
            return True
        else:
            print(f"DEBUG Bitrix: Error al subir archivo '{file_name}' a la negociación {bitrix_deal_id}: {json_response.get('error_description', json_response)}")
            if request:
                messages.error(request, f"Error al subir archivo a Bitrix24: {json_response.get('error_description', 'Error desconocido')}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Excepción al subir archivo a Bitrix24: {e}")
        if request:
            messages.error(request, f"Excepción al subir archivo a Bitrix24: {e}")
        return False

def _get_bitrix_mapped_data(opportunity_data, request=None):
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
        bitrix_company_id = get_or_create_bitrix_company(opportunity_data['cliente'], request=request)

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
        "COMMENTS": opportunity_data.get('comentarios'),
    }

    # Asignar el usuario responsable de Bitrix si se proporciona
    bitrix_assigned_by_id = opportunity_data.get('bitrix_assigned_by_id')
    if bitrix_assigned_by_id:
        fields["ASSIGNED_BY_ID"] = bitrix_assigned_by_id
    else:
        # Valor por defecto si no se proporciona un ID de Bitrix (ej. el admin o un usuario genérico)
        fields["ASSIGNED_BY_ID"] = 1 # ID del administrador o un usuario por defecto en Bitrix

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

def send_opportunity_to_bitrix(opportunity_data, request=None, file_data=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    fields = _get_bitrix_mapped_data(opportunity_data, request=request)
    data = {'fields': fields}

    print(f"DEBUG Bitrix: Datos finales enviados a Bitrix24 (ADD): {json.dumps(data, indent=2)}")
    try:
        response = requests.post(BITRIX_WEBHOOK_URL, json=data)
        response.raise_for_status()
        json_response = response.json()
        print(f"DEBUG Bitrix: Oportunidad enviada a Bitrix24 con éxito: {json_response}")

        bitrix_deal_id = json_response.get('result')
        if bitrix_deal_id and file_data:
            file_name = file_data['name']
            file_content_base64 = file_data['content']
            # Usar el ID del campo personalizado de archivo que identificamos
            file_field_id = "UF_CRM_1753490093"
            upload_file_to_bitrix_deal_field(bitrix_deal_id, file_field_id, file_name, file_content_base64, request=request)

        return json_response
    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Error al enviar la oportunidad a Bitrix24: {e}")
        return None

def update_opportunity_in_bitrix(bitrix_deal_id, opportunity_data, request=None, file_data=None):
    from django.contrib import messages # Import messages here
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return False

    update_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.update.json")

    fields = _get_bitrix_mapped_data(opportunity_data, request=request)
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

        if file_data:
            file_name = file_data['name']
            file_content_base64 = file_data['content']
            # Usar el ID del campo personalizado de archivo que identificamos
            file_field_id = "UF_CRM_1753490093"
            upload_file_to_bitrix_deal_field(bitrix_deal_id, file_field_id, file_name, file_content_base64, request=request)

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
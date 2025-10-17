import os
import requests
import json
import base64
from django.contrib import messages
import time

from django.http import JsonResponse


BITRIX_WEBHOOK_URL = os.getenv("BITRIX_WEBHOOK_URL")
BITRIX_PROJECTS_WEBHOOK_URL = os.getenv("BITRIX_PROJECTS_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json")
BITRIX_DISK_UPLOAD_WEBHOOK_URL = os.getenv("BITRIX_DISK_UPLOAD_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/uti3hluszm31h1xr/disk.folder.uploadfile.json")

def get_or_create_bitrix_company(company_name, email=None, contact_name=None, request=None):
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
        company_fields = {'TITLE': normalized_company_name}
        if email:
            company_fields['EMAIL'] = [{'VALUE': email, 'VALUE_TYPE': 'WORK'}]
        add_response = requests.post(add_url, json={'fields': company_fields})
        add_response.raise_for_status()
        new_company_id = add_response.json().get('result')
        print(f"DEBUG Bitrix: Compañía '{normalized_company_name}' creada con ID: {new_company_id}")

        if new_company_id and contact_name:
            create_bitrix_contact(new_company_id, contact_name, email, request=request)

        return new_company_id
    except requests.exceptions.RequestException as e:
        print(f"Error al crear compañía en Bitrix24: {e}")
        return None

def create_bitrix_contact(company_id, contact_name, email, request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    add_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.contact.add.json")

    contact_fields = {
        'NAME': contact_name,
        'COMPANY_ID': company_id,
        'EMAIL': [{'VALUE': email, 'VALUE_TYPE': 'WORK'}]
    }

    try:
        response = requests.post(add_url, json={'fields': contact_fields})
        response.raise_for_status()
        new_contact_id = response.json().get('result')
        print(f"DEBUG Bitrix: Contacto '{contact_name}' creado con ID: {new_contact_id}")
        return new_contact_id
    except requests.exceptions.RequestException as e:
        print(f"Error al crear contacto en Bitrix24: {e}")
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
        'Enero': '196',
        'Febrero': '198',
        'Marzo': '200',
        'Abril': '202',
        'Mayo': '204',
        'Junio': '206',
        'Julio': '208',
        'Agosto': '210',
        'Septiembre': '212',
        'Octubre': '214',
        'Noviembre': '216',
        'Diciembre': '218',
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

    # Mapeo para tipos de negociación (CATEGORY_ID en Bitrix24)
    tipo_negociacion_map = {
        'runrate': '1',    # ID del pipeline de Runrate en Bitrix24
        'proyecto': '2',   # ID del pipeline de Proyecto en Bitrix24
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

    tipo_negociacion_value = opportunity_data.get('tipo_negociacion')
    bitrix_category_id = tipo_negociacion_map.get(tipo_negociacion_value)
    print(f"DEBUG Bitrix: Valor de tipo de negociación recibido: '{tipo_negociacion_value}', Mapeado a CATEGORY_ID: '{bitrix_category_id}'")

    # Agregar indicador Nethive a los comentarios para mayor visibilidad
    comentarios_originales = opportunity_data.get('comentarios', '')
    comentarios_con_nethive = f"🌐 Creado desde Nethive\n\n{comentarios_originales}".strip()
    
    fields = {
        "TITLE": opportunity_data.get('oportunidad'),
        "OPPORTUNITY": opportunity_data.get('monto'),
        "CURRENCY_ID": "USD",
        "COMMENTS": comentarios_con_nethive,
        "TAG": ["Nethive"],  # Etiqueta para identificar que se creó desde Nethive
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

    if bitrix_category_id:
        fields["CATEGORY_ID"] = bitrix_category_id

    if opportunity_data.get('bitrix_stage_id'):
        fields["STAGE_ID"] = opportunity_data.get('bitrix_stage_id')

    bitrix_contact_id = opportunity_data.get('bitrix_contact_id')
    if bitrix_contact_id:
        fields["CONTACT_ID"] = bitrix_contact_id # Assuming CONTACT_ID is the field name in Bitrix

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

def get_bitrix_deal_details(deal_id, request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    get_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.get.json")
    try:
        response = requests.post(get_url, json={
            'id': deal_id,
            'select': [
                'ID', 'TITLE', 'OPPORTUNITY', 'CURRENCY_ID', 'COMMENTS',
                'COMPANY_ID', 'CONTACT_ID', 'ASSIGNED_BY_ID', 'STAGE_ID', 'CATEGORY_ID',
                'UF_CRM_1752859685662',  # Producto (Runrate)
                'UF_CRM_1750723256972',  # Solución (Proyectos)
                'UF_CRM_1752859525038',  # Área
                'UF_CRM_1752859877756',  # Mes de Cobro
                'UF_CRM_1752855787179',  # Probabilidad de cierre
            ]
        })
        response.raise_for_status()
        return response.json().get('result')
    except requests.exceptions.RequestException as e:
        print(f"Error al obtener detalles de la oportunidad de Bitrix24: {e}")
        if request:
            messages.error(request, f"Error al obtener detalles de la oportunidad de Bitrix24: {e}")
        return None

def get_bitrix_company_details(company_id, request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    get_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.company.get.json")
    try:
        print(f"DEBUG Bitrix: Solicitando detalles de compañía {company_id} a: {get_url}")
        response = requests.post(get_url, json={'id': company_id})
        response.raise_for_status()
        json_response = response.json()
        print(f"DEBUG Bitrix: Respuesta de Bitrix para compañía {company_id}: {json.dumps(json_response, indent=2)}")
        return json_response.get('result')
    except requests.exceptions.RequestException as e:
        print(f"Error al obtener detalles de la compañía de Bitrix24: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                print(f"DEBUG Bitrix: Contenido de la respuesta de error: {e.response.text}")
                error_json = e.response.json()
                print(f"DEBUG Bitrix: JSON de la respuesta de error: {json.dumps(error_json, indent=2)}")
            except json.JSONDecodeError:
                pass
        if request:
            messages.error(request, f"Error al obtener detalles de la compañía de Bitrix24: {e}")
        return None

def get_all_bitrix_companies(request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return []

    list_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.company.list.json")
    companies = []
    start = 0

    while True:
        try:
            response = requests.post(list_url, json={
                'select': ['ID', 'TITLE'],
                'start': start
            })
            response.raise_for_status()
            result = response.json()
            companies.extend(result.get('result', []))

            if 'next' in result:
                start = result['next']
            else:
                break
        except requests.exceptions.RequestException as e:
            print(f"Error al obtener compañías de Bitrix24: {e}")
            if request:
                messages.error(request, f"Error al obtener compañías de Bitrix24: {e}")
            return []

    return companies

def get_all_bitrix_contacts(request=None, company_id=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return []

    list_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.contact.list.json")
    contacts = []
    start = 0

    payload = {'select': ['ID', 'NAME', 'LAST_NAME', 'COMPANY_ID']}
    if company_id:
        payload['filter'] = {'COMPANY_ID': company_id}

    while True:
        payload['start'] = start
        try:
            response = requests.post(list_url, json=payload)
            response.raise_for_status()
            result = response.json()
            contacts.extend(result.get('result', []))

            if 'next' in result:
                start = result['next']
            else:
                break
        except requests.exceptions.RequestException as e:
            print(f"Error al obtener contactos de Bitrix24: {e}")
            if request:
                messages.error(request, f"Error al obtener contactos de Bitrix24: {e}")
            return []

    return contacts

def get_all_bitrix_deals(request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return []

    list_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.list.json")
    deals = []
    start = 0

    while True:
        try:
            response = requests.post(list_url, json={
                'select': [
                    'ID', 'TITLE', 'OPPORTUNITY', 'CURRENCY_ID', 'COMMENTS',
                    'COMPANY_ID', 'CONTACT_ID', 'ASSIGNED_BY_ID', 'STAGE_ID', 'CATEGORY_ID',
                    'UF_CRM_1752859685662', # Producto (Runrate)
                    'UF_CRM_1750723256972', # Solución (Proyectos)
                    'UF_CRM_1752859525038',  # Área
                    'UF_CRM_1752859877756',  # Mes de Cobro
                    'UF_CRM_1752855787179',  # Probabilidad de cierre
                ],
                'start': start
            })
            response.raise_for_status()
            result = response.json()
            deals.extend(result.get('result', []))

            if 'next' in result:
                start = result['next']
            else:
                break
        except requests.exceptions.RequestException as e:
            print(f"Error al obtener oportunidades de Bitrix24: {e}")
            if request:
                messages.error(request, f"Error al obtener oportunidades de Bitrix24: {e}")
            return []

    return deals

def get_bitrix_user_details(user_id, request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    get_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "user.get.json")
    try:
        response = requests.post(get_url, json={'ID': user_id})
        response.raise_for_status()
        users = response.json().get('result')
        if users:
            return users[0] # user.get returns a list
        return None
    except requests.exceptions.RequestException as e:
        print(f"Error al obtener detalles del usuario de Bitrix24: {e}")
        if request:
            messages.error(request, f"Error al obtener detalles del usuario de Bitrix24: {e}")
        return None

def get_bitrix_contact_details(contact_id, request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return None

    get_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.contact.get.json")
    try:
        response = requests.post(get_url, json={'id': contact_id})
        response.raise_for_status()
        return response.json().get('result')
    except requests.exceptions.RequestException as e:
        print(f"Error al obtener detalles del contacto de Bitrix24: {e}")
        if request:
            messages.error(request, f"Error al obtener detalles del contacto de Bitrix24: {e}")
        return None

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

def add_comment_with_attachment_to_deal(deal_id, file_name, file_content_base64, comment_text, request=None):
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return False

    # API de Bitrix espera un formato de lista con el nombre y el contenido en base64
    file_data_for_api = [file_name, file_content_base64]

    comment_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.timeline.comment.add")
    comment_data = {
        'fields': {
            'ENTITY_ID': deal_id,
            'ENTITY_TYPE': 'deal',
            'COMMENT': comment_text,
            'FILES': [file_data_for_api]
        }
    }
    
    try:
        print(f"DEBUG Bitrix: Añadiendo comentario con adjunto a la oportunidad {deal_id}.")
        comment_response = requests.post(comment_url, json=comment_data)
        comment_response.raise_for_status()
        
        if 'result' in comment_response.json():
            print(f"Comentario con adjunto añadido con éxito a la oportunidad {deal_id}")
            return True
        else:
            print(f"Error al añadir el comentario a Bitrix: {comment_response.text}")
            if request:
                messages.error(request, f"Error al añadir el comentario a Bitrix: {comment_response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"Excepción al añadir el comentario a Bitrix: {e}")
        if request:
            messages.error(request, f"Excepción al añadir el comentario a Bitrix: {e}")
        return False

def create_bitrix_project(project_name, description=None, vendedor_responsable=None, request=None):
    """
    Crea un proyecto público en Bitrix24
    """
    if not BITRIX_PROJECTS_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de proyectos de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de proyectos de Bitrix24 no está configurada.")
        return None

    # URL para crear grupos de trabajo/proyectos - usar webhook específico para proyectos
    create_url = BITRIX_PROJECTS_WEBHOOK_URL
    
    # Configuración del proyecto PÚBLICO
    project_data = {
        'NAME': project_name,
        'VISIBLE': 'Y',           # Hacer el proyecto visible/público
        'OPENED': 'Y',            # Permitir que otros se unan
        'PROJECT': 'Y',           # Marcar como proyecto (no solo grupo)
        'INITIATE_PERMS': 'E',    # Permisos para todos los empleados
        'SPAM_PERMS': 'E',        # Permisos de publicación para empleados
        'SUBJECT_ID': '1',        # ID del tema del proyecto (1 = general)
    }
    
    # Agregar descripción si se proporciona
    if description:
        project_data['DESCRIPTION'] = description
    
    # Asignar responsable del proyecto (vendedor de la oportunidad)
    if vendedor_responsable:
        try:
            from .models import UserProfile
            profile = UserProfile.objects.get(user=vendedor_responsable)
            if profile.bitrix_user_id:
                project_data['OWNER_ID'] = profile.bitrix_user_id
                print(f"DEBUG Bitrix: Asignando proyecto al vendedor {vendedor_responsable.get_full_name()} (Bitrix ID: {profile.bitrix_user_id})")
            else:
                print(f"WARNING Bitrix: El vendedor {vendedor_responsable.get_full_name()} no tiene bitrix_user_id configurado")
        except UserProfile.DoesNotExist:
            print(f"WARNING Bitrix: No existe perfil para el vendedor {vendedor_responsable.get_full_name()}")
        except Exception as e:
            print(f"WARNING Bitrix: Error obteniendo perfil del vendedor: {e}")
    else:
        print("DEBUG Bitrix: No se especificó vendedor responsable, se asignará al creador del webhook")
    
    try:
        print(f"DEBUG Bitrix: Creando proyecto PÚBLICO '{project_name}' en Bitrix24")
        print(f"DEBUG Bitrix: Parámetros del proyecto: {project_data}")
        response = requests.post(create_url, json=project_data)
        response.raise_for_status()
        json_response = response.json()
        
        if 'result' in json_response:
            project_id = json_response.get('result')
            print(f"DEBUG Bitrix: Proyecto '{project_name}' creado con éxito. ID: {project_id}")
            return project_id
        else:
            print(f"DEBUG Bitrix: Error al crear proyecto: {json_response}")
            if request:
                messages.error(request, f"Error al crear proyecto en Bitrix24: {json_response.get('error_description', 'Error desconocido')}")
            return None
            
    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Excepción al crear proyecto: {e}")
        if request:
            messages.error(request, f"Excepción al crear proyecto en Bitrix24: {e}")
        return None

def upload_file_to_project_drive(project_id, file_name, file_content_base64, request=None, volumetrias_folder_id=None):
    """
    Sube un archivo al drive de un proyecto específico en Bitrix24
    """
    print(f"DEBUG Bitrix: ENTRADA a upload_file_to_project_drive - project_id: {project_id}")
    
    if not BITRIX_PROJECTS_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de proyectos de Bitrix24 no está configurada.")
        print("ERROR Bitrix: La URL del webhook de proyectos de Bitrix24 no está configurada.")
        return False, None
    
    print(f"DEBUG Bitrix: BITRIX_PROJECTS_WEBHOOK_URL configurado: {BITRIX_PROJECTS_WEBHOOK_URL[:50]}...")
    
    # Primero obtener el storage ID del proyecto - usar webhook de proyectos
    storage_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.storage.getlist.json")
    print(f"DEBUG Bitrix: URL para obtener storage: {storage_url[:50]}...")

    try:
        project_storage_id = None
        root_folder_id = None
        max_retries = 3
        retry_delay = 2

        for attempt in range(max_retries):
            try:
                print(f"DEBUG Bitrix: Intento {attempt + 1}/{max_retries} para encontrar storage del proyecto {project_id}")
                storage_response = requests.post(storage_url, json={
                    'filter': {
                        'ENTITY_ID': project_id,
                        'ENTITY_TYPE': 'group'
                    }
                }, timeout=10)
                storage_response.raise_for_status()
                storage_data = storage_response.json()
                print(f"DEBUG Bitrix: Respuesta de disk.storage.getlist para proyecto {project_id}: {json.dumps(storage_data, indent=2)}")
                
                if 'result' in storage_data and len(storage_data['result']) > 0:
                    storage_info = storage_data['result'][0]
                    project_storage_id = storage_info.get('ID')
                    root_folder_id = storage_info.get('ROOT_OBJECT_ID')
                    if project_storage_id:
                        print(f"DEBUG Bitrix: Storage encontrado exitosamente - Storage ID: {project_storage_id}, Root Folder ID: {root_folder_id}")
                        break
                
                if not project_storage_id:
                    print(f"DEBUG Bitrix: Storage no encontrado en intento {attempt + 1}. Reintentando en {retry_delay} segundos...")
                    time.sleep(retry_delay)

            except requests.exceptions.RequestException as e:
                print(f"DEBUG Bitrix: Excepción en intento {attempt + 1} al obtener storage: {e}")
                time.sleep(retry_delay)

        if not project_storage_id:
            print(f"ERROR Bitrix: No se encontró storage para el proyecto {project_id} después de {max_retries} intentos.")
            return False, None
            
        if not root_folder_id:
            print(f"WARNING Bitrix: No se encontró root_folder_id, usando project_storage_id como fallback.")
            root_folder_id = project_storage_id

        # PASO 1: Determinar carpeta destino
        target_folder_id = None
        volumetrias_folder_id_new = None

        if volumetrias_folder_id:
            # Usar carpeta existente (proyecto reutilizado)
            print(f"DEBUG Bitrix: Usando carpeta Volumetrías existente: {volumetrias_folder_id}")
            target_folder_id = volumetrias_folder_id
        else:
            # Crear nueva carpeta "Volumetrías" (proyecto nuevo)
            print(f"DEBUG Bitrix: Creando nueva carpeta 'Volumetrías' en el proyecto...")
            try:
                create_folder_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.folder.addsubfolder.json")
                folder_data = {'id': root_folder_id, 'data': {'NAME': 'Volumetrías'}}
                
                print(f"DEBUG Bitrix: URL crear carpeta: {create_folder_url}")
                print(f"DEBUG Bitrix: Datos carpeta: {folder_data}")
                
                folder_response = requests.post(create_folder_url, json=folder_data, timeout=20)
                print(f"DEBUG Bitrix: Status crear carpeta: {folder_response.status_code}")
                print(f"DEBUG Bitrix: Response crear carpeta: {folder_response.text[:200]}...")
                
                if folder_response.status_code == 200:
                    folder_result = folder_response.json()
                    if 'result' in folder_result and folder_result['result']:
                        volumetrias_folder_id_new = folder_result['result']['ID']
                        print(f"SUCCESS Bitrix: Carpeta 'Volumetrías' creada con ID: {volumetrias_folder_id_new}")
                    elif 'error' in folder_result and 'already exists' in str(folder_result['error']).lower():
                        print(f"INFO Bitrix: Carpeta 'Volumetrías' ya existe, buscándola...")
                        search_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.folder.getchildren.json")
                        search_response = requests.post(search_url, json={'id': root_folder_id}, timeout=20)
                        if search_response.status_code == 200:
                            search_result = search_response.json()
                            if 'result' in search_result:
                                for item in search_result['result']:
                                    if item.get('NAME') == 'Volumetrías' and item.get('TYPE') == 'folder':
                                        volumetrias_folder_id_new = item.get('ID')
                                        print(f"SUCCESS Bitrix: Carpeta 'Volumetrías' encontrada con ID: {volumetrias_folder_id_new}")
                                        break
            except Exception as e:
                print(f"WARNING Bitrix: Error creando o buscando carpeta 'Volumetrías': {e}")
            
            target_folder_id = volumetrias_folder_id_new if volumetrias_folder_id_new else root_folder_id
        
        print(f"DEBUG Bitrix: Subiendo archivo a la carpeta ID: {target_folder_id}")

        # PASO 2: Subir archivo a la carpeta correcta
        try:
            simple_upload_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.folder.uploadfile.json")
            simple_data = {
                'id': target_folder_id,
                'fileContent': [file_name, file_content_base64],
                'data': {'NAME': file_name}
            }
            
            response = requests.post(simple_upload_url, json=simple_data, timeout=30)
            
            print(f"DEBUG Bitrix: Status de subida: {response.status_code}")
            print(f"DEBUG Bitrix: Response de subida: {response.text[:200]}...")
            
            if response.status_code == 200 and 'result' in response.json() and response.json()['result']:
                print(f"SUCCESS Bitrix: Archivo subido exitosamente a la carpeta {target_folder_id}")
                return True, target_folder_id
            else:
                print(f"ERROR Bitrix: Falló la subida a la carpeta {target_folder_id}. Body: {response.text}")
                return False, None
                
        except Exception as e:
            print(f"ERROR Bitrix: Excepción en la subida de archivo: {e}")
            return False, None

    except Exception as e:
        print(f"ERROR Bitrix: Excepción general en upload_file_to_project_drive: {e}")
        import traceback
        traceback.print_exc()
        if request:
            messages.error(request, f"Excepción al subir archivo al proyecto: {e}")
        return False, None

def create_project_and_upload_volumetria(project_name, file_name, file_content_base64, description=None, vendedor_responsable=None, request=None):
    """
    Función completa que crea un proyecto y sube la volumetría
    """
    print(f"DEBUG Bitrix: Iniciando creación de proyecto y subida de volumetría")
    
    # 1. Crear el proyecto
    project_id = create_bitrix_project(project_name, description, vendedor_responsable, request)
    if not project_id:
        return None
        
    # Add a delay here
    print(f"DEBUG Bitrix: Proyecto {project_id} creado. Esperando 5 segundos para que el storage esté disponible...")
    time.sleep(5)
        
    # 2. Subir el archivo al drive del proyecto
    upload_success = upload_file_to_project_drive(project_id, file_name, file_content_base64, request)
    
    if upload_success:
        print(f"DEBUG Bitrix: Proceso completo exitoso. Proyecto {project_id} creado con archivo '{file_name}'")
        return {
            'project_id': project_id,
            'project_name': project_name,
            'file_uploaded': True
        }
    else:
        print(f"DEBUG Bitrix: Proyecto creado pero falló la subida del archivo")
        return {
            'project_id': project_id,
            'project_name': project_name,
            'file_uploaded': False
        }
    return None

def delete_opportunity_from_bitrix(bitrix_deal_id, request=None):
    """
    Elimina una oportunidad de Bitrix24
    """
    if not BITRIX_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de Bitrix24 no está configurada.")
        return False

    delete_url = BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", "crm.deal.delete.json")
    
    try:
        response = requests.post(delete_url, json={'id': bitrix_deal_id})
        response.raise_for_status()
        json_response = response.json()
        
        if json_response.get('result'):
            print(f"DEBUG Bitrix: Oportunidad {bitrix_deal_id} eliminada de Bitrix24 con éxito")
            return True
        else:
            print(f"DEBUG Bitrix: Error al eliminar oportunidad {bitrix_deal_id} de Bitrix24: {json_response.get('error_description', json_response)}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Error al eliminar oportunidad {bitrix_deal_id} de Bitrix24: {e}")
        return False

def map_bitrix_category_to_tipo_negociacion(category_id):
    """
    Mapea el CATEGORY_ID de Bitrix24 al tipo_negociacion local
    """
    category_map_reverse = {
        '1': 'runrate',    # Pipeline de Runrate en Bitrix24
        '2': 'proyecto',   # Pipeline de Proyecto en Bitrix24
    }
    
    mapped_value = category_map_reverse.get(str(category_id), 'runrate')  # Default a runrate
    print(f"DEBUG Bitrix: CATEGORY_ID {category_id} mapeado a tipo_negociacion: {mapped_value}")
    return mapped_value

def get_producto_from_bitrix_deal(deal_details, tipo_negociacion):
    """
    Extrae el producto/solución según el tipo de negociación
    """
    # Mapeo para Runrate (campo Producto)
    PRODUCTO_RUNRATE_BITRIX_ID_TO_DJANGO_VALUE = {
        "176": "ZEBRA", "178": "PANDUIT", "180": "APC", "182": "AVIGILION",
        "184": "GENETEC", "186": "AXIS", "188": "SOFTWARE", "190": "RUNRATE",
        "192": "PÓLIZA", "194": "CISCO", "374": "RFID", "376": "CONSUMIBLE",
        "378": "IMPRESORA INDUSTRIAL", "380": "SCANNER", "382": "TABLETA",
        "582": "SERVICIO",
    }
    
    # Mapeo para Proyectos (campo Solución) - IDs completamente diferentes
    SOLUCION_PROYECTO_BITRIX_ID_TO_DJANGO_VALUE = {
        "44": "ZEBRA", "46": "PANDUIT", "48": "APC", "50": "AVIGILION",
        "52": "GENETEC", "54": "AXIS", "56": "SOFTWARE", "58": "RUNRATE",
        "60": "CISCO", "62": "PÓLIZA", "578": "SERVICIO",
    }
    
    if tipo_negociacion == 'proyecto':
        # Para proyectos, usar el campo "Solución"
        solucion_bitrix_id = deal_details.get('UF_CRM_1750723256972')
        print(f"DEBUG Bitrix: Proyecto - Raw solución ID: {solucion_bitrix_id}")
        producto = SOLUCION_PROYECTO_BITRIX_ID_TO_DJANGO_VALUE.get(str(solucion_bitrix_id), 'SOFTWARE')
        print(f"DEBUG Bitrix: Proyecto - Solución mapeada: {producto}")
    else:
        # Para runrate, usar el campo "Producto"
        producto_bitrix_id = deal_details.get('UF_CRM_1752859685662')
        print(f"DEBUG Bitrix: Runrate - Raw producto ID: {producto_bitrix_id}")
        producto = PRODUCTO_RUNRATE_BITRIX_ID_TO_DJANGO_VALUE.get(str(producto_bitrix_id), 'SOFTWARE')
        print(f"DEBUG Bitrix: Runrate - Producto mapeado: {producto}")
    
    return producto

def get_etapa_from_bitrix_stage(stage_id, tipo_negociacion):
    """
    Mapea el STAGE_ID de Bitrix24 a etapa legible según el tipo de negociación
    Retorna tupla: (etapa_corta, etapa_completa, color)
    """
    
    # Mapeo para Runrate
    RUNRATE_STAGES = {
        "NEW": ("Inicial", "Solicitud de Cotizacion", "#FFFFFF"),
        "UC_YUQKW6": ("Cotizando", "Cotizando", "#FFEB3B"),
        "UC_H8L1Z8": ("Enviada", "Cotización Enviada", "#2196F3"),
        "UC_RFMQC1": ("Seguimiento", "Seguimiento de Cotización", "#FF9800"),
        "UC_J7Q5HD": ("Vendido s/PO", "Vendido sin PO", "#9C27B0"),
        "UC_AO5AY3": ("Vendido c/PO", "Vendido con PO", "#9C27B0"),
        "PREPARATION": ("En Tránsito", "Vendido en Transito con Proveedor", "#673AB7"),
        "PREPAYMENT_INVOICE": ("Facturado", "Facturado", "#00BCD4"),
        "1": ("Programado", "Programado para entrega", "#03DAC6"),
        "EXECUTING": ("Entregado", "Entregado", "#4CAF50"),
        "FINAL_INVOICE": ("Esperando Pago", "Esperando Pago", "#8BC34A"),
        "4": ("Sin Respuesta", "Sin respuesta", "#607D8B"),
        "WON": ("Ganado", "Cerrado Ganado", "#4CAF50"),
        "LOSE": ("Perdido", "Cerrado Perdido", "#F44336"),
    }
    
    # Mapeo para Proyectos
    PROYECTO_STAGES = {
        "C2:NEW": ("Oportunidad", "Oportunidad", "#FFFFFF"),
        "C2:PREPARATION": ("Levantamiento", "Levantamiento", "#FF5C5A"),
        "C2:PREPAYMENT_INVOICE": ("Base Cotización", "Generando Base para cotizacion", "#55D0E0"),
        "C2:EXECUTING": ("Cotizando", "Cotizando", "#2fc6f6"),
        "C2:FINAL_INVOICE": ("Enviada", "Cotización Enviada", "#2FC6F6"),
        "C2:1": ("Seguimiento", "En seguimiento", "#39A8EF"),
        "C2:2": ("Vendido s/PO", "Vendido sin PO", "#FF00FF"),
        "C2:3": ("Vendido c/PO", "Vendido con PO", "#FF00FF"),
        "C2:UC_WC03GH": ("Cotiz. Proveedor", "Cotizando con Proveedor", "#a861ab"),
        "C2:4": ("Comprando", "Comprando Materiales", "#2FC6F6"),
        "C2:UC_6OQCDL": ("Nombre", "Nombre", "#ace9fb"),
        "C2:5": ("En Tránsito", "Materiales en Transito", "#2FC6F6"),
        "C2:6": ("Ejecutando", "En Ejecución", "#FFFF00"),
        "C2:7": ("Entregado", "Proyecto Entregado", "#2FC6F6"),
        "C2:8": ("Facturado", "Facturado", "#55D0E0"),
        "C2:9": ("Reportes", "Reportes y Certificaciones", "#47E4C2"),
        "C2:11": ("Perdido", "Perdido", "#FF0000"),
        "C2:WON": ("Pagado", "Pagado", "#7BD500"),
        "C2:LOSE": ("Perdido", "Cerrado Perdido", "#FF5752"),
    }
    
    if tipo_negociacion == 'proyecto':
        stage_info = PROYECTO_STAGES.get(stage_id, ("Desconocido", "Etapa desconocida", "#CCCCCC"))
        print(f"DEBUG Bitrix: Proyecto - STAGE_ID {stage_id} mapeado a: {stage_info[0]} ({stage_info[1]})")
    else:
        stage_info = RUNRATE_STAGES.get(stage_id, ("Desconocido", "Etapa desconocida", "#CCCCCC"))
        print(f"DEBUG Bitrix: Runrate - STAGE_ID {stage_id} mapeado a: {stage_info[0]} ({stage_info[1]})")
    
    return stage_info
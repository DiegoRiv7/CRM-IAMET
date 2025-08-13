import os
import requests
import json
from django.contrib import messages
import time

from django.http import JsonResponse


BITRIX_WEBHOOK_URL = os.getenv("BITRIX_WEBHOOK_URL")
BITRIX_PROJECTS_WEBHOOK_URL = os.getenv("BITRIX_PROJECTS_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json")
BITRIX_DISK_UPLOAD_WEBHOOK_URL = os.getenv("BITRIX_DISK_UPLOAD_WEBHOOK_URL")

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
        response = requests.post(get_url, json={'id': deal_id})
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
                    'COMPANY_ID', 'CONTACT_ID', 'ASSIGNED_BY_ID', 'STAGE_ID',
                    'UF_CRM_1752859685662', # Producto
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
    
    # Configuración del proyecto
    project_data = {
        'NAME': project_name,
    }
    
    # Asignar responsable del proyecto (vendedor de la oportunidad)
    if vendedor_responsable:
        try:
            from .models import UserProfile
            profile = UserProfile.objects.get(user=vendedor_responsable)
            if profile.bitrix_user_id:
                project_data['fields']['OWNER_ID'] = profile.bitrix_user_id
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
        print(f"DEBUG Bitrix: Creando proyecto '{project_name}' en Bitrix24")
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

def upload_file_to_project_drive(project_id, file_name, file_content_base64, request=None):
    """
    Sube un archivo al drive de un proyecto específico en Bitrix24
    """
    if not BITRIX_PROJECTS_WEBHOOK_URL:
        if request:
            messages.error(request, "Error: La URL del webhook de proyectos de Bitrix24 no está configurada.")
        print("Error: La URL del webhook de proyectos de Bitrix24 no está configurada.")
        return False

    # Primero obtener el storage ID del proyecto - usar webhook de proyectos
    storage_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.storage.getlist.json")

    try:
        project_storage_id = None
        max_retries = 10
        retry_delay = 5 # seconds

        for attempt in range(max_retries):
            try:
                print(f"DEBUG Bitrix: Intento {attempt + 1}/{max_retries} para encontrar storage del proyecto {project_id}")
                storage_response = requests.post(storage_url, json={
                    'filter': {
                        'ENTITY_ID': project_id,
                        'ENTITY_TYPE': 'group'
                    }
                })
                storage_response.raise_for_status()
                storage_data = storage_response.json()
                print(f"DEBUG Bitrix: Respuesta de disk.storage.getlist para proyecto {project_id}: {json.dumps(storage_data, indent=2)}") # Add this line

                if 'result' in storage_data and len(storage_data['result']) > 0:
                    project_storage_id = storage_data['result'][0].get('ID')
                    print(f"DEBUG Bitrix: Valor de project_storage_id después de get('ID'): {project_storage_id} (Tipo: {type(project_storage_id)})") # Add this line
                    if project_storage_id:
                        print(f"DEBUG Bitrix: Storage del proyecto {project_id} encontrado en el intento {attempt + 1}: {project_storage_id}")
                        break # Found it, exit loop
                
                print(f"DEBUG Bitrix: Storage no encontrado en intento {attempt + 1}. Reintentando en {retry_delay} segundos...")
                time.sleep(retry_delay) # Wait before retrying

            except requests.exceptions.RequestException as e:
                print(f"DEBUG Bitrix: Excepción en intento {attempt + 1} al obtener storage: {e}")
                time.sleep(retry_delay) # Wait before retrying

        if not project_storage_id:
            print(f"DEBUG Bitrix: No se encontró storage para el proyecto {project_id} después de {max_retries} intentos.")
            return False

        print(f"DEBUG Bitrix: Storage del proyecto encontrado: {project_storage_id}")

        # Ahora subir el archivo al storage del proyecto
        # Use the new dedicated webhook for disk uploads
        upload_url = BITRIX_DISK_UPLOAD_WEBHOOK_URL

        upload_data = {
            'id': project_storage_id,  # ID del storage del proyecto
            'fileContent': [file_name, file_content_base64]
        }

        print(f"DEBUG Bitrix: Preparando para subir archivo '{file_name}' a la carpeta {project_storage_id} del proyecto {project_id}") # Add this line
        print(f"DEBUG Bitrix: URL de subida: {upload_url}") # Add this line
        print(f"DEBUG Bitrix: Tamaño del contenido base64: {len(file_content_base64)} bytes")
        print(f"DEBUG Bitrix: Datos de subida: {json.dumps(upload_data, indent=2)}") # Add this line

        print(f"DEBUG Bitrix: Confirmando upload_data['id'] antes de enviar: {upload_data['id']}")
        # Prepare the file for multipart/form-data upload
        files = {
            'fileContent': base64.b64decode(file_content_base64)
        }

        # Prepare the data payload (id and file_name)
        data_payload = {
            'id': project_storage_id,
            'name': file_name # Explicitly pass file_name as a data parameter
        }

        # Send the request as multipart/form-data
        upload_response = requests.post(upload_url, data=data_payload, files=files, timeout=30)
        print(f"DEBUG Bitrix: Status de respuesta de subida: {upload_response.status_code}") # Add this line
        print(f"DEBUG Bitrix: Contenido raw de respuesta de subida: {upload_response.text}") # Add this line
        upload_response.raise_for_status()
        upload_result = upload_response.json()
        print(f"DEBUG Bitrix: Respuesta de subida de archivo: {json.dumps(upload_result, indent=2)}") # Add this line

        if 'result' in upload_result:
            print(f"DEBUG Bitrix: Archivo '{file_name}' subido con éxito al proyecto {project_id}")
            return True
        else:
            print(f"DEBUG Bitrix: Error al subir archivo: {upload_result}")
            if request:
                messages.error(request, f"Error al subir archivo al proyecto: {upload_result.get('error_description', 'Error desconocido')}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"DEBUG Bitrix: Excepción al subir archivo al proyecto: {e}")
        if isinstance(e, requests.exceptions.Timeout):
            print(f"ERROR Bitrix: La subida del archivo excedió el tiempo de espera (timeout).")
        elif hasattr(e, 'response') and e.response is not None:
            print(f"ERROR Bitrix: Respuesta de error de Bitrix24: {e.response.text}")
        import traceback
        traceback.print_exc() # Print full traceback
        if request:
            messages.error(request, f"Excepción al subir archivo al proyecto: {e}")
        return False

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
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
        root_folder_id = None
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
                print(f"DEBUG Bitrix: Respuesta de disk.storage.getlist para proyecto {project_id}: {json.dumps(storage_data, indent=2)}")
                print(f"DEBUG Bitrix: PUNTO DE CONTROL 1 - Respuesta procesada")
                
                try:
                    if 'result' in storage_data and len(storage_data['result']) > 0:
                        print(f"DEBUG Bitrix: PUNTO DE CONTROL 2 - Entrando a procesar result")
                        storage_info = storage_data['result'][0]
                        print(f"DEBUG Bitrix: PUNTO DE CONTROL 3 - storage_info obtenido")
                        
                        project_storage_id = storage_info.get('ID')
                        print(f"DEBUG Bitrix: PUNTO DE CONTROL 4 - project_storage_id: {project_storage_id}")
                        
                        root_folder_id = storage_info.get('ROOT_OBJECT_ID')
                        print(f"DEBUG Bitrix: PUNTO DE CONTROL 5 - root_folder_id: {root_folder_id}")
                        
                        if project_storage_id:
                            print(f"DEBUG Bitrix: PUNTO DE CONTROL 6 - Storage encontrado exitosamente")
                            break # Found it, exit loop
                        else:
                            print(f"DEBUG Bitrix: PUNTO DE CONTROL 7 - project_storage_id es None")
                    else:
                        print(f"DEBUG Bitrix: PUNTO DE CONTROL 8 - No hay result en storage_data")
                        
                except Exception as inner_e:
                    print(f"ERROR Bitrix: PUNTO DE CONTROL 9 - Excepción procesando storage_data: {inner_e}")
                    import traceback
                    traceback.print_exc()
                
                print(f"DEBUG Bitrix: Storage no encontrado en intento {attempt + 1}. Reintentando en {retry_delay} segundos...")
                time.sleep(retry_delay) # Wait before retrying

            except requests.exceptions.RequestException as e:
                print(f"DEBUG Bitrix: Excepción en intento {attempt + 1} al obtener storage: {e}")
                time.sleep(retry_delay) # Wait before retrying

        print(f"DEBUG Bitrix: PUNTO DE CONTROL 10 - Saliendo del loop de retry")
        print(f"DEBUG Bitrix: PUNTO DE CONTROL 11 - project_storage_id: {project_storage_id}")
        print(f"DEBUG Bitrix: PUNTO DE CONTROL 12 - root_folder_id: {root_folder_id}")
        
        # Verificar que tenemos los datos necesarios
        if not project_storage_id:
            print(f"ERROR Bitrix: PUNTO DE CONTROL 13 - No se encontró project_storage_id")
            return False
            
        print(f"DEBUG Bitrix: PUNTO DE CONTROL 14 - project_storage_id OK")
        
        # Si no hay root_folder_id, usar storage_id como fallback
        if not root_folder_id:
            print(f"WARNING Bitrix: PUNTO DE CONTROL 15 - No hay root_folder_id, usando fallback")
            root_folder_id = project_storage_id
        else:
            print(f"DEBUG Bitrix: PUNTO DE CONTROL 16 - root_folder_id OK")

        print(f"SUCCESS Bitrix: PUNTO DE CONTROL 17 - Datos finales - Storage: {project_storage_id}, Target: {root_folder_id}")
        
        # DEBUG DESHABILITADO - Continuando con la subida del archivo
        print(f"DEBUG Bitrix: === CONTINUANDO CON LA SUBIDA DEL ARCHIVO ===")
        # return True  # COMENTADO PARA HABILITAR SUBIDA REAL

        # PASO 1: Crear carpeta "Volumetrías" en el proyecto
        print(f"DEBUG Bitrix: Creando carpeta 'Volumetrías' en el proyecto...")
        
        volumetrias_folder_id = None
        try:
            create_folder_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.folder.addsubfolder.json")
            
            folder_data = {
                'id': root_folder_id,
                'name': 'Volumetrías'
            }
            
            print(f"DEBUG Bitrix: URL crear carpeta: {create_folder_url}")
            print(f"DEBUG Bitrix: Datos carpeta: {folder_data}")
            
            folder_response = requests.post(create_folder_url, json=folder_data, timeout=20)
            print(f"DEBUG Bitrix: Status crear carpeta: {folder_response.status_code}")
            print(f"DEBUG Bitrix: Response crear carpeta: {folder_response.text[:200]}...")
            
            if folder_response.status_code == 200:
                folder_result = folder_response.json()
                if 'result' in folder_result and folder_result['result']:
                    volumetrias_folder_id = folder_result['result']['ID']
                    print(f"SUCCESS Bitrix: Carpeta 'Volumetrías' creada con ID: {volumetrias_folder_id}")
                elif 'error' in folder_result and 'already exists' in str(folder_result['error']).lower():
                    print(f"INFO Bitrix: Carpeta 'Volumetrías' ya existe, buscándola...")
                    # Buscar la carpeta existente
                    search_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.folder.getchildren.json")
                    search_response = requests.post(search_url, json={'id': root_folder_id}, timeout=20)
                    if search_response.status_code == 200:
                        search_result = search_response.json()
                        if 'result' in search_result:
                            for item in search_result['result']:
                                if item.get('NAME') == 'Volumetrías' and item.get('TYPE') == 'folder':
                                    volumetrias_folder_id = item.get('ID')
                                    print(f"SUCCESS Bitrix: Carpeta 'Volumetrías' encontrada con ID: {volumetrias_folder_id}")
                                    break
            else:
                print(f"WARNING Bitrix: No se pudo crear carpeta, usando root folder como fallback")
                
        except Exception as e:
            print(f"WARNING Bitrix: Error creando carpeta: {e}")
        
        # Decidir qué carpeta usar para subir el archivo
        target_folder_id = volumetrias_folder_id if volumetrias_folder_id else root_folder_id
        folder_type = "carpeta Volumetrías" if volumetrias_folder_id else "root folder"
        
        print(f"DEBUG Bitrix: Subiendo archivo a {folder_type} (ID: {target_folder_id})")

        # PASO 2: Subir archivo a la carpeta correcta
        print(f"DEBUG Bitrix: Intentando subida de archivo '{file_name}'")
        print(f"DEBUG Bitrix: Target folder: {target_folder_id}")
        
        try:
            # Usar el endpoint más simple que sabemos que funciona
            simple_upload_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.folder.uploadfile.json")
            
            print(f"DEBUG Bitrix: URL simplificada: {simple_upload_url}")
            print(f"DEBUG Bitrix: Intentando con root folder ID: {root_folder_id}")
            
            # Formato simple - igual que funciona en cotizaciones
            simple_data = {
                'id': target_folder_id,  # Usar la carpeta correcta
                'fileContent': [file_name, file_content_base64]
            }
            
            print(f"DEBUG Bitrix: Enviando petición simple...")
            response = requests.post(simple_upload_url, json=simple_data, timeout=20)
            
            print(f"DEBUG Bitrix: Status: {response.status_code}")
            print(f"DEBUG Bitrix: Response: {response.text[:200]}...")
            
            if response.status_code == 200:
                result = response.json()
                if 'result' in result and result['result']:
                    print(f"SUCCESS Bitrix: Archivo subido con método simple!")
                    return True
                else:
                    print(f"WARNING Bitrix: Respuesta sin resultado: {result}")
            else:
                print(f"ERROR Bitrix: Status {response.status_code}: {response.text}")
                
        except Exception as e:
            print(f"ERROR Bitrix: Excepción en método simple: {e}")
        
        # Si falla, intentar con storage ID como último recurso
        try:
            print(f"DEBUG Bitrix: Intentando con storage ID como último recurso...")
            simple_data_storage = {
                'id': project_storage_id,
                'fileContent': [file_name, file_content_base64]
            }
            
            response2 = requests.post(simple_upload_url, json=simple_data_storage, timeout=20)
            print(f"DEBUG Bitrix: Status método 2: {response2.status_code}")
            print(f"DEBUG Bitrix: Response método 2: {response2.text[:200]}...")
            
            if response2.status_code == 200:
                result2 = response2.json()
                if 'result' in result2 and result2['result']:
                    print(f"SUCCESS Bitrix: Archivo subido con storage ID!")
                    return True
                    
        except Exception as e:
            print(f"ERROR Bitrix: Excepción método 2: {e}")
        
        print(f"ERROR Bitrix: Ambos métodos simples fallaron")
        return False
        
        # TODO: Código complejo comentado hasta resolver issue simple
        # Intentar múltiples métodos de subida
        print(f"DEBUG Bitrix: Iniciando subida de archivo '{file_name}' al proyecto {project_id}")
        
        methods_to_try = [
            {
                'name': 'disk.folder.uploadfile',
                'endpoint': 'disk.folder.uploadfile.json',
                'use_multipart': True,
                'use_root_folder': True
            },
            {
                'name': 'disk.storage.uploadfile', 
                'endpoint': 'disk.storage.uploadfile.json',
                'use_multipart': True,
                'use_root_folder': False  # Este usa storage ID
            },
            {
                'name': 'disk.folder.uploadfile (JSON)',
                'endpoint': 'disk.folder.uploadfile.json',
                'use_multipart': False,
                'use_root_folder': True
            },
            {
                'name': 'disk.file.upload',
                'endpoint': 'disk.file.upload.json',
                'use_multipart': True,
                'use_root_folder': False
            }
        ]
        
        # Decodificar el archivo una sola vez
        file_binary = base64.b64decode(file_content_base64)
        
        for method in methods_to_try:
            print(f"\n=== DEBUG Bitrix: INICIANDO MÉTODO {method['name']} ===")
            try:
                print(f"DEBUG Bitrix: Probando método: {method['name']}")
                
                # Usar webhook dedicado si está disponible y es el primer método
                if method['name'] == 'disk.folder.uploadfile' and BITRIX_DISK_UPLOAD_WEBHOOK_URL:
                    upload_url = BITRIX_DISK_UPLOAD_WEBHOOK_URL
                    print(f"DEBUG Bitrix: Usando webhook dedicado para disk")
                else:
                    upload_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", method['endpoint'])
                
                print(f"DEBUG Bitrix: URL: {upload_url}")
                
                # Decidir qué ID usar (root folder o storage)
                target_id = root_folder_id if method['use_root_folder'] else project_storage_id
                print(f"DEBUG Bitrix: Usando ID {target_id} ({'root folder' if method['use_root_folder'] else 'storage'})")
                
                # Verificar que tenemos los datos necesarios
                if not target_id:
                    print(f"ERROR Bitrix: target_id es None para método {method['name']}")
                    continue
                    
                print(f"DEBUG Bitrix: Preparando request para {method['name']}...")
                
                if method['use_multipart']:
                    # Método multipart/form-data
                    files = {
                        'fileContent': (file_name, file_binary, 'application/pdf')
                    }
                    
                    data_payload = {
                        'id': target_id,
                        'name': file_name
                    }
                    
                    print(f"DEBUG Bitrix: Multipart payload: {data_payload}")
                    print(f"DEBUG Bitrix: File size: {len(file_binary)} bytes")
                    
                    print(f"DEBUG Bitrix: Enviando request multipart...")
                    upload_response = requests.post(
                        upload_url, 
                        data=data_payload, 
                        files=files, 
                        timeout=30  # Reducir timeout
                    )
                    print(f"DEBUG Bitrix: Request multipart completado")
                else:
                    # Método JSON directo
                    json_payload = {
                        'id': target_id,
                        'fileContent': [file_name, file_content_base64]
                    }
                    
                    print(f"DEBUG Bitrix: JSON payload keys: {list(json_payload.keys())}")
                    print(f"DEBUG Bitrix: Base64 size: {len(file_content_base64)} chars")
                    
                    print(f"DEBUG Bitrix: Enviando request JSON...")
                    upload_response = requests.post(
                        upload_url, 
                        json=json_payload, 
                        timeout=30  # Reducir timeout
                    )
                    print(f"DEBUG Bitrix: Request JSON completado")
                
                print(f"DEBUG Bitrix: Status: {upload_response.status_code}")
                print(f"DEBUG Bitrix: Response headers: {dict(upload_response.headers)}")
                print(f"DEBUG Bitrix: Response: {upload_response.text[:500]}...")
                
                if upload_response.status_code == 200:
                    try:
                        result = upload_response.json()
                        print(f"DEBUG Bitrix: JSON response: {json.dumps(result, indent=2)}")
                        
                        if 'result' in result:
                            if result['result']:
                                print(f"SUCCESS Bitrix: Archivo subido con método {method['name']}")
                                print(f"SUCCESS Bitrix: File ID: {result['result']}")
                                return True
                            else:
                                print(f"WARNING Bitrix: Método {method['name']} - resultado vacío")
                        else:
                            print(f"WARNING Bitrix: Método {method['name']} - sin campo 'result'")
                            
                        # Verificar si hay errores en la respuesta
                        if 'error' in result:
                            print(f"ERROR Bitrix: {result['error']}")
                            if 'error_description' in result:
                                print(f"ERROR Bitrix: {result['error_description']}")
                                
                    except json.JSONDecodeError as e:
                        print(f"ERROR Bitrix: Método {method['name']} - Error parseando JSON: {e}")
                        print(f"ERROR Bitrix: Raw response: {upload_response.text}")
                else:
                    print(f"ERROR Bitrix: Método {method['name']} falló con status {upload_response.status_code}")
                    print(f"ERROR Bitrix: Response body: {upload_response.text}")
                    
            except requests.exceptions.Timeout as e:
                print(f"ERROR Bitrix: Método {method['name']} - TIMEOUT después de 30s: {e}")
                continue
            except requests.exceptions.ConnectionError as e:
                print(f"ERROR Bitrix: Método {method['name']} - Error de conexión: {e}")
                continue
            except Exception as e:
                print(f"ERROR Bitrix: Método {method['name']} - Excepción: {e}")
                import traceback
                traceback.print_exc()
                continue
            finally:
                print(f"=== DEBUG Bitrix: FINALIZANDO MÉTODO {method['name']} ===\n")
        
        # Si llegamos aquí, ningún método funcionó
        print(f"ERROR Bitrix: No se pudo subir el archivo '{file_name}' con ningún método")
        if request:
            messages.error(request, f"Error: No se pudo subir el archivo al proyecto")
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
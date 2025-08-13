import requests
import json
import base64
import time
import os
from django.contrib import messages

def upload_file_to_project_drive_improved(project_id, file_name, file_content_base64, request=None):
    """
    Versión mejorada para subir archivos al drive de un proyecto en Bitrix24
    Prueba múltiples métodos hasta encontrar uno que funcione
    """
    BITRIX_PROJECTS_WEBHOOK_URL = os.getenv("BITRIX_PROJECTS_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json")
    
    if not BITRIX_PROJECTS_WEBHOOK_URL:
        print("Error: La URL del webhook de proyectos de Bitrix24 no está configurada.")
        return False

    try:
        # Paso 1: Obtener el storage ID del proyecto
        storage_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.storage.getlist.json")
        
        project_storage_id = None
        max_retries = 8
        retry_delay = 3
        
        for attempt in range(max_retries):
            try:
                print(f"DEBUG Bitrix: Intento {attempt + 1}/{max_retries} para encontrar storage del proyecto {project_id}")
                
                storage_response = requests.post(storage_url, json={
                    'filter': {
                        'ENTITY_ID': project_id,
                        'ENTITY_TYPE': 'group'
                    }
                }, timeout=30)
                
                storage_response.raise_for_status()
                storage_data = storage_response.json()
                
                print(f"DEBUG Bitrix: Respuesta storage: {json.dumps(storage_data, indent=2)}")
                
                if 'result' in storage_data and len(storage_data['result']) > 0:
                    project_storage_id = storage_data['result'][0].get('ID')
                    if project_storage_id:
                        print(f"SUCCESS Bitrix: Storage encontrado: {project_storage_id}")
                        break
                
                print(f"DEBUG Bitrix: Storage no encontrado, reintentando en {retry_delay}s...")
                time.sleep(retry_delay)
                
            except Exception as e:
                print(f"DEBUG Bitrix: Error en intento {attempt + 1}: {e}")
                time.sleep(retry_delay)

        if not project_storage_id:
            print(f"ERROR Bitrix: No se encontró storage después de {max_retries} intentos")
            return False

        # Paso 2: Intentar múltiples métodos de subida
        methods_to_try = [
            {
                'name': 'disk.folder.uploadfile',
                'endpoint': 'disk.folder.uploadfile.json',
                'use_storage_id': True
            },
            {
                'name': 'disk.storage.uploadfile', 
                'endpoint': 'disk.storage.uploadfile.json',
                'use_storage_id': True
            },
            {
                'name': 'disk.file.upload',
                'endpoint': 'disk.file.upload.json', 
                'use_storage_id': False
            }
        ]
        
        # Decodificar el archivo una sola vez
        file_binary = base64.b64decode(file_content_base64)
        
        for method in methods_to_try:
            try:
                print(f"\nDEBUG Bitrix: Probando método: {method['name']}")
                
                upload_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", method['endpoint'])
                print(f"DEBUG Bitrix: URL: {upload_url}")
                
                # Preparar archivos para multipart/form-data
                files = {
                    'fileContent': (file_name, file_binary, 'application/pdf')
                }
                
                # Preparar datos
                if method['use_storage_id']:
                    data_payload = {
                        'id': project_storage_id,
                        'name': file_name
                    }
                else:
                    data_payload = {
                        'storageId': project_storage_id,
                        'fileName': file_name
                    }
                
                print(f"DEBUG Bitrix: Data payload: {data_payload}")
                
                # Hacer la petición
                upload_response = requests.post(
                    upload_url, 
                    data=data_payload, 
                    files=files, 
                    timeout=60
                )
                
                print(f"DEBUG Bitrix: Status: {upload_response.status_code}")
                print(f"DEBUG Bitrix: Response: {upload_response.text[:500]}...")
                
                if upload_response.status_code == 200:
                    try:
                        result = upload_response.json()
                        if 'result' in result and result['result']:
                            print(f"SUCCESS Bitrix: Archivo subido con método {method['name']}")
                            print(f"SUCCESS Bitrix: Resultado: {json.dumps(result, indent=2)}")
                            return True
                        else:
                            print(f"DEBUG Bitrix: Método {method['name']} - Sin resultado válido: {result}")
                    except json.JSONDecodeError as e:
                        print(f"DEBUG Bitrix: Método {method['name']} - Error JSON: {e}")
                else:
                    print(f"DEBUG Bitrix: Método {method['name']} - Status {upload_response.status_code}")
                    
            except Exception as e:
                print(f"DEBUG Bitrix: Método {method['name']} - Excepción: {e}")
                continue
        
        # Si llegamos aquí, ningún método funcionó
        print("ERROR Bitrix: Todos los métodos de subida fallaron")
        
        # Como último recurso, intentar método directo sin multipart
        try:
            print("\nDEBUG Bitrix: Intentando método directo con JSON")
            
            direct_url = BITRIX_PROJECTS_WEBHOOK_URL.replace("sonet_group.create.json", "disk.folder.uploadfile.json")
            
            direct_payload = {
                'id': project_storage_id,
                'fileContent': [file_name, file_content_base64]
            }
            
            direct_response = requests.post(direct_url, json=direct_payload, timeout=60)
            print(f"DEBUG Bitrix: Método directo - Status: {direct_response.status_code}")
            print(f"DEBUG Bitrix: Método directo - Response: {direct_response.text}")
            
            if direct_response.status_code == 200:
                try:
                    result = direct_response.json()
                    if 'result' in result:
                        print("SUCCESS Bitrix: Archivo subido con método directo JSON")
                        return True
                except:
                    pass
                    
        except Exception as e:
            print(f"DEBUG Bitrix: Método directo - Error: {e}")
        
        return False
        
    except Exception as e:
        print(f"ERROR Bitrix: Excepción general: {e}")
        import traceback
        traceback.print_exc()
        return False

# Test function
def test_upload():
    """
    Función de prueba para testing
    """
    # Crear un PDF de prueba pequeño
    test_content = "Test PDF content"
    test_base64 = base64.b64encode(test_content.encode()).decode()
    
    # Usar un project_id de prueba
    test_project_id = "123"  # Reemplazar con ID real
    
    result = upload_file_to_project_drive_improved(
        project_id=test_project_id,
        file_name="test_upload.pdf", 
        file_content_base64=test_base64
    )
    
    print(f"Resultado del test: {result}")
    return result

if __name__ == "__main__":
    test_upload()
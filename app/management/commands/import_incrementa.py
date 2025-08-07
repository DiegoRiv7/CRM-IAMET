import requests
import json
import os
from django.core.management.base import BaseCommand
from django.conf import settings
from dotenv import load_dotenv

class Command(BaseCommand):
    help = 'Importa los PDFs de las cotizaciones desde un archivo JSON de Incrementa'

    def handle(self, *args, **options):
        # Cargar variables de entorno desde el archivo .env
        load_dotenv()

        INCREMENTA_API_TOKEN = os.environ.get('INCREMENTA_API_TOKEN')

        if not INCREMENTA_API_TOKEN:
            self.stdout.write(self.style.ERROR('Error: No se encontró el token de la API de Incrementa en el archivo .env'))
            return

        self.stdout.write("Conectando con la API de Incrementa para obtener cotizaciones...")

        # Endpoint de la API para obtener el listado de pedidos
        api_url = "https://incrementacrm.com/api/v2/pedidos"
        
        headers = {
            "Authorization": f"Bearer {INCREMENTA_API_TOKEN}",
            "Content-Type": "application/json"
        }

        try:
            response = requests.get(api_url, headers=headers, timeout=15)
            response.raise_for_status()  # Lanza un error para respuestas no exitosas (4xx o 5xx)

            quotes_data = response.json()
            
            if not isinstance(quotes_data, list):
                self.stdout.write(self.style.ERROR('Error: La respuesta de la API no es una lista de cotizaciones.'))
                return

            self.stdout.write(self.style.SUCCESS(f'¡Conexión exitosa! {len(quotes_data)} cotizaciones encontradas.'))

            # Ruta a la carpeta de destino para los PDFs
            pdf_output_dir = os.path.join(settings.BASE_DIR, 'media', 'incrementa_pdfs')
            os.makedirs(pdf_output_dir, exist_ok=True) # Asegura que la carpeta exista

            for quote in quotes_data:
                pdf_url = quote.get('url_pdf')
                folio = quote.get('folio', 'sin_folio')
                serie = quote.get('serie_documento', 'A')
                
                if not pdf_url:
                    self.stdout.write(self.style.WARNING(f"Omitiendo cotización con folio {folio} porque no tiene 'url_pdf'."))
                    continue

                file_name = f"incrementa_{serie}_{folio}.pdf"
                output_path = os.path.join(pdf_output_dir, file_name)

                self.stdout.write(f"Descargando PDF de: {pdf_url} a {output_path}")
                try:
                    pdf_response = requests.get(pdf_url, timeout=20)
                    pdf_response.raise_for_status()
                    with open(output_path, 'wb') as f:
                        f.write(pdf_response.content)
                    self.stdout.write(self.style.SUCCESS(f'PDF descargado y guardado: {file_name}'))
                except requests.exceptions.RequestException as e:
                    self.stdout.write(self.style.ERROR(f'Error al descargar {pdf_url}: {e}'))
                self.stdout.write("---")

            self.stdout.write(self.style.SUCCESS('Proceso de descarga de PDFs completado.'))

        except requests.exceptions.HTTPError as e:
            self.stdout.write(self.style.ERROR(f'Error HTTP al conectar con la API: {e}'))
            self.stdout.write(f"Respuesta del servidor: {e.response.text}")
        except requests.exceptions.RequestException as e:
            self.stdout.write(self.style.ERROR(f'Error de conexión: {e}'))
        except json.JSONDecodeError:
            self.stdout.write(self.style.ERROR('Error: No se pudo decodificar la respuesta JSON de la API.'))

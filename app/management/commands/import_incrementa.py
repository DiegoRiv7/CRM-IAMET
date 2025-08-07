import requests
import json
import os
from django.core.management.base import BaseCommand
from django.conf import settings

class Command(BaseCommand):
    help = 'Importa los PDFs de las cotizaciones desde un archivo JSON de Incrementa'

    def handle(self, *args, **options):
        # Ruta al archivo de datos de prueba
        json_file_path = os.path.join(settings.BASE_DIR, 'incrementa_data.json')
        
        # Ruta a la carpeta de destino para los PDFs
        pdf_output_dir = os.path.join(settings.BASE_DIR, 'media', 'incrementa_pdfs')

        if not os.path.exists(json_file_path):
            self.stdout.write(self.style.ERROR(f'Error: El archivo de datos {json_file_path} no fue encontrado.'))
            return

        self.stdout.write(f"Leyendo datos desde {json_file_path}...")

        try:
            with open(json_file_path, 'r') as f:
                quotes_data = json.load(f)
        except json.JSONDecodeError:
            self.stdout.write(self.style.ERROR('Error: No se pudo decodificar el archivo JSON.'))
            return

        if not isinstance(quotes_data, list):
            self.stdout.write(self.style.ERROR('Error: El JSON debe contener una lista de cotizaciones.'))
            return

        self.stdout.write(self.style.SUCCESS(f'{len(quotes_data)} cotizaciones encontradas en el archivo.'))

        for quote in quotes_data:
            pdf_url = quote.get('url_pdf')
            folio = quote.get('folio', 'sin_folio')
            serie = quote.get('serie_documento', 'A')
            
            if not pdf_url:
                self.stdout.write(self.style.WARNING(f"Omitiendo cotización con folio {folio} porque no tiene 'url_pdf'."))
                continue

            # --- Simulación de Descarga ---
            # En un escenario real, aquí haríamos la petición a la red.
            # Por ahora, solo mostraremos un mensaje.
            self.stdout.write(f"Simulando descarga de: {pdf_url}")

            # Nombre del archivo de salida
            file_name = f"incrementa_{serie}_{folio}.pdf"
            output_path = os.path.join(pdf_output_dir, file_name)

            self.stdout.write(f"El archivo se guardaría como: {output_path}")
            self.stdout.write("---")

            # --- Código de Descarga Real (actualmente comentado) ---
            # try:
            #     # En un entorno con conexión, descomentarías este bloque
            #     # response = requests.get(pdf_url, timeout=20)
            #     # response.raise_for_status()
            #     # with open(output_path, 'wb') as f:
            #     #     f.write(response.content)
            #     # self.stdout.write(self.style.SUCCESS(f'PDF descargado y guardado en {output_path}'))
            # except requests.exceptions.RequestException as e:
            #     self.stdout.write(self.style.ERROR(f'Error al descargar {pdf_url}: {e}'))

        self.stdout.write(self.style.SUCCESS('Proceso de simulación completado.'))

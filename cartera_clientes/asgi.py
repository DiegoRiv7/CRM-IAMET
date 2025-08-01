"""
ASGI config for cartera_clientes project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import os
from pathlib import Path
from dotenv import load_dotenv

from django.core.asgi import get_asgi_application

# Carga las variables de entorno desde .env en el directorio raíz del proyecto
dotenv_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=dotenv_path)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')

application = get_asgi_application()

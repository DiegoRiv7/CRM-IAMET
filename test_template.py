import os
import django
from django.conf import settings
from django.template.loader import render_to_string, get_template

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
try:
    django.setup()
    get_template('crm_home.html')
    print("Template parsed successfully!")
except Exception as e:
    print(f"Template parsing failed: {e}")

"""
test_template.py — Test rendering the template inside Docker
Ejecutar: sudo docker compose exec web python test_template.py
"""
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.test import RequestFactory
from django.contrib.auth.models import User
from app.views import crm_home
import traceback

print("=== TEST TEMPLATE ===")

user = User.objects.filter(is_superuser=True).first()
if not user:
    user = User.objects.first()

factory = RequestFactory()
request = factory.get('/app/home/')
request.user = user

try:
    response = crm_home(request)
    print(f"Status: {response.status_code}")
    if response.status_code >= 400:
        print("Body:")
        print(response.content.decode('utf-8'))
except Exception as e:
    print(f"Error renderizando:")
    traceback.print_exc()

print("=== TEST FIN ===")


import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings') # Assuming project name
django.setup()

from app.models import TodoItem, Cliente

# Find opportunities for BD TIJUANA 1
print("Checking BD TIJUANA 1...")
clientes = Cliente.objects.filter(nombre_empresa__icontains="BD TIJUANA 1")
for c in clientes:
    opps = TodoItem.objects.filter(cliente=c)
    print(f"Client ID: {c.id}, Name: {c.nombre_empresa}, Opp Count: {opps.count()}")
    for o in opps:
        print(f"  - Opp: {o.oportunidad}, Created: {o.fecha_creacion}")

print("\nRecent TodoItems:")
for o in TodoItem.objects.order_by('-fecha_creacion')[:10]:
    print(f"ID: {o.id}, Opp: {o.oportunidad}, Client: {o.cliente.nombre_empresa if o.cliente else 'None'}, Created: {o.fecha_creacion}")

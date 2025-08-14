#!/usr/bin/env python3
"""
Script para actualizar productos existentes con el campo tipo='producto'
Ejecutar con: python manage.py shell < update_existing_products.py
"""

import os
import django

# Configurar Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from app.models import DetalleCotizacion

# Actualizar todos los productos existentes que no tienen tipo definido
productos_actualizados = DetalleCotizacion.objects.filter(tipo__isnull=True).update(tipo='producto')
print(f"Productos actualizados: {productos_actualizados}")

# También actualizar los que tienen tipo vacío
productos_vacios = DetalleCotizacion.objects.filter(tipo='').update(tipo='producto')
print(f"Productos con tipo vacío actualizados: {productos_vacios}")

# Verificar el resultado
total_productos = DetalleCotizacion.objects.filter(tipo='producto').count()
total_titulos = DetalleCotizacion.objects.filter(tipo='titulo').count()

print(f"Total productos: {total_productos}")
print(f"Total títulos: {total_titulos}")
print("¡Actualización completada!")
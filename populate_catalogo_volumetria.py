#!/usr/bin/env python
"""
Script para poblar el catálogo de volumetría con productos iniciales
Ejecutar dentro del contenedor Docker: docker-compose exec web python populate_catalogo_volumetria.py
"""
import os
import sys
import django
from decimal import Decimal

# Configurar Django
sys.path.append('/app')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from app.models import CatalogoCableado

def crear_productos_iniciales():
    """Crear productos iniciales para el catálogo de volumetría"""
    
    productos_iniciales = [
        # Cables Cat6A
        {
            'numero_parte': 'PUR6AV04IG-G',
            'descripcion': 'Bobina de Cable UTP de 4 Pares, Vari-MaTriX, Cat6A, 23 AWG, CMR (Riser), Color Gris, 305m',
            'categoria': 'Cat6A',
            'color': 'GRIS',
            'precio_unitario': Decimal('150.00'),
            'precio_proveedor': Decimal('120.00'),
            'marca': 'PANDUIT'
        },
        
        # Cables Cat6
        {
            'numero_parte': 'PUL6004BL-BOX',
            'descripcion': 'Bobina de Cable UTP Cat6, 23 AWG, CMR, Azul, 305m',
            'categoria': 'Cat6',
            'color': 'AZUL',
            'precio_unitario': Decimal('120.00'),
            'precio_proveedor': Decimal('95.00'),
            'marca': 'PANDUIT'
        },
        
        # Jacks Cat6
        {
            'numero_parte': 'CJ6X88TBL',
            'descripcion': 'Jack Cat6, Azul, Para Faceplate',
            'categoria': 'Cat6',
            'color': 'AZUL',
            'precio_unitario': Decimal('25.50'),
            'precio_proveedor': Decimal('18.75'),
            'marca': 'PANDUIT'
        },
        {
            'numero_parte': 'CJ6X88TWH',
            'descripcion': 'Jack Cat6, Blanco, Para Faceplate',
            'categoria': 'Cat6',
            'color': 'BLANCO',
            'precio_unitario': Decimal('25.50'),
            'precio_proveedor': Decimal('18.75'),
            'marca': 'PANDUIT'
        },
        
        # Jacks Cat6A
        {
            'numero_parte': 'CJ6AX88TBL',
            'descripcion': 'Jack Cat6A, Azul, Para Faceplate',
            'categoria': 'Cat6A',
            'color': 'AZUL',
            'precio_unitario': Decimal('35.00'),
            'precio_proveedor': Decimal('28.00'),
            'marca': 'PANDUIT'
        },
        
        # Patchcords Cat6
        {
            'numero_parte': 'UTP6SP3BL',
            'descripcion': 'Patchcord Cat6, 3ft (0.9m), Azul',
            'categoria': 'Cat6',
            'color': 'AZUL',
            'precio_unitario': Decimal('12.00'),
            'precio_proveedor': Decimal('8.50'),
            'marca': 'PANDUIT'
        },
        {
            'numero_parte': 'UTP6SP5BL',
            'descripcion': 'Patchcord Cat6, 5ft (1.5m), Azul',
            'categoria': 'Cat6',
            'color': 'AZUL',
            'precio_unitario': Decimal('15.00'),
            'precio_proveedor': Decimal('11.00'),
            'marca': 'PANDUIT'
        },
        {
            'numero_parte': 'UTP6SP7BL',
            'descripcion': 'Patchcord Cat6, 7ft (2.1m), Azul',
            'categoria': 'Cat6',
            'color': 'AZUL',
            'precio_unitario': Decimal('18.00'),
            'precio_proveedor': Decimal('13.50'),
            'marca': 'PANDUIT'
        },
        
        # Patchcords Cat6A
        {
            'numero_parte': 'UTP6ASP3BL',
            'descripcion': 'Patchcord Cat6A, 3ft (0.9m), Azul',
            'categoria': 'Cat6A',
            'color': 'AZUL',
            'precio_unitario': Decimal('18.00'),
            'precio_proveedor': Decimal('14.00'),
            'marca': 'PANDUIT'
        },
        
        # Faceplates
        {
            'numero_parte': 'NK2FWH',
            'descripcion': 'Faceplate 2 puertos, Blanco',
            'categoria': 'Faceplate',
            'color': 'BLANCO',
            'precio_unitario': Decimal('8.50'),
            'precio_proveedor': Decimal('6.00'),
            'marca': 'PANDUIT'
        },
        {
            'numero_parte': 'NK4FWH',
            'descripcion': 'Faceplate 4 puertos, Blanco',
            'categoria': 'Faceplate',
            'color': 'BLANCO',
            'precio_unitario': Decimal('12.00'),
            'precio_proveedor': Decimal('8.50'),
            'marca': 'PANDUIT'
        },
        {
            'numero_parte': 'NK6FWH',
            'descripcion': 'Faceplate 6 puertos, Blanco',
            'categoria': 'Faceplate',
            'color': 'BLANCO',
            'precio_unitario': Decimal('18.00'),
            'precio_proveedor': Decimal('13.00'),
            'marca': 'PANDUIT'
        }
    ]
    
    productos_creados = 0
    productos_actualizados = 0
    
    print("=== Poblando Catálogo de Volumetría ===\n")
    
    for producto_data in productos_iniciales:
        numero_parte = producto_data['numero_parte']
        
        # Verificar si ya existe
        producto_existente = CatalogoCableado.objects.filter(numero_parte=numero_parte).first()
        
        if producto_existente:
            # Actualizar producto existente
            for campo, valor in producto_data.items():
                setattr(producto_existente, campo, valor)
            producto_existente.activo = True
            producto_existente.save()
            
            print(f"✅ Actualizado: {numero_parte} - {producto_data['descripcion'][:50]}...")
            productos_actualizados += 1
        else:
            # Crear nuevo producto
            producto_data['activo'] = True
            CatalogoCableado.objects.create(**producto_data)
            
            print(f"🆕 Creado: {numero_parte} - {producto_data['descripcion'][:50]}...")
            productos_creados += 1
    
    print(f"\n=== Resumen ===")
    print(f"Productos creados: {productos_creados}")
    print(f"Productos actualizados: {productos_actualizados}")
    print(f"Total de productos en catálogo: {CatalogoCableado.objects.count()}")
    
    # Mostrar estadísticas por categoría
    print(f"\n=== Productos por Categoría ===")
    categorias = CatalogoCableado.objects.values('categoria').distinct().order_by('categoria')
    for categoria in categorias:
        cat_name = categoria['categoria'] or 'Sin categoría'
        count = CatalogoCableado.objects.filter(categoria=categoria['categoria']).count()
        print(f"  {cat_name}: {count} productos")
    
    print("\n=== Proceso completado exitosamente ===")

if __name__ == '__main__':
    try:
        crear_productos_iniciales()
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
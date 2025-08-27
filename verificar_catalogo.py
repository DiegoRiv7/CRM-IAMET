#!/usr/bin/env python
import os
import sys
import django

# Configurar Django
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from app.models import CatalogoCableado

def verificar_catalogo():
    print("🔍 Verificando catálogo de productos...")
    
    # Verificar total de productos
    total = CatalogoCableado.objects.count()
    activos = CatalogoCableado.objects.filter(activo=True).count()
    
    print(f"📊 Total productos: {total}")
    print(f"📊 Productos activos: {activos}")
    
    # Buscar productos específicos
    productos_test = ['CJ5E88TGBL', 'NK1FBL', 'UTP28CH1OR', 'PUL6004BL-BOX']
    
    for num_parte in productos_test:
        producto = CatalogoCableado.objects.filter(numero_parte__icontains=num_parte).first()
        if producto:
            print(f"✅ Encontrado: {producto.numero_parte} - ${producto.precio_unitario}")
        else:
            print(f"❌ No encontrado: {num_parte}")
    
    # Mostrar algunos productos de ejemplo
    print("\n📋 Primeros 5 productos en catálogo:")
    for producto in CatalogoCableado.objects.filter(activo=True)[:5]:
        print(f"  • {producto.numero_parte} - {producto.descripcion[:50]}... - ${producto.precio_unitario}")

def crear_productos_ejemplo():
    print("\n🔧 Creando productos de ejemplo...")
    
    productos_ejemplo = [
        {
            'numero_parte': 'CJ5E88TGBL',
            'descripcion': 'Conector Jack RJ45 Estilo TG, Mini-Com, Categoría 6, de 8 posiciones y 8 cables, Azul',
            'marca': 'Panduit',
            'categoria': 'JACK',
            'precio_unitario': 22.00,
            'precio_proveedor': 10.50,
            'color': 'Azul'
        },
        {
            'numero_parte': 'NK1FBL',
            'descripcion': 'Placa de Pared Vertical Ejecutiva, Salida Para 1 Puerto Mini-Com, Color Blanco',
            'marca': 'Panduit', 
            'categoria': 'FACEPLATE',
            'precio_unitario': 6.00,
            'precio_proveedor': 2.54,
            'color': 'Blanco'
        },
        {
            'numero_parte': 'UTP28CH1OR',
            'descripcion': 'Cable de Parcheo TX6, UTP Cat6, 24 AWG, CM, Color Naranja, 1ft',
            'marca': 'Panduit',
            'categoria': 'PATCHCORD',
            'precio_unitario': 27.00,
            'precio_proveedor': 11.72,
            'color': 'Naranja'
        },
        {
            'numero_parte': 'PUL6004BL-BOX',
            'descripcion': 'Bobina de Cable UTP 305 m. de Cobre, TX6000™ PanNet, Reelex, Azul, Categoría 6 Mejorado',
            'marca': 'Panduit',
            'categoria': 'CABLE', 
            'precio_unitario': 540.00,
            'precio_proveedor': 274.00,
            'color': 'Azul'
        }
    ]
    
    for producto_data in productos_ejemplo:
        producto, created = CatalogoCableado.objects.get_or_create(
            numero_parte=producto_data['numero_parte'],
            defaults=producto_data
        )
        if created:
            print(f"✅ Creado: {producto.numero_parte}")
        else:
            print(f"⚠️ Ya existe: {producto.numero_parte}")

if __name__ == '__main__':
    verificar_catalogo()
    crear_productos_ejemplo()
    print("\n✅ Verificación completada")
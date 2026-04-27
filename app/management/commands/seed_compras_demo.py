from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from app.models import Almacen, ClaveCFDI, UnidadCFDI, Producto, Proveedor


PRODUCTOS_DEMO = [
    # codigo, nombre, descripcion, costo, moneda, iva, clave_cfdi, unidad_cfdi
    ('PROD-LAP-001', 'Laptop Dell Latitude 5440', 'Laptop empresarial Intel i5 14" 16GB RAM 512GB SSD',
        Decimal('21500.00'), 'MXN', Decimal('16'), '43211507', 'H87'),
    ('PROD-LAP-002', 'Laptop Lenovo ThinkPad E14', 'Laptop business AMD Ryzen 5 14" 16GB 512GB',
        Decimal('19800.00'), 'MXN', Decimal('16'), '43211507', 'H87'),
    ('PROD-MON-001', 'Monitor LG 27UL500', 'Monitor 27" 4K UHD IPS HDR10',
        Decimal('6450.00'), 'MXN', Decimal('16'), '43211711', 'H87'),
    ('PROD-MON-002', 'Monitor Dell P2422H', 'Monitor 24" Full HD IPS USB-C',
        Decimal('4200.00'), 'MXN', Decimal('16'), '43211711', 'H87'),
    ('PROD-TEC-001', 'Teclado Logitech MX Keys', 'Teclado inalámbrico retroiluminado bluetooth',
        Decimal('2150.00'), 'MXN', Decimal('16'), '43211706', 'H87'),
    ('PROD-RAT-001', 'Mouse Logitech MX Master 3S', 'Mouse ergonómico inalámbrico',
        Decimal('1890.00'), 'MXN', Decimal('16'), '43211708', 'H87'),
    ('PROD-SW-001', 'Switch Cisco Catalyst 24p', 'Switch administrable 24 puertos Gigabit PoE+',
        Decimal('18500.00'), 'MXN', Decimal('16'), '43222609', 'H87'),
    ('PROD-AP-001', 'Access Point Ubiquiti U6-Pro', 'AP WiFi 6 dual-band PoE',
        Decimal('4250.00'), 'MXN', Decimal('16'), '43222612', 'H87'),
    ('PROD-CAB-001', 'Cable UTP Cat6 305m', 'Bobina cable UTP Categoría 6, color azul',
        Decimal('2800.00'), 'MXN', Decimal('16'), '39121701', 'H87'),
    ('PROD-CAM-001', 'Cámara Hikvision DS-2CD2143', 'Cámara IP domo 4MP visión nocturna',
        Decimal('3650.00'), 'MXN', Decimal('16'), '46171610', 'H87'),
    ('PROD-PAP-001', 'Resma papel Bond Carta 75g', 'Caja con 10 paquetes de 500 hojas',
        Decimal('1250.00'), 'MXN', Decimal('16'), '14111507', 'H87'),
    ('PROD-TON-001', 'Tóner HP CF410X negro', 'Tóner alta capacidad HP M452/M477',
        Decimal('3850.00'), 'MXN', Decimal('16'), '44103103', 'H87'),

    # Servicios (forzosamente con E48)
    ('SERV-ING-001', 'Desarrollo de software a medida', 'Hora de desarrollo de software (Django/Python)',
        Decimal('850.00'), 'MXN', Decimal('16'), '81111500', 'E48'),
    ('SERV-SOP-001', 'Soporte técnico anual', 'Plan de soporte técnico empresarial 12 meses',
        Decimal('48000.00'), 'MXN', Decimal('16'), '81111811', 'E48'),
    ('SERV-MAN-001', 'Mantenimiento preventivo', 'Mantenimiento mensual de equipo de cómputo',
        Decimal('1850.00'), 'MXN', Decimal('16'), '81112201', 'E48'),
    ('SERV-INST-001', 'Instalación de cableado estructurado', 'Por punto certificado Cat6',
        Decimal('1200.00'), 'MXN', Decimal('16'), '72151602', 'E48'),
    ('SERV-CAP-001', 'Capacitación en Office 365', 'Curso 8 horas para 10 personas',
        Decimal('12500.00'), 'MXN', Decimal('16'), '81112005', 'E48'),
    ('SERV-LIM-001', 'Servicio de limpieza mensual', 'Limpieza profunda de oficinas',
        Decimal('8500.00'), 'MXN', Decimal('16'), '76111501', 'E48'),
]

PROVEEDORES_DEMO = [
    # razon_social, rfc, dias_credito, monto_credito, banco, clabe, cuenta_contable, calle, colonia, ciudad, estado, cp
    ('Soluciones Tecnológicas del Norte S.A. de C.V.', 'STN180521AB1', 30, Decimal('500000.00'),
        'BBVA', '012680001234567890', '2110-001', 'Av. Tecnológico 1500', 'Industrial', 'Monterrey', 'Nuevo León', '64000'),
    ('Distribuidora Mayorista del Pacífico S.A.', 'DMP150302C45', 45, Decimal('750000.00'),
        'Santander', '014320009876543210', '2110-002', 'Av. Insurgentes 2200', 'Centro', 'Tijuana', 'Baja California', '22000'),
    ('Servicios Profesionales Ramírez', 'RAGE850912H42', 15, Decimal('120000.00'),
        'Banorte', '072180001122334455', '2110-003', 'Calle Reforma 45', 'Del Valle', 'CDMX', 'CDMX', '03100'),
    ('Comercializadora García y Asociados', 'CGA200815JK7', 30, Decimal('300000.00'),
        'BBVA', '012180005566778899', '2110-004', 'Blvd. Díaz Ordaz 800', 'Otay', 'Tijuana', 'Baja California', '22500'),
    ('Mantenimiento Industrial Zacatecas', 'MIZ191108XY3', 60, Decimal('250000.00'),
        'HSBC', '021180009988776655', '2110-005', 'Carretera Federal 45 Km 12', 'Industrial', 'Aguascalientes', 'Aguascalientes', '20290'),
    ('Juan Carlos Pérez López', 'PELJ900315M21', 0, Decimal('0.00'),
        '', '', '2110-006', 'Calle Hidalgo 234', 'Centro', 'Guadalajara', 'Jalisco', '44100'),
    ('Importaciones del Bajío S.A. de C.V.', 'IBA160422EF8', 30, Decimal('400000.00'),
        'Banamex (Citibanamex)', '002180001234509876', '2110-007', 'Av. Constituyentes 100', 'Loma Alta', 'Querétaro', 'Querétaro', '76000'),
    # Sin RFC (proveedor casual / extranjero)
    ('Office Supplies USA LLC', None, 0, Decimal('0.00'),
        '', '', '2110-008', '', '', '', '', ''),
]


class Command(BaseCommand):
    help = "Crea ~18 productos y ~8 proveedores de demostración (idempotente). Requiere `seed_compras` corrido previamente."

    @transaction.atomic
    def handle(self, *args, **options):
        # Verificar prerequisitos
        if not ClaveCFDI.objects.exists() or not UnidadCFDI.objects.exists():
            self.stdout.write(self.style.ERROR(
                "Faltan catálogos CFDI. Corre primero: python manage.py seed_compras"
            ))
            return

        almacen_principal = Almacen.objects.filter(activo=True).first()
        if not almacen_principal:
            almacen_principal = Almacen.objects.create(nombre='Almacén Principal', activo=True)

        # Productos
        prod_creados = 0
        prod_existentes = 0
        for codigo, nombre, descripcion, costo, moneda, iva, cfdi_clave, unidad_clave in PRODUCTOS_DEMO:
            if Producto.objects.filter(codigo=codigo).exists():
                prod_existentes += 1
                continue
            try:
                cfdi = ClaveCFDI.objects.get(clave=cfdi_clave)
                unidad = UnidadCFDI.objects.get(clave=unidad_clave)
            except (ClaveCFDI.DoesNotExist, UnidadCFDI.DoesNotExist):
                self.stdout.write(self.style.WARNING(f"Saltado {codigo}: clave o unidad no existe."))
                continue

            p = Producto(
                codigo=codigo, nombre=nombre, descripcion=descripcion,
                costo=costo, moneda=moneda, iva=iva,
                clave_cfdi=cfdi, unidad_cfdi=unidad,
                estatus='activo',
            )
            p.save()
            p.almacenes.add(almacen_principal)
            prod_creados += 1

        # Proveedores
        prov_creados = 0
        prov_existentes = 0
        for (razon, rfc, dias, monto, banco, clabe, contable,
             calle, colonia, ciudad, estado, cp) in PROVEEDORES_DEMO:
            qs = Proveedor.objects.filter(razon_social=razon)
            if rfc:
                qs = qs | Proveedor.objects.filter(rfc=rfc)
            if qs.exists():
                prov_existentes += 1
                continue

            Proveedor.objects.create(
                razon_social=razon,
                rfc=rfc,
                dias_credito=dias,
                monto_credito=monto,
                banco=banco,
                clabe=clabe,
                cuenta_contable=contable,
                calle=calle,
                colonia=colonia,
                ciudad=ciudad,
                estado=estado,
                cp=cp,
                estatus='activo',
            )
            prov_creados += 1

        self.stdout.write(self.style.SUCCESS(
            f"Demo Compras OK | Productos: +{prod_creados} (saltados {prod_existentes}, total {Producto.objects.count()}) "
            f"| Proveedores: +{prov_creados} (saltados {prov_existentes}, total {Proveedor.objects.count()})"
        ))

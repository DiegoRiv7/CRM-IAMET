from django.core.management.base import BaseCommand
from django.db import transaction

from app.models import Almacen, ClaveCFDI, UnidadCFDI


UNIDADES = [
    ('H87', 'Pieza'),
    ('E48', 'Unidad de servicio'),
    ('KGM', 'Kilogramo'),
    ('MTR', 'Metro'),
    ('LTR', 'Litro'),
    ('HUR', 'Hora'),
    ('DAY', 'Día'),
    ('MON', 'Mes'),
    ('ACT', 'Actividad'),
    ('PR', 'Par'),
]

# 50 claves CFDI: 25 producto + 25 servicio (claves SAT reales o realistas)
CLAVES_CFDI = [
    # Productos (25)
    ('01010101', 'No existe en el catálogo', 'producto'),
    ('43211503', 'Computadoras de escritorio', 'producto'),
    ('43211507', 'Computadoras portátiles', 'producto'),
    ('43211711', 'Monitores', 'producto'),
    ('43211706', 'Teclados', 'producto'),
    ('43211708', 'Ratones (mouse)', 'producto'),
    ('43222609', 'Switches de red', 'producto'),
    ('43222610', 'Routers', 'producto'),
    ('43222612', 'Puntos de acceso inalámbricos', 'producto'),
    ('43222802', 'Tarjetas de red', 'producto'),
    ('44103103', 'Cartuchos de tóner', 'producto'),
    ('44121701', 'Bolígrafos', 'producto'),
    ('44121706', 'Lápices', 'producto'),
    ('14111507', 'Papel para impresión', 'producto'),
    ('31201617', 'Tornillos de máquina', 'producto'),
    ('31161504', 'Tuercas', 'producto'),
    ('39121701', 'Cables eléctricos', 'producto'),
    ('39121311', 'Conectores eléctricos', 'producto'),
    ('40141607', 'Tubería de PVC', 'producto'),
    ('46171610', 'Cámaras de seguridad', 'producto'),
    ('46171619', 'Equipo de videovigilancia', 'producto'),
    ('50171550', 'Galletas', 'producto'),
    ('50202301', 'Agua embotellada', 'producto'),
    ('56121501', 'Mesas', 'producto'),
    ('56112102', 'Sillas de oficina', 'producto'),

    # Servicios (25)
    ('80111604', 'Servicios temporales de personal', 'servicio'),
    ('80111701', 'Servicios de outsourcing', 'servicio'),
    ('80141902', 'Servicios de mensajería', 'servicio'),
    ('81111500', 'Ingeniería de software', 'servicio'),
    ('81111811', 'Servicios de soporte técnico', 'servicio'),
    ('81112005', 'Servicios de capacitación en TI', 'servicio'),
    ('81112200', 'Mantenimiento de software', 'servicio'),
    ('81112201', 'Mantenimiento y soporte de hardware', 'servicio'),
    ('81112501', 'Servicios de telecomunicaciones', 'servicio'),
    ('72101511', 'Servicios de instalación eléctrica', 'servicio'),
    ('72151602', 'Servicios de instalación de cableado', 'servicio'),
    ('73152106', 'Servicios de mantenimiento industrial', 'servicio'),
    ('76111501', 'Servicios de limpieza', 'servicio'),
    ('76111502', 'Servicios de fumigación', 'servicio'),
    ('78111800', 'Servicios de transporte de carga', 'servicio'),
    ('78181500', 'Servicios de mantenimiento vehicular', 'servicio'),
    ('80161501', 'Servicios administrativos', 'servicio'),
    ('80161801', 'Servicios de archivo', 'servicio'),
    ('82101500', 'Publicidad y promoción', 'servicio'),
    ('82111900', 'Servicios de redacción profesional', 'servicio'),
    ('82141504', 'Servicios de diseño gráfico', 'servicio'),
    ('84111500', 'Servicios de contabilidad', 'servicio'),
    ('84111600', 'Servicios de auditoría', 'servicio'),
    ('84121806', 'Servicios financieros', 'servicio'),
    ('86101700', 'Servicios de capacitación', 'servicio'),
]


class Command(BaseCommand):
    help = "Seed inicial del módulo Compras: Almacenes, Unidades CFDI y Claves CFDI."

    @transaction.atomic
    def handle(self, *args, **options):
        # Almacén principal
        almacenes_creados = 0
        if not Almacen.objects.exists():
            Almacen.objects.create(nombre='Almacén Principal', activo=True)
            almacenes_creados = 1

        # Unidades CFDI
        unidades_creadas = 0
        for clave, descripcion in UNIDADES:
            _, created = UnidadCFDI.objects.get_or_create(
                clave=clave,
                defaults={'descripcion': descripcion},
            )
            if created:
                unidades_creadas += 1

        # Claves CFDI
        claves_creadas = 0
        for clave, descripcion, tipo in CLAVES_CFDI:
            _, created = ClaveCFDI.objects.get_or_create(
                clave=clave,
                defaults={'descripcion': descripcion, 'tipo': tipo},
            )
            if created:
                claves_creadas += 1

        self.stdout.write(self.style.SUCCESS(
            f"Seed Compras OK | Almacenes: +{almacenes_creados} (total {Almacen.objects.count()}) "
            f"| Unidades CFDI: +{unidades_creadas} (total {UnidadCFDI.objects.count()}) "
            f"| Claves CFDI: +{claves_creadas} (total {ClaveCFDI.objects.count()})"
        ))

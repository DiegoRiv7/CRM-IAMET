"""
Management command para crear un proyecto de prueba completamente llenado.
Uso: python manage.py crear_proyecto_prueba
"""
from decimal import Decimal
from datetime import date, timedelta, time
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone

from app.models import (
    TodoItem, Cliente, ProyectoIAMET, ProyectoPartida, ProyectoOrdenCompra,
    ProyectoFacturaProveedor, ProyectoFacturaIngreso, ProyectoGasto,
    ProyectoTarea, ProyectoAlerta, ProyectoConfiguracion,
    ProgramacionActividad,
)


class Command(BaseCommand):
    help = 'Crea un proyecto de prueba con datos simulados de avance al 60%'

    def handle(self, *args, **options):
        # Obtener primer superusuario o usuario activo
        user = User.objects.filter(is_superuser=True, is_active=True).first()
        if not user:
            user = User.objects.filter(is_active=True).first()
        if not user:
            self.stderr.write('No hay usuarios activos en el sistema')
            return

        self.stdout.write(f'Usando usuario: {user.username}')

        # Buscar o crear cliente
        cliente, _ = Cliente.objects.get_or_create(
            nombre_empresa='Planta Automotriz Otay',
            defaults={'asignado_a': user}
        )

        # Buscar oportunidad existente o crear una
        opp = TodoItem.objects.filter(usuario=user, cliente=cliente).first()
        if not opp:
            opp = TodoItem.objects.create(
                oportunidad='Instalacion CCTV y Red - Planta Otay',
                usuario=user,
                cliente=cliente,
                monto=Decimal('250000'),
                etapa_corta='En Transito',
                etapa_color='#673AB7',
                area='Seguridad',
                producto='AVIGILON',
                mes_cierre='04',
                anio_cierre=2026,
            )
            self.stdout.write(f'Oportunidad creada: {opp.oportunidad}')
        else:
            # Actualizar etapa para que se vea en el badge
            opp.etapa_corta = 'En Transito'
            opp.etapa_color = '#673AB7'
            opp.save(update_fields=['etapa_corta', 'etapa_color'])
            self.stdout.write(f'Oportunidad existente: {opp.oportunidad}')

        # Eliminar proyecto de prueba anterior si existe (cascade borra partidas, OCs, etc)
        ProyectoIAMET.objects.filter(nombre='Instalacion CCTV 16 Camaras - Planta Otay').delete()
        # Limpiar actividades de programa de obra huerfanas
        ProgramacionActividad.objects.filter(proyecto_key__startswith='proy_').filter(
            titulo__in=['Levantamiento fisico zona A', 'Instalacion canaletas piso 1',
                        'Cableado puntos 1-4', 'Montaje camaras lote 1', 'Config NVR y pruebas']
        ).delete()

        # Crear proyecto
        hoy = date.today()
        proyecto = ProyectoIAMET.objects.create(
            usuario=user,
            oportunidad=opp,
            nombre='Instalacion CCTV 16 Camaras - Planta Otay',
            descripcion='Proyecto de instalacion de 16 camaras de seguridad Avigilon, '
                        'cableado estructurado Cat6 y configuracion de NVR para planta '
                        'automotriz en zona Otay, Tijuana.',
            cliente_nombre='Planta Automotriz Otay',
            status='active',
            utilidad_presupuestada=Decimal('45000'),
            utilidad_real=Decimal('0'),
            fecha_inicio=hoy - timedelta(days=21),  # Inicio hace 3 semanas
            fecha_fin=hoy + timedelta(days=21),      # Fin en 3 semanas
        )
        self.stdout.write(f'Proyecto creado: {proyecto.nombre}')

        # Crear configuracion
        ProyectoConfiguracion.objects.get_or_create(
            proyecto=proyecto,
            defaults={
                'umbral_utilidad_minima': Decimal('15'),
                'umbral_alerta_varianza': Decimal('5'),
                'umbral_cantidad_critica': Decimal('2'),
                'requiere_aprobacion_gastos': True,
            }
        )

        # ── PARTIDAS ──
        partidas_data = [
            {
                'categoria': 'equipamiento', 'descripcion': 'Camara Avigilon H5A 4MP Bullet',
                'marca': 'Avigilon', 'numero_parte': 'H5A-BO-IR40',
                'cantidad': 16, 'cantidad_pendiente': 0,
                'costo_unitario': Decimal('4500'), 'precio_venta_unitario': Decimal('6200'),
                'proveedor': 'Anixter Mexico', 'status': 'received',
            },
            {
                'categoria': 'equipamiento', 'descripcion': 'NVR Avigilon 32 canales 24TB',
                'marca': 'Avigilon', 'numero_parte': 'NVR4X-32-24TB',
                'cantidad': 1, 'cantidad_pendiente': 0,
                'costo_unitario': Decimal('28000'), 'precio_venta_unitario': Decimal('38000'),
                'proveedor': 'Anixter Mexico', 'status': 'received',
            },
            {
                'categoria': 'accesorios', 'descripcion': 'Cable UTP Cat6 Panduit 305m',
                'marca': 'Panduit', 'numero_parte': 'PUP6C04BU-FE',
                'cantidad': 8, 'cantidad_pendiente': 2,
                'costo_unitario': Decimal('2800'), 'precio_venta_unitario': Decimal('3500'),
                'proveedor': 'Panduit Mexico', 'status': 'ordered',
            },
            {
                'categoria': 'accesorios', 'descripcion': 'Patch Panel 24 puertos Cat6',
                'marca': 'Panduit', 'numero_parte': 'CP24BLY',
                'cantidad': 2, 'cantidad_pendiente': 2,
                'costo_unitario': Decimal('1200'), 'precio_venta_unitario': Decimal('1800'),
                'proveedor': 'Panduit Mexico', 'status': 'pending',
            },
            {
                'categoria': 'mano_obra', 'descripcion': 'Instalacion y cableado (16 puntos)',
                'marca': '', 'numero_parte': '',
                'cantidad': 1, 'cantidad_pendiente': 1,
                'costo_unitario': Decimal('35000'), 'precio_venta_unitario': Decimal('48000'),
                'proveedor': 'IAMET Ingenieria', 'status': 'pending',
            },
            {
                'categoria': 'otros', 'descripcion': 'Tuberia conduit EMT 3/4 (tramos)',
                'marca': 'Generico', 'numero_parte': 'EMT-3/4',
                'cantidad': 40, 'cantidad_pendiente': 10,
                'costo_unitario': Decimal('85'), 'precio_venta_unitario': Decimal('120'),
                'proveedor': 'Electrica del Norte', 'status': 'in_transit',
            },
        ]

        partidas_creadas = {}
        for pd in partidas_data:
            p = ProyectoPartida.objects.create(proyecto=proyecto, **pd)
            partidas_creadas[pd['descripcion'][:20]] = p
            self.stdout.write(f'  Partida: {pd["descripcion"][:40]}')

        # ── ORDENES DE COMPRA ──
        camaras = partidas_creadas.get('Camara Avigilon H5A ')
        nvr = partidas_creadas.get('NVR Avigilon 32 cana')
        cable = partidas_creadas.get('Cable UTP Cat6 Pandu')
        tuberia = partidas_creadas.get('Tuberia conduit EMT ')

        # Limpiar OCs de prueba anteriores
        ProyectoOrdenCompra.objects.filter(numero_oc__startswith='OC-PRUEBA-').delete()

        ocs_data = [
            {
                'numero_oc': 'OC-PRUEBA-001', 'partida': camaras, 'proveedor': 'Anixter Mexico',
                'cantidad': 16, 'precio_unitario': Decimal('4500'),
                'status': 'received',
                'fecha_emision': hoy - timedelta(days=18),
                'fecha_entrega_esperada': hoy - timedelta(days=7),
                'fecha_entrega_real': hoy - timedelta(days=8),
            },
            {
                'numero_oc': 'OC-PRUEBA-002', 'partida': nvr, 'proveedor': 'Anixter Mexico',
                'cantidad': 1, 'precio_unitario': Decimal('28000'),
                'status': 'received',
                'fecha_emision': hoy - timedelta(days=18),
                'fecha_entrega_esperada': hoy - timedelta(days=5),
                'fecha_entrega_real': hoy - timedelta(days=5),
            },
            {
                'numero_oc': 'OC-PRUEBA-003', 'partida': cable, 'proveedor': 'Panduit Mexico',
                'cantidad': 6, 'precio_unitario': Decimal('2850'),  # Ligeramente mas caro
                'status': 'received',
                'fecha_emision': hoy - timedelta(days=14),
                'fecha_entrega_esperada': hoy - timedelta(days=3),
                'fecha_entrega_real': hoy - timedelta(days=2),
            },
            {
                'numero_oc': 'OC-PRUEBA-004', 'partida': tuberia, 'proveedor': 'Electrica del Norte',
                'cantidad': 30, 'precio_unitario': Decimal('90'),  # Mas caro que presupuesto
                'status': 'emitted',
                'fecha_emision': hoy - timedelta(days=5),
                'fecha_entrega_esperada': hoy + timedelta(days=3),
            },
        ]

        for od in ocs_data:
            oc = ProyectoOrdenCompra.objects.create(
                proyecto=proyecto,
                numero_oc=od['numero_oc'],
                partida=od['partida'],
                proveedor=od['proveedor'],
                cantidad=od['cantidad'],
                precio_unitario=od['precio_unitario'],
                status=od['status'],
                fecha_emision=od['fecha_emision'],
                fecha_entrega_esperada=od.get('fecha_entrega_esperada'),
                fecha_entrega_real=od.get('fecha_entrega_real'),
            )
            self.stdout.write(f'  OC: {oc.numero_oc} - {od["proveedor"]}')

        # ── FACTURAS PROVEEDOR ──
        ProyectoFacturaProveedor.objects.create(
            proyecto=proyecto,
            numero_factura='FAC-ANX-2026-4521',
            proveedor='Anixter Mexico',
            monto=Decimal('100000'),
            monto_presupuestado=Decimal('100000'),
            fecha_factura=hoy - timedelta(days=8),
            status='paid',
        )
        ProyectoFacturaProveedor.objects.create(
            proyecto=proyecto,
            numero_factura='FAC-PAN-2026-891',
            proveedor='Panduit Mexico',
            monto=Decimal('17100'),
            monto_presupuestado=Decimal('16800'),
            fecha_factura=hoy - timedelta(days=2),
            status='received',
        )
        self.stdout.write('  Facturas proveedor creadas')

        # ── FACTURAS INGRESO ──
        ProyectoFacturaIngreso.objects.create(
            proyecto=proyecto,
            numero_factura='IAMET-2026-0342',
            monto=Decimal('120000'),
            fecha_factura=hoy - timedelta(days=15),
            status='paid',
            metodo_pago='Transferencia',
        )
        ProyectoFacturaIngreso.objects.create(
            proyecto=proyecto,
            numero_factura='IAMET-2026-0358',
            monto=Decimal('80000'),
            fecha_factura=hoy - timedelta(days=3),
            status='emitted',
            metodo_pago='Transferencia',
        )
        self.stdout.write('  Facturas ingreso creadas')

        # ── GASTOS ──
        ProyectoGasto.objects.create(
            proyecto=proyecto,
            categoria='viatics',
            descripcion='Viaticos equipo instalacion (3 dias)',
            monto=Decimal('4500'),
            fecha_gasto=hoy - timedelta(days=10),
            estado_aprobacion='approved',
            aprobado_por=user,
        )
        ProyectoGasto.objects.create(
            proyecto=proyecto,
            categoria='fuel',
            descripcion='Combustible camioneta de obra',
            monto=Decimal('2800'),
            fecha_gasto=hoy - timedelta(days=5),
            estado_aprobacion='approved',
            aprobado_por=user,
        )
        ProyectoGasto.objects.create(
            proyecto=proyecto,
            categoria='equipment',
            descripcion='Renta de escalera telescopica',
            monto=Decimal('1500'),
            fecha_gasto=hoy - timedelta(days=3),
            estado_aprobacion='pending',
        )
        self.stdout.write('  Gastos creados')

        # ── TAREAS ──
        ahora = timezone.now()
        ProyectoTarea.objects.create(
            proyecto=proyecto, titulo='Levantamiento fisico de planta',
            status='completed', prioridad='high', asignado_a=user,
            fecha_limite=hoy - timedelta(days=14),
            fecha_completada=ahora - timedelta(days=15),
        )
        ProyectoTarea.objects.create(
            proyecto=proyecto, titulo='Instalacion de canaletas y tuberia',
            status='in_progress', prioridad='high', asignado_a=user,
            fecha_limite=hoy + timedelta(days=5),
        )
        ProyectoTarea.objects.create(
            proyecto=proyecto, titulo='Cableado UTP a los 16 puntos',
            status='pending', prioridad='medium', asignado_a=user,
            fecha_limite=hoy + timedelta(days=10),
        )
        ProyectoTarea.objects.create(
            proyecto=proyecto, titulo='Montaje de camaras en posiciones',
            status='pending', prioridad='medium', asignado_a=user,
            fecha_limite=hoy + timedelta(days=14),
        )
        ProyectoTarea.objects.create(
            proyecto=proyecto, titulo='Configuracion NVR y pruebas',
            status='pending', prioridad='high', asignado_a=user,
            fecha_limite=hoy + timedelta(days=18),
        )
        # Una tarea vencida para que baje efectividad
        ProyectoTarea.objects.create(
            proyecto=proyecto, titulo='Entrega de planos actualizados',
            status='pending', prioridad='low', asignado_a=user,
            fecha_limite=hoy - timedelta(days=2),  # Vencida
        )
        self.stdout.write('  Tareas creadas (1 vencida para bajar efectividad)')

        # ── ALERTAS ──
        ProyectoAlerta.objects.create(
            proyecto=proyecto,
            tipo_alerta='budget_variance',
            severidad='warning',
            titulo='Cable UTP comprado por encima del presupuesto',
            mensaje='El cable Cat6 se compro a $2,850/bobina vs $2,800 presupuestado (+1.8%).',
        )
        ProyectoAlerta.objects.create(
            proyecto=proyecto,
            tipo_alerta='delivery_delay',
            severidad='info',
            titulo='Tuberia EMT en transito',
            mensaje='La tuberia conduit tiene entrega estimada en 3 dias.',
        )
        self.stdout.write('  Alertas creadas')

        # ── PROGRAMA DE OBRA (actividades por semana) ──
        inicio = proyecto.fecha_inicio
        proyecto_key = f'proy_{proyecto.id}'

        # Semana 1: Levantamiento
        for i, dia in enumerate(['Lunes', 'Martes', 'Miercoles']):
            fecha = inicio + timedelta(days=i)
            ProgramacionActividad.objects.create(
                proyecto_key=proyecto_key,
                titulo='Levantamiento fisico zona ' + ['A', 'B', 'C'][i],
                dia_semana=dia,
                fecha=fecha,
                hora_inicio=time(8, 0),
                hora_fin=time(14, 0),
                creado_por=user,
            )

        # Semana 2: Canaletas
        for i, dia in enumerate(['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes']):
            fecha = inicio + timedelta(days=7 + i)
            ProgramacionActividad.objects.create(
                proyecto_key=proyecto_key,
                titulo='Instalacion canaletas piso ' + str(i + 1),
                dia_semana=dia,
                fecha=fecha,
                hora_inicio=time(7, 0),
                hora_fin=time(16, 0),
                creado_por=user,
            )

        # Semana 3: Cableado (actual)
        for i, dia in enumerate(['Lunes', 'Martes', 'Miercoles', 'Jueves']):
            fecha = inicio + timedelta(days=14 + i)
            ProgramacionActividad.objects.create(
                proyecto_key=proyecto_key,
                titulo='Cableado puntos ' + str(i*4+1) + '-' + str(i*4+4),
                dia_semana=dia,
                fecha=fecha,
                hora_inicio=time(7, 0),
                hora_fin=time(17, 0),
                creado_por=user,
            )

        # Semana 4-5: Futuras
        for i, dia in enumerate(['Lunes', 'Martes', 'Miercoles']):
            fecha = inicio + timedelta(days=21 + i)
            ProgramacionActividad.objects.create(
                proyecto_key=proyecto_key,
                titulo='Montaje camaras lote ' + str(i + 1),
                dia_semana=dia,
                fecha=fecha,
                hora_inicio=time(8, 0),
                hora_fin=time(15, 0),
                creado_por=user,
            )

        for i, dia in enumerate(['Lunes', 'Martes']):
            fecha = inicio + timedelta(days=28 + i)
            ProgramacionActividad.objects.create(
                proyecto_key=proyecto_key,
                titulo=['Config NVR y pruebas', 'Entrega y capacitacion'][i],
                dia_semana=dia,
                fecha=fecha,
                hora_inicio=time(8, 0),
                hora_fin=time(16, 0),
                creado_por=user,
            )

        self.stdout.write('  Programa de obra creado (5 semanas)')

        self.stdout.write(self.style.SUCCESS(
            f'\n Proyecto de prueba creado exitosamente: "{proyecto.nombre}" (ID: {proyecto.id})\n'
            f'  - 6 partidas (2 recibidas, 1 ordenada, 1 en transito, 2 pendientes)\n'
            f'  - 4 ordenes de compra (2 recibidas, 1 recibida parcial, 1 emitida)\n'
            f'  - 2 facturas proveedor, 2 facturas ingreso\n'
            f'  - 3 gastos (2 aprobados, 1 pendiente)\n'
            f'  - 6 tareas (1 completada, 1 en progreso, 3 pendientes, 1 vencida)\n'
            f'  - 2 alertas activas\n'
            f'  - ~17 actividades en programa de obra (5 semanas)\n'
        ))

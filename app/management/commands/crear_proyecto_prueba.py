"""
Management command para crear un proyecto de prueba completamente llenado.
Simula un proyecto real al 65% de avance con todos los modulos activos.
Uso: python manage.py crear_proyecto_prueba
"""
from decimal import Decimal
from datetime import date, timedelta, time, datetime
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone

from app.models import (
    TodoItem, Cliente, ProyectoIAMET, ProyectoPartida, ProyectoOrdenCompra,
    ProyectoFacturaProveedor, ProyectoFacturaIngreso, ProyectoGasto,
    ProyectoTarea, ProyectoAlerta, ProyectoConfiguracion,
    ProgramacionActividad,
)

NOMBRE_PROYECTO = 'Instalacion CCTV 16 Camaras - Planta Otay'


class Command(BaseCommand):
    help = 'Crea un proyecto de prueba realista con ~65% de avance'

    def handle(self, *args, **options):
        # ── USUARIOS ──
        users = list(User.objects.filter(is_active=True).order_by('-is_superuser', 'id')[:4])
        if not users:
            self.stderr.write('No hay usuarios activos en el sistema')
            return
        jefe = users[0]
        tecnico1 = users[1] if len(users) > 1 else jefe
        tecnico2 = users[2] if len(users) > 2 else jefe
        admin_user = users[3] if len(users) > 3 else jefe
        self.stdout.write(f'Jefe: {jefe.username}, Tecnicos: {tecnico1.username}, {tecnico2.username}')

        # ── CLIENTE ──
        cliente, _ = Cliente.objects.get_or_create(
            nombre_empresa='Planta Automotriz Otay',
            defaults={'asignado_a': jefe}
        )

        # ── OPORTUNIDAD VINCULADA ──
        opp = TodoItem.objects.filter(cliente=cliente, oportunidad__icontains='CCTV').first()
        if not opp:
            opp = TodoItem.objects.create(
                oportunidad='Instalacion CCTV y Red - Planta Automotriz Otay',
                usuario=jefe, cliente=cliente,
                monto=Decimal('282000'),
                etapa_corta='Facturado', etapa_color='#00BCD4',
                area='Seguridad', producto='AVIGILON',
                mes_cierre='04', anio_cierre=2026,
                probabilidad_cierre=85,
            )
            self.stdout.write(f'  Oportunidad creada: {opp.oportunidad}')
        else:
            opp.etapa_corta = 'Facturado'
            opp.etapa_color = '#00BCD4'
            opp.monto = Decimal('285000')
            opp.save(update_fields=['etapa_corta', 'etapa_color', 'monto'])
            self.stdout.write(f'  Oportunidad actualizada: {opp.oportunidad}')

        # ── LIMPIAR DATOS ANTERIORES ──
        old = ProyectoIAMET.objects.filter(nombre=NOMBRE_PROYECTO).first()
        if old:
            ProgramacionActividad.objects.filter(proyecto_key=f'proy_{old.id}').delete()
            old.delete()
        ProyectoOrdenCompra.objects.filter(numero_oc__startswith='OC-PRUEBA-').delete()
        self.stdout.write('  Datos anteriores limpiados')

        # ── PROYECTO ──
        hoy = date.today()
        inicio = hoy - timedelta(days=28)  # Inicio hace 4 semanas
        fin = hoy + timedelta(days=14)     # Fin en 2 semanas (6 semanas total)

        proyecto = ProyectoIAMET.objects.create(
            usuario=jefe, oportunidad=opp,
            nombre=NOMBRE_PROYECTO,
            descripcion=(
                'Proyecto de instalacion de sistema de videovigilancia con 16 camaras '
                'Avigilon H5A en planta automotriz. Incluye cableado estructurado Cat6 '
                'Panduit, NVR de 32 canales, canalizacion EMT, configuracion de software '
                'ACC y capacitacion al personal de seguridad. Zona industrial Otay, Tijuana.'
            ),
            cliente_nombre='Planta Automotriz Otay',
            status='active',
            utilidad_presupuestada=Decimal('76800'),  # venta $282k - costo $205.2k
            utilidad_real=Decimal('0'),
            fecha_inicio=inicio,
            fecha_fin=fin,
        )
        ProyectoConfiguracion.objects.get_or_create(
            proyecto=proyecto,
            defaults={
                'umbral_utilidad_minima': Decimal('15'),
                'umbral_alerta_varianza': Decimal('5'),
                'umbral_cantidad_critica': Decimal('2'),
                'requiere_aprobacion_gastos': True,
            }
        )
        self.stdout.write(f'  Proyecto: {proyecto.nombre} (ID: {proyecto.id})')
        pkey = f'proy_{proyecto.id}'

        # ══════════════════════════════════════════
        #  PARTIDAS (10 partidas realistas)
        # ══════════════════════════════════════════
        partidas = []
        pdata = [
            ('equipamiento', 'Camara Avigilon H5A 4MP Bullet IR40', 'Avigilon', 'H5A-BO-IR40', 16, 0, '4500', '6200', 'Anixter Mexico', 'received'),
            ('equipamiento', 'NVR Avigilon 32ch 24TB', 'Avigilon', 'NVR4X-32-24TB', 1, 0, '28000', '38000', 'Anixter Mexico', 'received'),
            ('equipamiento', 'Switch PoE 24 puertos Avigilon', 'Avigilon', 'AVG-POE24-370W', 2, 0, '8500', '12000', 'Anixter Mexico', 'received'),
            ('equipamiento', 'Licencia ACC Enterprise 16ch', 'Avigilon', 'ACC7-ENT-16CH', 1, 0, '15000', '22000', 'Anixter Mexico', 'closed'),
            ('accesorios', 'Cable UTP Cat6 Panduit 305m', 'Panduit', 'PUP6C04BU-FE', 8, 2, '2800', '3500', 'Panduit Mexico', 'ordered'),
            ('accesorios', 'Patch Panel 24 puertos Cat6', 'Panduit', 'CP24BLY', 2, 0, '1200', '1800', 'Panduit Mexico', 'received'),
            ('accesorios', 'Jack RJ45 Cat6 (bolsa 50)', 'Panduit', 'CJ688TGBU', 4, 1, '950', '1400', 'Panduit Mexico', 'ordered'),
            ('otros', 'Tuberia conduit EMT 3/4 (tramo 3m)', 'Generico', 'EMT-3/4-3M', 40, 10, '85', '120', 'Electrica del Norte', 'in_transit'),
            ('otros', 'Gabinete metalico 19" 12U', 'Linkedpro', 'LP-19-12U', 1, 0, '3200', '4800', 'TVC Mexico', 'received'),
            ('mano_obra', 'Instalacion, cableado y puesta en marcha', '', '', 1, 1, '38000', '52000', 'IAMET Ingenieria', 'pending'),
        ]
        for cat, desc, marca, np, cant, pend, cu, vu, prov, st in pdata:
            p = ProyectoPartida.objects.create(
                proyecto=proyecto, categoria=cat, descripcion=desc, marca=marca,
                numero_parte=np, cantidad=cant, cantidad_pendiente=pend,
                costo_unitario=Decimal(cu), precio_venta_unitario=Decimal(vu),
                proveedor=prov, status=st,
            )
            partidas.append(p)
        self.stdout.write(f'  {len(partidas)} partidas creadas')

        # ══════════════════════════════════════════
        #  ORDENES DE COMPRA (7 OCs)
        # ══════════════════════════════════════════
        cam = partidas[0]   # Camara
        nvr = partidas[1]   # NVR
        sw = partidas[2]    # Switch
        cable = partidas[4] # Cable
        patch = partidas[5] # Patch Panel
        tub = partidas[7]   # Tuberia
        gab = partidas[8]   # Gabinete

        ocs = [
            ('OC-PRUEBA-001', cam, 'Anixter Mexico', 16, '4500', 'received', -25, -12, -13),
            ('OC-PRUEBA-002', nvr, 'Anixter Mexico', 1, '28000', 'received', -25, -10, -10),
            ('OC-PRUEBA-003', sw, 'Anixter Mexico', 2, '8700', 'received', -25, -10, -11),  # +200 mas caro
            ('OC-PRUEBA-004', cable, 'Panduit Mexico', 6, '2850', 'received', -18, -5, -4),  # +50 mas caro
            ('OC-PRUEBA-005', patch, 'Panduit Mexico', 2, '1200', 'received', -18, -5, -5),
            ('OC-PRUEBA-006', tub, 'Electrica del Norte', 30, '90', 'emitted', -7, 5, None),  # +5 mas caro, en camino
            ('OC-PRUEBA-007', gab, 'TVC Mexico', 1, '3200', 'received', -20, -8, -9),
        ]
        for noc, part, prov, cant, pu, st, em, esp, real in ocs:
            ProyectoOrdenCompra.objects.create(
                proyecto=proyecto, numero_oc=noc, partida=part, proveedor=prov,
                cantidad=cant, precio_unitario=Decimal(pu), status=st,
                fecha_emision=hoy + timedelta(days=em),
                fecha_entrega_esperada=hoy + timedelta(days=esp) if esp else None,
                fecha_entrega_real=hoy + timedelta(days=real) if real else None,
            )
        self.stdout.write(f'  7 ordenes de compra creadas')

        # ══════════════════════════════════════════
        #  FACTURAS PROVEEDOR (4 facturas)
        # ══════════════════════════════════════════
        # Facturas deben coincidir con OCs recibidas:
        # Anixter: camaras $72k + NVR $28k + switches $17,400 = $117,400
        # Panduit: cable $17,100 + patch $2,400 = $19,500
        # TVC: gabinete $3,200
        # Total facturas proveedor: $140,100
        facprov = [
            ('FAC-ANX-2026-4521', 'Anixter Mexico', '117400', '117000', -13, 'paid'),
            ('FAC-PAN-2026-891', 'Panduit Mexico', '19500', '19200', -4, 'received'),
            ('FAC-TVC-2026-112', 'TVC Mexico', '3200', '3200', -9, 'paid'),
        ]
        for nf, prov, monto, presu, dias, st in facprov:
            ProyectoFacturaProveedor.objects.create(
                proyecto=proyecto, numero_factura=nf, proveedor=prov,
                monto=Decimal(monto), monto_presupuestado=Decimal(presu),
                fecha_factura=hoy + timedelta(days=dias), status=st,
            )
        self.stdout.write('  3 facturas proveedor ($140,100 de $205,200 presupuestado)')

        # ══════════════════════════════════════════
        #  FACTURAS INGRESO (3 facturas cobradas al cliente)
        # ══════════════════════════════════════════
        # Venta total del proyecto: $282,000
        # Anticipo 50% al firmar, 30% a medio proyecto, 20% al entregar
        # Proyecto al 65% → anticipo cobrado + segundo pago cobrado
        facing = [
            ('IAMET-2026-0342', '141000', -20, 'paid', 'Transferencia'),   # 50% anticipo
            ('IAMET-2026-0358', '84600', -5, 'paid', 'Transferencia'),     # 30% avance
            # El 20% restante ($56,400) se cobra al entregar → no facturado aun
        ]
        for nf, monto, dias, st, metodo in facing:
            ProyectoFacturaIngreso.objects.create(
                proyecto=proyecto, numero_factura=nf, monto=Decimal(monto),
                fecha_factura=hoy + timedelta(days=dias), status=st,
                metodo_pago=metodo,
            )
        self.stdout.write('  2 facturas ingreso ($225,600 cobrado de $282,000 total)')

        # ══════════════════════════════════════════
        #  GASTOS OPERATIVOS (5 gastos)
        # ══════════════════════════════════════════
        gastos = [
            ('viatics', 'Viaticos equipo instalacion Sem 1 (hotel+comida)', '3800', -21, 'approved'),
            ('fuel', 'Combustible camioneta obra Sem 1-2', '2400', -14, 'approved'),
            ('viatics', 'Viaticos equipo instalacion Sem 2-3', '4200', -10, 'approved'),
            ('equipment', 'Renta escalera telescopica 6m (2 semanas)', '2800', -7, 'approved'),
            ('fuel', 'Combustible camioneta obra Sem 3-4', '1900', -3, 'pending'),
            ('meals', 'Comidas equipo en sitio (15 dias)', '3600', -2, 'pending'),
        ]
        for cat, desc, monto, dias, estado in gastos:
            ProyectoGasto.objects.create(
                proyecto=proyecto, categoria=cat, descripcion=desc,
                monto=Decimal(monto), fecha_gasto=hoy + timedelta(days=dias),
                estado_aprobacion=estado,
                aprobado_por=jefe if estado == 'approved' else None,
                fecha_aprobacion=timezone.now() + timedelta(days=dias) if estado == 'approved' else None,
            )
        self.stdout.write('  6 gastos operativos')

        # ══════════════════════════════════════════
        #  TAREAS DEL PROYECTO (10 tareas)
        # ══════════════════════════════════════════
        ahora = timezone.now()
        tareas = [
            ('Levantamiento fisico de areas', 'completed', 'high', jefe, -24, -23),
            ('Elaborar planos de instalacion', 'completed', 'high', tecnico1, -21, -19),
            ('Validar planos con cliente', 'completed', 'medium', jefe, -18, -17),
            ('Instalar canalizacion EMT planta baja', 'completed', 'high', tecnico2, -14, -10),
            ('Instalar canalizacion EMT planta alta', 'completed', 'high', tecnico2, -10, -7),
            ('Tender cableado UTP puntos 1-8', 'completed', 'medium', tecnico1, -7, -4),
            ('Tender cableado UTP puntos 9-16', 'in_progress', 'medium', tecnico1, 3, None),
            ('Montaje de camaras en posiciones', 'pending', 'high', tecnico2, 7, None),
            ('Configuracion NVR, ACC y pruebas', 'pending', 'high', jefe, 10, None),
            ('Capacitacion personal seguridad + entrega', 'pending', 'medium', jefe, 13, None),
            # Tarea vencida (baja efectividad)
            ('Entregar reporte fotografico semanal', 'pending', 'low', tecnico1, -3, None),
            ('Actualizar diagrama de red as-built', 'pending', 'low', tecnico2, -1, None),
        ]
        for titulo, estado, prio, asig, fl_dias, fc_dias in tareas:
            ProyectoTarea.objects.create(
                proyecto=proyecto, titulo=titulo, status=estado,
                prioridad=prio, asignado_a=asig,
                fecha_limite=hoy + timedelta(days=fl_dias),
                fecha_completada=ahora + timedelta(days=fc_dias) if fc_dias else None,
            )
        self.stdout.write('  12 tareas (6 completadas, 1 en progreso, 3 pendientes, 2 vencidas)')

        # ══════════════════════════════════════════
        #  ALERTAS (4 alertas)
        # ══════════════════════════════════════════
        alertas = [
            ('budget_variance', 'warning', 'Switch PoE comprado $200 por encima del presupuesto',
             'Se compro a $8,700 vs $8,500 presupuestado por unidad (+2.4%). Total extra: $400.'),
            ('budget_variance', 'info', 'Cable UTP ligeramente por encima',
             'Cable Cat6 comprado a $2,850 vs $2,800 presupuestado (+1.8%). Total extra: $300.'),
            ('task_overdue', 'warning', 'Reporte fotografico semanal vencido',
             'La tarea "Entregar reporte fotografico semanal" vencio hace 3 dias sin completarse.'),
            ('delivery_delay', 'info', 'Tuberia EMT en transito',
             'OC-PRUEBA-006: 30 tramos de tuberia EMT con entrega estimada en 5 dias.'),
        ]
        for tipo, sev, titulo, msg in alertas:
            ProyectoAlerta.objects.create(
                proyecto=proyecto, tipo_alerta=tipo, severidad=sev,
                titulo=titulo, mensaje=msg,
            )
        # 1 alerta resuelta
        ProyectoAlerta.objects.create(
            proyecto=proyecto, tipo_alerta='critical_item_low', severidad='critical',
            titulo='Stock critico: Patch Panels recibidos',
            mensaje='Los 2 Patch Panels Cat6 ya fueron recibidos. Alerta resuelta.',
            resuelta=True, fecha_resolucion=timezone.now() - timedelta(days=5),
        )
        self.stdout.write('  5 alertas (4 activas, 1 resuelta)')

        # ══════════════════════════════════════════
        #  PROGRAMA DE OBRA (6 semanas completas)
        # ══════════════════════════════════════════
        ProgramacionActividad.objects.filter(proyecto_key=pkey).delete()

        def _lunes_de(fecha):
            """Retorna el lunes de la semana de la fecha dada."""
            return fecha - timedelta(days=fecha.weekday())

        lunes_inicio = _lunes_de(inicio)
        dias_nombre = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes']

        # Semana 1: Levantamiento y planos
        sem1 = lunes_inicio
        sem1_acts = [
            (0, 'Levantamiento zona A - Planta Baja', time(7,0), time(13,0), [jefe, tecnico1]),
            (0, 'Toma de medidas y fotos', time(14,0), time(17,0), [tecnico1]),
            (1, 'Levantamiento zona B - Planta Alta', time(7,0), time(13,0), [jefe, tecnico1]),
            (1, 'Revision de ductos existentes', time(14,0), time(17,0), [tecnico2]),
            (2, 'Levantamiento zona C - Estacionamiento', time(7,0), time(12,0), [tecnico1, tecnico2]),
            (2, 'Elaboracion de planos preliminares', time(13,0), time(17,0), [jefe]),
            (3, 'Revision de planos con ingeniero', time(8,0), time(12,0), [jefe, tecnico1]),
            (3, 'Cotizar materiales con proveedores', time(13,0), time(17,0), [jefe]),
            (4, 'Validacion de planos con cliente', time(9,0), time(11,0), [jefe]),
            (4, 'Generar ordenes de compra', time(12,0), time(16,0), [jefe]),
        ]
        for dia_idx, titulo, hi, hf, responsables in sem1_acts:
            fecha = sem1 + timedelta(days=dia_idx)
            act = ProgramacionActividad.objects.create(
                proyecto_key=pkey, titulo=titulo, dia_semana=dias_nombre[dia_idx],
                fecha=fecha, hora_inicio=hi, hora_fin=hf, creado_por=jefe,
            )
            act.responsables.set(responsables)

        # Semana 2: Canalizacion planta baja
        sem2 = sem1 + timedelta(days=7)
        for i in range(5):
            fecha = sem2 + timedelta(days=i)
            act = ProgramacionActividad.objects.create(
                proyecto_key=pkey,
                titulo=f'Canalizacion EMT planta baja - Tramo {i+1}',
                dia_semana=dias_nombre[i], fecha=fecha,
                hora_inicio=time(7,0), hora_fin=time(16,0), creado_por=jefe,
            )
            act.responsables.set([tecnico1, tecnico2])
            if i == 4:  # Viernes: revision
                act2 = ProgramacionActividad.objects.create(
                    proyecto_key=pkey, titulo='Revision avance canalizacion PB',
                    dia_semana=dias_nombre[i], fecha=fecha,
                    hora_inicio=time(16,0), hora_fin=time(17,30), creado_por=jefe,
                )
                act2.responsables.set([jefe])

        # Semana 3: Canalizacion planta alta + inicio cableado
        sem3 = sem1 + timedelta(days=14)
        for i in range(5):
            fecha = sem3 + timedelta(days=i)
            if i < 3:
                titulo = f'Canalizacion EMT planta alta - Tramo {i+1}'
            else:
                titulo = f'Cableado UTP puntos {(i-3)*4+1}-{(i-3)*4+4}'
            act = ProgramacionActividad.objects.create(
                proyecto_key=pkey, titulo=titulo,
                dia_semana=dias_nombre[i], fecha=fecha,
                hora_inicio=time(7,0), hora_fin=time(17,0), creado_por=jefe,
            )
            act.responsables.set([tecnico1, tecnico2])

        # Semana 4: Cableado completo (semana actual aprox)
        sem4 = sem1 + timedelta(days=21)
        for i in range(5):
            fecha = sem4 + timedelta(days=i)
            act = ProgramacionActividad.objects.create(
                proyecto_key=pkey,
                titulo=f'Cableado UTP puntos {i*3+5}-{i*3+7}' if i < 4 else 'Certificacion puntos de red',
                dia_semana=dias_nombre[i], fecha=fecha,
                hora_inicio=time(7,0), hora_fin=time(16,0) if i < 4 else time(14,0),
                creado_por=jefe,
            )
            act.responsables.set([tecnico1] if i < 4 else [tecnico1, tecnico2])

        # Semana 5: Montaje de camaras
        sem5 = sem1 + timedelta(days=28)
        for i in range(5):
            fecha = sem5 + timedelta(days=i)
            if i < 4:
                titulo = f'Montaje camaras {i*4+1}-{i*4+4}'
                resp = [tecnico1, tecnico2]
            else:
                titulo = 'Revision final de montaje + fotos'
                resp = [jefe, tecnico1]
            act = ProgramacionActividad.objects.create(
                proyecto_key=pkey, titulo=titulo,
                dia_semana=dias_nombre[i], fecha=fecha,
                hora_inicio=time(7,0), hora_fin=time(16,0), creado_por=jefe,
            )
            act.responsables.set(resp)

        # Semana 6: Config NVR + entrega
        sem6 = sem1 + timedelta(days=35)
        sem6_acts = [
            (0, 'Instalacion NVR y switches en gabinete', time(7,0), time(15,0), [tecnico1, tecnico2]),
            (1, 'Configuracion ACC Enterprise + camaras', time(7,0), time(17,0), [jefe, tecnico1]),
            (2, 'Pruebas de grabacion y visualizacion', time(8,0), time(14,0), [jefe]),
            (2, 'Ajuste de angulos y zonas de deteccion', time(14,0), time(17,0), [tecnico2]),
            (3, 'Capacitacion personal de seguridad', time(9,0), time(13,0), [jefe]),
            (3, 'Documentacion as-built y manuales', time(14,0), time(17,0), [tecnico1]),
            (4, 'Entrega formal al cliente + acta', time(10,0), time(12,0), [jefe]),
            (4, 'Limpieza de areas de trabajo', time(13,0), time(15,0), [tecnico1, tecnico2]),
        ]
        for dia_idx, titulo, hi, hf, responsables in sem6_acts:
            fecha = sem6 + timedelta(days=dia_idx)
            act = ProgramacionActividad.objects.create(
                proyecto_key=pkey, titulo=titulo, dia_semana=dias_nombre[dia_idx],
                fecha=fecha, hora_inicio=hi, hora_fin=hf, creado_por=jefe,
            )
            act.responsables.set(responsables)

        total_acts = ProgramacionActividad.objects.filter(proyecto_key=pkey).count()
        self.stdout.write(f'  {total_acts} actividades en programa de obra (6 semanas)')

        # ══════════════════════════════════════════
        #  RESUMEN FINAL
        # ══════════════════════════════════════════
        self.stdout.write(self.style.SUCCESS(
            f'\n✅ Proyecto de prueba creado: "{proyecto.nombre}" (ID: {proyecto.id})\n'
            f'   Oportunidad: {opp.oportunidad} (etapa: {opp.etapa_corta})\n'
            f'   Periodo: {inicio} → {fin} ({(fin - inicio).days} dias)\n'
            f'   ────────────────────────────────────────\n'
            f'   10 partidas (costo $205,200 / venta $282,000 / utilidad $76,800)\n'
            f'   7 ordenes de compra ($142,800 gastado en OCs)\n'
            f'   3 facturas proveedor ($140,100 pagado a proveedores)\n'
            f'   2 facturas ingreso ($225,600 cobrado al cliente de $282,000)\n'
            f'   6 gastos operativos ($18,700 total, 4 aprobados)\n'
            f'   12 tareas (6 completadas, 1 en progreso, 3 pendientes, 2 vencidas)\n'
            f'   5 alertas (4 activas, 1 resuelta)\n'
            f'   {total_acts} actividades en programa de obra (6 semanas)\n'
        ))

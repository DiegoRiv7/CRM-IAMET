"""
MULTIEMPRESA — Datos de DEMOSTRACIÓN para una instancia (Fase 3).

Siembra una empresa ficticia completa para que la presentación se vea viva:
usuarios por rol, clientes con contactos, oportunidades en todas las etapas
(runrate y proyecto), cotizaciones con partidas, actividades del calendario,
tareas, proyectos, prospectos y correos simulados ya analizados para "Mi día".

    manage.py seed_demo            # siembra (si ya se sembró, no duplica)
    manage.py seed_demo --reset    # borra lo sembrado antes y vuelve a sembrar
    manage.py seed_demo --sin-ia   # no analiza los correos con IA

Se corre DENTRO de la instancia demo (nunca en IAMET). Los correos usan el
dominio `simulacion.iamet`, que el módulo de correo trata como simulado (al
responder no manda SMTP).
"""
import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from app.models import (
    Actividad, AsistenteEstado, Cliente, Contacto, Cotizacion, DetalleCotizacion,
    EmpresaConfig, EtapaPipeline, MailCorreo, MensajeOportunidad, OpcionCatalogo,
    Prospecto, Proyecto, Tarea, TodoItem, UserProfile,
)

SIM_DOM = 'simulacion.iamet'
PASSWORD = 'Demo2026*'
MARCA = '[demo]'   # se escribe en info_adicional / comentarios para reconocer lo sembrado

USUARIOS = [
    # username, nombre, apellido, rol, supervisor
    ('gerardo.ruiz',   'Gerardo', 'Ruiz',    'vendedor', True),
    ('laura.mendoza',  'Laura',   'Mendoza', 'vendedor', False),
    ('carlos.ibarra',  'Carlos',  'Ibarra',  'vendedor', False),
    ('sofia.castro',   'Sofía',   'Castro',  'vendedor', False),
]

CLIENTES = [
    # nombre, ciudad, categoría, contacto (nombre, apellido, puesto)
    ('Maquilas del Pacífico',            'Tijuana, B.C.',        'A', ('Patricia', 'Núñez',   'Gerente de Compras')),
    ('Constructora Río Bravo',           'Monterrey, N.L.',      'A', ('Jorge',    'Salas',   'Director de Proyectos')),
    ('Grupo Metalúrgico Saltillo',       'Saltillo, Coah.',      'A', ('Rocío',    'Delgado', 'Jefa de Mantenimiento')),
    ('Envases Industriales de Tijuana',  'Tijuana, B.C.',        'B', ('Héctor',   'Villa',   'Compras')),
    ('Automotriz Mexicali',              'Mexicali, B.C.',       'A', ('Ana',      'Torres',  'Gerente de Planta')),
    ('Alimentos La Frontera',            'Ciudad Juárez, Chih.', 'B', ('Luis',     'Peña',    'Supervisor de Producción')),
    ('Hospital San José',                'Tijuana, B.C.',        'C', ('Mariana',  'Ochoa',   'Administración')),
    ('Transportes Cabral',               'Hermosillo, Son.',     'B', ('Raúl',     'Cabral',  'Director General')),
    ('Vidriera Norteña',                 'Monterrey, N.L.',      'B', ('Elena',    'Garza',   'Compras')),
    ('Fábrica de Muebles Encino',        'Ensenada, B.C.',       'C', ('Tomás',    'Reyes',   'Dueño')),
    ('Parque Industrial Otay',           'Tijuana, B.C.',        'A', ('Daniela',  'Fuentes', 'Gerente de Operaciones')),
    ('Cementos del Valle',               'Chihuahua, Chih.',     'B', ('Miguel',   'Aguirre', 'Ingeniería')),
    ('Minera Cerro Prieto',              'Mexicali, B.C.',       'A', ('Fernanda', 'Solís',   'Compras Estratégicas')),
    ('Logística Peninsular',             'La Paz, B.C.S.',       'C', ('Andrés',   'Cota',    'Gerente de Almacén')),
    ('Universidad Tecnológica del Norte','Tijuana, B.C.',        'C', ('Verónica', 'Lara',    'Recursos Materiales')),
]

# (título, cliente_idx, vendedor_idx, pipeline, etapa, producto, area, monto, prob, mes_offset)
# mes_offset: meses relativos al mes actual para mes_cierre (negativo = ya pasó).
OPORTUNIDADES = [
    ('Estructura metálica nave 3',              1, 1, 'proyecto', 'Cotizando',    'PROYECTO', 'Operaciones', 1250000, 40, 1),
    ('Suministro de perfiles IPR Q4',           0, 1, 'runrate',  'Enviada',      'PRODUCTO', 'Compras',      380000, 60, 0),
    ('Mantenimiento de grúas viajeras',         2, 2, 'runrate',  'Seguimiento',  'SERVICIO', 'Operaciones',  145000, 70, 0),
    ('Software de control de inventario',       4, 3, 'runrate',  'Cotizando',    'SOFTWARE', 'Sistemas',     210000, 35, 1),
    ('Póliza de mantenimiento anual',           5, 2, 'runrate',  'Vendido c/PO', 'POLIZA',   'Dirección',     96000, 90, 0),
    ('Racks para almacén de refacciones',       3, 1, 'runrate',  'En Solicitud', 'PRODUCTO', 'Compras',       68000, 15, 1),
    ('Tanques de acero inoxidable',             5, 3, 'proyecto', 'Levantamiento','PROYECTO', 'Operaciones',  540000, 25, 2),
    ('Curso de soldadura certificada',          7, 2, 'runrate',  'Enviada',      'CURSO',    'Recursos Humanos', 42000, 55, 0),
    ('Escaleras y barandales planta B',         4, 1, 'runrate',  'Seguimiento',  'PRODUCTO', 'Operaciones',  175000, 65, 0),
    ('Reforzamiento de estructura bodega',      10, 3, 'proyecto', 'Enviada',     'PROYECTO', 'Dirección',    830000, 50, 1),
    ('Puertas industriales seccionales',        8, 2, 'runrate',  'Cotizando',    'PRODUCTO', 'Compras',      122000, 40, 1),
    ('Módulo de reportes para ERP',             11, 3, 'runrate', 'Seguimiento',  'SOFTWARE', 'Sistemas',     185000, 60, 0),
    ('Suministro de lámina galvanizada',        0, 1, 'runrate',  'Entregado',    'PRODUCTO', 'Compras',      264000, 95, 0),
    ('Techumbre para patio de maniobras',       12, 2, 'proyecto', 'Seguimiento', 'PROYECTO', 'Operaciones',  690000, 45, 1),
    ('Mesas de trabajo acero inoxidable',       6, 3, 'runrate',  'En Solicitud', 'PRODUCTO', 'Otra',          58000, 20, 1),
    ('Mantenimiento de compresores',            9, 2, 'runrate',  'Enviada',      'SERVICIO', 'Operaciones',   47000, 50, 0),
    ('Cercado perimetral',                      13, 1, 'runrate', 'Cotizando',    'PRODUCTO', 'Dirección',    134000, 35, 1),
    ('Capacitación en seguridad industrial',    14, 3, 'runrate', 'Vendido c/PO', 'CURSO',    'Recursos Humanos', 36000, 90, 0),
    ('Sistema de monitoreo de energía',         4, 3, 'runrate',  'Facturado',    'SOFTWARE', 'Sistemas',     156000, 100, -1),
    ('Plataformas de acceso a silos',           11, 2, 'proyecto', 'Vendido c/PO','PROYECTO', 'Operaciones',  410000, 85, 0),
    ('Anaqueles para laboratorio',              6, 1, 'runrate',  'Pagado',       'PRODUCTO', 'Compras',       74000, 100, -2),
    ('Póliza de soporte de software',           11, 3, 'runrate', 'Pagado',       'POLIZA',   'Sistemas',      52000, 100, -1),
    ('Estructura para mezzanine',               2, 2, 'proyecto', 'Pagado',       'PROYECTO', 'Operaciones',  312000, 100, -2),
    ('Suministro de tubería de acero',          12, 1, 'runrate', 'Pagado',       'PRODUCTO', 'Compras',      198000, 100, -1),
    ('Marquesina de acceso principal',          7, 2, 'runrate',  'Perdido',      'PRODUCTO', 'Dirección',     89000, 0, -1),
    ('Automatización de báscula',               13, 3, 'runrate', 'Perdido',      'SOFTWARE', 'Sistemas',     120000, 0, -2),
    ('Contenedores metálicos de reciclaje',     3, 1, 'runrate',  'Seguimiento',  'PRODUCTO', 'Operaciones',   61000, 60, 0),
    ('Rehabilitación de andenes de carga',      1, 2, 'proyecto', 'Cotizando',    'PROYECTO', 'Operaciones',  460000, 30, 2),
    ('Licencias de software de diseño',         14, 3, 'runrate', 'En Solicitud', 'SOFTWARE', 'Sistemas',      33000, 15, 1),
    ('Mantenimiento preventivo trimestral',     10, 1, 'runrate', 'Seguimiento',  'SERVICIO', 'Operaciones',   88000, 70, 0),
]

COTIZACIONES = [
    # oportunidad_idx, partidas [(nombre, cantidad, precio_unitario)]
    (1, [('Perfil IPR 10" x 12 m', 40, 6800), ('Placa de acero A36 1/2" 4x8', 25, 3950), ('Flete y maniobras', 1, 18500)]),
    (2, [('Servicio de mantenimiento grúa viajera 10 t', 2, 42000), ('Refacciones y consumibles', 1, 26500), ('Certificación de carga', 2, 17250)]),
    (3, [('Licencia software de inventario (anual)', 10, 9800), ('Implementación y capacitación', 1, 68000), ('Lector de códigos industrial', 6, 7300)]),
    (9, [('Columnas y vigas IPR reforzadas', 18, 21500), ('Montaje y soldadura en sitio', 1, 185000), ('Pintura anticorrosiva', 1, 46000)]),
]

CORREOS = [
    # (cliente_idx, minutos_atras, asunto, cuerpo, opp_idx o None)
    (0, 35, 'Solicitud de cotización — racks para almacén',
     'Buenas tardes Laura:\n\nNecesitamos cotización de 24 racks selectivos de 3 niveles para el nuevo almacén de refacciones. Medidas 2.4 x 1.0 x 4.5 m, capacidad 1,500 kg por nivel. ¿Podrías enviarnos precio, tiempo de entrega y condiciones de pago?\n\nSaludos,\nPatricia Núñez\nCompras — Maquilas del Pacífico', None),
    (1, 180, 'Comentarios a su cotización de perfiles IPR',
     'Hola Laura:\n\nRevisamos la cotización de los perfiles IPR. El precio es competitivo, pero necesitamos que la entrega baje a 3 semanas; es condición de dirección para autorizar. ¿Lo ven factible?\n\nJorge Salas', 1),
    (3, 1500, 'Duda sobre el pedido en curso',
     'Buen día:\n\nSobre la lámina galvanizada que pedimos la semana pasada, ¿me confirma si la entrega sigue programada para el viernes? Necesito coordinar al personal de recibo.\n\nGracias,\nHéctor Villa', None),
    (4, 2900, 'Orden de compra OC-7731 firmada',
     'Estimada Laura:\n\nAdjunto la orden de compra OC-7731 firmada por dirección para las escaleras y barandales de la planta B. Favor de confirmar recepción y fecha estimada de entrega.\n\nAna Torres\nGerente de Planta — Automotriz Mexicali', 8),
    (13, 4300, 'Boletín mensual: novedades en logística',
     'Conoce nuestras nuevas rutas, promociones de temporada y consejos para optimizar tus embarques. Da clic para ver el boletín completo. Si no deseas recibir estos correos, cancela tu suscripción aquí.', None),
    (10, 5800, '¿Podemos agendar visita técnica?',
     'Laura, buenas tardes.\n\nQueremos avanzar con el reforzamiento de la bodega. ¿Podrías venir el jueves a las 10 para revisar la estructura con nuestro ingeniero? Confírmame por favor.\n\nDaniela Fuentes', 9),
]


def _mes_relativo(offset):
    hoy = timezone.localtime().date()
    m = hoy.month + offset
    a = hoy.year
    while m < 1:
        m += 12; a -= 1
    while m > 12:
        m -= 12; a += 1
    return str(m).zfill(2), a


class Command(BaseCommand):
    help = 'Siembra datos ficticios de demostración (empresa completa) en ESTA instancia.'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true', help='Borra lo sembrado antes y vuelve a sembrar')
        parser.add_argument('--sin-ia', action='store_true', help='No analizar los correos con IA')

    # ── Utilidades ──────────────────────────────────────────────────────
    def _p(self, msg):
        self.stdout.write(f'  ✓ {msg}')

    def _borrar(self):
        users = list(User.objects.filter(username__in=[u[0] for u in USUARIOS]))
        MailCorreo.objects.filter(usuario__in=users).delete()
        Actividad.objects.filter(creado_por__in=users).delete()
        Tarea.objects.filter(creado_por__in=users).delete()
        Proyecto.objects.filter(creado_por__in=users).delete()
        Prospecto.objects.filter(usuario__in=users).delete()
        TodoItem.objects.filter(usuario__in=users).delete()          # cascada: cotizaciones, mensajes
        Cliente.objects.filter(info_adicional=MARCA).delete()         # cascada: contactos
        AsistenteEstado.objects.filter(usuario__in=users).delete()
        for u in users:
            u.delete()
        self._p('datos de demo anteriores borrados')

    # ── Siembra ─────────────────────────────────────────────────────────
    @transaction.atomic
    def handle(self, *args, **o):
        random.seed(2026)
        cfg = EmpresaConfig.get_singleton()
        if cfg.es_iamet:
            self.stderr.write('Esta instancia es IAMET: seed_demo solo se corre en instancias de demostración.')
            return
        if User.objects.filter(username=USUARIOS[1][0]).exists():
            if not o['reset']:
                self.stdout.write('Ya hay datos de demo (usa --reset para volver a sembrar).')
                return
            self._borrar()

        # 0) Etapas compatibles (si el pipeline está vacío o es el genérico viejo)
        from app.management.commands.seed_empresa import ETAPAS_DEFAULT
        nombres = set(EtapaPipeline.objects.filter(pipeline='runrate').values_list('nombre', flat=True))
        if not nombres or not ({'Pagado', 'Perdido'} & nombres):
            EtapaPipeline.objects.all().delete()
            for pipeline, etapas in ETAPAS_DEFAULT.items():
                for i, (n, c) in enumerate(etapas, start=1):
                    EtapaPipeline.objects.create(pipeline=pipeline, nombre=n, color=c, orden=i)
            self._p('etapas del pipeline reemplazadas por las compatibles')
        etapa_color = {(e.pipeline, e.nombre): e.color for e in EtapaPipeline.objects.all()}

        # 1) Usuarios
        grupo, _ = Group.objects.get_or_create(name='Supervisores')
        users = []
        for username, nombre, apellido, rol, sup in USUARIOS:
            u, _ = User.objects.get_or_create(username=username, defaults={
                'first_name': nombre, 'last_name': apellido,
                'email': f'{username}@{cfg.dominio_correo or "empresa.com"}', 'is_staff': sup,
            })
            u.set_password(PASSWORD); u.save()
            perfil, _ = UserProfile.objects.get_or_create(user=u)
            perfil.rol = rol
            perfil.meta_mensual = Decimal('1200000' if sup else '650000')
            perfil.puede_crear_prospecto = True
            perfil.theme = 'perla' if 'perla' in dict(UserProfile.THEME_CHOICES) else perfil.theme
            perfil.save()
            if sup:
                u.groups.add(grupo)
            users.append(u)
        self._p(f'usuarios: {", ".join(u.username for u in users)} (contraseña {PASSWORD})')
        vendedores = users[1:]

        # 2) Clientes y contactos
        clientes, contactos = [], []
        for i, (nombre, ciudad, cat, (cn, ca, puesto)) in enumerate(CLIENTES):
            dueno = vendedores[i % len(vendedores)]
            slug = nombre.lower().replace(' ', '').replace('é', 'e').replace('í', 'i').replace('ó', 'o').replace('á', 'a').replace('ú', 'u')[:14]
            c = Cliente.objects.create(
                nombre_empresa=nombre, contacto_principal=f'{cn} {ca}',
                telefono=f'+52 {random.choice(["664", "81", "844", "686", "656", "662", "614", "612"])} {random.randint(100, 999)} {random.randint(1000, 9999)}',
                email=f'compras@{slug}.{SIM_DOM}', direccion=ciudad, categoria=cat,
                asignado_a=dueno, meta_mensual=Decimal(random.choice([150000, 250000, 400000, 600000])),
                info_adicional=MARCA,
            )
            ct = Contacto.objects.create(
                nombre=cn, apellido=ca, cliente=c, puesto=puesto,
                email=f'{cn.lower().replace("ó","o").replace("é","e")}.{ca.lower().replace("ú","u").replace("í","i")}@{slug}.{SIM_DOM}',
                telefono=c.telefono,
            )
            clientes.append(c); contactos.append(ct)
        self._p(f'clientes: {len(clientes)} con contacto')

        # 3) Oportunidades
        opps = []
        ahora = timezone.now()
        for (titulo, ci, vi, pipe, etapa, prod, area, monto, prob, off) in OPORTUNIDADES:
            mes, anio = _mes_relativo(off)
            terminal = etapa in ('Pagado', 'Perdido', 'Facturado', 'Entregado')
            po = f'PO-{random.randint(40000, 89999)}' if etapa in ('Vendido c/PO', 'Entregado', 'Facturado', 'Pagado') else ''
            opp = TodoItem.objects.create(
                usuario=users[vi], oportunidad=titulo, cliente=clientes[ci], contacto=contactos[ci],
                producto=prod, area=area, monto=Decimal(monto), probabilidad_cierre=prob,
                mes_cierre=mes, anio_cierre=anio, tipo_negociacion=pipe,
                etapa_corta=etapa, etapa_completa=etapa, etapa_color=etapa_color.get((pipe, etapa), '#6B7280'),
                po_number=po, factura_numero=(f'F-{random.randint(1000, 4999)}' if etapa in ('Facturado', 'Pagado') else ''),
                monto_facturacion=Decimal(monto) if etapa in ('Facturado', 'Pagado') else Decimal('0'),
                comentarios=f'{MARCA} Oportunidad de demostración.',
                estado_crm='vendida' if etapa in ('Vendido c/PO', 'Entregado', 'Facturado', 'Pagado') else ('perdida' if etapa == 'Perdido' else 'seguimiento'),
            )
            # Antigüedad realista (para "días sin movimiento" y filtros por fecha)
            dias = random.randint(25, 80) if terminal else random.randint(2, 40)
            TodoItem.objects.filter(pk=opp.pk).update(
                fecha_creacion=ahora - timedelta(days=dias),
                fecha_actualizacion=ahora - timedelta(days=random.randint(0, min(dias, 12))),
            )
            opps.append(opp)
        self._p(f'oportunidades: {len(opps)} ({sum(1 for o in opps if o.etapa_corta == "Pagado")} pagadas, {sum(1 for o in opps if o.etapa_corta == "Perdido")} perdidas)')

        # Conversación en algunas oportunidades
        charlas = [
            (0, 1, 'Cliente pidió desglose por partida; lo mando hoy con la cotización actualizada.'),
            (0, 0, 'Perfecto. Revisa que incluya el flete a Monterrey.'),
            (2, 2, 'Visita técnica realizada. Las dos grúas necesitan cambio de cable y freno.'),
            (8, 1, 'Llegó la OC-7731 firmada. Paso a Vendido c/PO y programo entrega.'),
            (11, 3, 'Sistemas quiere una demo del módulo el martes. Ya la agendé.'),
        ]
        for oi, ui, texto in charlas:
            MensajeOportunidad.objects.create(oportunidad=opps[oi], usuario=users[ui], texto=texto)

        # 4) Cotizaciones con partidas
        marca_default = OpcionCatalogo.objects.filter(tipo='marca', activo=True).order_by('orden').first()
        for n, (oi, partidas) in enumerate(COTIZACIONES, start=1):
            opp = opps[oi]
            cot = Cotizacion.objects.create(
                titulo=f'COT-{2026}-{100 + n:03d} {opp.oportunidad}', cliente=opp.cliente, oportunidad=opp,
                usuario_final=opp.cliente.nombre_empresa, descripcion=opp.oportunidad,
                nombre_cotizacion=opp.oportunidad, moneda='MXN', tipo_cotizacion='Iamet',
                iva_rate=Decimal('0.16'), created_by=opp.usuario,
                comentarios='Precios en pesos mexicanos. Vigencia 15 días. Tiempo de entrega 3 a 4 semanas.',
            )
            subtotal = Decimal('0')
            for k, (nombre, cant, precio) in enumerate(partidas, start=1):
                precio = Decimal(precio); total = precio * cant
                DetalleCotizacion.objects.create(
                    cotizacion=cot, nombre_producto=nombre, cantidad=cant, precio_unitario=precio,
                    descuento_porcentaje=Decimal('0'), precio_con_descuento=precio, total=total,
                    marca=(marca_default.valor if marca_default else None), orden=k, tipo='producto',
                )
                subtotal += total
            cot.subtotal = subtotal; cot.iva_amount = (subtotal * Decimal('0.16')).quantize(Decimal('0.01'))
            cot.total = subtotal + cot.iva_amount; cot.save()
        self._p(f'cotizaciones: {len(COTIZACIONES)} con partidas')

        # 5) Calendario: próximos 10 días hábiles
        colores = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#5856D6']
        tipos = [('reunion', 'Reunión con {c}: {o}'), ('llamada', 'Llamada de seguimiento — {c}'), ('seguimiento', 'Enviar cotización actualizada — {o}'), ('reunion', 'Visita técnica en planta — {c}')]
        creadas, dia, i = 0, timezone.localtime().replace(hour=9, minute=0, second=0, microsecond=0), 0
        abiertas = [op for op in opps if op.etapa_corta not in ('Pagado', 'Perdido', 'Facturado', 'Entregado')]
        while creadas < 14:
            dia += timedelta(days=1)
            if dia.weekday() >= 5:
                continue
            for _ in range(random.choice([1, 2])):
                if creadas >= 14:
                    break
                op = abiertas[i % len(abiertas)]; i += 1
                tipo, plantilla = tipos[creadas % len(tipos)]
                inicio = dia + timedelta(hours=random.choice([0, 1.5, 3, 5, 6.5]))
                act = Actividad.objects.create(
                    titulo=plantilla.format(c=op.cliente.nombre_empresa, o=op.oportunidad),
                    tipo_actividad=tipo, descripcion=f'{MARCA} Seguimiento de la oportunidad "{op.oportunidad}".',
                    fecha_inicio=inicio, fecha_fin=inicio + timedelta(hours=1), creado_por=op.usuario,
                    color=colores[creadas % len(colores)], oportunidad=op,
                )
                act.participantes.add(op.usuario)
                creadas += 1
        # Un par de actividades pasadas ya completadas (historial)
        for k, op in enumerate(abiertas[:3]):
            fi = timezone.localtime() - timedelta(days=3 + k, hours=2)
            a = Actividad.objects.create(titulo=f'Llamada inicial — {op.cliente.nombre_empresa}', tipo_actividad='llamada',
                                         descripcion=f'{MARCA} Primer contacto.', fecha_inicio=fi, fecha_fin=fi + timedelta(minutes=30),
                                         creado_por=op.usuario, color='#34C759', oportunidad=op, completada=True,
                                         resultado='Interesados; piden cotización formal.')
            a.participantes.add(op.usuario)
        self._p(f'actividades del calendario: {creadas + 3}')

        # 6) Proyectos y tareas
        proyectos = []
        for nombre, desc, ops_idx, miembros in [
            ('Nave 3 — Constructora Río Bravo', 'Estructura metálica y montaje de la nave 3.', [0, 27], [1, 2]),
            ('Automatización Automotriz Mexicali', 'Escaleras, barandales y monitoreo de energía en planta B.', [8, 18], [1, 3]),
        ]:
            pr = Proyecto.objects.create(nombre=nombre, descripcion=f'{MARCA} {desc}', tipo='runrate', privacidad='publico', creado_por=users[0])
            pr.miembros.add(*[users[m] for m in miembros])
            pr.oportunidades_ligadas.add(*[opps[x] for x in ops_idx])
            proyectos.append(pr)
        tareas = [
            ('Enviar cotización de racks a Maquilas del Pacífico', 1, 'alta', 'pendiente', 1, 5),
            ('Confirmar entrega de lámina galvanizada', 1, 'alta', 'en_progreso', 2, 12),
            ('Preparar demo del módulo de reportes', 3, 'media', 'pendiente', 3, 11),
            ('Programar visita a Parque Industrial Otay', 3, 'media', 'iniciada', 4, 9),
            ('Cerrar póliza con Alimentos La Frontera', 2, 'alta', 'completada', -1, 4),
            ('Actualizar lista de precios Q4', 0, 'baja', 'pendiente', 7, None),
        ]
        for titulo, ui, prio, estado, dias_limite, oi in tareas:
            t = Tarea.objects.create(
                titulo=titulo, descripcion=f'{MARCA} Tarea de demostración.', creado_por=users[0], asignado_a=users[ui],
                prioridad=prio, estado=estado, fecha_limite=ahora + timedelta(days=dias_limite),
                oportunidad=opps[oi] if oi is not None else None, cliente=opps[oi].cliente if oi is not None else None,
                proyecto=proyectos[0] if oi in (0, 27) else (proyectos[1] if oi in (8, 18) else None),
                fecha_completada=ahora - timedelta(days=1) if estado == 'completada' else None,
            )
            t.participantes.add(users[ui])
        self._p(f'proyectos: {len(proyectos)} · tareas: {len(tareas)}')

        # 7) Prospectos (clientes potenciales)
        prospectos = [
            ('Ferretera del Noroeste', 'identificado', 'PRODUCTO', 1),
            ('Embotelladora Sonora', 'calificado', 'SERVICIO', 2),
            ('Colegio Internacional Tijuana', 'reunion', 'PRODUCTO', 3),
            ('Textiles Mexicali', 'en_progreso', 'PROYECTO', 1),
            ('Pesquera del Pacífico', 'calificado', 'SOFTWARE', 3),
        ]
        for nombre, etapa, prod, ui in prospectos:
            cp = Cliente.objects.create(nombre_empresa=nombre, es_prospecto=True, asignado_a=users[ui], categoria='C', info_adicional=MARCA,
                                        email=f'contacto@{nombre.lower().split()[0]}.{SIM_DOM}')
            Prospecto.objects.create(usuario=users[ui], nombre=f'Prospección {nombre}', cliente=cp, producto=prod, area='Compras',
                                     tipo_pipeline='runrate', etapa=etapa, comentarios=f'{MARCA} Prospecto de demostración.')
        self._p(f'prospectos: {len(prospectos)}')

        # 8) Correos simulados para Laura (Mi día / asistente)
        laura = users[1]
        AsistenteEstado.objects.get_or_create(usuario=laura)
        for ci, mins, asunto, cuerpo, oi in CORREOS:
            ct = contactos[ci]
            fecha = ahora - timedelta(minutes=mins)
            MailCorreo.objects.create(
                usuario=laura, conexion=None, uid_imap=f'sim_{int(fecha.timestamp() * 1000)}',
                message_id=f'<sim-{int(fecha.timestamp() * 1000)}@{SIM_DOM}>', carpeta_imap='INBOX', carpeta_display='INBOX',
                remitente_nombre=f'{ct.nombre} {ct.apellido}', remitente_email=ct.email,
                destinatarios_json='[]', asunto=asunto, cuerpo_texto=cuerpo, cuerpo_html='', cuerpo_cargado=True,
                leido=False, fecha_envio=fecha, oportunidad=opps[oi] if oi is not None else None,
            )
        # El boletín (índice 4) viene de un remitente desconocido
        MailCorreo.objects.filter(usuario=laura, asunto__startswith='Boletín').update(
            remitente_nombre='Logística Express', remitente_email='noticias@logisticaexpress-promo.com')
        self._p(f'correos simulados para {laura.username}: {len(CORREOS)}')

        analizados = 0
        if not o['sin_ia']:
            from app.views_crm import analizar_correos_recientes
            try:
                analizados = analizar_correos_recientes(laura)
            except Exception as e:  # noqa: BLE001
                self.stdout.write(f'  ! análisis IA no disponible: {e}')
        self._p(f'correos analizados para Mi día: {analizados}')

        self.stdout.write(self.style.SUCCESS(
            f'Demo lista. Entra como laura.mendoza / {PASSWORD} (vendedora) o gerardo.ruiz / {PASSWORD} (supervisor).'
        ))

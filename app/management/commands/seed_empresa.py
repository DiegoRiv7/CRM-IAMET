"""
MULTIEMPRESA — Semilla de una empresa NUEVA (instancia recién creada).

Crea/actualiza el singleton EmpresaConfig, un catálogo genérico (producto /
área / marca), las etapas del pipeline por defecto, el nombre del asistente
y, opcionalmente, el superusuario. Idempotente: se puede correr varias veces.

    manage.py seed_empresa --nombre "Acme S.A." --slug acme \
        [--correo ventas@acme.com] [--dominio acme.com] [--sitio https://acme.com] \
        [--admin-email admin@acme.com --admin-password '...'] [--catalogo-iamet]

Lo llama scripts/nueva_empresa.sh justo después de `migrate` (Fase 2).
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from app.models import AsistenteConfig, EmpresaConfig, EtapaPipeline, OpcionCatalogo


# (tipo, valor, etiqueta, etiqueta_corta, alias, es_columna, es_default, orden)
CATALOGO_GENERICO = [
    ('producto', 'PRODUCTO',  'Producto',  'Prod.',   '', True,  True,  10),
    ('producto', 'SERVICIO',  'Servicio',  'Serv.',   '', True,  False, 20),
    ('producto', 'SOFTWARE',  'Software',  'Soft.',   '', True,  False, 30),
    ('producto', 'PROYECTO',  'Proyecto',  'Proy.',   '', True,  False, 40),
    ('producto', 'POLIZA',    'Póliza',    'Pol.',    '', False, False, 50),
    ('producto', 'CURSO',     'Curso',     'Curso',   '', False, False, 60),
    ('area', 'Dirección',        'Dirección',        '', '', False, True,  10),
    ('area', 'Compras',          'Compras',          '', '', False, False, 20),
    ('area', 'Sistemas',         'Sistemas',         '', '', False, False, 30),
    ('area', 'Operaciones',      'Operaciones',      '', '', False, False, 40),
    ('area', 'Recursos Humanos', 'Recursos Humanos', '', '', False, False, 50),
    ('area', 'Otra',             'Otra',             '', '', False, False, 60),
    ('marca', 'GENERICA', 'Genérica', '', '', False, True, 10),
]

# Mismo catálogo que la migración 0224 siembra para IAMET (para demos "tipo IAMET").
CATALOGO_IAMET = None  # se importa perezosamente de la migración

ETAPAS_DEFAULT = {
    'runrate': [
        ('Prospección', '#94A3B8'), ('Contacto', '#60A5FA'), ('Cotizado', '#F59E0B'),
        ('Negociación', '#A78BFA'), ('Orden de compra', '#34D399'), ('Facturado', '#10B981'),
        ('Perdida', '#EF4444'),
    ],
    'proyecto': [
        ('Levantamiento', '#94A3B8'), ('Propuesta', '#60A5FA'), ('Cotizado', '#F59E0B'),
        ('Negociación', '#A78BFA'), ('Orden de compra', '#34D399'), ('Ejecución', '#38BDF8'),
        ('Facturado', '#10B981'), ('Perdida', '#EF4444'),
    ],
}


class Command(BaseCommand):
    help = 'Siembra la configuración inicial de una empresa nueva (config, catálogos, etapas, admin).'

    def add_arguments(self, parser):
        parser.add_argument('--nombre', required=True, help='Nombre de la empresa (p. ej. "Acme S.A.")')
        parser.add_argument('--slug', required=True, help='Identificador corto sin espacios (p. ej. acme)')
        parser.add_argument('--nombre-corto', default='', help='Nombre para el menú lateral')
        parser.add_argument('--razon-social', default='')
        parser.add_argument('--correo', default='', help='Correo de ventas/contacto')
        parser.add_argument('--dominio', default='', help='Dominio de correo del equipo (p. ej. acme.com)')
        parser.add_argument('--sitio', default='', help='Sitio web')
        parser.add_argument('--telefono', default='')
        parser.add_argument('--admin-email', default='', help='Crea/actualiza un superusuario con este correo')
        parser.add_argument('--admin-password', default='')
        parser.add_argument('--catalogo-iamet', action='store_true', help='Usar el catálogo de marcas de IAMET en vez del genérico')
        parser.add_argument('--sin-etapas', action='store_true', help='No sembrar etapas del pipeline')

    @transaction.atomic
    def handle(self, *args, **o):
        slug = (o['slug'] or '').strip().lower()
        nombre = (o['nombre'] or '').strip()
        if not slug or not nombre:
            self.stderr.write('Faltan --slug y --nombre')
            return

        # 1) EmpresaConfig
        cfg = EmpresaConfig.get_singleton()
        cfg.slug = slug
        cfg.nombre = nombre
        cfg.nombre_corto = o['nombre_corto'] or nombre.split(' ')[0][:40]
        cfg.razon_social = o['razon_social'] or cfg.razon_social
        if o['correo']:
            cfg.correo_ventas = o['correo']
            cfg.correo_contacto = cfg.correo_contacto or o['correo']
        cfg.dominio_correo = o['dominio'] or cfg.dominio_correo or (o['correo'].split('@')[-1] if '@' in o['correo'] else '')
        cfg.sitio_web = o['sitio'] or cfg.sitio_web
        cfg.telefono = o['telefono'] or cfg.telefono
        cfg.save()
        self.stdout.write(f'✓ EmpresaConfig: {cfg.titulo} (slug={cfg.slug})')

        # 2) Catálogos (solo si están vacíos)
        if not OpcionCatalogo.objects.exists():
            if o['catalogo_iamet']:
                from app.migrations import __name__ as _m  # noqa: F401
                from importlib import import_module
                mig = import_module('app.migrations.0224_multiempresa_config_catalogos')
                filas = mig.CATALOGO_IAMET
            else:
                filas = CATALOGO_GENERICO
            OpcionCatalogo.objects.bulk_create([
                OpcionCatalogo(tipo=t, valor=v, etiqueta=e, etiqueta_corta=c, alias=a,
                               es_columna=col, es_default=d, orden=od, activo=True)
                for (t, v, e, c, a, col, d, od) in filas
            ])
            self.stdout.write(f'✓ Catálogos: {len(filas)} opciones')
        else:
            self.stdout.write('· Catálogos: ya existían, no se tocan')

        # 3) Etapas del pipeline
        if not o['sin_etapas'] and not EtapaPipeline.objects.exists():
            n = 0
            for pipeline, etapas in ETAPAS_DEFAULT.items():
                for i, (nombre_e, color) in enumerate(etapas, start=1):
                    EtapaPipeline.objects.create(pipeline=pipeline, nombre=nombre_e, color=color, orden=i)
                    n += 1
            self.stdout.write(f'✓ Etapas del pipeline: {n}')
        else:
            self.stdout.write('· Etapas: ya existían o se omitieron')

        # 4) Asistente
        asis = AsistenteConfig.get_singleton()
        if asis.nombre in ('', 'IAMET AI') and slug != 'iamet':
            asis.nombre = f'{cfg.nombre_corto} AI'
            asis.save(update_fields=['nombre'])
            self.stdout.write(f'✓ Asistente: {asis.nombre}')

        # 5) Superusuario
        if o['admin_email']:
            User = get_user_model()
            u, creado = User.objects.get_or_create(
                username=o['admin_email'], defaults={'email': o['admin_email'], 'is_staff': True, 'is_superuser': True}
            )
            if o['admin_password']:
                u.set_password(o['admin_password'])
            u.is_staff = u.is_superuser = True
            u.save()
            self.stdout.write(f'✓ Superusuario {"creado" if creado else "actualizado"}: {u.username}')

        from app.empresa import invalidar_cache
        invalidar_cache()
        self.stdout.write(self.style.SUCCESS('Semilla completa.'))

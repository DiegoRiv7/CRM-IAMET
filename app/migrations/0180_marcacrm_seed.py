"""
Seed inicial de MarcaCRM con las 11 marcas históricamente hardcoded en
`views_v2/marcas_v2.MARCAS_CATALOGO`. Preserva el comportamiento del
dashboard una vez que la vista lee desde DB en vez de la constante.

Las marcas se insertan con metadatos mínimos: nombre, key, categoría.
Logo, descripción, contactos, meta_anual y estrategia se dejan vacíos
para que los supervisores los llenen desde el panel.

Idempotente: usa `update_or_create` por `key` para que correr la
migración más de una vez no genere duplicados.
"""
from django.db import migrations


MARCAS_SEED = [
    ('ZEBRA',    'Zebra',    'Identificación & captura'),
    ('PANDUIT',  'Panduit',  'Cableado estructurado'),
    ('APC',      'APC',      'Energía & UPS'),
    ('AVIGILON', 'Avigilon', 'Cámaras premium'),
    ('GENETEC',  'Genetec',  'Plataforma de seguridad'),
    ('AXIS',     'Axis',     'Cámaras premium'),
    ('SOFTWARE', 'Software', 'Desarrollo & licencias'),
    ('RUNRATE',  'Runrate',  'Recurrente'),
    ('POLIZA',   'Pólizas',  'Servicio & soporte'),
    ('CISCO',    'Cisco',    'Networking'),
    ('SERVICIO', 'Servicio', 'Servicios profesionales'),
]


def seed_marcas(apps, schema_editor):
    MarcaCRM = apps.get_model('app', 'MarcaCRM')
    for key, nombre, categoria in MARCAS_SEED:
        MarcaCRM.objects.update_or_create(
            key=key,
            defaults={
                'nombre': nombre,
                'categoria': categoria,
                'activa': True,
            },
        )


def unseed_marcas(apps, schema_editor):
    # Reverse: borra solo las marcas seed (por key). Marcas creadas
    # después por el usuario se conservan.
    MarcaCRM = apps.get_model('app', 'MarcaCRM')
    keys = [k for k, _, _ in MARCAS_SEED]
    MarcaCRM.objects.filter(key__in=keys).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0179_marcacrm'),
    ]

    operations = [
        migrations.RunPython(seed_marcas, unseed_marcas),
    ]

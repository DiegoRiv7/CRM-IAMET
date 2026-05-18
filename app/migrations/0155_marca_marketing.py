# Generated manually for Marketing Hub — gestión de marcas editables.
from django.db import migrations, models


# ── Seed inicial: las 8 marcas que el Marketing Hub ya muestra hoy.
#    Los slugs DEBEN coincidir con `RecursoMarketing.brand` para que el
#    filtro por marca siga funcionando.
SEED = [
    {'slug': 'zebra',     'nombre': 'Zebra',     'orden': 0},
    {'slug': 'panduit',   'nombre': 'Panduit',   'orden': 1},
    {'slug': 'avigilion', 'nombre': 'Avigilion', 'orden': 2},
    {'slug': 'genetec',   'nombre': 'Genetec',   'orden': 3},
    {'slug': 'axis',      'nombre': 'Axis',      'orden': 4},
    {'slug': 'apc',       'nombre': 'APC',       'orden': 5},
    {'slug': 'cisco',     'nombre': 'Cisco',     'orden': 6},
    {'slug': 'iamet',     'nombre': 'IAMET',     'orden': 7},
]


def seed_marcas(apps, schema_editor):
    MarcaMarketing = apps.get_model('app', 'MarcaMarketing')
    # Idempotente: solo poblar si la tabla está vacía.
    if MarcaMarketing.objects.exists():
        return
    for item in SEED:
        MarcaMarketing.objects.create(
            slug=item['slug'],
            nombre=item['nombre'],
            orden=item['orden'],
            visible=True,
        )


def unseed_marcas(apps, schema_editor):
    MarcaMarketing = apps.get_model('app', 'MarcaMarketing')
    MarcaMarketing.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0154_recurso_marketing_y_permiso'),
    ]

    operations = [
        migrations.CreateModel(
            name='MarcaMarketing',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.CharField(db_index=True, help_text='Identificador estable. Debe coincidir con RecursoMarketing.brand.', max_length=20, unique=True)),
                ('nombre', models.CharField(help_text='Nombre visible.', max_length=80)),
                ('logo', models.ImageField(blank=True, null=True, upload_to='marketing/marcas/')),
                ('visible', models.BooleanField(db_index=True, default=True)),
                ('orden', models.PositiveIntegerField(default=0)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Marca de Marketing',
                'verbose_name_plural': 'Marcas de Marketing',
                'ordering': ['orden', 'nombre'],
            },
        ),
        migrations.RunPython(seed_marcas, reverse_code=unseed_marcas),
    ]

"""
ProveedorCRM — Catálogo de proveedores del distribuidor con metadata
rica (logo, descripción, 3 contactos planos: principal/ventas/soporte,
meta anual, estrategia).

Espejo estructural de MarcaCRM (0179). La `key` será el identificador
estable usado en URLs y, cuando exista el campo `TodoItem.proveedor`,
en filtros de pipeline/facturación. Soft-delete vía `activa=False`
para preservar referencias históricas.

Sin seed: los proveedores se capturan manualmente desde el panel admin.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0180_marcacrm_seed'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProveedorCRM',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=80, unique=True)),
                ('key', models.CharField(db_index=True, max_length=40, unique=True)),
                ('categoria', models.CharField(blank=True, default='', max_length=100)),
                ('descripcion', models.TextField(blank=True, default='')),
                ('logo', models.ImageField(blank=True, null=True, upload_to='proveedores/logos/')),
                ('contacto_principal_nombre', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_principal_email', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_principal_telefono', models.CharField(blank=True, default='', max_length=40)),
                ('contacto_ventas_nombre', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_ventas_email', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_ventas_telefono', models.CharField(blank=True, default='', max_length=40)),
                ('contacto_soporte_nombre', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_soporte_email', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_soporte_telefono', models.CharField(blank=True, default='', max_length=40)),
                ('meta_anual', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('estrategia', models.TextField(blank=True, default='')),
                ('activa', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Proveedor CRM',
                'verbose_name_plural': 'Proveedores CRM',
                'ordering': ['nombre'],
            },
        ),
    ]

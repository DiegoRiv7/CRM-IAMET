from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Modulo Compras: agrega rol 'administrador' y crea Almacen, ClaveCFDI,
    UnidadCFDI, Producto, Proveedor, ProductoSnapshot y ProveedorSnapshot."""

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0127_gantt_programa_obra'),
    ]

    operations = [
        migrations.AlterField(
            model_name='userprofile',
            name='rol',
            field=models.CharField(
                choices=[
                    ('vendedor', 'Vendedor'),
                    ('ingeniero', 'Ingeniero'),
                    ('administrador', 'Administrador'),
                ],
                default='vendedor',
                max_length=20,
                verbose_name='Rol',
            ),
        ),
        migrations.CreateModel(
            name='Almacen',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=100, unique=True)),
                ('activo', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name': 'Almacén',
                'verbose_name_plural': 'Almacenes',
                'ordering': ['nombre'],
            },
        ),
        migrations.CreateModel(
            name='ClaveCFDI',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('clave', models.CharField(db_index=True, max_length=8, unique=True)),
                ('descripcion', models.CharField(max_length=255)),
                ('tipo', models.CharField(choices=[('producto', 'Producto'), ('servicio', 'Servicio')], max_length=10)),
            ],
            options={
                'verbose_name': 'Clave CFDI (SAT)',
                'verbose_name_plural': 'Claves CFDI (SAT)',
                'ordering': ['clave'],
            },
        ),
        migrations.CreateModel(
            name='UnidadCFDI',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('clave', models.CharField(db_index=True, max_length=5, unique=True)),
                ('descripcion', models.CharField(max_length=100)),
            ],
            options={
                'verbose_name': 'Unidad CFDI (SAT)',
                'verbose_name_plural': 'Unidades CFDI (SAT)',
                'ordering': ['clave'],
            },
        ),
        migrations.CreateModel(
            name='Producto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('codigo', models.CharField(db_index=True, max_length=30, unique=True)),
                ('nombre', models.CharField(max_length=255)),
                ('descripcion', models.TextField()),
                ('costo', models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ('moneda', models.CharField(choices=[('MXN', 'MXN'), ('USD', 'USD')], default='MXN', max_length=3)),
                ('iva', models.DecimalField(choices=[(8.0, '8%'), (16.0, '16%')], decimal_places=2, default=16.0, max_digits=4)),
                ('tipo', models.CharField(choices=[('PRODUCTO', 'Producto'), ('SERVICIO', 'Servicio')], editable=False, max_length=10)),
                ('estatus', models.CharField(choices=[('activo', 'Activo'), ('inactivo', 'Inactivo')], default='activo', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('almacenes', models.ManyToManyField(blank=True, related_name='productos', to='app.almacen')),
                ('clave_cfdi', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='productos', to='app.clavecfdi')),
                ('unidad_cfdi', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='productos', to='app.unidadcfdi')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='productos_creados', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Producto',
                'verbose_name_plural': 'Productos',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='Proveedor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('razon_social', models.CharField(max_length=255)),
                ('rfc', models.CharField(blank=True, db_index=True, max_length=13, null=True, unique=True)),
                ('tipo_persona', models.CharField(blank=True, choices=[('moral', 'Moral'), ('fisica', 'Física')], max_length=10)),
                ('dias_credito', models.PositiveIntegerField(default=0)),
                ('monto_credito', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('banco', models.CharField(blank=True, max_length=100)),
                ('cuenta_bancaria', models.CharField(blank=True, max_length=50)),
                ('clabe', models.CharField(blank=True, max_length=18)),
                ('cuenta_contable', models.CharField(max_length=50)),
                ('calle', models.CharField(blank=True, max_length=200)),
                ('numero', models.CharField(blank=True, max_length=20)),
                ('colonia', models.CharField(blank=True, max_length=120)),
                ('ciudad', models.CharField(blank=True, max_length=120)),
                ('estado', models.CharField(blank=True, max_length=120)),
                ('cp', models.CharField(blank=True, max_length=10)),
                ('estatus', models.CharField(choices=[('activo', 'Activo'), ('inactivo', 'Inactivo')], default='activo', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='proveedores_creados', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Proveedor',
                'verbose_name_plural': 'Proveedores',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='ProductoSnapshot',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('codigo', models.CharField(max_length=30)),
                ('nombre', models.CharField(max_length=255)),
                ('costo', models.DecimalField(decimal_places=4, max_digits=14)),
                ('iva', models.DecimalField(decimal_places=2, max_digits=4)),
                ('descripcion', models.TextField()),
                ('captured_at', models.DateTimeField(auto_now_add=True)),
                ('producto', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='snapshots', to='app.producto')),
            ],
        ),
        migrations.CreateModel(
            name='ProveedorSnapshot',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('razon_social', models.CharField(max_length=255)),
                ('rfc', models.CharField(blank=True, max_length=13)),
                ('cuenta_contable', models.CharField(max_length=50)),
                ('captured_at', models.DateTimeField(auto_now_add=True)),
                ('proveedor', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='snapshots', to='app.proveedor')),
            ],
        ),
    ]

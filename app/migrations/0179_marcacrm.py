"""
MarcaCRM — Catálogo de marcas/productos del distribuidor con metadata
rica (logo, descripción, 3 contactos, meta anual, estrategia).

La `key` mapea a TodoItem.producto (PRODUCTO_CHOICES) y es el
identificador estable en URLs y front. Soft-delete vía `activa=False`
para preservar referencias históricas.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0178_materialesperado'),
    ]

    operations = [
        migrations.CreateModel(
            name='MarcaCRM',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=80, unique=True)),
                ('key', models.CharField(db_index=True, max_length=40, unique=True)),
                ('categoria', models.CharField(blank=True, default='', max_length=100)),
                ('descripcion', models.TextField(blank=True, default='')),
                ('logo', models.ImageField(blank=True, null=True, upload_to='marcas/logos/')),
                ('contacto_marca_nombre', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_marca_email', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_marca_telefono', models.CharField(blank=True, default='', max_length=40)),
                ('contacto_ingenieria_nombre', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_ingenieria_email', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_ingenieria_telefono', models.CharField(blank=True, default='', max_length=40)),
                ('contacto_mayorista_nombre', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_mayorista_email', models.CharField(blank=True, default='', max_length=120)),
                ('contacto_mayorista_telefono', models.CharField(blank=True, default='', max_length=40)),
                ('meta_anual', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('estrategia', models.TextField(blank=True, default='')),
                ('activa', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Marca CRM',
                'verbose_name_plural': 'Marcas CRM',
                'ordering': ['nombre'],
            },
        ),
    ]

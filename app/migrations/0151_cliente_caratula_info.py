"""Carátula del cliente (tab "Información" del widget):
campos libres para logo, ubicación, días de entrega, horarios, facturación,
proceso de cobro, reglas de acceso y notas generales.
"""
from django.db import migrations, models

import app.models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0150_curso_comentarios_y_calendario'),
    ]

    operations = [
        migrations.AddField(
            model_name='cliente',
            name='logo',
            field=models.ImageField(blank=True, null=True, upload_to=app.models.Cliente._cliente_logo_path, verbose_name='Logo'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='ubicacion',
            field=models.TextField(blank=True, default='', verbose_name='Ubicación / Dirección completa'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='mapa_url',
            field=models.URLField(blank=True, default='', max_length=500, verbose_name='Link a Google Maps'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='dias_entrega',
            field=models.TextField(blank=True, default='', verbose_name='Días de entrega'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='horarios_trabajo',
            field=models.TextField(blank=True, default='', verbose_name='Horarios de trabajo'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='dias_facturacion',
            field=models.TextField(blank=True, default='', verbose_name='Días de facturación'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='proceso_cobro',
            field=models.TextField(blank=True, default='', verbose_name='Proceso de cobro'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='reglas_acceso',
            field=models.TextField(blank=True, default='', verbose_name='Reglas para acceder a la planta'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='info_adicional',
            field=models.TextField(blank=True, default='', verbose_name='Información adicional'),
        ),
    ]

"""Campos directos email/telefono/puesto en Contacto (para mostrar y editar
desde el tab Información del cliente).
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0152_avance_etapa_pendiente'),
    ]

    operations = [
        migrations.AddField(
            model_name='contacto',
            name='email',
            field=models.EmailField(blank=True, default='', max_length=254, verbose_name='Correo'),
        ),
        migrations.AddField(
            model_name='contacto',
            name='telefono',
            field=models.CharField(blank=True, default='', max_length=30, verbose_name='Teléfono'),
        ),
        migrations.AddField(
            model_name='contacto',
            name='puesto',
            field=models.CharField(blank=True, default='', max_length=120, verbose_name='Puesto / Cargo'),
        ),
    ]

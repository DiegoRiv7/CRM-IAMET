"""Agrega Certificacion.orden para el drag&drop de la vista pared."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0146_certificacion_certificacionarchivo'),
    ]

    operations = [
        migrations.AddField(
            model_name='certificacion',
            name='orden',
            field=models.IntegerField(
                blank=True, db_index=True, null=True,
                help_text='Posición manual en la vista pared (drag & drop).',
            ),
        ),
    ]

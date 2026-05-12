"""Agrega FK opcional MailCorreo.oportunidad — permite vincular correos
enviados/recibidos a una oportunidad de venta para mostrar la evidencia
del envío y de las respuestas dentro del chat de la oportunidad.
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0142_evento_cliente_prospecto_participantes'),
    ]

    operations = [
        migrations.AddField(
            model_name='mailcorreo',
            name='oportunidad',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='correos_vinculados',
                to='app.todoitem',
            ),
        ),
    ]

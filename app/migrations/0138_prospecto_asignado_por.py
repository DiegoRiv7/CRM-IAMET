"""Agrega `Prospecto.asignado_por` (supervisor/admin que asignó el
prospecto a otro vendedor) y amplia `ProspectoActividad.TIPO_CHOICES`
con visita, campana y reunion_virtual para soportar el flujo de
"asignar tarea inicial" desde Nuevo Prospecto.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0137_gantt_actividad_drawer'),
    ]

    operations = [
        migrations.AddField(
            model_name='prospecto',
            name='asignado_por',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='prospectos_asignados',
                to=settings.AUTH_USER_MODEL,
                help_text='Usuario (supervisor/admin) que asignó este prospecto al vendedor.',
            ),
        ),
        migrations.AlterField(
            model_name='prospectoactividad',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('visita', 'Visita'),
                    ('llamada', 'Llamada'),
                    ('correo', 'Correo'),
                    ('campana', 'Campaña'),
                    ('reunion', 'Reunión'),
                    ('reunion_virtual', 'Reunión virtual'),
                    ('tarea', 'Tarea'),
                    ('otro', 'Otro'),
                ],
                default='tarea', max_length=20,
            ),
        ),
    ]

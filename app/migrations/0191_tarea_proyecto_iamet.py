# Tarea.proyecto_iamet: FK nullable al modelo moderno ProyectoIAMET. Permite que
# las tareas creadas en el detalle de un proyecto sean Tareas completas (con su
# ventana: comentarios/participantes/completar), ligadas al proyecto IAMET.
# Aditivo y nullable → migración rápida, sin backfill.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0190_userprofile_puede_crear_prospecto'),
    ]

    operations = [
        migrations.AddField(
            model_name='tarea',
            name='proyecto_iamet',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='tareas_iamet',
                to='app.proyectoiamet',
                verbose_name='Proyecto IAMET',
            ),
        ),
    ]

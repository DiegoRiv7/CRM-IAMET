"""
Agrega 4 choices a TareaHistorial.tipo: comentario_add, subtarea_add,
subtarea_complete, subtarea_remove.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0174_tareahistorial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tareahistorial',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('titulo', 'Cambió el título'),
                    ('descripcion', 'Cambió la descripción'),
                    ('fecha_limite', 'Cambió la fecha límite'),
                    ('responsable', 'Cambió el responsable'),
                    ('prioridad', 'Cambió la prioridad'),
                    ('participante_add', 'Agregó un participante'),
                    ('participante_remove', 'Quitó un participante'),
                    ('observador_add', 'Agregó un observador'),
                    ('observador_remove', 'Quitó un observador'),
                    ('cerrada', 'Marcó la tarea como completada'),
                    ('reabierta', 'Reabrió la tarea'),
                    ('cliente', 'Cambió el cliente'),
                    ('oportunidad', 'Cambió la oportunidad'),
                    ('comentario_add', 'Agregó un comentario'),
                    ('subtarea_add', 'Agregó una subtarea'),
                    ('subtarea_complete', 'Completó una subtarea'),
                    ('subtarea_remove', 'Quitó una subtarea'),
                ],
                max_length=30,
            ),
        ),
    ]

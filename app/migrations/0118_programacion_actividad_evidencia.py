from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0117_userprofile_oportunidades_ancladas'),
    ]

    operations = [
        migrations.AddField(
            model_name='programacionactividad',
            name='descripcion',
            field=models.TextField(blank=True, default='', verbose_name='Descripción'),
        ),
        migrations.AddField(
            model_name='programacionactividad',
            name='vehiculos',
            field=models.CharField(blank=True, default='', max_length=255, verbose_name='Vehículos'),
        ),
        migrations.AddField(
            model_name='programacionactividad',
            name='completada',
            field=models.BooleanField(default=False, verbose_name='Completada'),
        ),
        migrations.AddField(
            model_name='programacionactividad',
            name='fecha_completada',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Fecha de completada'),
        ),
        migrations.AddField(
            model_name='programacionactividad',
            name='completada_por',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='actividades_programadas_completadas',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Completada por',
            ),
        ),
        migrations.AddField(
            model_name='programacionactividad',
            name='evidencia_texto',
            field=models.TextField(blank=True, default='', verbose_name='Evidencia escrita'),
        ),
        migrations.AddField(
            model_name='programacionactividad',
            name='actividad_calendario',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='programacion_actividades',
                to='app.actividad',
                verbose_name='Actividad de calendario vinculada',
            ),
        ),
        migrations.AlterField(
            model_name='proyectoevidencia',
            name='entidad_tipo',
            field=models.CharField(
                choices=[
                    ('gasto', 'Gasto Operativo'),
                    ('tarea', 'Tarea'),
                    ('orden_compra', 'Orden de Compra'),
                    ('partida', 'Partida'),
                    ('programacion_actividad', 'Actividad de Programa de Obra'),
                ],
                max_length=50,
            ),
        ),
    ]

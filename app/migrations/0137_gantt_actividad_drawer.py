"""Crea modelos GanttActividadComentario y GanttActividadArchivo
para el drawer de detalles y la vista fullscreen de actividad.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

import app.models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0136_gantt_descripcion_recursos'),
    ]

    operations = [
        migrations.CreateModel(
            name='GanttActividadComentario',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('texto', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actividad', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comentarios',
                    to='app.ganttactividad',
                )),
                ('autor', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='gantt_comentarios',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['created_at'],
                'verbose_name': 'Comentario Gantt',
                'verbose_name_plural': 'Comentarios Gantt',
            },
        ),
        migrations.CreateModel(
            name='GanttActividadArchivo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('archivo', models.FileField(upload_to=app.models._gantt_archivo_upload_path)),
                ('nombre', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actividad', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='archivos',
                    to='app.ganttactividad',
                )),
                ('autor', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='gantt_archivos',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
                'verbose_name': 'Archivo Gantt',
                'verbose_name_plural': 'Archivos Gantt',
            },
        ),
    ]

"""Modelos CursoComentario + CursoArchivo (hilo de comentarios con
adjuntos para cada curso) y FK opcional Actividad.curso (para agendar
sesiones de estudio al calendario desde el detalle del curso).
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

import app.models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0149_curso'),
    ]

    operations = [
        migrations.AddField(
            model_name='actividad',
            name='curso',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='actividades_calendario',
                to='app.curso',
                verbose_name='Curso Relacionado',
            ),
        ),
        migrations.CreateModel(
            name='CursoComentario',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('texto', models.TextField()),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('curso', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comentarios',
                    to='app.curso')),
                ('autor', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='curso_comentarios',
                    to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Comentario de curso',
                'verbose_name_plural': 'Comentarios de cursos',
                'ordering': ['fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='CursoArchivo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('archivo', models.FileField(upload_to=app.models._curso_archivo_upload_path)),
                ('nombre', models.CharField(blank=True, default='', max_length=255)),
                ('fecha_subida', models.DateTimeField(auto_now_add=True)),
                ('comentario', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='archivos',
                    to='app.cursocomentario')),
            ],
            options={
                'verbose_name': 'Archivo de comentario de curso',
                'verbose_name_plural': 'Archivos de comentarios de cursos',
                'ordering': ['fecha_subida'],
            },
        ),
    ]

"""Modelo Curso (Marketing → Cursos): fase previa a Certificación.
Cada curso lleva su progreso 0-100, estado, plataforma, y al
completarse puede vincular una Certificacion generada (FK opcional).
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0148_notificacion_certificacion'),
    ]

    operations = [
        migrations.CreateModel(
            name='Curso',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('marca', models.CharField(
                    help_text="Marca/familia del curso, e.g. 'PANDUIT', 'CISCO'.",
                    max_length=50)),
                ('nombre', models.CharField(
                    help_text='Ej. "Panduit Network Infrastructure Foundations".',
                    max_length=200, verbose_name='Nombre del curso')),
                ('plataforma', models.CharField(
                    blank=True, default='',
                    help_text='Dónde se imparte. Ej. Panduit Academy, Cisco Learning, Udemy.',
                    max_length=120)),
                ('url', models.URLField(
                    blank=True, default='', max_length=500,
                    help_text='Link a la plataforma donde se toma (opcional).',
                    verbose_name='URL del curso')),
                ('nivel', models.CharField(
                    blank=True, default='', max_length=20,
                    choices=[
                        ('basico', 'Básico'),
                        ('intermedio', 'Intermedio'),
                        ('avanzado', 'Avanzado'),
                        ('experto', 'Experto'),
                    ])),
                ('estado', models.CharField(
                    db_index=True, default='en_progreso', max_length=20,
                    choices=[
                        ('en_progreso', 'En progreso'),
                        ('completado', 'Completado'),
                        ('pausado', 'Pausado'),
                        ('abandonado', 'Abandonado'),
                    ])),
                ('progreso', models.IntegerField(
                    default=0, help_text='Porcentaje completado 0-100.')),
                ('fecha_inicio', models.DateField(blank=True, null=True)),
                ('fecha_compromiso', models.DateField(blank=True, null=True)),
                ('fecha_completado', models.DateField(blank=True, null=True)),
                ('notas', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('usuario', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='cursos',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Persona que toma el curso')),
                ('creado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='cursos_creados',
                    to=settings.AUTH_USER_MODEL)),
                ('certificacion_resultante', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='curso_origen',
                    to='app.certificacion',
                    verbose_name='Certificación generada')),
            ],
            options={
                'verbose_name': 'Curso',
                'verbose_name_plural': 'Cursos',
                'ordering': ['-fecha_actualizacion'],
            },
        ),
    ]

# Generated manually for Tarea models - compatible with server sequence

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0008_add_etapa_fields_to_todoitem'),
    ]

    operations = [
        migrations.CreateModel(
            name='Tarea',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('titulo', models.CharField(max_length=200, verbose_name='Título')),
                ('descripcion', models.TextField(blank=True, verbose_name='Descripción')),
                ('estado', models.CharField(choices=[('pendiente', 'Pendiente'), ('en_progreso', 'En Progreso'), ('completada', 'Completada'), ('cancelada', 'Cancelada')], default='pendiente', max_length=20, verbose_name='Estado')),
                ('prioridad', models.CharField(choices=[('baja', 'Baja'), ('media', 'Media'), ('alta', 'Alta')], default='media', max_length=10, verbose_name='Prioridad')),
                ('fecha_vencimiento', models.DateTimeField(blank=True, null=True, verbose_name='Fecha de Vencimiento')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Creación')),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True, verbose_name='Fecha de Actualización')),
                ('fecha_completada', models.DateTimeField(blank=True, null=True, verbose_name='Fecha de Completado')),
                ('tiempo_estimado', models.DurationField(blank=True, null=True, verbose_name='Tiempo Estimado')),
                ('tiempo_real', models.DurationField(blank=True, null=True, verbose_name='Tiempo Real')),
                ('asignado_a', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='tareas_asignadas', to=settings.AUTH_USER_MODEL, verbose_name='Asignado a')),
                ('creado_por', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tareas_creadas', to=settings.AUTH_USER_MODEL, verbose_name='Creado por')),
                ('observadores', models.ManyToManyField(blank=True, related_name='tareas_observando', to=settings.AUTH_USER_MODEL, verbose_name='Observadores')),
                ('participantes', models.ManyToManyField(blank=True, related_name='tareas_participando', to=settings.AUTH_USER_MODEL, verbose_name='Participantes')),
                ('proyecto', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tareas', to='app.proyecto', verbose_name='Proyecto')),
            ],
            options={
                'verbose_name': 'Tarea',
                'verbose_name_plural': 'Tareas',
                'ordering': ['-fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='TareaComentario',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('contenido', models.TextField(verbose_name='Contenido')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Creación')),
                ('fecha_edicion', models.DateTimeField(blank=True, null=True, verbose_name='Fecha de Edición')),
                ('editado', models.BooleanField(default=False, verbose_name='Editado')),
                ('tarea', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comentarios', to='app.tarea', verbose_name='Tarea')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL, verbose_name='Usuario')),
            ],
            options={
                'verbose_name': 'Comentario de Tarea',
                'verbose_name_plural': 'Comentarios de Tarea',
                'ordering': ['-fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='TareaArchivo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('archivo', models.FileField(upload_to='tareas/archivos/%Y/%m/', verbose_name='Archivo')),
                ('nombre_original', models.CharField(max_length=255, verbose_name='Nombre Original')),
                ('tamaño', models.PositiveIntegerField(verbose_name='Tamaño')),
                ('tipo_contenido', models.CharField(max_length=100, verbose_name='Tipo de Contenido')),
                ('fecha_subida', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Subida')),
                ('comentario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='archivos', to='app.tareacomentario', verbose_name='Comentario')),
                ('subido_por', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL, verbose_name='Subido por')),
            ],
            options={
                'verbose_name': 'Archivo de Tarea',
                'verbose_name_plural': 'Archivos de Tarea',
                'ordering': ['-fecha_subida'],
            },
        ),
    ]
# Generated migration for PostMuro and ComentarioMuro

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0059_notificacion_tarea_opp'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PostMuro',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('contenido', models.TextField(verbose_name='Contenido')),
                ('imagen', models.ImageField(blank=True, null=True, upload_to='muro/', verbose_name='Imagen')),
                ('es_anuncio', models.BooleanField(default=False, verbose_name='Es Anuncio')),
                ('programado_para', models.DateTimeField(blank=True, null=True, verbose_name='Programado Para')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Creación')),
                ('editado', models.BooleanField(default=False, verbose_name='Editado')),
                ('autor', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='posts_muro', to=settings.AUTH_USER_MODEL, verbose_name='Autor')),
                ('etiquetados', models.ManyToManyField(blank=True, related_name='etiquetados_muro', to=settings.AUTH_USER_MODEL, verbose_name='Usuarios Etiquetados')),
                ('likes', models.ManyToManyField(blank=True, related_name='likes_muro', to=settings.AUTH_USER_MODEL, verbose_name='Me gusta')),
            ],
            options={
                'verbose_name': 'Post del Muro',
                'verbose_name_plural': 'Posts del Muro',
                'ordering': ['-fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='ComentarioMuro',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('contenido', models.TextField(verbose_name='Contenido')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Creación')),
                ('editado', models.BooleanField(default=False, verbose_name='Editado')),
                ('autor', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comentarios_muro', to=settings.AUTH_USER_MODEL, verbose_name='Autor')),
                ('post', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comentarios', to='app.postmuro', verbose_name='Post')),
            ],
            options={
                'verbose_name': 'Comentario del Muro',
                'verbose_name_plural': 'Comentarios del Muro',
                'ordering': ['fecha_creacion'],
            },
        ),
        migrations.AlterField(
            model_name='notificacion',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('mencion', 'Mención en comentario'),
                    ('respuesta', 'Respuesta a comentario'),
                    ('comentario_oportunidad', 'Nuevo comentario en oportunidad'),
                    ('proyecto_agregado', 'Agregado a proyecto'),
                    ('tarea_participante', 'Agregado como participante a tarea'),
                    ('tarea_observador', 'Agregado como observador a tarea'),
                    ('sistema', 'Notificación del sistema'),
                    ('tarea_opp_asignada', 'Tarea de oportunidad asignada'),
                    ('tarea_opp_comentario', 'Comentario en tarea de oportunidad'),
                    ('oportunidad_mensaje', 'Nuevo mensaje en oportunidad'),
                    ('muro_mencion', 'Mención en el muro'),
                    ('muro_post', 'Nuevo anuncio en el muro'),
                ],
                max_length=25,
                verbose_name='Tipo de Notificación',
            ),
        ),
    ]

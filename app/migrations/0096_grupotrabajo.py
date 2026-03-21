from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0095_merge_20260320_1630'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='GrupoTrabajo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=100, verbose_name='Nombre del grupo')),
                ('descripcion', models.CharField(blank=True, default='', max_length=255, verbose_name='Descripción')),
                ('color', models.CharField(default='#007AFF', max_length=7, verbose_name='Color del grupo (hex)')),
                ('activo', models.BooleanField(default=True, verbose_name='Activo')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('supervisor_grupo', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='grupos_supervisados',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Supervisor del grupo',
                )),
                ('miembros', models.ManyToManyField(
                    blank=True,
                    related_name='grupos_trabajo',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Miembros del grupo',
                )),
            ],
            options={
                'verbose_name': 'Grupo de Trabajo',
                'verbose_name_plural': 'Grupos de Trabajo',
                'ordering': ['nombre'],
            },
        ),
    ]

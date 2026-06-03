"""
Historial / versionado de Tarea (proyectos). Mismo patrón que
TareaOportunidadHistorial (mig 0173) pero para el modelo Tarea.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0173_tareaoportunidadhistorial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='TareaHistorial',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha', models.DateTimeField(auto_now_add=True)),
                ('tipo', models.CharField(
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
                    ],
                    max_length=30,
                )),
                ('valor_anterior', models.TextField(blank=True, default='')),
                ('valor_nuevo', models.TextField(blank=True, default='')),
                ('motivo', models.TextField(blank=True, default='')),
                ('extra', models.JSONField(blank=True, null=True)),
                ('autor', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='historial_tareas',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('tarea', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='historial',
                    to='app.tarea',
                )),
            ],
            options={
                'verbose_name': 'Versión de tarea (proyecto)',
                'verbose_name_plural': 'Versiones de tareas (proyectos)',
                'ordering': ['-fecha'],
                'indexes': [
                    models.Index(fields=['tarea', '-fecha'], name='app_tarea_tarea_fecha_idx'),
                ],
            },
        ),
    ]

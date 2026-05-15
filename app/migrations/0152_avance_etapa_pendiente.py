"""Modelo AvanceEtapaPendiente.

Cuando una tarea de automatización con `avanzar_etapa_al_completar=True` se
completa Y la siguiente etapa tiene reglas que crearán tareas, NO avanzamos
la oportunidad inmediatamente. Dejamos un AvanceEtapaPendiente abierto para
que el responsable de la oportunidad describa las nuevas tareas vía un modal
bloqueante en el frontend.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0151_cliente_caratula_info'),
    ]

    operations = [
        migrations.CreateModel(
            name='AvanceEtapaPendiente',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('etapa_actual', models.CharField(blank=True, default='', max_length=100)),
                ('etapa_siguiente', models.CharField(blank=True, default='', max_length=100)),
                ('estado', models.CharField(
                    choices=[
                        ('pendiente', 'Pendiente'),
                        ('confirmado', 'Confirmado'),
                        ('descartado', 'Descartado'),
                    ],
                    default='pendiente',
                    max_length=12,
                )),
                ('descripciones_json', models.JSONField(blank=True, default=dict, null=True)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_confirmacion', models.DateTimeField(blank=True, null=True)),
                ('confirmado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='avances_etapa_confirmados',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('oportunidad', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='avances_etapa_pendientes',
                    to='app.todoitem',
                    verbose_name='Oportunidad',
                )),
                ('responsable', models.ForeignKey(
                    help_text='Normalmente el dueño de la oportunidad',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='avances_etapa_pendientes',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Usuario que debe describir las próximas tareas',
                )),
                ('tarea', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='avances_pendientes',
                    to='app.tarea',
                    verbose_name='Tarea completada que dispara el avance',
                )),
            ],
            options={
                'verbose_name': 'Avance de Etapa Pendiente',
                'verbose_name_plural': 'Avances de Etapa Pendientes',
                'ordering': ['fecha_creacion'],
            },
        ),
        migrations.AddIndex(
            model_name='avanceetapapendiente',
            index=models.Index(fields=['responsable', 'estado'], name='app_avancee_respons_idx'),
        ),
        migrations.AddIndex(
            model_name='avanceetapapendiente',
            index=models.Index(fields=['oportunidad', 'estado'], name='app_avancee_oportun_idx'),
        ),
    ]

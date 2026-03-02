# Generated manually for Actividad model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0034_catalogocableado_marca_oportunidadestado_and_more'),
    ]

    operations = [
        # Migration 0034 already creates app_actividad (without tipo_actividad) and
        # app_actividad_participantes (as an auto-generated M2M through table).
        # On fresh databases all three DB operations below would conflict.
        # Solution: skip DB-level creates, only add the missing tipo_actividad column.
        # The state_operations bring Django's internal model state up to date.
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    "ALTER TABLE `app_actividad` ADD COLUMN IF NOT EXISTS "
                    "`tipo_actividad` varchar(20) NOT NULL DEFAULT 'otro';",
                    reverse_sql=(
                        "ALTER TABLE `app_actividad` "
                        "DROP COLUMN IF EXISTS `tipo_actividad`;"
                    ),
                ),
                # app_actividad_participantes already exists (auto-through from 0034).
                # app_actividad already exists (created in 0034).
                # participantes M2M through table already exists — no extra SQL needed.
            ],
            state_operations=[
                migrations.CreateModel(
                    name='Actividad',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('titulo', models.CharField(max_length=200, verbose_name='Título de la Actividad')),
                        ('tipo_actividad', models.CharField(
                            choices=[
                                ('llamada', 'Llamada'),
                                ('reunion', 'Reunión'),
                                ('tarea', 'Tarea'),
                                ('email', 'Email'),
                                ('otro', 'Otro'),
                            ],
                            default='otro',
                            max_length=20,
                            verbose_name='Tipo de Actividad',
                        )),
                        ('descripcion', models.TextField(blank=True, null=True, verbose_name='Descripción')),
                        ('fecha_inicio', models.DateTimeField(verbose_name='Fecha y Hora de Inicio')),
                        ('fecha_fin', models.DateTimeField(verbose_name='Fecha y Hora de Fin')),
                        ('color', models.CharField(
                            choices=[
                                ('#007AFF', 'Azul'),
                                ('#34C759', 'Verde'),
                                ('#FF9500', 'Naranja'),
                                ('#FF3B30', 'Rojo'),
                                ('#AF52DE', 'Morado'),
                                ('#5856D6', 'Índigo'),
                                ('#FF2D55', 'Rosa'),
                            ],
                            default='#007AFF',
                            max_length=7,
                            verbose_name='Color del Evento',
                        )),
                        ('creado_por', models.ForeignKey(
                            on_delete=django.db.models.deletion.CASCADE,
                            related_name='actividades_creadas',
                            to=settings.AUTH_USER_MODEL,
                            verbose_name='Creado por',
                        )),
                        ('oportunidad', models.ForeignKey(
                            blank=True,
                            null=True,
                            on_delete=django.db.models.deletion.SET_NULL,
                            related_name='actividades_calendario',
                            to='app.todoitem',
                            verbose_name='Oportunidad Relacionada',
                        )),
                    ],
                    options={
                        'verbose_name': 'Actividad del Calendario',
                        'verbose_name_plural': 'Actividades del Calendario',
                        'ordering': ['fecha_inicio'],
                    },
                ),
                migrations.CreateModel(
                    name='Actividad_participantes',
                    fields=[
                        ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('actividad', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='app.actividad')),
                        ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                    ],
                ),
                migrations.AddField(
                    model_name='actividad',
                    name='participantes',
                    field=models.ManyToManyField(
                        blank=True,
                        related_name='actividades_participando',
                        to=settings.AUTH_USER_MODEL,
                        verbose_name='Participantes',
                    ),
                ),
            ],
        ),
    ]

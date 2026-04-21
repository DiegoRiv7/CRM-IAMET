from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0124_mensajegrupoarchivo'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ProyectoLevantamiento',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=255, verbose_name='Nombre del Levantamiento')),
                ('status', models.CharField(
                    choices=[
                        ('borrador', 'Borrador'),
                        ('revision', 'En Revisión'),
                        ('aprobado', 'Aprobado'),
                        ('rechazado', 'Rechazado'),
                        ('ejecutando', 'Ejecutando'),
                        ('completado', 'Completado'),
                    ],
                    default='borrador',
                    max_length=20,
                )),
                ('fase_actual', models.IntegerField(default=1)),
                ('fase1_data', models.JSONField(blank=True, default=dict, verbose_name='Fase 1 — Levantamiento')),
                ('fase2_data', models.JSONField(blank=True, default=dict, verbose_name='Fase 2 — Propuesta Técnica')),
                ('fase3_data', models.JSONField(blank=True, default=dict, verbose_name='Fase 3 — Volumetría')),
                ('fase4_data', models.JSONField(blank=True, default=dict, verbose_name='Fase 4 — Programa de Obra')),
                ('fase5_data', models.JSONField(blank=True, default=dict, verbose_name='Fase 5 — Reportes')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('creado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='levantamientos_creados',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('proyecto', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='levantamientos',
                    to='app.proyectoiamet',
                    verbose_name='Proyecto',
                )),
            ],
            options={
                'verbose_name': 'Levantamiento de Proyecto',
                'verbose_name_plural': 'Levantamientos de Proyecto',
                'ordering': ['-fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='LevantamientoEvidencia',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('archivo', models.ImageField(upload_to='levantamientos/%Y/%m/', verbose_name='Foto')),
                ('nombre_original', models.CharField(blank=True, default='', max_length=255)),
                ('comentario', models.CharField(blank=True, default='', max_length=255)),
                ('producto_idx', models.IntegerField(
                    blank=True, null=True,
                    help_text='Índice de la partida/producto al que pertenece la evidencia, si aplica',
                )),
                ('fecha_subida', models.DateTimeField(auto_now_add=True)),
                ('levantamiento', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='evidencias',
                    to='app.proyectolevantamiento',
                )),
                ('subido_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='evidencias_levantamiento',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Evidencia Fotográfica',
                'verbose_name_plural': 'Evidencias Fotográficas',
                'ordering': ['fecha_subida'],
            },
        ),
    ]

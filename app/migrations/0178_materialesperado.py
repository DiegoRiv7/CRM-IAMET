"""
MaterialEsperado — modelo para la sección "Control" del dashboard.

Representa un producto/material que se está esperando para un
ProyectoIAMET. Cada material se renderiza como una barra en el timeline
de Control con su ventana de fechas (inicio/fin) y estado actual del
flujo de compra (pendiente, en tránsito, listo, esperando cliente,
recibido). Permite registrar comentarios libres en `comentarios`
(TextField) y confirmación explícita de recepción por parte de un
usuario (auditoría básica).
"""
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0177_proyectopartida_indexes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='MaterialEsperado',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('titulo', models.CharField(max_length=200)),
                ('fecha_inicio', models.DateField()),
                ('fecha_fin', models.DateField()),
                ('estado', models.CharField(
                    choices=[
                        ('pendiente_compra', 'Pendiente de compra'),
                        ('en_transito', 'En tránsito'),
                        ('material_listo', 'Material listo'),
                        ('en_espera_cliente', 'En espera del cliente'),
                        ('recibido', 'Recibido'),
                    ],
                    default='pendiente_compra',
                    max_length=30,
                )),
                ('confirmado_recepcion', models.BooleanField(default=False)),
                ('fecha_confirmacion', models.DateTimeField(blank=True, null=True)),
                ('comentarios', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('confirmado_por', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='materiales_confirmados',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('creado_por', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=models.deletion.SET_NULL,
                    related_name='materiales_creados',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('proyecto', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='materiales_esperados',
                    to='app.proyectoiamet',
                )),
            ],
            options={
                'verbose_name': 'Material esperado',
                'verbose_name_plural': 'Materiales esperados',
                'ordering': ['fecha_inicio'],
            },
        ),
        migrations.AddIndex(
            model_name='materialesperado',
            index=models.Index(fields=['proyecto', 'fecha_inicio'], name='app_materia_proyect_b3e511_idx'),
        ),
        migrations.AddIndex(
            model_name='materialesperado',
            index=models.Index(fields=['estado'], name='app_materia_estado_9c4dac_idx'),
        ),
    ]

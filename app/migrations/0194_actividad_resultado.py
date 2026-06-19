# Resultado de actividades genéricas del calendario:
#   - Actividad.resultado (texto libre) y Actividad.resultado_estatus (choices)
#     capturados al completar la actividad.
#   - Nuevo modelo ArchivoActividad para los adjuntos de ese resultado
#     (espejo simplificado de ArchivoOportunidad).
# Escrita a mano porque el shell de desarrollo no tiene Django importable —
# equivalente a lo que generaría `makemigrations app` tras los cambios en
# los modelos.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0193_instalacion_tentativa'),
    ]

    operations = [
        migrations.AddField(
            model_name='actividad',
            name='resultado',
            field=models.TextField(blank=True, default='', verbose_name='Resultado de la actividad'),
        ),
        migrations.AddField(
            model_name='actividad',
            name='resultado_estatus',
            field=models.CharField(
                blank=True,
                choices=[
                    ('exitosa', 'Exitosa'),
                    ('sin_exito', 'Sin éxito'),
                    ('seguimiento', 'Requiere seguimiento'),
                    ('reagendar', 'Reagendar'),
                    ('cancelada', 'Cancelada'),
                ],
                default='',
                max_length=30,
                verbose_name='Estatus del resultado',
            ),
        ),
        migrations.CreateModel(
            name='ArchivoActividad',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre_original', models.CharField(max_length=255)),
                ('archivo', models.FileField(blank=True, upload_to='actividades/resultado/%Y/%m/')),
                ('tipo_archivo', models.CharField(default='otro', max_length=20)),
                ('extension', models.CharField(blank=True, max_length=10)),
                ('tamaño', models.BigIntegerField(default=0)),
                ('mime_type', models.CharField(blank=True, max_length=100)),
                ('fecha_subida', models.DateTimeField(auto_now_add=True)),
                ('actividad', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='resultado_archivos', to='app.actividad')),
                ('subido_por', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-fecha_subida'],
            },
        ),
    ]

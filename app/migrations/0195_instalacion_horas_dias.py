# Instalacion: horarios y días personalizados para el Programa de Obra.
#   - hora_inicio / hora_fin: ubican la instalación a la hora correcta en el
#     calendario (antes se asumía 08:00–17:00).
#   - dias_personalizados: lista de fechas ISO cuando las jornadas NO son
#     consecutivas (modo "Elegir días"); None = consecutivas auto.
# Escrita a mano porque el shell de desarrollo no tiene Django importable —
# equivalente a lo que generaría `makemigrations app` tras los cambios en
# el modelo.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0194_actividad_resultado'),
    ]

    operations = [
        migrations.AddField(
            model_name='instalacion',
            name='hora_inicio',
            field=models.TimeField(blank=True, null=True, verbose_name='Hora de inicio'),
        ),
        migrations.AddField(
            model_name='instalacion',
            name='hora_fin',
            field=models.TimeField(blank=True, null=True, verbose_name='Hora de fin'),
        ),
        migrations.AddField(
            model_name='instalacion',
            name='dias_personalizados',
            field=models.JSONField(
                blank=True,
                default=None,
                help_text='Lista de fechas ISO si las jornadas NO son consecutivas; None = consecutivas auto.',
                null=True,
                verbose_name='Días personalizados (ISO)',
            ),
        ),
    ]

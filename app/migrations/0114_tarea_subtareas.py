import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0113_reglaautomatizacion_incluir_dueno'),
    ]

    operations = [
        migrations.AddField(
            model_name='tarea',
            name='tarea_padre',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='subtareas',
                to='app.tarea',
                verbose_name='Tarea padre',
            ),
        ),
    ]

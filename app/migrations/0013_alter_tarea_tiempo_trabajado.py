# Generated manually to fix tiempo_trabajado field

from django.db import migrations, models
from datetime import timedelta


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0012_tarea_tiempo_trabajado'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tarea',
            name='tiempo_trabajado',
            field=models.DurationField(default=timedelta(0), verbose_name='Tiempo Trabajado'),
        ),
    ]
# Generated manually to add tiempo_trabajado field to Tarea

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0011_tarea_pausado'),
    ]

    operations = [
        migrations.AddField(
            model_name='tarea',
            name='tiempo_trabajado',
            field=models.DurationField(blank=True, null=True, verbose_name='Tiempo Trabajado'),
        ),
    ]
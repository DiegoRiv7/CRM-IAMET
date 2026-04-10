from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0121_sync_completada_programacion_actividad'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='tareas_ancladas',
            field=models.JSONField(blank=True, default=list, verbose_name='IDs de tareas ancladas'),
        ),
    ]

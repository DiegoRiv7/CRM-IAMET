from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0071_userprofile_theme'),
    ]

    operations = [
        migrations.AddField(
            model_name='proyecto',
            name='bitrix_group_id',
            field=models.IntegerField(blank=True, null=True, unique=True, verbose_name='ID del Grupo en Bitrix24'),
        ),
        migrations.AddField(
            model_name='tarea',
            name='bitrix_task_id',
            field=models.IntegerField(blank=True, null=True, unique=True, verbose_name='ID de Tarea en Bitrix24'),
        ),
    ]

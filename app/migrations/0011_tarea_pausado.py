# Generated manually to add pausado field to Tarea

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0010_alter_tareaarchivo_options_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='tarea',
            name='pausado',
            field=models.BooleanField(default=False, verbose_name='Pausado'),
        ),
    ]
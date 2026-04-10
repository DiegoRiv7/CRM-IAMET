from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0114_tarea_subtareas'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='reglaautomatizacion',
            name='incluir_dueno_observador',
        ),
        migrations.RemoveField(
            model_name='reglaautomatizacion',
            name='incluir_dueno_participante',
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0111_novedadesconfig_em_activation_count_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='reglaautomatizacion',
            name='incluir_dueno_participante',
            field=models.BooleanField(default=False, verbose_name='Incluir dueño como participante'),
        ),
        migrations.AddField(
            model_name='reglaautomatizacion',
            name='incluir_dueno_observador',
            field=models.BooleanField(default=False, verbose_name='Incluir dueño como observador'),
        ),
    ]

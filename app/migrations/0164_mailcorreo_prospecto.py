from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0163_oportunidad_asistente_mensaje'),
    ]

    operations = [
        migrations.AddField(
            model_name='mailcorreo',
            name='prospecto',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='correos_vinculados',
                to='app.prospecto',
            ),
        ),
    ]

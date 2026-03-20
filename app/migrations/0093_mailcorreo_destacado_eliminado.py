from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0092_add_completada_to_actividad'),
    ]

    operations = [
        migrations.AddField(
            model_name='mailcorreo',
            name='destacado',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='mailcorreo',
            name='eliminado',
            field=models.BooleanField(default=False),
        ),
    ]

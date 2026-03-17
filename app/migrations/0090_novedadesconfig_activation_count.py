from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0089_novedadesconfig'),
    ]

    operations = [
        migrations.AddField(
            model_name='novedadesconfig',
            name='activation_count',
            field=models.IntegerField(default=0),
        ),
    ]

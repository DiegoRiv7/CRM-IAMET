from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0165_todoitem_prospecto_origen_directo'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='puede_levantamiento',
            field=models.BooleanField(default=False, verbose_name='Puede iniciar Levantamientos'),
        ),
    ]

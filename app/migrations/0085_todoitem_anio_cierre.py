from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0084_proyectooportunidadlink'),
    ]

    operations = [
        migrations.AddField(
            model_name='todoitem',
            name='anio_cierre',
            field=models.IntegerField(default=2025, verbose_name='Año de Cierre'),
        ),
    ]

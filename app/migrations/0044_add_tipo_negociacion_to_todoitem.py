# Generated manually for adding tipo_negociacion field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0043_reset_migrations'),
    ]

    operations = [
        migrations.AddField(
            model_name='todoitem',
            name='tipo_negociacion',
            field=models.CharField(
                choices=[('runrate', 'Runrate'), ('proyecto', 'Proyecto')],
                default='runrate',
                max_length=20,
                verbose_name='Tipo de Negociación'
            ),
        ),
    ]
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0144_evento_demo_direccion'),
    ]

    operations = [
        migrations.AddField(
            model_name='evento',
            name='cliente_potencial',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='eventos_principales',
                to='app.clientepotencial',
                verbose_name='Cliente potencial principal del evento',
            ),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0196_factura_ingreso_moneda'),
    ]

    operations = [
        migrations.AddField(
            model_name='proyectoordencompra',
            name='moneda',
            field=models.CharField(
                choices=[('MXN', 'Pesos (MXN)'), ('USD', 'Dólares (USD)')],
                default='MXN', max_length=3,
                verbose_name='Moneda original del documento',
            ),
        ),
        migrations.AddField(
            model_name='proyectoordencompra',
            name='monto_original',
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=14, null=True,
                verbose_name='Monto en la moneda original',
            ),
        ),
        migrations.AddField(
            model_name='proyectoordencompra',
            name='tipo_cambio',
            field=models.DecimalField(
                blank=True, decimal_places=4, max_digits=10, null=True,
                verbose_name='Tipo de cambio aplicado (USD→MXN)',
            ),
        ),
    ]

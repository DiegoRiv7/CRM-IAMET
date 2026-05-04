from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):
    """Volumetría v2: agrega snapshot de IVA y tipo de cambio.

    Se guardan estos parámetros en la propia volumetría (no se
    calculan en runtime contra el sistema) para que cotizaciones
    viejas conserven el contexto fiscal/cambiario con el que fueron
    armadas.

    Defaults: IVA 8% (frontera Tijuana, default del negocio) y
    tipo de cambio 19.5000 USD→MXN. Se sobreescriben desde el
    wizard cuando el usuario los ajusta.
    """

    dependencies = [
        ('app', '0132_proyecto_volumetria'),
    ]

    operations = [
        migrations.AddField(
            model_name='proyectovolumetria',
            name='iva_pct',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('8.00'),
                help_text='IVA aplicable (%). Tijuana frontera = 8, resto = 16',
                max_digits=5,
            ),
        ),
        migrations.AddField(
            model_name='proyectovolumetria',
            name='tipo_cambio',
            field=models.DecimalField(
                decimal_places=4,
                default=Decimal('19.5000'),
                help_text='Tipo de cambio USD→MXN al momento de la volumetría',
                max_digits=10,
            ),
        ),
    ]

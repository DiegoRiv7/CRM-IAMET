from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0090_novedadesconfig_activation_count'),
    ]

    operations = [
        migrations.AddField(
            model_name='cliente',
            name='meta_cobrado',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14, verbose_name='Meta Cobrado'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='meta_cotizado',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14, verbose_name='Meta Cotizado'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='meta_oportunidades',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14, verbose_name='Meta Oportunidades'),
        ),
    ]

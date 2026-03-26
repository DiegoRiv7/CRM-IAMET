from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0102_add_proyecto_volumetria_version'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='meta_cotizado_numero',
            field=models.IntegerField(default=0, verbose_name='Meta Cotizado (Número)'),
        ),
        migrations.AddField(
            model_name='cliente',
            name='meta_cotizado_numero',
            field=models.IntegerField(default=0, verbose_name='Meta Cotizado (Número)'),
        ),
    ]

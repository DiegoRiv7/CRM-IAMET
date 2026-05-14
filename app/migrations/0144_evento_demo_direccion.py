from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0143_mailcorreo_oportunidad'),
    ]

    operations = [
        migrations.AddField(
            model_name='evento',
            name='demo_direccion',
            field=models.CharField(
                blank=True,
                choices=[('outbound', 'Para cliente'), ('inbound', 'De marca')],
                default='outbound',
                help_text='Sólo aplica a tipo=demo_sitio: outbound = vamos al cliente; inbound = la marca nos capacita.',
                max_length=10,
            ),
        ),
    ]

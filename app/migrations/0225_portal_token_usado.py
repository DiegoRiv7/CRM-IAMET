# MULTIEMPRESA — tokens de un solo uso del login desde el portal (views_portal_sso.py).
# Escrita a mano (makemigrations arrastra drift ajeno).
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0224_multiempresa_config_catalogos'),
    ]

    operations = [
        migrations.CreateModel(
            name='PortalTokenUsado',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nonce', models.CharField(max_length=32, unique=True)),
                ('creado', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name': 'Token del portal usado',
                'verbose_name_plural': 'Tokens del portal usados',
            },
        ),
    ]

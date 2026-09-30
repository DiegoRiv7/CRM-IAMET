# Archiva el tema estacional Verano: agrega el choice 'verano' (oculto del
# selector del perfil) para conservar su piel intacta — misma idea que
# 'mundial' en la migración 0200.
#
# NO migra usuarios: el slot estacional 'temporada' sigue mostrando la piel
# de Verano hasta que entre Otoño (Fase 3). 'verano' queda disponible para
# revivirlo el próximo año. Cambiar choices no toca la BD (Django no las
# aplica a nivel columna); esta migración solo mantiene el estado congruente.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0225_portal_token_usado'),
    ]

    operations = [
        migrations.AlterField(
            model_name='userprofile',
            name='theme',
            field=models.CharField(
                choices=[
                    ('temporada', 'Temporada'),
                    ('mundial', 'Mundial'),
                    ('verano', 'Verano'),
                    ('perla', 'Perla'),
                    ('sakura', 'Sakura'),
                    ('duna', 'Duna'),
                    ('espacial', 'Espacial'),
                ],
                default='temporada',
                max_length=20,
                verbose_name='Tema de color',
            ),
        ),
    ]

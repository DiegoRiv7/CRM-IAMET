# Tema "Temporada" (slot estacional, piel actual: Verano California Sunset).
# - Agrega el choice y lo vuelve el default del sistema (rol que tenía mundial).
# - Migra a los usuarios que tenían 'mundial' → 'temporada' (el mundial 2026
#   terminó; su tema queda oculto del selector pero el CSS/choice se conservan).

from django.db import migrations, models


def mundial_a_temporada(apps, schema_editor):
    UserProfile = apps.get_model('app', 'UserProfile')
    UserProfile.objects.filter(theme='mundial').update(theme='temporada')


def temporada_a_mundial(apps, schema_editor):
    UserProfile = apps.get_model('app', 'UserProfile')
    UserProfile.objects.filter(theme='temporada').update(theme='mundial')


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0199_catalogo_tipos_ampliados'),
    ]

    operations = [
        migrations.AlterField(
            model_name='userprofile',
            name='theme',
            field=models.CharField(
                choices=[
                    ('temporada', 'Temporada'),
                    ('mundial', 'Mundial'),
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
        migrations.RunPython(mundial_a_temporada, temporada_a_mundial),
    ]

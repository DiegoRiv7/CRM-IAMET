# Permiso granular: UserProfile.puede_crear_prospecto. Permite que usuarios
# no-supervisores creen prospectos (ClientePotencial) cuando un admin se lo
# habilita desde el panel admin → Permisos.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0189_notif_actividad_opp'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='puede_crear_prospecto',
            field=models.BooleanField(default=False, verbose_name='Puede crear Prospectos'),
        ),
    ]

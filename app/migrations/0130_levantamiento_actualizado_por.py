from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Agrega `actualizado_por` a ProyectoLevantamiento — quién hizo la
    última modificación. Distinto de `creado_por`."""

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0129_proyectoiamet_miembros'),
    ]

    operations = [
        migrations.AddField(
            model_name='proyectolevantamiento',
            name='actualizado_por',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='levantamientos_actualizados',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]

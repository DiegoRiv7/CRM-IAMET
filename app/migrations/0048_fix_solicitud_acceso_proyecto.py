from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0047_sistema_privacidad_final'),
    ]

    operations = [
        # Agregar las columnas faltantes
        migrations.AddField(
            model_name='solicitudaccesoproyecto',
            name='proyecto',
            field=models.ForeignKey(
                default=1,  # Temporal, será removido
                on_delete=django.db.models.deletion.CASCADE,
                related_name='solicitudes_acceso',
                to='app.proyecto',
                verbose_name='Proyecto'
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='solicitudaccesoproyecto',
            name='usuario_solicitante',
            field=models.ForeignKey(
                default=1,  # Temporal, será removido
                on_delete=django.db.models.deletion.CASCADE,
                related_name='solicitudes_proyecto',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Usuario Solicitante'
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='solicitudaccesoproyecto',
            name='usuario_respuesta',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='respuestas_proyecto',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Usuario que Respondió'
            ),
        ),
        # Agregar el constraint único
        migrations.AddConstraint(
            model_name='solicitudaccesoproyecto',
            constraint=models.UniqueConstraint(
                fields=('proyecto', 'usuario_solicitante'),
                name='app_solicitud_unique_proyecto_usuario'
            ),
        ),
    ]
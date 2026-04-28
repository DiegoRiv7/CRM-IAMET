from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """Agrega M2M `miembros` a ProyectoIAMET para permitir múltiples
    usuarios con acceso al proyecto desde el botón "+" del topbar."""

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0128_compras_module'),
    ]

    operations = [
        migrations.AddField(
            model_name='proyectoiamet',
            name='miembros',
            field=models.ManyToManyField(
                blank=True,
                help_text='Usuarios adicionales con acceso al proyecto (ingenieros, técnicos, etc).',
                related_name='proyectos_iamet_participando',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]

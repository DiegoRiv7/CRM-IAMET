# Generated manually — marca de activación del asistente por usuario (arranque limpio del 3-C).
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0212_actividad_correo_asistente_accion'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AsistenteEstado',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('activado_en', models.DateTimeField(auto_now_add=True)),
                ('usuario', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='asistente_estado', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]

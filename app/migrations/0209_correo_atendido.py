# Asistente · Correo: marca manual "correo listo" (informativos sin respuesta).

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0208_mensaje_fijado'),
    ]

    operations = [
        migrations.CreateModel(
            name='CorreoAtendido',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha', models.DateField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('mail', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.mailcorreo')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='correos_atendidos', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Correo marcado listo',
                'verbose_name_plural': 'Correos marcados listos',
            },
        ),
        migrations.AddIndex(
            model_name='correoatendido',
            index=models.Index(fields=['usuario', 'fecha'], name='app_coratend_usuario_fecha_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='correoatendido',
            unique_together={('usuario', 'mail')},
        ),
    ]

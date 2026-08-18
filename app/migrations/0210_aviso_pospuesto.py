# Generated manually — snooze "Mañana" del toast del asistente.
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0209_correo_atendido'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AvisoPospuesto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tipo', models.CharField(choices=[('correo', 'Correo'), ('oportunidad', 'Oportunidad')], max_length=12)),
                ('ref_id', models.IntegerField()),
                ('hasta', models.DateField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='avisos_pospuestos', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Aviso pospuesto',
                'verbose_name_plural': 'Avisos pospuestos',
            },
        ),
        migrations.AddIndex(
            model_name='avisopospuesto',
            index=models.Index(fields=['usuario', 'hasta'], name='app_avisopo_usuario_9f1c2a_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='avisopospuesto',
            unique_together={('usuario', 'tipo', 'ref_id')},
        ),
    ]

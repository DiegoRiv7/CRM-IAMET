# Generated manually — seguimientos ligados al correo original + bitácora "Atendido" del asistente.
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0211_correo_analisis'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='actividad',
            name='correo',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='actividades_seguimiento', to='app.mailcorreo', verbose_name='Correo Relacionado'),
        ),
        migrations.CreateModel(
            name='AsistenteAccion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('accion', models.CharField(choices=[('respondido', 'Respondido'), ('agendado', 'Seguimiento agendado'), ('oportunidad', 'Oportunidad creada'), ('actualizada', 'Oportunidad actualizada'), ('revisado', 'Revisado')], max_length=14)),
                ('titulo', models.CharField(max_length=200)),
                ('detalle', models.CharField(blank=True, default='', max_length=300)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('mail', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='app.mailcorreo')),
                ('oportunidad', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='app.todoitem')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='acciones_asistente', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Acción del asistente',
                'verbose_name_plural': 'Acciones del asistente',
            },
        ),
        migrations.AddIndex(
            model_name='asistenteaccion',
            index=models.Index(fields=['usuario', 'created_at'], name='app_asisacc_usuario_creado_idx'),
        ),
    ]

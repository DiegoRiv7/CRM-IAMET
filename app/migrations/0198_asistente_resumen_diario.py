from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0197_orden_compra_moneda'),
    ]

    operations = [
        migrations.CreateModel(
            name='AsistenteResumenDiario',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha', models.DateField()),
                ('seleccion', models.CharField(default='mias', max_length=20)),
                ('data', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='resumenes_diarios', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Resumen diario del asistente',
                'verbose_name_plural': 'Resúmenes diarios del asistente',
            },
        ),
        migrations.AddIndex(
            model_name='asistenteresumendiario',
            index=models.Index(fields=['usuario', 'fecha', 'seleccion'], name='app_asisres_usuario_f5a3_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='asistenteresumendiario',
            unique_together={('usuario', 'fecha', 'seleccion')},
        ),
    ]

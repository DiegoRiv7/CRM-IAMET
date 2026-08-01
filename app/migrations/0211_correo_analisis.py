# Generated manually — análisis persistente de correos del asistente (1 vez por correo).
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0210_aviso_pospuesto'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CorreoAnalisis',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('categoria', models.CharField(choices=[('venta', 'Posible venta nueva'), ('hito', 'Factura / orden / pago'), ('respuesta', 'Requiere respuesta'), ('info', 'Informativo'), ('ruido', 'Ruido')], max_length=12)),
                ('resumen', models.CharField(blank=True, default='', max_length=200)),
                ('requiere_respuesta', models.BooleanField(default=False)),
                ('confianza', models.FloatField(default=0.0)),
                ('fuente', models.CharField(default='reglas', max_length=8)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('correo', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='analisis', to='app.mailcorreo')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='correos_analizados', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Análisis de correo',
                'verbose_name_plural': 'Análisis de correos',
            },
        ),
        migrations.AddIndex(
            model_name='correoanalisis',
            index=models.Index(fields=['usuario', 'categoria'], name='app_correoa_usuario_c4e81b_idx'),
        ),
    ]

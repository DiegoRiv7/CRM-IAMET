# Telemetría del Modo Ligero: tabla PerfEvent poblada por perf_mode.js
# (cambios asentados de modo). Ver app/views_admin.py (api_perf_evento /
# api_admin_perf_stats) y el apartado "Rendimiento" del panel de admin.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0187_mundial_default_theme'),
    ]

    operations = [
        migrations.CreateModel(
            name='PerfEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('modo', models.CharField(choices=[('lite', 'Ligero'), ('full', 'Completo')], max_length=8)),
                ('motivo', models.CharField(choices=[('benchmark', 'Benchmark de carga'), ('dynamic', 'Jank sostenido'), ('probe_up', 'Carga liberada'), ('static', 'Señal del equipo'), ('manual_lite', 'Manual · ligero'), ('manual_full', 'Manual · completo'), ('manual_auto', 'Manual · automático')], max_length=16)),
                ('fps', models.FloatField(blank=True, null=True)),
                ('cores', models.IntegerField(blank=True, null=True)),
                ('device_memory', models.FloatField(blank=True, null=True)),
                ('pantalla', models.CharField(blank=True, default='', max_length=24)),
                ('user_agent', models.CharField(blank=True, default='', max_length=300)),
                ('ts', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('usuario', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='perf_eventos', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Evento de rendimiento',
                'verbose_name_plural': 'Eventos de rendimiento',
                'ordering': ['-ts'],
            },
        ),
    ]

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0201_pendiente_completada'),
    ]

    operations = [
        migrations.CreateModel(
            name='ReplayMensual',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('mes', models.PositiveSmallIntegerField()),
                ('anio', models.PositiveIntegerField()),
                ('data', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='replays_mensuales', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Replay mensual',
                'verbose_name_plural': 'Replays mensuales',
                'unique_together': {('usuario', 'mes', 'anio')},
            },
        ),
    ]

"""Agrega cliente, prospecto y participantes (M2M users) al modelo Evento."""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0141_evento_calendar_link'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='evento',
            name='cliente',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='eventos_principales',
                to='app.cliente',
                verbose_name='Cliente principal del evento',
            ),
        ),
        migrations.AddField(
            model_name='evento',
            name='prospecto',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='eventos_principales',
                to='app.prospecto',
                verbose_name='Prospecto principal del evento',
            ),
        ),
        migrations.AddField(
            model_name='evento',
            name='participantes',
            field=models.ManyToManyField(
                blank=True,
                related_name='eventos_participando',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Participantes internos',
            ),
        ),
    ]

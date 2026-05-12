"""Vincula Evento con el calendario (Actividad.evento) y con Prospección
(Prospecto.evento_origen) — Fase 2 del módulo Marketing → Eventos.
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0140_evento_eventoasistente'),
    ]

    operations = [
        migrations.AddField(
            model_name='actividad',
            name='evento',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='actividades_calendario',
                to='app.evento',
                verbose_name='Evento de Marketing Relacionado',
            ),
        ),
        migrations.AddField(
            model_name='prospecto',
            name='evento_origen',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='prospectos_generados',
                to='app.evento',
                help_text='Evento de marketing del que se generó este prospecto.',
            ),
        ),
    ]

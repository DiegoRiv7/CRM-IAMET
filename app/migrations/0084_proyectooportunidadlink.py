from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0083_rebuild_actividad_participantes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ProyectoOportunidadLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('score', models.FloatField(default=0.0, verbose_name='Score de similitud (0-100)')),
                ('confirmado', models.BooleanField(default=False, verbose_name='Vinculo confirmado')),
                ('rechazado', models.BooleanField(default=False, verbose_name='Sugerencia rechazada')),
                ('fecha_vinculo', models.DateTimeField(auto_now_add=True)),
                ('oportunidad', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='links_proyecto',
                    to='app.todoitem',
                )),
                ('proyecto', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='links_oportunidad',
                    to='app.proyecto',
                )),
                ('vinculado_por', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='links_confirmados',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Vinculo Proyecto-Oportunidad',
                'ordering': ['-score'],
                'unique_together': {('proyecto', 'oportunidad')},
            },
        ),
    ]

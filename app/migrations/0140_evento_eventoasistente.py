"""Crea modelos Evento y EventoAsistente para el módulo Marketing → Eventos.

Evento es una actividad organizada por un vendedor en conjunto con marcas
(Panduit, Zebra, etc.) para acercar soluciones a clientes/prospectos.
EventoAsistente registra a cada invitado (Cliente, Prospecto o contacto suelto).
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0139_notificacion_prospecto_asignado'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Evento',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=200, verbose_name='Nombre del evento')),
                ('tipo', models.CharField(choices=[
                    ('presencial', 'Presencial'),
                    ('webinar', 'Webinar'),
                    ('demo_sitio', 'Demo en sitio'),
                    ('breakfast', 'Breakfast Brief'),
                    ('techday', 'Techday'),
                ], default='presencial', max_length=20)),
                ('estado', models.CharField(choices=[
                    ('borrador', 'Borrador'),
                    ('programado', 'Programado'),
                    ('confirmado', 'Confirmado'),
                    ('realizado', 'Realizado'),
                    ('cancelado', 'Cancelado'),
                ], default='borrador', max_length=20)),
                ('fecha_evento', models.DateTimeField(verbose_name='Fecha y hora del evento')),
                ('duracion_minutos', models.IntegerField(default=60)),
                ('ubicacion', models.CharField(blank=True, default='', max_length=300)),
                ('descripcion', models.TextField(blank=True, default='')),
                ('marcas', models.JSONField(blank=True, default=list,
                                            help_text="Marcas participantes, e.g. ['PANDUIT','AVIGILON']")),
                ('costo', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('notas_post', models.TextField(blank=True, default='', verbose_name='Notas post-evento')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('organizador', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                   related_name='eventos_organizados',
                                                   to=settings.AUTH_USER_MODEL)),
                ('creado_por', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                                  related_name='eventos_creados',
                                                  to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Evento',
                'verbose_name_plural': 'Eventos',
                'ordering': ['-fecha_evento'],
            },
        ),
        migrations.CreateModel(
            name='EventoAsistente',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('contacto_nombre', models.CharField(blank=True, default='', max_length=200)),
                ('contacto_email', models.EmailField(blank=True, default='', max_length=254)),
                ('confirmado', models.BooleanField(default=False)),
                ('asistio', models.BooleanField(blank=True, null=True)),
                ('notas', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('cliente', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                               related_name='eventos_invitado', to='app.cliente')),
                ('evento', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                              related_name='asistentes', to='app.evento')),
                ('prospecto', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                                 related_name='eventos_invitado', to='app.prospecto')),
            ],
            options={
                'verbose_name': 'Asistente al evento',
                'verbose_name_plural': 'Asistentes al evento',
                'ordering': ['fecha_creacion'],
            },
        ),
    ]

# ----------------------------------------------------------------------
# 0156_idea — modelo Idea + IdeaComentario (sección Ideas del CRM).
# ----------------------------------------------------------------------
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0155_marca_marketing'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Idea',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('titulo', models.CharField(max_length=200)),
                ('descripcion', models.TextField(blank=True, default='')),
                ('tipo', models.CharField(
                    choices=[
                        ('producto', 'Producto'),
                        ('servicio', 'Servicio'),
                        ('proceso', 'Proceso / Mejora interna'),
                        ('mercado', 'Mercado / Cliente nuevo'),
                        ('alianza', 'Alianza / Partnership'),
                        ('otro', 'Otro'),
                    ],
                    default='producto',
                    max_length=20,
                )),
                ('potencial_comercial', models.CharField(
                    choices=[('alto', 'Alto'), ('medio', 'Medio'), ('bajo', 'Bajo')],
                    default='medio',
                    max_length=10,
                )),
                ('valor_estimado', models.DecimalField(
                    blank=True, decimal_places=2, max_digits=14, null=True,
                    help_text='Valor estimado en MXN si la idea se materializa.',
                )),
                ('mercado_objetivo', models.CharField(
                    blank=True, default='', max_length=200,
                    help_text='A quién va dirigida (sector, tipo de cliente, geografía).',
                )),
                ('inspiracion', models.TextField(
                    blank=True, default='',
                    help_text='De dónde salió la idea: conversación con cliente, evento, etc.',
                )),
                ('etiquetas', models.CharField(
                    blank=True, default='', max_length=300,
                    help_text='Etiquetas separadas por coma (innovación, urgente, etc).',
                )),
                ('etapa', models.CharField(
                    choices=[
                        ('capturada', 'Capturada'),
                        ('en_analisis', 'En Análisis'),
                        ('validada', 'Validada'),
                        ('en_seguimiento', 'En Seguimiento'),
                        ('convertida', 'Convertida'),
                        ('pausada', 'Pausada'),
                        ('descartada', 'Descartada'),
                    ],
                    db_index=True,
                    default='capturada',
                    max_length=20,
                )),
                ('orden', models.PositiveIntegerField(default=0, help_text='Orden dentro de la columna del kanban.')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('autor', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ideas',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('prospecto_creado', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='idea_origen',
                    to='app.prospecto',
                    help_text='Prospecto creado al convertir la idea.',
                )),
            ],
            options={
                'verbose_name': 'Idea',
                'verbose_name_plural': 'Ideas',
                'ordering': ['etapa', 'orden', '-fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='IdeaComentario',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('texto', models.TextField()),
                ('fecha', models.DateTimeField(auto_now_add=True)),
                ('idea', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comentarios',
                    to='app.idea',
                )),
                ('usuario', models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['fecha']},
        ),
    ]

from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion
from decimal import Decimal


class Migration(migrations.Migration):
    """Agrega los modelos GanttFase y GanttActividad para el
    modulo de Programa de Obra (diagrama de Gantt interactivo)."""

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0126_levantamiento_idempotency_key'),
    ]

    operations = [
        migrations.CreateModel(
            name='GanttFase',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=200)),
                ('orden', models.IntegerField(default=0)),
                ('collapsed', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('proyecto', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='gantt_fases',
                    to='app.proyectoiamet',
                )),
            ],
            options={
                'ordering': ['orden', 'nombre'],
                'verbose_name': 'Fase Gantt',
                'verbose_name_plural': 'Fases Gantt',
            },
        ),
        migrations.CreateModel(
            name='GanttActividad',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=200)),
                ('fecha_inicio', models.DateField()),
                ('duracion_dias', models.PositiveIntegerField(default=1)),
                ('progreso', models.IntegerField(
                    default=0,
                    validators=[
                        django.core.validators.MinValueValidator(0),
                        django.core.validators.MaxValueValidator(100),
                    ],
                )),
                ('costo_estimado', models.DecimalField(
                    decimal_places=2, default=Decimal('0'), max_digits=14,
                )),
                ('ingreso_estimado', models.DecimalField(
                    decimal_places=2, default=Decimal('0'), max_digits=14,
                )),
                ('orden', models.IntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('proyecto', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='gantt_actividades',
                    to='app.proyectoiamet',
                )),
                ('fase', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='actividades',
                    to='app.ganttfase',
                )),
                ('actividad_calendario', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='gantt_actividades',
                    to='app.actividad',
                )),
                ('dependencias', models.ManyToManyField(
                    blank=True,
                    related_name='dependientes',
                    to='app.ganttactividad',
                )),
                ('recursos', models.ManyToManyField(
                    blank=True,
                    related_name='gantt_actividades_asignadas',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['orden', 'fecha_inicio'],
                'verbose_name': 'Actividad Gantt',
                'verbose_name_plural': 'Actividades Gantt',
            },
        ),
    ]

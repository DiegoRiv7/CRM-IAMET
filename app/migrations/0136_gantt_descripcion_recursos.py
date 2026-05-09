from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Agrega:
    - Campo `descripcion` (TextField nullable) a GanttActividad.
    - Modelo RecursoMaterial.
    - M2M `recursos_materiales` en GanttActividad → RecursoMaterial.
    """

    dependencies = [
        ('app', '0135_clientepotencial'),
    ]

    operations = [
        migrations.CreateModel(
            name='RecursoMaterial',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=200)),
                ('descripcion', models.TextField(blank=True, default='')),
                ('tipo', models.CharField(
                    choices=[
                        ('equipo', 'Equipo'),
                        ('herramienta', 'Herramienta'),
                        ('material', 'Material'),
                        ('vehiculo', 'Vehículo'),
                        ('otro', 'Otro'),
                    ],
                    default='otro',
                    max_length=20,
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Recurso Material',
                'verbose_name_plural': 'Recursos Materiales',
                'ordering': ['nombre'],
            },
        ),
        migrations.AddField(
            model_name='ganttactividad',
            name='descripcion',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='ganttactividad',
            name='recursos_materiales',
            field=models.ManyToManyField(
                blank=True,
                related_name='gantt_actividades',
                to='app.recursomaterial',
            ),
        ),
    ]

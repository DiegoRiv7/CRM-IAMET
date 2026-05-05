from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """Nuevo modelo ClientePotencial (UI: "Prospectos").

    Un ClientePotencial representa una empresa que aún no es Cliente —
    solo lleva nombre + asignado_a (vendedor) + notas. Cuando se le
    crea una oportunidad o cotización, se promueve a Cliente y este
    registro se elimina (la conversión la maneja el endpoint de crear
    oportunidad/cotización dentro de transaction.atomic()).

    Coexiste con el modelo viejo `Prospecto` (actividad de prospección
    sobre un Cliente existente) sin renombrarlo.

    Adicionalmente agrega `Cliente.convertido_de_potencial_at` que se
    usa para alimentar el KPI "Prospectos convertidos este mes" del
    dashboard.
    """

    dependencies = [
        ('app', '0134_actividad_recurrence_group_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='cliente',
            name='convertido_de_potencial_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Convertido desde Prospecto'),
        ),
        migrations.CreateModel(
            name='ClientePotencial',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=200, verbose_name='Nombre del prospecto')),
                ('notas', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('asignado_a', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='clientes_potenciales',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Asignado a',
                )),
            ],
            options={
                'verbose_name': 'Cliente Potencial (Prospecto)',
                'verbose_name_plural': 'Clientes Potenciales (Prospectos)',
                'ordering': ['-fecha_actualizacion'],
            },
        ),
    ]

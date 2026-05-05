from django.db import migrations, models


class Migration(migrations.Migration):
    """Calendario: agrupador para actividades recurrentes.

    Cuando el usuario marca "Repetir esta actividad" en el formulario de
    Nueva Actividad, el backend crea N filas Actividad (una por cada
    fecha que cumpla el patrón). Todas las instancias de la serie
    comparten un mismo UUID en `recurrence_group_id`, lo que permite
    tratarlas como grupo (ej. borrar/editar todas juntas) sin romper la
    posibilidad de modificar instancias individuales.

    NULL = actividad creada de forma individual (sin recurrencia).
    """

    dependencies = [
        ('app', '0133_volumetria_iva_tc'),
    ]

    operations = [
        migrations.AddField(
            model_name='actividad',
            name='recurrence_group_id',
            field=models.UUIDField(
                blank=True,
                db_index=True,
                help_text='Identificador compartido por todas las instancias de una actividad recurrente.',
                null=True,
                verbose_name='ID de grupo de recurrencia',
            ),
        ),
    ]

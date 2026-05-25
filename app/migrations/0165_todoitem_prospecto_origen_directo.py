from django.db import migrations, models
import django.db.models.deletion


def backfill_prospecto_origen_directo(apps, schema_editor):
    """Para cada Prospecto que tiene oportunidad_creada, copiar esa
    referencia al nuevo FK directo en TodoItem. Así los dashboards que
    cuenten conversiones ya tienen el dato histórico.
    """
    Prospecto = apps.get_model('app', 'Prospecto')
    TodoItem = apps.get_model('app', 'TodoItem')
    for p in Prospecto.objects.exclude(oportunidad_creada__isnull=True):
        if p.oportunidad_creada_id:
            TodoItem.objects.filter(pk=p.oportunidad_creada_id).update(
                prospecto_origen_directo=p,
            )


def noop_reverse(apps, schema_editor):
    """No revertimos los datos backfileados — solo el campo se quita."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0164_mailcorreo_prospecto'),
    ]

    operations = [
        migrations.AddField(
            model_name='todoitem',
            name='prospecto_origen_directo',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='opps_generadas',
                to='app.prospecto',
                verbose_name='Prospecto de origen (directo)',
            ),
        ),
        migrations.RunPython(backfill_prospecto_origen_directo, noop_reverse),
    ]

"""
Data migration: sincroniza el estado completada de la Actividad del calendario
hacia la ProgramacionActividad vinculada. Necesario porque hasta antes del
reverse sync, una Actividad podia estar completada sin reflejarlo en su
ProgramacionActividad.
"""
from django.db import migrations
from django.utils import timezone


def forwards(apps, schema_editor):
    ProgramacionActividad = apps.get_model('app', 'ProgramacionActividad')

    qs = ProgramacionActividad.objects.filter(
        actividad_calendario__isnull=False,
        actividad_calendario__completada=True,
        completada=False,
    )

    updated = 0
    now = timezone.now()
    for prog in qs:
        prog.completada = True
        if not prog.fecha_completada:
            prog.fecha_completada = now
        prog.save(update_fields=['completada', 'fecha_completada'])
        updated += 1

    if updated:
        print(f"  -> {updated} ProgramacionActividad sincronizadas desde Actividad.completada")


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0120_actividad_titulo_usar_actividad'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

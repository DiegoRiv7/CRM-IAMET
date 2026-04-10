"""
Data migration: cambia el titulo de las Actividades de calendario vinculadas
a ProgramacionActividad para que usen el nombre de la actividad (no el del
proyecto).

La 0119 las habia puesto con el nombre del proyecto, pero distinguir
actividades del mismo proyecto es imposible asi. Mejor usar el nombre de
la actividad (el color cafe ya indica el contexto de proyecto).
"""
from django.db import migrations


def forwards(apps, schema_editor):
    ProgramacionActividad = apps.get_model('app', 'ProgramacionActividad')

    # Todas las ProgramacionActividad que tengan su Actividad de calendario vinculada
    qs = ProgramacionActividad.objects.filter(actividad_calendario__isnull=False)

    updated = 0
    for prog in qs:
        cal = prog.actividad_calendario
        if not cal:
            continue
        nuevo_titulo = prog.titulo or 'Actividad programada'
        if cal.titulo != nuevo_titulo:
            cal.titulo = nuevo_titulo
            cal.save(update_fields=['titulo'])
            updated += 1

    if updated:
        print(f"  -> {updated} actividades de calendario renombradas al titulo de la actividad")


def backwards(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0119_fix_actividades_programa_obra'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

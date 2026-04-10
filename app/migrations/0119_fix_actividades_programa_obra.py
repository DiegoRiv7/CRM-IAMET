"""
Data migration: actualiza Actividades existentes que pertenecen al
programa de obra de un proyecto.

- Cambia color rosa (#FF2D55) a café (#92400E)
- Limpia el titulo: quita emoji y prefijo "proy_X:"; deja el nombre del proyecto
- Vincula la Actividad con su ProgramacionActividad (FK actividad_calendario)
  cuando se pueda mapear por proyecto_key + fecha + horarios
- Añade marcador [programacion_actividad_id:Y] en la descripción para que
  el calendario pueda rutear "Ver Detalle" al widget de programa de obra
"""
import re
from django.db import migrations


OLD_COLOR = '#FF2D55'
NEW_COLOR = '#92400E'
TITLE_PREFIX_RE = re.compile(r'^📋\s*(proy_\d+)\s*:\s*(.+)$')
DESC_MARKER_RE = re.compile(r'\[programacion_actividad_id:\d+\]')


def forwards(apps, schema_editor):
    Actividad = apps.get_model('app', 'Actividad')
    ProgramacionActividad = apps.get_model('app', 'ProgramacionActividad')
    ProyectoIAMET = apps.get_model('app', 'ProyectoIAMET')

    # Pre-cachear nombres de proyectos
    proyectos_cache = {p.pk: p.nombre for p in ProyectoIAMET.objects.all()}

    # Buscar actividades que parezcan ser de programa de obra por titulo
    candidatas = Actividad.objects.filter(titulo__startswith='📋 proy_')

    updated = 0
    linked = 0

    for act in candidatas:
        m = TITLE_PREFIX_RE.match(act.titulo or '')
        if not m:
            continue
        proyecto_key = m.group(1)          # proy_X
        titulo_actividad = m.group(2).strip()  # "nombre de la actividad"

        try:
            proyecto_id = int(proyecto_key.replace('proy_', ''))
        except ValueError:
            continue

        nombre_proyecto = proyectos_cache.get(proyecto_id, proyecto_key)

        # Intentar encontrar la ProgramacionActividad correspondiente
        fecha_inicio = act.fecha_inicio
        prog_act = None
        if fecha_inicio:
            qs = ProgramacionActividad.objects.filter(
                proyecto_key=proyecto_key,
                titulo=titulo_actividad,
            )
            # Match exacto por fecha si existe
            matches = [
                p for p in qs
                if (p.fecha is None or p.fecha == fecha_inicio.date())
                and p.hora_inicio == fecha_inicio.time().replace(microsecond=0, second=0)
            ]
            if matches:
                prog_act = matches[0]
            elif qs.count() == 1:
                prog_act = qs.first()

        # Construir nueva descripción con marcador
        nueva_desc = act.descripcion or ''
        nueva_desc = DESC_MARKER_RE.sub('', nueva_desc).strip()
        if prog_act:
            marker = f' [programacion_actividad_id:{prog_act.id}]'
            nueva_desc = (nueva_desc + marker).strip()

        # Actualizar la Actividad
        act.titulo = nombre_proyecto
        act.color = NEW_COLOR
        act.descripcion = nueva_desc
        act.save(update_fields=['titulo', 'color', 'descripcion'])
        updated += 1

        # Vincular ProgramacionActividad -> Actividad calendario
        if prog_act and not prog_act.actividad_calendario_id:
            prog_act.actividad_calendario_id = act.id
            prog_act.save(update_fields=['actividad_calendario'])
            linked += 1

    if updated:
        print(f"  -> {updated} actividades actualizadas (rojo->café, titulo limpio)")
    if linked:
        print(f"  -> {linked} actividades vinculadas a su ProgramacionActividad")


def backwards(apps, schema_editor):
    # No revertible (no guardamos el estado original)
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0118_programacion_actividad_evidencia'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

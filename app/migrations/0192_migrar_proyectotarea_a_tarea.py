# Migra las ProyectoTarea (modelo simple) existentes a CRM Tarea ligadas vía
# proyecto_iamet, para que TODAS las tareas de proyecto tengan su ventana
# completa. Copia campos y elimina la ProyectoTarea (para no duplicarlas en el
# listado). creado_por = dueño del proyecto (ProyectoIAMET.usuario).

from django.db import migrations


def _migrar(apps, schema_editor):
    ProyectoTarea = apps.get_model('app', 'ProyectoTarea')
    Tarea = apps.get_model('app', 'Tarea')
    ST = {'pending': 'pendiente', 'in_progress': 'en_progreso',
          'completed': 'completada', 'cancelled': 'cancelada'}
    PR = {'low': 'baja', 'medium': 'media', 'high': 'alta', 'critical': 'alta'}

    for pt in ProyectoTarea.objects.select_related('proyecto', 'asignado_a').all():
        proy = pt.proyecto
        creador_id = getattr(proy, 'usuario_id', None)
        if not creador_id:
            # Sin dueño no podemos setear creado_por (requerido) → se deja la
            # ProyectoTarea tal cual (seguirá mostrándose como legacy).
            continue
        Tarea.objects.create(
            proyecto_iamet=proy,
            creado_por_id=creador_id,
            asignado_a=pt.asignado_a,
            titulo=pt.titulo or '',
            descripcion=pt.descripcion or '',
            estado=ST.get(pt.status, 'pendiente'),
            prioridad=PR.get(pt.prioridad, 'media'),
            fecha_limite=pt.fecha_limite,
            fecha_completada=pt.fecha_completada,
        )
        pt.delete()


def _reverse(apps, schema_editor):
    # No reversible (no rastreamos qué Tarea vino de qué ProyectoTarea).
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0191_tarea_proyecto_iamet'),
    ]

    operations = [
        migrations.RunPython(_migrar, _reverse),
    ]

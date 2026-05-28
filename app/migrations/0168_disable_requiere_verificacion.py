"""
Kill switch de la feature "Requiere verificación al avanzar" (2026-05-28).

- Pone `requiere_verificacion=False` en todas las reglas existentes.
- Marca como 'descartado' todos los AvanceEtapaPendiente que estaban
  abiertos para que el widget bloqueante no aparezca a NADIE más.

Las oportunidades cuyas tareas ya se completaron pero quedaron sin
avanzar (porque estaban esperando confirmación) NO se mueven aquí —
el admin las avanza manualmente desde el widget de la oportunidad si
lo necesita. La razón: ejecutar la cadena reactiva en una migración
implica importar lógica de views (no del schema) y eso es frágil entre
deploys. Como la feature se usó muy poco, el impacto es mínimo.

Después de esta migración el campo `requiere_verificacion` queda en el
modelo pero forzado a False desde el código (views_automatizacion +
views_proyectos), así no requerimos otra migración destructiva en
producción si más adelante se quiere borrar el campo.
"""
from django.db import migrations


def disable_verificacion(apps, schema_editor):
    Regla = apps.get_model('app', 'ReglaAutomatizacion')
    Pendiente = apps.get_model('app', 'AvanceEtapaPendiente')
    Regla.objects.filter(requiere_verificacion=True).update(requiere_verificacion=False)
    Pendiente.objects.filter(estado='pendiente').update(estado='descartado')


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0167_reglaautomatizacion_requiere_verificacion'),
    ]

    operations = [
        migrations.RunPython(disable_verificacion, noop_reverse),
    ]

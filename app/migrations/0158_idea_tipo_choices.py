# ----------------------------------------------------------------------
# 0158_idea_tipo_choices — actualiza las choices del campo Idea.tipo a
# las categorías reales: Territorial, Vertical, Marca, Cliente, etc.
# ----------------------------------------------------------------------
from django.db import migrations, models


def remap_tipos(apps, schema_editor):
    """Mapea cualquier valor previo (producto/servicio/...) a las nuevas
    categorías sin perder ideas existentes."""
    Idea = apps.get_model('app', 'Idea')
    mapeo = {
        'producto': 'marca',
        'servicio': 'tecnologia',
        'proceso': 'reactivacion',
        'mercado': 'territorial',
        'alianza': 'asociacion',
        'otro': 'tendencia',
    }
    for idea in Idea.objects.all():
        if idea.tipo in mapeo:
            idea.tipo = mapeo[idea.tipo]
            idea.save(update_fields=['tipo'])


def reverse_remap(apps, schema_editor):
    """Inverso no perfecto; volvemos al esquema antiguo lo mejor que se pueda."""
    Idea = apps.get_model('app', 'Idea')
    inverso = {
        'territorial': 'mercado',
        'vertical': 'mercado',
        'marca': 'producto',
        'cliente': 'mercado',
        'reactivacion': 'proceso',
        'tendencia': 'otro',
        'asociacion': 'alianza',
        'evento': 'otro',
        'tecnologia': 'servicio',
        'competencia': 'otro',
    }
    for idea in Idea.objects.all():
        if idea.tipo in inverso:
            idea.tipo = inverso[idea.tipo]
            idea.save(update_fields=['tipo'])


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0157_actividad_idea_fk'),
    ]

    operations = [
        migrations.AlterField(
            model_name='idea',
            name='tipo',
            field=models.CharField(
                choices=[
                    ('territorial', 'Territorial'),
                    ('vertical', 'Vertical'),
                    ('marca', 'Marca'),
                    ('cliente', 'Cliente'),
                    ('reactivacion', 'Reactivación'),
                    ('tendencia', 'Tendencia'),
                    ('asociacion', 'Asociación'),
                    ('evento', 'Evento'),
                    ('tecnologia', 'Tecnología'),
                    ('competencia', 'Competencia'),
                ],
                default='territorial',
                max_length=20,
            ),
        ),
        migrations.RunPython(remap_tipos, reverse_remap),
    ]

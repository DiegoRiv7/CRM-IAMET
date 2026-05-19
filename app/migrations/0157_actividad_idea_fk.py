# ----------------------------------------------------------------------
# 0157_actividad_idea_fk — FK opcional Actividad → Idea para ligar
# actividades del calendario a una idea.
# ----------------------------------------------------------------------
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0156_idea'),
    ]

    operations = [
        migrations.AddField(
            model_name='actividad',
            name='idea',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='actividades_calendario',
                to='app.idea',
                verbose_name='Idea Relacionada',
            ),
        ),
    ]

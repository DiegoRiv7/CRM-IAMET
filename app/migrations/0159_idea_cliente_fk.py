# ----------------------------------------------------------------------
# 0159_idea_cliente_fk — FK opcional Idea → Cliente para el picker de
# "mercado / cliente objetivo" del formulario.
# ----------------------------------------------------------------------
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0158_idea_tipo_choices'),
    ]

    operations = [
        migrations.AddField(
            model_name='idea',
            name='cliente',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='ideas',
                to='app.cliente',
            ),
        ),
    ]

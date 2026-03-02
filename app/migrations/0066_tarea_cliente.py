from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0065_tarea_oportunidad_link'),
    ]

    operations = [
        migrations.AddField(
            model_name='tarea',
            name='cliente',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='tareas',
                to='app.cliente',
                verbose_name='Cliente',
            ),
        ),
    ]

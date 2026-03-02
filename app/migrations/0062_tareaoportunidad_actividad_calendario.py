from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0061_productooportunidad'),
    ]

    operations = [
        migrations.AddField(
            model_name='tareaoportunidad',
            name='actividad_calendario',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='tarea_oportunidad_origen',
                to='app.actividad',
            ),
        ),
    ]

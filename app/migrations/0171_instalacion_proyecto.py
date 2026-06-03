"""
Agrega FK opcional Instalacion.proyecto → Proyecto.

Las instalaciones ahora viven lógicamente dentro de un Proyecto (sección
"Programa de Obra" del widget de proyecto). La FK a TodoItem se queda
como opcional. Sin migración de datos: las instalaciones que ya
existieran quedan con proyecto=NULL y se reasignan manualmente.
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0170_tecnico_instalacionasignacion'),
    ]

    operations = [
        migrations.AddField(
            model_name='instalacion',
            name='proyecto_crm',
            field=models.ForeignKey(
                blank=True,
                help_text='Proyecto al que pertenece (Programa de Obra).',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='instalaciones',
                to='app.proyecto',
            ),
        ),
        migrations.AlterField(
            model_name='instalacion',
            name='oportunidad',
            field=models.ForeignKey(
                blank=True,
                help_text='Opp ligada (opcional).',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='instalaciones',
                to='app.todoitem',
            ),
        ),
    ]

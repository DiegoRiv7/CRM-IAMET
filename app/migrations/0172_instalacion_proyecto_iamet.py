"""
Cambia Instalacion.proyecto_crm para apuntar a ProyectoIAMET (no a Proyecto).

El CRM moderno usa el modelo `ProyectoIAMET` (aliaseado como `Proyecto`
en `views_iamet.py`). El FK creado en 0171 apuntaba al modelo legacy
`Proyecto` y por eso `get_object_or_404` daba 404 en proyectos reales.

Sin migración de datos: 0171 quedó vacío en pruebas.
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0171_instalacion_proyecto'),
    ]

    operations = [
        migrations.AlterField(
            model_name='instalacion',
            name='proyecto_crm',
            field=models.ForeignKey(
                blank=True,
                help_text='Proyecto al que pertenece (Programa de Obra).',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='instalaciones',
                to='app.proyectoiamet',
            ),
        ),
    ]

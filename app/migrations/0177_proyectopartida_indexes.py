"""
Fase 6.3.A: índices DB en ProyectoPartida.

ProyectoPartida.numero_parte y .marca son campos buscados con frecuencia
en views_iamet.py (autocompletar partidas al armar un proyecto, búsqueda
en catálogo, etc.) y NO tenían índice. Conforme crece la tabla
(actualmente miles de partidas, creciendo), las búsquedas se ralentizan.

Estos índices son baratos en MySQL 8 (sin downtime perceptible para una
tabla de este tamaño) y mejoran consistentemente las queries con LIKE.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0176_search_indexes'),
    ]

    operations = [
        migrations.AlterField(
            model_name='proyectopartida',
            name='marca',
            field=models.CharField(blank=True, db_index=True, default='', max_length=255),
        ),
        migrations.AlterField(
            model_name='proyectopartida',
            name='numero_parte',
            field=models.CharField(blank=True, db_index=True, default='', max_length=255),
        ),
    ]

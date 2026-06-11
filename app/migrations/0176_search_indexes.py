"""
Hardening Fase 3.A: índices DB en los campos buscados por la barra de
búsqueda global (Spotlight).

Antes el endpoint /api/spotlight-search/ hacía 5 queries con LIKE sobre
columnas sin índice → linealmente lento conforme crecen las tablas.
Con estos índices las búsquedas se mantienen rápidas a escala.

Cubre los campos que aparecen en el WHERE/LIKE del Spotlight:
  - Cliente.nombre_empresa
  - TodoItem.oportunidad (título de la opp)
  - TodoItem.po_number
  - Cotizacion.titulo
  - Cotizacion.nombre_cotizacion
  - Tarea.titulo
  - TareaOportunidad.titulo
  - ProyectoIAMET.nombre
  - ProyectoIAMET.cliente_nombre

Nota: estos índices ayudan completamente a búsquedas con startswith
y parcialmente a icontains. Para full-text futuro se evaluará un
índice FULLTEXT (MySQL) si es necesario.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0175_tareahistorial_choices_extra'),
    ]

    operations = [
        migrations.AlterField(
            model_name='cliente',
            name='nombre_empresa',
            field=models.CharField(db_index=True, max_length=200, verbose_name='Nombre de la Empresa'),
        ),
        migrations.AlterField(
            model_name='todoitem',
            name='oportunidad',
            field=models.CharField(db_index=True, max_length=200, verbose_name='Oportunidad de Venta'),
        ),
        migrations.AlterField(
            model_name='todoitem',
            name='po_number',
            field=models.CharField(blank=True, db_index=True, default='', max_length=100, verbose_name='PO'),
        ),
        migrations.AlterField(
            model_name='cotizacion',
            name='titulo',
            field=models.CharField(db_index=True, default='Cotización', max_length=255, verbose_name='Título de la Cotización'),
        ),
        migrations.AlterField(
            model_name='cotizacion',
            name='nombre_cotizacion',
            field=models.CharField(blank=True, db_index=True, max_length=255, null=True, verbose_name='Nombre para el PDF de la Cotización'),
        ),
        migrations.AlterField(
            model_name='tarea',
            name='titulo',
            field=models.CharField(db_index=True, max_length=200, verbose_name='Título de la Tarea'),
        ),
        migrations.AlterField(
            model_name='tareaoportunidad',
            name='titulo',
            field=models.CharField(db_index=True, max_length=255),
        ),
        migrations.AlterField(
            model_name='proyectoiamet',
            name='nombre',
            field=models.CharField(db_index=True, max_length=255),
        ),
        migrations.AlterField(
            model_name='proyectoiamet',
            name='cliente_nombre',
            field=models.CharField(blank=True, db_index=True, default='', max_length=255),
        ),
    ]

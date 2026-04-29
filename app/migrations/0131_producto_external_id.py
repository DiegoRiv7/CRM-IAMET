from django.db import migrations, models


class Migration(migrations.Migration):
    """Producto: agrega external_id (UUID del Excel/ERP, llave de upsert)
    y no_producto. Quita unique de `codigo` y amplía a 80 chars — el
    Excel origen trae duplicados legítimos del mismo código (ej.
    'MISELANEOS' x6, '1' x144) que son productos distintos."""

    dependencies = [
        ('app', '0130_levantamiento_actualizado_por'),
    ]

    operations = [
        migrations.AddField(
            model_name='producto',
            name='external_id',
            field=models.CharField(
                blank=True,
                db_index=True,
                max_length=64,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name='producto',
            name='no_producto',
            field=models.PositiveIntegerField(
                blank=True,
                db_index=True,
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name='producto',
            name='codigo',
            field=models.CharField(db_index=True, max_length=80),
        ),
    ]

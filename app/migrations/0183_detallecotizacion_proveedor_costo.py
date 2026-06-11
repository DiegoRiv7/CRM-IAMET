"""
DetalleCotizacion: proveedor (FK→ProveedorCRM) + costo_unitario.

Dos campos internos por línea de cotización, NO se exponen en los PDFs
(`cotizacion_pdf_template.html` ni `iamet_cotizacion_pdf_template.html`
los referencian). Vivien solo en la BD para alimentar:

  * Resumen de utilidad por cotización (subtotal - costo total).
  * M2M `TodoItem.proveedores` de la oportunidad asociada: el view
    `crear_cotizacion_view` recolecta los proveedores únicos asignados
    a las líneas y los hace `add()` al M2M (sin borrar previos).

`on_delete=SET_NULL` para no perder histórico de cotizaciones si se
desactiva/borra un proveedor.
"""
from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0182_todoitem_proveedores_m2m'),
    ]

    operations = [
        migrations.AddField(
            model_name='detallecotizacion',
            name='proveedor',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='detalles_cotizacion',
                to='app.proveedorcrm',
                verbose_name='Proveedor de esta línea (interno, no aparece en PDF)',
            ),
        ),
        migrations.AddField(
            model_name='detallecotizacion',
            name='costo_unitario',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0.00'),
                max_digits=10,
                verbose_name='Costo unitario (interno, no aparece en PDF)',
            ),
        ),
    ]

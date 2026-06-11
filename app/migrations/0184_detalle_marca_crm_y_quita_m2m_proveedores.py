"""
Cambios estructurales para reporte por marca y proveedor:

1. AddField `DetalleCotizacion.marca_crm` (FK a MarcaCRM, nullable).
   Una línea de cotización puede llevar su propia marca — así se soporta
   que una opp use varias marcas (Zebra + Panduit + Avigilon) y el
   dashboard de Marcas pueda agregar pipeline/facturado a nivel de
   LÍNEA en vez de a nivel de opp completa.

2. RemoveField `TodoItem.proveedores` (M2M). El acumulador del M2M
   entró en conflicto con el requisito "solo la última cotización
   cuenta". Ahora el dashboard de Proveedores deriva siempre desde
   `DetalleCotizacion.proveedor` filtrado por la última cotización
   de cada opp — una sola fuente de verdad, sin posibilidad de
   desincronización.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0183_detallecotizacion_proveedor_costo'),
    ]

    operations = [
        migrations.AddField(
            model_name='detallecotizacion',
            name='marca_crm',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='detalles_cotizacion',
                to='app.marcacrm',
                verbose_name='Marca de esta línea (interno, no aparece en PDF)',
            ),
        ),
        migrations.RemoveField(
            model_name='todoitem',
            name='proveedores',
        ),
    ]

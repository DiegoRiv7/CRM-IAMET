"""
TodoItem.proveedores — M2M a ProveedorCRM.

Cada oportunidad puede tener N proveedores (ej. una venta combinada que
involucre distribuidor Zebra + mayorista Panduit). related_name=
'oportunidades' permite a ProveedorCRM consultar sus opps directamente,
lo que alimenta los KPIs (facturado, pipeline, # opps) de la sección
Proveedores del dashboard.

Sin tabla `through` explícita — Django genera `app_todoitem_proveedores`
con (id, todoitem_id, proveedorcrm_id) que es suficiente para los queries
de agregación y filtros que hace views_v2/proveedores_v2.py.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0181_proveedorcrm'),
    ]

    operations = [
        migrations.AddField(
            model_name='todoitem',
            name='proveedores',
            field=models.ManyToManyField(
                blank=True,
                related_name='oportunidades',
                to='app.proveedorcrm',
                verbose_name='Proveedores',
            ),
        ),
    ]

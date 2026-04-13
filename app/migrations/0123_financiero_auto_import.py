import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0122_userprofile_tareas_ancladas'),
    ]

    operations = [
        # ArchivoOportunidad: campos de tracking financiero
        migrations.AddField(
            model_name='archivooportunidad',
            name='procesado_financiero',
            field=models.BooleanField(default=False, verbose_name='Procesado por el módulo financiero'),
        ),
        migrations.AddField(
            model_name='archivooportunidad',
            name='tipo_financiero',
            field=models.CharField(blank=True, default='', max_length=20, verbose_name='Tipo financiero detectado'),
        ),
        migrations.AddField(
            model_name='archivooportunidad',
            name='monto_extraido',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True, verbose_name='Monto extraído del PDF'),
        ),
        # ProyectoOrdenCompra: archivo_drive FK + partida nullable
        migrations.AddField(
            model_name='proyectoordencompra',
            name='archivo_drive',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='ocs_generadas', to='app.archivooportunidad', verbose_name='Archivo del drive vinculado'),
        ),
        migrations.AlterField(
            model_name='proyectoordencompra',
            name='partida',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='ordenes_compra', to='app.proyectopartida'),
        ),
        # ProyectoFacturaIngreso: archivo_drive FK
        migrations.AddField(
            model_name='proyectofacturaingreso',
            name='archivo_drive',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='facturas_generadas', to='app.archivooportunidad', verbose_name='Archivo del drive vinculado'),
        ),
    ]

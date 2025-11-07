# Corrección de relaciones de CarpetaProyecto y ArchivoProyecto

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0042_merge_20251107_1331'),
    ]

    operations = [
        migrations.AlterField(
            model_name='carpetaproyecto',
            name='proyecto',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='carpetas', to='app.proyecto', verbose_name='Proyecto'),
        ),
        migrations.AlterField(
            model_name='archivoproyecto',
            name='proyecto',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='archivos', to='app.proyecto', verbose_name='Proyecto'),
        ),
    ]
EOF < /dev/null
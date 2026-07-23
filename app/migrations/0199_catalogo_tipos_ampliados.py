# Amplía TIPO_PRODUCTO_CHOICES de CatalogoCableado para cubrir todo lo que
# aparece en volumetrías reales (fibra, charola, tubería, equipos, etc.).
# Solo cambia choices — sin cambio de esquema en BD.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0198_asistente_resumen_diario'),
    ]

    operations = [
        migrations.AlterField(
            model_name='catalogocableado',
            name='tipo_producto',
            field=models.CharField(
                choices=[
                    ('CABLE', 'Cable'),
                    ('JACK', 'Jack'),
                    ('PATCHCORD', 'Patchcord'),
                    ('FACEPLATE', 'Faceplate'),
                    ('FIBRA', 'Fibra Óptica'),
                    ('CHAROLA', 'Charola/Escalerilla'),
                    ('TUBERIA', 'Tubería/Conduit'),
                    ('SOPORTERIA', 'Soportería/Fijación'),
                    ('EQUIPO', 'Equipo Activo'),
                    ('ACCESORIO', 'Accesorio'),
                    ('OTRO', 'Otro'),
                ],
                max_length=20,
                verbose_name='Tipo de Producto',
            ),
        ),
    ]

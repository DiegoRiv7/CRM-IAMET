# Generated manually to extend mes_cierre field length

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0031_remove_detallecotizacion_entrega_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='todoitem',
            name='mes_cierre',
            field=models.CharField(
                choices=[
                    ('Enero', 'Enero'), ('Febrero', 'Febrero'), ('Marzo', 'Marzo'), 
                    ('Abril', 'Abril'), ('Mayo', 'Mayo'), ('Junio', 'Junio'),
                    ('Julio', 'Julio'), ('Agosto', 'Agosto'), ('Septiembre', 'Septiembre'),
                    ('Octubre', 'Octubre'), ('Noviembre', 'Noviembre'), ('Diciembre', 'Diciembre')
                ],
                default='Enero',
                max_length=20,  # Increased from 2 to 20 to fit full month names
                verbose_name="Mes de Cierre Esperado"
            ),
        ),
    ]
# Custom migration to convert mes_cierre from codes to names

from django.db import migrations, models

def convert_mes_cierre_codes_to_names(apps, schema_editor):
    """Convert month codes (01, 02, etc.) to month names (Enero, Febrero, etc.)"""
    TodoItem = apps.get_model('app', 'TodoItem')
    
    # Mapping from codes to names
    month_mapping = {
        '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
        '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
        '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
    }
    
    for item in TodoItem.objects.all():
        if item.mes_cierre in month_mapping:
            item.mes_cierre = month_mapping[item.mes_cierre]
            item.save()

def reverse_convert_names_to_codes(apps, schema_editor):
    """Reverse operation: convert month names back to codes"""
    TodoItem = apps.get_model('app', 'TodoItem')
    
    # Reverse mapping from names to codes
    month_mapping = {
        'Enero': '01', 'Febrero': '02', 'Marzo': '03', 'Abril': '04',
        'Mayo': '05', 'Junio': '06', 'Julio': '07', 'Agosto': '08',
        'Septiembre': '09', 'Octubre': '10', 'Noviembre': '11', 'Diciembre': '12',
    }
    
    for item in TodoItem.objects.all():
        if item.mes_cierre in month_mapping:
            item.mes_cierre = month_mapping[item.mes_cierre]
            item.save()

class Migration(migrations.Migration):

    dependencies = [
        ('app', '0037_alter_cotizacion_titulo_alter_todoitem_mes_cierre_and_more'),  # Use the actual latest migration
    ]

    operations = [
        # Step 1: Extend the field to allow longer values
        migrations.AlterField(
            model_name='todoitem',
            name='mes_cierre',
            field=models.CharField(max_length=20, verbose_name="Mes de Cierre Esperado", default='01'),
        ),
        
        # Step 2: Convert existing data from codes to names
        migrations.RunPython(
            convert_mes_cierre_codes_to_names,
            reverse_convert_names_to_codes
        ),
        
        # Step 3: Update field with proper choices
        migrations.AlterField(
            model_name='todoitem',
            name='mes_cierre',
            field=models.CharField(
                max_length=20,
                choices=[
                    ('Enero', 'Enero'), ('Febrero', 'Febrero'), ('Marzo', 'Marzo'), 
                    ('Abril', 'Abril'), ('Mayo', 'Mayo'), ('Junio', 'Junio'),
                    ('Julio', 'Julio'), ('Agosto', 'Agosto'), ('Septiembre', 'Septiembre'),
                    ('Octubre', 'Octubre'), ('Noviembre', 'Noviembre'), ('Diciembre', 'Diciembre')
                ],
                default='Enero',
                verbose_name="Mes de Cierre Esperado"
            ),
        ),
    ]
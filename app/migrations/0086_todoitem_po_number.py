from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0085_todoitem_anio_cierre'),
    ]

    operations = [
        migrations.AddField(
            model_name='todoitem',
            name='po_number',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='PO'),
        ),
    ]

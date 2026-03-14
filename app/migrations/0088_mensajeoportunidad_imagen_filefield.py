from django.db import migrations, models
import app.models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0087_merge_po_number_factura_numero'),
    ]

    operations = [
        migrations.AlterField(
            model_name='mensajeoportunidad',
            name='imagen',
            field=models.FileField(blank=True, null=True, upload_to=app.models.chat_imagen_upload_path),
        ),
    ]

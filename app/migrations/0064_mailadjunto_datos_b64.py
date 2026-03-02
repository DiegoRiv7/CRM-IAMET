from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0063_mail_module'),
    ]

    operations = [
        migrations.AddField(
            model_name='mailadjunto',
            name='datos_b64',
            field=models.TextField(blank=True),
        ),
    ]

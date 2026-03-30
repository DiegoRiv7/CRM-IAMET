from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0108_etapa_pipeline'),
    ]

    operations = [
        migrations.AlterField(
            model_name='etapapipeline',
            name='pipeline',
            field=models.CharField(default='runrate', max_length=50),
        ),
    ]

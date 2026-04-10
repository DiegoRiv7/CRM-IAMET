from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0116_reglaautomatizacion_incluir_dueno_v2'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='oportunidades_ancladas',
            field=models.JSONField(blank=True, default=list, verbose_name='IDs de oportunidades ancladas'),
        ),
    ]

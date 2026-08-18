from django.db import migrations, models


class Migration(migrations.Migration):
    """Marca de cliente/prospecto en el propio Cliente.

    Escrita a mano y con una sola operacion a proposito: un makemigrations
    arrastraria las 56 operaciones pendientes del proyecto (renombres de indices
    y AutoField->BigAutoField) que no tienen que ver con esto.
    """

    dependencies = [
        ('app', '0215_oportunidad_vistas_y_accesos'),
    ]

    operations = [
        migrations.AddField(
            model_name='cliente',
            name='es_prospecto',
            field=models.BooleanField(
                default=False, db_index=True,
                verbose_name='Es prospecto (cliente potencial)'),
        ),
    ]

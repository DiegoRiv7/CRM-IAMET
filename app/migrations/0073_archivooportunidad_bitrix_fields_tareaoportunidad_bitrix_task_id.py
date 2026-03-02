from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0072_proyecto_bitrix_group_id_tarea_bitrix_task_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='archivooportunidad',
            name='bitrix_file_id',
            field=models.IntegerField(blank=True, null=True, verbose_name='ID de Archivo en Bitrix24'),
        ),
        migrations.AddField(
            model_name='archivooportunidad',
            name='bitrix_download_url',
            field=models.TextField(blank=True, verbose_name='URL de Descarga Bitrix24'),
        ),
        migrations.AlterField(
            model_name='archivooportunidad',
            name='archivo',
            field=models.FileField(blank=True, upload_to='archivos/oportunidad/'),
        ),
        migrations.AlterField(
            model_name='archivooportunidad',
            name='tamaño',
            field=models.BigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='tareaoportunidad',
            name='bitrix_task_id',
            field=models.IntegerField(blank=True, null=True, unique=True, verbose_name='ID de Tarea en Bitrix24'),
        ),
    ]

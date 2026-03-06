from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0077_fix_notificacion_solicitud_perfil_column'),
    ]

    operations = [
        # Proyecto: flag es_ingenieria
        migrations.AddField(
            model_name='proyecto',
            name='es_ingenieria',
            field=models.BooleanField(default=False, verbose_name='Es Proyecto de Ingeniería (importado de Bitrix)'),
        ),
        # CarpetaProyecto: bitrix_folder_id
        migrations.AddField(
            model_name='carpetaproyecto',
            name='bitrix_folder_id',
            field=models.IntegerField(blank=True, null=True, verbose_name='ID de Carpeta en Bitrix24'),
        ),
        # ArchivoProyecto: hacer archivo opcional + campos Bitrix
        migrations.AlterField(
            model_name='archivoproyecto',
            name='archivo',
            field=models.FileField(blank=True, upload_to='proyectos/archivos/%Y/%m/', verbose_name='Archivo'),
        ),
        migrations.AddField(
            model_name='archivoproyecto',
            name='bitrix_file_id',
            field=models.IntegerField(blank=True, null=True, verbose_name='ID de Archivo en Bitrix24'),
        ),
        migrations.AddField(
            model_name='archivoproyecto',
            name='bitrix_download_url',
            field=models.TextField(blank=True, verbose_name='URL de Descarga Bitrix24'),
        ),
        # ProyectoComentario: usuario nullable + campos Bitrix
        migrations.AlterField(
            model_name='proyectocomentario',
            name='usuario',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=models.deletion.SET_NULL,
                to='auth.user',
                verbose_name='Usuario',
            ),
        ),
        migrations.AddField(
            model_name='proyectocomentario',
            name='bitrix_comment_id',
            field=models.IntegerField(blank=True, null=True, verbose_name='ID de Comentario en Bitrix24'),
        ),
        migrations.AddField(
            model_name='proyectocomentario',
            name='bitrix_autor_nombre',
            field=models.CharField(blank=True, max_length=255, verbose_name='Nombre Autor Bitrix'),
        ),
    ]

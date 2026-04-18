from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0123_financiero_auto_import'),
    ]

    operations = [
        migrations.CreateModel(
            name='MensajeGrupoArchivo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('archivo', models.FileField(upload_to='grupos/archivos/%Y/%m/', verbose_name='Archivo')),
                ('nombre_original', models.CharField(max_length=255, verbose_name='Nombre original')),
                ('tamaño', models.PositiveIntegerField(verbose_name='Tamaño (bytes)')),
                ('tipo_contenido', models.CharField(blank=True, default='', max_length=100, verbose_name='Tipo MIME')),
                ('fecha_subida', models.DateTimeField(auto_now_add=True)),
                ('mensaje', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='archivos',
                    to='app.mensajegrupo',
                    verbose_name='Mensaje',
                )),
            ],
            options={
                'verbose_name': 'Archivo de Mensaje de Grupo',
                'verbose_name_plural': 'Archivos de Mensajes de Grupo',
                'ordering': ['fecha_subida'],
            },
        ),
    ]

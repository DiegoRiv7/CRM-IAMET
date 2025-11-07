# Generated for Sistema de Carpetas y Archivos

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def archivo_upload_path(instance, filename):
    """Genera la ruta de subida para archivos de proyecto"""
    return f'proyectos/{instance.proyecto.id}/archivos/{filename}'


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0035_actividad'),
    ]

    operations = [
        migrations.CreateModel(
            name='CarpetaProyecto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=255, verbose_name='Nombre de la Carpeta')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Creación')),
                ('fecha_modificacion', models.DateTimeField(auto_now=True, verbose_name='Última Modificación')),
                ('carpeta_padre', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='subcarpetas', to='app.carpetaproyecto', verbose_name='Carpeta Padre')),
                ('creado_por', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL, verbose_name='Creado por')),
                ('proyecto', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='carpetas', to='app.proyecto', verbose_name='Proyecto')),
            ],
            options={
                'verbose_name': 'Carpeta del Proyecto',
                'verbose_name_plural': 'Carpetas del Proyecto',
                'ordering': ['nombre'],
            },
        ),
        migrations.CreateModel(
            name='ArchivoProyecto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre_original', models.CharField(max_length=255, verbose_name='Nombre Original')),
                ('archivo', models.FileField(upload_to=archivo_upload_path, verbose_name='Archivo')),
                ('tipo_archivo', models.CharField(choices=[('documento', 'Documento'), ('imagen', 'Imagen'), ('video', 'Video'), ('audio', 'Audio'), ('hoja_calculo', 'Hoja de Cálculo'), ('presentacion', 'Presentación'), ('pdf', 'PDF'), ('archivo_comprimido', 'Archivo Comprimido'), ('otro', 'Otro')], default='otro', max_length=20, verbose_name='Tipo de Archivo')),
                ('tamaño', models.BigIntegerField(verbose_name='Tamaño en Bytes')),
                ('fecha_subida', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Subida')),
                ('descripcion', models.TextField(blank=True, null=True, verbose_name='Descripción')),
                ('es_publico', models.BooleanField(default=True, verbose_name='Es Público')),
                ('extension', models.CharField(blank=True, max_length=10, verbose_name='Extensión')),
                ('mime_type', models.CharField(blank=True, max_length=100, verbose_name='MIME Type')),
                ('carpeta', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='archivos', to='app.carpetaproyecto', verbose_name='Carpeta')),
                ('proyecto', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='archivos', to='app.proyecto', verbose_name='Proyecto')),
                ('subido_por', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL, verbose_name='Subido por')),
            ],
            options={
                'verbose_name': 'Archivo del Proyecto',
                'verbose_name_plural': 'Archivos del Proyecto',
                'ordering': ['-fecha_subida'],
            },
        ),
        migrations.CreateModel(
            name='CompartirArchivo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha_compartido', models.DateTimeField(auto_now_add=True)),
                ('puede_editar', models.BooleanField(default=False, verbose_name='Puede Editar')),
                ('archivo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='compartidos', to='app.archivoproyecto')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Archivo Compartido',
                'verbose_name_plural': 'Archivos Compartidos',
            },
        ),
        migrations.AddConstraint(
            model_name='carpetaproyecto',
            constraint=models.UniqueConstraint(fields=('proyecto', 'carpeta_padre', 'nombre'), name='unique_folder_name_per_parent'),
        ),
        migrations.AddConstraint(
            model_name='compartirarchivo',
            constraint=models.UniqueConstraint(fields=('archivo', 'usuario'), name='unique_file_sharing_per_user'),
        ),
    ]
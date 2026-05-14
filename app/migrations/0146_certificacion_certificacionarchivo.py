"""Modelos Certificacion y CertificacionArchivo para que los usuarios
registren sus certificaciones (Panduit, Zebra, etc.) con comprobantes
(PDFs/imágenes) y queden como historial colectivo del equipo IAMET.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

import app.models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0145_evento_cliente_potencial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Certificacion',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('marca', models.CharField(help_text="Marca emisora, e.g. 'PANDUIT', 'ZEBRA'.", max_length=50)),
                ('nombre', models.CharField(
                    help_text='Ej. "PCDS — Panduit Certified Data Center Specialist".',
                    max_length=200, verbose_name='Nombre de la certificación')),
                ('nivel', models.CharField(
                    blank=True, default='',
                    choices=[
                        ('basico', 'Básico'),
                        ('intermedio', 'Intermedio'),
                        ('avanzado', 'Avanzado'),
                        ('experto', 'Experto'),
                    ],
                    help_text='Nivel de la certificación (opcional).',
                    max_length=20)),
                ('numero', models.CharField(
                    blank=True, default='', max_length=120,
                    help_text='Código o folio emitido por la marca (opcional).',
                    verbose_name='Número o folio')),
                ('fecha_obtencion', models.DateField(verbose_name='Fecha de obtención')),
                ('fecha_vencimiento', models.DateField(
                    blank=True, null=True,
                    verbose_name='Fecha de vencimiento')),
                ('notas', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('usuario', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='certificaciones',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Persona certificada')),
                ('creado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='certificaciones_creadas',
                    to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Certificación',
                'verbose_name_plural': 'Certificaciones',
                'ordering': ['-fecha_obtencion', '-fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='CertificacionArchivo',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('archivo', models.FileField(upload_to=app.models._certificacion_archivo_upload_path)),
                ('nombre', models.CharField(blank=True, default='', max_length=255)),
                ('fecha_subida', models.DateTimeField(auto_now_add=True)),
                ('certificacion', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='archivos',
                    to='app.certificacion')),
                ('subido_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='certificacion_archivos_subidos',
                    to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Archivo de certificación',
                'verbose_name_plural': 'Archivos de certificación',
                'ordering': ['-fecha_subida'],
            },
        ),
    ]

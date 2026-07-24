# Correo Fase 4 (parte 2): borradores con autoguardado + envíos programados.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0206_mail_firma_plantillas'),
    ]

    operations = [
        migrations.CreateModel(
            name='MailBorrador',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('para', models.TextField(blank=True, default='')),
                ('cc', models.TextField(blank=True, default='')),
                ('asunto', models.CharField(blank=True, default='', max_length=500)),
                ('cuerpo_html', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('conexion', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='app.mailconexion')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='mail_borradores', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Borrador de Correo',
                'verbose_name_plural': 'Borradores de Correo',
                'ordering': ['-fecha_actualizacion'],
            },
        ),
        migrations.CreateModel(
            name='MailProgramado',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('para', models.TextField()),
                ('cc', models.TextField(blank=True, default='')),
                ('bcc', models.TextField(blank=True, default='')),
                ('asunto', models.CharField(blank=True, default='', max_length=500)),
                ('cuerpo_html', models.TextField(blank=True, default='')),
                ('cuerpo_texto', models.TextField(blank=True, default='')),
                ('adjuntos_json', models.TextField(blank=True, default='[]')),
                ('fecha_programada', models.DateTimeField(db_index=True)),
                ('enviado', models.BooleanField(db_index=True, default=False)),
                ('fecha_enviado', models.DateTimeField(blank=True, null=True)),
                ('intentos', models.IntegerField(default=0)),
                ('error', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('conexion', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='app.mailconexion')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='mail_programados', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Correo Programado',
                'verbose_name_plural': 'Correos Programados',
                'ordering': ['fecha_programada'],
            },
        ),
    ]

# Correo Fase 4 (parte 1): firma HTML por conexión + plantillas de correo.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0205_mail_acciones_pendientes'),
    ]

    operations = [
        migrations.AddField(
            model_name='mailconexion',
            name='firma_html',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.CreateModel(
            name='MailPlantilla',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=120)),
                ('asunto', models.CharField(blank=True, default='', max_length=500)),
                ('cuerpo_html', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='mail_plantillas', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Plantilla de Correo',
                'verbose_name_plural': 'Plantillas de Correo',
                'ordering': ['nombre'],
            },
        ),
    ]

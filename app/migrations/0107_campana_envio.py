import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0106_campana_template_fields'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CampanaEnvio',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('contacto_email', models.EmailField(max_length=254)),
                ('contacto_nombre', models.CharField(blank=True, default='', max_length=200)),
                ('mail_message_id', models.CharField(blank=True, default='', max_length=500)),
                ('respondido', models.BooleanField(default=False)),
                ('respuesta_favorable', models.BooleanField(blank=True, null=True)),
                ('fecha_envio', models.DateTimeField(auto_now_add=True)),
                ('fecha_respuesta', models.DateTimeField(blank=True, null=True)),
                ('template', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='envios', to='app.campanatemplate')),
                ('prospecto', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='app.prospecto')),
                ('cliente', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='app.cliente')),
                ('enviado_por', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-fecha_envio'],
                'verbose_name': 'Envio de Campana',
                'verbose_name_plural': 'Envios de Campana',
            },
        ),
    ]

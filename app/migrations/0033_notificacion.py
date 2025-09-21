# Generated manually for Notificacion model

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0032_alter_todoitem_mes_cierre'),
    ]

    operations = [
        migrations.CreateModel(
            name='Notificacion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tipo', models.CharField(choices=[('mencion', 'Mención en comentario'), ('respuesta', 'Respuesta a comentario'), ('comentario_oportunidad', 'Nuevo comentario en oportunidad'), ('sistema', 'Notificación del sistema')], max_length=25, verbose_name='Tipo de Notificación')),
                ('titulo', models.CharField(max_length=200, verbose_name='Título de la Notificación')),
                ('mensaje', models.TextField(verbose_name='Mensaje de la Notificación')),
                ('leida', models.BooleanField(default=False, verbose_name='Notificación Leída')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Creación')),
                ('fecha_lectura', models.DateTimeField(blank=True, null=True, verbose_name='Fecha de Lectura')),
                ('comentario', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='notificaciones', to='app.oportunidadcomentario', verbose_name='Comentario Relacionado')),
                ('oportunidad', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='notificaciones', to='app.todoitem', verbose_name='Oportunidad Relacionada')),
                ('usuario_destinatario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notificaciones_recibidas', to=settings.AUTH_USER_MODEL, verbose_name='Usuario Destinatario')),
                ('usuario_remitente', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='notificaciones_enviadas', to=settings.AUTH_USER_MODEL, verbose_name='Usuario Remitente')),
            ],
            options={
                'verbose_name': 'Notificación',
                'verbose_name_plural': 'Notificaciones',
                'ordering': ['-fecha_creacion'],
            },
        ),
    ]
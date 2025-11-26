from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0045_fix_foreign_key_constraints'),
    ]

    operations = [
        migrations.CreateModel(
            name='SolicitudAccesoProyecto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('estado', models.CharField(choices=[('pendiente', 'Pendiente'), ('aprobada', 'Aprobada'), ('rechazada', 'Rechazada')], default='pendiente', max_length=20, verbose_name='Estado')),
                ('fecha_solicitud', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Solicitud')),
                ('fecha_respuesta', models.DateTimeField(blank=True, null=True, verbose_name='Fecha de Respuesta')),
                ('mensaje', models.TextField(blank=True, help_text='Mensaje opcional del solicitante', verbose_name='Mensaje')),
                ('proyecto', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='solicitudes_acceso', to='app.proyecto', verbose_name='Proyecto')),
                ('usuario_respuesta', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='respuestas_proyecto', to=settings.AUTH_USER_MODEL, verbose_name='Usuario que Respondió')),
                ('usuario_solicitante', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='solicitudes_proyecto', to=settings.AUTH_USER_MODEL, verbose_name='Usuario Solicitante')),
            ],
            options={
                'verbose_name': 'Solicitud de Acceso a Proyecto',
                'verbose_name_plural': 'Solicitudes de Acceso a Proyectos',
                'ordering': ['-fecha_solicitud'],
            },
        ),
        migrations.AddConstraint(
            model_name='solicitudaccesoproyecto',
            constraint=models.UniqueConstraint(fields=('proyecto', 'usuario_solicitante'), name='app_solicitud_unique_proyecto_usuario'),
        ),
    ]
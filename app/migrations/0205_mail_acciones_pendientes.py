# Correo Fase 2: cola de acciones CRM→IMAP (sync de dos vías). Las acciones
# locales (leer/destacar/eliminar/archivar) se encolan y un worker las aplica
# contra el servidor IMAP real, con reintentos si el servidor no responde.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0204_mail_hilos'),
    ]

    operations = [
        migrations.CreateModel(
            name='MailAccionPendiente',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('accion', models.CharField(choices=[('leido', 'Marcar leído'), ('destacar', 'Destacar'), ('no_destacar', 'Quitar destacado'), ('eliminar', 'Mover a papelera'), ('archivar', 'Archivar')], max_length=20)),
                ('resuelta', models.BooleanField(db_index=True, default=False)),
                ('intentos', models.IntegerField(default=0)),
                ('ultimo_error', models.TextField(blank=True)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_resuelta', models.DateTimeField(blank=True, null=True)),
                ('conexion', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='acciones_pendientes', to='app.mailconexion')),
                ('correo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='acciones_pendientes', to='app.mailcorreo')),
            ],
            options={
                'verbose_name': 'Acción de Correo Pendiente',
                'verbose_name_plural': 'Acciones de Correo Pendientes',
                'ordering': ['fecha_creacion'],
            },
        ),
    ]

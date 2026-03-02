from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0062_tareaoportunidad_actividad_calendario'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # MailConexion
        migrations.CreateModel(
            name='MailConexion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('correo_electronico', models.EmailField(max_length=254)),
                ('imap_servidor', models.CharField(default='mail.iamet.mx', max_length=200)),
                ('imap_puerto', models.IntegerField(default=993)),
                ('imap_usar_ssl', models.BooleanField(default=True)),
                ('smtp_servidor', models.CharField(default='mail.iamet.mx', max_length=200)),
                ('smtp_puerto', models.IntegerField(default=465)),
                ('smtp_usar_ssl', models.BooleanField(default=True)),
                ('password_encriptado', models.TextField(blank=True)),
                ('activo', models.BooleanField(default=True)),
                ('ultima_sincronizacion', models.DateTimeField(blank=True, null=True)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('usuario', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='mail_conexion',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Conexión de Correo',
                'verbose_name_plural': 'Conexiones de Correo',
            },
        ),
        # MailCorreo
        migrations.CreateModel(
            name='MailCorreo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uid_imap', models.CharField(max_length=50)),
                ('message_id', models.CharField(blank=True, max_length=500)),
                ('in_reply_to', models.CharField(blank=True, max_length=500)),
                ('carpeta_imap', models.CharField(default='INBOX', max_length=100)),
                ('carpeta_display', models.CharField(
                    choices=[('INBOX', 'Bandeja de entrada'), ('SENT', 'Enviados')],
                    default='INBOX', max_length=20,
                )),
                ('remitente_nombre', models.CharField(blank=True, max_length=300)),
                ('remitente_email', models.CharField(blank=True, max_length=300)),
                ('destinatarios_json', models.TextField(default='[]')),
                ('asunto', models.CharField(blank=True, max_length=500)),
                ('cuerpo_texto', models.TextField(blank=True)),
                ('cuerpo_html', models.TextField(blank=True)),
                ('fecha_envio', models.DateTimeField(blank=True, null=True)),
                ('leido', models.BooleanField(default=False)),
                ('tiene_adjuntos', models.BooleanField(default=False)),
                ('cuerpo_cargado', models.BooleanField(default=False)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('usuario', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='correos_mail',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('oportunidad', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='correos_vinculados',
                    to='app.todoitem',
                )),
            ],
            options={
                'verbose_name': 'Correo',
                'verbose_name_plural': 'Correos',
                'ordering': ['-fecha_envio'],
            },
        ),
        migrations.AlterUniqueTogether(
            name='mailcorreo',
            unique_together={('usuario', 'uid_imap', 'carpeta_imap')},
        ),
        # MailAdjunto
        migrations.CreateModel(
            name='MailAdjunto',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre_archivo', models.CharField(max_length=300)),
                ('content_type', models.CharField(blank=True, max_length=100)),
                ('tamanio_bytes', models.IntegerField(default=0)),
                ('parte_num', models.CharField(blank=True, max_length=20)),
                ('correo', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='adjuntos',
                    to='app.mailcorreo',
                )),
            ],
            options={
                'verbose_name': 'Adjunto de Correo',
                'verbose_name_plural': 'Adjuntos de Correo',
            },
        ),
    ]

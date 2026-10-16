# Los secretos de cada empresa pasan a guardarse CIFRADOS en reposo.
# A nivel de base solo cambia el ancho de la columna (el token Fernet es más
# largo que el secreto); el cifrado lo hace el campo al escribir. Los valores
# que ya estaban en claro se siguen leyendo tal cual hasta que se corra
# `manage.py tenant_cifrar_secretos`.

from django.db import migrations

import tenants.cifrado


class Migration(migrations.Migration):

    dependencies = [
        ('tenants', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='tenant',
            name='db_password',
            field=tenants.cifrado.CampoCifrado(max_length=500),
        ),
        migrations.AlterField(
            model_name='tenant',
            name='mail_encryption_key',
            field=tenants.cifrado.CampoCifrado(blank=True, default='', help_text='Llave Fernet del cifrado de contraseñas de buzones', max_length=500),
        ),
        migrations.AlterField(
            model_name='tenant',
            name='portal_sso_secret',
            field=tenants.cifrado.CampoCifrado(blank=True, default='', help_text='Secreto del inicio de sesión desde el portal', max_length=500),
        ),
    ]

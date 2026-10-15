# Registro de empresas (tenants) — vive SOLO en la BD de control (alias `control`);
# el router (tenants.router.TenantRouter.allow_migrate) impide que estas tablas
# se creen en las bases de las empresas o en `default`.

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='Tenant',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.CharField(max_length=40, unique=True, validators=[django.core.validators.RegexValidator('^[a-z0-9][a-z0-9-]{1,38}$', 'slug: minúsculas, dígitos y guiones (2 a 39 caracteres)')])),
                ('nombre', models.CharField(max_length=120)),
                ('db_name', models.CharField(max_length=100)),
                ('db_user', models.CharField(max_length=100)),
                ('db_password', models.CharField(max_length=200)),
                ('db_host', models.CharField(default='crm-mysql', max_length=100)),
                ('db_port', models.PositiveIntegerField(default=3306)),
                ('mail_encryption_key', models.CharField(blank=True, default='', help_text='Llave Fernet del cifrado de contraseñas de buzones', max_length=200)),
                ('portal_sso_secret', models.CharField(blank=True, default='', help_text='Secreto del inicio de sesión desde el portal', max_length=200)),
                ('activo', models.BooleanField(default=True)),
                ('creado', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name': 'Empresa (tenant)',
                'verbose_name_plural': 'Empresas (tenants)',
                'ordering': ['slug'],
            },
        ),
        migrations.CreateModel(
            name='TenantHost',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('hostname', models.CharField(max_length=253, unique=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='hosts', to='tenants.tenant')),
            ],
            options={
                'ordering': ['hostname'],
            },
        ),
    ]

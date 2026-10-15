"""
Registro de empresas (tenants). Vive en la BD de CONTROL (alias `control`),
nunca dentro de la BD de una empresa: para saber qué base abrir hay que leer
algo que esté FUERA de ella.

Cada tenant conserva su propia base y su propio usuario MySQL con GRANT solo
sobre esa base (los crea scripts/nueva_empresa.sh). Así, aunque el proceso sea
compartido, la empresa A no puede leer la base de B ni por error.
"""
from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

_slug_ok = RegexValidator(
    r'^[a-z0-9][a-z0-9-]{1,38}$',
    'slug: minúsculas, dígitos y guiones (2 a 39 caracteres)',
)


class Tenant(models.Model):
    slug = models.CharField(max_length=40, unique=True, validators=[_slug_ok])
    nombre = models.CharField(max_length=120)

    # Conexión a SU base (usuario con permisos solo sobre ella).
    db_name = models.CharField(max_length=100)
    db_user = models.CharField(max_length=100)
    db_password = models.CharField(max_length=200)
    db_host = models.CharField(max_length=100, default='crm-mysql')
    db_port = models.PositiveIntegerField(default=3306)

    # Secretos propios de la empresa (antes vivían en .env.<slug>).
    mail_encryption_key = models.CharField(max_length=200, blank=True, default='',
                                           help_text='Llave Fernet del cifrado de contraseñas de buzones')
    portal_sso_secret = models.CharField(max_length=200, blank=True, default='',
                                         help_text='Secreto del inicio de sesión desde el portal')

    activo = models.BooleanField(default=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['slug']
        verbose_name = 'Empresa (tenant)'
        verbose_name_plural = 'Empresas (tenants)'

    def __str__(self):
        return f'{self.slug} · {self.nombre}'

    @property
    def db_alias(self):
        return f't_{self.slug}'

    def db_config(self):
        """Entrada para connections.databases[self.db_alias]."""
        engine = getattr(settings, 'TENANT_DB_ENGINE', 'django.db.backends.mysql')
        cfg = {
            'ENGINE': engine,
            'NAME': self.db_name,
            'USER': self.db_user,
            'PASSWORD': self.db_password,
            'HOST': self.db_host,
            'PORT': str(self.db_port),
            'CONN_MAX_AGE': 0,          # conexión por request: nada se reusa entre hilos
            'CONN_HEALTH_CHECKS': False,
            'ATOMIC_REQUESTS': False,
            'AUTOCOMMIT': True,
            'TIME_ZONE': None,
            'OPTIONS': {},
            'TEST': {},
        }
        if engine.endswith('mysql'):
            cfg['OPTIONS'] = {'init_command': "SET sql_mode='STRICT_TRANS_TABLES'"}
        elif engine.endswith('sqlite3'):
            # Solo pruebas: cada alias es una BD en memoria.
            cfg['NAME'] = getattr(settings, 'TENANT_DB_SQLITE_NAME', ':memory:')
        return cfg


class TenantHost(models.Model):
    """Un hostname → una empresa. Una empresa puede tener varios (nip.io + dominio propio)."""
    tenant = models.ForeignKey(Tenant, related_name='hosts', on_delete=models.CASCADE)
    hostname = models.CharField(max_length=253, unique=True)

    class Meta:
        ordering = ['hostname']

    def save(self, *args, **kwargs):
        self.hostname = (self.hostname or '').strip().lower().rstrip('.')
        super().save(*args, **kwargs)

    def __str__(self):
        return self.hostname

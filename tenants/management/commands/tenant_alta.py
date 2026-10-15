"""
manage.py tenant_alta <slug> --nombre "Acme S.A." --host acme.82-223-44-29.nip.io [--host acme.crm.iamet.mx]
                      [--db-name crm_<slug>] [--db-user u_<slug>] [--db-host crm-mysql] [--db-port 3306]
manage.py tenant_alta <slug> --existe          → sale 0 si ya está registrada, 1 si no (imprime existe/nuevo)

Registra (o actualiza) una empresa en la BD de CONTROL. Los secretos NUNCA
viajan por argv ni se imprimen:
  TENANT_DB_PASSWORD   contraseña del usuario MySQL de la empresa (obligatoria al crear)
  TENANT_SSO_SECRET    secreto del SSO del portal (si falta al crear, se genera)
  TENANT_MAIL_KEY      llave Fernet del correo (si falta al crear, se genera)
En una empresa ya registrada solo se actualiza lo que venga (nombre, hosts,
y los secretos si se pasan por entorno); lo demás se conserva.
"""
import os
import secrets

from django.core.exceptions import ValidationError
from django.core.management import BaseCommand, CommandError

from tenants.models import Tenant, TenantHost
from tenants.resolver import invalidar_resolver, normalizar_host


def _fernet_key():
    from cryptography.fernet import Fernet
    return Fernet.generate_key().decode()


class Command(BaseCommand):
    help = 'Registra o actualiza una empresa (tenant) en la BD de control.'

    def add_arguments(self, parser):
        parser.add_argument('slug')
        parser.add_argument('--nombre', default='')
        parser.add_argument('--host', action='append', default=[], help='hostname por el que se resuelve (repetible)')
        parser.add_argument('--db-name', default='')
        parser.add_argument('--db-user', default='')
        parser.add_argument('--db-host', default='crm-mysql')
        parser.add_argument('--db-port', type=int, default=3306)
        parser.add_argument('--existe', action='store_true', help='solo consulta: ¿ya está registrada?')

    def handle(self, *args, **o):
        slug = (o['slug'] or '').strip().lower()
        tenant = Tenant.objects.filter(slug=slug).first()

        if o['existe']:
            self.stdout.write('existe' if tenant else 'nuevo')
            if not tenant:
                raise SystemExit(1)
            return

        db_password = os.environ.get('TENANT_DB_PASSWORD', '')
        sso = os.environ.get('TENANT_SSO_SECRET', '')
        mail = os.environ.get('TENANT_MAIL_KEY', '')

        if tenant is None:
            if not o['nombre']:
                raise CommandError('Falta --nombre para una empresa nueva')
            if not db_password:
                raise CommandError('Falta TENANT_DB_PASSWORD en el entorno para una empresa nueva')
            tenant = Tenant(
                slug=slug, nombre=o['nombre'],
                db_name=o['db_name'] or f'crm_{slug}', db_user=o['db_user'] or f'u_{slug}',
                db_password=db_password, db_host=o['db_host'], db_port=o['db_port'],
                portal_sso_secret=sso or secrets.token_hex(24),
                mail_encryption_key=mail or _fernet_key(),
                activo=True,
            )
            accion = 'creada'
        else:
            if o['nombre']:
                tenant.nombre = o['nombre']
            if o['db_name']:
                tenant.db_name = o['db_name']
            if o['db_user']:
                tenant.db_user = o['db_user']
            if db_password:
                tenant.db_password = db_password
            if sso:
                tenant.portal_sso_secret = sso
            if mail:
                tenant.mail_encryption_key = mail
            tenant.db_host = o['db_host']
            tenant.db_port = o['db_port']
            tenant.activo = True
            accion = 'actualizada'

        try:
            tenant.full_clean(exclude=['creado'])
        except ValidationError as exc:
            raise CommandError(f'Datos inválidos: {exc}')
        tenant.save()

        for h in o['host']:
            h = normalizar_host(h)
            if not h:
                continue
            th = TenantHost.objects.filter(hostname=h).first()
            if th and th.tenant_id != tenant.id:
                raise CommandError(f'El host {h} ya pertenece a la empresa {th.tenant.slug}')
            if not th:
                TenantHost.objects.create(tenant=tenant, hostname=h)
        invalidar_resolver()

        hosts = [h.hostname for h in tenant.hosts.all()]
        self.stdout.write(self.style.SUCCESS(
            f'Empresa {accion}: {tenant.slug} · {tenant.nombre} · BD {tenant.db_name} ({tenant.db_user}@{tenant.db_host}) '
            f'· hosts {", ".join(hosts) or "(ninguno)"}'
        ))

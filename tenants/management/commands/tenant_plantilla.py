"""
manage.py tenant_plantilla [--db-name crm_plantilla] [--db-user u_plantilla] [--db-host crm-mysql]

Deja migrada una base PLANTILLA: el esquema completo del CRM, vacío de datos.
Las altas la CLONAN en vez de correr las 221 migraciones desde cero (42 s → ~2 s),
que es lo que hace viable el alta self-service mientras el visitante espera.

La plantilla NO se registra como empresa: se usa un Tenant en memoria (sin
guardar), así que no aparece en el registro de control, no la resuelve ningún
hostname y el worker de correo no la recorre.

La contraseña del usuario MySQL va por entorno: TENANT_DB_PASSWORD.
"""
import os

from django.core.management import BaseCommand, CommandError, call_command

from tenants.context import tenant_context
from tenants.models import Tenant
from tenants.runtime import apuntar_default_al_tenant


class Command(BaseCommand):
    help = 'Migra la base plantilla (esquema vacío que las altas clonan).'

    def add_arguments(self, parser):
        parser.add_argument('--db-name', default='crm_plantilla')
        parser.add_argument('--db-user', default='u_plantilla')
        parser.add_argument('--db-host', default='crm-mysql')
        parser.add_argument('--db-port', type=int, default=3306)

    def handle(self, *args, **o):
        password = os.environ.get('TENANT_DB_PASSWORD', '')
        if not password:
            raise CommandError('Falta TENANT_DB_PASSWORD en el entorno')
        # Tenant en memoria: NO se guarda en control.
        plantilla = Tenant(
            slug='plantilla', nombre='Plantilla', db_name=o['db_name'], db_user=o['db_user'],
            db_password=password, db_host=o['db_host'], db_port=o['db_port'], activo=False,
        )
        with tenant_context(plantilla) as t:
            apuntar_default_al_tenant(t)
            self.stdout.write(self.style.NOTICE(f'Migrando la plantilla {t.db_name} …'))
            call_command('migrate', '--database', t.db_alias, '--noinput', verbosity=0)
        self.stdout.write(self.style.SUCCESS(f'Plantilla {o["db_name"]} al día'))

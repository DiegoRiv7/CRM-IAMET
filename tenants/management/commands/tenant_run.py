"""
manage.py tenant_run <slug> <comando> [args...]

Ejecuta cualquier comando de manage.py DENTRO del contexto de una empresa:
registra su alias de BD, lo fija como tenant actual y llama al comando. Es la
única forma correcta de operar una empresa desde la consola en modo bridge
(migrate, seed_empresa, createsuperuser, sincronizar_correo, shell...).

Ejemplos:
  manage.py tenant_run acme migrate
  manage.py tenant_run acme seed_empresa --nombre "Acme SA" --slug acme
  manage.py tenant_run acme createsuperuser
"""
from django.core.management import BaseCommand, CommandError, call_command

from tenants.context import tenant_context
from tenants.resolver import por_slug


class Command(BaseCommand):
    help = 'Ejecuta un comando de manage.py en el contexto de una empresa (tenant).'

    def add_arguments(self, parser):
        parser.add_argument('slug', help='slug de la empresa (registro de control)')
        parser.add_argument('comando', help='comando de manage.py a ejecutar')
        parser.add_argument('extra', nargs='*', help='argumentos para ese comando')

    def handle(self, *args, **options):
        slug = options['slug']
        try:
            tenant = por_slug(slug)
        except Exception as exc:
            raise CommandError(f'La empresa {slug!r} no existe en la BD de control ({exc})')
        extra = list(options['extra'] or [])
        with tenant_context(tenant) as t:
            alias = t.db_alias
            # `migrate` sin --database migraría `default`; en modo tenant eso está
            # bloqueado por el router, así que apuntamos a la base de la empresa.
            if options['comando'] == 'migrate' and not any(a.startswith('--database') for a in extra):
                extra += ['--database', alias]
            self.stdout.write(self.style.NOTICE(f'[{t.slug}] {options["comando"]} {" ".join(extra)}  (BD {alias})'))
            call_command(options['comando'], *extra)

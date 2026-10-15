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
import argparse

from django.core.management import BaseCommand, CommandError, call_command
from django.db import connections

from tenants.context import tenant_context
from tenants.resolver import por_slug


def apuntar_default_al_tenant(tenant):
    """Hace que el alias `default` de ESTE proceso sea la BD del tenant.

    Solo para consola (tenant_run, workers), nunca para el web. Motivo: mucho
    código legado —migraciones con SQL crudo sobre `django.db.connection`,
    `seed_empresa`, `sincronizar_correo`, `connection.cursor()`— asume que
    `default` es "la base de la empresa". Bajo silo lo era; bajo bridge
    `default` apunta a control y ese código truena (p. ej. la migración que
    toca app_carpetaproyecto). Repuntar `default` aquí les devuelve esa premisa
    sin reescribir 221 migraciones. El router sigue mandando el ORM a
    `t_<slug>`, que es la misma base física.
    """
    connections.databases['default'] = dict(tenant.db_config())
    try:
        del connections['default']  # descarta la conexión ya abierta (control) en este hilo
    except Exception:
        pass


class Command(BaseCommand):
    help = 'Ejecuta un comando de manage.py en el contexto de una empresa (tenant).'

    def add_arguments(self, parser):
        parser.add_argument('slug', help='slug de la empresa (registro de control)')
        parser.add_argument('comando', help='comando de manage.py a ejecutar')
        # REMAINDER: todo lo que siga (incluidos --flags) es del comando hijo.
        parser.add_argument('extra', nargs=argparse.REMAINDER, help='argumentos para ese comando')

    def handle(self, *args, **options):
        slug = options['slug']
        try:
            tenant = por_slug(slug)
        except Exception as exc:
            raise CommandError(f'La empresa {slug!r} no existe en la BD de control ({exc})')
        extra = [a for a in (options['extra'] or []) if a != '--']
        with tenant_context(tenant) as t:
            alias = t.db_alias
            apuntar_default_al_tenant(t)
            # `migrate` sin --database migraría `default` (ahora = la empresa, pero
            # el router solo permite migrar alias t_*): apuntamos al alias explícito.
            if options['comando'] == 'migrate' and not any(a.startswith('--database') for a in extra):
                extra += ['--database', alias]
            self.stdout.write(self.style.NOTICE(f'[{t.slug}] {options["comando"]} {" ".join(extra)}  (BD {alias})'))
            call_command(options['comando'], *extra)

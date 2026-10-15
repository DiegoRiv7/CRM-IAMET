"""
manage.py tenant_baja <slug>            → la empresa deja de resolverse (activo=False); su BD no se toca
manage.py tenant_baja <slug> --borrar   → además borra el registro (y sus hostnames) de control

La base de datos, el usuario MySQL y los archivos de media los maneja
scripts/baja_empresa.sh (con respaldo); este comando solo toca el REGISTRO.
"""
from django.core.management import BaseCommand, CommandError

from tenants.connections import olvidar_alias
from tenants.models import Tenant
from tenants.resolver import invalidar_resolver


class Command(BaseCommand):
    help = 'Desactiva (o borra del registro) una empresa en la BD de control.'

    def add_arguments(self, parser):
        parser.add_argument('slug')
        parser.add_argument('--borrar', action='store_true', help='borrar el registro, no solo desactivar')

    def handle(self, *args, **o):
        slug = (o['slug'] or '').strip().lower()
        tenant = Tenant.objects.filter(slug=slug).first()
        if tenant is None:
            raise CommandError(f'La empresa {slug!r} no está registrada en control')
        alias = tenant.db_alias
        if o['borrar']:
            tenant.delete()
            msg = f'Empresa {slug} BORRADA del registro (su BD y archivos siguen en su lugar)'
        else:
            tenant.activo = False
            tenant.save(update_fields=['activo'])
            msg = f'Empresa {slug} desactivada: ya no se resuelve por hostname (reactivar: tenant_alta {slug})'
        invalidar_resolver()
        olvidar_alias(alias)
        self.stdout.write(self.style.SUCCESS(msg))

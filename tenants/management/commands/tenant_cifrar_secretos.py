"""
manage.py tenant_cifrar_secretos [--dry-run]

Cifra los secretos que todavía estén en claro en la BD de control (los de las
empresas dadas de alta antes del cifrado en reposo). Idempotente: lo que ya
está cifrado se queda igual.

Requiere TENANT_SECRETS_KEY en el entorno. ⚠️ Esa llave es la ÚNICA forma de
volver a abrir estos secretos: guárdala fuera del servidor antes de correr esto.
"""
from django.core.management import BaseCommand, CommandError

from tenants.cifrado import PREFIJO, _llave
from tenants.models import Tenant

CAMPOS = ('db_password', 'mail_encryption_key', 'portal_sso_secret')


class Command(BaseCommand):
    help = 'Cifra en reposo los secretos de empresa que sigan en texto plano.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='solo informa, no escribe')

    def handle(self, *args, **o):
        if not _llave():
            raise CommandError(
                'Falta TENANT_SECRETS_KEY. Genérala con:\n'
                '  python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"\n'
                'y guárdala en el .env de la app (y en un lugar seguro FUERA del servidor).'
            )
        # Se leen los valores CRUDOS: con el ORM normal ya saldrían descifrados
        # y no se podría distinguir lo que falta por cifrar.
        crudos = dict(Tenant.objects.values_list('id', 'slug'))
        pendientes, ya = [], 0
        for tid, slug in crudos.items():
            fila = Tenant.objects.filter(pk=tid).values(*CAMPOS).first()
            # values() pasa por from_db_value → descifra; para saber el estado
            # real consultamos sin conversión.
            from django.db import connections
            alias = Tenant.objects.db
            with connections[alias].cursor() as cur:
                cur.execute(
                    f"SELECT {', '.join(CAMPOS)} FROM tenants_tenant WHERE id = %s", [tid]
                )
                valores = cur.fetchone() or ()
            if any(v and not str(v).startswith(PREFIJO) for v in valores):
                pendientes.append((tid, slug))
            else:
                ya += 1
            del fila

        self.stdout.write(f'Empresas: {len(crudos)} · ya cifradas: {ya} · por cifrar: {len(pendientes)}')
        if not pendientes:
            self.stdout.write(self.style.SUCCESS('Nada que hacer.'))
            return
        if o['dry_run']:
            self.stdout.write('(--dry-run) Se cifrarían: ' + ', '.join(s for _, s in pendientes))
            return

        for tid, slug in pendientes:
            t = Tenant.objects.get(pk=tid)      # lee en claro (legado)
            t.save(update_fields=list(CAMPOS))  # escribe cifrado
            self.stdout.write(f'  ✓ {slug}')
        self.stdout.write(self.style.SUCCESS(
            f'{len(pendientes)} empresas cifradas. GUARDA TENANT_SECRETS_KEY fuera del servidor: '
            'sin ella no se puede abrir ninguna.'
        ))

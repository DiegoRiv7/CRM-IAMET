# Prueba de la generación AI de volumetría desde consola (sin UI).
# Uso:
#   python manage.py generar_volumetria_ai --vol 15 --dry-run
#   python manage.py generar_volumetria_ai --vol 15 --user diego
#
# --dry-run imprime la propuesta normalizada sin escribir en BD (para
# comparar contra la volumetría real y medir % de acierto).

import json

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Genera un borrador de volumetría con AI a partir de su levantamiento (Fases 1-2 + fotos).'

    def add_arguments(self, parser):
        parser.add_argument('--vol', type=int, required=True, help='ID de ProyectoVolumetria')
        parser.add_argument('--user', type=str, default='', help='Username que firma el borrador (default: primer superuser)')
        parser.add_argument('--model', type=str, default='', help='Override de modelo litellm')
        parser.add_argument('--dry-run', action='store_true', help='No escribe en BD; imprime la propuesta')

    def handle(self, *args, **opts):
        from app.volumetria_ai import generar_borrador_volumetria

        if opts['user']:
            user = User.objects.filter(username=opts['user']).first()
            if not user:
                raise CommandError(f"Usuario '{opts['user']}' no existe")
        else:
            user = User.objects.filter(is_superuser=True).order_by('id').first()
            if not user:
                raise CommandError('No hay superuser; pasa --user')

        self.stdout.write(f"Generando borrador para volumetría {opts['vol']} (dry_run={opts['dry_run']})…")
        resultado = generar_borrador_volumetria(
            opts['vol'], user,
            dry_run=opts['dry_run'],
            model=opts['model'] or None,
        )
        self.stdout.write(self.style.SUCCESS(f"Resumen del modelo: {resultado['resumen']}"))
        self.stdout.write(f"Stats: {resultado['stats']}")
        if opts['dry_run']:
            self.stdout.write(json.dumps(resultado['secciones'], ensure_ascii=False, indent=1))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"Borrador escrito en volumetría {resultado['volumetria_id']} — revisar en el wizard."))

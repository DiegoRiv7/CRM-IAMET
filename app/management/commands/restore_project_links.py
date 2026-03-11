"""
Restaura los vínculos OportunidadProyecto desde el JSON generado por export_project_links.

Uso:
    python manage.py restore_project_links
    python manage.py restore_project_links --input /ruta/links.json
"""

import json
import os
from django.core.management.base import BaseCommand
from app.models import OportunidadProyecto, TodoItem

DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    'project_links_backup.json'
)


class Command(BaseCommand):
    help = 'Restaura los vínculos proyecto-oportunidad desde el JSON de backup'

    def add_arguments(self, parser):
        parser.add_argument('--input', default=DEFAULT_PATH,
                            help='Ruta del archivo JSON de backup')
        parser.add_argument('--dry-run', action='store_true',
                            help='Solo muestra qué restauraría, sin guardar')

    def handle(self, *args, **options):
        input_path = options['input']
        dry_run = options['dry_run']

        if not os.path.exists(input_path):
            self.stdout.write(self.style.ERROR(f"Archivo no encontrado: {input_path}"))
            return

        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        links = data.get('links', [])
        self.stdout.write(f"Vínculos en backup: {len(links)}")
        if dry_run:
            self.stdout.write(self.style.WARNING("── DRY RUN ──\n"))

        # IDs de oportunidades disponibles en el sistema
        opp_ids = set(TodoItem.objects.values_list('id', flat=True))

        cnt_ok = cnt_skip_dup = cnt_skip_no_opp = 0

        for r in links:
            opp_id = r['oportunidad_id']
            bitrix_pid = str(r['bitrix_project_id'])

            if opp_id not in opp_ids:
                self.stdout.write(
                    f"  ⚠ Opp #{opp_id} no encontrada en sistema: {r['oportunidad_nombre'][:50]}"
                )
                cnt_skip_no_opp += 1
                continue

            if OportunidadProyecto.objects.filter(
                oportunidad_id=opp_id, bitrix_project_id=bitrix_pid
            ).exists():
                cnt_skip_dup += 1
                continue

            self.stdout.write(
                f"  ✓ Bitrix {bitrix_pid:>6} → Opp #{opp_id} {r['oportunidad_nombre'][:50]}"
            )
            if not dry_run:
                OportunidadProyecto.objects.create(
                    oportunidad_id=opp_id,
                    bitrix_project_id=bitrix_pid,
                )
            cnt_ok += 1

        self.stdout.write(f"\n✅ Restaurados   : {cnt_ok}")
        self.stdout.write(f"⏭  Ya existían   : {cnt_skip_dup}")
        self.stdout.write(f"⚠  Opp no hallada: {cnt_skip_no_opp}")
        if dry_run:
            self.stdout.write(self.style.WARNING("\n(DRY RUN: no se guardó nada)"))
        self.stdout.write("\n=== FIN ===")

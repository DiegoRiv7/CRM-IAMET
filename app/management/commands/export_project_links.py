"""
Exporta los vínculos OportunidadProyecto (proyectos Bitrix ↔ oportunidades)
a un archivo JSON para restaurarlos después de un reimport limpio.

Uso:
    python manage.py export_project_links
    python manage.py export_project_links --output /ruta/links.json
"""

import json
import os
from django.core.management.base import BaseCommand
from app.models import OportunidadProyecto

DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    'project_links_backup.json'
)


class Command(BaseCommand):
    help = 'Exporta los vínculos proyecto-oportunidad a JSON para restaurarlos luego'

    def add_arguments(self, parser):
        parser.add_argument('--output', default=DEFAULT_PATH,
                            help='Ruta del archivo JSON de salida')

    def handle(self, *args, **options):
        output_path = options['output']

        links = list(
            OportunidadProyecto.objects
            .exclude(bitrix_project_id=None)
            .exclude(bitrix_project_id='')
            .select_related('oportunidad')
            .values(
                'bitrix_project_id',
                'oportunidad_id',
                'oportunidad__oportunidad',
                'oportunidad__usuario__username',
            )
        )

        data = {
            'total': len(links),
            'links': [
                {
                    'bitrix_project_id': str(r['bitrix_project_id']),
                    'oportunidad_id': r['oportunidad_id'],
                    'oportunidad_nombre': r['oportunidad__oportunidad'],
                    'usuario': r['oportunidad__usuario__username'],
                }
                for r in links
            ]
        }

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        self.stdout.write(self.style.SUCCESS(
            f"✅ {len(links)} vínculos exportados → {output_path}"
        ))

        # Mostrar resumen en pantalla también
        self.stdout.write(f"\nPrimeros 10 vínculos guardados:")
        for r in data['links'][:10]:
            self.stdout.write(
                f"  Bitrix {r['bitrix_project_id']:>6} → Opp #{r['oportunidad_id']} {r['oportunidad_nombre'][:50]}"
            )
        if len(links) > 10:
            self.stdout.write(f"  ... y {len(links) - 10} más")
        self.stdout.write("\n=== FIN ===")

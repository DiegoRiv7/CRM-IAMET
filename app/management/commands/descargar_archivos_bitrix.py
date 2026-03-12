"""
Descarga los archivos de proyectos Bitrix24 al servidor local.
Solo procesa archivos que tienen bitrix_download_url pero NO tienen
archivo físico guardado (campo `archivo` vacío). Es seguro correr
varias veces — retoma donde se quedó.

Uso:
    python manage.py descargar_archivos_bitrix
    python manage.py descargar_archivos_bitrix --dry-run
    python manage.py descargar_archivos_bitrix --limit 20
    python manage.py descargar_archivos_bitrix --proyecto 1234
    python manage.py descargar_archivos_bitrix --delay 0.1
"""
import os
import time
import tempfile
import requests
from django.core.management.base import BaseCommand
from django.core.files import File
from app.models import ArchivoProyecto

CHUNK_SIZE = 1024 * 512  # 512 KB por chunk


class Command(BaseCommand):
    help = 'Descarga archivos de Bitrix24 al servidor (retomable)'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Muestra qué se descargaría sin descargar nada')
        parser.add_argument('--limit', type=int, default=0,
                            help='Procesar solo N archivos (0 = todos)')
        parser.add_argument('--delay', type=float, default=0.05,
                            help='Segundos de pausa entre descargas (default: 0.05)')
        parser.add_argument('--timeout', type=int, default=120,
                            help='Timeout por descarga en segundos (default: 120)')
        parser.add_argument('--proyecto', type=int, default=0,
                            help='Solo descargar archivos de este proyecto ID')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        limit = options['limit']
        delay = options['delay']
        timeout = options['timeout']
        proyecto_id = options['proyecto']

        if dry_run:
            self.stdout.write(self.style.WARNING('── DRY RUN ──\n'))

        qs = (
            ArchivoProyecto.objects
            .filter(archivo='')
            .exclude(bitrix_download_url='')
            .select_related('proyecto')
            .order_by('proyecto_id', 'id')
        )
        if proyecto_id:
            qs = qs.filter(proyecto_id=proyecto_id)
        if limit:
            qs = qs[:limit]

        total = qs.count()
        self.stdout.write(f'Archivos pendientes de descargar: {total}\n')

        if total == 0:
            self.stdout.write(self.style.SUCCESS('No hay nada que descargar.'))
            return

        if dry_run:
            from django.db.models import Count, Sum
            proyectos = (
                qs.values('proyecto__nombre')
                .annotate(n=Count('id'), mb=Sum('tamaño'))
                .order_by('-n')[:25]
            )
            self.stdout.write(f'{"Archivos":>8}  {"MB":>8}  Proyecto')
            self.stdout.write('-' * 60)
            for p in proyectos:
                mb = (p['mb'] or 0) / 1024 ** 2
                self.stdout.write(f'{p["n"]:>8}  {mb:>8.1f}  {(p["proyecto__nombre"] or "")[:50]}')
            if total > 25:
                self.stdout.write(f'  ... y {total - 25} proyectos más')
            return

        session = requests.Session()
        session.headers.update({'User-Agent': 'CRM-IAMET/1.0'})

        ok = err = 0
        err_log = []
        start = time.time()

        for i, archivo in enumerate(qs, 1):
            url = archivo.bitrix_download_url
            nombre = (archivo.nombre_original or f'archivo_{archivo.pk}').strip()
            # Sanitizar nombre para el sistema de archivos
            nombre = nombre.replace('/', '_').replace('\\', '_')

            try:
                response = session.get(url, timeout=timeout, stream=True)
                if response.status_code == 200:
                    # Escribir a archivo temporal, luego mover via Django storage
                    with tempfile.NamedTemporaryFile(delete=False) as tmp:
                        for chunk in response.iter_content(CHUNK_SIZE):
                            if chunk:
                                tmp.write(chunk)
                        tmp_path = tmp.name
                    with open(tmp_path, 'rb') as f:
                        archivo.archivo.save(nombre, File(f), save=True)
                    os.unlink(tmp_path)
                    ok += 1
                elif response.status_code == 404:
                    err_log.append(f'[404] ID {archivo.pk}  proyecto={archivo.proyecto_id}  {nombre}')
                    err += 1
                else:
                    err_log.append(
                        f'[HTTP {response.status_code}] ID {archivo.pk}  '
                        f'proyecto={archivo.proyecto_id}  {nombre}'
                    )
                    err += 1
            except requests.exceptions.Timeout:
                err_log.append(f'[TIMEOUT] ID {archivo.pk}  proyecto={archivo.proyecto_id}  {nombre}')
                err += 1
            except Exception as e:
                err_log.append(f'[ERROR] ID {archivo.pk}  proyecto={archivo.proyecto_id}  {nombre}  — {e}')
                err += 1

            if i % 100 == 0 or i == total:
                elapsed = time.time() - start
                rate = i / elapsed if elapsed > 0 else 1
                remaining = (total - i) / rate
                pct = 100 * i // total
                self.stdout.write(
                    f'  {i:>5}/{total} ({pct:>3}%)  '
                    f'OK:{ok}  ERR:{err}  '
                    f'{rate:.1f} arch/s  '
                    f'ETA: {int(remaining // 60)}m {int(remaining % 60)}s'
                )

            if delay:
                time.sleep(delay)

        elapsed_total = time.time() - start
        self.stdout.write(f'\n{"=" * 50}')
        self.stdout.write(self.style.SUCCESS(f'  Descargados : {ok}'))
        if err:
            self.stdout.write(self.style.WARNING(f'  Errores     : {err}'))
            log_path = '/tmp/bitrix_download_errors.txt'
            with open(log_path, 'w') as f:
                f.write('\n'.join(err_log))
            self.stdout.write(f'  Log errores : {log_path}')
        self.stdout.write(f'  Tiempo total: {int(elapsed_total // 60)}m {int(elapsed_total % 60)}s')
        self.stdout.write('=' * 50)

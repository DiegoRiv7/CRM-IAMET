"""
Comando para generar sugerencias de vinculos proyecto-oportunidad
basadas en similitud de nombres usando rapidfuzz.

Uso:
  python manage.py link_proyectos_oportunidades
  python manage.py link_proyectos_oportunidades --threshold 70
  python manage.py link_proyectos_oportunidades --dry-run
  python manage.py link_proyectos_oportunidades --reset   # borra sugerencias no confirmadas y regenera
"""
import re
import unicodedata
from django.core.management.base import BaseCommand
from rapidfuzz import fuzz


STOPWORDS = {
    'proyecto', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'con', 'para',
    'por', 'y', 'e', 'o', 'a', 'al', 'instalacion', 'instalaciones',
    'servicio', 'servicios', 'sistema', 'sistemas', 'mantenimiento',
    'implementacion', 'soporte', 'suministro', 'red', 'redes',
}

# Palabras que son muy genéricas en este dominio y no sirven como
# identificador de cliente (no se usan en la validación de cliente)
_PREFIJOS_NO_CLIENTE = {'bd', 'po', 'pv', 'eit', 'crm'}


def _limpiar(texto):
    """Quitar acentos, lowercase, solo alfanum+espacios."""
    if not texto:
        return ''
    nfkd = unicodedata.normalize('NFKD', texto)
    sin_acentos = ''.join(c for c in nfkd if not unicodedata.combining(c))
    lower = sin_acentos.lower()
    return ''.join(c if c.isalnum() or c == ' ' else ' ' for c in lower)


def _normalizar(texto):
    """Lowercase, remove accents, remove stopwords, collapse spaces."""
    limpio = _limpiar(texto)
    tokens = [t for t in limpio.split() if t not in STOPWORDS]
    return ' '.join(tokens)


def _extraer_cliente_proyecto(nombre):
    """
    Extrae los tokens identificadores del cliente desde el nombre del proyecto.
    Toma lo que aparece antes del primer 'PO', '//' o número largo (>= 5 dígitos).
    Ej: 'SKYWORKS PO ME3SFY0169 // CONTROL DE ACCESO' → {'skyworks'}
        'Allegion PO 8141486 // RETIRO DE CABLEADO'  → {'allegion'}
        'CUBIC Sistema de CCTV y Control de Acceso'   → {'cubic'}
    """
    limpio = _limpiar(nombre)
    # Cortar antes de 'po', '//' (ya convertido a espacio) o número largo
    parte = re.split(r'\bpo\b|\d{5,}', limpio)[0].strip()
    tokens = {t for t in parte.split() if len(t) >= 3 and t not in _PREFIJOS_NO_CLIENTE and t not in STOPWORDS}
    return tokens


class Command(BaseCommand):
    help = 'Genera sugerencias de vinculos proyecto-oportunidad usando rapidfuzz'

    def add_arguments(self, parser):
        parser.add_argument(
            '--threshold',
            type=int,
            default=65,
            help='Score minimo para considerar un match (default: 65)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Solo mostrar resultados sin guardar en la base de datos',
        )
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Eliminar sugerencias no confirmadas y no rechazadas antes de generar nuevas',
        )

    def handle(self, *args, **options):
        from app.models import Proyecto, TodoItem, ProyectoOportunidadLink

        threshold = options['threshold']
        dry_run = options['dry_run']
        reset = options['reset']

        if dry_run:
            self.stdout.write(self.style.WARNING('Modo DRY-RUN: no se guardaran cambios.'))

        # Reset sugerencias pendientes (no confirmadas, no rechazadas)
        if reset and not dry_run:
            deleted_count, _ = ProyectoOportunidadLink.objects.filter(
                confirmado=False,
                rechazado=False,
            ).delete()
            self.stdout.write(f'Reset: eliminadas {deleted_count} sugerencias pendientes.')

        proyectos = list(Proyecto.objects.filter(es_ingenieria=True))
        oportunidades = list(TodoItem.objects.select_related('cliente').all())

        self.stdout.write(f'Proyectos de ingenieria: {len(proyectos)}')
        self.stdout.write(f'Oportunidades: {len(oportunidades)}')
        self.stdout.write(f'Threshold: {threshold}')

        # Precompute normalized opp names — filtrar oportunidades con menos de 3 tokens
        # para evitar falsos positivos por nombres demasiado genéricos
        opps_norm = []
        opps_descartadas = 0
        for opp in oportunidades:
            norm = _normalizar(opp.oportunidad)
            if len(norm.split()) >= 3:
                nombre_cliente_norm = _limpiar(opp.cliente.nombre_empresa if opp.cliente else '')
                opps_norm.append((opp, norm, nombre_cliente_norm))
            else:
                opps_descartadas += 1

        if opps_descartadas:
            self.stdout.write(
                self.style.WARNING(f'Oportunidades omitidas (nombre muy generico, <3 tokens): {opps_descartadas}')
            )

        proyectos_procesados = 0
        sugerencias_creadas = 0
        ya_confirmados = 0
        filtrados_cliente = 0

        for proyecto in proyectos:
            norm_proyecto = _normalizar(proyecto.nombre)
            # Proyecto también debe tener al menos 2 tokens significativos
            if not norm_proyecto or len(norm_proyecto.split()) < 2:
                continue

            # Tokens de cliente extraídos del nombre del proyecto
            cliente_tokens = _extraer_cliente_proyecto(proyecto.nombre)

            matches = []
            for opp, norm_opp, nombre_cliente_norm in opps_norm:
                score = fuzz.token_set_ratio(norm_proyecto, norm_opp)
                if score >= threshold:
                    # Validar cliente: si el proyecto tiene tokens de cliente identificables,
                    # al menos uno debe aparecer en el nombre de la oportunidad o del cliente
                    if cliente_tokens:
                        opp_texto = norm_opp + ' ' + nombre_cliente_norm
                        if not any(tok in opp_texto for tok in cliente_tokens):
                            filtrados_cliente += 1
                            continue
                    matches.append((opp, score))

            # Keep top 3
            matches.sort(key=lambda x: x[1], reverse=True)
            matches = matches[:3]

            proyectos_procesados += 1

            for opp, score in matches:
                if dry_run:
                    self.stdout.write(
                        f'  [{score:.0f}%] {proyecto.nombre!r} <-> {opp.oportunidad!r}'
                    )
                    sugerencias_creadas += 1
                    continue

                # Skip if already confirmed or rejected
                existing = ProyectoOportunidadLink.objects.filter(
                    proyecto=proyecto,
                    oportunidad=opp,
                ).first()
                if existing and (existing.confirmado or existing.rechazado):
                    ya_confirmados += 1
                    continue

                _, created = ProyectoOportunidadLink.objects.update_or_create(
                    proyecto=proyecto,
                    oportunidad=opp,
                    defaults={'score': score},
                )
                if created:
                    sugerencias_creadas += 1

        self.stdout.write(self.style.SUCCESS(
            f'\nResumen:'
            f'\n  Proyectos procesados: {proyectos_procesados}'
            f'\n  Sugerencias {"que se crearian" if dry_run else "creadas"}: {sugerencias_creadas}'
            f'\n  Descartados por cliente distinto: {filtrados_cliente}'
            f'\n  Omitidos (ya confirmados/rechazados): {ya_confirmados}'
        ))

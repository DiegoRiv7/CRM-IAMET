"""
Dry-run: intenta vincular proyectos sin oportunidad usando 3 criterios:
  1. PO number  — extrae número PO del nombre del proyecto y la oportunidad
  2. Nombre     — compara nombres normalizados (sin acentos, mayúsculas, espacios extra)
  3. Cotización — busca IDs de cotización en archivos/tareas del proyecto y los
                  cruza con cotizaciones que ya tienen oportunidad asignada

Confianza asignada:
  PO match exacto          → 95 %
  Nombre exacto norm.      → 85 %
  Nombre parcial (≥ 70 %)  → 70 %
  Cotización drive/tarea   → 80 %

Uso:
    python manage.py match_proyectos_dry_run
    python manage.py match_proyectos_dry_run --min-conf 80
    python manage.py match_proyectos_dry_run --aplicar      ← APLICA los matches ≥ min-conf
"""
import re
import unicodedata
from django.core.management.base import BaseCommand
from app.models import (
    Proyecto, OportunidadProyecto, TodoItem,
    CarpetaProyecto, ArchivoProyecto, Tarea, Cotizacion,
)


# ── helpers ──────────────────────────────────────────────────────────────────

_RE_PO = re.compile(
    r'(?:^|[\s\-/])(?:PO|P\.O\.?)\s*[-#]?\s*(\d{5,})',
    re.IGNORECASE,
)
_RE_COT = re.compile(
    r'(?:COT|cot|cotizaci[oó]n)[-_\s#]*(\d{2,})',
    re.IGNORECASE,
)


def _po_numbers(text):
    """Retorna set de strings PO encontrados en el texto."""
    return {m.group(1) for m in _RE_PO.finditer(text or '')}


def _cot_ids(text):
    """Retorna set de ints de IDs de cotización encontrados en el texto."""
    ids = set()
    for m in _RE_COT.finditer(text or ''):
        try:
            ids.add(int(m.group(1)))
        except ValueError:
            pass
    return ids


def _normalizar(text):
    """Minúsculas, sin acentos, sin caracteres especiales, espacios simples."""
    text = unicodedata.normalize('NFKD', text or '')
    text = ''.join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r'[^a-z0-9\s]', ' ', text.lower())
    return re.sub(r'\s+', ' ', text).strip()


def _similitud(a, b):
    """Fracción de palabras de `a` que aparecen en `b` (simple, rápido)."""
    palabras_a = set(_normalizar(a).split())
    palabras_b = set(_normalizar(b).split())
    if not palabras_a:
        return 0.0
    comunes = palabras_a & palabras_b
    # Ignorar palabras muy cortas/genéricas
    _stop = {'de', 'la', 'el', 'en', 'y', 'a', 'por', 'para', 'con', 'del',
             'po', 'p', 'los', 'las', 'un', 'una', 'al'}
    comunes -= _stop
    palabras_a -= _stop
    if not palabras_a:
        return 0.0
    return len(comunes) / len(palabras_a)


# ── command ───────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Dry-run: busca oportunidades para proyectos sin vincular'

    def add_arguments(self, parser):
        parser.add_argument('--min-conf', type=int, default=0,
                            help='Mostrar solo matches con confianza >= N (default: todos)')
        parser.add_argument('--aplicar', action='store_true',
                            help='APLICA los vínculos (solo los que superen --min-conf)')

    def handle(self, *args, **options):
        min_conf = options['min_conf']
        aplicar = options['aplicar']

        if aplicar:
            self.stdout.write(self.style.ERROR(
                '⚠  MODO APLICAR — se guardarán los vínculos >= {}%\n'.format(min_conf or 0)
            ))
        else:
            self.stdout.write(self.style.WARNING('── DRY RUN (sin cambios) ──\n'))

        # ── 1. Construir conjunto de proyectos ya vinculados ──────────────────
        vinculados_ids = set()
        for bid in OportunidadProyecto.objects.values_list('bitrix_project_id', flat=True):
            try:
                vinculados_ids.add(int(bid))
            except (ValueError, TypeError):
                pass

        # ── 2. Proyectos sin vincular con drive ───────────────────────────────
        con_carpeta = set(CarpetaProyecto.objects.values_list('proyecto_id', flat=True).distinct())
        con_archivo = set(ArchivoProyecto.objects.values_list('proyecto_id', flat=True).distinct())
        con_drive_ids = con_carpeta | con_archivo

        proyectos = list(
            Proyecto.objects.filter(id__in=con_drive_ids)
            .exclude(bitrix_group_id__in=vinculados_ids)
            .order_by('nombre')
        )

        # ── 3. Precalcular índices de oportunidades ───────────────────────────
        # índice PO → lista de oportunidades
        po_index = {}
        # índice nombre normalizado → oportunidad
        nombre_index = {}
        all_opps = list(TodoItem.objects.select_related('cliente').all())
        for opp in all_opps:
            for po in _po_numbers(opp.oportunidad):
                po_index.setdefault(po, []).append(opp)
            nombre_index[_normalizar(opp.oportunidad)] = opp

        # índice cotización ID → oportunidad (solo las que YA tienen opp asignada)
        cot_index = {
            c.id: c.oportunidad
            for c in Cotizacion.objects.filter(oportunidad__isnull=False).select_related('oportunidad')
        }

        # ── 4. Iterar proyectos y buscar match ────────────────────────────────
        results = []  # (confianza, criterio, proyecto, oportunidad, detalle)

        for proy in proyectos:
            best = None  # (conf, criterio, opp, detalle)

            nombre_proy = proy.nombre or ''

            # ── Criterio 1: PO ────────────────────────────────────────────────
            pos_proy = _po_numbers(nombre_proy)
            for po in pos_proy:
                candidatos = po_index.get(po, [])
                if len(candidatos) == 1:
                    opp = candidatos[0]
                    conf = 95
                    if not best or conf > best[0]:
                        best = (conf, 'PO', opp, f'PO {po}')
                elif len(candidatos) > 1:
                    # múltiples oportunidades con el mismo PO → baja confianza
                    opp = candidatos[0]
                    conf = 60
                    if not best or conf > best[0]:
                        best = (conf, 'PO-multi', opp,
                                f'PO {po} ({len(candidatos)} opps)')

            # ── Criterio 2: Nombre normalizado ───────────────────────────────
            norm_proy = _normalizar(nombre_proy)
            if norm_proy in nombre_index:
                opp = nombre_index[norm_proy]
                conf = 85
                if not best or conf > best[0]:
                    best = (conf, 'NOMBRE', opp, 'match exacto')
            else:
                # similitud parcial
                mejor_sim = 0.0
                mejor_opp = None
                for norm_opp, opp in nombre_index.items():
                    sim = _similitud(nombre_proy, opp.oportunidad)
                    if sim > mejor_sim:
                        mejor_sim = sim
                        mejor_opp = opp
                if mejor_sim >= 0.70:
                    conf = int(mejor_sim * 85)
                    if not best or conf > best[0]:
                        best = (conf, 'NOMBRE~', mejor_opp,
                                f'similitud {int(mejor_sim*100)}%')

            # ── Criterio 3: Cotización ────────────────────────────────────────
            # 3a. IDs en nombres de archivos del drive
            archivos = ArchivoProyecto.objects.filter(proyecto=proy).values_list('nombre_original', flat=True)
            cot_ids_drive = set()
            for nombre_a in archivos:
                cot_ids_drive |= _cot_ids(nombre_a)

            # 3b. IDs en títulos/descripciones de tareas del proyecto
            tareas = Tarea.objects.filter(proyecto=proy)
            cot_ids_tareas = set()
            for t in tareas:
                cot_ids_tareas |= _cot_ids(t.titulo)
                cot_ids_tareas |= _cot_ids(t.descripcion or '')

            for cid in (cot_ids_drive | cot_ids_tareas):
                opp = cot_index.get(cid)
                if opp:
                    fuente = 'drive' if cid in cot_ids_drive else 'tarea'
                    conf = 80
                    if not best or conf > best[0]:
                        best = (conf, 'COT', opp, f'Cotizacion #{cid} ({fuente})')

            if best:
                results.append((best[0], best[1], proy, best[2], best[3]))

        # ── 5. Imprimir resultados ─────────────────────────────────────────────
        resultados_filtrados = [r for r in results if r[0] >= (min_conf or 0)]
        resultados_filtrados.sort(key=lambda x: -x[0])

        if resultados_filtrados:
            self.stdout.write(f'{"CONF":>5}  {"CRITERIO":<9}  {"PROYECTO (ID-Bitrix)":<55}  {"OPORTUNIDAD":<50}  DETALLE')
            self.stdout.write('─' * 160)
            for conf, criterio, proy, opp, detalle in resultados_filtrados:
                color = self.style.SUCCESS if conf >= 85 else (
                    self.style.WARNING if conf >= 70 else self.style.ERROR)
                self.stdout.write(color(
                    f'{conf:>4}%  [{criterio:<7}]  '
                    f'[{proy.bitrix_group_id}] {proy.nombre[:52]:<52}  '
                    f'Opp #{opp.id:<5} {str(opp.oportunidad)[:47]:<47}  {detalle}'
                ))

        # ── 6. Resumen ────────────────────────────────────────────────────────
        total_proyectos = len(proyectos)
        total_match = len(results)
        gt90 = sum(1 for r in results if r[0] >= 90)
        entre80_89 = sum(1 for r in results if 80 <= r[0] < 90)
        lt80 = sum(1 for r in results if r[0] < 80)
        sin_match = total_proyectos - total_match

        self.stdout.write(f'\n{"="*55}')
        self.stdout.write(f'  Proyectos sin vincular evaluados : {total_proyectos}')
        self.stdout.write(self.style.SUCCESS(
            f'  Match >= 90% (alta confianza)    : {gt90}'))
        self.stdout.write(self.style.WARNING(
            f'  Match 80-89%                     : {entre80_89}'))
        self.stdout.write(
            f'  Match < 80%                      : {lt80}')
        self.stdout.write(self.style.ERROR(
            f'  Sin match encontrado             : {sin_match}'))
        self.stdout.write(f'{"="*55}')

        # ── 7. Aplicar si se pidió ────────────────────────────────────────────
        if aplicar:
            aplicados = 0
            for conf, criterio, proy, opp, detalle in results:
                if conf >= (min_conf or 0) and proy.bitrix_group_id:
                    OportunidadProyecto.objects.get_or_create(
                        bitrix_project_id=str(proy.bitrix_group_id),
                        oportunidad=opp,
                    )
                    aplicados += 1
            self.stdout.write(self.style.SUCCESS(
                f'\n✅ Vínculos creados: {aplicados}'))
        else:
            self.stdout.write(self.style.WARNING(
                '\n(DRY RUN: usa --aplicar --min-conf 85 para guardar los matches confiables)'))

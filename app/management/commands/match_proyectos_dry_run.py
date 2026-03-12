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
# Números largos sin prefijo (6+ dígitos) que sirven como identificadores únicos
_RE_NUM_ID = re.compile(r'(?<!\d)(\d{6,})(?!\d)')
_RE_COT = re.compile(
    r'(?:COT|cot|cotizaci[oó]n)[-_\s#]*(\d{2,})',
    re.IGNORECASE,
)


def _po_numbers(text):
    """Retorna set de strings de números identificadores encontrados en el texto.
    Incluye POs con prefijo y números largos (6+ dígitos) sin prefijo."""
    nums = {m.group(1) for m in _RE_PO.finditer(text or '')}
    nums |= {m.group(1) for m in _RE_NUM_ID.finditer(text or '')}
    return nums


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


_STOP = {'de', 'la', 'el', 'en', 'y', 'a', 'por', 'para', 'con', 'del',
         'po', 'p', 'los', 'las', 'un', 'una', 'al', 'se', 'su', 'que'}


def _similitud(a, b):
    """Similitud bidireccional: toma el máximo de A→B y B→A (ignora stop words).
    Además detecta si uno contiene al otro casi completo (substring semántico)."""
    na, nb = _normalizar(a), _normalizar(b)

    # substring check: si uno contiene al otro casi completo
    if na and nb:
        corto, largo = (na, nb) if len(na) <= len(nb) else (nb, na)
        if corto in largo and len(corto) >= 8:
            return 0.97  # prácticamente contenido

    pa = set(na.split()) - _STOP
    pb = set(nb.split()) - _STOP
    if not pa or not pb:
        return 0.0
    comunes = pa & pb
    sim_ab = len(comunes) / len(pa)   # cuánto de A está en B
    sim_ba = len(comunes) / len(pb)   # cuánto de B está en A
    # Jaccard + máximo direccional para no penalizar nombres con palabras extra
    jaccard = len(comunes) / len(pa | pb)
    return max(sim_ab, sim_ba, jaccard)


# ── command ───────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Dry-run: busca oportunidades para proyectos sin vincular'

    def add_arguments(self, parser):
        parser.add_argument('--min-conf', type=int, default=0,
                            help='Mostrar solo matches con confianza >= N (default: todos)')
        parser.add_argument('--aplicar', action='store_true',
                            help='APLICA los vínculos (solo los que superen --min-conf)')
        parser.add_argument('--urgentes', action='store_true',
                            help='Solo proyectos con tareas abiertas sin oportunidad vinculada')

    def handle(self, *args, **options):
        min_conf = options['min_conf']
        aplicar = options['aplicar']
        solo_urgentes = options['urgentes']

        if aplicar:
            self.stdout.write(self.style.ERROR(
                '⚠  MODO APLICAR — se guardarán los vínculos >= {}%\n'.format(min_conf or 0)
            ))
        else:
            modo = 'URGENTES — proyectos con tareas abiertas sin opp' if solo_urgentes else 'DRY RUN (sin cambios)'
            self.stdout.write(self.style.WARNING(f'── {modo} ──\n'))

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

        # Si --urgentes: restringir a proyectos con tareas abiertas sin opp
        if solo_urgentes:
            estados_abiertos = ('pendiente', 'iniciada', 'en_progreso')
            proy_con_tarea_abierta = set(
                Tarea.objects.filter(
                    estado__in=estados_abiertos,
                    oportunidad__isnull=True,
                    proyecto__isnull=False,
                ).values_list('proyecto_id', flat=True).distinct()
            )
            con_drive_ids = con_drive_ids & proy_con_tarea_abierta

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

            # ── Criterio 1: PO / número identificador ────────────────────────
            pos_proy = _po_numbers(nombre_proy)
            for po in pos_proy:
                candidatos = po_index.get(po, [])
                if len(candidatos) == 1:
                    opp = candidatos[0]
                    conf = 95
                    if not best or conf > best[0]:
                        best = (conf, 'PO', opp, f'num {po}')
                elif len(candidatos) > 1:
                    # múltiples candidatos: elegir el de mayor similitud de nombre
                    mejor_opp = max(candidatos,
                                    key=lambda o: _similitud(nombre_proy, o.oportunidad))
                    sim = _similitud(nombre_proy, mejor_opp.oportunidad)
                    if sim >= 0.70:
                        conf = 90
                        criterio = 'PO+NOM'
                    else:
                        conf = 60
                        criterio = 'PO-multi'
                    if not best or conf > best[0]:
                        best = (conf, criterio, mejor_opp,
                                f'num {po} + sim {int(sim*100)}%')

            # ── Criterio 2: Nombre normalizado ───────────────────────────────
            norm_proy = _normalizar(nombre_proy)
            if norm_proy in nombre_index:
                opp = nombre_index[norm_proy]
                conf = 90
                if not best or conf > best[0]:
                    best = (conf, 'NOMBRE', opp, 'match exacto')
            else:
                # similitud bidireccional
                mejor_sim = 0.0
                mejor_opp = None
                for norm_opp, opp in nombre_index.items():
                    sim = _similitud(nombre_proy, opp.oportunidad)
                    if sim > mejor_sim:
                        mejor_sim = sim
                        mejor_opp = opp
                if mejor_sim >= 0.70:
                    # escala: 70%sim→72conf, 80%→80, 90%→87, 97%→93
                    conf = int(72 + (mejor_sim - 0.70) / 0.30 * 21)
                    conf = min(conf, 93)
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
                    conf = 100  # cotización confirma el vínculo sin duda
                    if not best or conf > best[0]:
                        best = (conf, 'COT', opp, f'Cotizacion #{cid} ({fuente})')

            # ── Bonus: responsable de opp == creador/miembro del proyecto ─────
            if best and best[0] < 100:
                opp_best = best[2]
                bonus = 0
                nota_bonus = ''
                if opp_best.usuario_id == proy.creado_por_id:
                    bonus = 7
                    nota_bonus = ' +mismo_responsable'
                elif proy.miembros.filter(id=opp_best.usuario_id).exists():
                    bonus = 4
                    nota_bonus = ' +responsable_es_miembro'
                if bonus:
                    nueva_conf = min(best[0] + bonus, 97)
                    best = (nueva_conf, best[1], best[2], best[3] + nota_bonus)

            if best:
                results.append((best[0], best[1], proy, best[2], best[3]))

        # ── 5. Detectar proyectos que comparten oportunidad ──────────────────
        from collections import defaultdict
        opp_a_proyectos = defaultdict(list)
        for conf, criterio, proy, opp, detalle in results:
            opp_a_proyectos[opp.id].append((conf, criterio, proy, detalle))

        # Construir mapa proy_id → (nota, es_ambiguo)
        comparte_info = {}  # proy_id → (nota_str, es_ambiguo)
        for opp_id, grupo in opp_a_proyectos.items():
            n = len(grupo)
            if n <= 1:
                continue
            es_ambiguo = n >= 3  # máximo 2 proyectos por opp → si hay 3+ es genérico
            for i, (conf, criterio, proy, detalle) in enumerate(grupo):
                otros = [g[2] for j, g in enumerate(grupo) if j != i]
                if len(otros) <= 2:
                    nombres = ', '.join(f'[{o.bitrix_group_id}] {o.nombre[:20]}' for o in otros)
                else:
                    primeros = ', '.join(f'[{o.bitrix_group_id}] {o.nombre[:15]}' for o in otros[:2])
                    nombres = f'{primeros} (y {len(otros)-2} más)'
                if es_ambiguo:
                    nota = f' | ⚠ AMBIGUO: opp genérica compartida con {n-1} proyectos'
                else:
                    nota = f' | comparte opp con: {nombres}'
                comparte_info[proy.id] = (nota, es_ambiguo)

        # Aplicar penalización de confianza a los ambiguos
        results_final = []
        for conf, criterio, proy, opp, detalle in results:
            info = comparte_info.get(proy.id)
            if info and info[1]:  # es_ambiguo
                conf = min(conf, 55)
                criterio = 'AMBIGUO'
            results_final.append((conf, criterio, proy, opp, detalle))
        results = results_final

        # ── 6. Imprimir resultados ─────────────────────────────────────────────
        resultados_filtrados = [r for r in results if r[0] >= (min_conf or 0)]
        resultados_filtrados.sort(key=lambda x: -x[0])

        n_comparte = sum(1 for _, _, proy, _, _ in results
                         if proy.id in comparte_info and not comparte_info[proy.id][1])
        n_ambiguo = sum(1 for _, _, proy, _, _ in results
                        if proy.id in comparte_info and comparte_info[proy.id][1])

        if resultados_filtrados:
            self.stdout.write(f'{"CONF":>5}  {"CRITERIO":<9}  {"PROYECTO (ID-Bitrix)":<55}  {"OPORTUNIDAD":<50}  DETALLE')
            self.stdout.write('─' * 170)
            for conf, criterio, proy, opp, detalle in resultados_filtrados:
                color = self.style.SUCCESS if conf >= 85 else (
                    self.style.WARNING if conf >= 70 else self.style.ERROR)
                nota = comparte_info.get(proy.id, ('', False))[0]
                tareas_info = ''
                if solo_urgentes:
                    n_tareas = Tarea.objects.filter(
                        proyecto=proy, estado__in=('pendiente', 'iniciada', 'en_progreso'),
                        oportunidad__isnull=True,
                    ).count()
                    tareas_info = f' [{n_tareas} tarea(s) abierta(s)]'
                self.stdout.write(color(
                    f'{conf:>4}%  [{criterio:<7}]  '
                    f'[{proy.bitrix_group_id}] {proy.nombre[:52]:<52}  '
                    f'Opp #{opp.id:<5} {str(opp.oportunidad)[:47]:<47}  {detalle}{nota}{tareas_info}'
                ))

        # ── 7. Resumen ────────────────────────────────────────────────────────
        total_proyectos = len(proyectos)
        total_match = len(results)
        gt90 = sum(1 for r in results if r[0] >= 90)
        entre80_89 = sum(1 for r in results if 80 <= r[0] < 90)
        lt80 = sum(1 for r in results if r[0] < 80)
        sin_match = total_proyectos - total_match

        self.stdout.write(f'\n{"="*60}')
        self.stdout.write(f'  Proyectos sin vincular evaluados  : {total_proyectos}')
        self.stdout.write(self.style.SUCCESS(
            f'  Match >= 90% (alta confianza)     : {gt90}'))
        self.stdout.write(self.style.WARNING(
            f'  Match 80-89%                      : {entre80_89}'))
        self.stdout.write(
            f'  Match < 80%                       : {lt80}')
        self.stdout.write(self.style.ERROR(
            f'  Sin match encontrado              : {sin_match}'))
        if n_comparte:
            self.stdout.write(self.style.WARNING(
                f'  Comparten opp (exactamente 2)     : {n_comparte} (drives se fusionarán)'))
        if n_ambiguo:
            self.stdout.write(self.style.ERROR(
                f'  AMBIGUOS (opp genérica, 3+ proy.) : {n_ambiguo} (revisar manualmente)'))
        self.stdout.write(f'{"="*60}')

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

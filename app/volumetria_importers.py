"""Importadores de volumetría desde Excel — sistema de perfiles.

Cada perfil sabe cómo detectar (con un score) y parsear un layout de Excel
distinto. El registry los expone y el endpoint elige el perfil con score
más alto. Para añadir soporte a un formato nuevo:

    1. Crear una clase que herede de `BaseProfile` e implemente `detect`
       y `parse`.
    2. Registrarla en `PROFILES`.
    3. (Opcional) Documentar el formato en el docstring de la clase.

Para perfiles que usan fórmulas (v2 Jacuzzi), abrir el workbook DOS veces:
una con data_only=True (valores) y otra con data_only=False (fórmulas
literales). Esto permite leer los rangos de los subtotales para saber
qué filas el Excel SÍ cuenta y cuáles excluye manualmente, y detectar
el % de IVA hardcodeado en la fórmula del análisis.

Output común de `parse(ws, ws_formulas=None)` -> dict con:
    {
      'meta':      {cliente, contacto, elaboro, fecha, tipo_cambio,
                    iva_pct (opcional)},
      'eq_items':  [...],   # equipamiento (con headers inline)
      'mo_items':  [...],   # mano de obra
      'cmo_items': [...],   # costos adicionales (CMO interno)
    }
"""
from __future__ import annotations

import re
import uuid as _uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation


# ── Helpers compartidos ─────────────────────────────────────────

def _dec(val, default=Decimal('0')):
    if val is None or val == '':
        return default
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError):
        return default


def _vol_uuid():
    return str(_uuid.uuid4())


def _excel_iso_date(val):
    if val is None or val == '':
        return ''
    try:
        if isinstance(val, datetime):
            return val.date().isoformat()
        if isinstance(val, date):
            return val.isoformat()
        return str(val).strip()[:10]
    except Exception:
        return ''


def _str(v):
    return str(v).strip() if v is not None else ''


# ── Base de los perfiles ────────────────────────────────────────

class BaseProfile:
    """Subclasea esto para añadir un formato. La idea es que `detect`
    sea barato (solo escanea unas cuantas celdas) y devuelva un score
    0-100; el endpoint elige el más alto."""

    id: str = ''
    name: str = ''

    def detect(self, ws) -> int:
        """Devuelve un score 0..100 indicando qué tan bien matchea
        este perfil al worksheet. 0 = no matchea, 100 = match perfecto."""
        raise NotImplementedError

    def parse(self, ws, ws_formulas=None) -> dict:
        """Devuelve {meta, eq_items, mo_items, cmo_items}.
        `ws_formulas` es opcional: el mismo sheet pero con `data_only=False`
        para que perfiles que necesiten leer fórmulas puedan hacerlo."""
        raise NotImplementedError


# ── Helpers comunes a los perfiles IAMET ────────────────────────

_TIPO_CAMBIO_RE = re.compile(r'\d+(?:\.\d+)?')


def _resolver_tipo_cambio(ws):
    """Estrategia compartida: mira L3 (col 12, row 3) primero; fallback a
    parsear la celda I4 (col 9, row 4) buscando un número junto a 'Dolar*'.
    """
    try:
        v_l3 = ws.cell(3, 12).value
        if v_l3 not in (None, ''):
            tc = _dec(v_l3)
            if Decimal('0.0001') < tc < Decimal('100'):
                return tc
    except Exception:
        pass
    try:
        cell_i4 = str(ws.cell(4, 9).value or '')
        if 'dolar' in cell_i4.lower():
            m = _TIPO_CAMBIO_RE.search(
                cell_i4.replace('Dolares', '').replace('dolares', '')
            )
            if m:
                tc = _dec(m.group())
                if Decimal('0.0001') < tc < Decimal('100'):
                    return tc
    except Exception:
        pass
    return Decimal('0')


# Items "skip rules" — filas plantilla con descuentos default y vacías.
def _es_fila_plantilla_vacia(ca, cb, cc, cd, precio_lista, costo_unit, cantidad):
    """True si la fila es solo una fila plantilla del Excel maestro
    (descuentos default 0/0.3, sin marca/parte/cantidad)."""
    return (
        cantidad == Decimal('0')
        and precio_lista == Decimal('0')
        and costo_unit == Decimal('0')
        and not ca and not cb
    )


def _emit_eq_header(items, texto):
    items.append({'id': _vol_uuid(), 'row_type': 'header', 'texto': texto})


def _emit_eq_item(items, ws, r, *, marca, parte, descripcion, force_zero_cost=False):
    """Crea un item de equipamiento estándar. Toma los valores de las
    columnas fijas E/F/I/J/L/M y los normaliza al schema v4.

    Si `force_zero_cost=True`, marca el item con costoUnitario=0 ignorando
    lo que diga el Excel. Esto sirve para items que el Excel incluye en
    venta pero excluye en costo (ej. rangos SUM(H...) ≠ SUM(K...))."""
    col_e = ws.cell(r, 5).value   # Precio Lista
    col_f = ws.cell(r, 6).value   # Desc venta (decimal 0-1)
    col_i = ws.cell(r, 9).value   # Desc costo (decimal 0-1)
    col_j = ws.cell(r, 10).value  # Costo Unitario
    col_l = ws.cell(r, 12).value  # Proveedor
    col_m = ws.cell(r, 13).value  # Entrega

    cantidad = _dec(ws.cell(r, 3).value)
    precio_lista = _dec(col_e)
    desc_venta_dec = _dec(col_f)
    desc_costo_dec = _dec(col_i)
    costo_unit = _dec(col_j)

    # costoUnitario v4:
    #   - force_zero_cost → 0 explícito (excluido del subtotal de costo).
    #   - costo > 0 → guarda tal cual.
    #   - costo == 0 PERO descCosto > 0 → null (frontend lo deriva).
    #   - ambos en 0 → 0 explícito (item de pura ganancia).
    if force_zero_cost:
        costo_v4 = 0.0
    elif costo_unit > 0:
        costo_v4 = float(costo_unit)
    elif desc_costo_dec > 0:
        costo_v4 = None
    else:
        costo_v4 = 0.0

    items.append({
        'id': _vol_uuid(),
        'row_type': 'item',
        'marca': marca,
        'parte': parte,
        'cantidad': float(cantidad),
        'descripcion': descripcion,
        'precioLista': float(precio_lista),
        'descuentoVenta': float((desc_venta_dec * Decimal('100')).quantize(Decimal('0.01'))),
        'descuentoCosto': float((desc_costo_dec * Decimal('100')).quantize(Decimal('0.01'))),
        'costoUnitario': costo_v4,
        'proveedor': _str(col_l),
        'entrega': _str(col_m),
        'notas': '',
    })


# ════════════════════════════════════════════════════════════════
# PERFIL 1 — IAMET / BAJANET clásico (con marcadores explícitos)
# ════════════════════════════════════════════════════════════════
class IametV1Marcadores(BaseProfile):
    """Layout original con labels de cierre por bloque:
       - "TOTAL MATERIALES:" cierra equipamiento.
       - "TOTAL MANO DE OBRA:" cierra mano de obra.
       - "COSTO MANO DE OBRA:" cierra costo MO interno.

    Cabecera estándar:
       A1 cliente label / C1 valor cliente / D1 contacto label / F1 contacto valor
       L2 fecha; F2 elaboró; L3 tipo de cambio.

    Sub-rótulos: col A en mayúsculas (sin marca/parte/cantidad/precio) o
    col D con texto descriptivo (sin marca/parte/cantidad).
    """
    id = 'iamet_v1_marcadores'
    name = 'IAMET / Bajanet (con marcadores)'

    def detect(self, ws):
        score = 0
        max_r = min(ws.max_row, 80)
        for r in range(1, max_r + 1):
            ca = _str(ws.cell(r, 1).value).lower()
            cd = _str(ws.cell(r, 4).value).lower()
            if 'total materiales' in ca or 'total materiales' in cd:
                score += 35
            if 'total mano de obra' in ca or 'total mano de obra' in cd:
                score += 35
            if 'costo mano de obra' in ca or 'costo mano de obra' in cd:
                score += 30
            if score >= 95:
                break
        return min(score, 100)

    def parse(self, ws, ws_formulas=None):
        # v1 no usa ws_formulas; tiene markers explícitos.
        # ── PASS 1: pre-scan de filas-marcador ─────────────────
        total_mo_row = None
        costo_mo_row = None
        cmo_header_row = None
        mo_header_row = None
        mo_section_start_row = None
        analisis_row = None
        for r in range(1, ws.max_row + 1):
            ca = _str(ws.cell(r, 1).value).lower()
            cd = _str(ws.cell(r, 4).value).lower()
            ce = _str(ws.cell(r, 5).value).lower()
            if 'total mano de obra' in ca or 'total mano de obra' in cd:
                total_mo_row = r
            if 'costo mano de obra' in ca or 'costo mano de obra' in cd:
                costo_mo_row = r
            if cd in ('descripcion', 'descripción') and ce in ('costo unit', 'costo unitario'):
                cmo_header_row = r
            if ca == 'mano de obra' and mo_section_start_row is None:
                mo_section_start_row = r
            if (ca == 'marca' and cd in ('descripcion', 'descripción')
                    and mo_header_row is None and mo_section_start_row
                    and r > mo_section_start_row):
                mo_header_row = r
            if 'analisis de costos' in ca or 'análisis de costos' in ca:
                analisis_row = r

        meta = {
            'cliente':  _str(ws.cell(1, 3).value),
            'contacto': _str(ws.cell(1, 6).value),
            'elaboro':  _str(ws.cell(2, 6).value),
            'fecha':    _excel_iso_date(ws.cell(2, 12).value),
            'tipo_cambio': _resolver_tipo_cambio(ws),
        }

        eq_items, mo_items, cmo_items = [], [], []
        eq_summary_kw = ('total materiales', 'total de materiales')

        # ── EQUIPAMIENTO ───────────────────────────────────────
        eq_end = mo_section_start_row or total_mo_row or cmo_header_row or analisis_row or (ws.max_row + 1)
        for r in range(6, eq_end):
            self._parse_eq_row(ws, r, eq_items, eq_summary_kw)

        # ── MANO DE OBRA ───────────────────────────────────────
        if mo_header_row and total_mo_row and total_mo_row > mo_header_row:
            for r in range(mo_header_row + 1, total_mo_row):
                self._parse_mo_row(ws, r, mo_items)

        # ── COSTO MO INTERNO ──────────────────────────────────
        if cmo_header_row and costo_mo_row and costo_mo_row > cmo_header_row:
            for r in range(cmo_header_row + 1, costo_mo_row):
                self._parse_cmo_row(ws, r, cmo_items)

        return {
            'meta': meta,
            'eq_items': eq_items,
            'mo_items': mo_items,
            'cmo_items': cmo_items,
        }

    # ── Helpers de fila (compartidos entre v1 y v2 vía herencia) ─
    def _parse_eq_row(self, ws, r, eq_items, summary_kw=(), force_zero_cost=False):
        col_a = ws.cell(r, 1).value
        col_b = ws.cell(r, 2).value
        col_c = ws.cell(r, 3).value
        col_d = ws.cell(r, 4).value
        col_e = ws.cell(r, 5).value

        ca_str = _str(col_a)
        cb_str = _str(col_b)
        cd_str = _str(col_d)
        ca_low = ca_str.lower()
        cd_low = cd_str.lower()

        # Skip totales / fila completamente vacía
        if not ca_str and not cd_str and not col_b and not col_c:
            return
        for kw in summary_kw:
            if kw in ca_low or kw in cd_low:
                return

        # Fila de totales numérica (Jacuzzi style): col A/B/D vacíos, col H tiene total.
        # En v1 esto no pasa (siempre hay label), pero el helper lo soporta por extensión.
        col_h = ws.cell(r, 8).value
        if (not ca_str and not cb_str and not cd_str and not col_c
                and col_h not in (None, '') and _dec(col_h) > 0):
            return

        # Header de tabla (la fila "Marca | Descripcion | ..."): skip.
        if ca_low == 'marca' and cd_low in ('descripcion', 'descripción', ''):
            return

        # Sub-rótulo tipo 1: col A texto, sin marca de producto.
        is_subrotulo_a = (
            ca_str and not col_b and not col_c
            and (col_e is None or col_e == '')
        )
        if is_subrotulo_a:
            _emit_eq_header(eq_items, ca_str)
            return

        # Sub-rótulo tipo 2: col D con texto descriptivo, sin marca/parte/cantidad.
        is_subrotulo_d = (
            cd_str and not col_a and not col_b
            and (col_c is None or col_c == '' or _dec(col_c) == 0
                 and (col_e is None or col_e == ''))
        )
        if is_subrotulo_d:
            _emit_eq_header(eq_items, cd_str)
            return

        # Sub-rótulo tipo 3 (Jacuzzi): col B con texto y col A vacío,
        # típicamente "FIBRA", "MATERIALES", "ELEVACIÓN" — lo trato igual
        # que rótulo. Solo si col C/D están vacíos para no comerme un item
        # que tiene "no_parte" en col B.
        is_subrotulo_b = (
            cb_str and not col_a
            and (col_c is None or col_c == '' or _dec(col_c) == 0)
            and not col_d
            and (col_e is None or col_e == '')
        )
        if is_subrotulo_b:
            _emit_eq_header(eq_items, cb_str)
            return

        # Item normal: requiere descripción
        if not cd_str:
            return

        cantidad = _dec(col_c)
        precio_lista = _dec(col_e)
        costo_unit = _dec(ws.cell(r, 10).value)
        if _es_fila_plantilla_vacia(ca_str, cb_str, col_c, col_d,
                                    precio_lista, costo_unit, cantidad):
            return

        _emit_eq_item(
            eq_items, ws, r,
            marca=ca_str, parte=cb_str, descripcion=cd_str,
            force_zero_cost=force_zero_cost,
        )

    def _parse_mo_row(self, ws, r, mo_items):
        col_a = ws.cell(r, 1).value
        col_b = ws.cell(r, 2).value
        col_c = ws.cell(r, 3).value
        col_d = ws.cell(r, 4).value
        col_e = ws.cell(r, 5).value
        col_f = ws.cell(r, 6).value
        col_i = ws.cell(r, 9).value  # Notas

        ca_str = _str(col_a)
        cd_str = _str(col_d)
        if not cd_str:
            return
        cantidad = _dec(col_c)
        precio_lista = _dec(col_e)
        if cantidad == 0 and precio_lista == 0 and not ca_str:
            return

        desc_venta_dec = _dec(col_f)
        mo_items.append({
            'id': _vol_uuid(),
            'marca': ca_str or 'BAJANET',
            'parte': _str(col_b) or 'SERVICIOS PROFESIONALES',
            'cantidad': float(cantidad),
            'descripcion': cd_str,
            'precioLista': float(precio_lista),
            'descuentoVenta': float((desc_venta_dec * Decimal('100')).quantize(Decimal('0.01'))),
            'notas': _str(col_i),
        })

    def _parse_cmo_row(self, ws, r, cmo_items):
        col_c = ws.cell(r, 3).value
        col_d = ws.cell(r, 4).value
        col_e = ws.cell(r, 5).value
        col_i = ws.cell(r, 9).value

        cd_str = _str(col_d)
        if not cd_str:
            return
        cantidad = _dec(col_c)
        costo_unit = _dec(col_e)
        dias = _dec(col_i, default=Decimal('1'))
        if cantidad == 0 and costo_unit == 0:
            return

        cmo_items.append({
            'id': _vol_uuid(),
            'descripcion': cd_str,
            'cantidad': float(cantidad),
            'costoUnitario': float(costo_unit),
            'dias': float(dias) if dias > 0 else 1.0,
        })


# ════════════════════════════════════════════════════════════════
# PERFIL 2 — IAMET / BAJANET resumido (Jacuzzi)
# ════════════════════════════════════════════════════════════════
class IametV2Resumen(IametV1Marcadores):
    """Layout sin labels de cierre. Cada bloque cierra con una fila
    numérica de totales (col H tiene el subtotal, col K el costo).

    Diferencias vs v1:
       - No hay "TOTAL MATERIALES" / "TOTAL MANO DE OBRA" / "COSTO MANO DE OBRA".
       - Sub-rótulos viven también en col B (ej. "FIBRA", "MATERIALES").
       - Header del cliente: contacto en L1 (no F1).
       - Header de tabla MO en row distinta (header label "Mano de obra"
         está en col A, header de tabla — "Marca | ..." — en la fila
         siguiente o cercana).

    El detect penaliza si encuentra los markers de v1 (los espera ausentes).
    """
    id = 'iamet_v2_resumen'
    name = 'IAMET / Bajanet (resumido)'

    def detect(self, ws):
        # Score basado en presencia de ciertos markers + ausencia de los de v1.
        score = 0
        max_r = min(ws.max_row, 260)
        has_v1_markers = False
        has_mo_label = False
        has_cmo_table = False
        has_analisis = False
        sub_b_count = 0
        for r in range(1, max_r + 1):
            ca = _str(ws.cell(r, 1).value).lower()
            cd = _str(ws.cell(r, 4).value).lower()
            ce = _str(ws.cell(r, 5).value).lower()
            cb = _str(ws.cell(r, 2).value)
            cb_low = cb.lower()
            if 'total materiales' in ca or 'total mano de obra' in ca:
                has_v1_markers = True
            if ca == 'mano de obra':
                has_mo_label = True
            if cd in ('descripcion', 'descripción') and ce in ('costo unit', 'costo unitario'):
                has_cmo_table = True
            if 'analisis de costos' in ca or 'análisis de costos' in ca:
                has_analisis = True
            # Sub-rótulo en col B (sin col A, sin col D, sin precio en col E)
            ce_val = ws.cell(r, 5).value
            if (cb and not _str(ws.cell(r, 1).value)
                    and not _str(ws.cell(r, 4).value)
                    and (ce_val is None or ce_val == '')
                    and cb_low not in ('servicios profesionales',)
                    and len(cb) <= 30 and cb.isupper()):
                sub_b_count += 1

        if has_mo_label:
            score += 25
        if has_cmo_table:
            score += 20
        if has_analisis:
            score += 15
        if sub_b_count >= 1:
            score += min(20, 10 + sub_b_count * 5)
        # Si existen markers v1, este perfil NO es el indicado
        if has_v1_markers:
            score = max(0, score - 60)
        return min(score, 100)

    def parse(self, ws, ws_formulas=None):
        # ── PASS 1: localizar bloques ─────────────────────────
        mo_section_start_row = None  # row con "Mano de obra"
        mo_header_row = None         # row con "Marca | Descripcion | ..." dentro del bloque MO
        cmo_header_row = None        # row con "Cantidad | Descripcion | Costo unit | ..."
        analisis_row = None          # row con "Análisis de Costos"

        for r in range(1, ws.max_row + 1):
            ca = _str(ws.cell(r, 1).value).lower()
            cd = _str(ws.cell(r, 4).value).lower()
            ce = _str(ws.cell(r, 5).value).lower()
            if ca == 'mano de obra' and mo_section_start_row is None:
                mo_section_start_row = r
            if (ca == 'marca' and cd in ('descripcion', 'descripción')
                    and mo_header_row is None and mo_section_start_row
                    and r > mo_section_start_row):
                mo_header_row = r
            if cd in ('descripcion', 'descripción') and ce in ('costo unit', 'costo unitario'):
                cmo_header_row = r
            if 'analisis de costos' in ca or 'análisis de costos' in ca:
                analisis_row = r

        # Header del cliente — contacto puede estar en F1 o L1.
        contacto_f1 = _str(ws.cell(1, 6).value)
        contacto_l1 = _str(ws.cell(1, 12).value)
        elaboro_f2 = _str(ws.cell(2, 6).value)
        elaboro_l2 = _str(ws.cell(2, 12).value)
        # Si parece fecha en L2 (formato date), no la confundir con elaboro
        l2_val = ws.cell(2, 12).value
        is_l2_date = isinstance(l2_val, (date, datetime))

        # Rangos de venta y costo que el Excel SÍ cuenta. El Excel a
        # veces excluye una fila del costo aunque la incluya en venta
        # (item de venta sin costo asignado), por eso necesitamos los
        # dos sets para reproducir las cifras exactas.
        rows_venta, rows_costo = (
            self._extract_subtotal_rows(ws_formulas)
            if ws_formulas else (None, None)
        )
        # IVA: si la fórmula del IVA está hardcodeada a un %, lo
        # respetamos. Si no, None y el endpoint usa el snapshot del modelo.
        iva_pct = self._extract_iva_pct(ws_formulas, analisis_row) if ws_formulas else None

        meta = {
            'cliente':  _str(ws.cell(1, 3).value),
            'contacto': contacto_f1 or contacto_l1,
            'elaboro':  elaboro_f2 or ('' if is_l2_date else elaboro_l2),
            'fecha':    _excel_iso_date(l2_val) if is_l2_date else _excel_iso_date(elaboro_l2),
            'tipo_cambio': _resolver_tipo_cambio(ws),
            'iva_pct':  iva_pct,  # None si no se pudo determinar
        }

        eq_items, mo_items, cmo_items = [], [], []
        # Equipamiento: 6 hasta antes de "Mano de obra".
        eq_end = mo_section_start_row or cmo_header_row or analisis_row or (ws.max_row + 1)
        for r in range(6, eq_end):
            in_venta = (rows_venta is None) or (r in rows_venta)
            in_costo = (rows_costo is None) or (r in rows_costo)
            if not in_venta:
                # Fuera de venta: la fila no cuenta como item. Si parece
                # rótulo de sub-sección (texto suelto), la emitimos como
                # header para preservar el árbol visual.
                self._maybe_emit_header_only(ws, r, eq_items)
                continue
            # Dentro del rango de venta. Si NO está en costo, marcamos el
            # item como "venta sin costo" (costoUnitario=0 forzado).
            self._parse_eq_row(
                ws, r, eq_items,
                summary_kw=(),
                force_zero_cost=(not in_costo),
            )

        # MO: del header de tabla hasta el header de CMO (- 1).
        if mo_header_row:
            mo_end = self._mo_end_row(ws, mo_header_row, cmo_header_row, analisis_row)
            for r in range(mo_header_row + 1, mo_end):
                self._parse_mo_row(ws, r, mo_items)

        # CMO: del header de tabla hasta analisis_row (-1) o fin de hoja.
        if cmo_header_row:
            cmo_end = self._cmo_end_row(ws, cmo_header_row, analisis_row)
            for r in range(cmo_header_row + 1, cmo_end):
                self._parse_cmo_row(ws, r, cmo_items)

        return {
            'meta': meta,
            'eq_items': eq_items,
            'mo_items': mo_items,
            'cmo_items': cmo_items,
        }

    def _mo_end_row(self, ws, mo_header_row, cmo_header_row, analisis_row):
        """Fin de bloque MO: prefiere cmo_header_row -1, sino analisis -1,
        sino fila numérica de totales (col H con número y A/D vacíos)."""
        if cmo_header_row and cmo_header_row > mo_header_row:
            return cmo_header_row
        if analisis_row and analisis_row > mo_header_row:
            return analisis_row
        # Fallback: primera fila después del header donde col A/D vacíos
        # pero col H tiene un número > 0 (fila de subtotal).
        for r in range(mo_header_row + 1, ws.max_row + 1):
            ca = _str(ws.cell(r, 1).value)
            cd = _str(ws.cell(r, 4).value)
            ch = ws.cell(r, 8).value
            if not ca and not cd and ch not in (None, '') and _dec(ch) > 0:
                return r
        return ws.max_row + 1

    def _cmo_end_row(self, ws, cmo_header_row, analisis_row):
        if analisis_row and analisis_row > cmo_header_row:
            return analisis_row
        for r in range(cmo_header_row + 1, ws.max_row + 1):
            cc = ws.cell(r, 3).value
            cd = ws.cell(r, 4).value
            ch = ws.cell(r, 8).value
            if (not cc or _dec(cc) == 0) and not _str(cd) and ch not in (None, '') and _dec(ch) > 0:
                return r
        return ws.max_row + 1

    # ── Helpers de fórmulas ──────────────────────────────────────
    _SUM_RE = re.compile(r'H(\d+)\s*:\s*H(\d+)', re.IGNORECASE)
    _IVA_RE = re.compile(r'(\d+(?:\.\d+)?)\s*%')

    def _formula_text(self, cell):
        """Extrae el texto literal de la fórmula, sea ArrayFormula o str."""
        v = getattr(cell, 'value', cell)
        if v is None:
            return ''
        if hasattr(v, 'text'):  # openpyxl ArrayFormula
            return str(v.text or '')
        if isinstance(v, str) and v.startswith('='):
            return v
        return ''

    def _extract_subtotal_rows(self, ws_formulas):
        """Devuelve `(rows_venta, rows_costo)` con las filas incluidas
        en SUM(H...) y SUM(K...) respectivamente. El Excel a veces
        excluye filas del costo aunque las incluya en venta (item de
        venta sin costo asignado), así que necesitamos los dos sets.

        Si el sheet no tiene fórmulas SUM, devuelve `(None, None)` y
        no filtramos nada."""
        if ws_formulas is None:
            return (None, None)
        rows_venta = set()
        rows_costo = set()
        any_sum = False
        # Rangos de col H = SUM(H<a>:H<b>) → venta incluida
        sum_h = re.compile(r'H(\d+)\s*:\s*H(\d+)', re.IGNORECASE)
        sum_k = re.compile(r'K(\d+)\s*:\s*K(\d+)', re.IGNORECASE)
        for r in range(1, ws_formulas.max_row + 1):
            txt_h = self._formula_text(ws_formulas.cell(r, 8))
            if txt_h and 'SUM' in txt_h.upper():
                any_sum = True
                for m in sum_h.finditer(txt_h):
                    a, b = int(m.group(1)), int(m.group(2))
                    if a > b: a, b = b, a
                    rows_venta.update(range(a, b + 1))
            txt_k = self._formula_text(ws_formulas.cell(r, 11))
            if txt_k and 'SUM' in txt_k.upper():
                for m in sum_k.finditer(txt_k):
                    a, b = int(m.group(1)), int(m.group(2))
                    if a > b: a, b = b, a
                    rows_costo.update(range(a, b + 1))
        return (rows_venta, rows_costo) if any_sum else (None, None)

    def _extract_iva_pct(self, ws_formulas, analisis_row):
        """Detecta IVA buscando una fórmula `=...*X%` cerca del Análisis
        de Costos (en col H, rows analisis_row..analisis_row+10).
        Devuelve float (8.0, 16.0, etc.) o None."""
        if ws_formulas is None or not analisis_row:
            return None
        for r in range(analisis_row, min(analisis_row + 10, ws_formulas.max_row + 1)):
            txt = self._formula_text(ws_formulas.cell(r, 8))
            if not txt:
                continue
            m = self._IVA_RE.search(txt)
            if m:
                try:
                    pct = float(m.group(1))
                    if 0 < pct < 100:
                        return pct
                except (TypeError, ValueError):
                    continue
        return None

    def _maybe_emit_header_only(self, ws, r, eq_items):
        """Para filas FUERA de los rangos de subtotales: si la fila luce
        como un sub-rótulo (texto en col A o B, sin item completo),
        la emitimos como header. Si no, la ignoramos.
        Esto preserva los rótulos de sub-secciones (ej. "ELEVACIÓN" en R181)
        que no entran en sus propios rangos de SUM."""
        col_a = ws.cell(r, 1).value
        col_b = ws.cell(r, 2).value
        col_c = ws.cell(r, 3).value
        col_d = ws.cell(r, 4).value
        col_e = ws.cell(r, 5).value
        ca_str = _str(col_a)
        cb_str = _str(col_b)
        cd_str = _str(col_d)
        # Header de tabla (la fila "Marca | Descripcion | ..."): skip total.
        if ca_str.lower() == 'marca' and cd_str.lower() in ('descripcion', 'descripción', ''):
            return
        # Sub-rótulo en col A: texto en A, B/C/D/E vacíos
        if (ca_str and not cb_str and not col_c
                and not cd_str and (col_e is None or col_e == '')):
            _emit_eq_header(eq_items, ca_str)
            return
        # Sub-rótulo en col B (Jacuzzi): texto en B, A/C/D/E vacíos
        if (cb_str and not ca_str and not col_c
                and not cd_str and (col_e is None or col_e == '')):
            _emit_eq_header(eq_items, cb_str)
            return
        # Resto (filas plantilla, items excluidos del subtotal): ignorar.


# ── Registry ────────────────────────────────────────────────────
PROFILES = [
    IametV1Marcadores(),
    IametV2Resumen(),
]

DETECTION_THRESHOLD = 30  # bajo este score, consideramos que no hay match


def detect_profile(ws):
    """Devuelve (profile, score) del que más alto puntee. None si nadie
    pasa el umbral."""
    scored = [(p, p.detect(ws)) for p in PROFILES]
    if not scored:
        return None, 0
    scored.sort(key=lambda x: x[1], reverse=True)
    best, score = scored[0]
    if score < DETECTION_THRESHOLD:
        return None, score
    return best, score


def detect_and_parse(ws, ws_formulas=None):
    """Devuelve dict con la data parseada + metadata del perfil detectado,
    o None si ningún perfil supera el umbral.

    `ws_formulas` (opcional) es el mismo sheet pero abierto con
    `data_only=False` para leer fórmulas. Perfiles que las usen (ej. v2)
    podrán filtrar items que el Excel excluyó del subtotal.

    Output:
        {
          'profile_id':   'iamet_v2_resumen',
          'profile_name': '…',
          'confidence':   85,
          'meta':         {...},  # incluye 'iva_pct' si se detectó
          'eq_items':     [...],
          'mo_items':     [...],
          'cmo_items':    [...],
          'all_scores':   [{'id': 'iamet_v1_marcadores', 'score': 0}, ...],
        }
    """
    all_scores = [{'id': p.id, 'name': p.name, 'score': p.detect(ws)} for p in PROFILES]
    profile, score = detect_profile(ws)
    if profile is None:
        return {
            'profile_id': None,
            'confidence': score,
            'all_scores': all_scores,
            'error': 'No se reconoció el formato del Excel.',
        }
    parsed = profile.parse(ws, ws_formulas=ws_formulas)
    parsed['profile_id'] = profile.id
    parsed['profile_name'] = profile.name
    parsed['confidence'] = score
    parsed['all_scores'] = all_scores
    return parsed

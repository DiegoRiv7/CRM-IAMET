"""Motor de compras del proyecto: comprado vs pendiente vs volumetría.

Junta las tres cifras que la sección de Proyectos debe contar de un vistazo
y saca la eficiencia de compra. Puro código sobre datos que ya existen:

- La volumetría (fase 3 del levantamiento) ya se sincroniza a
  ProyectoPartida (_sync_partidas_proyecto_from_volumetria): cantidad,
  cantidad_pendiente, costo_unitario y costo_total presupuestados.
- Las OCs ya son ProyectoOrdenCompra con monto_total SIEMPRE en MXN
  (services_financiero las detecta de los PDFs del Drive y las convierte
  con su tipo de cambio). Las del Drive nacen con partida=None y
  cantidad=1 — por eso el cálculo tiene dos niveles de precisión.

Reglas de negocio (definidas por el usuario, 2026-08-17):
- "Comprado" cuenta desde que la OC existe (llega al Drive y se detecta,
  o se captura a mano). Solo se excluyen las canceladas.
- Eficiencia = lo que DIJIMOS que gastaríamos (volumetría) entre lo que
  REALMENTE hemos gastado, sobre lo ya comprado:
    · comprar exactamente lo presupuestado → 100%
    · pagar de más, o comprar cosas fuera de la volumetría → baja
    · comprar más barato → sube de 100 (se muestra como ahorro)

Niveles de precisión (campo `nivel` del resumen):
- 'partida': hay OCs amarradas a partidas — a cada OC se le acredita el
  presupuesto de SU partida (topado al costo_total de la partida: comprar
  de más no genera crédito extra) y las OCs sin partida acreditan CERO
  (fuera de volumetría, castigan).
- 'proyecto': ninguna OC está amarrada todavía (el amarre es la Fase 2).
  Comparamos contra el presupuesto TOTAL: dentro del presupuesto → 100%,
  el excedente castiga. Menos fino, pero no castiga injustamente a un
  proyecto cuyas OCs simplemente no se han clasificado.
"""
from decimal import Decimal


def _f(x):
    """Decimal/None → float seguro."""
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def resumen_compras(proyecto):
    """Resumen de compras del proyecto. Devuelve dict listo para el overview:

    {
      'presupuesto':      float,  # lo que la volumetría dijo (Σ costo_total)
      'comprado':         float,  # Σ OCs vivas, MXN
      'pendiente':        float,  # cantidades sin cubrir × costo presupuestado
      'fuera_volumetria': float,  # Σ OCs sin partida (informativo)
      'ocs_sin_partida':  int,    # cuántas OCs esperan amarre (Fase 2)
      'eficiencia_pct':   float|None,  # None si no hay compras o volumetría
      'delta':            float,  # presupuesto acreditado − gastado (neg = arriba del plan)
      'nivel':            'partida'|'proyecto'|None,
      'sin_volumetria':   bool,
      'por_categoria':    [{categoria, presupuesto, comprado, pendiente}],
    }
    """
    partidas = list(proyecto.partidas.all())
    ocs = list(proyecto.ordenes_compra.exclude(status='cancelled'))

    presupuesto = sum(_f(p.costo_total) for p in partidas)
    comprado = sum(_f(oc.monto_total) for oc in ocs)

    # Pendiente de comprar: lo que la volumetría aún espera, a su costo plan.
    # Las partidas cerradas ya no esperan nada aunque traigan pendiente > 0.
    pendiente = sum(
        _f(p.cantidad_pendiente) * _f(p.costo_unitario)
        for p in partidas if p.status != 'closed'
    )

    # Agrupar lo comprado por partida (None = sin amarre)
    comprado_por_partida = {}
    for oc in ocs:
        key = oc.partida_id
        comprado_por_partida[key] = comprado_por_partida.get(key, 0.0) + _f(oc.monto_total)
    fuera = comprado_por_partida.get(None, 0.0)
    hay_amarre = any(k is not None for k in comprado_por_partida)

    # Presupuesto acreditado a lo comprado (numerador de la eficiencia)
    acreditado = 0.0
    nivel = None
    if comprado > 0 and partidas:
        if hay_amarre:
            nivel = 'partida'
            for p in partidas:
                comprado_p = comprado_por_partida.get(p.id)
                if not comprado_p:
                    continue
                cant = _f(p.cantidad)
                cubierta = cant - _f(p.cantidad_pendiente)
                if cant > 0 and cubierta > 0:
                    # Crédito por cantidad cubierta, topado al plan de la partida
                    acreditado += min(cubierta / cant, 1.0) * _f(p.costo_total)
                else:
                    # Cantidades sin actualizar: asumimos compra-según-plan
                    # hasta el tope del presupuesto de la partida.
                    acreditado += min(comprado_p, _f(p.costo_total))
            # Las OCs sin partida acreditan cero → castigan la eficiencia.
        else:
            nivel = 'proyecto'
            acreditado = min(comprado, presupuesto)

    eficiencia = None
    if comprado > 0 and presupuesto > 0:
        eficiencia = round(acreditado / comprado * 100.0, 1)
    delta = round(acreditado - comprado, 2)

    # Desglose por categoría (las OCs sin partida van a 'sin_asignar')
    cats = {}
    for p in partidas:
        c = cats.setdefault(p.categoria or 'otros',
                            {'presupuesto': 0.0, 'comprado': 0.0, 'pendiente': 0.0})
        c['presupuesto'] += _f(p.costo_total)
        if p.status != 'closed':
            c['pendiente'] += _f(p.cantidad_pendiente) * _f(p.costo_unitario)
    partida_cat = {p.id: (p.categoria or 'otros') for p in partidas}
    for oc in ocs:
        cat = partida_cat.get(oc.partida_id, 'sin_asignar')
        c = cats.setdefault(cat, {'presupuesto': 0.0, 'comprado': 0.0, 'pendiente': 0.0})
        c['comprado'] += _f(oc.monto_total)
    por_categoria = [
        {'categoria': k, 'presupuesto': round(v['presupuesto'], 2),
         'comprado': round(v['comprado'], 2), 'pendiente': round(v['pendiente'], 2)}
        for k, v in sorted(cats.items(), key=lambda kv: -kv[1]['presupuesto'])
    ]

    return {
        'presupuesto': round(presupuesto, 2),
        'comprado': round(comprado, 2),
        'pendiente': round(pendiente, 2),
        'fuera_volumetria': round(fuera, 2),
        'ocs_sin_partida': sum(1 for oc in ocs if oc.partida_id is None),
        'eficiencia_pct': eficiencia,
        'delta': delta,
        'nivel': nivel,
        'sin_volumetria': not partidas,
        'por_categoria': por_categoria,
    }

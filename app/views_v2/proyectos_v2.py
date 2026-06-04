"""
proyectos_v2.py — Vistas NUEVAS del módulo Proyectos.

Aquí va TODA vista nueva relacionada con proyectos. NO modificar:
    - views_proyectos.py (6,861 líneas) — LEGACY
    - views_iamet.py (6,568 líneas) — LEGACY

Ambos están congelados por Boy Scout Rule (ver ESTRUCTURA.md).

IMPORTANTE — Modelos paralelos:
    El sistema tiene `Proyecto` legacy y `ProyectoIAMET` moderno. Para
    código NUEVO, usar SIEMPRE `ProyectoIAMET` (tiene estructura
    financiera con partidas, órdenes de compra, facturas).

    from app.models import ProyectoIAMET

    Decisión documentada en DECISIONES.md (cuando se cree).

Convenciones obligatorias:
    - @login_required en endpoints autenticados
    - try/except con logger.exception(...), nunca `pass`
    - select_related/prefetch_related al iterar relaciones
    - Importar helpers desde views_utils
"""
import logging

logger = logging.getLogger(__name__)

# (vacío por ahora — el primer endpoint v2 de proyectos aterriza aquí)

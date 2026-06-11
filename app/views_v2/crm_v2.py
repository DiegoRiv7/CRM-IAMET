"""
crm_v2.py — Vistas NUEVAS del módulo CRM (oportunidades, cotizaciones,
clientes, dashboard).

Aquí va TODA vista nueva relacionada con el CRM. NO modificar
views_crm.py (6,488 líneas) — está marcado como LEGACY por la política
Boy Scout Rule (ver ESTRUCTURA.md).

Cuándo escribir aquí:
    - Nuevo endpoint API para oportunidades, cotizaciones o clientes
    - Cambios en endpoints que ameriten reescribir lógica entera
    - Reportes nuevos
    - Endpoints versionados (/api/v2/...)

Cuándo escribir en views_crm.py (legacy):
    - Solo bug crítico de producción

Convenciones obligatorias:
    - @login_required en endpoints autenticados
    - try/except con logger.exception(...), nunca `pass`
    - Importar helpers desde views_utils, no duplicar
    - Devolver JsonResponse({'ok': True/False, 'data': ..., 'error': ...})
"""
import logging

logger = logging.getLogger(__name__)

# (vacío por ahora — el primer endpoint v2 del CRM aterriza aquí)

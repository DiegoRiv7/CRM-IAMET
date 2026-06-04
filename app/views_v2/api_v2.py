"""
api_v2.py — APIs NUEVAS transversales (muro, jornadas, chat, integraciones).

Aquí van endpoints que NO encajan claramente en crm_v2.py ni
proyectos_v2.py. Ejemplos:
    - Nuevo endpoint del muro empresarial
    - APIs de integraciones externas nuevas (no Bitrix; eso ya está en
      bitrix_integration.py)
    - Endpoints utilitarios genéricos

NO modificar views_api.py legacy salvo bug crítico.

Si esto crece y se vuelve un grupo coherente (ej. 10+ endpoints del muro),
partir a un archivo dedicado (ej. muro_v2.py).

Convenciones obligatorias:
    - @login_required en endpoints autenticados
    - try/except con logger.exception(...), nunca `pass`
    - Documentar el contrato de input/output en docstring de cada función
"""
import logging

logger = logging.getLogger(__name__)

# (vacío por ahora — el primer endpoint v2 transversal aterriza aquí)

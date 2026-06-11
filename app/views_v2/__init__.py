# ----------------------------------------------------------------------
# app/views_v2/ — CÓDIGO BACKEND NUEVO (desde 2026-06-04)
#
# Este paquete contiene las vistas Django NUEVAS bajo política Boy Scout:
# todo endpoint nuevo se escribe aquí, no en los archivos legacy
# (views_crm.py, views_proyectos.py, views_iamet.py — cada uno con 6k+
# líneas).
#
# Cómo registrar una vista nueva en URLs:
#   # En app/urls.py:
#   from .views_v2 import crm_v2
#   urlpatterns += [
#       path('api/v2/oportunidad/<int:id>/algo/', crm_v2.api_algo_nuevo),
#   ]
#
# Convenciones obligatorias en todos los archivos de este paquete:
#   - Docstring del módulo explicando qué dominio cubre
#   - Cada función con docstring breve (1-3 líneas) explicando qué hace
#   - @login_required en endpoints autenticados (NO confiar en orden)
#   - logger = logging.getLogger(__name__) al inicio del archivo
#   - try/except con logger.exception(...) — NO `pass` silencioso
#   - select_related/prefetch_related al hacer queries en loops
#   - Helpers compartidos: importar de views_utils en lugar de duplicar
#
# Ver: ESTRUCTURA.md (sección "Boy Scout Rule") y
#      Plan_Fase6_Refactor.md
# ----------------------------------------------------------------------

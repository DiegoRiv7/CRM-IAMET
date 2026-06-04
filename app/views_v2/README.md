# app/views_v2/ — Vistas backend nuevas (Boy Scout Rule)

Este paquete contiene las vistas Django **nuevas** del CRM IAMET bajo
política Boy Scout Rule (desde 2026-06-04).

## 🎯 Propósito

Los archivos `views_*.py` legacy son enormes (6k+ líneas cada uno).
Para no seguir creciéndolos, todo endpoint NUEVO se escribe acá.

## 📂 Estructura

| Archivo | Dominio | Reemplaza progresivamente |
|---|---|---|
| `crm_v2.py` | Oportunidades, cotizaciones, clientes, dashboard | `views_crm.py` (6,488 líneas) |
| `proyectos_v2.py` | Proyectos, partidas, OCs, facturas, levantamientos, volumetrías | `views_proyectos.py` (6,861) + `views_iamet.py` (6,568) |
| `api_v2.py` | APIs transversales (muro, integraciones, utilidades) | `views_api.py` |

## 🚀 Cómo agregar una vista nueva

1. Decide en cuál archivo del paquete va según dominio.
2. Escribe la función con docstring breve + `@login_required` + logger:

```python
# app/views_v2/crm_v2.py

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from app.models import TodoItem

@login_required
def api_oportunidad_algo_nuevo(request, oportunidad_id):
    """Devuelve algo nuevo sobre la oportunidad — usado por crm_kanban_v2.js."""
    try:
        opp = TodoItem.objects.select_related('cliente').get(id=oportunidad_id)
        return JsonResponse({'ok': True, 'data': {'nombre': opp.cliente.nombre_empresa}})
    except TodoItem.DoesNotExist:
        return JsonResponse({'ok': False, 'error': 'no encontrado'}, status=404)
    except Exception as e:
        logger.exception('api_oportunidad_algo_nuevo')
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)
```

3. Registra la URL en `app/urls.py`:

```python
from .views_v2 import crm_v2

urlpatterns += [
    path('api/v2/oportunidad/<int:oportunidad_id>/algo/',
         crm_v2.api_oportunidad_algo_nuevo,
         name='api_oportunidad_algo_nuevo'),
]
```

## 📜 Convenciones obligatorias

### Imports
```python
import logging
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from app.models import ProyectoIAMET  # SIEMPRE el moderno, no Proyecto legacy
from app.views_utils import _get_user_card, _serialize_X  # reusar helpers

logger = logging.getLogger(__name__)
```

### Endpoints
- `@login_required` en todos los que requieran auth (NO confiar en el orden)
- Docstring breve: qué hace, qué consume, qué devuelve
- `try/except` con `logger.exception(...)`, NUNCA `pass` silencioso
- Devolver siempre `JsonResponse({'ok': bool, 'data': ..., 'error': ...})`
- Status codes: 200 OK, 400 bad request, 401 unauth, 404 not found, 500 server error

### Queries
- Usar `select_related('fk1', 'fk2')` cuando se accede a FKs después
- Usar `prefetch_related('m2m')` cuando se itera sobre many-to-many
- Paginar con `Paginator` si la respuesta puede ser > 100 items

### Naming
- Endpoints: `api_<dominio>_<accion>` (ej: `api_oportunidad_detalle`)
- URLs: `/app/api/v2/<recurso>/<id?>/<accion?>/`
- Helpers privados: `_helper_x()` con underscore al inicio

## 🚫 Lo que NO hacer

- Importar de `views_crm`, `views_proyectos`, `views_iamet` legacy
  (si necesitas un helper de ahí, MUÉVELO a `views_utils.py`)
- Usar el modelo `Proyecto` legacy (usar `ProyectoIAMET`)
- Devolver HTML desde estos endpoints (son JSON puros)
- Catch generales `except Exception: pass` sin logger

## 🤝 Sobre los modelos paralelos

El sistema tiene `Proyecto` legacy y `ProyectoIAMET` moderno. Para
código nuevo, **usa siempre `ProyectoIAMET`**. El legacy quedará
documentado como DEPRECATED en `DECISIONES.md` y eventualmente se
eliminará cuando ya no haya consumidores.

Lo mismo con `Tarea` (proyectos ingeniería) vs `TareaOportunidad`
(CRM): mantener ambos por contextos distintos, pero documentar cuándo
usar cuál.

## 📚 Más contexto

- `ESTRUCTURA.md` (raíz) — mapa general
- `Plan_Fase6_Refactor.md` — plan actual de handoff
- `DECISIONES.md` (cuando se cree) — decisiones arquitectónicas

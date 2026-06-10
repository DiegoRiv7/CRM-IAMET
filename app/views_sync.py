"""Endpoint del sync entre usuarios (polling ligero).

GET /app/api/sync/cambios/?since=<cursor>

  · El cursor es el PK del último CrmCambio que el cliente ya vio —
    la query es `WHERE id > cursor LIMIT 200` sobre el índice primario:
    microsegundos, sin importar cuántas filas tenga la tabla.
  · Primera llamada (sin since): devuelve solo el cursor actual, cero
    payload — el cliente parte "del presente", no del histórico.
  · Los cambios se deduplican por (entidad, objeto_id): si alguien
    guardó 5 veces la misma opp entre polls, el cliente recibe UNA.
  · Purga oportunista: ~1% de las llamadas borra filas de más de 48h
    para que la tabla nunca crezca sin control.

El cliente (crm_sync.js) re-emite cada cambio a window.crmDataBus —
toda la UI reactiva existente se refresca sin más cableado.
"""
import random

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.utils import timezone
from datetime import timedelta

from .models import CrmCambio

MAX_CAMBIOS = 200
PURGA_HORAS = 48


@login_required
def api_sync_cambios(request):
    try:
        since = request.GET.get('since')
        try:
            since = int(since)
        except (TypeError, ValueError):
            since = None

        if since is None:
            # Primer poll: entregar el cursor del presente, sin histórico.
            last = CrmCambio.objects.order_by('-id').values_list('id', flat=True).first() or 0
            return JsonResponse({'ok': True, 'cursor': last, 'cambios': []})

        filas = list(
            CrmCambio.objects.filter(id__gt=since)
            .order_by('id')
            .values('id', 'entidad', 'objeto_id', 'accion', 'usuario_id', 'extra')[:MAX_CAMBIOS]
        )

        cursor = filas[-1]['id'] if filas else since

        # Dedupe por (entidad, objeto_id): conservar el último (delete gana
        # sobre update porque viene después en orden de id).
        dedup = {}
        for f in filas:
            dedup[(f['entidad'], f['objeto_id'])] = f
        cambios = [
            {
                'entidad': f['entidad'],
                'id': f['objeto_id'],
                'accion': f['accion'],
                'usuario_id': f['usuario_id'],
                'extra': f['extra'] or {},
            }
            for f in dedup.values()
        ]

        # Purga oportunista (~1% de los polls): la tabla se queda chica sola.
        if random.random() < 0.01:
            try:
                CrmCambio.objects.filter(
                    ts__lt=timezone.now() - timedelta(hours=PURGA_HORAS)
                ).delete()
            except Exception:
                pass

        return JsonResponse({'ok': True, 'cursor': cursor, 'cambios': cambios})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=400)

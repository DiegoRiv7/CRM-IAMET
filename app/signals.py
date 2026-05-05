# ----------------------------------------------------------------------
# signals.py — Django signal handlers for the `app` Django application.
# ----------------------------------------------------------------------
#
# Auto-conversión de Prospectos:
# Cuando un Prospecto activo (etapa NOT IN procesado/cerrado_*, sin oportunidad)
# tiene una negociación (TodoItem) o una Cotización ligada a su mismo cliente,
# automáticamente se marca como `procesado` y se "saca" de la lista activa,
# preservando al vendedor asignado.
# ----------------------------------------------------------------------

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver


logger = logging.getLogger(__name__)


# Etapas que indican que el prospecto ya NO es activo.
_ETAPAS_INACTIVAS = ('procesado', 'cerrado_ganado', 'cerrado_perdido')


def _procesar_prospectos_activos_de_cliente(cliente_id, oportunidad=None, motivo=''):
    """Marca como `procesado` los prospectos activos del cliente dado.

    - Filtra prospectos del cliente en etapa activa y sin `oportunidad_creada`.
    - Si se pasa una `oportunidad` (TodoItem), la liga a `oportunidad_creada`.
    - Mantiene `usuario` (vendedor asignado) intacto.
    """
    if not cliente_id:
        return 0

    # Import local para evitar problemas de circular imports en arranque.
    from .models import Prospecto

    qs = (
        Prospecto.objects
        .filter(cliente_id=cliente_id, oportunidad_creada__isnull=True)
        .exclude(etapa__in=_ETAPAS_INACTIVAS)
    )

    actualizados = 0
    for prospecto in qs:
        prospecto.etapa = 'procesado'
        if oportunidad is not None and prospecto.oportunidad_creada_id is None:
            prospecto.oportunidad_creada = oportunidad
        try:
            prospecto.save(update_fields=['etapa', 'oportunidad_creada', 'fecha_actualizacion'])
            actualizados += 1
        except Exception as exc:  # pragma: no cover - defensivo
            logger.warning(
                'No se pudo auto-procesar prospecto %s (%s): %s',
                prospecto.id, motivo or '?', exc,
            )

    if actualizados:
        logger.info(
            'Auto-conversion prospectos: %s actualizados (cliente=%s, motivo=%s)',
            actualizados, cliente_id, motivo or '?',
        )
    return actualizados


@receiver(post_save, sender='app.TodoItem')
def auto_procesar_prospectos_por_oportunidad(sender, instance, created, **kwargs):
    """Cuando se crea una nueva oportunidad (TodoItem), procesa los prospectos
    activos del mismo cliente."""
    if not created:
        return
    try:
        _procesar_prospectos_activos_de_cliente(
            cliente_id=getattr(instance, 'cliente_id', None),
            oportunidad=instance,
            motivo='oportunidad_creada',
        )
    except Exception as exc:  # pragma: no cover - defensivo
        logger.exception('Error auto-procesando prospectos al crear TodoItem %s: %s', instance.id, exc)


@receiver(post_save, sender='app.Cotizacion')
def auto_procesar_prospectos_por_cotizacion(sender, instance, created, **kwargs):
    """Cuando se crea una cotización, procesa prospectos activos del mismo cliente.

    Si la cotización viene ligada a una oportunidad, esa oportunidad se enlaza
    en `oportunidad_creada` del prospecto.
    """
    if not created:
        return
    try:
        cliente_id = getattr(instance, 'cliente_id', None)
        oportunidad = getattr(instance, 'oportunidad', None)
        # Si la cotizacion viene con oportunidad usamos su cliente preferentemente
        if oportunidad is not None and getattr(oportunidad, 'cliente_id', None):
            cliente_id = oportunidad.cliente_id
        _procesar_prospectos_activos_de_cliente(
            cliente_id=cliente_id,
            oportunidad=oportunidad,
            motivo='cotizacion_creada',
        )
    except Exception as exc:  # pragma: no cover - defensivo
        logger.exception('Error auto-procesando prospectos al crear Cotizacion %s: %s', instance.id, exc)

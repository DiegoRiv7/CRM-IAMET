"""Signals → CrmCambio: el lado "escritor" del sync entre usuarios.

Cada save/delete de los modelos que la UI muestra en vivo inserta UNA
fila ligera en CrmCambio. El nombre de `entidad` es el MISMO nombre
canónico que usa window.crmDataBus en el frontend (widget_data_bus.js),
de modo que el cliente puede re-emitir el cambio al bus tal cual y toda
la maquinaria reactiva existente (kanban, ventanas de oportunidad,
tareas, calendario, drive) se refresca sin código nuevo.

Registrado desde AppConfig.ready() (app/apps.py). Cada handler está
blindado: un fallo al loggear JAMÁS debe romper el save original.
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from .models import (
    CrmCambio,
    TodoItem,
    TareaOportunidad,
    Tarea,
    Actividad,
    Cotizacion,
    ArchivoOportunidad,
    CarpetaOportunidad,
    OportunidadComentario,
    Prospecto,
    ProyectoIAMET,
)

# Campos típicos donde los modelos guardan "quién" (orden de preferencia).
_USER_ATTRS = ('usuario', 'creado_por', 'subido_por', 'created_by', 'autor', 'asignado_a')


def _quien(instance):
    for attr in _USER_ATTRS:
        u = getattr(instance, attr, None)
        if u is not None and getattr(u, 'pk', None):
            return u
    return None


def _log(entidad, instance, accion, extra=None):
    try:
        CrmCambio.objects.create(
            entidad=entidad,
            objeto_id=getattr(instance, 'pk', None),
            accion=accion,
            usuario=_quien(instance),
            extra=extra or {},
        )
    except Exception:
        # Nunca romper la operación original por un fallo del log de sync.
        pass


def _opp_extra(instance, attr='oportunidad'):
    opp = getattr(instance, attr + '_id', None)
    return {'oportunidad_id': opp} if opp else {}


def _accion(created):
    return 'create' if created else 'update'


# ── Oportunidades ──────────────────────────────────────────────────────

@receiver(post_save, sender=TodoItem)
def _opp_save(sender, instance, created, **kw):
    _log('oportunidad', instance, _accion(created))


@receiver(post_delete, sender=TodoItem)
def _opp_delete(sender, instance, **kw):
    _log('oportunidad', instance, 'delete')


# ── Tareas ─────────────────────────────────────────────────────────────

@receiver(post_save, sender=TareaOportunidad)
def _tarea_opp_save(sender, instance, created, **kw):
    _log('tarea-opp', instance, _accion(created), _opp_extra(instance))


@receiver(post_delete, sender=TareaOportunidad)
def _tarea_opp_delete(sender, instance, **kw):
    _log('tarea-opp', instance, 'delete', _opp_extra(instance))


@receiver(post_save, sender=Tarea)
def _tarea_save(sender, instance, created, **kw):
    _log('tarea', instance, _accion(created), _opp_extra(instance))


@receiver(post_delete, sender=Tarea)
def _tarea_delete(sender, instance, **kw):
    _log('tarea', instance, 'delete', _opp_extra(instance))


# ── Calendario ─────────────────────────────────────────────────────────

@receiver(post_save, sender=Actividad)
def _actividad_save(sender, instance, created, **kw):
    _log('actividad', instance, _accion(created), _opp_extra(instance))


@receiver(post_delete, sender=Actividad)
def _actividad_delete(sender, instance, **kw):
    _log('actividad', instance, 'delete', _opp_extra(instance))


# ── Cotizaciones ───────────────────────────────────────────────────────

@receiver(post_save, sender=Cotizacion)
def _cot_save(sender, instance, created, **kw):
    _log('cotizacion', instance, _accion(created), _opp_extra(instance))


@receiver(post_delete, sender=Cotizacion)
def _cot_delete(sender, instance, **kw):
    _log('cotizacion', instance, 'delete', _opp_extra(instance))


# ── Drive de oportunidad (archivos + carpetas) ─────────────────────────
# Entidad nueva 'drive': el caso reportado por los usuarios ("subí un
# documento y el otro no lo ve"). El extra lleva la opp para que el
# cliente solo recargue si tiene ESE drive abierto.

@receiver(post_save, sender=ArchivoOportunidad)
def _drive_archivo_save(sender, instance, created, **kw):
    _log('drive', instance, _accion(created), _opp_extra(instance))


@receiver(post_delete, sender=ArchivoOportunidad)
def _drive_archivo_delete(sender, instance, **kw):
    _log('drive', instance, 'delete', _opp_extra(instance))


@receiver(post_save, sender=CarpetaOportunidad)
def _drive_carpeta_save(sender, instance, created, **kw):
    _log('drive', instance, _accion(created), _opp_extra(instance))


@receiver(post_delete, sender=CarpetaOportunidad)
def _drive_carpeta_delete(sender, instance, **kw):
    _log('drive', instance, 'delete', _opp_extra(instance))


# ── Conversación de oportunidad ────────────────────────────────────────

@receiver(post_save, sender=OportunidadComentario)
def _comentario_save(sender, instance, created, **kw):
    _log('comentario', instance, _accion(created), _opp_extra(instance))


@receiver(post_delete, sender=OportunidadComentario)
def _comentario_delete(sender, instance, **kw):
    _log('comentario', instance, 'delete', _opp_extra(instance))


# ── Prospección y Proyectos ────────────────────────────────────────────

@receiver(post_save, sender=Prospecto)
def _prospecto_save(sender, instance, created, **kw):
    _log('prospecto', instance, _accion(created))


@receiver(post_delete, sender=Prospecto)
def _prospecto_delete(sender, instance, **kw):
    _log('prospecto', instance, 'delete')


@receiver(post_save, sender=ProyectoIAMET)
def _proyecto_save(sender, instance, created, **kw):
    _log('proyecto', instance, _accion(created))


@receiver(post_delete, sender=ProyectoIAMET)
def _proyecto_delete(sender, instance, **kw):
    _log('proyecto', instance, 'delete')

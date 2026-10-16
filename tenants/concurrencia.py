"""
Cola justa para trabajo caro de CPU compartido entre empresas.

El problema: con una sola app, el OCR de las órdenes de compra usaba UN candado
global. Si una empresa soltaba cinco PDFs escaneados, sus cinco peticiones se
formaban en ese candado y las de las demás empresas quedaban DETRÁS de todas
ellas — un vecino ruidoso frenando a todo el edificio. En el modelo de un
contenedor por empresa eso no pasaba porque cada quien tenía su propia CPU.

La solución tiene dos niveles:

  1. **Un turno por empresa**: cada empresa puede tener UNA sola petición
     esperando. Las demás de esa misma empresa hacen fila aparte, sin estorbar
     a nadie más. Así, aunque una suba veinte archivos, compite por el recurso
     como si fuera una.
  2. **Tope global**: cuántas pueden ejecutarse a la vez en el servidor
     (`OCR_MAX_CONCURRENTE`, por defecto 1 = el comportamiento de siempre, para
     no cambiar el consumo de CPU de IAMET sin querer).

Y un tiempo máximo de espera: si no alcanza turno, se levanta `RecursoOcupado`
y quien llama degrada con elegancia (en el OCR: seguir sin reconocer el PDF)
en vez de morir en el timeout de gunicorn y tumbar la petición.
"""
import threading
from contextlib import contextmanager

from django.conf import settings

_mutex = threading.Lock()
_turnos = {}   # (recurso, empresa) → Lock   — un turno por empresa
_cupos = {}    # recurso → BoundedSemaphore  — tope global


class RecursoOcupado(RuntimeError):
    """No se consiguió turno a tiempo; quien llama debe degradar, no fallar."""


def _empresa_actual():
    try:
        from .context import current_alias
        return current_alias() or '-'
    except Exception:
        return '-'


def _piezas(recurso, max_global):
    empresa = _empresa_actual()
    with _mutex:
        cupo = _cupos.get(recurso)
        if cupo is None:
            cupo = _cupos[recurso] = threading.BoundedSemaphore(max(1, max_global))
        turno = _turnos.setdefault((recurso, empresa), threading.Lock())
    return turno, cupo


@contextmanager
def turno(recurso, max_global=1, espera=25):
    """`with turno('ocr'): ...` — una petición por empresa y `max_global` en total."""
    mi_turno, cupo = _piezas(recurso, max_global)
    if not mi_turno.acquire(timeout=espera):
        raise RecursoOcupado(f'{recurso}: esta empresa ya tiene trabajo en cola')
    try:
        if not cupo.acquire(timeout=espera):
            raise RecursoOcupado(f'{recurso}: el servidor está ocupado')
        try:
            yield
        finally:
            cupo.release()
    finally:
        mi_turno.release()


def turno_ocr():
    """Turno para el OCR de las POs escaneadas (~5 s de CPU cada uno)."""
    return turno(
        'ocr',
        max_global=int(getattr(settings, 'OCR_MAX_CONCURRENTE', 1) or 1),
        espera=int(getattr(settings, 'OCR_ESPERA_MAX', 25) or 25),
    )

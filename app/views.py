"""
CRM IAMET — views.py

Backwards-compatible re-export module.
Each domain now lives in its own file:

  views_utils.py        — shared utilities and helpers
  views_crm.py          — CRM home, oportunidades
  views_cotizaciones.py — cotizaciones and PDFs
  views_drive.py        — drive de archivos
  views_proyectos.py    — proyectos y tareas
  views_admin.py        — admin, supervisores, bitrix
  views_api.py          — muro, jornadas, notificaciones, chat
  views_auth.py         — autenticación y perfil
  views_mail.py         — módulo de correo (independiente)
  views_exportar.py     — exportación (independiente)
  views_tarea_comentarios.py — comentarios de tareas (independiente)
"""

from .views_utils import *
from .views_crm import *
from .views_cotizaciones import *
from .views_drive import *
from .views_proyectos import *
from .views_admin import *
from .views_api import *
from .views_auth import *

# Re-export tarea comment APIs (referenced as views.api_comentarios_tarea in urls.py)
from .views_tarea_comentarios import (
    api_comentarios_tarea,
    api_agregar_comentario_tarea,
    api_editar_comentario_tarea,
    api_eliminar_comentario_tarea,
    api_tarea_archivo,
)

from .views_prospeccion import *
from .views_campanas import *

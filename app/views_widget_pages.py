"""Páginas standalone de widgets — para instanciarlos vía iframe.

El truco de instanciado (el mismo del cotizador): el código legacy de un
sub-widget es SINGLETON por diseño (ids fijos + estado de módulo), pero
dentro de un IFRAME cada ventana tiene su propio mundo JS — N ventanas
= N singletons, sin refactorizar el legacy. La página incluye el template
completo de la oportunidad (de donde el closure del sub-widget no se
puede extraer sin cirugía) con shims mínimos de los globals del CRM home,
y un bootstrap que apunta el sub-widget a la oportunidad y lo deja en
modo página.
"""
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, render
from django.views.decorators.cache import never_cache

from .models import TodoItem


@login_required
@never_cache
def widget_drive_page(request, oportunidad_id):
    """Drive de UNA oportunidad como página completa (cuerpo de un iframe).

    La seguridad real vive en los endpoints del drive que el widget
    consume (mismos que en el CRM home); esta vista solo arma el chrome.
    """
    opp = get_object_or_404(TodoItem, id=oportunidad_id)
    return render(request, 'crm/widget_drive_page.html', {
        'oportunidad_id': opp.id,
        'oportunidad_titulo': opp.oportunidad or '',
    })


@login_required
@never_cache
def widget_prospecto_page(request, prospecto_id):
    """Prospecto como página completa (cuerpo de un iframe de ventana).

    Sin query a BD: el widget legacy hace su propio fetch del detalle
    (con sus permisos); esta vista solo arma el chrome del iframe.
    """
    return render(request, 'crm/widget_prospecto_page.html', {
        'prospecto_id': prospecto_id,
    })


@login_required
@never_cache
def widget_idea_page(request, idea_id):
    """Idea como página completa (cuerpo de un iframe de ventana)."""
    return render(request, 'crm/widget_idea_page.html', {
        'idea_id': idea_id,
    })


@login_required
@never_cache
def widget_actividad_idea_page(request, idea_id):
    """Composer de actividad ligado a una idea (ventana-iframe propia)."""
    return render(request, 'crm/widget_actividad_idea_page.html', {
        'idea_id': idea_id,
    })


@login_required
@never_cache
def widget_tarea_page(request, tarea_id):
    """Detalle de tarea como página completa (ventana-iframe propia).

    Pasa los flags de rol REALES: sin esto la página renderiza el modal
    con permisos de vendedor raso (esSupervisor=False…) y un supervisor
    veía la tarea con menos controles que en el modal principal.
    """
    from .views_utils import is_supervisor, is_administrador
    profile = getattr(request.user, 'userprofile', None)
    return render(request, 'crm/widget_tarea_page.html', {
        'tarea_id': tarea_id,
        'es_supervisor': is_supervisor(request.user),
        'es_administrador': is_administrador(request.user),
        'es_ingeniero': (getattr(profile, 'rol', 'vendedor') == 'ingeniero') if profile else False,
    })

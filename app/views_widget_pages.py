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

from .models import TodoItem


@login_required
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

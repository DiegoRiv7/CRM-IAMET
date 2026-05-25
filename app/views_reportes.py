"""Módulo Reportes — vistas de la sección /app/reportes/.

Catálogo de reportes "canned" (preconstruidos) que los jefes y vendedores
pueden consultar para entender el estado del negocio. Sin AI: queries
directas a la BD + render nativo.

Estructura general:
- /app/reportes/                         → landing con grilla de reportes
- /app/reportes/<slug>/                  → vista del reporte
- /app/api/reportes/<slug>/              → JSON con los datos
- /app/api/reportes/<slug>/export-excel/ → XLSX descargable

Cada reporte tiene su propio handler en este archivo. La biblioteca crece
agregando entradas a REPORTES_CATALOGO + las funciones correspondientes.
"""
from datetime import datetime

from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from .views_utils import is_supervisor, is_administrador


def _sidebar_context(request):
    """Variables que el partial _sidebar.html espera. Se reusan en todas las
    páginas que lo incluyen (crm_home las llena por su cuenta; aquí las
    rellenamos para que el sidebar no truene en /app/reportes/)."""
    user = request.user
    profile = getattr(user, 'userprofile', None)
    now = datetime.now()
    return {
        'usuario': user,
        'es_supervisor': is_supervisor(user),
        'es_administrador': is_administrador(user),
        'es_ingeniero': (getattr(profile, 'rol', 'vendedor') == 'ingeniero') if profile else False,
        'mis_grupos': [],  # no aplica aquí — sidebar lo usa solo para mostrar Grupo
        'mes_filter': str(now.month).zfill(2),
        'anio_filter': str(now.year),
    }


# ─── Catálogo de reportes disponibles ───────────────────────────────────────

REPORTES_CATALOGO = [
    {
        'slug': 'oportunidades-abiertas',
        'titulo': 'Oportunidades Abiertas',
        'descripcion': (
            'Oportunidades en estado "Vendido en adelante" que aún no están '
            'cerradas. Útil para revisar qué falta para facturar o cobrar.'
        ),
        'icono': 'inbox',
        'color': '#0052D4',
    },
    {
        'slug': 'oportunidades-cerradas',
        'titulo': 'Oportunidades Cerradas',
        'descripcion': (
            'Ganadas y perdidas en un periodo. Muestra el % de cierre, '
            'ticket promedio y comparativo por vendedor.'
        ),
        'icono': 'check-circle',
        'color': '#059669',
    },
    {
        'slug': 'clientes',
        'titulo': 'Cómo Vamos por Cliente',
        'descripcion': (
            'Una fila por cliente: # de oportunidades abiertas / ganadas / '
            'perdidas, monto total ganado, último contacto y próxima '
            'actividad. Para ver con quién hay que insistir.'
        ),
        'icono': 'building',
        'color': '#7C3AED',
    },
]

REPORTES_BY_SLUG = {r['slug']: r for r in REPORTES_CATALOGO}


# ─── Vistas ─────────────────────────────────────────────────────────────────

@login_required
def reportes_index(request):
    """Landing del módulo Reportes — grilla de reportes disponibles."""
    ctx = _sidebar_context(request)
    ctx.update({
        'reportes': REPORTES_CATALOGO,
        'tab_activo': 'reportes',
    })
    return render(request, 'reportes/index.html', ctx)


@login_required
def reporte_detalle(request, slug):
    """Vista de un reporte individual. Despacha por slug."""
    reporte = REPORTES_BY_SLUG.get(slug)
    ctx = _sidebar_context(request)
    if not reporte:
        ctx.update({'slug': slug, 'tab_activo': 'reportes'})
        return render(request, 'reportes/no_encontrado.html', ctx, status=404)
    ctx.update({'reporte': reporte, 'tab_activo': 'reportes'})
    template = f'reportes/{slug.replace("-", "_")}.html'
    return render(request, template, ctx)

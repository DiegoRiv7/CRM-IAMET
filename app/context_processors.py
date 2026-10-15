import json
import os

from .views import is_supervisor, is_engineer
from .models import UserProfile

# MULTITENANT: estas banderas se leen EN CADA REQUEST (no al importar): en
# modo bridge un mismo proceso atiende a varias empresas y lo que se lea del
# entorno al importar se serviría a todas. Las integraciones del sitio de
# IAMET (Sitio Web, panel del portal) se ocultan a las empresas cliente.


def _es_iamet_o_clasico(empresa):
    from tenants.runtime import modo_tenant
    return (not modo_tenant()) or bool(getattr(empresa, 'es_iamet', False))


def _resumen_habilitado():
    # Feature flag de "Mi día" (icono del sidebar). Default VISIBLE; para
    # ocultarlo en un ambiente: RESUMEN_HABILITADO=0 en su .env.
    return os.environ.get('RESUMEN_HABILITADO', '1') == '1'


def _sitio_web_url(empresa):
    # Botón "Sitio Web" del sidebar: copia del sitio de IAMET en pruebas.
    return os.environ.get('SITIO_WEB_URL', '') if _es_iamet_o_clasico(empresa) else ''


def _portal_admin_habilitado(empresa):
    # Sección "Empresas del producto" del panel admin: solo la instancia de IAMET.
    return bool(os.environ.get('PORTAL_ADMIN_URL')) if _es_iamet_o_clasico(empresa) else False

def supervisor_flag(request):
    user_authenticated = request.user.is_authenticated

    # Asegurar que el usuario tenga un perfil si está autenticado
    if user_authenticated:
        try:
            profile, created = UserProfile.objects.get_or_create(user=request.user)
        except:
            profile = None
    else:
        profile = None

    # ── MULTIEMPRESA: identidad, módulos y catálogos de esta instancia ──
    from .empresa import (
        catalogo, choices_catalogo, columnas_producto, empresa_config, modulos,
        nombre_asistente,
    )
    empresa = empresa_config()
    mods = modulos()

    return {
        'EMPRESA': empresa,
        'MODULOS': mods,
        'MODULOS_JSON': json.dumps(mods),
        'ASISTENTE_NOMBRE': nombre_asistente(),
        'CATALOGO_PRODUCTOS': choices_catalogo('producto'),
        'CATALOGO_AREAS': choices_catalogo('area'),
        'CATALOGO_MARCAS': choices_catalogo('marca'),
        'COLUMNAS_PRODUCTO': columnas_producto(),
        'is_supervisor': is_supervisor(request.user) if user_authenticated else False,
        'is_engineer': is_engineer(request.user) if user_authenticated else False,
        'user_profile': profile,
        'resumen_habilitado': _resumen_habilitado() and mods.get('asistente_ia', True),
        'sitio_web_url': _sitio_web_url(empresa),
        # MULTIEMPRESA: sección "Empresas del producto" del panel admin (solo la instancia de
        # IAMET define PORTAL_ADMIN_URL/TOKEN; las empresas cliente no la ven).
        'portal_admin_habilitado': _portal_admin_habilitado(empresa),
        # Bandeja Chat Web del sitio: supervisores siempre; el resto por flag.
        'puede_chat_web': (
            mods.get('chat_web', False)
            and (is_supervisor(request.user) or bool(getattr(profile, 'puede_chat_web', False)))
            if user_authenticated else False
        ),
    }

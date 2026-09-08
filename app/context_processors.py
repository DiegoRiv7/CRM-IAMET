import json
import os

from .views import is_supervisor, is_engineer
from .models import UserProfile

# Feature flag de "Mi día" (icono del sidebar). Nació OCULTO por default para
# el soft-launch; con Mi Asistente listo para liberar (2026-08-17) el default
# es VISIBLE en todos lados — el merge a producción basta, sin tocar su .env.
# Para ocultarlo en un ambiente: RESUMEN_HABILITADO=0 en su .env.
RESUMEN_HABILITADO = os.environ.get('RESUMEN_HABILITADO', '1') == '1'

# URL del sitio web en pruebas (botón "Sitio Web" del sidebar). Solo aparece
# donde la variable esté definida — en pruebas apunta a la copia del sitio
# que corre en este mismo servidor; producción no la define y no ve nada.
SITIO_WEB_URL = os.environ.get('SITIO_WEB_URL', '')

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
    )
    empresa = empresa_config()
    mods = modulos()

    return {
        'EMPRESA': empresa,
        'MODULOS': mods,
        'MODULOS_JSON': json.dumps(mods),
        'CATALOGO_PRODUCTOS': choices_catalogo('producto'),
        'CATALOGO_AREAS': choices_catalogo('area'),
        'CATALOGO_MARCAS': choices_catalogo('marca'),
        'COLUMNAS_PRODUCTO': columnas_producto(),
        'is_supervisor': is_supervisor(request.user) if user_authenticated else False,
        'is_engineer': is_engineer(request.user) if user_authenticated else False,
        'user_profile': profile,
        'resumen_habilitado': RESUMEN_HABILITADO and mods.get('asistente_ia', True),
        'sitio_web_url': SITIO_WEB_URL,
        # Bandeja Chat Web del sitio: supervisores siempre; el resto por flag.
        'puede_chat_web': (
            mods.get('chat_web', False)
            and (is_supervisor(request.user) or bool(getattr(profile, 'puede_chat_web', False)))
            if user_authenticated else False
        ),
    }

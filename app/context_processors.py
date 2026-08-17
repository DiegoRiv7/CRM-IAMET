import os

from .views import is_supervisor, is_engineer
from .models import UserProfile

# Feature flag de "Mi día" (icono del sidebar). Nació OCULTO por default para
# el soft-launch; con Mi Asistente listo para liberar (2026-08-17) el default
# es VISIBLE en todos lados — el merge a producción basta, sin tocar su .env.
# Para ocultarlo en un ambiente: RESUMEN_HABILITADO=0 en su .env.
RESUMEN_HABILITADO = os.environ.get('RESUMEN_HABILITADO', '1') == '1'

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

    return {
        'is_supervisor': is_supervisor(request.user) if user_authenticated else False,
        'is_engineer': is_engineer(request.user) if user_authenticated else False,
        'user_profile': profile,
        'resumen_habilitado': RESUMEN_HABILITADO,
    }

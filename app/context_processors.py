import os

from .views import is_supervisor, is_engineer
from .models import UserProfile

# Feature flag: la sección "Resumen" (icono del sidebar) solo se muestra
# donde el .env tenga RESUMEN_HABILITADO=1 (pruebas). En producción, sin la
# variable, el icono queda OCULTO — la funcionalidad completa sigue
# desplegada e intacta, solo invisible para los usuarios.
RESUMEN_HABILITADO = os.environ.get('RESUMEN_HABILITADO', '0') == '1'

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

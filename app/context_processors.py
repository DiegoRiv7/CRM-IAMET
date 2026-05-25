from django.conf import settings

from .views import is_supervisor, is_engineer
from .models import UserProfile

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
        # Feature flag para mostrar/ocultar el módulo Reportes en el sidebar.
        # Default OFF; se enciende con FEATURE_REPORTES_VISIBLE=1 en el env.
        'feature_reportes_visible': getattr(settings, 'FEATURE_REPORTES_VISIBLE', False),
    }

from .views import is_supervisor, is_engineer

def supervisor_flag(request):
    user_authenticated = request.user.is_authenticated
    return {
        'is_supervisor': is_supervisor(request.user) if user_authenticated else False,
        'is_engineer': is_engineer(request.user) if user_authenticated else False
    }

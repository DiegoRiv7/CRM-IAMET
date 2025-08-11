# Agregar este endpoint al archivo views.py de la app

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt
import json

@login_required
@require_http_methods(["GET"])
def opportunities_count_api(request):
    """API endpoint para obtener el conteo de oportunidades y la más reciente"""
    try:
        # Obtener todas las oportunidades del usuario
        user_opportunities = TodoItem.objects.filter(usuario=request.user).order_by('-id')
        
        # Contar total
        total_count = user_opportunities.count()
        
        # Obtener la más reciente
        latest_opportunity = None
        if user_opportunities.exists():
            latest = user_opportunities.first()
            latest_opportunity = {
                'id': latest.id,
                'name': latest.oportunidad,
                'client_name': latest.cliente.nombre_empresa if latest.cliente else None,
                'created_at': latest.id,  # Usamos el ID como indicador de recencia
                'amount': str(latest.monto) if latest.monto else None,
            }
        
        return JsonResponse({
            'count': total_count,
            'latest_opportunity': latest_opportunity,
            'success': True
        })
        
    except Exception as e:
        return JsonResponse({
            'error': str(e),
            'success': False
        }, status=500)


# También agregar esta URL al urls.py de la app:
# path('api/opportunities-count/', views.opportunities_count_api, name='opportunities_count_api'),
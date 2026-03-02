# cartera_clientes/app/templatetags/app_filters.py

from django import template
from decimal import Decimal, InvalidOperation
import locale
from django.utils import timezone
from zoneinfo import ZoneInfo
from django.contrib.auth.models import User
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter
def tijuana_time(value, format_string='d/m/Y H:i'):
    """
    Convierte una fecha UTC a tiempo de Tijuana y la formatea.
    Uso: {{ fecha|tijuana_time:"d/m/Y" }}
    """
    if not value:
        return ""
    
    try:
        # Convertir a zona horaria de Tijuana
        tijuana_tz = ZoneInfo('America/Tijuana')
        if value.tzinfo is None:
            # Si no tiene timezone info, asumir UTC
            value = timezone.make_aware(value, timezone.utc)
        tijuana_datetime = value.astimezone(tijuana_tz)
        
        # Formatear usando el formato de Django
        from django.template.defaultfilters import date
        return date(tijuana_datetime, format_string)
    except Exception:
        return value

@register.filter
def format_currency_es(value):
    """
    Formatea un valor numérico como moneda en formato mexicano (MXN).
    Ejemplo: 1234.56 -> 1,234.56
    """
    if value is None:
        return "0.00" # Retorna un valor predeterminado si el valor es None

    try:
        # Intenta convertir el valor a Decimal para una precisión adecuada
        decimal_value = Decimal(value)
    except InvalidOperation:
        # Si no es un número válido, retorna el valor original o un mensaje de error
        return value # O puedes devolver "Formato inválido"

    # Formato manual: separador de miles = ',', decimal = '.'
    formatted_value = f"{decimal_value:,.2f}"

    return formatted_value

@register.filter
def format_currency_short(value):
    """
    Formatea un valor como moneda sin centavos. Ej: 50000.00 -> 50,000
    """
    if value is None:
        return "0"
    try:
        decimal_value = Decimal(value)
    except InvalidOperation:
        return value
    return f"{int(decimal_value):,}"

@register.filter
def div(value, arg):
    """
    Realiza una división de dos números.
    """
    try:
        # Convierte ambos valores a float para la operación de división
        numerator = float(value)
        denominator = float(arg)
        if denominator == 0:
            return value # Evita la división por cero, retorna el valor original
        return numerator / denominator
    except (ValueError, TypeError):
        # Captura errores si los valores no son numéricos
        return value # Retorna el valor original si hay un error

@register.filter
def mul(value, arg):
    """
    Realiza una multiplicación de dos números.
    """
    try:
        # Convierte ambos valores a float para la operación de multiplicación
        return float(value) * float(arg)
    except (ValueError, TypeError):
        # Captura errores si los valores no son numéricos
        return value # Retorna el valor original si hay un error

@register.filter
def user_avatar(user, size="40"):
    """
    Genera HTML para el avatar de un usuario (foto o animado).
    Uso: {{ user|user_avatar:"60" }}
    """
    if not user:
        return ""
    
    try:
        # Intentar obtener el perfil del usuario
        profile = getattr(user, 'userprofile', None)
        if not profile:
            # Si no tiene perfil, mostrar iniciales
            initials = user.get_full_name()[:2].upper() if user.get_full_name() else user.username[:2].upper()
            return mark_safe(f'''
                <div style="width: {size}px; height: {size}px; border-radius: 50%; background: #007AFF; color: white; 
                     display: flex; align-items: center; justify-content: center; font-weight: bold; 
                     font-size: {int(size)//2.5}px;">{initials}</div>
            ''')
        
        # Si tiene foto custom
        if profile.avatar:
            return mark_safe(f'''
                <img src="{profile.avatar.url}" alt="{user.get_full_name() or user.username}" 
                     style="width: {size}px; height: {size}px; border-radius: 50%; object-fit: cover; 
                     border: 2px solid #007AFF;" />
            ''')
        
        # Si usa avatar animado
        elif profile.usar_animado:
            avatar_type = profile.avatar_tipo or '1'
            
            # Definir gradientes para cada tipo
            gradients = {
                'dinosaur': 'linear-gradient(135deg,#4ade80 0%,#22c55e 50%,#16a34a 100%)',
                'panda': 'linear-gradient(135deg,#f3f4f6 0%,#e5e7eb 50%,#d1d5db 100%)',
                'eagle': 'linear-gradient(135deg,#fbbf24 0%,#f59e0b 50%,#d97706 100%)',
                'shark': 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 50%,#0369a1 100%)',
                'fox-hero': 'linear-gradient(135deg, #ff6b47 0%, #ff4500 50%, #ff8c00 100%)',
                'lobo': 'linear-gradient(135deg, #6b7280 0%, #4b5563 50%, #1f2937 100%)',
                'buho': 'linear-gradient(135deg, #8d5524 0%, #654321 50%, #4a2c0f 100%)',
                'axolote': 'linear-gradient(135deg, #f472b6 0%, #ec4899 50%, #db2777 100%)',
                'cocodrilo': 'linear-gradient(135deg, #166534 0%, #15803d 50%, #16a34a 100%)',
                '1': 'linear-gradient(135deg, #00cfff 0%, #ff00c8 100%)'
            }
            
            # Definir las imágenes para cada tipo de avatar
            avatar_images = {
                'dinosaur': '/static/images/dinosaurio.jpeg',
                'panda': '/static/images/panda.jpeg', 
                'eagle': '/static/images/aguila.jpeg',
                'shark': '/static/images/tiburon.jpeg',
                'fox-hero': '/static/images/fox-hero-avatar.jpeg',
                'lobo': '/static/images/lobo.jpeg',
                'buho': '/static/images/buho.jpeg',
                'axolote': '/static/images/axolote.jpeg',
                'cocodrilo': '/static/images/cocodrilo.jpeg',
                '1': None  # Para mostrar iniciales
            }
            
            avatar_image_url = avatar_images.get(avatar_type)
            gradient = gradients.get(avatar_type, gradients['1'])
            
            if avatar_image_url:
                # Mostrar imagen del avatar
                return mark_safe(f'''
                    <div style="width: {size}px; height: {size}px; border-radius: 50%; 
                         background: {gradient}; display: flex; align-items: center; 
                         justify-content: center; border: 2px solid #007AFF; overflow: hidden;">
                        <img src="{avatar_image_url}" alt="Avatar" 
                             style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />
                    </div>
                ''')
            else:
                # Mostrar iniciales para avatar tipo '1' o desconocido
                initials = user.get_full_name()[:2].upper() if user.get_full_name() else user.username[:2].upper()
                return mark_safe(f'''
                    <div style="width: {size}px; height: {size}px; border-radius: 50%; 
                         background: {gradient}; color: white; 
                         display: flex; align-items: center; justify-content: center; font-weight: bold; 
                         font-size: {int(size)//2.5}px; border: 2px solid #007AFF;">{initials}</div>
                ''')
        
        # Si no tiene nada configurado, mostrar iniciales
        else:
            initials = user.get_full_name()[:2].upper() if user.get_full_name() else user.username[:2].upper()
            return mark_safe(f'''
                <div style="width: {size}px; height: {size}px; border-radius: 50%; background: #007AFF; color: white; 
                     display: flex; align-items: center; justify-content: center; font-weight: bold; 
                     font-size: {int(size)//2.5}px; border: 2px solid #007AFF;">{initials}</div>
            ''')
            
    except Exception as e:
        # En caso de error, mostrar iniciales básicas
        initials = user.username[:2].upper() if hasattr(user, 'username') else "??"
        return mark_safe(f'''
            <div style="width: {size}px; height: {size}px; border-radius: 50%; background: #666; color: white; 
                 display: flex; align-items: center; justify-content: center; font-weight: bold; 
                 font-size: {int(size)//2.5}px;">{initials}</div>
        ''')


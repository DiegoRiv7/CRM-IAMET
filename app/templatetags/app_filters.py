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
            
            # Definir los SVGs para cada tipo de avatar
            avatar_svgs = {
                'dinosaur': '''
                    <svg viewBox="0 0 48 48" fill="none" style="width: 80%; height: 80%;">
                        <ellipse cx="24" cy="28" rx="12" ry="8" fill="#22c55e"/>
                        <ellipse cx="18" cy="18" rx="10" ry="8" fill="#4ade80"/>
                        <ellipse cx="12" cy="18" rx="6" ry="4" fill="#16a34a"/>
                        <circle cx="15" cy="15" r="2" fill="#fff"/>
                        <circle cx="21" cy="15" r="2" fill="#fff"/>
                        <circle cx="15" cy="15" r="1" fill="#000"/>
                        <circle cx="21" cy="15" r="1" fill="#000"/>
                        <polygon points="9,16 11,18 9,20" fill="#fff"/>
                        <polygon points="11,16 13,18 11,20" fill="#fff"/>
                    </svg>
                ''',
                'panda': '''
                    <svg viewBox="0 0 48 48" fill="none" style="width: 80%; height: 80%;">
                        <circle cx="15" cy="12" r="6" fill="#000"/>
                        <circle cx="33" cy="12" r="6" fill="#000"/>
                        <circle cx="24" cy="20" r="12" fill="#f9fafb"/>
                        <circle cx="24" cy="20" r="10" fill="#fff"/>
                        <ellipse cx="20" cy="18" rx="4" ry="6" fill="#000"/>
                        <ellipse cx="28" cy="18" rx="4" ry="6" fill="#000"/>
                        <circle cx="20" cy="18" r="2.5" fill="#fff"/>
                        <circle cx="28" cy="18" r="2.5" fill="#fff"/>
                        <circle cx="20" cy="18" r="1.5" fill="#000"/>
                        <circle cx="28" cy="18" r="1.5" fill="#000"/>
                        <ellipse cx="24" cy="22" rx="2" ry="1.5" fill="#000"/>
                    </svg>
                ''',
                'eagle': '''
                    <svg viewBox="0 0 48 48" fill="none" style="width: 80%; height: 80%;">
                        <ellipse cx="24" cy="28" rx="8" ry="12" fill="#f59e0b"/>
                        <ellipse cx="24" cy="28" rx="6" ry="10" fill="#fbbf24"/>
                        <circle cx="24" cy="16" r="8" fill="#f9fafb"/>
                        <circle cx="24" cy="16" r="6" fill="#fff"/>
                        <polygon points="24,18 20,22 24,20" fill="#fbbf24"/>
                        <circle cx="21" cy="14" r="2" fill="#fbbf24"/>
                        <circle cx="27" cy="14" r="2" fill="#fbbf24"/>
                        <circle cx="21" cy="14" r="1.5" fill="#000"/>
                        <circle cx="27" cy="14" r="1.5" fill="#000"/>
                    </svg>
                ''',
                'shark': '''
                    <svg viewBox="0 0 48 48" fill="none" style="width: 80%; height: 80%;">
                        <ellipse cx="24" cy="24" rx="16" ry="8" fill="#0284c7"/>
                        <ellipse cx="24" cy="24" rx="14" ry="6" fill="#0ea5e9"/>
                        <polygon points="8,24 20,18 20,30" fill="#0369a1"/>
                        <circle cx="16" cy="22" r="3" fill="#000"/>
                        <circle cx="16" cy="22" r="2" fill="#fff"/>
                        <circle cx="17" cy="21" r="1" fill="#000"/>
                        <polygon points="8,24 12,26 10,28" fill="#fff"/>
                        <polygon points="10,24 14,26 12,28" fill="#fff"/>
                    </svg>
                ''',
                'fox-hero': '''
                    <img src="/static/images/fox-hero-avatar.jpeg" alt="Zorro Súper Héroe" 
                         style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />
                ''',
                '1': '''
                    <svg viewBox="0 0 48 48" fill="none" style="width: 70%; height: 70%;">
                        <circle cx="24" cy="24" r="20" stroke="#fff" stroke-width="4" opacity="0.2"/>
                        <path d="M24 8a8 8 0 018 8c0 4-3 8-8 8s-8-4-8-8a8 8 0 018-8z" fill="#fff"/>
                        <circle cx="24" cy="22" r="4" fill="#fff"/>
                        <ellipse cx="24" cy="34" rx="10" ry="4" fill="#fff" opacity="0.7"/>
                    </svg>
                '''
            }
            
            # Definir gradientes para cada tipo
            gradients = {
                'dinosaur': 'linear-gradient(135deg,#4ade80 0%,#22c55e 50%,#16a34a 100%)',
                'panda': 'linear-gradient(135deg,#f3f4f6 0%,#e5e7eb 50%,#d1d5db 100%)',
                'eagle': 'linear-gradient(135deg,#fbbf24 0%,#f59e0b 50%,#d97706 100%)',
                'shark': 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 50%,#0369a1 100%)',
                'fox-hero': 'linear-gradient(135deg, #ff6b47 0%, #ff4500 50%, #ff8c00 100%)',
                '1': 'linear-gradient(135deg, #00cfff 0%, #ff00c8 100%)'
            }
            
            svg_content = avatar_svgs.get(avatar_type, avatar_svgs['1'])
            gradient = gradients.get(avatar_type, gradients['1'])
            
            return mark_safe(f'''
                <div style="width: {size}px; height: {size}px; border-radius: 50%; 
                     background: {gradient}; display: flex; align-items: center; 
                     justify-content: center; border: 2px solid #007AFF;">
                    {svg_content}
                </div>
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


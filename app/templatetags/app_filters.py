# cartera_clientes/app/templatetags/app_filters.py

from django import template
from decimal import Decimal, InvalidOperation
import locale
from django.utils import timezone
from zoneinfo import ZoneInfo

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


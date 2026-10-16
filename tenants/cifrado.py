"""
Cifrado en reposo de los secretos de cada empresa (contraseña de su base, llave
del correo, secreto del SSO).

Antes vivían en claro en la BD de control: cualquiera con un VOLCADO de esa base
—y los respaldos la incluyen— se llevaba las credenciales de todas las empresas.
Ahora la columna guarda `enc:<token Fernet>` y la llave maestra vive FUERA de la
base, en el `.env` de la app (`TENANT_SECRETS_KEY`). Un dump sin esa llave no
sirve de nada.

Compatibilidad: un valor sin el prefijo `enc:` se devuelve tal cual (los que ya
estaban guardados en claro), así que el cambio no rompe nada y la migración de
los existentes se puede hacer cuando se quiera (`manage.py tenant_cifrar_secretos`).

OJO: el cifrado NO es determinista, así que estos campos no se pueden usar en
un `filter()`. No hace falta: siempre se leen del objeto ya cargado.
"""
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import models

PREFIJO = 'enc:'


def _llave():
    return (getattr(settings, 'TENANT_SECRETS_KEY', '') or '').strip()


def _fernet():
    from cryptography.fernet import Fernet
    llave = _llave()
    if not llave:
        return None
    try:
        return Fernet(llave.encode() if isinstance(llave, str) else llave)
    except Exception as exc:  # llave mal formada
        raise ImproperlyConfigured(
            f'TENANT_SECRETS_KEY no es una llave Fernet válida ({exc}). '
            'Genera una con: python -c "from cryptography.fernet import Fernet;'
            'print(Fernet.generate_key().decode())"'
        )


def cifrar(texto):
    """Devuelve `enc:<token>`. Sin llave configurada deja el texto como está
    (desarrollo y pruebas), para no obligar a configurarla en todos lados."""
    if texto is None or texto == '':
        return texto
    if isinstance(texto, str) and texto.startswith(PREFIJO):
        return texto  # ya venía cifrado
    f = _fernet()
    if f is None:
        return texto
    return PREFIJO + f.encrypt(str(texto).encode()).decode()


def descifrar(valor):
    """Inverso de cifrar(). Un valor sin prefijo es de los viejos, en claro."""
    if not isinstance(valor, str) or not valor.startswith(PREFIJO):
        return valor
    f = _fernet()
    if f is None:
        # Hay datos cifrados pero no hay llave: fallar RUIDOSAMENTE. Devolver
        # basura haría que la empresa "no conecte" sin decir por qué.
        raise ImproperlyConfigured(
            'Hay secretos cifrados en la BD de control pero falta TENANT_SECRETS_KEY. '
            'Sin esa llave no se puede abrir ninguna empresa.'
        )
    from cryptography.fernet import InvalidToken
    try:
        return f.decrypt(valor[len(PREFIJO):].encode()).decode()
    except InvalidToken:
        raise ImproperlyConfigured(
            'TENANT_SECRETS_KEY no corresponde a los secretos guardados '
            '(¿se cambió la llave?). Restaura la llave original.'
        )


class CampoCifrado(models.CharField):
    """CharField que se guarda cifrado y se lee descifrado, sin que el resto
    del código se entere."""

    def from_db_value(self, value, expression, connection):
        return descifrar(value)

    def get_prep_value(self, value):
        return cifrar(super().get_prep_value(value))

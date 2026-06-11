from django.apps import AppConfig


class AppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'app'

    def ready(self):
        # Signals del sync entre usuarios (CrmCambio) — ver signals_sync.py.
        from . import signals_sync  # noqa: F401

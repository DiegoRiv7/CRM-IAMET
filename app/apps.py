from django.apps import AppConfig


class AppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'app'

    def ready(self):
        # Importa signal handlers para que se registren en el arranque.
        try:
            from . import signals  # noqa: F401
        except Exception:
            # Si los signals fallan, no queremos romper el arranque del proceso.
            import logging
            logging.getLogger(__name__).exception('No se pudieron registrar los signals de app')

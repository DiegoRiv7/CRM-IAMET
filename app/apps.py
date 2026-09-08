from django.apps import AppConfig


class AppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'app'

    def ready(self):
        # Signals del sync entre usuarios (CrmCambio) — ver signals_sync.py.
        from . import signals_sync  # noqa: F401
        # MULTIEMPRESA: invalidar el cache de EmpresaConfig/OpcionCatalogo al guardar.
        from django.db.models.signals import post_delete, post_save
        from .empresa import invalidar_cache
        from .models import EmpresaConfig, OpcionCatalogo
        for m in (EmpresaConfig, OpcionCatalogo):
            post_save.connect(lambda **kw: invalidar_cache(), sender=m, weak=False)
            post_delete.connect(lambda **kw: invalidar_cache(), sender=m, weak=False)

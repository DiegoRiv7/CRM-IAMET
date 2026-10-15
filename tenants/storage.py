"""
Media por empresa en modo bridge: MEDIA_ROOT/<slug>/... .

Las URLs no cambian (/media/archivo.jpg): es el tenant del request quien
decide en qué carpeta se escribe y se lee. Así los nombres de archivo de dos
empresas nunca chocan en el disco compartido y una empresa no puede adivinar
la ruta de otra: tenants.views.media solo sirve desde la subcarpeta del host.

Se activa con STORAGES['default'] = 'tenants.storage.TenantMediaStorage'
(settings.py, solo con TENANT_MODE). Sin tenant resuelto (comandos de consola
sin tenant_run, modo clásico) se comporta como FileSystemStorage normal.
"""
import os

from django.conf import settings
from django.core.files.storage import FileSystemStorage

from .context import get_current_tenant


def subcarpeta_tenant():
    t = get_current_tenant()
    return t.slug if t is not None else ''


class TenantMediaStorage(FileSystemStorage):
    # FileSystemStorage cachea `base_location`/`location` por instancia; aquí
    # se recalculan en cada acceso porque el tenant cambia por request.
    @property
    def base_location(self):
        base = self._value_or_setting(self._location, settings.MEDIA_ROOT)
        sub = subcarpeta_tenant()
        return os.path.join(base, sub) if sub else base

    @property
    def location(self):
        return os.path.abspath(self.base_location)

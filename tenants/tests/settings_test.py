"""
Settings MÍNIMOS para probar el modo bridge sin cargar `app` (146 modelos y
sus dependencias pesadas). Se ejecuta así, desde la raíz del repo:

  DJANGO_SETTINGS_MODULE=tenants.tests.settings_test python -m django test tenants

Los alias de tenant se registran como SQLite en memoria (TENANT_DB_ENGINE):
el router y el middleware no dependen del motor.
"""
SECRET_KEY = 'solo-pruebas'
DEBUG = True
USE_TZ = True
TIME_ZONE = 'UTC'
ALLOWED_HOSTS = ['*']
ROOT_URLCONF = 'tenants.tests.urls'

TENANT_MODE = True
TENANT_DB_ENGINE = 'django.db.backends.sqlite3'

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sessions',
    'tenants',
]

DATABASES = {
    'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'},
    'control': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'},
}
DATABASE_ROUTERS = ['tenants.router.TenantRouter']

MIDDLEWARE = ['tenants.middleware.TenantMiddleware']
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

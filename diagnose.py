"""
Diagnóstico completo de APIs que están fallando con 500.
Ejecutar dentro del contenedor Docker:
  sudo docker compose exec web python diagnose.py
"""
import os, sys, traceback
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')

import django
django.setup()

from django.test import RequestFactory
from django.contrib.auth.models import User

factory = RequestFactory()
user = User.objects.filter(is_superuser=True).first()
if not user:
    user = User.objects.first()

print(f"=== Usando usuario: {user} (id={user.id}) ===\n")

# ─── Test 1: GET /app/api/actividades/ ───────────────────────────
print("── TEST 1: actividad_list_create (GET) ──")
try:
    from app.views import actividad_list_create
    req = factory.get('/app/api/actividades/')
    req.user = user
    resp = actividad_list_create(req)
    print(f"   Status: {resp.status_code}")
    body = resp.content.decode('utf-8')
    if resp.status_code != 200:
        print(f"   Body: {body[:1000]}")
    else:
        print(f"   OK — {len(body)} bytes")
except Exception as e:
    traceback.print_exc()

# ─── Test 2: GET /app/api/oportunidad/<id>/tareas/ ───────────────
print("\n── TEST 2: api_tareas_oportunidad (GET) ──")
try:
    from app.models import TodoItem
    opp = TodoItem.objects.first()
    if opp:
        from app.views import api_tareas_oportunidad
        req = factory.get(f'/app/api/oportunidad/{opp.id}/tareas/')
        req.user = user
        resp = api_tareas_oportunidad(req, opp.id)
        print(f"   Status: {resp.status_code}")
        body = resp.content.decode('utf-8')
        if resp.status_code != 200:
            print(f"   Body: {body[:1000]}")
        else:
            print(f"   OK — {len(body)} bytes")
    else:
        print("   No hay oportunidades en la BD")
except Exception as e:
    traceback.print_exc()

# ─── Test 3: Verificar columnas de app_actividad ─────────────────
print("\n── TEST 3: Columnas de app_actividad ──")
try:
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("SHOW COLUMNS FROM app_actividad")
        cols = [row[0] for row in cursor.fetchall()]
        print(f"   Columnas: {cols}")
except Exception as e:
    traceback.print_exc()

# ─── Test 4: Verificar columnas de app_tareaoportunidad ──────────
print("\n── TEST 4: Columnas de app_tareaoportunidad ──")
try:
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("SHOW COLUMNS FROM app_tareaoportunidad")
        cols = [row[0] for row in cursor.fetchall()]
        print(f"   Columnas: {cols}")
except Exception as e:
    traceback.print_exc()

# ─── Test 5: Verificar columnas de app_tarea ─────────────────────
print("\n── TEST 5: Columnas de app_tarea ──")
try:
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute("SHOW COLUMNS FROM app_tarea")
        cols = [row[0] for row in cursor.fetchall()]
        print(f"   Columnas: {cols}")
except Exception as e:
    traceback.print_exc()

# ─── Test 6: Verificar Nginx media config ────────────────────────
print("\n── TEST 6: Verificar archivos media ──")
import os
media_root = '/app/media' if os.path.isdir('/app/media') else '/code/media'
if os.path.isdir(media_root):
    print(f"   MEDIA_ROOT existe: {media_root}")
    for dirpath, dirnames, filenames in os.walk(media_root):
        for f in filenames[:10]:
            full = os.path.join(dirpath, f)
            print(f"     {full} ({os.path.getsize(full)} bytes)")
        if len(filenames) > 10:
            print(f"     ... y {len(filenames)-10} más")
        break
else:
    print(f"   ⚠️ No existe /app/media ni /code/media")
    from django.conf import settings
    print(f"   MEDIA_ROOT en settings: {settings.MEDIA_ROOT}")
    if os.path.isdir(settings.MEDIA_ROOT):
        print(f"   ✅ Existe: {settings.MEDIA_ROOT}")
    else:
        print(f"   ❌ NO existe: {settings.MEDIA_ROOT}")

print("\n=== Diagnóstico completo ===")

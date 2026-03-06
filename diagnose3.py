"""
diagnose3.py — Verificar estado actual de todo
Ejecutar: sudo docker compose exec web python diagnose3.py
"""
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.db import connection
from django.test import RequestFactory
from django.contrib.auth.models import User

print("=== DIAGNÓSTICO RÁPIDO ===\n")

# 1. Verificar columnas de app_actividad
print("── Columnas app_actividad ──")
with connection.cursor() as cursor:
    cursor.execute("SHOW COLUMNS FROM app_actividad")
    cols = [row[0] for row in cursor.fetchall()]
    print(f"   {cols}")
    if 'tipo_actividad' in cols:
        print("   ✅ tipo_actividad EXISTS")
    else:
        print("   ❌ tipo_actividad MISSING — fixing now...")
        cursor.execute("ALTER TABLE app_actividad ADD COLUMN tipo_actividad VARCHAR(20) NOT NULL DEFAULT 'otro';")
        print("   ✅ tipo_actividad ADDED")

# 2. Test actividades API
print("\n── Test actividades API ──")
try:
    from app.views import actividad_list_create
    user = User.objects.first()
    factory = RequestFactory()
    req = factory.get('/app/api/actividades/')
    req.user = user
    resp = actividad_list_create(req)
    print(f"   Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"   Error: {resp.content.decode('utf-8')[:500]}")
    else:
        print(f"   ✅ OK — {len(resp.content)} bytes")
except Exception as e:
    import traceback
    traceback.print_exc()

# 3. Test crear tarea
print("\n── Test crear tarea ──")
try:
    import json
    from app.views import api_crear_tarea
    user = User.objects.first()
    factory = RequestFactory()
    payload = json.dumps({'nombre': 'TEST DIAGNÓSTICO', 'prioridad': 'media'})
    req = factory.post('/app/api/crear-tarea/', data=payload, content_type='application/json')
    req.user = user
    resp = api_crear_tarea(req)
    print(f"   Status: {resp.status_code}")
    if resp.status_code >= 400:
        print(f"   Error: {resp.content.decode('utf-8')[:500]}")
    else:
        data = json.loads(resp.content)
        print(f"   ✅ Tarea creada id={data.get('tarea',{}).get('id')}")
        from app.models import Tarea
        Tarea.objects.filter(id=data['tarea']['id']).delete()
        print("   🧹 Tarea de prueba eliminada")
except Exception as e:
    import traceback
    traceback.print_exc()

# 4. Verificar proyecto_id nullable
print("\n── Verificar proyecto_id IS NULL allowed ──")
with connection.cursor() as cursor:
    cursor.execute("SHOW COLUMNS FROM app_tarea WHERE Field = 'proyecto_id'")
    row = cursor.fetchone()
    if row:
        nullable = row[2]  # 'YES' or 'NO'
        print(f"   proyecto_id Null={nullable}")
        if nullable == 'YES':
            print("   ✅ proyecto_id allows NULL")
        else:
            print("   ❌ proyecto_id does NOT allow NULL — still broken")
    else:
        print("   ❌ proyecto_id column not found!")

print("\n=== FIN ===")

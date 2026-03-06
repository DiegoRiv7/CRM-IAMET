"""
diagnose2.py — Diagnóstico completo de la creación de tareas
Ejecutar: sudo docker compose exec web python diagnose2.py
"""
import os, sys, traceback, json
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')

import django
django.setup()

from django.test import RequestFactory
from django.contrib.auth.models import User
from django.db import connection

factory = RequestFactory()
user = User.objects.filter(is_superuser=True).first()
if not user:
    user = User.objects.first()

print(f"=== Usando usuario: {user} (id={user.id}) ===\n")

# ─── Test 1: Verificar tablas M2M de Tarea ────────────────────────
print("── TEST 1: Tablas M2M de Tarea ──")
m2m_tables = ['app_tarea_participantes', 'app_tarea_observadores']
for t in m2m_tables:
    try:
        with connection.cursor() as cursor:
            cursor.execute(f"SHOW COLUMNS FROM {t}")
            cols = [row[0] for row in cursor.fetchall()]
            print(f"   ✅ {t}: {cols}")
    except Exception as e:
        print(f"   ❌ {t}: {e}")

# ─── Test 2: Verificar TareaComentario ─────────────────────────────
print("\n── TEST 2: Tabla app_tareacomentario ──")
try:
    with connection.cursor() as cursor:
        cursor.execute("SHOW COLUMNS FROM app_tareacomentario")
        cols = [row[0] for row in cursor.fetchall()]
        print(f"   ✅ Columnas: {cols}")
except Exception as e:
    print(f"   ❌ Error: {e}")

# ─── Test 3: Simular creación de tarea ─────────────────────────────
print("\n── TEST 3: Simular POST crear-tarea ──")
try:
    from app.views import api_crear_tarea
    payload = json.dumps({
        'nombre': 'TAREA DE PRUEBA DIAGNÓSTICO',
        'descripcion': 'Prueba automática',
        'prioridad': 'media',
    })
    req = factory.post('/app/api/crear-tarea/',
                       data=payload,
                       content_type='application/json')
    req.user = user
    resp = api_crear_tarea(req)
    print(f"   Status: {resp.status_code}")
    body = resp.content.decode('utf-8')
    if resp.status_code >= 400:
        print(f"   Body: {body[:2000]}")
    else:
        print(f"   ✅ OK — Tarea creada")
        # Limpiar tarea de prueba
        data = json.loads(body)
        if data.get('tarea', {}).get('id'):
            from app.models import Tarea
            Tarea.objects.filter(id=data['tarea']['id']).delete()
            print(f"   🧹 Limpiada tarea de prueba id={data['tarea']['id']}")
except Exception as e:
    traceback.print_exc()

# ─── Test 4: Simular creación con asignado ─────────────────────────
print("\n── TEST 4: Simular POST crear-tarea con asignado ──")
try:
    other_user = User.objects.exclude(id=user.id).first()
    assign_id = other_user.id if other_user else user.id
    payload = json.dumps({
        'nombre': 'TAREA PRUEBA CON ASIGNADO',
        'descripcion': 'Prueba con responsable',
        'prioridad': 'alta',
        'asignado_a': assign_id,
    })
    req = factory.post('/app/api/crear-tarea/',
                       data=payload,
                       content_type='application/json')
    req.user = user
    resp = api_crear_tarea(req)
    print(f"   Status: {resp.status_code}")
    body = resp.content.decode('utf-8')
    if resp.status_code >= 400:
        print(f"   Body: {body[:2000]}")
    else:
        print(f"   ✅ OK — Tarea creada con asignado")
        data = json.loads(body)
        if data.get('tarea', {}).get('id'):
            from app.models import Tarea
            Tarea.objects.filter(id=data['tarea']['id']).delete()
            print(f"   🧹 Limpiada tarea de prueba id={data['tarea']['id']}")
except Exception as e:
    traceback.print_exc()

# ─── Test 5: Verificar función crear_notificacion ─────────────────
print("\n── TEST 5: Verificar crear_notificacion existe ──")
try:
    from app.views import crear_notificacion
    print(f"   ✅ crear_notificacion encontrada")
except ImportError:
    try:
        from app.models import crear_notificacion
        print(f"   ✅ crear_notificacion encontrada en models")
    except ImportError:
        print(f"   ❌ crear_notificacion NO encontrada — esto causaría error")

# ─── Test 6: Verificar tabla Notificacion ──────────────────────────
print("\n── TEST 6: Tabla de notificaciones ──")
try:
    with connection.cursor() as cursor:
        cursor.execute("SHOW TABLES LIKE '%notificacion%'")
        tables = [row[0] for row in cursor.fetchall()]
        print(f"   Tablas: {tables}")
        for t in tables:
            cursor.execute(f"SHOW COLUMNS FROM {t}")
            cols = [row[0] for row in cursor.fetchall()]
            print(f"   {t}: {cols}")
except Exception as e:
    print(f"   ❌ Error: {e}")

print("\n=== Diagnóstico completo ===")

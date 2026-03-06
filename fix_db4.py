"""
fix_db4.py — Agregar columna tipo_actividad a app_actividad
Ejecutar: sudo docker compose exec web python fix_db4.py
"""
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.db import connection

statements = [
    "ALTER TABLE app_actividad ADD COLUMN tipo_actividad VARCHAR(20) NOT NULL DEFAULT 'otro';",
]

with connection.cursor() as cursor:
    for sql in statements:
        try:
            cursor.execute(sql)
            print(f"✅ Executed: {sql}")
        except Exception as e:
            print(f"⚠️ Ignored/Error on '{sql}': {e}")

print("\n✅ Fix completado. Reinicia web: sudo docker compose restart web")

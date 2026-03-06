"""
fix_db5.py — Permitir NULL en proyecto_id de app_tarea
Ejecutar: sudo docker compose exec web python fix_db5.py
"""
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.db import connection

statements = [
    "ALTER TABLE app_tarea MODIFY COLUMN proyecto_id INT NULL;",
]

with connection.cursor() as cursor:
    for sql in statements:
        try:
            cursor.execute(sql)
            print(f"✅ Executed: {sql}")
        except Exception as e:
            print(f"⚠️ Error: {e}")

print("\n✅ Fix completado.")

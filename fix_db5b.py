"""
fix_db5b.py — Permitir NULL en proyecto_id (quitando FK primero)
Ejecutar: sudo docker compose exec web python fix_db5b.py
"""
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.db import connection

with connection.cursor() as cursor:
    # 1. Quitar la foreign key constraint
    try:
        cursor.execute("ALTER TABLE app_tarea DROP FOREIGN KEY app_tarea_proyecto_id_9743f5f6_fk_app_proyecto_id;")
        print("✅ 1. FK constraint eliminada")
    except Exception as e:
        print(f"⚠️ 1. FK: {e}")

    # 2. Modificar la columna para permitir NULL
    try:
        cursor.execute("ALTER TABLE app_tarea MODIFY COLUMN proyecto_id INT NULL;")
        print("✅ 2. proyecto_id ahora acepta NULL")
    except Exception as e:
        print(f"⚠️ 2. MODIFY: {e}")

    # 3. Re-agregar la FK constraint (ahora permitiendo NULL)
    try:
        cursor.execute("""
            ALTER TABLE app_tarea 
            ADD CONSTRAINT app_tarea_proyecto_id_9743f5f6_fk_app_proyecto_id 
            FOREIGN KEY (proyecto_id) REFERENCES app_proyecto(id) 
            ON DELETE CASCADE;
        """)
        print("✅ 3. FK constraint re-agregada")
    except Exception as e:
        print(f"⚠️ 3. FK re-add: {e}")

print("\n✅ Fix completado.")

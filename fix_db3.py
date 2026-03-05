import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.db import connection

queries = [
    # Actividades / Tareas Oportunidad que pueden estar crasheando por foreign keys
    "ALTER TABLE app_tareaoportunidad ADD COLUMN bitrix_task_id INT NULL;",
]

def fix_db():
    with connection.cursor() as cursor:
        for q in queries:
            try:
                cursor.execute(q)
                print(f"✅ Executed: {q}")
            except Exception as e:
                print(f"⚠️ Ignored/Error on '{q}': {e}")
                
if __name__ == '__main__':
    fix_db()

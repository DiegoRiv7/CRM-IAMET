import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.db import connection

queries = [
    # app_tarea missing col
    "ALTER TABLE app_tarea ADD COLUMN oportunidad_id INT NULL;",
    "ALTER TABLE app_tarea ADD COLUMN cliente_id INT NULL;",
    "ALTER TABLE app_tarea ADD COLUMN bitrix_task_id INT NULL;",
    "ALTER TABLE app_tarea ADD COLUMN tiempo_trabajado varchar(20) DEFAULT '00:00:00';",
    "ALTER TABLE app_tarea ADD COLUMN trabajando_actualmente TINYINT(1) DEFAULT 0;",
    "ALTER TABLE app_tarea ADD COLUMN pausado TINYINT(1) DEFAULT 0;",
    "ALTER TABLE app_tarea ADD COLUMN porsentaje DECIMAL(5,2) DEFAULT 0;",
    "ALTER TABLE app_tarea ADD COLUMN fecha_completada DATETIME(6) NULL;",

    # app_actividad missing col
    "ALTER TABLE app_actividad ADD COLUMN oportunidad_id INT NULL;",
    "ALTER TABLE app_actividad ADD COLUMN color VARCHAR(7) DEFAULT '#007AFF';",

    # Muro missing col (just in case)
    "ALTER TABLE app_mensajeoportunidad ADD COLUMN editado TINYINT(1) DEFAULT 0;",
    "ALTER TABLE app_mensajeoportunidad ADD COLUMN reply_to_id INT NULL;",
]

def fix_db():
    with connection.cursor() as cursor:
        for q in queries:
            try:
                cursor.execute(q)
                print(f"✅ Executed: {q}")
            except Exception as e:
                # If column exists or other error, print it
                print(f"⚠️ Ignored/Error on '{q}': {e}")
                
if __name__ == '__main__':
    fix_db()

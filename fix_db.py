import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cartera_clientes.settings')
django.setup()

from django.db import connection

def fix_db():
    with connection.cursor() as cursor:
        try:
            cursor.execute("ALTER TABLE app_tarea ADD COLUMN fecha_inicio_sesion DATETIME(6) NULL;")
            print("✅ Se agregó la columna 'fecha_inicio_sesion' exitosamente.")
        except Exception as e:
            if "Duplicate column name" in str(e):
                print("✅ La columna ya existe, no es necesario crearla.")
            else:
                print(f"❌ Error al agregar columna: {e}")

if __name__ == '__main__':
    fix_db()

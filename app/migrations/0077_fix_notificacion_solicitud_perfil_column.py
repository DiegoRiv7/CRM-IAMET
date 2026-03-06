"""
Migration to ensure solicitud_perfil_id column exists in app_notificacion.
Migration 0070 was recorded as applied but the column may be missing from the DB.
This migration adds the column conditionally (IF NOT EXISTS for MySQL).
"""
from django.db import migrations


def add_column_if_missing(apps, schema_editor):
    db = schema_editor.connection
    vendor = db.vendor  # 'mysql', 'sqlite', etc.

    if vendor == 'mysql':
        cursor = db.cursor()
        cursor.execute("""
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'app_notificacion'
              AND COLUMN_NAME = 'solicitud_perfil_id'
        """)
        exists = cursor.fetchone()[0]
        if not exists:
            cursor.execute("""
                ALTER TABLE app_notificacion
                ADD COLUMN solicitud_perfil_id INT NULL,
                ADD CONSTRAINT app_notif_solicitud_fk
                    FOREIGN KEY (solicitud_perfil_id)
                    REFERENCES app_solicitudcambioperfil(id)
                    ON DELETE SET NULL
            """)
    elif vendor == 'sqlite':
        cursor = db.cursor()
        cursor.execute("PRAGMA table_info(app_notificacion)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'solicitud_perfil_id' not in cols:
            cursor.execute(
                "ALTER TABLE app_notificacion "
                "ADD COLUMN solicitud_perfil_id INTEGER NULL "
                "REFERENCES app_solicitudcambioperfil(id)"
            )


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0076_programacion_actividad'),
    ]

    operations = [
        migrations.RunPython(add_column_if_missing, migrations.RunPython.noop),
    ]

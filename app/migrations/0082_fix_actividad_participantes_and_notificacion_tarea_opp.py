"""
Fix two missing DB columns/tables that were never created or were dropped:
1. app_actividad_participantes table (M2M for Actividad.participantes, dropped in 0048)
2. app_notificacion.tarea_opp_id column (FK added in 0059 but missing in production DB)
"""
from django.db import migrations


def fix_notificacion_tarea_opp(apps, schema_editor):
    db = schema_editor.connection.vendor
    with schema_editor.connection.cursor() as cursor:
        if db == 'mysql':
            cursor.execute("""
                SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'app_notificacion'
                  AND COLUMN_NAME = 'tarea_opp_id'
            """)
            exists = cursor.fetchone()[0]
            if not exists:
                cursor.execute(
                    "ALTER TABLE app_notificacion "
                    "ADD COLUMN tarea_opp_id BIGINT NULL, "
                    "ADD INDEX app_notif_tarea_opp_idx (tarea_opp_id)"
                )
        elif db == 'sqlite':
            cursor.execute("PRAGMA table_info(app_notificacion)")
            cols = [row[1] for row in cursor.fetchall()]
            if 'tarea_opp_id' not in cols:
                cursor.execute(
                    "ALTER TABLE app_notificacion ADD COLUMN tarea_opp_id INTEGER NULL"
                )


def fix_actividad_participantes(apps, schema_editor):
    db = schema_editor.connection.vendor
    with schema_editor.connection.cursor() as cursor:
        if db == 'mysql':
            cursor.execute("""
                SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'app_actividad_participantes'
            """)
            exists = cursor.fetchone()[0]
            if not exists:
                cursor.execute("""
                    CREATE TABLE `app_actividad_participantes` (
                        `id` bigint NOT NULL AUTO_INCREMENT,
                        `actividad_id` bigint NOT NULL,
                        `user_id` int NOT NULL,
                        PRIMARY KEY (`id`),
                        UNIQUE KEY `app_actividad_participantes_actividad_id_user_id_uniq` (`actividad_id`, `user_id`),
                        KEY `app_actividad_participantes_actividad_id_idx` (`actividad_id`),
                        KEY `app_actividad_participantes_user_id_idx` (`user_id`),
                        CONSTRAINT `app_activ_part_actividad_fk` FOREIGN KEY (`actividad_id`) REFERENCES `app_actividad` (`id`) ON DELETE CASCADE,
                        CONSTRAINT `app_activ_part_user_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """)
        elif db == 'sqlite':
            cursor.execute("""
                SELECT COUNT(*) FROM sqlite_master
                WHERE type='table' AND name='app_actividad_participantes'
            """)
            exists = cursor.fetchone()[0]
            if not exists:
                cursor.execute("""
                    CREATE TABLE "app_actividad_participantes" (
                        "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                        "actividad_id" integer NOT NULL REFERENCES "app_actividad" ("id") DEFERRABLE INITIALLY DEFERRED,
                        "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                        UNIQUE ("actividad_id", "user_id")
                    )
                """)


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0081_mailcorreo_conexion'),
    ]

    operations = [
        migrations.RunPython(fix_notificacion_tarea_opp, migrations.RunPython.noop),
        migrations.RunPython(fix_actividad_participantes, migrations.RunPython.noop),
    ]

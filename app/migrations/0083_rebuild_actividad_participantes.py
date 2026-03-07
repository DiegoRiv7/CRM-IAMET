"""
Rebuild app_actividad_participantes table which exists with only 'id' column
(missing actividad_id and user_id). Drop and recreate with correct schema.
"""
from django.db import migrations


def rebuild_actividad_participantes(apps, schema_editor):
    db = schema_editor.connection.vendor
    with schema_editor.connection.cursor() as cursor:
        if db == 'mysql':
            # Check if actividad_id column is missing
            cursor.execute("""
                SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'app_actividad_participantes'
                  AND COLUMN_NAME = 'actividad_id'
            """)
            has_actividad_id = cursor.fetchone()[0]

            if not has_actividad_id:
                # Drop the incomplete table and recreate correctly
                cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
                cursor.execute("DROP TABLE IF EXISTS `app_actividad_participantes`")
                cursor.execute("""
                    CREATE TABLE `app_actividad_participantes` (
                        `id` bigint NOT NULL AUTO_INCREMENT,
                        `actividad_id` bigint NOT NULL,
                        `user_id` int NOT NULL,
                        PRIMARY KEY (`id`),
                        UNIQUE KEY `app_activ_part_unique` (`actividad_id`, `user_id`),
                        KEY `app_activ_part_act_idx` (`actividad_id`),
                        KEY `app_activ_part_usr_idx` (`user_id`),
                        CONSTRAINT `app_activ_part_act_fk` FOREIGN KEY (`actividad_id`) REFERENCES `app_actividad` (`id`) ON DELETE CASCADE,
                        CONSTRAINT `app_activ_part_usr_fk` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """)
                cursor.execute("SET FOREIGN_KEY_CHECKS = 1")

        elif db == 'sqlite':
            cursor.execute("PRAGMA table_info(app_actividad_participantes)")
            cols = [row[1] for row in cursor.fetchall()]
            if 'actividad_id' not in cols:
                cursor.execute("DROP TABLE IF EXISTS app_actividad_participantes")
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
        ('app', '0082_fix_actividad_participantes_and_notificacion_tarea_opp'),
    ]

    operations = [
        migrations.RunPython(rebuild_actividad_participantes, migrations.RunPython.noop),
    ]

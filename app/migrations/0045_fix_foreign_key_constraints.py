# Corrección de foreign key constraints para apuntar a app_proyecto

from django.db import migrations


def fix_fk_constraints(apps, schema_editor):
    """
    Drops old FK constraints (pointing to app_todoitem) and recreates them
    pointing to app_proyecto. On fresh databases these old constraints don't
    exist, so we check before dropping.
    """
    from django.db import connection
    with connection.cursor() as cursor:
        migrations_to_fix = [
            {
                'table': 'app_carpetaproyecto',
                'old_fk': 'app_carpetaproyecto_proyecto_id_5a032215_fk_app_todoitem_id',
                'new_fk': 'app_carpetaproyecto_proyecto_id_5a032215_fk_app_proyecto_id',
                'column': 'proyecto_id',
                'ref_table': 'app_proyecto',
            },
            {
                'table': 'app_archivoproyecto',
                'old_fk': 'app_archivoproyecto_proyecto_id_d809e875_fk_app_todoitem_id',
                'new_fk': 'app_archivoproyecto_proyecto_id_d809e875_fk_app_proyecto_id',
                'column': 'proyecto_id',
                'ref_table': 'app_proyecto',
            },
        ]
        for m in migrations_to_fix:
            # Only drop old FK if it exists (existing installations upgrading)
            cursor.execute("""
                SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE()
                  AND TABLE_NAME = %s
                  AND CONSTRAINT_NAME = %s
            """, [m['table'], m['old_fk']])
            if cursor.fetchone()[0] > 0:
                cursor.execute(
                    f"ALTER TABLE `{m['table']}` DROP FOREIGN KEY `{m['old_fk']}`"
                )

            # Only add new FK if it doesn't exist yet
            cursor.execute("""
                SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                WHERE CONSTRAINT_SCHEMA = DATABASE()
                  AND TABLE_NAME = %s
                  AND CONSTRAINT_NAME = %s
            """, [m['table'], m['new_fk']])
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    f"ALTER TABLE `{m['table']}` ADD CONSTRAINT `{m['new_fk']}` "
                    f"FOREIGN KEY (`{m['column']}`) REFERENCES `{m['ref_table']}` (`id`)"
                )


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0044_intercambio_navidad'),
    ]

    operations = [
        migrations.RunPython(fix_fk_constraints, migrations.RunPython.noop),
    ]

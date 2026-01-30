# Corrección de foreign key constraints para apuntar a app_proyecto

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0044_intercambio_navidad'),
    ]

    operations = [
        # Eliminar constraints existentes que apuntan a TodoItem
        migrations.RunSQL(
            "ALTER TABLE app_carpetaproyecto DROP FOREIGN KEY app_carpetaproyecto_proyecto_id_5a032215_fk_app_todoitem_id;",
            reverse_sql="ALTER TABLE app_carpetaproyecto ADD CONSTRAINT app_carpetaproyecto_proyecto_id_5a032215_fk_app_todoitem_id FOREIGN KEY (proyecto_id) REFERENCES app_todoitem (id);"
        ),
        migrations.RunSQL(
            "ALTER TABLE app_archivoproyecto DROP FOREIGN KEY app_archivoproyecto_proyecto_id_d809e875_fk_app_todoitem_id;",
            reverse_sql="ALTER TABLE app_archivoproyecto ADD CONSTRAINT app_archivoproyecto_proyecto_id_d809e875_fk_app_todoitem_id FOREIGN KEY (proyecto_id) REFERENCES app_todoitem (id);"
        ),
        
        # Crear nuevas constraints que apuntan a app_proyecto
        migrations.RunSQL(
            "ALTER TABLE app_carpetaproyecto ADD CONSTRAINT app_carpetaproyecto_proyecto_id_5a032215_fk_app_proyecto_id FOREIGN KEY (proyecto_id) REFERENCES app_proyecto (id);",
            reverse_sql="ALTER TABLE app_carpetaproyecto DROP FOREIGN KEY app_carpetaproyecto_proyecto_id_5a032215_fk_app_proyecto_id;"
        ),
        migrations.RunSQL(
            "ALTER TABLE app_archivoproyecto ADD CONSTRAINT app_archivoproyecto_proyecto_id_d809e875_fk_app_proyecto_id FOREIGN KEY (proyecto_id) REFERENCES app_proyecto (id);",
            reverse_sql="ALTER TABLE app_archivoproyecto DROP FOREIGN KEY app_archivoproyecto_proyecto_id_d809e875_fk_app_proyecto_id;"
        ),
    ]
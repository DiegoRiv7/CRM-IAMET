# Generated for performance optimization

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0019_alter_todoitem_usuario'),
    ]

    operations = [
        # Agregar índices para optimizar consultas comunes
        migrations.RunSQL(
            "CREATE INDEX IF NOT EXISTS idx_todoitem_fecha_creacion ON app_todoitem (fecha_creacion DESC);",
            reverse_sql="DROP INDEX IF EXISTS idx_todoitem_fecha_creacion;"
        ),
        migrations.RunSQL(
            "CREATE INDEX IF NOT EXISTS idx_todoitem_usuario_fecha ON app_todoitem (usuario_id, fecha_creacion DESC);",
            reverse_sql="DROP INDEX IF EXISTS idx_todoitem_usuario_fecha;"
        ),
        migrations.RunSQL(
            "CREATE INDEX IF NOT EXISTS idx_todoitem_area ON app_todoitem (area);",
            reverse_sql="DROP INDEX IF EXISTS idx_todoitem_area;"
        ),
        migrations.RunSQL(
            "CREATE INDEX IF NOT EXISTS idx_todoitem_producto ON app_todoitem (producto);",
            reverse_sql="DROP INDEX IF EXISTS idx_todoitem_producto;"
        ),
    ]
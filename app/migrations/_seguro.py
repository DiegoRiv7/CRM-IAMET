"""
Operaciones de migración tolerantes (MULTIEMPRESA, Fase 2).

Las bases de IAMET se migraron por etapas y algunas migraciones viejas se
editaron después de aplicarse (p. ej. 0063 ya crea MailCorreo.oportunidad y
0143 lo vuelve a agregar). En una base NUEVA, que reproduce la cadena desde
cero, esas migraciones truenan con "Duplicate column name". Estas operaciones
hacen lo mismo que las de Django pero se saltan el cambio en la BD cuando ya
está hecho; el estado de Django se registra igual.
"""
from django.db import migrations


def _columnas(schema_editor, tabla):
    with schema_editor.connection.cursor() as cursor:
        try:
            return {c.name for c in schema_editor.connection.introspection.get_table_description(cursor, tabla)}
        except Exception:
            return set()


def _tablas(schema_editor):
    return set(schema_editor.connection.introspection.table_names())


def _restricciones(schema_editor, tabla):
    with schema_editor.connection.cursor() as cursor:
        try:
            return schema_editor.connection.introspection.get_constraints(cursor, tabla)
        except Exception:
            return {}


class AddFieldSiFalta(migrations.AddField):
    """AddField que no truena si la columna ya existe."""
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        field = model._meta.get_field(self.name)
        if field.column in _columnas(schema_editor, model._meta.db_table):
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class RemoveFieldSiExiste(migrations.RemoveField):
    """RemoveField que no truena si la columna ya no existe."""
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = from_state.apps.get_model(app_label, self.model_name)
        field = model._meta.get_field(self.name)
        if field.column not in _columnas(schema_editor, model._meta.db_table):
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class CreateModelSiFalta(migrations.CreateModel):
    """CreateModel que no truena si la tabla ya existe."""
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.name)
        if model._meta.db_table in _tablas(schema_editor):
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class AddIndexSiFalta(migrations.AddIndex):
    """AddIndex que no truena si ya hay un índice con ese nombre."""
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        model = to_state.apps.get_model(app_label, self.model_name)
        if self.index.name in _restricciones(schema_editor, model._meta.db_table):
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)


class RunSQLSeguro(migrations.RunSQL):
    """RunSQL que ignora errores de 'ya existe' / 'no existe' (1050, 1060, 1061, 1091)."""
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        try:
            super().database_forwards(app_label, schema_editor, from_state, to_state)
        except Exception as e:  # noqa: BLE001
            codigo = getattr(e, 'args', [None])[0]
            if codigo in (1050, 1060, 1061, 1091):
                return
            raise

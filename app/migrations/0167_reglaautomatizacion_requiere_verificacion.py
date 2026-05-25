from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0166_userprofile_puede_levantamiento'),
    ]

    operations = [
        migrations.AddField(
            model_name='reglaautomatizacion',
            name='requiere_verificacion',
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Solo aplica si 'avanzar etapa al completar' está activo. Cuando "
                    "es True, al completar esta tarea NO se avanza directo: se "
                    "muestra un widget al responsable de la oportunidad para que "
                    "revise/edite título, descripción y responsable de las próximas "
                    "tareas antes de confirmar. Cuando es False, la cadena reactiva "
                    "se ejecuta automáticamente con los valores predeterminados."
                ),
                verbose_name='Requiere verificación al avanzar',
            ),
        ),
    ]

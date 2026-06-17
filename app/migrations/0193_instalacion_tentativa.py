# Instalacion.estado: agrega la opción 'tentativa' (antes de 'programada') a
# ESTADO_CHOICES. Solo cambia las choices del CharField (validación a nivel
# Django/forms); no altera el esquema de la columna. Escrita a mano porque el
# shell de desarrollo no tiene Django importable — equivalente a lo que
# generaría `makemigrations app` tras el cambio en el modelo.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0192_migrar_proyectotarea_a_tarea'),
    ]

    operations = [
        migrations.AlterField(
            model_name='instalacion',
            name='estado',
            field=models.CharField(
                choices=[
                    ('tentativa', 'Tentativa'),
                    ('programada', 'Programada'),
                    ('en_curso', 'En curso'),
                    ('completada', 'Completada'),
                    ('cancelada', 'Cancelada'),
                ],
                default='programada',
                max_length=20,
            ),
        ),
    ]

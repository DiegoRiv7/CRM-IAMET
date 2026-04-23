from django.db import migrations, models


class Migration(migrations.Migration):
    """Agrega idempotency_key (UUID cliente) a ProyectoLevantamiento y
    LevantamientoEvidencia para poder deduplicar uploads del PWA offline.

    El PWA genera un UUID al crear un levantamiento o subir una foto
    mientras no hay red. Al sincronizar, el servidor usa este UUID
    para detectar reintentos y evitar duplicados.
    """

    dependencies = [
        ('app', '0125_proyectolevantamiento_levantamientoevidencia'),
    ]

    operations = [
        migrations.AddField(
            model_name='proyectolevantamiento',
            name='idempotency_key',
            field=models.CharField(
                max_length=64,
                null=True,
                blank=True,
                unique=True,
                db_index=True,
                help_text='UUID generado por el cliente para dedupe de sync offline.',
            ),
        ),
        migrations.AddField(
            model_name='levantamientoevidencia',
            name='idempotency_key',
            field=models.CharField(
                max_length=64,
                null=True,
                blank=True,
                unique=True,
                db_index=True,
                help_text='UUID generado por el cliente para dedupe de sync offline.',
            ),
        ),
    ]

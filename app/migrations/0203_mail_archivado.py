# Correo Fase 1: carpeta Archivo funcional. El botón existía en la UI pero
# el backend no tenía rama ARCHIVE (caía al INBOX). Flag local por ahora;
# el movimiento real en el servidor IMAP llega con la Fase 2 (sync 2 vías).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0202_replay_mensual'),
    ]

    operations = [
        migrations.AddField(
            model_name='mailcorreo',
            name='archivado',
            field=models.BooleanField(default=False),
        ),
    ]

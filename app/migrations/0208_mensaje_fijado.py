# Conversación de oportunidad: mensajes fijados (rediseño del widget v3).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0207_mail_borradores_programados'),
    ]

    operations = [
        migrations.AddField(
            model_name='mensajeoportunidad',
            name='fijado',
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]

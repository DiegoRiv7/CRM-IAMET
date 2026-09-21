# Permiso "Chat Web": quién puede ver la bandeja de chats del sitio público.
# Migración FILTRADA a mano — el makemigrations del entorno arrastra drift
# preexistente (RenameIndex/AlterField id) que NO pertenece a este cambio.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0220_curso_choice'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='puede_chat_web',
            field=models.BooleanField(default=False, verbose_name='Puede ver el Chat Web'),
        ),
    ]

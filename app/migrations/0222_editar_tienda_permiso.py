# Permiso "Editar Tienda": quién puede administrar la Tienda del sitio web
# (productos, precios, descuentos, existencias y estado de pedidos) desde el
# panel /admin/tienda de iamet-platform, entrando con su MISMA cuenta del CRM.
# Migración FILTRADA a mano — el makemigrations del entorno arrastra drift
# preexistente (RenameIndex/AlterField id) que NO pertenece a este cambio.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0221_chat_web_permiso'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='puede_editar_tienda',
            field=models.BooleanField(default=False, verbose_name='Puede editar la Tienda'),
        ),
    ]

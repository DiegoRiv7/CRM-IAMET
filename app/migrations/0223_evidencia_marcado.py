from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Marcado de fotos del levantamiento: la version anotada apunta a su original.

    Escrita a mano y solo con lo suyo: un makemigrations arrastraria las
    operaciones pendientes del proyecto, que no vienen al caso.
    """

    dependencies = [
        ('app', '0222_editar_tienda_permiso'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='levantamientoevidencia',
            name='original',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='versiones_marcadas', to='app.levantamientoevidencia',
                verbose_name='Foto original que esta version anota'),
        ),
        migrations.AddField(
            model_name='levantamientoevidencia',
            name='editada_en',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Fecha del marcado'),
        ),
        migrations.AddField(
            model_name='levantamientoevidencia',
            name='editada_por',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='evidencias_marcadas', to=settings.AUTH_USER_MODEL,
                verbose_name='Quien la marco'),
        ),
    ]

# Generated manually for adding etapa fields

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0032_alter_todoitem_mes_cierre'),
    ]

    operations = [
        migrations.AddField(
            model_name='todoitem',
            name='etapa_corta',
            field=models.CharField(blank=True, max_length=50, null=True, verbose_name='Etapa (Corta)'),
        ),
        migrations.AddField(
            model_name='todoitem',
            name='etapa_completa',
            field=models.CharField(blank=True, max_length=200, null=True, verbose_name='Etapa (Completa)'),
        ),
        migrations.AddField(
            model_name='todoitem',
            name='etapa_color',
            field=models.CharField(blank=True, max_length=7, null=True, verbose_name='Color de Etapa'),
        ),
    ]
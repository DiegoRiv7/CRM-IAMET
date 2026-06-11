# Sync entre usuarios: tabla ligera de cambios (CrmCambio) consultada por
# polling con cursor de PK. Ver app/signals_sync.py y app/views_sync.py.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0184_detalle_marca_crm_y_quita_m2m_proveedores'),
    ]

    operations = [
        migrations.CreateModel(
            name='CrmCambio',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('entidad', models.CharField(max_length=40)),
                ('objeto_id', models.BigIntegerField(blank=True, null=True)),
                ('accion', models.CharField(choices=[('create', 'create'), ('update', 'update'), ('delete', 'delete')], max_length=10)),
                ('extra', models.JSONField(blank=True, default=dict)),
                ('ts', models.DateTimeField(auto_now_add=True)),
                ('usuario', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Cambio CRM (sync)',
                'verbose_name_plural': 'Cambios CRM (sync)',
            },
        ),
    ]

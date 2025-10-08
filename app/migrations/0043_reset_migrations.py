# Manual reset migration
from django.db import migrations

class Migration(migrations.Migration):

    dependencies = [
        ('app', '0042_notificacion'),
    ]

    operations = [
        # This migration does nothing but fixes the dependency chain
    ]
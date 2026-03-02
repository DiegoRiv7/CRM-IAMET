from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0060_muro'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProductoOportunidad',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('producto', models.CharField(choices=[('ZEBRA', 'ZEBRA'), ('PANDUIT', 'PANDUIT'), ('APC', 'APC'), ('AVIGILION', 'AVIGILION'), ('GENETEC', 'GENETEC'), ('AXIS', 'AXIS'), ('SOFTWARE', 'SOFTWARE'), ('RUNRATE', 'RUNRATE'), ('PÓLIZA', 'PÓLIZA'), ('CISCO', 'CISCO'), ('SERVICIO', 'Servicio')], max_length=100)),
                ('notas', models.CharField(blank=True, default='', max_length=255)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('oportunidad', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='productos_adicionales', to='app.todoitem')),
            ],
            options={
                'ordering': ['id'],
            },
        ),
    ]

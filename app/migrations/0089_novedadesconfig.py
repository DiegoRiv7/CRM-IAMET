from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0088_mensajeoportunidad_imagen_filefield'),
    ]

    operations = [
        migrations.CreateModel(
            name='NovedadesConfig',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('widget_activo', models.BooleanField(default=False)),
                ('version', models.CharField(default='2026-03-13', max_length=30)),
            ],
            options={
                'verbose_name': 'Configuración de Novedades',
            },
        ),
    ]

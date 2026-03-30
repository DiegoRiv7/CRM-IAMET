from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0107_campana_envio'),
    ]

    operations = [
        migrations.CreateModel(
            name='EtapaPipeline',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('pipeline', models.CharField(choices=[('runrate', 'Runrate'), ('proyecto', 'Proyecto')], default='runrate', max_length=20)),
                ('nombre', models.CharField(max_length=100, verbose_name='Nombre de la etapa')),
                ('color', models.CharField(default='#6B7280', max_length=7, verbose_name='Color hex')),
                ('orden', models.IntegerField(default=0, verbose_name='Orden en el pipeline')),
                ('activo', models.BooleanField(default=True)),
            ],
            options={
                'ordering': ['pipeline', 'orden'],
                'verbose_name': 'Etapa de Pipeline',
                'verbose_name_plural': 'Etapas de Pipeline',
            },
        ),
    ]

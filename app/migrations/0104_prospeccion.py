import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0103_meta_cotizado_numero'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Prospecto',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=200, verbose_name='Nombre del Prospecto')),
                ('producto', models.CharField(choices=[('ZEBRA', 'ZEBRA'), ('PANDUIT', 'PANDUIT'), ('APC', 'APC'), ('AVIGILION', 'AVIGILION'), ('GENETEC', 'GENETEC'), ('AXIS', 'AXIS'), ('SOFTWARE', 'SOFTWARE'), ('RUNRATE', 'RUNRATE'), ('PÓLIZA', 'PÓLIZA'), ('CISCO', 'CISCO'), ('SERVICIO', 'Servicio')], default='ZEBRA', max_length=100)),
                ('area', models.CharField(choices=[('SISTEMAS', 'Sistemas'), ('Recursos Humanos', 'Recursos Humanos'), ('Compras', 'Compras'), ('Seguridad', 'Seguridad'), ('Mantenimiento', 'Mantenimiento'), ('Almacén', 'Almacén')], default='SISTEMAS', max_length=50)),
                ('tipo_pipeline', models.CharField(choices=[('runrate', 'Runrate'), ('proyecto', 'Proyecto')], default='runrate', max_length=20, verbose_name='Pipeline (Runrate/Proyecto)')),
                ('comentarios', models.TextField(blank=True, default='')),
                ('etapa', models.CharField(choices=[('identificado', 'Identificado'), ('calificado', 'Calificado'), ('reunion', 'Reunión'), ('en_progreso', 'En Progreso'), ('procesado', 'Procesado'), ('cerrado_ganado', 'Cerrado - Ganado'), ('cerrado_perdido', 'Cerrado - Perdido')], default='identificado', max_length=20)),
                ('reunion_tipo', models.CharField(blank=True, choices=[('virtual', 'Virtual'), ('presencial', 'Presencial')], default='', max_length=15)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('cliente', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='prospectos', to='app.cliente')),
                ('contacto', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='prospectos', to='app.contacto')),
                ('oportunidad_creada', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='prospecto_origen', to='app.todoitem')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='prospectos', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Prospecto',
                'verbose_name_plural': 'Prospectos',
                'ordering': ['-fecha_actualizacion'],
            },
        ),
        migrations.CreateModel(
            name='ProspectoComentario',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('texto', models.TextField()),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('prospecto', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comentarios_list', to='app.prospecto')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-fecha_creacion'],
            },
        ),
        migrations.CreateModel(
            name='ProspectoActividad',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tipo', models.CharField(choices=[('llamada', 'Llamada'), ('correo', 'Correo'), ('reunion', 'Reunión'), ('tarea', 'Tarea'), ('otro', 'Otro')], default='tarea', max_length=20)),
                ('descripcion', models.TextField()),
                ('fecha_programada', models.DateTimeField()),
                ('completada', models.BooleanField(default=False)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('prospecto', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='actividades', to='app.prospecto')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['fecha_programada'],
            },
        ),
    ]

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0093_mailcorreo_destacado_eliminado'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ReglaAutomatizacion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(help_text='Nombre descriptivo para identificar esta regla', max_length=200, verbose_name='Nombre de la regla')),
                ('activa', models.BooleanField(default=True, verbose_name='Regla activa')),
                ('etapa_disparadora', models.CharField(help_text='Nombre exacto de la etapa (ej: Vendido c/PO, Facturado)', max_length=100, verbose_name='Etapa que dispara la regla')),
                ('tipo_negociacion', models.CharField(choices=[('ambos', 'Runrate y Proyecto'), ('runrate', 'Solo Runrate'), ('proyecto', 'Solo Proyecto')], default='ambos', max_length=10, verbose_name='Aplica a tipo de negociación')),
                ('titulo_tarea', models.CharField(max_length=200, verbose_name='Título de la tarea')),
                ('descripcion_tarea', models.TextField(blank=True, default='', verbose_name='Descripción de la tarea')),
                ('prioridad_tarea', models.CharField(choices=[('baja', 'Baja'), ('normal', 'Normal'), ('alta', 'Alta'), ('urgente', 'Urgente')], default='normal', max_length=10, verbose_name='Prioridad de la tarea')),
                ('offset_tipo', models.CharField(choices=[('dias', 'días después del cambio'), ('horas', 'horas después del cambio'), ('fecha_fija', 'fecha fija')], default='dias', max_length=15, verbose_name='Tipo de fecha de vencimiento')),
                ('offset_valor', models.PositiveIntegerField(default=3, help_text='Número de días u horas después del cambio de etapa', verbose_name='Valor del offset')),
                ('fecha_fija', models.DateField(blank=True, help_text="Solo si el tipo es 'fecha fija'", null=True, verbose_name='Fecha fija de vencimiento')),
                ('orden', models.PositiveIntegerField(default=0, help_text='Orden en que se ejecuta cuando hay varias reglas para la misma etapa', verbose_name='Orden de ejecución')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('creada_por', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='reglas_creadas', to=settings.AUTH_USER_MODEL, verbose_name='Creada por')),
                ('responsable_predeterminado', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='reglas_como_responsable', to=settings.AUTH_USER_MODEL, verbose_name='Responsable predeterminado')),
                ('participantes_predeterminados', models.ManyToManyField(blank=True, related_name='reglas_como_participante', to=settings.AUTH_USER_MODEL, verbose_name='Participantes predeterminados')),
                ('observadores_predeterminados', models.ManyToManyField(blank=True, related_name='reglas_como_observador', to=settings.AUTH_USER_MODEL, verbose_name='Observadores predeterminados')),
            ],
            options={
                'verbose_name': 'Regla de Automatización',
                'verbose_name_plural': 'Reglas de Automatización',
                'ordering': ['etapa_disparadora', 'orden', 'nombre'],
            },
        ),
        migrations.CreateModel(
            name='EjecucionAutomatizacion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha_ejecucion', models.DateTimeField(auto_now_add=True)),
                ('regla', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ejecuciones', to='app.reglaautomatizacion', verbose_name='Regla ejecutada')),
                ('oportunidad', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='automatizaciones_ejecutadas', to='app.todoitem', verbose_name='Oportunidad')),
                ('tarea_creada', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='origen_automatizacion', to='app.tareaoportunidad', verbose_name='Tarea creada')),
                ('ejecutada_por', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL, verbose_name='Usuario que disparó el cambio')),
            ],
            options={
                'verbose_name': 'Ejecución de Automatización',
                'verbose_name_plural': 'Ejecuciones de Automatización',
                'ordering': ['-fecha_ejecucion'],
                'unique_together': {('regla', 'oportunidad')},
            },
        ),
    ]

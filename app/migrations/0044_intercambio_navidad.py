# Generated manually for intercambio navideño

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0043_fix_carpetas_proyecto_relations'),
    ]

    operations = [
        migrations.CreateModel(
            name='IntercambioNavidad',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('año', models.PositiveIntegerField(help_text='Año del intercambio navideño', verbose_name='Año del Intercambio')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Creación')),
                ('fecha_sorteo', models.DateTimeField(blank=True, null=True, verbose_name='Fecha del Sorteo')),
                ('fecha_intercambio', models.DateField(blank=True, null=True, verbose_name='Fecha del Intercambio')),
                ('estado', models.CharField(choices=[('preparacion', 'En Preparación'), ('sorteo_realizado', 'Sorteo Realizado'), ('finalizado', 'Finalizado')], default='preparacion', max_length=20, verbose_name='Estado')),
                ('descripcion', models.TextField(blank=True, help_text='Descripción opcional del intercambio', verbose_name='Descripción')),
                ('monto_sugerido', models.DecimalField(blank=True, decimal_places=2, help_text='Monto sugerido para los regalos', max_digits=10, null=True, verbose_name='Monto Sugerido')),
                ('creado_por', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='intercambios_creados', to=settings.AUTH_USER_MODEL, verbose_name='Creado por')),
            ],
            options={
                'verbose_name': 'Intercambio Navideño',
                'verbose_name_plural': 'Intercambios Navideños',
                'ordering': ['-año'],
            },
        ),
        migrations.CreateModel(
            name='ParticipanteIntercambio',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha_inscripcion', models.DateTimeField(auto_now_add=True, verbose_name='Fecha de Inscripción')),
                ('regalo_entregado', models.BooleanField(default=False, verbose_name='Regalo Entregado')),
                ('fecha_entrega', models.DateTimeField(blank=True, null=True, verbose_name='Fecha de Entrega')),
                ('comentarios', models.TextField(blank=True, help_text='Comentarios adicionales del participante', verbose_name='Comentarios')),
                ('intercambio', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='participantes', to='app.intercambionavidad', verbose_name='Intercambio')),
                ('regalo_para', models.ForeignKey(blank=True, help_text='Usuario para quien debe comprar el regalo', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='recibe_regalo_de', to=settings.AUTH_USER_MODEL, verbose_name='Regalo Para')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL, verbose_name='Usuario Participante')),
            ],
            options={
                'verbose_name': 'Participante del Intercambio',
                'verbose_name_plural': 'Participantes del Intercambio',
                'ordering': ['usuario__first_name', 'usuario__last_name'],
            },
        ),
        migrations.CreateModel(
            name='HistorialIntercambio',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('accion', models.CharField(choices=[('intercambio_creado', 'Intercambio Creado'), ('participante_agregado', 'Participante Agregado'), ('participante_removido', 'Participante Removido'), ('sorteo_realizado', 'Sorteo Realizado'), ('regalo_entregado', 'Regalo Entregado'), ('intercambio_finalizado', 'Intercambio Finalizado')], max_length=30, verbose_name='Acción')),
                ('fecha', models.DateTimeField(auto_now_add=True, verbose_name='Fecha y Hora')),
                ('detalles', models.JSONField(blank=True, default=dict, help_text='Detalles adicionales de la acción en formato JSON', verbose_name='Detalles')),
                ('intercambio', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='historial', to='app.intercambionavidad', verbose_name='Intercambio')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL, verbose_name='Usuario que realizó la acción')),
            ],
            options={
                'verbose_name': 'Historial del Intercambio',
                'verbose_name_plural': 'Historiales del Intercambio',
                'ordering': ['-fecha'],
            },
        ),
        migrations.AddConstraint(
            model_name='intercambionavidad',
            constraint=models.UniqueConstraint(fields=('año',), name='app_intercambionavidad_año_key'),
        ),
        migrations.AddConstraint(
            model_name='participanteintercambio',
            constraint=models.UniqueConstraint(fields=('intercambio', 'usuario'), name='app_participanteintercambio_intercambio_usuario_key'),
        ),
    ]
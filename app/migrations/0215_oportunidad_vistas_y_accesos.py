# Escrita a mano: makemigrations arrastra 56 operaciones ajenas (renombres de
# indices y AutoField->BigAutoField) que ya estaban pendientes en el repo desde
# antes de este cambio. Aqui solo van los dos modelos nuevos.
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0214_notificacion_tipo_completada_reabierta'),
    ]

    operations = [
        migrations.CreateModel(
            name='OportunidadVista',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('primera_vez', models.DateTimeField(auto_now_add=True)),
                ('ultima_vez', models.DateTimeField(auto_now=True)),
                ('veces', models.PositiveIntegerField(default=1)),
                ('ultima_accion', models.CharField(blank=True, default='', max_length=200)),
                ('ultima_accion_fecha', models.DateTimeField(blank=True, null=True)),
                ('oportunidad', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='vistas', to='app.todoitem')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Vista de oportunidad',
                'verbose_name_plural': 'Vistas de oportunidad',
            },
        ),
        migrations.CreateModel(
            name='OportunidadAccesoBloqueado',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha', models.DateTimeField(auto_now_add=True)),
                ('motivo', models.CharField(blank=True, default='', max_length=200)),
                ('bloqueado_por', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('oportunidad', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='accesos_bloqueados', to='app.todoitem')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Acceso bloqueado a oportunidad',
                'verbose_name_plural': 'Accesos bloqueados a oportunidad',
            },
        ),
        migrations.AddIndex(
            model_name='oportunidadvista',
            index=models.Index(fields=['oportunidad', '-ultima_vez'], name='app_oportun_oportun_74e7bb_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='oportunidadvista',
            unique_together={('oportunidad', 'usuario')},
        ),
        migrations.AlterUniqueTogether(
            name='oportunidadaccesobloqueado',
            unique_together={('oportunidad', 'usuario')},
        ),
    ]

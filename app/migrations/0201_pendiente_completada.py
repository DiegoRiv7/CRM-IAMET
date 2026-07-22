from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0200_tema_temporada'),
    ]

    operations = [
        migrations.CreateModel(
            name='PendienteCompletada',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha', models.DateField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('oportunidad', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='app.todoitem')),
                ('usuario', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pendientes_completadas', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Pendiente marcada trabajada',
                'verbose_name_plural': 'Pendientes marcadas trabajadas',
            },
        ),
        migrations.AddIndex(
            model_name='pendientecompletada',
            index=models.Index(fields=['usuario', 'fecha'], name='app_pendcomp_usuario_fecha_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='pendientecompletada',
            unique_together={('usuario', 'oportunidad', 'fecha')},
        ),
    ]

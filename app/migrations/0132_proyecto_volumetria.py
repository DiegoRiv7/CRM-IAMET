from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def migrar_fase3_a_volumetria(apps, schema_editor):
    """Por cada levantamiento con fase3_data no vacío, crea una primera
    ProyectoVolumetria llamada 'Volumetría 1' con status='borrador' y la
    data copiada. NO se modifica fase3_data — coexisten hasta que el
    nuevo flujo esté validado en producción y limpiemos en otra
    migración (que podría incluso ya no ser necesaria si todos los
    edits nuevos van por el nuevo modelo)."""
    ProyectoLevantamiento = apps.get_model('app', 'ProyectoLevantamiento')
    ProyectoVolumetria = apps.get_model('app', 'ProyectoVolumetria')

    qs = ProyectoLevantamiento.objects.exclude(fase3_data={}).exclude(fase3_data=None)
    for lev in qs.iterator():
        data = lev.fase3_data or {}
        if not data:
            continue
        # Solo migrar si el levantamiento aún no tiene volumetrías
        # (idempotencia: si re-corre la migración no duplica).
        if ProyectoVolumetria.objects.filter(levantamiento=lev).exists():
            continue
        ProyectoVolumetria.objects.create(
            levantamiento=lev,
            nombre='Volumetría 1',
            status='borrador',
            data=data,
            creado_por=lev.creado_por,
            actualizado_por=lev.actualizado_por,
        )


def revertir_migracion(apps, schema_editor):
    """Si se reverte, nada qué hacer — fase3_data sigue intacto."""
    pass


class Migration(migrations.Migration):
    """Crea modelo ProyectoVolumetria (borradores múltiples por
    levantamiento). Migra fase3_data legacy a la primera volumetría
    para no perder trabajo en curso."""

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('app', '0131_producto_external_id'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProyectoVolumetria',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=200)),
                ('status', models.CharField(
                    choices=[('borrador', 'Borrador'), ('completada', 'Completada')],
                    default='borrador',
                    max_length=20,
                )),
                ('data', models.JSONField(blank=True, default=dict)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('actualizado_por', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='volumetrias_actualizadas',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('creado_por', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='volumetrias_creadas',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('levantamiento', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='volumetrias',
                    to='app.proyectolevantamiento',
                )),
            ],
            options={
                'verbose_name': 'Volumetría',
                'verbose_name_plural': 'Volumetrías',
                'ordering': ['-fecha_actualizacion'],
            },
        ),
        migrations.RunPython(migrar_fase3_a_volumetria, revertir_migracion),
    ]

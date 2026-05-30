"""
Catálogo de técnicos + tabla intermedia (técnico, instalación, fecha)
para el grid Técnico × Día del calendario de instalaciones.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0169_instalacion'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Tecnico',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('nombre', models.CharField(max_length=120, verbose_name='Nombre')),
                ('rol', models.CharField(
                    choices=[('tecnico', 'Técnico'), ('supervisor', 'Supervisor'), ('ingeniero', 'Ingeniero')],
                    default='tecnico',
                    max_length=20,
                )),
                ('activo', models.BooleanField(default=True)),
                ('color', models.CharField(
                    blank=True, default='',
                    help_text='Color hex opcional para distinguirlo en el grid (#RRGGBB).',
                    max_length=7,
                )),
                ('notas', models.TextField(blank=True, default='')),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('usuario', models.ForeignKey(
                    blank=True,
                    help_text='Si el técnico también es usuario del CRM.',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='tecnico_perfil',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Técnico',
                'verbose_name_plural': 'Técnicos',
                'ordering': ['nombre'],
                'indexes': [
                    models.Index(fields=['activo'], name='app_tecnico_activo_idx'),
                ],
            },
        ),
        migrations.CreateModel(
            name='InstalacionAsignacion',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('fecha', models.DateField()),
                ('hora_inicio', models.TimeField(blank=True, null=True)),
                ('hora_fin', models.TimeField(blank=True, null=True)),
                ('notas', models.CharField(blank=True, default='', max_length=200)),
                ('instalacion', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='asignaciones',
                    to='app.instalacion',
                )),
                ('tecnico', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='asignaciones',
                    to='app.tecnico',
                )),
            ],
            options={
                'verbose_name': 'Asignación de técnico',
                'verbose_name_plural': 'Asignaciones de técnicos',
                'ordering': ['fecha', 'tecnico__nombre'],
                'constraints': [
                    models.UniqueConstraint(
                        fields=['instalacion', 'tecnico', 'fecha'],
                        name='uniq_instalacion_tecnico_fecha',
                    ),
                ],
                'indexes': [
                    models.Index(fields=['fecha'], name='app_instalac_fecha_a_idx'),
                    models.Index(fields=['tecnico', 'fecha'], name='app_instalac_tec_fecha_idx'),
                ],
            },
        ),
    ]

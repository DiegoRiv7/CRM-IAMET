"""
Modelo Instalacion — calendario de instalaciones del plan de trabajo
Bajanet (origen en Excel).
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0168_disable_requiere_verificacion'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Instalacion',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cliente_nombre', models.CharField(max_length=200, verbose_name='Cliente')),
                ('po', models.CharField(blank=True, default='', max_length=80, verbose_name='PO')),
                ('proyecto', models.CharField(max_length=400, verbose_name='Proyecto')),
                ('jornadas_count', models.PositiveIntegerField(default=1, verbose_name='Cantidad de jornadas')),
                ('jornadas_tipo', models.CharField(
                    choices=[
                        ('normal', 'Normal'),
                        ('sabado', 'Sábado'),
                        ('domingo', 'Domingo'),
                        ('noche', 'Noche'),
                        ('extraordinaria', 'Extraordinaria'),
                    ],
                    default='normal',
                    max_length=20,
                )),
                ('personal_descripcion', models.CharField(
                    blank=True, default='',
                    help_text='Texto libre: ej. "1 SUPERVISOR Y 3 TECNICOS"',
                    max_length=200,
                )),
                ('fecha_programada', models.DateField(blank=True, null=True, verbose_name='Fecha')),
                ('fecha_tentativa_texto', models.CharField(
                    blank=True, default='',
                    help_text='Cuando no hay fecha exacta. Ej: "JULIO", "SABADO 23 MAYO".',
                    max_length=120,
                )),
                ('monto_po', models.DecimalField(decimal_places=2, default=0, max_digits=12, verbose_name='Monto PO')),
                ('utilidad', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('observaciones', models.TextField(blank=True, default='')),
                ('notas', models.TextField(
                    blank=True, default='',
                    help_text='Notas internas (personal asignado, hora, instrucciones).',
                )),
                ('estado', models.CharField(
                    choices=[
                        ('programada', 'Programada'),
                        ('en_curso', 'En curso'),
                        ('completada', 'Completada'),
                        ('cancelada', 'Cancelada'),
                    ],
                    default='programada',
                    max_length=20,
                )),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('cliente', models.ForeignKey(
                    blank=True,
                    help_text='Si está en el CRM, link al Cliente.',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='instalaciones',
                    to='app.cliente',
                )),
                ('creado_por', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='instalaciones_creadas',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('oportunidad', models.ForeignKey(
                    blank=True,
                    help_text='Opp ligada (si aplica).',
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='instalaciones',
                    to='app.todoitem',
                )),
            ],
            options={
                'verbose_name': 'Instalación',
                'verbose_name_plural': 'Instalaciones',
                'ordering': ['-fecha_programada', '-fecha_creacion'],
                'indexes': [
                    models.Index(fields=['fecha_programada'], name='app_instala_fecha_p_idx'),
                    models.Index(fields=['estado'], name='app_instala_estado_idx'),
                ],
            },
        ),
    ]

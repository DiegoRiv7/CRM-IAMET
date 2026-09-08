# MULTIEMPRESA — Fase 1 (2026-09-07). Ver PLAN_MULTIEMPRESA.md.
#
# 1) EmpresaConfig (singleton): identidad + módulos de la empresa de ESTA instancia.
# 2) OpcionCatalogo: catálogos editables (producto / área / marca) que sustituyen
#    a las listas fijas PRODUCTO_CHOICES / AREA_CHOICES / MARCA_CHOICES.
# 3) Se quitan los `choices` fijos de los campos (sin cambio de columna en MySQL).
# 4) Semilla: SOLO en bases que ya tienen datos (IAMET prod/pruebas) se crea la
#    config de IAMET con sus módulos encendidos y el catálogo con sus marcas,
#    para que todo se vea igual que hoy. Una base nueva (empresa nueva) queda
#    vacía y la llena `manage.py seed_empresa`.
#
# Escrita a mano (makemigrations arrastra drift ajeno de RenameIndex/AlterField).
from django.db import migrations, models


IAMET_CONFIG = dict(
    slug='iamet', nombre='IAMET', nombre_corto='IAMET',
    razon_social='IAMET S. de R.L. de C.V.',
    telefono='+52 664 380 8935',
    correo_contacto='contacto@iamet.com', correo_ventas='ventas@iamet.mx',
    sitio_web='https://iamet.mx', dominio_correo='iamet.mx',
    mod_asistente_ia=True, mod_muro=True, mod_ideas=True, mod_marketing_hub=True,
    mod_chat_web=True, mod_leads_web=True, mod_sso_tienda=True, mod_proyectos_iamet=True,
    mod_intercambio_navidad=True, mod_fondo_mundial=True, mod_temas_temporada=True,
    mod_bitrix=False,
)

# (tipo, valor, etiqueta, etiqueta_corta, alias, es_columna, es_default, orden)
CATALOGO_IAMET = [
    ('producto', 'ZEBRA',     'Zebra',     'Zebra',   '',            True,  True,  10),
    ('producto', 'PANDUIT',   'Panduit',   'Panduit', '',            True,  False, 20),
    ('producto', 'APC',       'APC',       'APC',     '',            True,  False, 30),
    ('producto', 'AVIGILION', 'Avigilon',  'Avig.',   'AVIGILON',    True,  False, 40),
    ('producto', 'GENETEC',   'Genetec',   'Genet.',  '',            True,  False, 50),
    ('producto', 'AXIS',      'Axis',      'Axis',    '',            True,  False, 60),
    ('producto', 'SOFTWARE',  'Software',  'Soft.',   'Desarrollo',  True,  False, 70),
    ('producto', 'RUNRATE',   'Runrate',   'RR',      '',            True,  False, 80),
    ('producto', 'PÓLIZA',    'Póliza',    'Pol.',    'POLIZA',      True,  False, 90),
    ('producto', 'CISCO',     'Cisco',     'Cisco',   '',            False, False, 100),
    ('producto', 'SERVICIO',  'Servicio',  'Serv.',   '',            False, False, 110),
    ('producto', 'CURSO',     'Curso',     'Curso',   '',            False, False, 120),
    ('area', 'SISTEMAS',         'Sistemas',         '', '', False, True,  10),
    ('area', 'Recursos Humanos', 'Recursos Humanos', '', '', False, False, 20),
    ('area', 'Compras',          'Compras',          '', '', False, False, 30),
    ('area', 'Seguridad',        'Seguridad',        '', '', False, False, 40),
    ('area', 'Mantenimiento',    'Mantenimiento',    '', '', False, False, 50),
    ('area', 'Almacén',          'Almacén',          '', '', False, False, 60),
    ('marca', 'ZEBRA',     'ZEBRA',    '', '',         False, False, 10),
    ('marca', 'PANDUIT',   'PANDUIT',  '', '',         False, False, 20),
    ('marca', 'APC',       'APC',      '', '',         False, False, 30),
    ('marca', 'AVIGILION', 'AVIGILON', '', 'AVIGILON', False, False, 40),
    ('marca', 'GENETEC',   'GENETEC',  '', '',         False, False, 50),
    ('marca', 'AXIS',      'AXIS',     '', '',         False, False, 60),
    ('marca', 'CISCO',     'CISCO',    '', '',         False, False, 70),
]


def sembrar_iamet(apps, schema_editor):
    EmpresaConfig = apps.get_model('app', 'EmpresaConfig')
    OpcionCatalogo = apps.get_model('app', 'OpcionCatalogo')
    User = apps.get_model('auth', 'User')
    TodoItem = apps.get_model('app', 'TodoItem')

    # Base nueva (empresa nueva): no sembrar nada de IAMET.
    if not (User.objects.exists() or TodoItem.objects.exists()):
        return

    if not EmpresaConfig.objects.filter(pk=1).exists():
        EmpresaConfig.objects.create(pk=1, **IAMET_CONFIG)

    if not OpcionCatalogo.objects.exists():
        OpcionCatalogo.objects.bulk_create([
            OpcionCatalogo(
                tipo=t, valor=v, etiqueta=e, etiqueta_corta=c, alias=a,
                es_columna=col, es_default=d, orden=o, activo=True,
            )
            for (t, v, e, c, a, col, d, o) in CATALOGO_IAMET
        ])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0223_evidencia_marcado'),
    ]

    operations = [
        migrations.CreateModel(
            name='EmpresaConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(default='empresa', help_text='Identificador corto de la instancia (sin espacios). "iamet" = la instancia de IAMET.', max_length=40)),
                ('nombre', models.CharField(default='Mi Empresa', max_length=120, verbose_name='Nombre de la empresa')),
                ('nombre_corto', models.CharField(blank=True, default='', help_text='Cómo se muestra en el menú lateral (si se deja vacío se usa el nombre).', max_length=40)),
                ('razon_social', models.CharField(blank=True, default='', max_length=200)),
                ('direccion', models.CharField(blank=True, default='', max_length=255)),
                ('telefono', models.CharField(blank=True, default='', max_length=40)),
                ('correo_contacto', models.EmailField(blank=True, default='', help_text='Aparece en cotizaciones y documentos.', max_length=254)),
                ('correo_ventas', models.EmailField(blank=True, default='', help_text='Remitente/firma por defecto del área de ventas.', max_length=254)),
                ('sitio_web', models.URLField(blank=True, default='')),
                ('dominio_correo', models.CharField(blank=True, default='', help_text='Dominio de los correos del equipo, p. ej. "iamet.mx" (solo para ejemplos/placeholders).', max_length=80)),
                ('logo', models.ImageField(blank=True, null=True, upload_to='empresa/')),
                ('color_primario', models.CharField(default='#2C5080', max_length=7)),
                ('color_secundario', models.CharField(default='#4A6E9C', max_length=7)),
                ('moneda', models.CharField(default='MXN', max_length=3)),
                ('zona_horaria', models.CharField(default='America/Tijuana', max_length=60)),
                ('mod_asistente_ia', models.BooleanField(default=True, verbose_name='Asistente con IA (Mi día)')),
                ('mod_muro', models.BooleanField(default=True, verbose_name='Muro empresarial')),
                ('mod_ideas', models.BooleanField(default=False, verbose_name='Ideas')),
                ('mod_marketing_hub', models.BooleanField(default=False, verbose_name='Marketing Hub')),
                ('mod_chat_web', models.BooleanField(default=False, verbose_name='Chat Web del sitio')),
                ('mod_leads_web', models.BooleanField(default=False, verbose_name='Leads del sitio web')),
                ('mod_sso_tienda', models.BooleanField(default=False, verbose_name='Acceso al panel de la Tienda')),
                ('mod_proyectos_iamet', models.BooleanField(default=False, verbose_name='Proyectos IAMET (levantamientos, volumetría)')),
                ('mod_intercambio_navidad', models.BooleanField(default=False, verbose_name='Intercambio navideño')),
                ('mod_fondo_mundial', models.BooleanField(default=False, verbose_name='Fondo del Mundial')),
                ('mod_temas_temporada', models.BooleanField(default=False, verbose_name='Temas de temporada')),
                ('mod_bitrix', models.BooleanField(default=False, verbose_name='Integración Bitrix24')),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Configuración de la Empresa',
                'verbose_name_plural': 'Configuración de la Empresa',
            },
        ),
        migrations.CreateModel(
            name='OpcionCatalogo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tipo', models.CharField(choices=[('producto', 'Producto / Servicio'), ('area', 'Área del cliente'), ('marca', 'Marca (partidas de cotización)')], db_index=True, max_length=20)),
                ('valor', models.CharField(help_text='Clave que se guarda en los registros (p. ej. ZEBRA).', max_length=100)),
                ('etiqueta', models.CharField(help_text='Texto que ve el usuario.', max_length=120)),
                ('etiqueta_corta', models.CharField(blank=True, default='', help_text='Cabecera de columna en la tabla del CRM.', max_length=20)),
                ('alias', models.CharField(blank=True, default='', help_text='Otros valores ya guardados que cuentan como esta opción, separados por coma (p. ej. AVIGILION).', max_length=200)),
                ('es_columna', models.BooleanField(default=False, help_text='Producto: tiene columna propia en la tabla del CRM.')),
                ('es_default', models.BooleanField(default=False, help_text='Valor que se usa cuando no se captura ninguno.')),
                ('color', models.CharField(blank=True, default='', max_length=7)),
                ('orden', models.PositiveIntegerField(default=0)),
                ('activo', models.BooleanField(default=True)),
            ],
            options={
                'verbose_name': 'Opción de catálogo',
                'verbose_name_plural': 'Catálogos',
                'ordering': ['tipo', 'orden', 'etiqueta'],
                'unique_together': {('tipo', 'valor')},
            },
        ),
        # Campos que pierden sus `choices` fijos (no cambia la columna en MySQL).
        migrations.AlterField(
            model_name='todoitem',
            name='producto',
            field=models.CharField(blank=True, default='', max_length=100, verbose_name='Producto / Servicio'),
        ),
        migrations.AlterField(
            model_name='todoitem',
            name='area',
            field=models.CharField(blank=True, default='', max_length=50, verbose_name='Área'),
        ),
        migrations.AlterField(
            model_name='productooportunidad',
            name='producto',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='detallecotizacion',
            name='marca',
            field=models.CharField(blank=True, max_length=50, null=True, verbose_name='Marca'),
        ),
        migrations.AlterField(
            model_name='prospecto',
            name='producto',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AlterField(
            model_name='prospecto',
            name='area',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.RunPython(sembrar_iamet, noop),
    ]

# Generated manually for Marketing Hub backend integration
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


# ── Seed inicial: los 35 mocks que el Marketing Hub ya muestra desde el JS.
#    Los 19 que tienen archivo HTML standalone (creados por los agentes de
#    diseño) entran con el campo `url` apuntando al static path. Los 16
#    restantes son mocks sin archivo (visuales para la demo) — el campo
#    `archivo` y `url` quedan vacíos.
SEED_RECURSOS = [
    # ZEBRA (6)
    {'brand': 'zebra', 'tipo': 'brochure', 'titulo': 'ZD421 — Brochure Impresora',
     'descripcion': 'Especificaciones y ventajas del ZD421 para punto de venta.',
     'tags': ['impresoras', 'ZD421'], 'tamano_bytes': 2_400_000,
     'url': '/static/marketing/recursos/brochures/zebra-zd421.html'},
    {'brand': 'zebra', 'tipo': 'presentacion', 'titulo': 'Soluciones Retail Zebra',
     'descripcion': 'Deck ejecutivo de soluciones para el sector retail.',
     'tags': ['retail', 'ventas'], 'tamano_bytes': 8_100_000,
     'url': '/static/marketing/recursos/presentaciones/zebra-soluciones-retail.html'},
    {'brand': 'zebra', 'tipo': 'landing', 'titulo': 'Landing — Impresoras de Etiquetas',
     'descripcion': 'Landing optimizada para captación en impresoras industriales.',
     'tags': ['landing', 'etiquetas'], 'tamano_bytes': 0,
     'url': '/static/marketing/recursos/landings/zebra-impresoras-etiquetas.html'},
    {'brand': 'zebra', 'tipo': 'certificacion', 'titulo': 'Certificación Partner Gold 2024',
     'descripcion': 'Certificado oficial de partner nivel Gold vigente 2024.',
     'tags': ['certificación', 'gold'], 'tamano_bytes': 1_100_000, 'url': ''},
    {'brand': 'zebra', 'tipo': 'video', 'titulo': 'Demo TC52 — Video en Campo',
     'descripcion': 'Demostración del handheld TC52 en operación de campo.',
     'tags': ['demo', 'TC52', 'handheld'], 'tamano_bytes': 145_000_000, 'url': ''},
    {'brand': 'zebra', 'tipo': 'caso', 'titulo': 'Caso Éxito — Logística Express',
     'descripcion': 'Implementación exitosa de trazabilidad en empresa de logística.',
     'tags': ['logística', 'trazabilidad'], 'tamano_bytes': 3_200_000,
     'url': '/static/marketing/recursos/casos/caso-logistica-express.html'},

    # PANDUIT (6)
    {'brand': 'panduit', 'tipo': 'brochure', 'titulo': 'Catálogo Infraestructura de Red',
     'descripcion': 'Catálogo completo de cableado estructurado certificado.',
     'tags': ['redes', 'cableado'], 'tamano_bytes': 12_300_000,
     'url': '/static/marketing/recursos/brochures/panduit-cableado-estructurado.html'},
    {'brand': 'panduit', 'tipo': 'propuesta', 'titulo': 'Propuesta Data Center Panduit',
     'descripcion': 'Plantilla ejecutiva para proyectos de infraestructura.',
     'tags': ['data center'], 'tamano_bytes': 5_800_000, 'url': ''},
    {'brand': 'panduit', 'tipo': 'landing', 'titulo': 'Landing — Cableado Estructurado',
     'descripcion': 'Landing de captación para soluciones de cableado.',
     'tags': ['landing', 'cableado'], 'tamano_bytes': 0,
     'url': '/static/marketing/recursos/landings/panduit-cableado-estructurado.html'},
    {'brand': 'panduit', 'tipo': 'presentacion', 'titulo': 'Infraestructura Data Center Panduit',
     'descripcion': 'Deck ejecutivo: arquitectura Tier III/IV con SmartZone G5 DCIM.',
     'tags': ['data center', 'SmartZone G5'], 'tamano_bytes': 6_400_000,
     'url': '/static/marketing/recursos/presentaciones/panduit-data-center.html'},
    {'brand': 'panduit', 'tipo': 'banner', 'titulo': 'Banner Digital SmartZone G5',
     'descripcion': 'Set de banners en múltiples formatos para SmartZone.',
     'tags': ['banner', 'SmartZone'], 'tamano_bytes': 4_200_000, 'url': ''},
    {'brand': 'panduit', 'tipo': 'caso', 'titulo': 'Caso Data Center — Infraestructura Crítica',
     'descripcion': 'Despliegue de infraestructura Tier III para institución de energía nacional.',
     'tags': ['data center', 'caso', 'tier-iii'], 'tamano_bytes': 5_400_000,
     'url': '/static/marketing/recursos/casos/caso-data-center-cfe.html'},

    # AVIGILION (7)
    {'brand': 'avigilion', 'tipo': 'brochure', 'titulo': 'Videovigilancia IP — Brochure',
     'descripcion': 'Soluciones de videovigilancia con inteligencia artificial.',
     'tags': ['cámaras', 'seguridad'], 'tamano_bytes': 7_600_000,
     'url': '/static/marketing/recursos/brochures/avigilion-vigilancia-ia.html'},
    {'brand': 'avigilion', 'tipo': 'landing', 'titulo': 'Landing — Cámaras IA Avigilion',
     'descripcion': 'Landing de alta conversión para cámaras con IA.',
     'tags': ['cámaras', 'IA'], 'tamano_bytes': 0,
     'url': '/static/marketing/recursos/landings/avigilion-camaras-ia.html'},
    {'brand': 'avigilion', 'tipo': 'video', 'titulo': 'Demo Avigilion Control Center 7',
     'descripcion': 'Demostración completa del software ACC7 para gerentes.',
     'tags': ['VMS', 'demo'], 'tamano_bytes': 280_000_000, 'url': ''},
    {'brand': 'avigilion', 'tipo': 'certificacion', 'titulo': 'Certificación Avigilion Specialist',
     'descripcion': 'Certificado oficial para integradores autorizados.',
     'tags': ['certificación'], 'tamano_bytes': 900_000, 'url': ''},
    {'brand': 'avigilion', 'tipo': 'caso', 'titulo': 'Caso Retail — Cadena Nacional',
     'descripcion': 'Vigilancia inteligente en cadena de tiendas.',
     'tags': ['retail', 'caso'], 'tamano_bytes': 4_100_000,
     'url': '/static/marketing/recursos/casos/caso-retail-cadena-nacional.html'},
    {'brand': 'avigilion', 'tipo': 'propuesta', 'titulo': 'Propuesta Sistema Integral',
     'descripcion': 'Plantilla ejecutiva para sistemas de seguridad integral.',
     'tags': ['propuesta', 'seguridad'], 'tamano_bytes': 3_700_000, 'url': ''},
    {'brand': 'avigilion', 'tipo': 'presentacion', 'titulo': 'Vigilancia con IA — Deck Avigilion',
     'descripcion': 'Presentación ejecutiva: ACC7, Self-Learning Analytics y Appearance Search.',
     'tags': ['IA', 'analítica', 'deck'], 'tamano_bytes': 7_400_000,
     'url': '/static/marketing/recursos/presentaciones/avigilion-vigilancia-ia.html'},

    # GENETEC (5)
    {'brand': 'genetec', 'tipo': 'brochure', 'titulo': 'Security Center — Brochure',
     'descripcion': 'Plataforma unificada de seguridad física corporativa.',
     'tags': ['seguridad unificada'], 'tamano_bytes': 5_200_000,
     'url': '/static/marketing/recursos/brochures/genetec-security-center.html'},
    {'brand': 'genetec', 'tipo': 'landing', 'titulo': 'Landing — Control de Acceso',
     'descripcion': 'Landing para control de acceso unificado con video.',
     'tags': ['landing', 'acceso'], 'tamano_bytes': 0,
     'url': '/static/marketing/recursos/landings/genetec-control-acceso.html'},
    {'brand': 'genetec', 'tipo': 'presentacion', 'titulo': 'Genetec Smart City y Gobierno',
     'descripcion': 'Soluciones unificadas para gobierno y ciudad inteligente.',
     'tags': ['gobierno', 'smart city'], 'tamano_bytes': 9_800_000,
     'url': '/static/marketing/recursos/presentaciones/genetec-smart-city.html'},
    {'brand': 'genetec', 'tipo': 'caso', 'titulo': 'Ciudad Inteligente — Caso de Éxito',
     'descripcion': 'Implementación de Genetec en proyecto de gran escala.',
     'tags': ['smart city', 'CCTV'], 'tamano_bytes': 6_200_000, 'url': ''},
    {'brand': 'genetec', 'tipo': 'brochure', 'titulo': 'AutoVu ALPR — Brochure',
     'descripcion': 'Sistema de reconocimiento automático de placas vehiculares.',
     'tags': ['ALPR', 'placas'], 'tamano_bytes': 3_800_000, 'url': ''},

    # AXIS (2)
    {'brand': 'axis', 'tipo': 'brochure', 'titulo': 'Axis Q-Line — Brochure Cámaras Premium',
     'descripcion': 'Línea premium de cámaras IP Axis para entornos críticos.',
     'tags': ['cámaras', 'IP'], 'tamano_bytes': 4_600_000,
     'url': '/static/marketing/recursos/brochures/axis-camaras-q-line.html'},
    {'brand': 'axis', 'tipo': 'landing', 'titulo': 'Landing — Axis Vigilancia Premium',
     'descripcion': 'Landing para soluciones de vigilancia profesional Axis.',
     'tags': ['landing', 'analítica'], 'tamano_bytes': 0,
     'url': '/static/marketing/recursos/landings/axis-vigilancia-premium.html'},

    # APC (2)
    {'brand': 'apc', 'tipo': 'brochure', 'titulo': 'APC UPS Smart — Brochure',
     'descripcion': 'Catálogo de UPS Smart para data centers y empresa.',
     'tags': ['UPS', 'respaldo'], 'tamano_bytes': 3_100_000, 'url': ''},
    {'brand': 'apc', 'tipo': 'propuesta', 'titulo': 'Propuesta Energía Crítica APC',
     'descripcion': 'Plantilla de propuesta de respaldo de energía crítica.',
     'tags': ['energía', 'crítica'], 'tamano_bytes': 2_800_000, 'url': ''},

    # CISCO (2)
    {'brand': 'cisco', 'tipo': 'brochure', 'titulo': 'Cisco Meraki — Brochure Cloud Network',
     'descripcion': 'Networking en la nube para empresas con Meraki.',
     'tags': ['cloud', 'meraki', 'redes'], 'tamano_bytes': 5_400_000, 'url': ''},
    {'brand': 'cisco', 'tipo': 'presentacion', 'titulo': 'Cisco Webex — Presentación',
     'descripcion': 'Solución de colaboración corporativa Cisco Webex.',
     'tags': ['colaboración', 'webex'], 'tamano_bytes': 7_200_000, 'url': ''},

    # IAMET (5)
    {'brand': 'iamet', 'tipo': 'brochure', 'titulo': 'Brochure Corporativo IAMET',
     'descripcion': 'Presentación corporativa de IAMET — quiénes somos, capacidades y casos.',
     'tags': ['institucional', 'empresa'], 'tamano_bytes': 4_800_000,
     'url': '/static/marketing/recursos/brochures/iamet-corporativo.html'},
    {'brand': 'iamet', 'tipo': 'presentacion', 'titulo': 'Capacidades y Servicios IAMET',
     'descripcion': 'Deck ejecutivo con todas las capacidades técnicas y comerciales.',
     'tags': ['servicios', 'institucional'], 'tamano_bytes': 9_200_000, 'url': ''},
    {'brand': 'iamet', 'tipo': 'landing', 'titulo': 'Landing — IAMET Soluciones Integrales',
     'descripcion': 'Landing principal de IAMET para captación de clientes empresariales.',
     'tags': ['landing', 'institucional'], 'tamano_bytes': 0,
     'url': '/static/marketing/recursos/landings/iamet-soluciones-integrales.html'},
    {'brand': 'iamet', 'tipo': 'caso', 'titulo': 'Casos de Éxito IAMET 2024',
     'descripcion': 'Compendio de los principales proyectos entregados en 2024.',
     'tags': ['casos', 'éxito'], 'tamano_bytes': 5_600_000, 'url': ''},
]


def seed_recursos(apps, schema_editor):
    Recurso = apps.get_model('app', 'RecursoMarketing')
    # Solo poblar si la tabla está vacía (idempotente para re-runs en dev).
    if Recurso.objects.exists():
        return
    for idx, item in enumerate(SEED_RECURSOS):
        Recurso.objects.create(
            brand=item['brand'],
            tipo=item['tipo'],
            titulo=item['titulo'],
            descripcion=item['descripcion'],
            tags=item['tags'],
            tamano_bytes=item['tamano_bytes'],
            url=item['url'],
            orden=idx,
            visible=True,
        )


def unseed_recursos(apps, schema_editor):
    Recurso = apps.get_model('app', 'RecursoMarketing')
    # Solo borrar los del seed (los que tienen URL == static path o son los
    # primeros N creados). Para simplicidad y porque es un seed inicial,
    # borramos todos en el reverse — el dev re-aplica la migration si quiere.
    Recurso.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('app', '0153_contacto_email_telefono_puesto'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='can_manage_marketing',
            field=models.BooleanField(default=False, verbose_name='Puede gestionar Marketing'),
        ),
        migrations.CreateModel(
            name='RecursoMarketing',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('brand', models.CharField(choices=[
                    ('zebra', 'Zebra'), ('panduit', 'Panduit'), ('avigilion', 'Avigilion'),
                    ('genetec', 'Genetec'), ('axis', 'Axis'), ('apc', 'APC'),
                    ('cisco', 'Cisco'), ('iamet', 'IAMET'),
                ], db_index=True, max_length=20)),
                ('tipo', models.CharField(choices=[
                    ('brochure', 'Brochure'), ('landing', 'Landing Page'),
                    ('presentacion', 'Presentación'), ('certificacion', 'Certificación'),
                    ('video', 'Video'), ('banner', 'Banner'),
                    ('propuesta', 'Propuesta'), ('caso', 'Caso de éxito'),
                ], db_index=True, max_length=20)),
                ('titulo', models.CharField(max_length=255)),
                ('descripcion', models.TextField(blank=True, default='')),
                ('tags', models.JSONField(blank=True, default=list)),
                ('archivo', models.FileField(blank=True, help_text='Archivo subido (PDF, PPT, MP4, PNG…). Opcional si se usa `url`.', null=True, upload_to='marketing/recursos/%Y/%m/')),
                ('url', models.URLField(blank=True, default='', help_text='URL externa (landing page, video, doc en Drive). Opcional si se usa `archivo`.', max_length=500)),
                ('tamano_bytes', models.PositiveBigIntegerField(default=0)),
                ('fecha_creacion', models.DateTimeField(auto_now_add=True)),
                ('fecha_actualizacion', models.DateTimeField(auto_now=True)),
                ('visible', models.BooleanField(db_index=True, default=True)),
                ('orden', models.PositiveIntegerField(default=0)),
                ('subido_por', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='recursos_marketing_subidos', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Recurso de Marketing',
                'verbose_name_plural': 'Recursos de Marketing',
                'ordering': ['brand', 'tipo', '-fecha_creacion'],
            },
        ),
        migrations.AddIndex(
            model_name='recursomarketing',
            index=models.Index(fields=['brand', 'tipo'], name='app_recurso_brand_aa31c0_idx'),
        ),
        migrations.AddIndex(
            model_name='recursomarketing',
            index=models.Index(fields=['visible', '-fecha_creacion'], name='app_recurso_visible_3e7adb_idx'),
        ),
        migrations.RunPython(seed_recursos, reverse_code=unseed_recursos),
    ]

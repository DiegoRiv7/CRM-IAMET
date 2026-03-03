"""
Crea oportunidades en el CRM para proyectos de Bitrix24 que tienen archivos PO
en su Drive pero no están vinculados a ninguna oportunidad.

Pipeline: 'bitrix_proyecto' (Proyecto Bitrix24)
- Monto = $0
- Solo se muestra el Drive con los archivos del proyecto

Uso:
    python manage.py create_bitrix_project_opportunities
    python manage.py create_bitrix_project_opportunities --dry-run
    python manage.py create_bitrix_project_opportunities --all-unlinked
"""

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from app.models import Proyecto, TodoItem, Cliente, OportunidadProyecto


CLIENTE_BITRIX_NOMBRE = "PROYECTOS BITRIX24"


class Command(BaseCommand):
    help = "Crea oportunidades tipo 'Proyecto Bitrix24' para proyectos no vinculados con archivos PO"

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Muestra qué se haría sin guardar nada'
        )
        parser.add_argument(
            '--all-unlinked', action='store_true',
            help='Incluir TODOS los proyectos sin oportunidad (no solo los con tiene_archivos_po)'
        )
        parser.add_argument(
            '--usuario', type=str, default=None,
            help='Username del usuario asignado (default: primer superusuario)'
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        all_unlinked = options['all_unlinked']

        # ── Usuario por defecto ───────────────────────────────────────────────
        if options['usuario']:
            try:
                default_user = User.objects.get(username=options['usuario'])
            except User.DoesNotExist:
                self.stderr.write(f"Usuario '{options['usuario']}' no encontrado.")
                return
        else:
            default_user = User.objects.filter(is_superuser=True).order_by('id').first()
            if not default_user:
                default_user = User.objects.order_by('id').first()
        if not default_user:
            self.stderr.write("No hay usuarios en la base de datos.")
            return

        self.stdout.write(f"Usuario asignado: {default_user.get_full_name() or default_user.username}")

        # ── Cliente comodín ───────────────────────────────────────────────────
        if not dry_run:
            cliente, creado = Cliente.objects.get_or_create(
                nombre_empresa=CLIENTE_BITRIX_NOMBRE,
                defaults={
                    'contacto_principal': 'Bitrix24',
                    'categoria': 'C',
                }
            )
            if creado:
                self.stdout.write(f"Cliente creado: {CLIENTE_BITRIX_NOMBRE}")
        else:
            cliente = None

        # ── Proyectos candidatos ───────────────────────────────────────────────
        if all_unlinked:
            proyectos = Proyecto.objects.filter(bitrix_group_id__isnull=False)
        else:
            proyectos = Proyecto.objects.filter(
                bitrix_group_id__isnull=False,
                tiene_archivos_po=True
            )

        # Filtrar los que ya tienen oportunidad ligada
        sin_vincular = [p for p in proyectos if not p.oportunidades_ligadas.exists()]

        self.stdout.write(f"\nProyectos candidatos: {len(sin_vincular)}")
        if not sin_vincular:
            self.stdout.write("Nada que crear.")
            return

        creados = 0
        omitidos = 0
        group_ids = []

        for proyecto in sin_vincular:
            nombre = proyecto.nombre[:200]

            # Verificar si ya existe una oportunidad con este nombre de proyecto
            ya_existe = OportunidadProyecto.objects.filter(
                bitrix_project_id=str(proyecto.bitrix_group_id)
            ).exists()
            if ya_existe:
                omitidos += 1
                continue

            if dry_run:
                self.stdout.write(f"  [DRY] Crear: {nombre[:60]}")
                group_ids.append(str(proyecto.bitrix_group_id))
                creados += 1
                continue

            # Crear la oportunidad
            oportunidad = TodoItem.objects.create(
                usuario=default_user,
                oportunidad=nombre,
                cliente=cliente,
                producto='ZEBRA',
                monto=0,
                monto_facturacion=0,
                probabilidad_cierre=0,
                mes_cierre='01',
                area='SISTEMAS',
                tipo_negociacion='bitrix_proyecto',
                etapa_corta='Nuevo',
                etapa_completa='Nuevo Proyecto',
                etapa_color='#5856D6',
                comentarios=f'Proyecto Bitrix24 ID: {proyecto.bitrix_group_id}',
            )

            # Vincular
            proyecto.oportunidades_ligadas.add(oportunidad)
            OportunidadProyecto.objects.create(
                oportunidad=oportunidad,
                bitrix_project_id=str(proyecto.bitrix_group_id),
                proyecto_nombre=nombre,
                bitrix_deal_id='',
                created_by=default_user,
            )

            group_ids.append(str(proyecto.bitrix_group_id))
            creados += 1
            self.stdout.write(f"  Creado: {nombre[:60]} [opp_id={oportunidad.id}]")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"=== Listo ==="))
        self.stdout.write(f"  Creadas:  {creados}")
        self.stdout.write(f"  Omitidas: {omitidos} (ya tenían OportunidadProyecto)")

        if group_ids and not dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "Ahora ejecuta el siguiente comando para sincronizar los archivos:"
            ))
            ids_str = " ".join(group_ids[:50])
            if len(group_ids) > 50:
                ids_str += f"  (+{len(group_ids) - 50} más, ejecuta en lotes)"
            self.stdout.write(
                f"  python manage.py sync_bitrix_projects_tasks --group-ids {ids_str}"
            )

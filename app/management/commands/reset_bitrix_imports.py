"""
Elimina TODO lo importado desde Bitrix para permitir un reimport limpio.

Qué borra:
  - TareaOportunidad con bitrix_task_id (importadas de Bitrix)
  - Actividad vinculadas a esas TareaOportunidad
  - MensajeOportunidad auto-generados por imports ([ACT: / [ACT_COMPLETADA:)
  - ArchivoOportunidad con bitrix_file_id (drive sync)
  - CarpetaOportunidad (todas, vienen del drive sync)
  - OportunidadProyecto (todos los vínculos proyecto↔oportunidad)
  - Tarea creadas por el usuario bitrix_import
  - Proyecto + CarpetaProyecto + ArchivoProyecto + ProyectoComentario creados por bitrix_import
  - Usuario ficticio "bitrix_import"
  - Limpia UserProfile.bitrix_user_id de todos los usuarios (para re-mapear limpio)

NO borra:
  - Oportunidades (TodoItem), Clientes, Cotizaciones
  - Usuarios reales (solo limpia su bitrix_user_id para re-sincronizar)
  - Tareas creadas manualmente por usuarios reales
  - MensajeOportunidad escritos manualmente por usuarios reales
  - Actividades creadas manualmente

IMPORTANTE: Ejecuta export_project_links ANTES de correr este comando.

Uso:
    python manage.py reset_bitrix_imports --dry-run   # ver qué borrará
    python manage.py reset_bitrix_imports             # ejecutar
"""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import connection

from app.models import (
    UserProfile,
    Actividad, ArchivoOportunidad, ArchivoProyecto,
    CarpetaOportunidad, CarpetaProyecto, MensajeOportunidad,
    OportunidadProyecto, Proyecto, ProyectoComentario,
    Tarea, TareaOportunidad,
)


class Command(BaseCommand):
    help = 'Borra todo lo importado de Bitrix para permitir un reimport limpio'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Solo muestra conteos, no borra nada')

    def _count(self, label, qs):
        n = qs.count()
        self.stdout.write(f"  {label:<45}: {n:>6}")
        return n

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        if dry_run:
            self.stdout.write(self.style.WARNING("── DRY RUN — no se borrará nada ──\n"))
        else:
            self.stdout.write(self.style.ERROR(
                "⚠  ATENCIÓN: esto borrará datos permanentemente.\n"
                "   Asegúrate de haber ejecutado export_project_links primero.\n"
            ))
            confirm = input("Escribe CONFIRMAR para continuar: ").strip()
            if confirm != "CONFIRMAR":
                self.stdout.write("Cancelado.")
                return

        # Usuario ficticio de imports
        bitrix_user = User.objects.filter(username="bitrix_import").first()

        self.stdout.write("\n=== CONTEO DE REGISTROS A ELIMINAR ===\n")

        # 1. TareaOportunidad importadas (bitrix_task_id != null)
        topp_qs = TareaOportunidad.objects.filter(bitrix_task_id__isnull=False)
        n_topp = self._count("TareaOportunidad (bitrix_task_id)", topp_qs)

        # 2. Actividades vinculadas a esas TareaOportunidad
        act_ids_from_topp = list(
            topp_qs.exclude(actividad_calendario=None)
            .values_list('actividad_calendario_id', flat=True)
        )
        act_bitrix_qs = Actividad.objects.filter(id__in=act_ids_from_topp)
        if bitrix_user:
            act_bitrix_qs = Actividad.objects.filter(
                id__in=act_ids_from_topp
            ) | Actividad.objects.filter(creado_por=bitrix_user)
        n_act = self._count("Actividad (de imports)", act_bitrix_qs.distinct())

        # 3. MensajeOportunidad auto-generados
        msg_qs = MensajeOportunidad.objects.filter(
            texto__startswith='[ACT'
        )
        n_msg = self._count("MensajeOportunidad ([ACT...])", msg_qs)

        # 4. ArchivoOportunidad (drive sync)
        arch_opp_qs = ArchivoOportunidad.objects.filter(bitrix_file_id__isnull=False)
        n_arch_opp = self._count("ArchivoOportunidad (bitrix_file_id)", arch_opp_qs)

        # 5. CarpetaOportunidad (todas vienen del drive sync)
        carp_opp_qs = CarpetaOportunidad.objects.all()
        n_carp_opp = self._count("CarpetaOportunidad (todas)", carp_opp_qs)

        # 6. OportunidadProyecto (todos los vínculos)
        opp_proj_qs = OportunidadProyecto.objects.all()
        n_opp_proj = self._count("OportunidadProyecto (vínculos)", opp_proj_qs)

        # 7. Tarea de bitrix_import
        if bitrix_user:
            tarea_qs = Tarea.objects.filter(creado_por=bitrix_user)
            n_tarea = self._count("Tarea (creadas por bitrix_import)", tarea_qs)
        else:
            tarea_qs = Tarea.objects.none()
            n_tarea = 0
            self.stdout.write("  ⚠ Usuario bitrix_import no encontrado")

        # 8. UserProfile: limpiar bitrix_user_id
        profiles_qs = UserProfile.objects.exclude(bitrix_user_id=None)
        n_profiles = self._count("UserProfile.bitrix_user_id a limpiar", profiles_qs)

        # 9. Usuario ficticio bitrix_import
        bitrix_user_del = User.objects.filter(username="bitrix_import")
        n_bitrix_user = self._count("Usuario 'bitrix_import' a eliminar", bitrix_user_del)

        # 10. Proyectos de bitrix_import
        if bitrix_user:
            proy_qs = Proyecto.objects.filter(creado_por=bitrix_user)
            n_proy = self._count("Proyecto (creados por bitrix_import)", proy_qs)
            proy_ids = list(proy_qs.values_list('id', flat=True))
            arch_proy_qs = ArchivoProyecto.objects.filter(proyecto_id__in=proy_ids)
            carp_proy_qs = CarpetaProyecto.objects.filter(proyecto_id__in=proy_ids)
            com_proy_qs = ProyectoComentario.objects.filter(proyecto_id__in=proy_ids)
            n_arch_proy = self._count("ArchivoProyecto (de proyectos bitrix)", arch_proy_qs)
            n_carp_proy = self._count("CarpetaProyecto (de proyectos bitrix)", carp_proy_qs)
            n_com_proy = self._count("ProyectoComentario (de proyectos bitrix)", com_proy_qs)
        else:
            proy_qs = Proyecto.objects.none()
            arch_proy_qs = ArchivoProyecto.objects.none()
            carp_proy_qs = CarpetaProyecto.objects.none()
            com_proy_qs = ProyectoComentario.objects.none()
            n_proy = n_arch_proy = n_carp_proy = n_com_proy = 0

        total = n_topp + n_act + n_msg + n_arch_opp + n_carp_opp + n_opp_proj + \
                n_tarea + n_proy + n_arch_proy + n_carp_proy + n_com_proy + \
                n_profiles + n_bitrix_user
        self.stdout.write(f"\n  {'TOTAL A ELIMINAR':<45}: {total:>6}\n")

        if dry_run:
            self.stdout.write(self.style.WARNING("(DRY RUN: no se borró nada)"))
            return

        self.stdout.write("\n=== ELIMINANDO ===\n")

        with connection.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")

            # Actividades de imports
            ids_act = list(act_bitrix_qs.distinct().values_list('id', flat=True))
            if ids_act:
                Actividad.objects.filter(id__in=ids_act).delete()
                self.stdout.write(f"  ✓ Actividad: {len(ids_act)} eliminadas")

            # TareaOportunidad
            n, _ = topp_qs.delete()
            self.stdout.write(f"  ✓ TareaOportunidad: {n} eliminadas")

            # MensajeOportunidad auto-generados
            n, _ = msg_qs.delete()
            self.stdout.write(f"  ✓ MensajeOportunidad: {n} eliminados")

            # ArchivoOportunidad
            n, _ = arch_opp_qs.delete()
            self.stdout.write(f"  ✓ ArchivoOportunidad: {n} eliminados")

            # CarpetaOportunidad (con FK circular, raw SQL)
            cur.execute("DELETE FROM app_carpetaoportunidad")
            self.stdout.write(f"  ✓ CarpetaOportunidad: {cur.rowcount} eliminadas")

            # OportunidadProyecto
            n, _ = opp_proj_qs.delete()
            self.stdout.write(f"  ✓ OportunidadProyecto: {n} eliminados")

            # Archivos y carpetas de proyectos
            if arch_proy_qs.exists():
                n, _ = arch_proy_qs.delete()
                self.stdout.write(f"  ✓ ArchivoProyecto: {n} eliminados")
            if carp_proy_qs.exists():
                cur.execute(
                    "DELETE FROM app_carpetaproyecto WHERE proyecto_id IN %s",
                    [tuple(proy_ids) if proy_ids else (0,)]
                )
                self.stdout.write(f"  ✓ CarpetaProyecto: {cur.rowcount} eliminadas")
            if com_proy_qs.exists():
                n, _ = com_proy_qs.delete()
                self.stdout.write(f"  ✓ ProyectoComentario: {n} eliminados")

            # Proyectos
            if proy_qs.exists():
                n, _ = proy_qs.delete()
                self.stdout.write(f"  ✓ Proyecto: {n} eliminados")

            # Tareas de bitrix_import
            if tarea_qs.exists():
                n, _ = tarea_qs.delete()
                self.stdout.write(f"  ✓ Tarea: {n} eliminadas")

            cur.execute("SET FOREIGN_KEY_CHECKS=1")

        # Limpiar bitrix_user_id en UserProfile (fuera del bloque FK checks, es seguro)
        n_prof_upd = profiles_qs.update(bitrix_user_id=None)
        self.stdout.write(f"  ✓ UserProfile.bitrix_user_id limpiado: {n_prof_upd}")

        # Borrar usuario ficticio bitrix_import
        n_bu, _ = bitrix_user_del.delete()
        self.stdout.write(f"  ✓ Usuario 'bitrix_import' eliminado: {n_bu}")

        self.stdout.write(self.style.SUCCESS("\n✅ Reset completado. Listo para reimport limpio."))
        self.stdout.write("\nOrden recomendado para reimport:")
        self.stdout.write("  1. python manage.py sync_bitrix_users")
        self.stdout.write("  2. python manage.py sync_bitrix  (oportunidades)")
        self.stdout.write("  3. python manage.py sync_proyectos_ingenieria")
        self.stdout.write("  4. python manage.py sync_bitrix_drive_smart")
        self.stdout.write("  5. python manage.py import_project_tasks")
        self.stdout.write("  6. python manage.py restore_project_links  (restaurar los 469)")
        self.stdout.write("\n=== FIN ===")

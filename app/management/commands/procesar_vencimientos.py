"""
Procesa tareas y actividades vencidas / por vencer y crea las
notificaciones correspondientes. Diseñado para ser corrido por cron
cada 5 minutos en el servidor.

Antes esta lógica se ejecutaba EN CADA POLL del endpoint
/api/obtener-notificaciones/ (cada 3 segundos × N usuarios), lo que
provocaba:
  - Carga DB innecesaria (mismos checks repetidos miles de veces).
  - Race conditions con .exists()+.create() que generaban duplicados.

Ahora corre como job background. El endpoint de notificaciones solo
LEE las notificaciones existentes — no las crea.

Uso:
    python manage.py procesar_vencimientos

Cron sugerido (corre cada 5 minutos):
    */5 * * * * cd /home/iamet2026/crm-iamet && /usr/bin/docker exec \\
        gesti-n-de-ventas-web-1 python manage.py procesar_vencimientos \\
        >> /var/log/crm-vencimientos.log 2>&1
"""
import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone
from django.db.models import Q

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Crea notificaciones de tareas y actividades vencidas / por vencer.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--umbral-minutos',
            type=int,
            default=10,
            help='Minutos antes del vencimiento para crear notif "por_vencer" (default: 10)',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Imprime por cada notificación creada (útil en debug).',
        )

    def handle(self, *args, **options):
        from app.models import (
            Tarea, TareaOportunidad, Notificacion,
        )
        from app.views_utils import crear_notificacion

        umbral_min = options['umbral_minutos']
        verbose = options['verbose']

        now = timezone.now()
        umbral_por_vencer = now + timedelta(minutes=umbral_min)

        creadas = {'tarea_vencida': 0, 'tarea_por_vencer': 0,
                   'actividad_vencida': 0, 'actividad_por_vencer': 0}
        omitidas = 0

        self.stdout.write(self.style.NOTICE(
            f'[{now:%Y-%m-%d %H:%M:%S}] Procesando vencimientos (umbral={umbral_min}min)…'
        ))

        # ─── Tareas (modelo Tarea — sidebar Tareas) ───
        # Busca tareas activas de TODOS los usuarios donde son asignado_a
        # o participante. La query es global pero la notif se asigna al
        # usuario específico.
        tareas_activas = Tarea.objects.filter(
            estado__in=['pendiente', 'iniciada', 'en_progreso'],
            fecha_limite__isnull=False,
        ).select_related('asignado_a').prefetch_related('participantes')

        for t in tareas_activas:
            # Lista de usuarios que deben recibir la notif para esta tarea.
            users = set()
            if t.asignado_a_id:
                users.add(t.asignado_a)
            for p in t.participantes.all():
                users.add(p)
            if not users:
                continue

            vencida = t.fecha_limite < now
            por_vencer = (not vencida) and t.fecha_limite <= umbral_por_vencer
            if not vencida and not por_vencer:
                continue

            tipo = 'tarea_vencida' if vencida else 'tarea_por_vencer'
            titulo = 'Tarea Vencida' if vencida else 'Tarea por Vencer'
            mensaje = (
                f'La tarea "{t.titulo}" ha vencido.' if vencida
                else f'La tarea "{t.titulo}" vence en menos de {umbral_min} minutos.'
            )

            for user in users:
                # Idempotente: si ya existe una notif del mismo tipo para
                # esta tarea+usuario, no se duplica.
                ya = Notificacion.objects.filter(
                    usuario_destinatario=user, tipo=tipo, tarea_id=t.id,
                ).exists()
                if ya:
                    omitidas += 1
                    continue
                n = crear_notificacion(
                    user, tipo, titulo, mensaje,
                    tarea_id=t.id, tarea_titulo=t.titulo,
                )
                if n:
                    creadas[tipo] += 1
                    if verbose:
                        self.stdout.write(f'  + {tipo} → {user.username} (tarea {t.id})')

        # ─── Tareas de Oportunidad (modelo TareaOportunidad) ───
        tareas_opp_activas = TareaOportunidad.objects.filter(
            estado__in=['pendiente', 'en_progreso'],
            fecha_limite__isnull=False,
        ).select_related('responsable', 'oportunidad').prefetch_related('participantes')

        for t in tareas_opp_activas:
            users = set()
            if t.responsable_id:
                users.add(t.responsable)
            for p in t.participantes.all():
                users.add(p)
            if not users:
                continue

            vencida = t.fecha_limite < now
            por_vencer = (not vencida) and t.fecha_limite <= umbral_por_vencer
            if not vencida and not por_vencer:
                continue

            tipo = 'actividad_vencida' if vencida else 'actividad_por_vencer'
            titulo = 'Actividad Vencida' if vencida else 'Actividad por Vencer'
            mensaje = (
                f'La actividad "{t.titulo}" ha vencido.' if vencida
                else f'La actividad "{t.titulo}" vence en menos de {umbral_min} minutos.'
            )

            for user in users:
                ya = Notificacion.objects.filter(
                    usuario_destinatario=user, tipo=tipo, tarea_opp=t,
                ).exists()
                if ya:
                    omitidas += 1
                    continue
                n = crear_notificacion(
                    user, tipo, titulo, mensaje,
                    tarea_opp=t, oportunidad=t.oportunidad,
                )
                if n:
                    creadas[tipo] += 1
                    if verbose:
                        self.stdout.write(f'  + {tipo} → {user.username} (tarea-opp {t.id})')

        # ─── Resumen ───
        total_creadas = sum(creadas.values())
        self.stdout.write(self.style.SUCCESS(
            f'Done. Creadas: {total_creadas} ({creadas}); ya existían: {omitidas}'
        ))
        logger.info('[vencimientos] creadas=%s omitidas=%s detail=%s',
                    total_creadas, omitidas, creadas)

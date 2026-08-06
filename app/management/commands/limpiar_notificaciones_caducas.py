"""Barre las notificaciones de vencimiento que ya no corresponden.

Complementa a `procesar_vencimientos` (que las CREA) y a la reconciliación de
`signals_sync` (que las borra al guardar el objeto). Hace falta porque esa
reconciliación es reactiva: solo dispara cuando alguien vuelve a guardar la
tarea. Todo lo que se generó antes de que existiera (junio 2026), lo que
salió de rutas que actualizan en bloque con .update(), y lo que quedó
huérfano al borrar una tarea, sigue en la tabla indefinidamente — que es lo
que hacía que una tarea completada apareciera como vencida en el cajón.

La API de notificaciones ya depura al leer, así que el usuario no las ve; este
comando existe para vaciar el histórico de una sola pasada y para poder correrlo
junto al cron sin depender de que alguien abra el widget.

    python manage.py limpiar_notificaciones_caducas            # aplica
    python manage.py limpiar_notificaciones_caducas --dry-run  # solo reporta
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from app.models import Notificacion, Tarea, TareaOportunidad

TIPOS_TAREA = ('tarea_vencida', 'tarea_por_vencer')
TIPOS_TAREA_OPP = ('actividad_vencida', 'actividad_por_vencer')
ACTIVOS_TAREA = ('pendiente', 'iniciada', 'en_progreso')
ACTIVOS_TAREA_OPP = ('pendiente', 'en_progreso')


class Command(BaseCommand):
    help = 'Borra notificaciones de vencimiento que ya no aplican (completadas, reprogramadas o huérfanas).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--umbral-minutos', type=int, default=10,
            help='Ventana de "por vencer". Debe coincidir con procesar_vencimientos (default: 10).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Reporta lo que borraría, sin borrar.',
        )

    def handle(self, *args, **opts):
        umbral_min = opts['umbral_minutos']
        seco = opts['dry_run']
        ahora = timezone.now()
        umbral = ahora + timedelta(minutes=umbral_min)

        def sigue_aplicando(tipo, activo, fecha):
            if not activo or not fecha:
                return False
            vencida = fecha < ahora
            if tipo.endswith('_por_vencer'):
                return (not vencida) and fecha <= umbral
            return vencida

        motivos = {'resuelta': 0, 'huerfana': 0}
        a_borrar = []

        def revisar(tipos, campo_id, modelo, activos):
            notifs = list(
                Notificacion.objects.filter(tipo__in=tipos).values('id', 'tipo', campo_id)
            )
            if not notifs:
                return
            ids = {n[campo_id] for n in notifs if n[campo_id]}
            vivos = {
                o.id: o for o in modelo.objects.filter(id__in=ids)
                                    .only('id', 'estado', 'fecha_limite')
            }
            for n in notifs:
                obj = vivos.get(n[campo_id])
                if obj is None:
                    motivos['huerfana'] += 1
                    a_borrar.append(n['id'])
                elif not sigue_aplicando(n['tipo'], obj.estado in activos, obj.fecha_limite):
                    motivos['resuelta'] += 1
                    a_borrar.append(n['id'])

        revisar(TIPOS_TAREA, 'tarea_id', Tarea, ACTIVOS_TAREA)
        revisar(TIPOS_TAREA_OPP, 'tarea_opp_id', TareaOportunidad, ACTIVOS_TAREA_OPP)

        total = len(a_borrar)
        if not total:
            self.stdout.write(self.style.SUCCESS('Nada que limpiar: no hay notificaciones de vencimiento caducas.'))
            return

        self.stdout.write(
            'Caducas: %d  (ya resueltas: %d, huérfanas: %d)'
            % (total, motivos['resuelta'], motivos['huerfana'])
        )
        if seco:
            self.stdout.write(self.style.WARNING('--dry-run: no se borró nada.'))
            return

        Notificacion.objects.filter(id__in=a_borrar).delete()
        self.stdout.write(self.style.SUCCESS('Borradas %d notificaciones caducas.' % total))

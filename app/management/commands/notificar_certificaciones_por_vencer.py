"""Genera notificaciones para certificaciones próximas a vencer o
recién vencidas. Pensado para correrse diariamente via cron.

Reglas:
- 60, 30 y 7 días antes del vencimiento → "Tu certificación X vence
  en N días".
- Día del vencimiento (0 días) → "Tu certificación X venció hoy".

Deduplicación: no se crea una notificación duplicada para la misma
certificación + ventana de días.

Uso:
    python manage.py notificar_certificaciones_por_vencer
    python manage.py notificar_certificaciones_por_vencer --dry-run
"""
from datetime import date, timedelta
from django.core.management.base import BaseCommand

from app.models import Certificacion, Notificacion


# Ventanas de alerta: días restantes para disparar la notificación.
# Si una cert vence en uno de estos números exactos, se manda alerta.
VENTANAS_DIAS = [60, 30, 7]


class Command(BaseCommand):
    help = 'Crea notificaciones para certificaciones por vencer (60/30/7 días) y vencidas (0).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='No crea las notificaciones, solo las imprime.')
        parser.add_argument('--ventanas', default=','.join(str(v) for v in VENTANAS_DIAS),
                            help='Lista de días separada por coma. Default: 60,30,7')

    def handle(self, *args, **opts):
        dry = opts['dry_run']
        try:
            ventanas = [int(v.strip()) for v in opts['ventanas'].split(',') if v.strip()]
        except ValueError:
            self.stderr.write(self.style.ERROR('Formato de --ventanas inválido (usa N,N,N enteros).'))
            return

        hoy = date.today()
        creadas = 0
        ya_existentes = 0

        # Trabajamos sobre el universo razonable: desde hoy hasta la
        # ventana más lejana. El filtrado fino (diff exacto) es en Python.
        max_dias = max(ventanas) if ventanas else 0
        candidatas = Certificacion.objects.select_related('usuario').filter(
            fecha_vencimiento__isnull=False,
            fecha_vencimiento__gte=hoy,
            fecha_vencimiento__lte=hoy + timedelta(days=max_dias),
        )

        for c in candidatas:
            diff = (c.fecha_vencimiento - hoy).days
            if diff == 0:
                tipo = 'certificacion_vencida'
                titulo = f'Tu certificación {c.nombre} venció hoy'
                mensaje = (
                    f'Tu certificación "{c.nombre}" ({c.marca}) venció el {c.fecha_vencimiento:%d/%m/%Y}. '
                    f'Es momento de renovarla.'
                )
            elif diff in ventanas:
                tipo = 'certificacion_por_vencer'
                titulo = f'Tu certificación {c.nombre} vence en {diff} días'
                mensaje = (
                    f'Tu certificación "{c.nombre}" ({c.marca}) vence el {c.fecha_vencimiento:%d/%m/%Y}. '
                    f'Quedan {diff} días para renovarla.'
                )
            else:
                continue

            # Deduplicación: ¿ya hay una notificación de este tipo para esta
            # certificación con el mismo "diff" registrado en el mensaje?
            # Usamos el título como llave estable (incluye el N de días).
            ya = Notificacion.objects.filter(
                usuario_destinatario=c.usuario,
                certificacion=c,
                tipo=tipo,
                titulo=titulo,
            ).exists()
            if ya:
                ya_existentes += 1
                continue

            if dry:
                self.stdout.write(f'[DRY] → {c.usuario.username}: {titulo}')
                creadas += 1
                continue

            Notificacion.objects.create(
                usuario_destinatario=c.usuario,
                tipo=tipo,
                titulo=titulo,
                mensaje=mensaje,
                certificacion=c,
            )
            creadas += 1

        self.stdout.write(self.style.SUCCESS(
            f'{"[DRY] " if dry else ""}Notificaciones creadas: {creadas}. Ya existentes (sin duplicar): {ya_existentes}.'
        ))

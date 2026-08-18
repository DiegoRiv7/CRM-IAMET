# Worker de correo en segundo plano (Fase 2).
# Por cada conexión activa: (1) aplica la cola de acciones CRM→IMAP,
# (2) baja encabezados nuevos de INBOX/SENT, (3) refleja flags del servidor
# (leído/destacado desde el celular) en la caché local.
#
# Uso:
#   python manage.py sincronizar_correo            # una pasada
#   python manage.py sincronizar_correo --loop 180 # cada 3 minutos (servicio)

import time

from django.core.management.base import BaseCommand
from django.db import connections

from app.models import MailConexion
from app.views_mail import (
    _get_imap,
    aplicar_acciones_pendientes,
    procesar_envios_programados,
    refrescar_flags_inbox,
    sincronizar_nuevos_conexion,
)


class Command(BaseCommand):
    help = 'Sincroniza el correo de todos los usuarios (dos vías) en segundo plano'

    def add_arguments(self, parser):
        parser.add_argument('--loop', type=int, default=0,
                            help='Segundos entre pasadas (0 = una sola pasada)')
        parser.add_argument('--usuario', type=str, default='',
                            help='Limitar a un username (debug)')

    def handle(self, *args, **opts):
        loop = opts['loop']
        while True:
            # Envíos programados vencidos (independiente del loop por conexión)
            try:
                n_prog = procesar_envios_programados()
                if n_prog:
                    self.stdout.write(f'{n_prog} envíos programados despachados')
            except Exception as e:
                self.stderr.write(f'Error en envíos programados: {e}')

            qs = MailConexion.objects.filter(activo=True).select_related('usuario')
            if opts['usuario']:
                qs = qs.filter(usuario__username=opts['usuario'])
            for conexion in qs:
                try:
                    imap = _get_imap(conexion)
                except Exception as e:
                    self.stderr.write(f'{conexion.correo_electronico}: sin conexión IMAP ({e})')
                    continue
                try:
                    acciones = aplicar_acciones_pendientes(conexion, imap)
                    nuevos = sincronizar_nuevos_conexion(conexion, imap)
                    flags = refrescar_flags_inbox(conexion, imap)
                    self.stdout.write(
                        f'{conexion.correo_electronico}: {nuevos} nuevos, '
                        f'{acciones} acciones aplicadas, {flags} flags actualizados'
                    )
                    # Mi Asistente: clasificar lo recién llegado (IA con tope, 1 sola
                    # vez por correo) para que el veredicto ya esté listo cuando el
                    # widget pregunte por el feed.
                    if nuevos:
                        try:
                            from app.views_crm import analizar_correos_recientes
                            analizados = analizar_correos_recientes(conexion.usuario)
                            if analizados:
                                self.stdout.write(
                                    f'{conexion.correo_electronico}: {analizados} correos analizados'
                                )
                        except Exception as e:
                            self.stderr.write(f'{conexion.correo_electronico}: análisis falló ({e})')
                except Exception as e:
                    self.stderr.write(f'{conexion.correo_electronico}: error ({e})')
                finally:
                    try:
                        imap.logout()
                    except Exception:
                        pass
            if not loop:
                break
            # MySQL cierra conexiones ociosas; renovarlas entre pasadas
            connections.close_all()
            time.sleep(loop)

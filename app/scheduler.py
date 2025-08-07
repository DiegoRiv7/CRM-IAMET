import logging
from apscheduler.schedulers.background import BackgroundScheduler
from django.core.management import call_command
from django.conf import settings
from datetime import datetime

logger = logging.getLogger(__name__)

def sync_bitrix_daily():
    """
    Función que ejecuta la sincronización diaria con Bitrix
    """
    try:
        logger.info(f"🚀 Iniciando sincronización automática Bitrix - {datetime.now()}")
        
        # Ejecuta el comando de sincronización completa
        call_command('sync_all_bitrix', '--force')
        
        logger.info("✅ Sincronización automática Bitrix completada exitosamente")
        
    except Exception as e:
        logger.error(f"❌ Error en sincronización automática Bitrix: {str(e)}")

def start_scheduler():
    """
    Inicia el scheduler de tareas
    """
    if not settings.DEBUG:  # Solo en producción
        scheduler = BackgroundScheduler()
        
        # Programa la sincronización todos los días a las 2:00 AM
        scheduler.add_job(
            sync_bitrix_daily,
            'cron',
            hour=2,
            minute=0,
            id='bitrix_daily_sync',
            replace_existing=True,
            timezone='America/Tijuana'  # Ajusta a tu zona horaria
        )
        
        scheduler.start()
        logger.info("📅 Scheduler iniciado - Sincronización Bitrix programada para las 2:00 AM diario")
        
        return scheduler
    else:
        logger.info("🔧 Scheduler deshabilitado en modo DEBUG")
        return None
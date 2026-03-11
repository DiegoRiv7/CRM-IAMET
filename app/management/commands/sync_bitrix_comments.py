import os
import time
import requests
from django.core.management.base import BaseCommand
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from datetime import timedelta
from app.models import Tarea, TareaComentario, UserProfile
from django.contrib.auth.models import User

WEBHOOK_BASE = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)

def _base_url():
    return WEBHOOK_BASE.rsplit("/", 1)[0] + "/"

def _call(endpoint, payload=None, retries=3):
    url = _base_url() + endpoint + ".json"
    for attempt in range(retries):
        try:
            resp = requests.post(url, json=payload or {}, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                raise ValueError(f"Bitrix error: {data['error']} - {data.get('error_description', '')}")
            return data
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return {}

class Command(BaseCommand):
    help = "Sincroniza comentarios de tareas recientes desde Bitrix24"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Muestra acciones sin guardar")
        parser.add_argument("--months", type=int, default=4, help="Meses de antiguedad para buscar tareas (default: 4)")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        months = options["months"]
        
        self.stdout.write(f"Iniciando sincronización de comentarios de las tareas de los últimos {months} meses...")
        if dry_run:
            self.stdout.write(self.style.WARNING("MODO DRY-RUN — no se guardará nada"))

        # Mapa de Usuarios
        user_map = {}
        for up in UserProfile.objects.filter(bitrix_user_id__isnull=False):
            user_map[str(up.bitrix_user_id)] = up.user
            
        user, _ = User.objects.get_or_create(
            username="bitrix_import",
            defaults={"first_name": "Bitrix", "last_name": "Import", "is_active": False},
        )
        default_user = user
        
        # Filtrar tareas a partir de una fecha límite (ej. recientes de 4 meses)
        # Aproximadamente desde el 1 de Diciembre del 2025 (o relativo 120 días).
        fecha_limite = timezone.now() - timedelta(days=30 * months)
        tareas = Tarea.objects.filter(fecha_creacion__gte=fecha_limite, bitrix_task_id__isnull=False)
        total_tareas = tareas.count()
        
        self.stdout.write(f"Se evaluarán {total_tareas} tareas locales creadas desde {fecha_limite.strftime('%Y-%m-%d')}...")

        stats = {
            "comentarios_agregados": 0, 
            "ya_existian": 0,
            "tareas_con_comentarios_procesadas": 0, 
            "tareas_sin_comentarios": 0, 
            "errores": 0
        }

        for i, tarea in enumerate(tareas, 1):
            if i % 50 == 0:
                self.stdout.write(f"  Progreso: {i}/{total_tareas} tareas escaneadas...")
                
            try:
                # Tasa de Peticiones: Dormimos un poco para no explotar la API de Bitrix (evitar Code 429 Too Many Requests)
                time.sleep(0.5) 
                
                resp = _call("task.commentitem.getlist", {"taskId": tarea.bitrix_task_id})
                comments_data = resp.get("result", [])
                
                if not comments_data:
                    stats["tareas_sin_comentarios"] += 1
                    continue
                    
                stats["tareas_con_comentarios_procesadas"] += 1
                
                import re
                
                for c in comments_data:
                    post_message = str(c.get("POST_MESSAGE") or "").strip()
                    if not post_message:
                        continue
                        
                    # Ignorar mensajes automáticos del sistema de Bitrix
                    system_prefixes = [
                        "Observadores agregados:",
                        "Participantes agregados:",
                        "El proyecto de la tarea cambió",
                        "La fecha límite cambió",
                        "Tarea cerrada.",
                        "La tarea de ",
                        "Lista de control "
                    ]
                    if any(post_message.startswith(prefix) for prefix in system_prefixes):
                        continue
                        
                    author_id = str(c.get("AUTHOR_ID") or "")
                    autor = user_map.get(author_id, default_user)
                    
                    # Convertir [USER=X]Nombre[/USER] a @username local
                    def replace_mention(match):
                        user_id = match.group(1)
                        fallback_name = match.group(2)
                        usr = user_map.get(str(user_id))
                        return f"@{usr.username}" if usr else f"@{fallback_name}"
                        
                    post_message = re.sub(r"\[USER=(\d+)\](.*?)\[/USER\]", replace_mention, post_message)
                    
                    # Convertir etiquetas de archivos
                    post_message = re.sub(r"\[DISK FILE ID=[^\]]+\]", "[Archivo Adjunto en Bitrix]", post_message)
                    autor = user_map.get(author_id, default_user)
                    
                    post_date = parse_datetime(c.get("POST_DATE")) if c.get("POST_DATE") else timezone.now()
                    
                    # Evitar duplicados revisando si ya existe un comentario idéntico en esa tarea
                    if TareaComentario.objects.filter(tarea=tarea, contenido=post_message, usuario=autor).exists():
                        stats["ya_existian"] += 1
                        continue
                        
                    if not dry_run:
                        comentario = TareaComentario.objects.create(
                            tarea=tarea,
                            usuario=autor,
                            contenido=post_message
                        )
                        # Forzamos la fecha de creación original desde Bitrix
                        if post_date:
                            TareaComentario.objects.filter(pk=comentario.pk).update(fecha_creacion=post_date)
                            
                    stats["comentarios_agregados"] += 1
                    if dry_run:
                        self.stdout.write(f"    [DRY] Se agregaría comentario en Tarea '{tarea.titulo[:20]}...': '{post_message[:30]}...' (Autor: {autor.username})")

            except Exception as e:
                self.stderr.write(self.style.ERROR(f"Error al descargar comentarios de tarea {tarea.bitrix_task_id}: {e}"))
                stats["errores"] += 1

        self.stdout.write(self.style.SUCCESS("\n=== Sincronización de Comentarios Terminada ==="))
        for k, v in stats.items():
            self.stdout.write(f"  {k}: {v}")

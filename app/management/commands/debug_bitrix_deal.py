"""
Diagnóstico: muestra exactamente qué devuelve la API de Bitrix para un deal.

Uso:
    python manage.py debug_bitrix_deal --deal-id 3674
"""

import json
import os

import requests
from django.core.management.base import BaseCommand

from app.bitrix_integration import BITRIX_WEBHOOK_URL

BITRIX_PROJECTS_WEBHOOK_URL = os.getenv(
    "BITRIX_PROJECTS_WEBHOOK_URL",
    "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json"
)


def _crm_url(method):
    return BITRIX_WEBHOOK_URL.replace("crm.deal.add.json", f"{method}.json")


def _proj_url(method):
    base = BITRIX_PROJECTS_WEBHOOK_URL.rsplit("/", 1)[0] + "/"
    return base + f"{method}.json"


def _post(url, payload):
    try:
        resp = requests.post(url, json=payload, timeout=30)
        return resp.status_code, resp.json()
    except Exception as e:
        return None, {"error": str(e)}


class Command(BaseCommand):
    help = 'Diagnóstico: muestra respuesta cruda de APIs de Bitrix para un deal'

    def add_arguments(self, parser):
        parser.add_argument('--deal-id', type=int, required=True)

    def handle(self, *args, **options):
        deal_id = options['deal_id']
        self.stdout.write(f"\n=== DIAGNÓSTICO Deal #{deal_id} ===\n")

        # 1. crm.activity.list
        self.stdout.write("── 1. crm.activity.list ──────────────────────")
        status, data = _post(_crm_url("crm.activity.list"), {
            'filter': {'OWNER_TYPE_ID': 2, 'OWNER_ID': deal_id},
            'select': ['ID', 'SUBJECT', 'TYPE_ID', 'COMPLETED', 'CREATED',
                       'DESCRIPTION', 'DEADLINE'],
        })
        self.stdout.write(f"HTTP: {status}")
        results = data.get('result', [])
        self.stdout.write(f"Total: {data.get('total', '?')}  |  En esta página: {len(results)}")
        for r in results:
            self.stdout.write(f"  ID={r.get('ID')} TYPE_ID={r.get('TYPE_ID')} "
                              f"COMPLETED={r.get('COMPLETED')} "
                              f"SUBJECT={str(r.get('SUBJECT',''))[:60]}")
        if 'error' in data:
            self.stdout.write(f"  ERROR: {data}")

        # 2. tasks.task.list con UF_CRM_TASK (webhook proyectos)
        self.stdout.write("\n── 2. tasks.task.list (UF_CRM_TASK, webhook proyectos) ───")
        crm_ref = f"D_{deal_id}"
        status, data = _post(_proj_url("tasks.task.list"), {
            'filter': {'UF_CRM_TASK': crm_ref},
            'select': ['ID', 'TITLE', 'STATUS', 'CREATED_DATE', 'DESCRIPTION'],
        })
        self.stdout.write(f"HTTP: {status}")
        result = data.get('result', {})
        tasks = result.get('tasks', result) if isinstance(result, dict) else result
        if isinstance(tasks, list):
            self.stdout.write(f"Tareas encontradas: {len(tasks)}")
            for t in tasks:
                self.stdout.write(f"  id={t.get('id')} status={t.get('status')} "
                                  f"title={str(t.get('title',''))[:60]}")
        else:
            self.stdout.write(f"Respuesta inesperada: {json.dumps(data)[:300]}")

        # 3. tasks.task.list con UF_CRM_TASK (webhook CRM — para comparar)
        self.stdout.write("\n── 3. tasks.task.list (UF_CRM_TASK, webhook CRM) ────────")
        status, data = _post(_crm_url("tasks.task.list"), {
            'filter': {'UF_CRM_TASK': crm_ref},
            'select': ['ID', 'TITLE', 'STATUS', 'CREATED_DATE'],
        })
        self.stdout.write(f"HTTP: {status}  |  Respuesta: {json.dumps(data)[:200]}")

        # 4. crm.timeline.comment.list (filtro string)
        self.stdout.write("\n── 4. crm.timeline.comment.list (ENTITY_TYPE='deal') ────")
        status, data = _post(_crm_url("crm.timeline.comment.list"), {
            'filter': {'ENTITY_TYPE': 'deal', 'ENTITY_ID': deal_id},
        })
        self.stdout.write(f"HTTP: {status}")
        results = data.get('result', [])
        if isinstance(results, dict):
            results = list(results.values())
        self.stdout.write(f"Comentarios: {len(results)}")
        for r in results[:5]:
            self.stdout.write(f"  {json.dumps(r)[:120]}")
        if 'error' in data:
            self.stdout.write(f"  ERROR: {data}")

        # 5. Buscar grupos (proyectos) vinculados al deal via UF_CRM
        self.stdout.write("\n── 5. sonet_group.get (grupos con UF_CRM=D_<deal>) ──────")
        status, data = _post(_proj_url("sonet_group.get"), {
            'filter': {'UF_CRM': crm_ref},
            'select': ['ID', 'NAME', 'UF_CRM'],
        })
        self.stdout.write(f"HTTP: {status}")
        groups = data.get('result', [])
        self.stdout.write(f"Grupos encontrados: {len(groups)}")
        for g in groups:
            self.stdout.write(f"  GROUP_ID={g.get('ID')} NAME={str(g.get('NAME',''))[:60]}")
            # Si hay grupo, buscar sus tareas
            if g.get('ID'):
                s2, d2 = _post(_proj_url("tasks.task.list"), {
                    'filter': {'GROUP_ID': g['ID']},
                    'select': ['ID', 'TITLE', 'STATUS'],
                })
                t2 = d2.get('result', {})
                tlist = t2.get('tasks', t2) if isinstance(t2, dict) else t2
                self.stdout.write(f"    → Tareas en grupo: {len(tlist) if isinstance(tlist, list) else '?'}")
                if isinstance(tlist, list):
                    for t in tlist:
                        self.stdout.write(f"      id={t.get('id')} status={t.get('status')} "
                                          f"title={str(t.get('title',''))[:50]}")

        self.stdout.write("\n=== FIN DIAGNÓSTICO ===")

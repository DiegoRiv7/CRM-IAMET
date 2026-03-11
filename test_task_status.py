import requests
import os

WEBHOOK = os.getenv("BITRIX_PROJECTS_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json")
base_url = WEBHOOK.rsplit("/", 1)[0] + "/tasks.task.get.json"

res = requests.post(base_url, json={"taskId": 11784}).json()
if "result" in res and "task" in res["result"]:
    task = res["result"]["task"]
    print(f"Status from Bitrix: {task.get('status')}, Title: {task.get('title')}")
else:
    print(res)

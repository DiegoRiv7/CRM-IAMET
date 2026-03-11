import requests
import os
import json

WEBHOOK = os.getenv("BITRIX_PROJECTS_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json")
base_url = WEBHOOK.rsplit("/", 1)[0] + "/task.commentitem.getlist.json"

res = requests.post(base_url, json={"taskId": 11784}).json()
print("Success:", "error" not in res)
print(json.dumps(res, indent=2))

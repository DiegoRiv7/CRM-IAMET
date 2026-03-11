import requests
import os
import json

WEBHOOK = os.getenv("BITRIX_PROJECTS_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json")
base_url = WEBHOOK.rsplit("/", 1)[0] + "/user.get.json"

res = requests.post(base_url, json={}).json()
if "result" in res:
    print(f"Total Users: {len(res['result'])}")
    for u in res["result"]:
        print(f"ID: {u.get('ID')}, Name: {u.get('NAME')} {u.get('LAST_NAME')}")

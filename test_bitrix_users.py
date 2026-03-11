import requests
import os
import json

WEBHOOK = os.getenv("BITRIX_PROJECTS_WEBHOOK_URL", "https://bajanet.bitrix24.mx/rest/86/hwpxu5dr31b6wve3/sonet_group.create.json")
base_url = WEBHOOK.rsplit("/", 1)[0] + "/user.get.json"

res = requests.post(base_url, json={"ACTIVE": True}).json()
print("Success:", "error" not in res)
if "result" in res:
    print("Found users:", len(res["result"]))
    if len(res["result"]) > 0:
        print("Example user:", {k: res["result"][0].get(k) for k in ["ID", "EMAIL", "NAME", "LAST_NAME"]})

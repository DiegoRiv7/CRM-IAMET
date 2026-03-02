import subprocess
import re

path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm/_scripts_mail.html'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

match = re.search(r'<script>(.*?)</script>', text, re.DOTALL)
if match:
    script_content = match.group(1)
    
    script_content = re.sub(r'\{\{.+?\}\}', '1', script_content)
    script_content = re.sub(r'\{% if es_supervisor %\}true\{% else %\} false\{% endif %\}', 'true', script_content)
    
    with open('/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/tmp_check_js.js', 'w', encoding='utf-8') as f:
        f.write(script_content)
    
    print("Running node -c tmp_check_js.js")
else:
    print("Could not find <script> tags")


import re
import os

filepath = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

if not os.path.exists(filepath):
    print(f"File not found: {filepath}")
    exit(1)

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern for the specific multiline if block
# We use re.DOTALL to match across newlines and handle whitespace flexibly
pattern = r'\{\%\s*if item\.producto != \'ZEBRA\' and item\.producto != \'PANDUIT\' and item\.producto != \'APC\'\s+and item\.producto != \'AVIGILON\' and item\.producto != \'AVIGILION\' and item\.producto !=\s+\'GENETEC\' and item\.producto != \'AXIS\' and item\.producto != \'SOFTWARE\' and item\.producto\s+!= \'Desarrollo\' and item\.producto != \'RUNRATE\' and item\.producto != \'PÓLIZA\' and\s+item\.producto != \'POLIZA\'\s*\%\}'

replacement = "{% if item.producto != 'ZEBRA' and item.producto != 'PANDUIT' and item.producto != 'APC' and item.producto != 'AVIGILON' and item.producto != 'AVIGILION' and item.producto != 'GENETEC' and item.producto != 'AXIS' and item.producto != 'SOFTWARE' and item.producto != 'Desarrollo' and item.producto != 'RUNRATE' and item.producto != 'PÓLIZA' and item.producto != 'POLIZA' %}"

# Try to find and replace
new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

if content != new_content:
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Fixed multiline if tag.")
else:
    print("Pattern not found. Dumping a snippet around line 3733 for debug:")
    lines = content.split('\n')
    if len(lines) > 3733:
        for i in range(3730, 3745):
            print(f"{i}: {lines[i]}")


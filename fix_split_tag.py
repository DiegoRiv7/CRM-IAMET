import re

file_path = 'app/templates/crm_home.html'

with open(file_path, 'r') as f:
    content = f.read()

# Pattern to find: {% if followed by newline and spaces and es_supervisor
# We want to join them.
pattern = r'\{\% if\s*\n\s*es_supervisor'
replacement = '{% if es_supervisor'

new_content = re.sub(pattern, replacement, content)

if new_content != content:
    with open(file_path, 'w') as f:
        f.write(new_content)
    print("Fixed split {% if tag")
else:
    print("Pattern not found")

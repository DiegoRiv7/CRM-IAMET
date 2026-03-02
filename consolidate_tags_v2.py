
import os
import re

file_path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

def consolidate_tag(match):
    # m.group(1) is the inner content
    inner = match.group(1)
    # Replace newlines with spaces
    inner = inner.replace('\n', ' ')
    # Collapse multiple spaces
    inner = ' '.join(inner.split())
    
    # Also fix spacing around == while we're here
    inner = inner.replace('==', ' == ')
    inner = ' '.join(inner.split())
    inner = inner.replace('! =', '!=')
    inner = inner.replace('> =', '>=')
    inner = inner.replace('< =', '<=')
    inner = inner.replace('= =', '==')

    return f'{{% {inner} %}}'

def consolidate_var(match):
    inner = match.group(1)
    inner = inner.replace('\n', ' ')
    inner = ' '.join(inner.split())
    return f'{{{{ {inner} }}}}'

# Consolidate multiline {% ... %}
content = re.sub(r'\{%\s*(.*?)\s*%\}', consolidate_tag, content, flags=re.DOTALL)

# Consolidate multiline {{ ... }}
content = re.sub(r'\{\{\s*(.*?)\s*\}\}', consolidate_var, content, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Successfully consolidated all multiline tags and variables using DOTALL regex.")

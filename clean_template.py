import os

file_path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    # Fix split tags that are causing rendering issues
    if "{% else" in line and "%}$0{% endif %}" in line:
        line = line.replace("{% else", "{% else %}$0{% endif %}").split('{% else %}')[0] + "{% else %}$0{% endif %}\n"
    
    # Generic cleanup for the specific broken columns seen in screenshot
    line = line.replace("${{\n                                    item.monto|format_currency_es }}</span>{% else\n                                %}$0{% endif %}", "${{ item.monto|format_currency_es }}</span>{% else %}$0{% endif %}")
    line = line.replace("${{\n                                    item.monto|format_currency_es }}</span>{% else %}$0{% endif %}", "${{ item.monto|format_currency_es }}</span>{% else %}$0{% endif %}")

    new_lines.append(line)

# Join and do a more global multi-line fix if needed
content = "".join(new_lines)

# Fix the specific pattern that was definitely broken in the view_file output
import re
# Match the pattern of split monta|format_currency_es and else %}$0
content = re.sub(r'(\$\{\{\s+)item\.monto\|format_currency_es(\s+\}\}<\/span>\{%\s+else\s+%\}\$0\{%\s+endif\s+%\})', r'${{ item.monto|format_currency_es }}</span>{% else %}$0{% endif %}', content)

# Fix the most problematic one seen in the view_file (lines 1483-1484 etc)
content = content.replace("</span>{% else\n                                %}$0{% endif %}", "</span>{% else %}$0{% endif %}")
content = content.replace("${{\n                                    item.monto|format_currency_es }}", "${{ item.monto|format_currency_es }}")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Template logic cleaned up.")

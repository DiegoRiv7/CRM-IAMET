import re

file_path = 'app/templates/crm_home.html'

with open(file_path, 'r') as f:
    content = f.read()

# Fix split {% else %}
# Look for {% else followed by optional whitespace/newlines and then %}
content = re.sub(r'\{\%\s*else\s*[\n\r]+\s*\%\}', '{% else %}', content)

# Fix split {% endif %}
content = re.sub(r'\{\%\s*endif\s*[\n\r]+\s*\%\}', '{% endif %}', content)

# Also fix occurances where spaces might be the only separator
content = re.sub(r'\{\%\s*else\s*\%\}', '{% else %}', content)
content = re.sub(r'\{\%\s*endif\s*\%\}', '{% endif %}', content)

with open(file_path, 'w') as f:
    f.write(content)

print(f"Fixed split tags in {file_path}")

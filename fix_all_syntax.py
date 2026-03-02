import re
import os

file_path = 'app/templates/crm_home.html'

if not os.path.exists(file_path):
    print(f"Error: {file_path} not found")
    exit(1)

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

original_content = content

# 1. Fix spacing around ==
# Specific known issues
content = content.replace('{% if code==mes_filter %}', '{% if code == mes_filter %}')
content = content.replace('{% if y==anio_int %}', '{% if y == anio_int %}')

# 2. Fix multiline tags
# Function to collapse whitespace within a tag match
def collapse_tag(match):
    tag_text = match.group(0)
    # Replace any sequence of whitespace chars (including newlines) with a single space
    # but keep the structure intact.
    # We want to turn "{% if \n condition %}" into "{% if condition %}"
    return re.sub(r'\s+', ' ', tag_text)

# Regex to find tags that span multiple lines or have extra whitespace
# We target {% ... %} and {{ ... }}
# Using non-greedy match .*? with DOTALL flag to capture newlines
content = re.sub(r'\{%.*?%\}', collapse_tag, content, flags=re.DOTALL)
content = re.sub(r'\{\{.*?\}\}', collapse_tag, content, flags=re.DOTALL)

if content != original_content:
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Successfully fixed template syntax in {file_path}")
else:
    print("No changes needed (file might be already fixed)")

import os
import glob

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    original_content = content

    import re
    def collapse_tag(match):
        tag_text = match.group(0)
        return re.sub(r'\s+', ' ', tag_text)

    # Collapse all multiline tags
    content = re.sub(r'\{%.*?%\}', collapse_tag, content, flags=re.DOTALL)
    content = re.sub(r'\{\{.*?\}\}', collapse_tag, content, flags=re.DOTALL)

    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"Fixed {filepath}")
        return True
    return False

templates_dir = 'app/templates'
changed = 0

for root, _, files in os.walk(templates_dir):
    for fn in files:
        if fn.endswith('.html'):
            if fix_file(os.path.join(root, fn)):
                changed += 1

print(f"Fixed {changed} files.")

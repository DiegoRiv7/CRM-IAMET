
import re

file_path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

in_style = False
current_block = []
blocks = []

for i, line in enumerate(lines):
    if '<style>' in line:
        in_style = True
        current_block = []
        continue
    if '</style>' in line:
        in_style = False
        blocks.append((i, "".join(current_block)))
        continue
    if in_style:
        current_block.append(line)

for end_line, content in blocks:
    open_braces = content.count('{')
    close_braces = content.count('}')
    print(f"Style block ending at line {end_line+1}: Open={open_braces}, Close={close_braces}")
    if open_braces != close_braces:
        print("!!! BRACE MISMATCH FOUND")

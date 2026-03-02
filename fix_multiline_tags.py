#!/usr/bin/env python3
"""
Robust fix for ALL multiline Django template tags in crm_home.html.
Joins ALL lines where {% %} or {{ }} tags are split across multiple lines.
"""

filepath = 'app/templates/crm_home.html'

with open(filepath, 'r') as f:
    lines = f.readlines()

result = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Count open/close tags
    open_blocks = line.count('{%') - line.count('%}')
    open_vars = line.count('{{') - line.count('}}')
    
    if open_blocks > 0 or open_vars > 0:
        # Need to join with following lines until balanced
        combined = line.rstrip('\n')
        j = i + 1
        while j < len(lines) and (open_blocks > 0 or open_vars > 0):
            next_part = lines[j].strip()
            combined = combined.rstrip() + ' ' + next_part
            open_blocks = combined.count('{%') - combined.count('%}')
            open_vars = combined.count('{{') - combined.count('}}')
            j += 1
        result.append(combined + '\n')
        i = j
    else:
        result.append(line)
        i += 1

content = ''.join(result)

# Also fix == spacing
content = content.replace('code==mes_filter', 'code == mes_filter')
content = content.replace('y==anio_int', 'y == anio_int')
content = content.replace("mes_filter=='todos'", "mes_filter == 'todos'")

with open(filepath, 'w') as f:
    f.write(content)

# Verify
with open(filepath, 'r') as f:
    lines = f.readlines()
    errors = []
    for idx, line in enumerate(lines, 1):
        ob = line.count('{%') - line.count('%}')
        ov = line.count('{{') - line.count('}}')
        if ob != 0 or ov != 0:
            errors.append(f"  Line {idx}: blocks={ob} vars={ov}")
    
    if errors:
        print(f"WARNING: {len(errors)} unbalanced lines remain:")
        for e in errors:
            print(e)
    else:
        print("SUCCESS: All Django template tags are balanced on single lines!")

if 'code==mes_filter' in content or 'y==anio_int' in content:
    print("WARNING: == without spaces still exists!")
else:
    print("All == operators have proper spacing!")

print(f"Total lines: {len(lines)}")


import os
import re

file_path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip_until = -1

for i in range(len(lines)):
    if i < skip_until:
        continue
    
    line = lines[i]
    
    # Check for multiline {% ... %}
    if '{%' in line and '%}' not in line:
        # Start of a multiline tag
        full_tag = line.strip()
        for j in range(i + 1, len(lines)):
            full_tag += " " + lines[j].strip()
            if '%}' in lines[j]:
                skip_until = j + 1
                # Replace the original starting line with the consolidated tag
                # We need to keep the original indentation of the first line
                indent = len(line) - len(line.lstrip())
                new_lines.append(' ' * indent + full_tag + '\n')
                break
        else:
            # Reached end of file without finding closure
            new_lines.append(line)
            
    # Check for multiline {{ ... }}
    elif '{{' in line and '}}' not in line:
        # Start of a multiline variable
        full_var = line.strip()
        for j in range(i + 1, len(lines)):
            full_var += " " + lines[j].strip()
            if '}}' in lines[j]:
                skip_until = j + 1
                indent = len(line) - len(line.lstrip())
                new_lines.append(' ' * indent + full_var + '\n')
                break
        else:
            new_lines.append(line)
    
    else:
        new_lines.append(line)

# Handle spacing again just in case consolidated tags need it
final_lines = []
for line in new_lines:
    # Ensure spaces after {% and before %}
    if '{%' in line and '%}' in line:
        # Simple fix: find content between {% and %}, check spacing
        parts = line.split('{%')
        processed_line = [parts[0]]
        for part in parts[1:]:
            subparts = part.split('%}')
            if len(subparts) > 1:
                inner = subparts[0].strip()
                # Ensure spacing around == while we are at it
                inner = inner.replace('==', ' == ')
                inner = ' '.join(inner.split())
                processed_line.append(f'{{% {inner} %}}' + subparts[1])
            else:
                processed_line.append(f'{{%{part}')
        line = ''.join(processed_line)
        
    # Ensure spaces after {{ and before }}
    if '{{' in line and '}}' in line:
        parts = line.split('{{')
        processed_line = [parts[0]]
        for part in parts[1:]:
            subparts = part.split('}}')
            if len(subparts) > 1:
                inner = subparts[0].strip()
                processed_line.append(f'{{{{ {inner} }}}}' + subparts[1])
            else:
                processed_line.append(f'{{{{{part}')
        line = ''.join(processed_line)
    
    final_lines.append(line)

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(final_lines)

print("Successfully consolidated multiline tags and fixed spacing.")

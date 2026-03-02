import os

file_path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Truncate some header names to save space
# Zebra, Panduit, APC (short), Avigilon -> Avig., Genetec -> Gen., Software -> Soft., Runrate -> RR.
replacements = {
    'Avigilon': 'Avig.',
    'Genetec': 'Genet.',
    'Software': 'Soft.',
    'Runrate': 'RR',
    'Póliza': 'Pol.',
}

for old, new in replacements.items():
    content = content.replace(f'>{old}</th>', f'>{new}</th>')

# Make the currency font even smaller
content = content.replace('text-sm', 'text-[11px]')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Header labels abbreviated and font size reduced to save space.")

import re

path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm/_scripts_mail.html'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# Revert formatting changes
text = text.replace('{\n', '{ ')
text = text.replace('}\n', '} ')
text = text.replace(';\n', '; ')
text = text.replace('\n/* ', ' /* ')
text = text.replace(' */\n', ' */ ')

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)
print('Reversed formatting')

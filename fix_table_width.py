import os
import re

file_path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove horizontal scroll wrappers and limit width
# Replace 'overflow-x-auto' with 'overflow-hidden' or remove it
content = content.replace('overflow-x-auto', 'overflow-hidden')

# 2. Remove 'min-w-max' from tables to prevent forcing extra width
content = content.replace('min-w-max', '')

# 3. Reduce horizontal padding across the entire table system
# TH padding: px-4 -> px-2
content = content.replace('px-4 py-4', 'px-2 py-4')
# TD padding: px-4 -> px-2
content = content.replace('px-4 py-4', 'px-2 py-4') # Already covered by line above for many cases
content = content.replace('px-4 py-3', 'px-2 py-3')

# 4. Specifically target cells that might still have px-4
content = re.sub(r'class="([^"]*)px-4([^"]*)"', r'class="\1px-2\2"', content)

# 5. Adjust the Oportunidad Column width
content = content.replace('min-width: 180px;', 'min-width: 140px;')

# 6. Reduce text size for headers if still tight
content = content.replace('text-[10px]', 'text-[9px]')

# 7. Make the main layout container wider if possible to accommodate the table
# Looking for typical container classes like 'max-w-7xl' or similar
content = content.replace('max-w-7xl', 'max-w-[98%]')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Table width adjusted to fit screen without scrolling.")


import os

filepath = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'
with open(filepath, 'r') as f:
    lines = f.readlines()

stack = []
for i, line in enumerate(lines, 1):
    # Only check script sections
    # Very basic check
    pass

# I'll just look for 'try {' without 'catch' in the same logical block
content = "".join(lines)

# Fix common issues I might have introduced
# 1. Missing catch for a try
# 2. Extra closing brace

# Let's check for "try {" and count "catch"
tries = content.count('try {')
catches = content.count('catch (e)') + content.count('catch(e)')

print(f"Tries: {tries}, Catches: {catches}")

# If tries > catches, we have an issue.

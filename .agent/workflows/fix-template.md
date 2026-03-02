---
description: Fix Django template syntax errors in crm_home.html (multiline tags and == spacing)
---
// turbo-all

1. Run the fix script:
```bash
cd /Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas && python3 fix_multiline_tags.py
```

2. Verify no unbalanced tags remain:
```bash
python3 -c "
with open('app/templates/crm_home.html') as f:
    lines = f.readlines()
errs = 0
for i, l in enumerate(lines, 1):
    if l.count('{%') != l.count('%}') or l.count('{{') != l.count('}}'):
        errs += 1; print(f'Line {i}')
print(f'Errors: {errs}')
"
```


filepath = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'
with open(filepath, 'r') as f:
    lines = f.readlines()

in_script = False
balance = 0
for i, line in enumerate(lines, 1):
    if '<script>' in line:
        if i >= 4000: # We focus on the big one
            in_script = True
            balance = 0
            print(f"Started at {i}")
        continue
    if '</script>' in line:
        in_script = False
        print(f"Ended at {i} with balance {balance}")
        continue
    
    if in_script:
        # Ignore braces in strings/regex (rough)
        clean_line = line.split('//')[0]
        # This is very rough but might find the big error
        balance += clean_line.count('{')
        balance -= clean_line.count('}')
        if balance < 0:
            print(f"Balance went negative at line {i}: {line.strip()}")
            # Reset balance to continue? No, usually it means a bug.
            # balance = 0 

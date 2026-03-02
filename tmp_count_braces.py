import re

with open('/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/tmp_check_js.js', 'r', encoding='utf-8') as f:
    text = f.read()

# remove comments and strings to count braces
def remove_comments_and_strings(code):
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
    code = re.sub(r"'(?:\\'|[^'])*'", "''", code)
    code = re.sub(r'"(?:\\"|[^"])*"', '""', code)
    # also regex literals, roughly
    code = re.sub(r'/(?:\\/|[^/\n])*/[gimuy]*', '""', code)
    return code

clean = remove_comments_and_strings(text)
print("Braces: {", clean.count('{'), "} :", clean.count('}'))
print("Parens: (", clean.count('('), ") :", clean.count(')'))
print("Brackets: [", clean.count('['), "] :", clean.count(']'))

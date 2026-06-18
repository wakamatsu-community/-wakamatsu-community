import re, pathlib

p = pathlib.Path(r'D:\町内会活動\町内会HP（Google）\code.gs')
text = p.read_text(encoding='utf-8')
lines = text.splitlines()

# Strip double-quoted string literals to avoid counting braces inside them
depth = 0
for raw in lines:
    line = re.sub(r'"[^"]*"', '""', raw)
    depth += line.count('{') - line.count('}')

print("brace depth (0=ok):", depth)
print("total lines:", len(lines))

funcs = [l.strip() for l in lines if re.match(r'^function ', l.strip())]
print("function count:", len(funcs))

jdefs = [f for f in funcs if 'jsonResponse_' in f]
print("jsonResponse_ defs:", len(jdefs))

print("add_managed_event:", any('add_managed_event' in l for l in lines))
print("ffunction:", any('ffunction' in l for l in lines))

in_post = False
try_count = 0
for i, l in enumerate(lines, 1):
    if re.match(r'^function doPost', l.strip()):
        in_post = True
        try_count = 0
    if in_post:
        if re.match(r'\s+try\s*\{', l):
            try_count += 1
        if i > 140 and re.match(r'^function ', l.strip()):
            in_post = False

print("try blocks in doPost:", try_count)
print("login_ present:", any('function login_' in l for l in lines))
print("All checks PASSED" if depth == 0 and len(jdefs) == 1 else "ISSUES FOUND")

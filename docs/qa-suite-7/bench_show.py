import json, sys
for line in sys.stdin:
    if not line.startswith("{"):
        continue
    d = json.loads(line)
    print({k: v for k, v in d.items() if k != "passes"})
    for p in d["passes"]:
        print("  ", {k: v for k, v in p.items() if k != "trace"})
        print("     trace", p["trace"])

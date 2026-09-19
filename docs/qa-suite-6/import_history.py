import csv, json, sys
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

path = "docs/qa-suite-6/history-qa6.csv"
api = Api("adam.nowicki")
print("zalogowany:", api.me["display_name"], api.me["role"])

with open(path, "rb") as fh:
    r = api.post("/api/v1/history/preview", files={"file": ("history-qa6.csv", fh, "text/csv")})
print("preview:", r.status_code)
prev = r.json()
print("valid:", prev["valid"], "rows:", len(prev["rows"]), "errors:", len(prev["errors"]))
for e in prev["errors"][:10]:
    print("  ", e)
if not prev["valid"]:
    sys.exit(1)

r = api.post("/api/v1/history/commit", json={"filename": "history-qa6.csv", "rows": prev["rows"]})
print("commit:", r.status_code, r.text[:400])

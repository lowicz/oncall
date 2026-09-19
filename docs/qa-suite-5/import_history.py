import json
import sys
import time

from qa import Client

client = Client("ola.zielinska")
started = time.perf_counter()
with open(sys.argv[1], "rb") as handle:
    preview = client.post(
        "/api/v1/history/preview", files={"file": ("history.csv", handle, "text/csv")}
    )
print("preview", preview.status_code, f"{time.perf_counter() - started:.2f}s")
body = preview.json()
print("valid:", body["valid"], "rows:", len(body["rows"]), "errors:", body["errors"][:5])
if not body["valid"]:
    sys.exit(1)
started = time.perf_counter()
commit = client.post(
    "/api/v1/history/commit",
    json={"filename": "history-qa4.csv", "rows": body["rows"]},
)
print("commit", commit.status_code, f"{time.perf_counter() - started:.2f}s", commit.text[:300])

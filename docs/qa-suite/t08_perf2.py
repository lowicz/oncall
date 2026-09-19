"""TC-P5 follow-up: what a 504 during generation leaves behind."""
import threading, time
from datetime import date, timedelta
from client import Api, check, FINDINGS

TODAY = date.today()
koord = Api("koord")
before = {d["id"] for d in koord.get("/api/v1/scheduling/drafts").json()}
print("drafts before:", len(before))
for d in koord.get("/api/v1/scheduling/drafts").json():
    print("  ", d["name"], d["status"], d["assignment_count"], d["created_at"])

out = []
def gen(off, api):
    s = TODAY + timedelta(days=off)
    t0 = time.monotonic()
    try:
        r = api.post("/api/v1/scheduling/generate",
                     json={"starts_on": str(s), "ends_on": str(s + timedelta(days=60))})
        out.append((off, round(time.monotonic() - t0, 1), r.status_code, r.text[:80]))
    except Exception as e:
        out.append((off, round(time.monotonic() - t0, 1), "EXC", str(e)[:80]))

apis = [Api("koord"), Api("anna")]
th = [threading.Thread(target=gen, args=(o, a)) for o, a in zip((600, 700), apis)]
t0 = time.monotonic()
for t in th: t.start()
for t in th: t.join()
print(f"wall={time.monotonic()-t0:.1f}s")
for o in out: print("  ", o)

time.sleep(2)
after = koord.get("/api/v1/scheduling/drafts").json()
new = [d for d in after if d["id"] not in before]
print("new drafts created:", len(new))
for d in new: print("  ", d["name"], d["status"], d["assignment_count"])
ok_codes = [c for _, _, c, _ in out]
check("P5.2", all(c == 201 for c in ok_codes),
      f"both generations return 201 rather than a gateway timeout (got {ok_codes})")
check("P5.3", len(new) == len([c for c in ok_codes if c == 201]),
      f"no draft is left behind by a failed request ({len(new)} drafts for "
      f"{len([c for c in ok_codes if c == 201])} successful responses)")
for d in new:
    koord.delete(f"/api/v1/scheduling/{d['id']}")
print()
for f in FINDINGS: print("  ", f)

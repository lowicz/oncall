import sys
from collections import defaultdict
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api
import holidays as hl

api = Api("adam.nowicki")
r = api.get("/api/v1/schedules/published", params={"starts_on": "2026-09-07", "ends_on": "2026-10-04"})
d = r.json()
by_day = defaultdict(dict)
for a in d["assignments"]:
    by_day[a["service_date"]][a["role"]] = a["assignee_name"]

pl = {x for x in hl.country_holidays("PL", years=[2026])}
start, end = date(2026, 9, 7), date(2026, 10, 4)
gaps = []
for i in range((end - start).days + 1):
    day = start + timedelta(days=i)
    k = day.isoformat()
    slots = by_day.get(k, {})
    off = day.weekday() >= 5 or day in pl
    need = {"primary", "secondary"} | (set() if off else {"late_shift"})
    missing = need - set(slots)
    extra = set(slots) - need
    flag = ""
    if missing:
        flag += f"  BRAK: {sorted(missing)}"
        gaps.append((k, sorted(missing)))
    if extra:
        flag += f"  NADMIAR: {sorted(extra)}"
    print(f"{k} {day.strftime('%a')}{' 2X' if off else '   '} "
          f"P={slots.get('primary','-'):16} S={slots.get('secondary','-'):16} "
          f"L={slots.get('late_shift','-'):16}{flag}")
print()
print("LUKI POKRYCIA:", gaps if gaps else "brak")
print("wersja:", d.get("version"), "nazwa:", d.get("name"))

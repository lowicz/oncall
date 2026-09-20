"""TC-D: fairness report, monthly CSV, identity after rename, history import."""
import csv, io, time
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
koord = Api("koord"); admin = Api("admin", ADMIN_PASSWORD); marek = Api("marek")
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}

print("=== TC-D1 fairness report ===")
t0 = time.monotonic(); r = koord.get("/api/v1/fairness"); t_fair = time.monotonic() - t0
check("D1.1", r.status_code == 200, "fairness report", r.text[:200])
rep = r.json()
print(f"  latency {t_fair*1000:.0f} ms, members={len(rep['members'])}, totals={rep['totals']}")
check("D1.2", len(rep["members"]) == 10, f"all 10 rotation members present ({len(rep['members'])})")
check("D1.3", (date.fromisoformat(rep["window_end"]) - date.fromisoformat(rep["window_start"])).days == 365,
      "12-month rolling window")
for key in ("primary", "secondary", "late_shift", "weekends", "holidays"):
    tot_actual = round(sum(m[key]["actual"] for m in rep["members"]), 2)
    tot_expected = round(sum(m[key]["expected"] for m in rep["members"]), 2)
    ok = abs(tot_actual - tot_expected) < 0.5
    check("D1.4", ok, f"{key}: sum(actual)={tot_actual} == sum(expected)={tot_expected}")
# newcomer must not carry a debt for the time before joining
rafal = [m for m in rep["members"] if m["display_name"] == "Rafał Woźniak"][0]
print(f"  rafal: eligible_days={rafal['eligible_days']} primary={rafal['primary']}")
check("D1.5", rafal["primary"]["expected"] < [m for m in rep["members"]
      if m["display_name"] == "Marek Nowak"][0]["primary"]["expected"],
      "newcomer's expected share is smaller than a full-year member's")
# ewa has no primary eligibility -> expected primary share must be 0
ewa = [m for m in rep["members"] if m["display_name"] == "Ewa Kamińska"][0]
check("D1.6", ewa["primary"]["expected"] == 0 and ewa["primary"]["actual"] == 0,
      f"member without primary eligibility has no primary share ({ewa['primary']})")
jakub = [m for m in rep["members"] if m["display_name"] == "Jakub Szymański"][0]
check("D1.7", jakub["late_shift"]["expected"] == 0 and jakub["late_shift"]["actual"] == 0,
      f"member without late-shift eligibility has none ({jakub['late_shift']})")

print()
print("=== TC-D2 member sees only themselves ===")
r = marek.get("/api/v1/fairness")
check("D2.1", r.status_code == 200 and len(r.json()["members"]) == 1, "member sees one row",
      str(len(r.json().get("members", []))))
mm = team["Marek Nowak"]["id"]
r = marek.get(f"/api/v1/fairness/duties?member_id={team['Anna Kowalska']['id']}")
check("D2.2", r.status_code == 403, "member cannot drill into somebody else", str(r.status_code))
r = marek.get(f"/api/v1/fairness/duties?member_id={mm}")
check("D2.3", r.status_code == 200, "member drills into own duties", r.text[:150])
duties = r.json()
print(f"  marek duties in window: {len(duties)}")
summary = [m for m in koord.get("/api/v1/fairness").json()["members"]
           if m["display_name"] == "Marek Nowak"][0]
drill_points = sum(d["points"] for d in duties if d["role"] in ("primary", "secondary"))
summary_points = summary["primary"]["actual"] + summary["secondary"]["actual"]
check("D2.4", abs(drill_points - summary_points) < 0.01,
      f"drill-down total matches the summary ({drill_points} vs {summary_points})")

print()
print("=== TC-D3 identity survives a rename (docs claim) ===")
users = {u["username"]: u for u in admin.get("/api/v1/admin/users").json()}
uid = users["marek"]["id"]
before = [m for m in koord.get("/api/v1/fairness").json()["members"]
          if m["display_name"] == "Marek Nowak"][0]
before_duties = len(marek.get(f"/api/v1/fairness/duties?member_id={mm}").json())
r = admin.patch(f"/api/v1/admin/users/{uid}", json={"last_name": "Nowak-Testowy"})
check("D3.1", r.status_code == 200, "rename accepted", r.text[:200])
after_rep = koord.get("/api/v1/fairness").json()
after = [m for m in after_rep["members"] if m["display_name"] == "Marek Nowak-Testowy"]
check("D3.2", bool(after), "renamed member still in the report",
      str([m["display_name"] for m in after_rep["members"]]))
if after:
    check("D3.3", after[0]["primary"]["actual"] == before["primary"]["actual"],
          f"summary keeps the history ({before['primary']['actual']} -> {after[0]['primary']['actual']})")
after_duties = marek.get(f"/api/v1/fairness/duties?member_id={mm}").json()
check("D3.4", len(after_duties) == before_duties,
      f"DRILL-DOWN keeps the history ({before_duties} duties before, {len(after_duties)} after)")
# monthly report after rename
last_month = (TODAY.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
csv_before_rows = list(csv.DictReader(io.StringIO(
    koord.get(f"/api/v1/reports/monthly.csv?month={last_month}").text.lstrip("﻿"))))
mrow = [row for row in csv_before_rows if row["osoba"].startswith("Marek")]
print("  monthly row after rename:", mrow)
check("D3.5", bool(mrow) and any(int(mrow[0][k]) for k in mrow[0] if k not in ("miesiac", "osoba")),
      "monthly CSV still counts the renamed member's duties")
# swap options / impact after rename
future = [a for a in koord.get("/api/v1/schedules/published").json()["assignments"]
          if a["assignee_name"] == "Marek Nowak-Testowy" and
          date.fromisoformat(a["service_date"]) > TODAY + timedelta(days=30)]
if future:
    f0 = future[0]
    r = marek.get(f"/api/v1/swaps/options?service_date={f0['service_date']}&role={f0['role']}")
    check("D3.6", r.status_code == 200, "options after rename", r.text[:150])
    opts = r.json()
    if opts:
        r = marek.get(f"/api/v1/swaps/impact?service_date={f0['service_date']}"
                      f"&role={f0['role']}&replacement_member_id={opts[0]['member_id']}")
        check("D3.7", r.status_code == 200, "swap impact after rename", r.text[:250])
# restore
admin.patch(f"/api/v1/admin/users/{uid}", json={"last_name": "Nowak"})

print()
print("=== TC-D4 monthly CSV ===")
for month, expect in [("2026-13", 422), ("bad", 422), ("2026-08", 200)]:
    r = koord.get(f"/api/v1/reports/monthly.csv?month={month}")
    check("D4.1", r.status_code == expect, f"month={month} -> {r.status_code}", r.text[:150])
r = koord.get(f"/api/v1/reports/monthly.csv?month={last_month}")
text = r.text
check("D4.2", text.startswith("﻿"), "CSV starts with a UTF-8 BOM")
check("D4.3", "attachment" in r.headers.get("content-disposition", ""), "download header present")
rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
print(f"  {len(rows)} rows, headers={list(rows[0].keys())}")
check("D4.4", len(rows) == 10, f"one row per rotation member ({len(rows)})")
# cross-check the CSV against the calendar
start = date.fromisoformat(f"{last_month}-01")
end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
import holidays as ch
pl = set(ch.country_holidays("PL", years=[start.year]))
days = (end - start).days + 1
exp_primary = days
exp_late = sum(1 for i in range(days)
               if (start + timedelta(days=i)).weekday() < 5 and (start + timedelta(days=i)) not in pl)
got_primary = sum(int(r_[k]) for r_ in rows for k in
                  ("primary_dni_robocze", "primary_weekendy", "primary_swieta"))
got_late = sum(int(r_["zmiany_11_19"]) for r_ in rows)
check("D4.5", got_primary == exp_primary, f"primary days total {got_primary} == {exp_primary}")
check("D4.6", got_late == exp_late, f"11-19 shifts total {got_late} == {exp_late}")
# holiday in a weekend counted once, as a holiday
tot_we = sum(int(r_["oncall_weekendy_razem"]) for r_ in rows)
tot_hd = sum(int(r_["oncall_swieta_razem"]) for r_ in rows)
tot_wd = sum(int(r_["oncall_dni_robocze_razem"]) for r_ in rows)
check("D4.7", tot_we + tot_hd + tot_wd == days * 2,
      f"categories partition the month ({tot_wd}+{tot_we}+{tot_hd} vs {days*2})")

print()
print(f"--- {len(FINDINGS)} failures ---")
for f in FINDINGS: print("  ", f)

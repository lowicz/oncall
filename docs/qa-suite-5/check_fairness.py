import sys
from qa import Client

client = Client("ola.zielinska")
params = {"as_of": sys.argv[1]} if len(sys.argv) > 1 else {}
response = client.get("/api/v1/fairness", params=params)
print(response.status_code)
body = response.json()
print("window:", body.get("window_start"), "-", body.get("window_end"))
print("totals:", body.get("totals"))
header = f"{'osoba':22}" + "".join(f"{lens:>26}" for lens in ("primary", "secondary", "late_shift", "weekends", "holidays"))
print(header)
for member in body["members"]:
    cells = ""
    for lens in ("primary", "secondary", "late_shift", "weekends", "holidays"):
        item = member[lens]
        cells += f"{item['actual']:8.1f}/{item['expected']:7.1f}/{item['deviation']:+6.1f}"
    print(f"{member['display_name']:22}{cells}  dni={member['eligible_days']}")

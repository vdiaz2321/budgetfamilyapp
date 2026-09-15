import html
import json

plan = json.load(open("plan.json", encoding="utf-8"))
LABELS = {"restaurants": "Restaurants", "groceries": "Groceries", "entertainment": "Entertainment",
          "transport": "Public transport", "fuel_tolls": "Fuel & tolls", "parking": "Parking",
          "cash": "Cash / currency", "other": "Gifts & other"}
ORDER = list(LABELS)
esc = html.escape


def usd(c):
    return f"${(c or 0) / 100:,.2f}"


def eur(c):
    return f"€{(c or 0) / 100:,.2f}"


def fdate(iso):
    from datetime import date
    d = date.fromisoformat(iso)
    return d.strftime("%-d %b %Y") if hasattr(d, "strftime") and False else f"{d.day} {d.strftime('%b %Y')}"


totals = {
    "trips": len(plan),
    "linked": sum(len(t["linkedStays"]) for t in plan),
    "newStays": sum(len(t["newStays"]) for t in plan),
    "flights": sum(len(t["flights"]) for t in plan),
    "rentals": sum(len(t["rentals"]) for t in plan),
    "categories": sum(len(t["misc"]) for t in plan),
    "flags": sum(len(t["flags"]) for t in plan),
    "spent": sum(t["importTotal"] for t in plan),
}

cards = []
for t in plan:
    diff = t["importTotal"] - (t["sheetTotal"] or 0)
    diff_note = ""
    if t["sheetTotal"]:
        if abs(diff) < 100:
            diff_note = '<span class="ok">matches the sheet</span>'
        else:
            diff_note = f'<span class="muted">sheet said {usd(t["sheetTotal"])} ({"+" if diff > 0 else "−"}{usd(abs(diff))})</span>'

    parts = []
    if t["flags"]:
        parts.append('<div class="flags"><b>Check</b><ul>' + "".join(f"<li>{esc(x)}</li>" for x in t["flags"]) + "</ul></div>")

    if t["flights"]:
        rows = []
        for f in t["flights"]:
            legs = "<br>".join(
                f'{fdate(l["flightOn"])} · {esc(l.get("number") or "")} {esc(l["from"] or "?")} → {esc(l["to"] or "?")}'
                + (f' · {l["departs"]}–{l["arrives"]}' if l.get("departs") else "")
                for l in f["legs"])
            pax = ", ".join(
                f'{esc(p["name"])} {usd(p["fareCents"])}' + (f' / {eur(p["fareEurCents"])}' if p.get("fareEurCents") else "")
                + (f' <span class="pts">{p["pointsCost"]:,} pts</span>' if p.get("pointsUsed") else "")
                for p in f["passengers"])
            code = f' · {esc(f["bookingCode"])}' if f.get("bookingCode") else ""
            rows.append(f'<tr><td><b>{esc(f["airline"])}</b>{code}</td><td>{legs}</td><td>{pax}</td></tr>')
        parts.append('<h4>Flights <span class="tag new">new</span></h4><div class="scroll"><table><tr><th>Airline</th><th>Flights</th><th>Passengers &amp; fares</th></tr>'
                     + "".join(rows) + "</table></div>")

    stay_rows = [f'<tr><td>{esc(s["name"])}</td><td>{fdate(s["checkIn"])} · {s["nights"]}n</td><td>{usd(s["pocket"])}</td><td><span class="tag link">link existing</span></td></tr>'
                 for s in t["linkedStays"]]
    stay_rows += [f'<tr><td>{esc(s["name"])}</td><td>{fdate(s["checkIn"])} · {s["nights"]}n</td><td>{usd(s["pocketCents"])}</td><td><span class="tag new">new stay</span></td></tr>'
                  for s in t["newStays"]]
    if stay_rows:
        parts.append('<h4>Hotels</h4><div class="scroll"><table><tr><th>Stay</th><th>Check-in</th><th>Pocket cost</th><th></th></tr>'
                     + "".join(stay_rows) + "</table></div>")

    for r in t["rentals"]:
        parts.append(f'<h4>Rental <span class="tag new">new</span></h4><p>{esc(r["company"])} · booking {esc(r["bookingCode"] or "—")} · '
                     f'{fdate(r["pickupOn"])} – {fdate(r["returnOn"])} · {usd(r["costCents"])} / {eur(r["costEurCents"])}</p>')

    if t["misc"]:
        slot = "Planned" if t["status"] == "planned" else "Actual"
        rows = []
        for key in ORDER:
            m = t["misc"].get(key)
            if not m:
                continue
            rows.append(f'<tr><td>{LABELS[key]}</td><td class="num">{usd(m["usd"])}</td><td class="num">{eur(m["eur"]) if m["eurKnown"] else "—"}</td>'
                        f'<td class="src">{esc(" · ".join(m["rows"]))}</td></tr>')
        parts.append(f'<h4>Spending <span class="tag">{slot}</span></h4><div class="scroll"><table><tr><th>Category</th><th>{slot} $</th><th>{slot} €</th><th>From the sheet</th></tr>'
                     + "".join(rows) + "</table></div>")

    if t["skippedHotelRows"]:
        parts.append('<p class="muted small">Not imported: ' + esc("; ".join(t["skippedHotelRows"])) + "</p>")

    counts = []
    for n, one, many in ((len(t["flights"]), "flight", "flights"), (len(t["linkedStays"]) + len(t["newStays"]), "stay", "stays"),
                         (len(t["rentals"]), "rental", "rentals")):
        if n:
            counts.append(f"{n} {one if n == 1 else many}")
    badge = '<span class="tag plan">Planned</span>' if t["status"] == "planned" else '<span class="tag">Past</span>'
    flag_badge = f'<span class="tag warn">{len(t["flags"])} to check</span>' if t["flags"] else ""
    cards.append(f"""
<details class="trip"{' open' if t["flags"] else ''}>
  <summary>
    <span class="tname">{esc(t["name"])}</span>
    <span class="muted">{fdate(t["startOn"])} – {fdate(t["endOn"])}</span>
    {badge}{flag_badge}
    <span class="grow"></span>
    <span class="muted small">{" · ".join(counts)}</span>
    <span class="total">{usd(t["importTotal"])}</span>
  </summary>
  <div class="body">
    <p class="small">{diff_note} <span class="muted">· {esc(t["source"])}</span></p>
    {"".join(parts)}
  </div>
</details>""")

page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Travel Log Import Preview</title>
<style>
:root {{ --bg:#f6f5f1; --surface:#fff; --text:#111827; --muted:#6b7280; --line:#e5e7eb; --pos:#15803d; --neg:#dc2626;
  --blue:#1d4ed8; --blue-soft:#dbeafe; --rose:#be123c; --rose-soft:#ffe4e6; --slate-soft:#f1f5f9; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#0f1115; --surface:#181b22; --text:#e5e7eb; --muted:#9ca3af; --line:#2a2f3a;
  --pos:#4ade80; --neg:#f87171; --blue:#93c5fd; --blue-soft:#1e3a8a55; --rose:#fda4af; --rose-soft:#88133755; --slate-soft:#1f2430; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif; }}
main {{ max-width:1040px; margin:0 auto; }}
h1 {{ font-size:22px; margin:0 0 4px; }}
h4 {{ margin:14px 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }}
.muted {{ color:var(--muted); }} .small {{ font-size:12px; }} .ok {{ color:var(--pos); font-weight:600; }}
.stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:8px; margin:16px 0; }}
.stat {{ background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }}
.stat b {{ display:block; font-size:18px; }} .stat span {{ font-size:11px; text-transform:uppercase; color:var(--muted); letter-spacing:.04em; }}
.note {{ background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:12px 0 18px; }}
.note ul {{ margin:6px 0 0; padding-left:18px; }}
details.trip {{ background:var(--surface); border:1px solid var(--line); border-radius:10px; margin:8px 0; }}
summary {{ display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:10px 14px; cursor:pointer; list-style:none; }}
summary::-webkit-details-marker {{ display:none; }}
.tname {{ font-weight:700; }} .grow {{ flex:1; }} .total {{ font-weight:700; color:var(--neg); font-variant-numeric:tabular-nums; }}
.body {{ padding:0 14px 14px; border-top:1px solid var(--line); }}
.tag {{ font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; padding:2px 6px; border-radius:5px; background:var(--slate-soft); color:var(--muted); }}
.tag.plan, .tag.new {{ background:var(--blue-soft); color:var(--blue); }} .tag.link {{ background:var(--slate-soft); }}
.tag.warn {{ background:var(--rose-soft); color:var(--rose); }}
.flags {{ background:var(--rose-soft); border-radius:8px; padding:8px 12px; margin-top:10px; }}
.flags b {{ color:var(--rose); }} .flags ul {{ margin:4px 0 0; padding-left:18px; }}
.scroll {{ overflow-x:auto; }}
table {{ border-collapse:collapse; width:100%; min-width:520px; font-size:13px; }}
th {{ text-align:center; font-size:10px; text-transform:uppercase; color:var(--muted); letter-spacing:.04em; padding:4px 6px; border-bottom:1px solid var(--line); }}
td {{ padding:5px 6px; border-bottom:1px solid var(--line); vertical-align:top; }}
td.num {{ text-align:center; font-variant-numeric:tabular-nums; white-space:nowrap; }}
td.src {{ font-size:11px; color:var(--muted); }}
.pts {{ color:var(--blue); font-weight:600; }}
</style></head><body><main>
<h1>Travel Log import preview</h1>
<p class="muted">Both Google Sheet logs, read row by row. <b>Nothing has been written yet</b> — this is what the import would do.</p>

<div class="stats">
  <div class="stat"><span>Trips</span><b>{totals["trips"]}</b></div>
  <div class="stat"><span>Stays linked</span><b>{totals["linked"]}</b></div>
  <div class="stat"><span>New stays</span><b>{totals["newStays"]}</b></div>
  <div class="stat"><span>New flights</span><b>{totals["flights"]}</b></div>
  <div class="stat"><span>New rentals</span><b>{totals["rentals"]}</b></div>
  <div class="stat"><span>Rows to check</span><b>{totals["flags"]}</b></div>
</div>

<div class="note">
  <b>How it works</b>
  <ul>
    <li>Hotels you already logged are <b>linked</b> to their trip, not added again — their cards, points and costs stay as they are.</li>
    <li>Day-by-day rows are added up into one total per category for the whole trip. Trips that haven't started yet go in as <b>Planned</b>; past trips as <b>Actual</b>.</li>
    <li>Every $ keeps its € beside it. Nothing imported moves a card's points balance.</li>
    <li>Passengers from the Europe log are named in fare order (Victor, Johana, Leo, Hannah, Ben) — the sheet only says Adult / Children.</li>
    <li>Totals differ from the sheet where your logged stay has the real hotel cost, or where the sheet's own total left a row out.</li>
  </ul>
</div>

{"".join(cards)}
</main></body></html>"""
open("preview.html", "w", encoding="utf-8").write(page)
print("ok", totals)

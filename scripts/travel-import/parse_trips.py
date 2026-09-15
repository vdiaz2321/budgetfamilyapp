"""Turn Victor's two Google Sheet travel logs into an import plan.

Nothing here writes to the database. It produces plan.json (what the import
would do) and preview.html (the same, for Victor to review).
"""
import csv
import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

TODAY = date(2026, 9, 15)
FAMILY = ["Victor", "Johana", "Leo", "Hannah", "Ben"]

# ---------------------------------------------------------------- stays
STAYS = []
for line in open("stays.txt", encoding="utf-8").read().strip().splitlines():
    sid, check_in, nights, name, city, pocket, pax = line.split("|")
    STAYS.append({"id": sid, "checkIn": check_in, "nights": int(nights), "name": name, "city": city,
                  "pocket": int(pocket), "pax": int(pax) if pax else None})

# ---------------------------------------------------------------- trips
# Name and dates for each sheet block, read off its title (and its day rows
# where the title disagrees with them). Names carry month + year: the app
# keeps trip names unique and several places were visited twice.
EUROPE_TRIPS = {
    "Greece - 28 May - 31 May 2027": ("Greece · May 2027", "2027-05-28", "2027-05-31"),
    "Portugal - 29 Mar - 2 Apr 2027": ("Portugal · Mar 2027", "2027-03-28", "2027-04-02"),
    "Colmar - 26 - 27 Nov 2026": ("Colmar · Nov 2026", "2026-11-26", "2026-11-27"),
    "Munich/Dachau - 4 - 5 Sep 2026": ("Munich / Dachau · Sep 2026", "2026-09-04", "2026-09-05"),
    "Oberstdorf, GM 10 Aug 26 -- 14 Aug 2026": ("Oberstdorf · Aug 2026", "2026-08-10", "2026-08-14"),
    "Dornbirn - 23 Jul -- 24 Jul 2026": ("Dornbirn · Jul 2026", "2026-07-23", "2026-07-25"),
    "Berlin- 5 Jul -- 9 Jul 2026": ("Berlin · Jul 2026", "2026-07-05", "2026-07-09"),
    "Croatia - 14 Jun -- 19 Jun 2026": ("Croatia · Jun 2026", "2026-06-14", "2026-06-19"),
    "Prague Trip 22 - 25 May 2026": ("Prague · May 2026", "2026-05-22", "2026-05-25"),
    "Salzburg - 30 Mar -- 5 Apr 2026": ("Salzburg · Mar 2026", "2026-03-30", "2026-04-05"),
    "Mainz Trip 6 -8 Mar 2026": ("Mainz · Mar 2026", "2026-03-06", "2026-03-08"),
    "Lake Titisee Trip 13 -15 Feb 2026": ("Lake Titisee · Feb 2026", "2026-02-13", "2026-02-15"),
    "Frankfurt / Weinheim Trip 11 -13 Oct 2025": ("Frankfurt / Weinheim · Oct 2025", "2025-10-11", "2025-10-13"),
    "Frankfurt / Speyer Trip 30 - 1 Aug/Sep 2025": ("Frankfurt / Speyer · Aug 2025", "2025-08-30", "2025-09-01"),
    "Lake Constance / Italy 4 - 11 July 2025": ("Lake Constance / Italy · Jul 2025", "2025-07-04", "2025-07-11"),
    "Lake Titisee Trip 19 - 21 June 2025": ("Lake Titisee · Jun 2025", "2025-06-19", "2025-06-21"),
    "Augsburg / Munich Trip 24 - 26 May 2025": ("Augsburg / Munich · May 2025", "2025-05-24", "2025-05-26"),
    "Amsterdam Rodeo 1 - 6 APR 2025": ("Amsterdam Rodeo · Apr 2025", "2025-04-01", "2025-04-06"),
    "Garmisch - Austria Trip 26 - 28 Dec 2024": ("Garmisch / Austria · Dec 2024", "2024-12-26", "2024-12-29"),
    "Rhine/Cologne/Frankfurt 19 - 21 June 2024": ("Rhine / Cologne / Frankfurt · Jun 2024", "2024-06-19", "2024-06-22"),
    "Switzerland Trip 24 - 27 May 2024": ("Switzerland · May 2024", "2024-05-24", "2024-05-27"),
    "Spring Break 22 - 30 March 2024": ("Spring Break · Mar 2024", "2024-03-22", "2024-03-30"),
}


def cents(raw):
    raw = (raw or "").strip()
    if not raw or not re.search(r"\d", raw):
        return None
    try:
        return round(float(re.sub(r"[^0-9.\-]", "", raw)) * 100)
    except ValueError:
        return None


def is_money(raw):
    return bool(re.match(r"^\s*[$€]\s?[\d,]+(\.\d+)?\s*$", raw or ""))


def parse_day(raw):
    try:
        return datetime.strptime(raw.strip(), "%d-%b-%Y").date()
    except ValueError:
        return None


CATEGORY_RULES = [
    ("other", r"euros sent|summer camp|gift|souvenir|locker|laundry|expenses"),
    ("parking", r"parking"),
    ("fuel_tolls", r"fuel|toll|vignette|lez fee|\bdrive\b"),
    ("transport", r"train|ferry|\bbus\b|tram|vvs|public transport|sevilla travel|taxi"),
    ("groceries", r"grocer|supermarket"),
    ("restaurants", r"restaurant|resturant|food|breakfast|lunch|dinner"),
    ("cash", r"\bcash\b|euros|wise"),
    ("hotel", r"hotel|airbnb|apartment|\bstay\b|resort|lodge|b&b|ihg|hilton|marriott|westin|hyatt|holiday inn|"
              r"bnapartments|homaris|vogelnescht|gute laune|stressless|traumwohnung|villa|four points|das flax|hampton|nh "),
    ("entertainment", r"entertain|mus[eu]+m|zoo|legoland|pool|therm|park|lift|gandola|gondola|skydiv|welcome card|"
                      r"cinema|tour|neuschwanstein|cave|aquarium|ski|sled|course|keukenhof|salt|bastogne|monkey|"
                      r"dona[u]?ba[u]?d|eiger|nachtmann|wow|cable"),
]


def classify(*texts):
    blob = " ".join(t for t in texts if t).lower()
    for category, pattern in CATEGORY_RULES:
        if re.search(pattern, blob):
            return category
    return None


def new_trip(name, start, end, source):
    return {"name": name, "startOn": start, "endOn": end, "source": source, "flights": [], "newStays": [],
            "linkedStays": [], "rentals": [], "misc": defaultdict(lambda: {"usd": 0, "eur": 0, "eurKnown": False, "rows": []}),
            "flags": [], "sheetTotal": None, "skippedHotelRows": []}


def add_misc(trip, category, usd, eur, label, flag=None):
    m = trip["misc"][category]
    m["usd"] += usd or 0
    if eur is not None:
        m["eur"] += eur
        m["eurKnown"] = True
    m["rows"].append(f"{label} ${(usd or 0) / 100:,.2f}")
    if flag:
        trip["flags"].append(flag)


def family_for(count):
    return FAMILY[:count] if count <= len(FAMILY) else FAMILY + [f"Passenger {i}" for i in range(6, count + 1)]


# ================================================================ Europe log
rows = list(csv.reader(open("europe.csv", encoding="utf-8")))
blocks = []
for i, r in enumerate(rows):
    if len(r) > 1 and r[0] == "" and r[1] and i + 1 < len(rows) and rows[i + 1][:1] == ["Date"]:
        blocks.append((i, r[1]))
trips = []
for bi, (start_idx, title) in enumerate(blocks):
    end_idx = blocks[bi + 1][0] if bi + 1 < len(blocks) else len(rows)
    name, start, end = EUROPE_TRIPS[title]
    trip = new_trip(name, start, end, f"Europe log · {title}")
    body = rows[start_idx + 2:end_idx]
    greece = title.startswith("Greece")
    if greece:
        trip["flags"].append("This block is a copy of the Portugal plan (Lisbon/Porto flights, 2 Apr dates). "
                             "Only its planned restaurant and entertainment budget is imported — re-enter flights and hotels once booked.")
    current = None
    hotel_days = defaultdict(list)
    last_flight_to = None
    j = 0
    while j < len(body):
        r = (body[j] + [""] * 14)[:14]
        a, b, c, d, e, f, g, h, i_, jj, k, l, m_ = [x.strip() for x in r[:13]]
        day = parse_day(a)
        if day:
            current = day
        # The sheet's subtotal block (Total Cost / Hotel Cost / Entertainment/Cash…)
        # sits in column D with nothing in A-C.
        summary = not a and not b and not c and d and d not in ("Paid", "Pending", "Schedule", "Cash", "Yes")
        if summary or "Total" in d or d.endswith(":"):
            if d.startswith("Total Cost") and trip["sheetTotal"] is None:
                trip["sheetTotal"] = cents(e)
            j += 1
            continue
        if "extra row" in b.lower():
            j += 1
            continue

        # ---- flights: a description row followed by one row per passenger
        is_flight = not greece and ("(eurowings)" in b.lower() or b.lower().startswith("flight to") or c == "Eurowings")
        if is_flight:
            block = [r]
            k2 = j + 1
            while k2 < len(body):
                n = [x.strip() for x in (body[k2] + [""] * 14)[:14]]
                if "Total" in n[3] or not is_money(n[4]) or (n[1] and not re.search(r"\d{4}\s*-\s*\d{4}|hr flight", n[1])):
                    break
                block.append(body[k2])
                k2 += 1
            fares = [(cents(x[4]), cents(x[5]), (x[2] or "").strip()) for x in block if is_money(x[4])]
            label = b
            m = re.match(r"(.+?) to (.+?)(?: \((.+)\))?$", label, re.I)
            if label.lower().startswith("flight to"):
                frm = last_flight_to or "STR"
                to = label[10:].strip()
            elif m:
                frm, to = m.group(1).strip(), m.group(2).strip()
            else:
                frm, to = None, None
            airline = (m.group(3) if m and m.group(3) else None) or ("Eurowings" if "eurowings" in (label + c).lower() else c or "Airline")
            times = None
            for x in block:
                for cell in (x[1], x[6]):
                    tm = re.search(r"(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})", cell or "")
                    if tm:
                        times = (f"{tm.group(1)}:{tm.group(2)}", f"{tm.group(3)}:{tm.group(4)}")
                        break
                if times:
                    break
            status = next((x[3].strip() for x in block if x[3].strip()), "")
            names = family_for(len(fares))
            alt = any(is_money(x[9]) for x in block)
            trip["flights"].append({
                "airline": airline,
                "legs": [{"flightOn": (current or date.fromisoformat(start)).isoformat(), "from": frm, "to": to,
                          "departs": times[0] if times else None, "arrives": times[1] if times else None}],
                "passengers": [{"name": nm, "fareCents": fu or 0, "fareEurCents": fe} for nm, (fu, fe, _) in zip(names, fares)],
                "fareTypes": [t for _, _, t in fares],
                "remarks": f"Imported from sheet ({status})" if status else "Imported from sheet",
            })
            if alt:
                trip["flags"].append(f"{label}: the sheet lists a second fare option beside this one — only the first is imported.")
            last_flight_to = to
            j = k2
            continue

        usd, eur = cents(e) if is_money(e) else None, cents(f) if is_money(f) else None
        side_usd, side_eur = (cents(h), cents(i_)) if is_money(h) else (None, None)
        # The description decides; the mode, then the note, only when it says nothing.
        category = classify(b) or classify(c) or classify(g)
        if c == "Hotel" or category == "hotel":
            if b and current:
                hotel_days[b].append((current, usd if usd is not None else side_usd, eur if eur is not None else side_eur, g, m_, d))
            j += 1
            continue
        if greece and category not in ("restaurants", "entertainment"):
            j += 1
            continue
        if greece:
            side_usd = None
        if category in (None, "hotel") and (usd or side_usd):
            category = "other"
            trip["flags"].append(f"“{b or g}” (${(usd or side_usd) / 100:,.2f}) didn't match a category — put under Gifts & other.")
        if usd:
            add_misc(trip, category, usd, eur, b or g or c)
        if side_usd and not (c == "Hotel"):
            side_cat = classify(c) if usd else category
            side_cat = side_cat if side_cat not in (None, "hotel") else category
            add_misc(trip, side_cat, side_usd, side_eur, f"{b or c} (2nd amount)",
                     f"“{b or c}”: an amount sat in the Start/End Time columns (${side_usd / 100:,.2f}) — counted under {side_cat}.")
        j += 1

    # ---- hotels: link to stays already logged; create only the missing ones
    in_range = [s for s in STAYS if start <= s["checkIn"] <= end]
    trip["linkedStays"] = in_range
    if not greece:
        for hotel, days in hotel_days.items():
            first = days[0][0].isoformat()
            if any(s["checkIn"] == first or (s["checkIn"] <= first < (date.fromisoformat(s["checkIn"]) + timedelta(days=s["nights"])).isoformat())
                   for s in in_range):
                continue
            if any(x[5].lower().startswith("cancel") or "cancelled" in (x[4] or "").lower() for x in days):
                continue
            paid = [x for x in days if x[1]]
            if not paid and "points" not in " ".join(x[5].lower() + " " + (x[2] and "" or "") for x in days) and not any(
                    "points" in (x[5] or "").lower() for x in days):
                trip["skippedHotelRows"].append(f"{hotel} ({first}) — no cost and no matching stay")
                continue
            nights = len({x[0] for x in days})
            if any(x[1] is None and "points" in (x[5] or "").lower() + " " for x in days) or                     any(r2[4].strip() == "Points" and r2[1].strip() == hotel for r2 in body):
                trip["flags"].append(f"{hotel}: a second room was booked with points — only the paid room (${paid[0][1] / 100:,.2f}) "
                                     "is imported. Add the points room from the Stay form so its points come off the right card.")
            trip["newStays"].append({"name": hotel, "checkIn": first, "nights": nights,
                                     "hotelCents": paid[0][1] if paid else 0, "pocketCents": paid[0][1] if paid else 0,
                                     "points": not paid, "remarks": "; ".join(filter(None, {x[4] for x in days}))})
    trips.append(trip)

# ================================================================ Spain / Panama log
srows = list(csv.reader(open("spain.csv", encoding="utf-8")))
SPAIN = [
    ("Panama Trip Dec 13 - 27 2017", "Panama · Dec 2017", "2017-12-13", "2017-12-27"),
    ("Spain Trip Dec 2018", "Spain · Dec 2018", "2018-12-01", "2018-12-31"),
    ("Spain Trip 19 June - 31 July 2023", "Spain · Summer 2023", "2023-06-19", "2023-07-31"),
    ("Spain Trip 28 June - 10 July 2024", "Spain · Summer 2024", "2024-06-28", "2024-07-10"),
    ("Spain Trip (17 Dec 25) - (26 Dec 25)", "Spain · Dec 2025", "2025-12-17", "2025-12-26"),
    ("Spain Trip (16 Dec 26) - (26 Dec 26)", "Spain · Dec 2026", "2026-12-16", "2026-12-26"),
]
PEOPLE = {"mom": "Johana", "jo": "Johana", "johana": "Johana", "dad": "Victor", "vic": "Victor", "leo": "Leo",
          "hannah": "Hannah", "ben": "Ben"}
index = {r[0]: i for i, r in enumerate(srows)}
for n, (title, name, start, end) in enumerate(SPAIN):
    at = index[title]
    stop = index[SPAIN[n + 1][0]] if n + 1 < len(SPAIN) else len(srows)
    trip = new_trip(name, start, end, f"Spain log · {title}")
    airport = srows[at][6] if len(srows[at]) > 6 else ""
    trip["linkedStays"] = [s for s in STAYS if start <= s["checkIn"] <= end]
    home, away = (airport.split(" - ") + ["", ""])[:2] if airport else ("", "")
    away = {"AGP": "Málaga", "PTY": "Panama City", "BC": "Barcelona"}.get(away.strip(), away.strip())
    for r in srows[at + 1:stop]:
        r = (r + [""] * 7)[:7]
        desc, who, paid, usd_raw, eur_raw, remarks, _ = [x.strip() for x in r]
        if desc == "Description" or (not desc and not usd_raw):
            continue
        if "Total" in paid:
            if trip["sheetTotal"] is None:
                trip["sheetTotal"] = cents(usd_raw)
            continue
        if desc in ("Chase", "Delta"):  # points-only summary rows
            points = int(cents(r[1]) / 100)
            valuation = float(r[2])
            cash = cents(r[3])
            fees = cents(r[4]) or 0
            trip["flights"].append({
                "airline": "Delta" if desc == "Delta" else "Airline (booked via Chase)",
                "legs": [{"flightOn": start, "from": home.strip() or "TPA", "to": away, "departs": None, "arrives": None}],
                "passengers": [{"name": nm, "fareCents": round(cash / 5), "fareEurCents": None, "pointsUsed": True,
                                "pointsCost": round(points / 5)} for nm in FAMILY],
                "cardLabel": desc, "pointsValue": valuation, "pocketCents": fees,
                "remarks": f"Imported from sheet: {points:,} pts at ${valuation}/pt, cash price ${cash / 100:,.2f}",
            })
            trip["flags"].append(f"{desc} points trip: {points:,} pts and the ${cash / 100:,.2f} cash price are split evenly across 5 passengers "
                                 "(the sheet has no per-person split). No card balance changes.")
            if "2018" in title:
                trip["flags"].append("The sheet only says “Dec 2018” — the trip is dated 1–31 Dec 2018; set the real dates in the Trip Log.")
            continue
        usd, eur = cents(usd_raw), cents(eur_raw)
        if usd is None:
            continue
        low = desc.lower()
        if low.startswith(("eurowings", "vueling")):
            who_text = (remarks or who).lower()
            names = [PEOPLE[p] for p in re.findall(r"[a-z]+", who_text) if p in PEOPLE]
            if not names or "family" in who_text:
                names = FAMILY
            names = list(dict.fromkeys(names))
            airline = "Vueling" if low.startswith("vueling") else "Eurowings"
            to = "Barcelona" if "bcn" in low else away
            per_usd, per_eur = round(usd / len(names)), (round(eur / len(names)) if eur else None)
            flight = {
                "airline": airline,
                "legs": [{"flightOn": start, "from": "Stuttgart", "to": to, "departs": None, "arrives": None}]
                        + ([] if "bcn" in low else [{"flightOn": end, "from": to, "to": "Stuttgart", "departs": None, "arrives": None}]),
                "passengers": [{"name": nm, "fareCents": per_usd, "fareEurCents": per_eur} for nm in names],
                "remarks": "Imported from sheet",
            }
            # The one receipt we have: Eurowings YQGCPH, Dad / Leo / Hannah, Dec 2026.
            if name == "Spain · Dec 2026" and airline == "Eurowings" and "dad" in who_text:
                flight.update({
                    "bookingCode": "YQGCPH", "reservedOn": "2026-01-23",
                    "legs": [{"flightOn": "2026-12-16", "number": "EW 2536", "from": "Stuttgart", "to": "Málaga", "departs": "17:00", "arrives": "19:45"},
                             {"flightOn": "2026-12-26", "number": "EW 2537", "from": "Málaga", "to": "Stuttgart", "departs": "09:25", "arrives": "12:15"}],
                    "remarks": "Imported from sheet; flight details from the Eurowings receipt (paid Amex, €671.94)",
                })
                flight["passengers"] = [{"name": nm, "fareCents": round(usd / 3), "fareEurCents": round(67194 / 3)} for nm in names]
            else:
                trip["flags"].append(f"{airline} {remarks or who}: flight dates set to the trip's first/last day and the "
                                     f"${usd / 100:,.2f} split evenly across {len(names)} — adjust per person.")
            trip["flights"].append(flight)
            continue
        if low.startswith("rental car"):
            booking = re.search(r"#\s*(\d+)", remarks)
            trip["rentals"].append({"company": remarks.split(" Booking")[0] or "Rental car",
                                    "bookingCode": booking.group(1) if booking else None,
                                    "pickupOn": start, "returnOn": end, "costCents": usd, "costEurCents": eur})
            trip["flags"].append("Rental car pick-up/return set to the trip's dates — adjust if different.")
            continue
        if re.search(r"hotel", low) and trip["linkedStays"]:
            trip["skippedHotelRows"].append(f"{desc} ${usd / 100:,.2f} — covered by the stays already logged")
            continue
        if low == "resort":
            trip["skippedHotelRows"].append(f"Resort ${usd / 100:,.2f} — matches Gran Hotel Miramar's $53 pocket cost")
            continue
        category = classify(desc)
        if low == "stay":
            # Cash given to the family we stayed with, as a thank-you.
            add_misc(trip, "other", usd, eur, "Thank-you cash to family for hosting")
            continue
        if low in ("granda", "madrid", "cordoba") or low.startswith("sevilla travel"):
            category = "transport" if "travel" in low else "other"
        elif category in (None, "hotel"):
            category = "other"
            trip["flags"].append(f"“{desc}” (${usd / 100:,.2f}) didn't match a category — put under Gifts & other.")
        add_misc(trip, category, usd, eur, desc)
    trips.append(trip)

# ---------------------------------------------------------------- totals & output
for t in trips:
    t["status"] = "planned" if date.fromisoformat(t["startOn"]) > TODAY else "actual"
    misc = sum(m["usd"] for m in t["misc"].values())
    flights = sum(p.get("fareCents", 0) for f in t["flights"] for p in f["passengers"] if not p.get("pointsUsed")) + \
        sum(f.get("pocketCents", 0) for f in t["flights"] if any(p.get("pointsUsed") for p in f["passengers"]))
    stays = sum(s["pocket"] for s in t["linkedStays"]) + sum(s["pocketCents"] for s in t["newStays"])
    rentals = sum(r["costCents"] or 0 for r in t["rentals"])
    t["importTotal"] = misc + flights + stays + rentals
    t["parts"] = {"flights": flights, "stays": stays, "rentals": rentals, "misc": misc}
    t["misc"] = {k: v for k, v in t["misc"].items()}

trips.sort(key=lambda t: t["startOn"], reverse=True)
json.dump(trips, open("plan.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(len(trips), "trips")
for t in trips:
    st = t["sheetTotal"]
    print(f'{t["name"]:42} {t["startOn"]} {t["status"]:7} flights={len(t["flights"])} linked={len(t["linkedStays"])} '
          f'new={len(t["newStays"])} rentals={len(t["rentals"])} import=${t["importTotal"] / 100:,.2f} sheet=${(st or 0) / 100:,.2f} flags={len(t["flags"])}')

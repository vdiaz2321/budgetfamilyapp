"""Turn plan.json into import.sql — one transaction that writes the trips.

Run parse_trips.py first. The SQL refuses to run if the household already has
trips, so it can't be applied twice. Nothing it adds moves a card's points.
"""
import json
import uuid

HOUSEHOLD = "fb0f52d2-cd2d-46af-874f-229711ba7b93"  # Diaz Family
TRAVELLERS = {
    "Victor": "501c81bc-6c74-444b-a3db-1122ab5d524d",
    "Johana": "b520759a-768f-4722-8427-5b0636f0b78b",
    "Leo": "a3dfc9de-9910-4b37-b234-dafd6f10697b",
    "Hannah": "2604d167-dc21-42b1-886a-fa3914a9857e",
    "Ben": "96cd636e-454e-424c-bdf6-a13300c991e0",
}
CITIES = {"IHG - Príncipe Real": "Lisbon, Portugal", "bnapartments Trindade": "Porto, Portugal"}


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def values(rows):
    return ",\n  ".join("(" + ", ".join(q(v) for v in r) + ")" for r in rows)


plan = json.load(open("plan.json", encoding="utf-8"))
out = ["begin;",
       f"do $$ begin if exists (select 1 from travel_trips where household_id = {q(HOUSEHOLD)}) then "
       "raise exception 'Trips already imported'; end if; end $$;"]

trips, expenses, stays, flights, legs, passengers, cars = [], [], [], [], [], [], []
for t in plan:
    tid = str(uuid.uuid5(uuid.NAMESPACE_URL, "trip:" + t["name"]))
    notes = "Imported from the Google Sheet (" + t["source"] + ")."
    if t["flags"]:
        notes += "\nTo check:\n- " + "\n- ".join(t["flags"])
    trips.append((tid, HOUSEHOLD, t["name"], t["startOn"], t["endOn"], notes))

    planned = t["status"] == "planned"
    for category, m in t["misc"].items():
        usd, eur = m["usd"], (m["eur"] if m["eurKnown"] else None)
        expenses.append((HOUSEHOLD, tid, category,
                         usd if planned else None, eur if planned else None,
                         None if planned else usd, None if planned else eur,
                         "; ".join(m["rows"])))

    for s in t["newStays"]:
        stays.append((HOUSEHOLD, tid, s["name"], CITIES.get(s["name"]), s["checkIn"], s["nights"],
                      s["hotelCents"], s["pocketCents"], "card", s["remarks"] or None))

    for f in t["flights"]:
        fid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"flight:{t['name']}:{len(flights)}"))
        ps = f["passengers"]
        points = sum(p.get("pointsCost", 0) for p in ps if p.get("pointsUsed"))
        cost = sum(p["fareCents"] for p in ps)
        points_fares = sum(p["fareCents"] for p in ps if p.get("pointsUsed"))
        pocket = f["pocketCents"] if "pocketCents" in f else cost - points_fares
        eur = sum(p["fareEurCents"] or 0 for p in ps) if any(p["fareEurCents"] is not None for p in ps) else None
        value = round(f["pointsValue"] * 1_000_000) if f.get("pointsValue") else None
        first = min(leg["flightOn"] for leg in f["legs"])
        flights.append((fid, HOUSEHOLD, tid, f.get("cardLabel"), f["airline"], f.get("bookingCode"), f.get("reservedOn"),
                        first, points, points > 0, value, cost, eur, pocket, f["remarks"], False))
        for i, leg in enumerate(sorted(f["legs"], key=lambda l: (l["flightOn"], l["departs"] or ""))):
            legs.append((HOUSEHOLD, fid, i, leg["flightOn"], leg.get("number"), leg["from"], leg["to"],
                         leg["departs"], leg["arrives"]))
        for i, p in enumerate(ps):
            passengers.append((HOUSEHOLD, fid, i, TRAVELLERS.get(p["name"]), p["name"], p["fareCents"],
                               bool(p.get("pointsUsed")), p.get("pointsCost", 0) if p.get("pointsUsed") else 0,
                               p["fareEurCents"]))

    for r in t["rentals"]:
        cars.append((HOUSEHOLD, tid, "rental", r["company"], r["bookingCode"], r["pickupOn"], r["returnOn"],
                     r["costCents"], r["costEurCents"], r["costCents"], "Imported from sheet", False))

out.append("insert into travel_trips (id, household_id, name, start_on, end_on, notes) values\n  " + values(trips) + ";")
out.append("insert into travel_trip_expenses (household_id, trip_id, category, planned_cents, planned_eur_cents, "
           "actual_cents, actual_eur_cents, note) values\n  " + values(expenses) + ";")
# Link each logged stay to its trip.
pairs = [(s["id"], trips[i][0]) for i, t in enumerate(plan) for s in t["linkedStays"]]
out.append("update travel_stays s set trip_id = x.trip_id::uuid, updated_at = now() from (values\n  " + values(pairs)
           + f") x(id, trip_id) where s.id = x.id::uuid and s.household_id = {q(HOUSEHOLD)};")
out.append(f"do $$ begin if (select count(*) from travel_stays where household_id = {q(HOUSEHOLD)} and trip_id is not null) <> {len(pairs)} "
           "then raise exception 'Not every logged stay was found to link'; end if; end $$;")
out.append("insert into travel_stays (household_id, trip_id, property_name, city, check_in, nights, hotel_cost_cents, "
           "pocket_cost_cents, pocket_paid_with, remarks) values\n  " + values(stays) + ";")
out.append("insert into travel_flights (id, household_id, trip_id, card_label, airline, booking_code, reserved_on, "
           "first_flight_on, points_cost, points_used, points_value_micros, flight_cost_cents, flight_cost_eur_cents, "
           "pocket_cost_cents, remarks, moves_card_points) values\n  " + values(flights) + ";")
out.append("insert into travel_flight_legs (household_id, flight_id, sort_order, flight_on, flight_number, from_place, "
           "to_place, departs_at, arrives_at) values\n  " + values(legs) + ";")
out.append("insert into travel_flight_passengers (household_id, flight_id, sort_order, traveller_id, name, fare_cents, "
           "points_used, points_cost, fare_eur_cents) values\n  " + values(passengers) + ";")
out.append("insert into travel_cars (household_id, trip_id, kind, company, booking_code, pickup_on, return_on, cost_cents, "
           "cost_eur_cents, pocket_cost_cents, remarks, moves_card_points) values\n  " + values(cars) + ";")
out.append("commit;")

open("import.sql", "w", encoding="utf-8").write("\n\n".join(x for x in out if x) + "\n")
print(f"trips={len(trips)} expenses={len(expenses)} linked={len(pairs)} new_stays={len(stays)} "
      f"flights={len(flights)} legs={len(legs)} passengers={len(passengers)} cars={len(cars)}")

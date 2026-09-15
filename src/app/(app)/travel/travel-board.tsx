"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { CardLinkModal, type CardLabelRow } from "./card-link-modal";
import { CreditCardRewardsProvider, CreditCardSections, RewardsPointsLog } from "./credit-card-rewards";
import type { CreditCardBoardData } from "@/lib/credit-card-data";
import { StayModal } from "./stay-modal";
import { FlightModal } from "./flight-modal";
import { CarModal } from "./car-modal";
import { TransportLogPanel } from "./transport-log-panel";
import { TripLogPanel } from "./trip-log-panel";
import { TripDetailModal } from "./trip-detail-modal";
import { MiscModal } from "./misc-modal";
import { summarizeTrips } from "./trip-summary";
import { KindSwitch, type TravelKind } from "./kind-switch";
import { CostBars, SavedLine, type YearPoint } from "./travel-charts";
import {
  effectivePointsValueMicros,
  pointsValueCents,
  savedCents,
  stayYear,
  type TravelBrand,
  type TravelCar,
  type TravelCard,
  type TravelFlight,
  type TravelStay,
  type TravelTrip,
  type TripExpense,
  type Traveller,
} from "./types";

const ALL = "__all__";

// The sheet writes dates as 12-Sep-25 and says how a room was covered instead
// of printing $0.00. These keep the table reading the way the spreadsheet did.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// An empty cell reads as a dash here, like every other table in the app.
const DASH = "—";

// Every column the reservations table can be ordered by.
const SORTERS = {
  reservedOn: (s: TravelStay) => s.reservedOn ?? "",
  checkIn: (s: TravelStay) => s.checkIn,
  propertyName: (s: TravelStay) => s.propertyName.toLowerCase(),
  pointsCost: (s: TravelStay) => s.pointsCost,
  pointsValue: (s: TravelStay) => effectivePointsValueMicros(s) ?? 0,
  hotelCredit: (s: TravelStay) => s.hotelCreditCents,
  hotelCost: (s: TravelStay) => s.hotelCostCents,
  pocketCost: (s: TravelStay) => s.pocketCostCents,
  city: (s: TravelStay) => (s.city ?? "").toLowerCase(),
  nights: (s: TravelStay) => s.nights,
  brand: (s: TravelStay) => (s.brand ?? "").toLowerCase(),
  cardLabel: (s: TravelStay) => (s.cardLabel ?? "").toLowerCase(),
  pax: (s: TravelStay) => s.pax ?? 0,
  remarks: (s: TravelStay) => (s.remarks ?? "").toLowerCase(),
} satisfies Record<string, (s: TravelStay) => string | number>;

type SortKey = keyof typeof SORTERS;

// Text sorts start A→Z; numbers and dates start with the biggest first.
const TEXT_KEYS = new Set<SortKey>(["propertyName", "city", "brand", "cardLabel", "remarks"]);

function sheetDate(iso: string | null): string {
  if (!iso) return DASH;
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}

// Points a stay actually spent. A stay carrying a what-if figure (points not
// used) contributes nothing to any total — that number exists to compare
// against what was paid in cash, not to be counted as spend.
function spentPoints(stay: TravelStay): number {
  return stay.pointsUsed ? stay.pointsCost : 0;
}

// The cash those redeemed points were worth. Per stay the rate is still shown
// for a what-if — that is the point of recording one — but no total adds it.
function spentPointsValue(stay: TravelStay): number {
  return stay.pointsUsed ? pointsValueCents(stay) : 0;
}

function money(cents: number, currency: string): string {
  return cents > 0 ? formatMoney(cents, currency) : DASH;
}

// Whole days between two ISO dates — both are plain dates, so no clocks or
// time zones come into it.
function daysUntil(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

// Column E: what a point was worth on this stay, to three decimals. A rate
// worked out from the hotel cost (rather than typed into the sheet) is shown
// in muted type, so a calculated cell is never mistaken for a recorded one.
function cashValue(stay: TravelStay): { text: string; derived: boolean } {
  const micros = effectivePointsValueMicros(stay);
  if (!micros) return { text: DASH, derived: false };
  return {
    text: `$${(micros / 1_000_000).toFixed(3)}`,
    derived: !stay.pointsValueMicros,
  };
}

// Column H when nothing left the wallet: "Pts", "Credit", or a dash.
function coveredBy(stay: TravelStay): string {
  if (stay.pocketPaidWith === "points") return "Pts";
  if (stay.pocketPaidWith === "credit") return "Credit";
  return DASH;
}

export function TravelBoard({
  stays,
  flights,
  cars: carList,
  trips,
  expenses,
  travellers,
  cards,
  brands: brandList,
  currency,
  today,
  rewards,
}: {
  stays: TravelStay[];
  flights: TravelFlight[];
  cars: TravelCar[];
  trips: TravelTrip[];
  expenses: TripExpense[];
  travellers: Traveller[];
  cards: TravelCard[];
  brands: TravelBrand[];
  currency: string;
  today: string;
  // The credit-card rewards board that used to live on /accounts. Sits with
  // the stays because it answers the same question they do.
  rewards: CreditCardBoardData;
}) {
  const [year, setYear] = useState<string>(() => {
    const current = today.slice(0, 4);
    return stays.some((s) => stayYear(s) === current) ? current : ALL;
  });
  const [brand, setBrand] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [bfastOnly, setBfastOnly] = useState(false);
  const [ptsOnly, setPtsOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "checkIn",
    dir: "desc",
  });
  const [openYears, setOpenYears] = useState(true);
  const [openBrands, setOpenBrands] = useState(true);
  // One period for the two side-by-side tallies (brand and card): they answer
  // the same question two ways, so reading them against different years was
  // never what was wanted. Independent of the Reservations filter above them.
  const [tallyYear, setTallyYear] = useState<string>(ALL);
  const [openCards, setOpenCards] = useState(true);
  // The log starts collapsed on a fresh login — it's the longest section on
  // the page — but sessionStorage carries whatever you last set for as long as
  // you're still moving around the app.
  const [listState, setListState] = useSessionCollapse("travel-reservations-log", () => ({ open: false }));
  const openList = !!listState.open;
  const setOpenList = (fn: (v: boolean) => boolean) =>
    setListState((s) => ({ open: fn(!!s.open) }));
  // Each upcoming group (hotels, flights, rentals) folds on its own.
  const [upcomingOpen, setUpcomingOpen] = useSessionCollapse("travel-upcoming", () => ({
    hotels: true,
    flights: true,
    cars: true,
  }));
  const toggleUpcoming = (key: "hotels" | "flights" | "cars") =>
    setUpcomingOpen((s) => ({ ...s, [key]: s[key] === false }));
  const isUpcomingOpen = (key: "hotels" | "flights" | "cars") => upcomingOpen[key] !== false;
  // The reservations log opened in a popup, where the sheet's full column set
  // has room. Desktop only — see the button in the panel header.
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<TravelStay | null>(null);
  const [adding, setAdding] = useState(false);
  // Which form the Add button opens on. Remembered while the page is open, so
  // logging three flights in a row doesn't mean flipping the switch each time.
  const [addKind, setAddKind] = useState<TravelKind>("stay");
  const [editingFlight, setEditingFlight] = useState<TravelFlight | null>(null);
  const [editingCar, setEditingCar] = useState<TravelCar | null>(null);
  // Set when Add was opened from a trip's own row: the new booking starts in it.
  const [addTripId, setAddTripId] = useState<string | null>(null);
  // The trip open in its own popup, from a Trip Log row.
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const tripSummaries = useMemo(
    () => summarizeTrips(trips, stays, flights, carList, expenses),
    [trips, stays, flights, carList, expenses],
  );
  const openTrip = tripSummaries.find((t) => t.trip.id === openTripId) ?? null;
  const closeForms = () => {
    setAdding(false);
    setAddTripId(null);
    setEditing(null);
    setEditingFlight(null);
    setEditingCar(null);
  };
  const [linking, setLinking] = useState(false);

  // Everything but the Reservations list reads `live`: a cancelled booking was
  // never paid for, so it must not move a total, a chart or a tally.
  const live = useMemo(() => stays.filter((s) => !s.cancelledAt), [stays]);

  const cardName = useMemo(
    () => new Map(cards.map((c) => [c.id, c.name])),
    [cards],
  );
  const years = useMemo(
    () => Array.from(new Set(stays.map(stayYear))).sort().reverse(),
    [stays],
  );
  const brands = useMemo(
    () => Array.from(new Set(stays.map((s) => s.brand).filter(Boolean) as string[])).sort(),
    [stays],
  );

  // Search reads every text field on a stay, so "munich", "aspire" and
  // "breakfast" all find rows without picking a field first.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = stays.filter((s) => {
      if (year !== ALL && stayYear(s) !== year) return false;
      if (brand !== ALL && s.brand !== brand) return false;
      if (bfastOnly && !s.breakfastIncluded) return false;
      if (ptsOnly && !s.pointsUsed) return false;
      if (!needle) return true;
      return [s.propertyName, s.city, s.brand, s.cardLabel, s.holder, s.remarks]
        .some((field) => field?.toLowerCase().includes(needle));
    });

    const read = SORTERS[sort.key];
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [stays, year, brand, bfastOnly, ptsOnly, query, sort]);

  // Clicking a column sorts by it; clicking the same one again flips it.
  function sortBy(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: TEXT_KEYS.has(key) ? "asc" : "desc" },
    );
  }

  // Per-year rollup over ALL stays, not the filtered set: this table is the
  // year-over-year picture, and narrowing it to one year would leave one row.
  const byYear = useMemo(() => {
    const map = new Map<
      string,
      { hotel: number; pocket: number; stays: number; points: number }
    >();
    for (const s of live) {
      const key = stayYear(s);
      const row = map.get(key) ?? { hotel: 0, pocket: 0, stays: 0, points: 0 };
      row.hotel += s.hotelCostCents;
      row.pocket += s.pocketCostCents;
      row.points += spentPoints(s);
      row.stays += 1;
      map.set(key, row);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [live]);

  const yearPoints: YearPoint[] = useMemo(
    () => byYear.map(([year, row]) => ({ year, hotel: row.hotel, pocket: row.pocket, stays: row.stays })),
    [byYear],
  );

  // Everything still ahead of you, soonest first. This is the one part of the
  // log that answers "what's next" rather than "what happened".
  const upcoming = useMemo(
    () =>
      live
        .filter((s) => s.checkIn >= today)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
        .slice(0, 3),
    [live, today],
  );
  // Flights still to fly: a round trip stays listed until its last flight, and
  // counts down to whichever flight is next.
  const upcomingFlights = useMemo(
    () =>
      flights
        .filter((f) => !f.cancelledAt)
        .map((f) => ({ flight: f, next: f.legs.find((l) => l.flightOn >= today) ?? null }))
        .filter((x): x is { flight: TravelFlight; next: TravelFlight["legs"][number] } => x.next !== null)
        .sort((a, b) => a.next.flightOn.localeCompare(b.next.flightOn))
        .slice(0, 3),
    [flights, today],
  );
  // Rentals still to pick up or still out. Drives in the family car are not
  // reservations, so they stay in the Cars Log only.
  const upcomingCars = useMemo(
    () =>
      carList
        .filter((c) => !c.cancelledAt && c.kind === "rental" && (c.returnOn ?? c.pickupOn) >= today)
        .sort((a, b) => a.pickupOn.localeCompare(b.pickupOn))
        .slice(0, 3),
    [carList, today],
  );

  // The sheet's CC Info column, grouped: one row per distinct label, with the
  // card those stays already point at when they all agree.
  const cardLabels: CardLabelRow[] = useMemo(() => {
    const map = new Map<string, { stays: number; accounts: Set<string | null> }>();
    for (const s of stays) {
      const label = s.cardLabel?.trim();
      if (!label) continue;
      const row = map.get(label) ?? { stays: 0, accounts: new Set<string | null>() };
      row.stays += 1;
      row.accounts.add(s.accountId);
      map.set(label, row);
    }
    return Array.from(map.entries())
      .map(([label, row]) => ({
        label,
        stays: row.stays,
        accountId: row.accounts.size === 1 ? ([...row.accounts][0] ?? null) : null,
      }))
      .sort((a, b) => b.stays - a.stays || a.label.localeCompare(b.label));
  }, [stays]);

  // The charts always plot every year — narrowing them to one would leave a
  // single column — so they say so, and mark the filtered year instead.
  const chartScope =
    year === ALL ? "All years" : `All years · ${year} highlighted`;

  // Only stays that carry a CC Info label and still point at no card — those
  // are the ones the Link cards modal can actually fix. A stay with no label
  // at all (paid cash, booked direct) is not "unlinked", there was never a
  // card to link, and counting those made the badge unclearable.
  const unlinked = useMemo(
    () => stays.filter((s) => !s.accountId && s.cardLabel?.trim()).length,
    [stays],
  );


  // Stays per brand for the period the panel is set to — the sheet's brand
  // tally, and what a by-brand chart will group on.
  const tallyStays = useMemo(
    () => (tallyYear === ALL ? live : live.filter((s) => stayYear(s) === tallyYear)),
    [live, tallyYear],
  );
  const tallyTotals = useMemo(() => {
    let spent = 0, saved = 0;
    for (const s of tallyStays) {
      spent += s.pocketCostCents;
      saved += savedCents(s);
    }
    return { spent, saved };
  }, [tallyStays]);
  // One control, in the Brand header, for both tallies: they sit side by side
  // and are read together, so a second copy on the card panel was the same
  // switch twice.
  const tallyPeriod = (
    <select
      aria-label="Tally period"
      value={tallyYear}
      onChange={(e) => setTallyYear(e.target.value)}
      className="cursor-pointer rounded-lg bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
    >
      <option value={ALL}>All years</option>
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );

  // What each real card has actually done for you — only answerable once the
  // labels are linked, which is what the Link cards button is for.
  const cardTally = useMemo(() => {
    const map = new Map<string, { stays: number; spent: number; saved: number; points: number }>();
    for (const s of tallyStays) {
      const key = (s.accountId ? cardName.get(s.accountId) : null) ?? "Not linked";
      const row = map.get(key) ?? { stays: 0, spent: 0, saved: 0, points: 0 };
      row.stays += 1;
      row.spent += s.pocketCostCents;
      row.saved += savedCents(s);
      row.points += spentPoints(s);
      map.set(key, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].stays - a[1].stays || a[0].localeCompare(b[0]));
  }, [tallyStays, cardName]);
  const brandTally = useMemo(() => {
    const map = new Map<string, { stays: number; spent: number; saved: number; points: number }>();
    for (const s of tallyStays) {
      const key = s.brand?.trim() || "Unbranded";
      const row = map.get(key) ?? { stays: 0, spent: 0, saved: 0, points: 0 };
      row.stays += 1;
      row.spent += s.pocketCostCents;
      row.saved += savedCents(s);
      row.points += spentPoints(s);
      map.set(key, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].stays - a[1].stays || a[0].localeCompare(b[0]));
  }, [tallyStays]);

  const allTotals = useMemo(() => {
    let spent = 0, saved = 0;
    for (const s of live) {
      spent += s.pocketCostCents;
      saved += savedCents(s);
    }
    return { spent, saved };
  }, [live]);

  // What the Reservations list currently adds up to, so a year filter answers
  // "what did that year actually cost me" without scrolling 80 rows.
  const shownTotals = useMemo(() => {
    let hotel = 0, pocket = 0, points = 0, pointsValue = 0, nights = 0, cancelled = 0;
    for (const s of filtered) {
      if (s.cancelledAt) { cancelled += 1; continue; }
      hotel += s.hotelCostCents;
      pocket += s.pocketCostCents;
      points += spentPoints(s);
      pointsValue += spentPointsValue(s);
      nights += s.nights;
    }
    return { hotel, pocket, points, pointsValue, nights, cancelled, saved: hotel - pocket };
  }, [filtered]);

  // The reservations filter bar, desktop table and mobile card list, built
  // once and rendered in both the inline panel and the full-width popup —
  // they read the same filter/sort state, so the two can never disagree.
  // The year picker sits in the log's header, beside Open full width — the
  // same place the Travel Log keeps its own.
  const yearSelect = (
    <select
      aria-label="Hotel Reservations Log year"
      value={year}
      onChange={(e) => setYear(e.target.value)}
      className="cursor-pointer rounded-lg bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
    >
      <option value={ALL}>All years</option>
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );

  const reservations = (
    <>
              {/* Filters on the left, and the figures the header doesn't carry
                  on the right — spent and saved live in the header, so they are
                  not repeated here. */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search hotel, city, card…"
                    className="w-44 rounded-md bg-background px-2 py-1 text-xs ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  {/* Breakfast is the one perk worth pulling a list on, so it
                      filters from here instead of only being readable per row. */}
                  <button
                    type="button"
                    onClick={() => setBfastOnly((v) => !v)}
                    aria-pressed={bfastOnly}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 transition ${
                      bfastOnly
                        ? "text-white ring-transparent"
                        : "bg-background ring-line hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                    style={bfastOnly ? { backgroundColor: "var(--viz-bills)" } : undefined}
                  >
                    B&apos;fast incl
                  </button>
                  {/* The other half of the points question: show only the stays
                      that actually redeemed. */}
                  <button
                    type="button"
                    onClick={() => setPtsOnly((v) => !v)}
                    aria-pressed={ptsOnly}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 transition ${
                      ptsOnly
                        ? "text-white ring-transparent"
                        : "bg-background ring-line hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                    style={ptsOnly ? { backgroundColor: "var(--viz-savings)" } : undefined}
                  >
                    Pts used
                  </button>
                  {brands.length > 0 ? (
                    <select
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      <option value={ALL}>All brands</option>
                      {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {/* Mobile has cards, not column headers, so it needs its own
                      way to reorder them. */}
                  <select
                    value={`${sort.key}:${sort.dir}`}
                    onChange={(e) => {
                      const [key, dir] = e.target.value.split(":");
                      setSort({ key: key as SortKey, dir: dir as "asc" | "desc" });
                    }}
                    className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:hidden"
                  >
                    <option value="checkIn:desc">Newest check-in</option>
                    <option value="checkIn:asc">Oldest check-in</option>
                    <option value="hotelCost:desc">Highest hotel cost</option>
                    <option value="pocketCost:desc">Highest pocket cost</option>
                    <option value="pointsCost:desc">Most points</option>
                    <option value="propertyName:asc">Hotel name A–Z</option>
                  </select>
                  {/* The night count opens the run of totals: it says what the
                      money figures beside it are counting. */}
                  <span className="text-[11px] text-muted tabular-nums">
                    Total in {year === ALL ? "all years" : year}: {shownTotals.nights} Night
                    {shownTotals.nights === 1 ? "" : "s"}
                    {shownTotals.cancelled ? ` · ${shownTotals.cancelled} cancelled` : ""}
                  </span>
                  <Figure label="Total hotel cost" value={formatMoney(shownTotals.hotel, currency)} tone="" />
                  <Figure
                    label="Total pts used"
                    value={shownTotals.points.toLocaleString()}
                    tone=""
                    style={{ color: "var(--viz-savings)" }}
                  />
                  {/* What those points were actually worth, at the rate recorded
                      on each stay — the whole point of redeeming them. */}
                  <Figure
                    label="Total pts worth"
                    value={formatMoney(shownTotals.pointsValue, currency)}
                    tone=""
                    style={{ color: "var(--viz-savings)" }}
                  />
                </div>
              </div>

              {/* Desktop: the sheet's own columns, in the sheet's own order.
                  Annual fee, Year and Card owner are the three the app doesn't
                  carry — everything else is here, left to right, as typed. */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[1180px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                      <SortTh label="Reservation made" col="reservedOn" sort={sort} onSort={sortBy} nowrap />
                      <SortTh label="Check in date" col="checkIn" sort={sort} onSort={sortBy} nowrap />
                      <SortTh label="Hotel name" col="propertyName" sort={sort} onSort={sortBy} />
                      <SortTh label="Points used" col="pointsCost" sort={sort} onSort={sortBy} />
                      <SortTh label="Cash value" col="pointsValue" sort={sort} onSort={sortBy} />
                      <SortTh label="Hotel credit" col="hotelCredit" sort={sort} onSort={sortBy} />
                      <SortTh label="Hotel cost" col="hotelCost" sort={sort} onSort={sortBy} />
                      <SortTh label="Pocket cost" col="pocketCost" sort={sort} onSort={sortBy} />
                      <SortTh label="City" col="city" sort={sort} onSort={sortBy} align="left" />
                      <SortTh label="Total nights" col="nights" sort={sort} onSort={sortBy} nowrap />
                      <SortTh label="Brand" col="brand" sort={sort} onSort={sortBy} align="left" />
                      <SortTh label="CC info" col="cardLabel" sort={sort} onSort={sortBy} align="left" />
                      <SortTh label="Total pax" col="pax" sort={sort} onSort={sortBy} nowrap />
                      <SortTh label="Remarks" col="remarks" sort={sort} onSort={sortBy} align="left" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => setEditing(s)}
                        className={`cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ${s.cancelledAt ? "opacity-55" : ""}`}
                      >
                        <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-muted">{sheetDate(s.reservedOn)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums">{sheetDate(s.checkIn)}</td>
                        {/* Two lines at most: a long property name was pushing
                            rows to three, which broke the row rhythm. */}
                        <td className="max-w-[220px] px-2 py-2 text-left">
                          <span className={`line-clamp-2 ${s.cancelledAt ? "line-through" : ""}`}>
                            {s.propertyName}
                          </span>
                          {s.cancelledAt ? (
                            <span className="ml-1.5 rounded bg-black/5 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted dark:bg-white/10">
                              Cancelled
                            </span>
                          ) : null}
                        </td>
                        {/* Grey and bracketed when the points were never spent:
                            the figure is what the room would have cost on
                            points, kept beside what it actually cost in cash. */}
                        <td
                          className={`px-2 py-2 text-center tabular-nums ${s.pointsCost > 0 && s.pointsUsed ? "" : "text-muted"}`}
                          style={s.pointsCost > 0 && s.pointsUsed ? { color: "var(--viz-savings)" } : undefined}
                        >
                          {s.pointsCost > 0
                            ? s.pointsUsed
                              ? s.pointsCost.toLocaleString()
                              : `(${s.pointsCost.toLocaleString()})`
                            : DASH}
                          {s.freeNightUsed ? (
                            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--viz-bills)" }}>
                              Free night
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-center tabular-nums text-muted">
                          {(() => {
                            const v = cashValue(s);
                            return <span className={v.derived ? "italic opacity-70" : ""}>{v.text}</span>;
                          })()}
                        </td>
                        <td
                          className={`px-2 py-2 text-center tabular-nums ${s.hotelCreditCents > 0 ? "" : "text-muted"}`}
                          style={s.hotelCreditCents > 0 ? { color: "var(--viz-bills)" } : undefined}
                        >
                          {money(s.hotelCreditCents, currency)}
                        </td>
                        <td className={`px-2 py-2 text-center tabular-nums ${s.hotelCostCents > 0 ? "" : "text-muted"}`}>
                          {money(s.hotelCostCents, currency)}
                        </td>
                        {/* Column H: the amount when he paid, and otherwise the
                            word for what covered it — "Pts", never "$0.00". */}
                        <td className="px-2 py-2 text-center tabular-nums text-negative">
                          {s.pocketCostCents > 0 ? (
                            formatMoney(s.pocketCostCents, currency)
                          ) : (
                            <span className="text-[11px] font-semibold text-muted">{coveredBy(s)}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-left text-muted">{s.city ?? DASH}</td>
                        <td className="px-2 py-2 text-center tabular-nums">{s.nights}</td>
                        <td className="px-2 py-2 text-left">{s.brand ?? DASH}</td>
                        <td className="px-2 py-2 text-left text-xs text-muted">
                          {(s.accountId ? cardName.get(s.accountId) : null) ?? s.cardLabel ?? DASH}
                        </td>
                        <td className={`px-2 py-2 text-center tabular-nums ${s.pax ? "" : "text-muted"}`}>
                          {s.pax ?? DASH}
                        </td>
                        {/* Free text, so it gets the leftover width and clamps at
                            two lines rather than stretching the row. */}
                        <td className="max-w-[220px] px-2 py-2 text-left text-xs text-muted">
                          <span className="line-clamp-2">{s.remarks || DASH}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: one card per stay — 13 columns can't be read at 375px.
                  Same fields, same order, wrapped instead of scrolled. */}
              <ul className="divide-y divide-line sm:hidden">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className={`w-full px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ${s.cancelledAt ? "opacity-55" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 text-sm font-semibold">
                          <span className={s.cancelledAt ? "line-through" : ""}>{s.propertyName}</span>
                          {s.cancelledAt ? (
                            <span className="ml-1.5 rounded bg-black/5 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted dark:bg-white/10">
                              Cancelled
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-negative">
                          {s.pocketCostCents > 0 ? (
                            formatMoney(s.pocketCostCents, currency)
                          ) : (
                            <span className="text-xs text-muted">{coveredBy(s)}</span>
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                        <span className="tabular-nums">{sheetDate(s.checkIn)}</span>
                        <span className="tabular-nums">{s.nights}n</span>
                        {s.city ? <span>{s.city}</span> : null}
                        {s.brand ? <span>{s.brand}</span> : null}
                        {s.cardLabel ? <span>{s.cardLabel}</span> : null}
                        {s.pax ? <span className="tabular-nums">{s.pax} pax</span> : null}
                      </div>
                      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                        <span>
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">
                            {s.pointsCost > 0 && !s.pointsUsed ? "Pts if used" : "Points used"}
                          </span>
                          <span
                            className={`tabular-nums font-semibold ${s.pointsUsed ? "" : "text-muted"}`}
                            style={s.pointsCost > 0 && s.pointsUsed ? { color: "var(--viz-savings)" } : undefined}
                          >
                            {s.pointsCost > 0 ? s.pointsCost.toLocaleString() : "—"}
                          </span>
                          {s.freeNightUsed ? (
                            <span className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--viz-bills)" }}>
                              Free night
                            </span>
                          ) : null}
                        </span>
                        <span>
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">Hotel credit</span>
                          <span className="tabular-nums font-semibold" style={{ color: "var(--viz-bills)" }}>
                            {s.hotelCreditCents > 0 ? formatMoney(s.hotelCreditCents, currency) : "—"}
                          </span>
                        </span>
                        <span>
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">Hotel cost</span>
                          <span className="tabular-nums font-semibold">
                            {s.hotelCostCents > 0 ? formatMoney(s.hotelCostCents, currency) : "—"}
                          </span>
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted">No stays match these filters.</p>
              ) : null}
    </>
  );

  return (
    <div className="space-y-3">
      <header className="rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
        {/* The actions sit next to the title rather than pinned to the far
             right — on a wide screen that put the primary button an entire
             page away from what it acts on. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-bold sm:text-xl">Travel Log</h1>
          <div className="flex flex-wrap items-center gap-2">
            {/* Only worth showing while something still needs linking — with
                every label pointed at a card there's nothing for it to fix, so
                it stays out of the way until a new unlinked stay appears. */}
            {unlinked > 0 ? (
              <button
                type="button"
                onClick={() => setLinking(true)}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                Link cards
                <span className="ml-1.5 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] tabular-nums text-muted dark:bg-white/10">
                  {unlinked} unlinked
                </span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong"
            >
              Add
            </button>
          </div>
        </div>

      </header>

      {stays.length === 0 ? (
        <section className="rounded-xl bg-surface px-4 py-10 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-sm font-semibold">No stays logged yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            Add a reservation and the log tracks the points it cost, the hotel cost you avoided, and what you saved. Points spent on a card come straight off that card&apos;s balance.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong"
          >
            Add your first stay
          </button>
        </section>
      ) : (
        <CreditCardRewardsProvider
          accounts={rewards.cards}
          currency={currency}
          nonCardAccounts={rewards.nonCardAccounts}
          allBuckets={rewards.allBuckets}
          travelBrands={rewards.travelBrands}
        >
          {/* ---- Travel & Credit Card Rewards: the points that pay for the
               stays below. Moved here from /accounts — Accounts keeps the
               plain card list and the Pay Card flow. */}
          <CreditCardSections />

          {/* ---- What's still ahead. Sits above the archive because a booking
               you haven't taken yet is the thing you come here to check. */}
          {upcoming.length + upcomingFlights.length + upcomingCars.length > 0 ? (
            <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              {/* One card, one group per kind of booking — each group names
                  what it holds instead of a single "Coming up". */}
              {upcoming.length > 0 ? (
                <UpcomingHeader
                  title="Hotel Reservations"
                  count={upcoming.length}
                  open={isUpcomingOpen("hotels")}
                  onToggle={() => toggleUpcoming("hotels")}
                />
              ) : null}
              <ul className="divide-y divide-line">
                {(isUpcomingOpen("hotels") ? upcoming : []).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:flex-nowrap sm:px-6"
                    >
                      {/* Two lines, not one. Sharing a line with the trip
                          details left the name a `truncate` box ~30px wide
                          next to a shrink-0 detail run — "Hotel Babylon
                          Royal" rendered as "Hot…". The name owns its line
                          and the details sit under it, the way the mobile
                          card already reads. */}
                      <span className="flex min-w-0 flex-1 flex-col gap-y-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{s.propertyName}</span>
                          {/* Same chip as the card panel's "Owner:" / "Bank:". */}
                          {s.brand ? (
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              Booked Thru: <span className="text-slate-700 dark:text-slate-200">{s.brand}</span>
                            </span>
                          ) : null}
                        </span>
                        <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
                          <span className="tabular-nums">{sheetDate(s.checkIn)}</span>
                          <span className="tabular-nums">{s.nights}n</span>
                          {s.city ? <span>{s.city}</span> : null}
                          {s.pax ? <span className="tabular-nums">{s.pax} pax</span> : null}
                        </span>
                      </span>
                      {/* At 375px these wrap under the name; at sm+ they hold
                          the right-hand end of the single line. */}
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
                        <Figure
                          label="Days away"
                          value={String(daysUntil(today, s.checkIn))}
                          tone=""
                          style={{ color: "var(--viz-savings)" }}
                        />
                        <Figure
                          label="Hotel cost"
                          value={s.hotelCostCents > 0 ? formatMoney(s.hotelCostCents, currency) : DASH}
                          tone=""
                        />
                        <Figure
                          label="Pocket cost"
                          value={
                            s.pocketCostCents > 0
                              ? formatMoney(s.pocketCostCents, currency)
                              : coveredBy(s)
                          }
                          tone={s.pocketCostCents > 0 ? "text-negative" : "text-muted"}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {upcomingFlights.length > 0 ? (
                <>
                  <UpcomingHeader
                    title="Flight Reservations"
                    count={upcomingFlights.length}
                    divided={upcoming.length > 0}
                    open={isUpcomingOpen("flights")}
                    onToggle={() => toggleUpcoming("flights")}
                  />
                  <ul className="divide-y divide-line">
                    {(isUpcomingOpen("flights") ? upcomingFlights : []).map(({ flight: f, next }) => {
                      const stops: string[] = [];
                      for (const leg of f.legs) {
                        if (leg.fromPlace && stops[stops.length - 1] !== leg.fromPlace) stops.push(leg.fromPlace);
                        if (leg.toPlace) stops.push(leg.toPlace);
                      }
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => setEditingFlight(f)}
                            className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:flex-nowrap sm:px-6"
                          >
                            <span className="flex min-w-0 flex-1 basis-full flex-col gap-y-0.5 sm:basis-0">
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="truncate text-sm font-semibold">{stops.join(" → ") || f.airline}</span>
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  {f.airline}
                                  {f.bookingCode ? <span className="text-slate-700 dark:text-slate-200"> · {f.bookingCode}</span> : null}
                                </span>
                              </span>
                              {/* The next flight: its date, number, time and route. */}
                              <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
                                <span className="tabular-nums">{sheetDate(next.flightOn)}</span>
                                {next.flightNumber ? <span>{next.flightNumber}</span> : null}
                                {next.departsAt ? <span className="tabular-nums">{next.departsAt}</span> : null}
                                {next.fromPlace && next.toPlace ? <span>{next.fromPlace} → {next.toPlace}</span> : null}
                                <span className="tabular-nums">{f.passengers.length} pax</span>
                              </span>
                            </span>
                            <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
                              <Figure label="Days away" value={String(daysUntil(today, next.flightOn))} tone="" style={{ color: "var(--viz-savings)" }} />
                              <Figure label="Flight cost" value={f.flightCostCents > 0 ? formatMoney(f.flightCostCents, currency) : DASH} tone="" />
                              <Figure
                                label="Pocket cost"
                                value={f.pocketCostCents > 0 ? formatMoney(f.pocketCostCents, currency) : f.pointsUsed ? "Points" : DASH}
                                tone={f.pocketCostCents > 0 ? "text-negative" : "text-muted"}
                              />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}

              {upcomingCars.length > 0 ? (
                <>
                  <UpcomingHeader
                    title="Rental Reservations"
                    count={upcomingCars.length}
                    divided={upcoming.length + upcomingFlights.length > 0}
                    open={isUpcomingOpen("cars")}
                    onToggle={() => toggleUpcoming("cars")}
                  />
                  <ul className="divide-y divide-line">
                    {(isUpcomingOpen("cars") ? upcomingCars : []).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setEditingCar(c)}
                          className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:flex-nowrap sm:px-6"
                        >
                          <span className="flex min-w-0 flex-1 basis-full flex-col gap-y-0.5 sm:basis-0">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-sm font-semibold">{c.company ?? "Car rental"}</span>
                              {c.bookingCode ? (
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  Booking: <span className="text-slate-700 dark:text-slate-200">{c.bookingCode}</span>
                                </span>
                              ) : null}
                            </span>
                            <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
                              <span className="tabular-nums">
                                {sheetDate(c.pickupOn)}
                                {c.returnOn && c.returnOn !== c.pickupOn ? ` – ${sheetDate(c.returnOn)}` : ""}
                              </span>
                              {c.pickupPlace ? <span>{c.pickupPlace}</span> : null}
                            </span>
                          </span>
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
                            {/* Already picked up: nothing left to count down. */}
                            <Figure
                              label="Days away"
                              value={c.pickupOn >= today ? String(daysUntil(today, c.pickupOn)) : "Out now"}
                              tone=""
                              style={{ color: "var(--viz-savings)" }}
                            />
                            <Figure label="Rental cost" value={c.costCents > 0 ? formatMoney(c.costCents, currency) : DASH} tone="" />
                            <Figure
                              label="Pocket cost"
                              value={c.pocketCostCents > 0 ? formatMoney(c.pocketCostCents, currency) : c.pointsUsed ? "Points" : DASH}
                              tone={c.pocketCostCents > 0 ? "text-negative" : "text-muted"}
                            />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}

          {trips.length > 0 ? (
            <TripLogPanel summaries={tripSummaries} currency={currency} onOpenTrip={setOpenTripId} />
          ) : null}

          {/* ---- The reservations themselves, with the filters that drive them
               and what the current selection adds up to. The same body is
               rendered twice: inline in the page column, and — on a wide
               screen — inside a popup that is not boxed in by the sidebar.
               The sheet's 14 columns need ~1275px and the page column gives
               them 780, so six of them (City, Brand, CC info, Pax, Nights,
               Remarks) were only reachable by scrolling the table sideways.
               The popup is where they actually fit; no column was dropped to
               make the inline view work. */}
          <Panel
            title="Hotel Reservations Log"
            meta={
              <HeaderTotals
                countLabel="Total hotels"
                count={filtered.length}
                spent={shownTotals.pocket}
                saved={shownTotals.saved}
                currency={currency}
              />
            }
            control={
              <span className="flex items-center gap-2">
              {yearSelect}
              {/* Desktop only: on a phone the list below is already a card per
                  stay, so there are no hidden columns for a popup to reveal. */}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="hidden items-center gap-1.5 rounded-md border border-black/25 bg-background px-2 py-1 text-[11px] font-semibold transition hover:bg-black/5 sm:inline-flex dark:border-white/30 dark:hover:bg-white/10"
              >
                Open full width
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                >
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
              </span>
            }
            open={openList}
            onToggle={() => setOpenList((v) => !v)}
          >
            {reservations}
          </Panel>

          {flights.length + carList.length > 0 ? (
            <TransportLogPanel
              flights={flights}
              cars={carList}
              currency={currency}
              onEditFlight={setEditingFlight}
              onEditCar={setEditingCar}
            />
          ) : null}


          {/* ---- The points ledger behind the bookings above. */}
          <RewardsPointsLog />

          {/* ---- The two charts side by side. They are drawn narrow by
               design, so half a row suits them; the summary tables below are
               not, which is why they no longer share this grid. */}
          <section className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
                <h2 className="text-center text-sm font-bold">Hotel cost vs pocket cost</h2>
                <p className="mb-3 text-center text-[11px] text-muted">{chartScope}</p>
                <CostBars years={yearPoints} currency={currency} selected={year === ALL ? undefined : year} />
              </div>
              <div className="rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
                <h2 className="text-center text-sm font-bold">Total saved per year</h2>
                <p className="mb-3 text-center text-[11px] text-muted">{chartScope}</p>
                <SavedLine years={yearPoints} currency={currency} selected={year === ALL ? undefined : year} />
              </div>
          </section>

          {/* ---- Year-over-year rollup: the sheet's summary block. Full
               width, not half: six columns in a half-row put Total saved —
               the figure the whole table exists for — off the right edge
               behind a sideways scroll. */}
          <Panel
            title="Total Cost Saved by Year"
            meta={
              <HeaderTotals
                countLabel="Total years"
                count={byYear.length}
                spent={allTotals.spent}
                saved={allTotals.saved}
                currency={currency}
              />
            }
            open={openYears}
            onToggle={() => setOpenYears((v) => !v)}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="sticky left-0 z-10 bg-surface px-2 py-2 text-center font-semibold">Year</th>
                    <th className="px-2 py-2 text-center font-semibold">Total stays</th>
                    <th className="px-2 py-2 text-center font-semibold">Total pts used</th>
                    <th className="px-2 py-2 text-center font-semibold">Total hotel cost</th>
                    <th className="px-2 py-2 text-center font-semibold">Total pocket cost</th>
                    <th className="px-2 py-2 text-center font-semibold">Total saved</th>
                  </tr>
                </thead>
                <tbody>
                  {byYear.map(([y, row]) => (
                    <tr
                      key={y}
                      className={`border-b border-line/60 last:border-0 ${year === y ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""}`}
                    >
                      <td
                        className="sticky left-0 z-10 px-2 py-2 text-center font-semibold tabular-nums"
                        style={{
                          backgroundColor: year === y ? "var(--viz-sel)" : "var(--surface)",
                        }}
                      >
                        {y}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums text-muted">{row.stays}</td>
                      <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {row.points > 0 ? row.points.toLocaleString() : DASH}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums">{formatMoney(row.hotel, currency)}</td>
                      <td className="px-2 py-2 text-center tabular-nums text-negative">{formatMoney(row.pocket, currency)}</td>
                      <td className="px-2 py-2 text-center font-bold tabular-nums text-positive">
                        {formatMoney(row.hotel - row.pocket, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ---- The two "who did we stay with" tallies: the same money cut
               by hotel brand and by the card that paid. Stacked full width
               rather than side by side — five money columns need ~560px, and
               half a row gave them 383, hiding Total saved behind a
               horizontal scroll on desktop as well as on a phone. */}
          {/* ---- Stays by brand: the sheet's right-hand tally. */}
          <Panel
            title="Total Stays by Brand"
            meta={
              <HeaderTotals
                countLabel="Total brands"
                count={brandTally.length}
                spent={tallyTotals.spent}
                saved={tallyTotals.saved}
                currency={currency}
              />
            }
            control={tallyPeriod}
            open={openBrands}
            onToggle={() => setOpenBrands((v) => !v)}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm sm:min-w-0">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    {/* Pinned: on a phone these five columns still need a
                        sideways swipe, and without an anchor you arrive at
                        Total saved with no idea whose row you are reading. */}
                    <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-center font-semibold">Brand</th>
                    <th className="px-3 py-2 text-center font-semibold">Stays</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center font-semibold">Total Pts Used</th>
                    <th className="px-3 py-2 text-center font-semibold">Total spent</th>
                    <th className="px-3 py-2 text-center font-semibold">Total saved</th>
                  </tr>
                </thead>
                <tbody>
                  {brandTally.map(([b, row]) => (
                    <tr key={b} className="border-b border-line/60 last:border-0">
                      <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold">{b}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{row.stays}</td>
                      <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {row.points > 0 ? row.points.toLocaleString() : <span className="text-muted">{DASH}</span>}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-negative">
                        {formatMoney(row.spent, currency)}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums text-positive">
                        {formatMoney(row.saved, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ---- Stays by card: what each card in Accounts has returned. */}
          <Panel
            title="Total Stays by Rewards Card"
            meta={
              <HeaderTotals
                countLabel="Total cards"
                count={cardTally.length}
                spent={tallyTotals.spent}
                saved={tallyTotals.saved}
                currency={currency}
              />
            }
            open={openCards}
            onToggle={() => setOpenCards((v) => !v)}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm sm:min-w-0">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="sticky left-0 z-10 bg-surface px-2 py-2 text-center font-semibold">Card</th>
                    <th className="px-2 py-2 text-center font-semibold">Stays</th>
                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Total Pts Used</th>
                    <th className="px-2 py-2 text-center font-semibold">Total spent</th>
                    <th className="px-2 py-2 text-center font-semibold">Total saved</th>
                  </tr>
                </thead>
                <tbody>
                  {cardTally.map(([name, row]) => (
                    <tr key={name} className="border-b border-line/60 last:border-0">
                      {/* One line, even on a phone: the table already scrolls
                          sideways, and wrapping broke "1002 Hilton Aspire Amex
                          V" into four stacked words per row. */}
                      <td className={`sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-2 text-left font-semibold ${name === "Not linked" ? "text-muted" : ""}`}>
                        {name}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums">{row.stays}</td>
                      <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {row.points > 0 ? row.points.toLocaleString() : <span className="text-muted">{DASH}</span>}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums text-negative">
                        {formatMoney(row.spent, currency)}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold tabular-nums text-positive">
                        {formatMoney(row.saved, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

        </CreditCardRewardsProvider>
      )}

      {/* The log at full width. `max-w-[96vw]` rather than one of the shared
          max-w-* caps: the table needs ~1275px and a 5xl panel (1024) would
          still hide the last columns on a laptop. */}
      {expanded ? (
        <ModalShell
          title="Hotel Reservations Log"
          onClose={() => setExpanded(false)}
          className="sm:max-w-[96vw]"
          headerExtra={
            <HeaderTotals
              countLabel="Total hotels"
                count={filtered.length}
              spent={shownTotals.pocket}
              saved={shownTotals.saved}
              currency={currency}
            />
          }
        >
          <div className="flex justify-end border-b border-line px-4 py-2 sm:px-6">{yearSelect}</div>
          {reservations}
        </ModalShell>
      ) : null}

      {linking ? (
        <CardLinkModal rows={cardLabels} cards={cards} onClose={() => setLinking(false)} />
      ) : null}

      {openTrip ? (
        <TripDetailModal
          summary={openTrip}
          currency={currency}
          onEditBooking={(b) =>
            b.kind === "flight" ? setEditingFlight(b.flight) : b.kind === "stay" ? setEditing(b.stay) : setEditingCar(b.car)
          }
          onAddBooking={() => {
            setAddTripId(openTrip.trip.id);
            if (addKind === "misc") setAddKind("stay");
            setAdding(true);
          }}
          onEditSpending={() => {
            setAddTripId(openTrip.trip.id);
            setAddKind("misc");
            setAdding(true);
          }}
          onClose={() => setOpenTripId(null)}
        />
      ) : null}
      {adding && addKind === "misc" ? (
        <MiscModal
          // Remounted per trip so opening another trip's spending starts fresh.
          key={addTripId ?? "new"}
          trips={trips}
          expenses={expenses}
          cards={cards}
          currency={currency}
          defaultTripId={addTripId}
          kindSwitch={<KindSwitch value={addKind} onChange={setAddKind} />}
          onClose={closeForms}
        />
      ) : null}
      {editing || (adding && addKind === "stay") ? (
        <StayModal
          stay={editing}
          cards={cards}
          brands={brandList}
          currency={currency}
          trips={trips}
          defaultTripId={addTripId}
          kindSwitch={editing ? undefined : <KindSwitch value={addKind} onChange={setAddKind} />}
          onClose={closeForms}
        />
      ) : null}
      {editingFlight || (adding && addKind === "flight") ? (
        <FlightModal
          flight={editingFlight}
          cards={cards}
          travellers={travellers}
          trips={trips}
          defaultTripId={addTripId}
          currency={currency}
          kindSwitch={editingFlight ? undefined : <KindSwitch value={addKind} onChange={setAddKind} />}
          onClose={closeForms}
        />
      ) : null}
      {editingCar || (adding && addKind === "car") ? (
        <CarModal
          car={editingCar}
          cards={cards}
          trips={trips}
          defaultTripId={addTripId}
          currency={currency}
          kindSwitch={editingCar ? undefined : <KindSwitch value={addKind} onChange={setAddKind} />}
          onClose={closeForms}
        />
      ) : null}
    </div>
  );
}

// The heading over one group in the upcoming card: what the group holds, and
// how many of them are still ahead. The whole line folds its group away.
function UpcomingHeader({
  title,
  count,
  divided,
  open,
  onToggle,
}: {
  title: string;
  count: number;
  divided?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-line px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:px-6 ${open ? "border-b" : ""} ${divided ? "border-t" : ""}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 7.5 10 12.5 15 7.5" />
      </svg>
      <h2 className="text-sm font-bold">{title}</h2>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Future bookings:</span>
        <span className="text-sm font-bold tabular-nums">{count}</span>
      </span>
    </button>
  );
}

// A card whose body folds away. The header stays put so a collapsed section
// still says what it holds and how much of it there is.
function Panel({
  title,
  meta,
  control,
  open,
  onToggle,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  /** A control that belongs on the header line. It sits beside the collapse
      button rather than inside it — a select nested in a button can't be
      opened, and the whole header is the collapse target. */
  control?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className={`flex items-center ${open ? "border-b border-line" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:px-6 ${control ? "pr-2" : ""}`}
      >
        <span className="flex items-center gap-2">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
          <span className="text-sm font-bold">{title}</span>
        </span>
        {meta ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">{meta}</span>
        ) : null}
      </button>
      {control ? <div className="shrink-0 pr-4 sm:pr-6">{control}</div> : null}
      </div>
      {open ? children : null}
    </section>
  );
}

// The right-hand side of a panel header: how many rows it holds, then the two
// figures that matter, each spelled out. Same label/value pairing the totals
// strip uses, so a collapsed panel and an open one read the same way.
// A column header that sorts. The caret only shows on the active column, so
// the row doesn't turn into a wall of arrows.
function SortTh({
  label,
  col,
  sort,
  onSort,
  nowrap,
  // Text columns read left-aligned: centring them leaves a ragged gap on both
  // sides of every cell and pushes the neighbouring columns apart.
  align = "center",
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  nowrap?: boolean;
  align?: "center" | "left";
}) {
  const active = sort.key === col;
  return (
    <th className={`px-2 py-2 font-semibold ${nowrap ? "whitespace-nowrap" : ""} ${align === "left" ? "text-left" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`${align === "left" ? "mr-auto" : "mx-auto"} flex items-center gap-1 uppercase tracking-wide transition hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active ? <span aria-hidden>{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function HeaderTotals({
  countLabel,
  count,
  spent,
  saved,
  currency,
}: {
  countLabel: string;
  count: number;
  spent: number;
  saved: number;
  currency: string;
}) {
  return (
    <>
      <Figure label={countLabel} value={String(count)} tone="" />
      <Figure label="Total spent" value={formatMoney(spent, currency)} tone="text-negative" />
      <Figure label="Total saved" value={formatMoney(saved, currency)} tone="text-positive" />
    </>
  );
}

function Figure({
  label,
  value,
  tone,
  style,
}: {
  label: string;
  value: string;
  tone: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}:</span>
      <span className={`text-sm font-bold tabular-nums ${tone}`} style={style}>{value}</span>
    </span>
  );
}


"use client";

import { YearPicker, inYears, thisAndFutureYears, useSessionYears, yearsListLabel } from "./year-picker";
import { SearchBox } from "./search-box";
import { useMemo, useState } from "react";
import { formatMoneyWhole } from "@/lib/money";
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
import { sheetDateRange, summarizeTrips } from "./trip-summary";
import { formatCentsPerPoint, redemptionsByCard } from "./points-value";
import { AddTravelLogModal } from "./add-travel-log-modal";
import { EditTripPicker } from "./edit-trip-picker";
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

// The three "what's still ahead" buttons in the page header, each opening its
// own full-width popup. A kind with nothing ahead of it shows no button.
const UPCOMING_BUTTONS: { key: "hotels" | "flights" | "cars"; label: string }[] = [
  { key: "hotels", label: "Hotel Reservations" },
  { key: "flights", label: "Flight Reservations" },
  { key: "cars", label: "Rental Reservations" },
];

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
  return cents > 0 ? formatMoneyWhole(cents, currency) : DASH;
}

// Whole days between two ISO dates — both are plain dates, so no clocks or
// time zones come into it.
function daysUntil(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

// Column E: what a point was worth on this stay, in cents like every other
// per-point figure on the page ("0.6¢", not "$0.006"). A rate
// worked out from the hotel cost (rather than typed into the sheet) is shown
// in muted type, so a calculated cell is never mistaken for a recorded one.
function cashValue(stay: TravelStay): { text: string; derived: boolean } {
  const micros = effectivePointsValueMicros(stay);
  if (!micros) return { text: DASH, derived: false };
  return {
    text: formatCentsPerPoint(micros / 10_000),
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
  // Years ticked in the log's picker; none ticked means every year.
  // Opens on this year plus any later year with a booking; every year (none
  // ticked) when neither has a stay.
  const [year, setYear, yearRestored] = useSessionYears("travel-reservations-log-years", () => {
    const current = today.slice(0, 4);
    const stayYears = stays.map(stayYear);
    return stayYears.some((y) => y >= current) ? thisAndFutureYears(stayYears, current) : [];
  });
  // The charts wash the years the Hotel Log is filtered to — but only once
  // that filter is something the user chose. The default pick (this year plus
  // future bookings) used to arrive pre-washed, which read as "you have 2026
  // and 2027 selected" on a page nobody had touched yet.
  const [yearPicked, setYearPicked] = useState(false);
  const pickYear = (ys: string[]) => {
    setYearPicked(true);
    setYear(ys);
  };
  const [brand, setBrand] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  // Clicking a year on either chart opens the Hotel Log full width on that
  // year's stays — the rows behind the bar. Other filters are cleared so the
  // popup lists exactly what the chart added up.
  const openLogForYear = (y: string) => {
    pickYear([y]);
    setBrand(ALL);
    setQuery("");
    setExpanded(true);
  };
  const [bfastOnly, setBfastOnly] = useState(false);
  const [ptsOnly, setPtsOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "checkIn",
    dir: "desc",
  });
  // One period for the two side-by-side tallies (brand and card): they answer
  // the same question two ways, so reading them against different years was
  // never what was wanted. Independent of the Reservations filter above them.
  // Both tallies open on this year plus any later year with a booking.
  const [tallyYear, setTallyYear] = useSessionYears("travel-brand-tally-years", () =>
    thisAndFutureYears(stays.map(stayYear), today.slice(0, 4)),
  );
  const [cardYear, setCardYear] = useSessionYears("travel-card-tally-years", () =>
    thisAndFutureYears(stays.map(stayYear), today.slice(0, 4)),
  );
  // The log starts collapsed on a fresh login — it's the longest section on
  // the page — but sessionStorage carries whatever you last set for as long as
  // you're still moving around the app.
  const [listState, setListState] = useSessionCollapse("travel-reservations-log", () => ({ open: false }));
  const openList = !!listState.open;
  const setOpenList = (fn: (v: boolean) => boolean) =>
    setListState((s) => ({ open: fn(!!s.open) }));
  // The reservations log opened in a popup, where the sheet's full column set
  // has room. Desktop only — see the button in the panel header.
  const [expanded, setExpanded] = useState(false);
  const [expandedTally, setExpandedTally] = useState<"brands" | "cards" | null>(null);
  const [expandedUpcoming, setExpandedUpcoming] = useState<"hotels" | "flights" | "cars" | null>(null);
  const [editing, setEditing] = useState<TravelStay | null>(null);
  const [adding, setAdding] = useState(false);
  // A trip row's "edit spending" opens the Misc form on its own, not the
  // whole Add Travel Log popup.
  const [spendingOnly, setSpendingOnly] = useState(false);
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
  // Award bookings added up per card, for the rewards board's realized
  // cents-per-point. Every booking in the household, not the filtered year —
  // a rate is only worth reading over the whole history.
  const redemptions = useMemo(
    () => redemptionsByCard(stays, flights, carList),
    [stays, flights, carList],
  );
  // Airlines already on a saved flight, one spelling each, for the flight
  // form's suggestions.
  const airlines = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const f of flights) {
      const name = f.airline?.trim();
      if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [flights]);
  const openTrip = tripSummaries.find((t) => t.trip.id === openTripId) ?? null;
  const closeForms = () => {
    setAdding(false);
    setSpendingOnly(false);
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
      if (!inYears(year, stayYear(s))) return false;
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
    () => {
      // This year is still running and later ones hold only what's booked so
      // far, so neither figure is a year's result yet. The charts draw those
      // marks hollow instead of letting next spring's $0 read as a collapse.
      const thisYear = today.slice(0, 4);
      return byYear.map(([year, row]) => ({
        year,
        hotel: row.hotel,
        pocket: row.pocket,
        stays: row.stays,
        partial: year >= thisYear,
      }));
    },
    [byYear, today],
  );

  // Everything still ahead of you, soonest first. This is the one part of the
  // log that answers "what's next" rather than "what happened". Every upcoming
  // booking is listed, so the header count matches the rows under it.
  const upcoming = useMemo(
    () =>
      live
        .filter((s) => s.checkIn >= today)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn)),
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
        .sort((a, b) => a.next.flightOn.localeCompare(b.next.flightOn)),
    [flights, today],
  );
  // Rentals still to pick up or still out. Drives in the family car are not
  // reservations, so they stay in the Cars Log only.
  const upcomingCars = useMemo(
    () =>
      carList
        .filter((c) => !c.cancelledAt && c.kind === "rental" && (c.returnOn ?? c.pickupOn) >= today)
        .sort((a, b) => a.pickupOn.localeCompare(b.pickupOn)),
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
    () => live.filter((s) => inYears(tallyYear, stayYear(s))),
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
  // The card tally has its own year, so brand and card can be read for
  // different years side by side.
  const cardStays = useMemo(
    () => live.filter((s) => inYears(cardYear, stayYear(s))),
    [live, cardYear],
  );
  const cardTotals = useMemo(() => {
    let spent = 0, saved = 0;
    for (const s of cardStays) {
      spent += s.pocketCostCents;
      saved += savedCents(s);
    }
    return { spent, saved };
  }, [cardStays]);
  const tallyPeriod = (value: string[], onChange: (v: string[]) => void, label: string) => (
    <YearPicker years={years} value={value} onChange={onChange} label={label} />
  );

  // What each real card has actually done for you — only answerable once the
  // labels are linked, which is what the Link cards button is for.
  const cardTally = useMemo(() => {
    const map = new Map<string, { stays: number; spent: number; saved: number; points: number }>();
    for (const s of cardStays) {
      const key = (s.accountId ? cardName.get(s.accountId) : null) ?? "Not linked";
      const row = map.get(key) ?? { stays: 0, spent: 0, saved: 0, points: 0 };
      row.stays += 1;
      row.spent += s.pocketCostCents;
      row.saved += savedCents(s);
      row.points += spentPoints(s);
      map.set(key, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].stays - a[1].stays || a[0].localeCompare(b[0]));
  }, [cardStays, cardName]);
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
    <YearPicker years={years} value={year} onChange={pickYear} label="Hotel Log year" />
  );

  const reservations = (
    <>
              {/* Filters, then the figures the header doesn't carry right after
                  them — spent and saved live in the header, so they are not
                  repeated here. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <SearchBox value={query} onChange={setQuery} placeholder="Search hotel, city…" label="Search hotels" className="w-52" />
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
                      className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value={ALL}>All brands</option>
                      {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {/* Mobile has cards, not column headers, so it needs its own
                      way to reorder them. */}
                  <select
                    value={`${sort.key}:${sort.dir}`}
                    onChange={(e) => {
                      const [key, dir] = e.target.value.split(":");
                      setSort({ key: key as SortKey, dir: dir as "asc" | "desc" });
                    }}
                    className="self-center rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500 sm:hidden"
                  >
                    <option value="checkIn:desc">Newest check-in</option>
                    <option value="checkIn:asc">Oldest check-in</option>
                    <option value="hotelCost:desc">Highest hotel cost</option>
                    <option value="pocketCost:desc">Highest pocket cost</option>
                    <option value="pointsCost:desc">Most points</option>
                    <option value="propertyName:asc">Hotel name A–Z</option>
                  </select>
                  {/* The night count opens the run of totals: it says what the
                      money figures beside it are counting. Built as a Figure so
                      it shares their label/value shape and sits on their
                      baseline instead of floating out of line. */}
                  <Figure
                    label={`Total in ${yearsListLabel(year)}`}
                    value={`${shownTotals.nights} Night${shownTotals.nights === 1 ? "" : "s"}${
                      shownTotals.cancelled ? ` · ${shownTotals.cancelled} cancelled` : ""
                    }`}
                    tone=""
                  />
                  <Figure label="Total hotel cost" value={formatMoneyWhole(shownTotals.hotel, currency)} tone="" />
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
                    value={formatMoneyWhole(shownTotals.pointsValue, currency)}
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
                      <SortTh label="Value per pt" col="pointsValue" sort={sort} onSort={sortBy} />
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
                          {s.isEstimate ? (
                            <span className="ml-1.5 rounded bg-black/5 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted dark:bg-white/10">
                              Planned
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
                            formatMoneyWhole(s.pocketCostCents, currency)
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
                          {s.isEstimate ? (
                            <span className="ml-1.5 rounded bg-black/5 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted dark:bg-white/10">
                              Planned
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-negative">
                          {s.pocketCostCents > 0 ? (
                            formatMoneyWhole(s.pocketCostCents, currency)
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
                            {s.hotelCreditCents > 0 ? formatMoneyWhole(s.hotelCreditCents, currency) : "—"}
                          </span>
                        </span>
                        <span>
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">Hotel cost</span>
                          <span className="tabular-nums font-semibold">
                            {s.hotelCostCents > 0 ? formatMoneyWhole(s.hotelCostCents, currency) : "—"}
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

  // The upcoming-booking lists, shared by each card and its full-width popup.
  const upcomingCounts = {
    hotels: upcoming.length,
    flights: upcomingFlights.length,
    cars: upcomingCars.length,
  };
  const hotelRows = (
  <ul className="divide-y divide-line">
    {upcoming.map((s) => (
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
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">{s.propertyName}</span>
              {/* Same chip as the card panel's "Owner:" / "Bank:". */}
              {s.brand ? (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                  Booked Thru: <span className="text-slate-700 dark:text-neutral-200">{s.brand}</span>
                </span>
              ) : null}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
              <span className="tabular-nums">{sheetDate(s.checkIn)}</span>
              <span className="tabular-nums">{s.nights}n</span>
              {s.city ? <span>{s.city}</span> : null}
              {s.pax ? <span className="tabular-nums">{s.pax} pax</span> : null}
            </span>
            <Remarks text={s.remarks} />
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
              value={s.hotelCostCents > 0 ? formatMoneyWhole(s.hotelCostCents, currency) : DASH}
              tone=""
            />
            <Figure
              label="Pocket cost"
              value={
                s.pocketCostCents > 0
                  ? formatMoneyWhole(s.pocketCostCents, currency)
                  : coveredBy(s)
              }
              tone={s.pocketCostCents > 0 ? "text-negative" : "text-muted"}
            />
          </span>
        </button>
      </li>
    ))}
  </ul>
  );
  const flightRows = (
  <ul className="divide-y divide-line">
    {upcomingFlights.map(({ flight: f, next }) => {
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
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                  {f.airline}
                  {f.bookingCode ? <span className="text-slate-700 dark:text-neutral-200"> · {f.bookingCode}</span> : null}
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
              <Remarks text={f.remarks} />
            </span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
              <Figure label="Days away" value={String(daysUntil(today, next.flightOn))} tone="" style={{ color: "var(--viz-savings)" }} />
              <Figure label="Flight cost" value={f.flightCostCents > 0 ? formatMoneyWhole(f.flightCostCents, currency) : DASH} tone="" />
              {/* Only when points paid part of it — otherwise it repeats the flight cost. */}
              {f.pocketCostCents !== f.flightCostCents ? (
                <Figure
                  label="Pocket cost"
                  value={f.pocketCostCents > 0 ? formatMoneyWhole(f.pocketCostCents, currency) : f.pointsUsed ? "Points" : DASH}
                  tone={f.pocketCostCents > 0 ? "text-negative" : "text-muted"}
                />
              ) : null}
            </span>
          </button>
        </li>
      );
    })}
  </ul>
  );
  const carRows = (
  <ul className="divide-y divide-line">
    {upcomingCars.map((c) => (
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
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                  Booking: <span className="text-slate-700 dark:text-neutral-200">{c.bookingCode}</span>
                </span>
              ) : null}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
              <span className="tabular-nums">
                {sheetDateRange(c.pickupOn, c.returnOn)}
              </span>
              {c.pickupPlace ? <span>{c.pickupPlace}</span> : null}
            </span>
            <Remarks text={c.remarks} />
          </span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
            {/* Already picked up: nothing left to count down. */}
            <Figure
              label="Days away"
              value={c.pickupOn >= today ? String(daysUntil(today, c.pickupOn)) : "Out now"}
              tone=""
              style={{ color: "var(--viz-savings)" }}
            />
            <Figure label="Rental cost" value={c.costCents > 0 ? formatMoneyWhole(c.costCents, currency) : DASH} tone="" />
            {c.pocketCostCents !== c.costCents ? (
              <Figure
                label="Pocket cost"
                value={c.pocketCostCents > 0 ? formatMoneyWhole(c.pocketCostCents, currency) : c.pointsUsed ? "Points" : DASH}
                tone={c.pocketCostCents > 0 ? "text-negative" : "text-muted"}
              />
            ) : null}
          </span>
        </button>
      </li>
    ))}
  </ul>
  );

  // The year rollup's table, shared by the inline panel and its full-width
  // popup. `rows` may carry a null row — a year the Trip Log has and the stays
  // don't, kept as a dashed line so the two rollups stay on the same lines
  // inside the Travel Combined Log popup.
  const renderYearTable = (
    rows: [string, { hotel: number; pocket: number; stays: number; points: number } | null][],
    // The popup shows a Total line under the years; the inline card carries
    // the same figures in its header, so it leaves this off.
    withTotals = false,
  ) => (
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
          {rows.map(([y, row]) => (
            <tr
              key={y}
              className={`border-b border-line/60 last:border-0 ${year.includes(y) ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""}`}
            >
              <td
                className="sticky left-0 z-10 px-2 py-2 text-center font-semibold tabular-nums"
                style={{
                  backgroundColor: year.includes(y) ? "var(--viz-sel)" : "var(--surface)",
                }}
              >
                {y}
              </td>
              <td className="px-2 py-2 text-center tabular-nums text-muted">{row ? row.stays : DASH}</td>
              <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                {row && row.points > 0 ? row.points.toLocaleString() : DASH}
              </td>
              <td className="px-2 py-2 text-center tabular-nums">{row ? formatMoneyWhole(row.hotel, currency) : DASH}</td>
              <td className="px-2 py-2 text-center tabular-nums text-negative">{row ? formatMoneyWhole(row.pocket, currency) : DASH}</td>
              <td className="px-2 py-2 text-center font-bold tabular-nums text-positive">
                {row ? formatMoneyWhole(row.hotel - row.pocket, currency) : DASH}
              </td>
            </tr>
          ))}
        </tbody>
        {withTotals ? (
          <tfoot>
            {(() => {
              const t = rows.reduce(
                (acc, [, row]) => ({
                  stays: acc.stays + (row?.stays ?? 0),
                  points: acc.points + (row?.points ?? 0),
                  hotel: acc.hotel + (row?.hotel ?? 0),
                  pocket: acc.pocket + (row?.pocket ?? 0),
                }),
                { stays: 0, points: 0, hotel: 0, pocket: 0 },
              );
              return (
                <tr className="border-t-2 border-line font-bold">
                  <td
                    className="sticky left-0 z-10 px-2 py-2 text-center"
                    style={{ backgroundColor: "var(--surface)" }}
                  >
                    Total
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">{t.stays}</td>
                  <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                    {t.points > 0 ? t.points.toLocaleString() : DASH}
                  </td>
                  <td className="px-2 py-2 text-center tabular-nums">{formatMoneyWhole(t.hotel, currency)}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-negative">{formatMoneyWhole(t.pocket, currency)}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-positive">
                    {formatMoneyWhole(t.hotel - t.pocket, currency)}
                  </td>
                </tr>
              );
            })()}
          </tfoot>
        ) : null}
      </table>
    </div>
  );

  // The Travel Combined Log popup shows both rollups side by side, so they
  // share one year axis — every year either one knows about, newest first.
  const combinedYears = useMemo(() => {
    const ys = new Set<string>(tripSummaries.map((t) => t.start?.slice(0, 4)).filter(Boolean) as string[]);
    for (const [y] of byYear) ys.add(y);
    return [...ys].sort().reverse();
  }, [tripSummaries, byYear]);
  // The two "who did we stay with" tallies: the same money cut by hotel brand
  // and by the card that paid. They sit under the points ledger in a third of
  // a row, so — like it — they only open full width.
  const brandTable = (
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
                {formatMoneyWhole(row.spent, currency)}
              </td>
              <td className="px-3 py-2 text-center font-semibold tabular-nums text-positive">
                {formatMoneyWhole(row.saved, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const cardTable = (
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
                {formatMoneyWhole(row.spent, currency)}
              </td>
              <td className="px-2 py-2 text-center font-semibold tabular-nums text-positive">
                {formatMoneyWhole(row.saved, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const combinedYearTable = renderYearTable(
    combinedYears.map((y) => [y, byYear.find(([key]) => key === y)?.[1] ?? null]),
    true,
  );

  return (
    <div className="space-y-3">
      <header className="rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
        {/* The actions sit next to the title rather than pinned to the far
             right — on a wide screen that put the primary button an entire
             page away from what it acts on. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* The page title and the Add action are one button — the heading
              stays for screen readers only. */}
          <h1 className="sr-only">Travel Log</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-lg bg-sky-700 px-4 py-2 text-base font-bold text-white transition hover:bg-sky-800 sm:text-lg"
            >
              Add Travel Log
            </button>
            <EditTripPicker
              // A trip saved with just a name has no dates of its own; its
              // first booking places it in the year and the order.
              trips={tripSummaries.map((t) => ({ ...t.trip, startOn: t.start }))}
              onPick={setOpenTripId}
            />
            {/* Only worth showing while something still needs linking — with
                every label pointed at a card there's nothing for it to fix, so
                it stays out of the way until a new unlinked stay appears. */}
            {/* What's still ahead. These used to be two collapsible cards
                halfway down the page; they are what you come here to check, so
                they sit in the header and open straight into the full-width
                popup — no expanding a narrow column first. */}
            {/* Boxed together so the label reads as the heading of these
                buttons, not as one more control in the row. */}
            {UPCOMING_BUTTONS.some(({ key }) => upcomingCounts[key] > 0) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/15 py-0.5 pl-3 pr-1 dark:border-white/20">
              <span className="whitespace-nowrap text-base font-bold sm:text-lg">Upcoming Travel/Trips:</span>
            {UPCOMING_BUTTONS.map(({ key, label }) =>
              upcomingCounts[key] > 0 ? (
                <button
                  key={key}
                  type="button"
                  onClick={() => setExpandedUpcoming(key)}
                  className="flex items-center gap-2 rounded-lg border border-black/25 bg-background px-3 py-1.5 text-sm font-bold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40"
                >
                  <span>{label}:</span>
                  {/* The count reads as part of the button, not as a muted
                      chip bolted onto it — a grey pill here was all weight and
                      no colour. */}
                  <span className="tabular-nums text-sky-700 dark:text-sky-400">
                    {upcomingCounts[key]}
                  </span>
                </button>
              ) : null,
            )}
            </div>
            ) : null}
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
            className="mt-4 rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800"
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
          // What each card's points have actually come out at, from the award
          // bookings in the logs below — the rewards board's stated
          // cents-per-point has nothing to check itself against otherwise.
          redemptions={redemptions}
        >
          {/* ---- Travel & Credit Card Rewards: the points that pay for the
               stays below. Moved here from /accounts — Accounts keeps the
               plain card list and the Pay Card flow. */}
          <CreditCardSections />

          {/* ---- The three logs side by side. Each is a table far wider than a
               third of this column, so none of them unfolds here any more —
               the header opens its own full-width popup. Side by side they are
               a row of doorways, not three stacked lids. */}
          <div className="grid items-start gap-3 xl:grid-cols-3">
          {trips.length > 0 ? (
            <TripLogPanel
              summaries={tripSummaries}
              currency={currency}
              onOpenTrip={setOpenTripId}
              savedByYear={combinedYearTable}
              alignYears={combinedYears}
            />
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
            title="Hotel Log"
            /* Collapsed it says one thing: what this log came to, for the year
               picked beside it. The counts and the search belong to the table,
               and the table only ever opens full width now. */
            meta={<Figure label="Spent" value={formatMoneyWhole(shownTotals.pocket, currency)} tone="text-negative" />}
            control={yearSelect}
            open={openList}
            onToggle={() => setOpenList((v) => !v)}
            onExpand={() => setExpanded(true)}
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
          </div>

          {/* ---- The two charts beside the points ledger, three across from
               xl up. The charts are drawn narrow by design, so a third of a
               row suits them; the ledger opens full width for its columns. */}
          <section className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
                <h2 className="mb-3 text-center text-sm font-bold">Hotel cost vs pocket cost</h2>
                <CostBars years={yearPoints} currency={currency} selected={yearPicked || yearRestored ? year : undefined} onPick={openLogForYear} />
              </div>
              {/* Stretched to the bar chart's height (it carries a legend this
                  one doesn't); the line sits at the bottom so both year rows line up. */}
              <div className="flex flex-col self-stretch rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
                <h2 className="mb-3 text-center text-sm font-bold">Total saved per year</h2>
                <div className="flex flex-1 flex-col justify-end">
                  <SavedLine years={yearPoints} currency={currency} selected={yearPicked || yearRestored ? year : undefined} onPick={openLogForYear} />
                </div>
              </div>
              <div className="space-y-3 lg:col-span-2 xl:col-span-1">
                <Panel
                  title="Total Stays by Brand"
                  meta={<Figure label="Saved" value={formatMoneyWhole(tallyTotals.saved, currency)} tone="text-positive" />}
                  control={tallyPeriod(tallyYear, setTallyYear, "Brand tally year")}
                  open={false}
                  onToggle={() => setExpandedTally("brands")}
                  onExpand={() => setExpandedTally("brands")}
                >
                  {null}
                </Panel>
                <Panel
                  title="Total Stays by Rewards Card"
                  meta={<Figure label="Saved" value={formatMoneyWhole(cardTotals.saved, currency)} tone="text-positive" />}
                  control={tallyPeriod(cardYear, setCardYear, "Card tally year")}
                  open={false}
                  onToggle={() => setExpandedTally("cards")}
                  onExpand={() => setExpandedTally("cards")}
                >
                  {null}
                </Panel>
                <RewardsPointsLog />
              </div>
          </section>


        </CreditCardRewardsProvider>
      )}

      {/* The log at full width. `max-w-[96vw]` rather than one of the shared
          max-w-* caps: the table needs ~1275px and a 5xl panel (1024) would
          still hide the last columns on a laptop. */}
      {expanded ? (
        <ModalShell
          title="Hotel Log"
          onClose={() => setExpanded(false)}
          className="sm:max-w-[96vw]"
          headerExtra={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <HeaderTotals
                countLabel="Total hotels"
                count={filtered.length}
                spent={shownTotals.pocket}
                saved={shownTotals.saved}
                currency={currency}
              />
              {/* On the title's own line, not a strip of its own below it. */}
              {yearSelect}
            </span>
          }
        >
          {reservations}
        </ModalShell>
      ) : null}

      {expandedUpcoming ? (
        <ModalShell
          title={
            expandedUpcoming === "hotels" ? "Hotel Reservations" : expandedUpcoming === "flights" ? "Flight Reservations" : "Rental Reservations"
          }
          onClose={() => setExpandedUpcoming(null)}
          className="sm:max-w-5xl"
        >
          {expandedUpcoming === "hotels" ? hotelRows : expandedUpcoming === "flights" ? flightRows : carRows}
        </ModalShell>
      ) : null}

      {expandedTally ? (
        <ModalShell
          title={expandedTally === "brands" ? "Total Stays by Brand" : "Total Stays by Rewards Card"}
          onClose={() => setExpandedTally(null)}
          className="sm:max-w-5xl"
          headerExtra={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {expandedTally === "brands" ? (
                <HeaderTotals countLabel="Total brands" count={brandTally.length} spent={tallyTotals.spent} saved={tallyTotals.saved} currency={currency} />
              ) : (
                <HeaderTotals countLabel="Total cards" count={cardTally.length} spent={cardTotals.spent} saved={cardTotals.saved} currency={currency} />
              )}
              {expandedTally === "brands"
                ? tallyPeriod(tallyYear, setTallyYear, "Brand tally year")
                : tallyPeriod(cardYear, setCardYear, "Card tally year")}
            </span>
          }
        >
          {expandedTally === "brands" ? brandTable : cardTable}
        </ModalShell>
      ) : null}

      {linking ? (
        <CardLinkModal rows={cardLabels} cards={cards} onClose={() => setLinking(false)} />
      ) : null}

      {openTrip ? (
        <TripDetailModal
          // Remounted per trip so notes and edit state start fresh on a switch.
          key={`trip-${openTrip.trip.id}`}
          summary={openTrip}
          allTrips={tripSummaries}
          onSwitchTrip={setOpenTripId}
          currency={currency}
          onEditBooking={(b) =>
            b.kind === "flight" ? setEditingFlight(b.flight) : b.kind === "stay" ? setEditing(b.stay) : setEditingCar(b.car)
          }
          onAddBooking={() => {
            setAddTripId(openTrip.trip.id);
            setSpendingOnly(false);
            setAdding(true);
          }}
          onEditSpending={() => {
            setAddTripId(openTrip.trip.id);
            setSpendingOnly(true);
            setAdding(true);
          }}
          onClose={() => setOpenTripId(null)}
        />
      ) : null}
      {adding && spendingOnly ? (
        <MiscModal
          // Remounted per trip so opening another trip's spending starts fresh.
          key={`spending-${addTripId ?? "new"}`}
          trips={trips}
          expenses={expenses}
          stays={stays}
          flights={flights}
          cars={carList}
          currency={currency}
          defaultTripId={addTripId}
          onClose={closeForms}
        />
      ) : null}
      {adding && !spendingOnly ? (
        <AddTravelLogModal
          trips={trips}
          cards={cards}
          brands={brandList}
          travellers={travellers}
          airlines={airlines}
          expenses={expenses}
          stays={stays}
          flights={flights}
          cars={carList}
          currency={currency}
          defaultTripId={addTripId}
          onClose={closeForms}
        />
      ) : null}
      {editing ? (
        <StayModal
          stay={editing}
          cards={cards}
          brands={brandList}
          currency={currency}
          trips={trips}
          allowRooms
          onClose={closeForms}
        />
      ) : null}
      {editingFlight ? (
        <FlightModal flight={editingFlight} cards={cards} travellers={travellers} airlines={airlines} trips={trips} currency={currency} onClose={closeForms} />
      ) : null}
      {editingCar ? (
        <CarModal car={editingCar} cards={cards} trips={trips} currency={currency} onClose={closeForms} />
      ) : null}
    </div>
  );
}

// A booking's remarks, under its details — only when there are any.
function Remarks({ text }: { text: string | null }) {
  if (!text?.trim()) return null;
  return <span className="line-clamp-2 text-[11px] italic text-muted">{text}</span>;
}

// The heading over one group in the upcoming card: what the group holds, and
// how many of them are still ahead. The whole line folds its group away.
// A card whose body folds away. The header stays put so a collapsed section
// still says what it holds and how much of it there is.
function Panel({
  title,
  meta,
  control,
  open,
  onToggle,
  onExpand,
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
  /** Given instead of an inline expand: the header opens the full-width popup
   *  and the panel never unfolds in the page column. The table needs more
   *  width than this column has, so unfolding it here only ever showed half. */
  onExpand?: () => void;
  children: React.ReactNode;
}) {
  const inlineOpen = onExpand ? false : open;
  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* The whole row is the toggle, not just the title: these headers carry
          a control on the right, which otherwise leaves a wide dead strip in
          between. The control stops the click so its own menu still works. */}
      <div
        onClick={onExpand ?? onToggle}
        className={`flex cursor-pointer flex-wrap items-center transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] ${inlineOpen ? "border-b border-line" : ""} ${onExpand ? "gap-y-2 px-4 py-3 sm:px-5" : ""}`}
      >
      <button
        type="button"
        /* The row above handles the click; without this the toggle would fire
           twice and land back where it started. */
        onClick={(e) => { e.stopPropagation(); (onExpand ?? onToggle)(); }}
        aria-expanded={onExpand ? undefined : open}
        className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-left ${onExpand ? "" : "flex-1 px-4 py-3 sm:px-5"} ${control ? "pr-2" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {onExpand ? (
            <ExpandIcon />
          ) : (
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
          )}
          <span className="truncate text-sm font-bold">{title}</span>
        </span>
        {meta ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{meta}</span>
        ) : null}
      </button>
      {/* Flush against the metas, not flung to the far edge — see the header
          buttons above. Same py-3 as the button beside it: the control is
          taller than a line of text, and without the padding this header sits
          ~5px shorter than the sibling cards in the 3-up row. Only from xl,
          where that row exists — stacked, it would just be dead space. A
          full-width-only header pads the row instead, so when the control
          wraps under a long title it lines up with the title's left edge. */}
      {control ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`shrink-0 cursor-auto ${onExpand ? "" : "ml-auto pl-3 pr-4 sm:pr-5 xl:py-3"}`}
        >
          {control}
        </div>
      ) : null}
      </div>
      {inlineOpen ? children : null}
    </section>
  );
}

/** The two diagonal arrows: this header opens a full-width popup. */
export function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
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
      <Figure label="Total spent" value={formatMoneyWhole(spent, currency)} tone="text-negative" />
      <Figure label="Total saved" value={formatMoneyWhole(saved, currency)} tone="text-positive" />
    </>
  );
}

export function Figure({
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
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted">{label}:</span>
      <span className={`text-sm font-bold tabular-nums ${tone}`} style={style}>{value}</span>
    </span>
  );
}


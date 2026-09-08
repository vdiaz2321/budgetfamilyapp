"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { CardLinkModal, type CardLabelRow } from "./card-link-modal";
import { StayModal } from "./stay-modal";
import { CostBars, SavedLine, type YearPoint } from "./travel-charts";
import {
  effectivePointsValueMicros,
  pointsValueCents,
  savedCents,
  stayYear,
  type TravelBrand,
  type TravelCard,
  type TravelStay,
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
} satisfies Record<string, (s: TravelStay) => string | number>;

type SortKey = keyof typeof SORTERS;

// Text sorts start A→Z; numbers and dates start with the biggest first.
const TEXT_KEYS = new Set<SortKey>(["propertyName", "city", "brand", "cardLabel"]);

function sheetDate(iso: string | null): string {
  if (!iso) return DASH;
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
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

// The rate a batch of points actually redeemed at, e.g. "0.55¢/pt".
function centsPerPoint(valueCents: number, points: number): string {
  if (!points || !valueCents) return "—";
  return `${(valueCents / points).toFixed(2)}¢/pt`;
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
  cards,
  brands: brandList,
  currency,
  today,
}: {
  stays: TravelStay[];
  cards: TravelCard[];
  brands: TravelBrand[];
  currency: string;
  today: string;
}) {
  const [year, setYear] = useState<string>(() => {
    const current = today.slice(0, 4);
    return stays.some((s) => stayYear(s) === current) ? current : ALL;
  });
  const [brand, setBrand] = useState<string>(ALL);
  const [holder, setHolder] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "checkIn",
    dir: "desc",
  });
  const [openYears, setOpenYears] = useState(true);
  const [openBrands, setOpenBrands] = useState(true);
  const [openCards, setOpenCards] = useState(true);
  // The log starts collapsed on a fresh login — it's the longest section on
  // the page — but sessionStorage carries whatever you last set for as long as
  // you're still moving around the app.
  const [listState, setListState] = useSessionCollapse("travel-reservations-log", () => ({ open: false }));
  const openList = !!listState.open;
  const setOpenList = (fn: (v: boolean) => boolean) =>
    setListState((s) => ({ open: fn(!!s.open) }));
  const [editing, setEditing] = useState<TravelStay | null>(null);
  const [adding, setAdding] = useState(false);
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
  const holders = useMemo(
    () => Array.from(new Set(stays.map((s) => s.holder).filter(Boolean) as string[])).sort(),
    [stays],
  );

  // Search reads every text field on a stay, so "munich", "aspire" and
  // "breakfast" all find rows without picking a field first.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = stays.filter((s) => {
      if (year !== ALL && stayYear(s) !== year) return false;
      if (brand !== ALL && s.brand !== brand) return false;
      if (holder !== ALL && s.holder !== holder) return false;
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
  }, [stays, year, brand, holder, query, sort]);

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
      row.points += s.pointsCost;
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

  // What each real card has actually done for you — only answerable once the
  // labels are linked, which is what the Link cards button is for.
  const cardTally = useMemo(() => {
    const map = new Map<string, { stays: number; spent: number; saved: number; points: number; pointsValue: number }>();
    for (const s of live) {
      const key = (s.accountId ? cardName.get(s.accountId) : null) ?? "Not linked";
      const row = map.get(key) ?? { stays: 0, spent: 0, saved: 0, points: 0, pointsValue: 0 };
      row.stays += 1;
      row.spent += s.pocketCostCents;
      row.saved += savedCents(s);
      row.points += s.pointsCost;
      row.pointsValue += pointsValueCents(s);
      map.set(key, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].stays - a[1].stays || a[0].localeCompare(b[0]));
  }, [live, cardName]);

  // Stays per brand over every year — the sheet's brand tally, and what a
  // by-brand chart will group on.
  const brandTally = useMemo(() => {
    const map = new Map<string, { stays: number; spent: number; saved: number; points: number; pointsValue: number }>();
    for (const s of live) {
      const key = s.brand?.trim() || "Unbranded";
      const row = map.get(key) ?? { stays: 0, spent: 0, saved: 0, points: 0, pointsValue: 0 };
      row.stays += 1;
      row.spent += s.pocketCostCents;
      row.saved += savedCents(s);
      row.points += s.pointsCost;
      row.pointsValue += pointsValueCents(s);
      map.set(key, row);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].stays - a[1].stays || a[0].localeCompare(b[0]));
  }, [live]);

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
      points += s.pointsCost;
      pointsValue += pointsValueCents(s);
      nights += s.nights;
    }
    return { hotel, pocket, points, pointsValue, nights, cancelled, saved: hotel - pocket };
  }, [filtered]);

  return (
    <div className="space-y-3">
      <header className="rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
        {/* The actions sit next to the title rather than pinned to the far
             right — on a wide screen that put the primary button an entire
             page away from what it acts on. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-bold sm:text-xl">Hotel/Lodging Stays Log</h1>
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
              Add stay
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
        <>
          {/* ---- What's still ahead. Sits above the archive because a booking
               you haven't taken yet is the thing you come here to check. */}
          {upcoming.length > 0 ? (
            <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-6">
                <h2 className="text-sm font-bold">Coming up</h2>
                <span className="text-xs tabular-nums text-muted">
                  {upcoming.length} booked
                </span>
              </div>
              <ul className="divide-y divide-line">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:flex-nowrap sm:px-6"
                    >
                      {/* One line: the name truncates before the trip details
                          or the figures beside it are pushed off. */}
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 sm:flex-nowrap">
                        <span className="truncate text-sm font-semibold">{s.propertyName}</span>
                        <span className="flex shrink-0 items-baseline gap-x-2 text-[11px] text-muted">
                          <span className="tabular-nums">{sheetDate(s.checkIn)}</span>
                          <span className="tabular-nums">{s.nights}n</span>
                          {s.city ? <span className="hidden sm:inline">{s.city}</span> : null}
                          {s.brand ? <span className="hidden sm:inline">{s.brand}</span> : null}
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
            </section>
          ) : null}

          {/* ---- The reservations themselves, with the filters that drive them
               and what the current selection adds up to. */}
          <Panel
            title="Hotel Reservations Log"
            meta={
              <HeaderTotals
                count={`${filtered.length} shown`}
                spent={shownTotals.pocket}
                saved={shownTotals.saved}
                currency={currency}
              />
            }
            open={openList}
            onToggle={() => setOpenList((v) => !v)}
          >
            {/* Filters on the left, and the figures the header doesn't carry
                on the right — spent and saved live in the header, so they are
                not repeated here. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                {/* The year picker is the dropdown alone: it opens on the year
                    you're in, and every other year (and all of them) is one
                    click away without a row of chips across the page. */}
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value={ALL}>All years</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
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
                {holders.length > 0 ? (
                  <select
                    value={holder}
                    onChange={(e) => setHolder(e.target.value)}
                    className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value={ALL}>All owners</option>
                    {holders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search hotel, city, card…"
                  className="w-44 rounded-md bg-background px-2 py-1 text-xs ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                />
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
                <Figure label="Hotel cost" value={formatMoney(shownTotals.hotel, currency)} tone="" />
                <Figure
                  label="Points used"
                  value={shownTotals.points.toLocaleString()}
                  tone=""
                  style={{ color: "var(--viz-savings)" }}
                />
                {/* What those points were actually worth, at the rate recorded
                    on each stay — the whole point of redeeming them. */}
                <Figure
                  label="Points worth"
                  value={formatMoney(shownTotals.pointsValue, currency)}
                  tone=""
                  style={{ color: "var(--viz-savings)" }}
                />
                <span className="text-[11px] text-muted tabular-nums">
                  Total in {year === ALL ? "all years" : year}: {shownTotals.nights} Night
                  {shownTotals.nights === 1 ? "" : "s"}
                  {shownTotals.cancelled ? ` · ${shownTotals.cancelled} cancelled` : ""}
                </span>
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
                    <SortTh label="Points cost" col="pointsCost" sort={sort} onSort={sortBy} />
                    <SortTh label="Cash value" col="pointsValue" sort={sort} onSort={sortBy} />
                    <SortTh label="Hotel credit" col="hotelCredit" sort={sort} onSort={sortBy} />
                    <SortTh label="Hotel cost" col="hotelCost" sort={sort} onSort={sortBy} />
                    <SortTh label="Pocket cost" col="pocketCost" sort={sort} onSort={sortBy} />
                    <SortTh label="City" col="city" sort={sort} onSort={sortBy} />
                    <SortTh label="Total nights" col="nights" sort={sort} onSort={sortBy} nowrap />
                    <SortTh label="Brand" col="brand" sort={sort} onSort={sortBy} />
                    <SortTh label="CC info" col="cardLabel" sort={sort} onSort={sortBy} />
                    <SortTh label="Total pax" col="pax" sort={sort} onSort={sortBy} nowrap />
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
                      <td
                        className={`px-2 py-2 text-center tabular-nums ${s.pointsCost > 0 ? "" : "text-muted"}`}
                        style={s.pointsCost > 0 ? { color: "var(--viz-savings)" } : undefined}
                      >
                        {s.pointsCost > 0 ? s.pointsCost.toLocaleString() : DASH}
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
                      <td className="px-2 py-2 text-center text-muted">{s.city ?? DASH}</td>
                      <td className="px-2 py-2 text-center tabular-nums">{s.nights}</td>
                      <td className="px-2 py-2 text-center">{s.brand ?? DASH}</td>
                      <td className="px-2 py-2 text-center text-xs text-muted">
                        {(s.accountId ? cardName.get(s.accountId) : null) ?? s.cardLabel ?? DASH}
                      </td>
                      <td className={`px-2 py-2 text-center tabular-nums ${s.pax ? "" : "text-muted"}`}>
                        {s.pax ?? DASH}
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
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">Points cost</span>
                        <span className="tabular-nums font-semibold" style={{ color: "var(--viz-savings)" }}>
                          {s.pointsCost > 0 ? s.pointsCost.toLocaleString() : "—"}
                        </span>
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
          </Panel>
          {/* ---- The two charts stacked in one column with the table they're
               drawn from beside them, so the whole year-over-year picture is
               one screenful. Both charts read every stay, not the filtered set
               — a one-year filter would leave one column. Below lg the table
               drops under the charts, where it has the width to breathe. */}
          <section className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            <div className="space-y-3">
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
            </div>
          {/* ---- Year-over-year rollup: the sheet's summary block. */}
          <Panel
            title="Total Cost Saved by Year"
            meta={
              <HeaderTotals
                count={`${byYear.length} year${byYear.length === 1 ? "" : "s"}`}
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
                    <th className="px-2 py-2 text-center font-semibold">Year</th>
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
                      <td className="px-2 py-2 text-center font-semibold tabular-nums">{y}</td>
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
          </section>

          {/* ---- The two "who did we stay with" tallies, side by side: the
               same money cut by hotel brand on the left and by the card that
               paid on the right. They stack below lg, where half a viewport
               can't hold either table. */}
          <section className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          {/* ---- Stays by brand: the sheet's right-hand tally. */}
          <Panel
            title="Total Stays by Brand"
            meta={
              <HeaderTotals
                count={`${brandTally.length} brand${brandTally.length === 1 ? "" : "s"}`}
                spent={allTotals.spent}
                saved={allTotals.saved}
                currency={currency}
              />
            }
            open={openBrands}
            onToggle={() => setOpenBrands((v) => !v)}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-left font-semibold">Brand</th>
                    <th className="px-3 py-2 text-center font-semibold">Stays</th>
                    <th className="px-3 py-2 text-center font-semibold">Points</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center font-semibold">Points worth</th>
                    <th className="px-3 py-2 text-center font-semibold">Total spent</th>
                    <th className="px-3 py-2 text-center font-semibold">Total saved</th>
                  </tr>
                </thead>
                <tbody>
                  {brandTally.map(([b, row]) => (
                    <tr key={b} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2 text-left font-semibold">{b}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{row.stays}</td>
                      <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {row.points > 0 ? row.points.toLocaleString() : <span className="text-muted">{DASH}</span>}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {row.pointsValue > 0 ? (
                          <>
                            {formatMoney(row.pointsValue, currency)}
                            <span className="ml-1 text-[10px] text-muted">
                              {centsPerPoint(row.pointsValue, row.points)}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted">{DASH}</span>
                        )}
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
                count={`${cardTally.length} card${cardTally.length === 1 ? "" : "s"}`}
                spent={allTotals.spent}
                saved={allTotals.saved}
                currency={currency}
              />
            }
            open={openCards}
            onToggle={() => setOpenCards((v) => !v)}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-2 py-2 text-left font-semibold">Card</th>
                    <th className="px-2 py-2 text-center font-semibold">Stays</th>
                    <th className="px-2 py-2 text-center font-semibold">Points</th>
                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Points worth</th>
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
                      <td className={`whitespace-nowrap px-2 py-2 text-left font-semibold ${name === "Not linked" ? "text-muted" : ""}`}>
                        {name}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums">{row.stays}</td>
                      <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {row.points > 0 ? row.points.toLocaleString() : <span className="text-muted">{DASH}</span>}
                      </td>
                      <td className="px-2 py-2 text-center tabular-nums">
                        {row.pointsValue > 0 ? (
                          formatMoney(row.pointsValue, currency)
                        ) : (
                          <span className="text-muted">{DASH}</span>
                        )}
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
          </section>


        </>
      )}

      {linking ? (
        <CardLinkModal rows={cardLabels} cards={cards} onClose={() => setLinking(false)} />
      ) : null}

      {adding || editing ? (
        <StayModal
          stay={editing}
          cards={cards}
          brands={brandList}
          currency={currency}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

// A card whose body folds away. The header stays put so a collapsed section
// still says what it holds and how much of it there is.
function Panel({
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:px-6 ${open ? "border-b border-line" : ""}`}
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
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  nowrap?: boolean;
}) {
  const active = sort.key === col;
  return (
    <th className={`px-2 py-2 font-semibold ${nowrap ? "whitespace-nowrap" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`mx-auto flex items-center gap-1 uppercase tracking-wide transition hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        {active ? <span aria-hidden>{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function HeaderTotals({
  count,
  spent,
  saved,
  currency,
}: {
  count: string;
  spent: number;
  saved: number;
  currency: string;
}) {
  return (
    <>
      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-muted dark:bg-white/10">
        {count}
      </span>
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


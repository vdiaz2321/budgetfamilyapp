"use client";

import { useMemo, useState } from "react";
import { ExpandIcon, LOG_FIGURE_COL, LOG_TITLE_COL } from "./travel-board";
import { SearchBox } from "./search-box";
import { YearPicker, inYears, thisAndFutureYears, useSessionYears } from "./year-picker";
import { ModalShell } from "@/components/modal-shell";
import { formatMoneyWhole } from "@/lib/money";
import { sheetDateRange, type TripSummary } from "./trip-summary";
import type { ExpenseCategory } from "./types";


// The trip's name without the "· May 2027" the importer adds — the Dates
// column already says when.
function placeName(name: string): string {
  return name.split(" · ")[0];
}
const DASH = "—";

// What the trip search matches: the trip's name plus what was booked on it —
// hotels and their cities, airlines, flight numbers, airports and booking codes, and rental
// companies with their pickup and return places.
function searchText(t: TripSummary): string {
  const words = t.bookings.flatMap((b) => {
    if (b.kind === "stay") return [b.stay.propertyName, b.stay.city, b.stay.brand];
    if (b.kind === "flight")
      return [b.flight.airline, b.flight.bookingCode, ...b.flight.legs.flatMap((l) => [l.flightNumber, l.fromPlace, l.toPlace])];
    return [b.car.company, b.car.bookingCode, b.car.pickupPlace, b.car.returnPlace];
  });
  return [t.trip.name, ...words].filter(Boolean).join(" ").toLowerCase();
}

// The whole-trip columns: flights and hotels, the day-to-day spending, then
// the rental last. `plan` is the part of the figure that is only a plan so
// far — a cell that is all plan renders grey, and none of it counts as Spent.
const MONEY_COLUMNS: { label: string; read: (t: TripSummary) => number; plan: (t: TripSummary) => number }[] = [
  { label: "Flights", read: (t) => t.flights, plan: (t) => t.planOnly.flights },
  { label: "Hotels", read: (t) => t.hotels, plan: (t) => t.planOnly.hotels },
  ...(
    [
      ["restaurants", "Restaurants"],
      ["groceries", "Groceries"],
      ["entertainment", "Entertainment"],
      ["transport", "Public transport"],
      ["fuel_tolls", "Fuel & tolls"],
      ["parking", "Parking"],
      ["cash", "Cash"],
      ["other", "Other"],
    ] as [ExpenseCategory, string][]
  ).map(([key, label]) => ({ label, read: (t: TripSummary) => t.misc[key], plan: (t: TripSummary) => t.planOnly.misc[key] })),
  { label: "Rental", read: (t) => t.rentals, plan: (t) => t.planOnly.rentals },
];

/**
 * The Trip Log: one row per trip with everything it cost — flights, hotels,
 * rental and the day-to-day spending — the way the Google Sheet's trip blocks
 * added up, but as columns that can be read across trips and years.
 */
export function TripLogPanel({
  summaries,
  currency,
  onOpenTrip,
  savedByYear,
  alignYears,
}: {
  summaries: TripSummary[];
  currency: string;
  onOpenTrip: (tripId: string) => void;
  /** The hotel year rollup, shown beside "By year" in the full-width popup —
      the popup has the width for both, and the two answer the same question
      from the trip side and the stay side. */
  savedByYear?: React.ReactNode;
  /** The shared year axis for the two rollups — every year either one covers,
      newest first, so their rows sit on the same lines. */
  alignYears?: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const years = useMemo(
    // This year is always offered — it's the default even before its first trip.
    () =>
      [...new Set([String(new Date().getFullYear()), ...(summaries.map((t) => t.start?.slice(0, 4)).filter(Boolean) as string[])])]
        .sort()
        .reverse(),
    [summaries],
  );
  // This year plus any later year with a trip on a fresh login; a pick
  // afterwards is remembered for the session.
  const [year, setYear] = useSessionYears("travel-trip-log-years", () => thisAndFutureYears(years));
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = summaries.filter(
    (t) => inYears(year, t.start?.slice(0, 4)) && (!q || searchText(t).includes(q)),
  );

  const sum = (read: (t: TripSummary) => number) => shown.reduce((total, t) => total + read(t), 0);
  // Spent is money that left the wallet; Planned is what the upcoming trips
  // (and unbought bookings) are expected to cost. They used to be one "Total
  // spent" figure, so plans for 2027 read as money already gone.
  const totalSpent = sum((t) => t.spent);
  const totalPlanned = sum((t) => t.planOnly.total);

  // The sheet's year block: what each year's trips came to.
  const byYear = useMemo(() => {
    const map = new Map<string, { trips: number; total: number; planned: number; saved: number; points: number }>();
    for (const t of summaries) {
      const y = t.start?.slice(0, 4);
      if (!y) continue;
      const row = map.get(y) ?? { trips: 0, total: 0, planned: 0, saved: 0, points: 0 };
      row.trips += 1;
      row.total += t.spent;
      row.planned += t.planOnly.total;
      row.saved += t.saved;
      row.points += t.points;
      map.set(y, row);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [summaries]);

  // The rows the popup draws: the shared year axis when there is one (a year
  // only the hotel rollup knows about becomes a dashed line), otherwise just
  // the years with trips.
  const byYearRows: [string, (typeof byYear)[number][1] | null][] = alignYears
    ? alignYears.map((y) => [y, byYear.find(([key]) => key === y)?.[1] ?? null])
    : byYear;

  const byYearTotals = byYearRows.reduce(
    (acc, [, row]) => ({
      trips: acc.trips + (row?.trips ?? 0),
      total: acc.total + (row?.total ?? 0),
      planned: acc.planned + (row?.planned ?? 0),
      points: acc.points + (row?.points ?? 0),
      saved: acc.saved + (row?.saved ?? 0),
    }),
    { trips: 0, total: 0, planned: 0, points: 0, saved: 0 },
  );

  const money = (cents: number) => (cents > 0 ? formatMoneyWhole(cents, currency) : DASH);
  // A cell that is nothing but a plan reads grey, so a row of upcoming trips
  // is visibly "not spent yet" without a second line under each figure.
  const planClass = (value: number, plan: number) => (value > 0 && plan >= value ? "text-muted" : "");

  const table = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1400px] text-sm">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
            <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-center font-semibold">Travel location</th>
            <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Dates</th>
            <th className="px-2 py-2 text-center font-semibold">Nights</th>
            {MONEY_COLUMNS.map((c) => (
              <th key={c.label} className="px-2 py-2 text-center font-semibold">{c.label}</th>
            ))}
            <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Spent</th>
            <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Planned</th>
            <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Pts used</th>
            <th className="px-2 py-2 text-center font-semibold">Saved</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr
              key={t.trip.id}
              onClick={() => onOpenTrip(t.trip.id)}
              className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
            >
              <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold">
                {/* The Dates column drops the year, so the row carries it here —
                    the log reads across years when more than one is picked. */}
                <span className="flex items-baseline gap-1">
                  <span className="max-w-[12rem] truncate">{placeName(t.trip.name)}</span>
                  {t.start ? (
                    <span className="shrink-0 font-normal text-muted">- {t.start.slice(0, 4)}</span>
                  ) : null}
                </span>
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-muted">
                {t.start ? sheetDateRange(t.start, t.end) : DASH}
              </td>
              <td className="px-2 py-2 text-center tabular-nums">{t.nights ?? DASH}</td>
              {MONEY_COLUMNS.map((c) => (
                <td key={c.label} className={`whitespace-nowrap px-2 py-2 text-center tabular-nums ${planClass(c.read(t), c.plan(t))}`}>{money(c.read(t))}</td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 text-center font-bold tabular-nums text-negative">
                {t.spent > 0 ? formatMoneyWhole(t.spent, currency) : <span className="font-normal text-muted">{DASH}</span>}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center font-semibold tabular-nums text-muted">
                {money(t.planOnly.total)}
              </td>
              <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                {t.points > 0 ? t.points.toLocaleString() : <span className="text-muted">{DASH}</span>}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center font-semibold tabular-nums text-positive">
                {t.saved > 0 ? formatMoneyWhole(t.saved, currency) : <span className="font-normal text-muted">{DASH}</span>}
              </td>
            </tr>
          ))}
        </tbody>
        {shown.length > 1 ? (
          <tfoot>
            <tr className="border-t-2 border-line font-bold">
              <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">Total</td>
              <td className="px-2 py-2 text-center text-xs font-semibold text-muted">{shown.length} trips</td>
              <td className="px-2 py-2 text-center tabular-nums">{sum((t) => t.nights ?? 0)}</td>
              {MONEY_COLUMNS.map((c) => (
                <td key={c.label} className={`whitespace-nowrap px-2 py-2 text-center tabular-nums ${planClass(sum(c.read), sum(c.plan))}`}>{money(sum(c.read))}</td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-negative">{money(totalSpent)}</td>
              <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-muted">{money(totalPlanned)}</td>
              <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                {sum((t) => t.points) > 0 ? sum((t) => t.points).toLocaleString() : DASH}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-positive">{money(sum((t) => t.saved))}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );

  const yearSelect = (
    <YearPicker years={years} value={year} onChange={setYear} label="Travel Combined Log year" />
  );

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* One line from sm up: the 3-up grid gives this header ~445px, where
          the title used to wrap under the figure. The title is the only thing
          allowed to give up width; on a phone the row wraps as before. */}
      {/* The whole row opens the log — the title alone was a small target on
          a card that is otherwise all header. The year picker is the one
          exception and stops the click from reaching this handler. The inner
          button stays so the card is still reachable by keyboard. */}
      <div
        onClick={() => setExpanded(true)}
        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className={`flex min-w-0 items-center gap-2 text-left ${LOG_TITLE_COL}`}
        >
          <ExpandIcon />
          <span className="text-sm font-bold sm:truncate">Travel Combined Log</span>
        </button>
        {/* Collapsed, the card carries the same figures as the open log's
            header — trips, spent, planned — and the year they cover. Only the
            search stays inside, since it filters the table. */}
        <span className={`flex shrink-0 items-baseline gap-1.5 ${LOG_FIGURE_COL}`}>
          <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted">Total trips:</span>
          <span className="text-sm font-bold tabular-nums">{shown.length}</span>
        </span>
        <span className={`flex shrink-0 items-baseline gap-1.5 ${LOG_FIGURE_COL}`}>
          <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted">Spent:</span>
          <span className="text-sm font-bold tabular-nums text-negative">{formatMoneyWhole(totalSpent, currency)}</span>
        </span>
        {totalPlanned > 0 ? (
          <span className={`flex shrink-0 items-baseline gap-1.5 ${LOG_FIGURE_COL}`}>
            <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted">Planned:</span>
            <span className="text-sm font-bold tabular-nums text-muted">{formatMoneyWhole(totalPlanned, currency)}</span>
          </span>
        ) : null}
        <span className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>{yearSelect}</span>
      </div>

      {expanded ? (
        <ModalShell
          title="Travel Combined Log"
          onClose={() => setExpanded(false)}
          className="sm:max-w-[96vw]"
          headerExtra={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total trips:</span>
                <span className="text-sm font-bold tabular-nums">{shown.length}</span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Spent:</span>
                <span className="text-sm font-bold tabular-nums text-negative">{formatMoneyWhole(totalSpent, currency)}</span>
              </span>
              {totalPlanned > 0 ? (
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Planned:</span>
                  <span className="text-sm font-bold tabular-nums text-muted">{formatMoneyWhole(totalPlanned, currency)}</span>
                </span>
              ) : null}
              <SearchBox value={query} onChange={setQuery} placeholder="Search trip, hotel, flight…" label="Search trips" className="w-44" />
              {yearSelect}
            </span>
          }
        >
          {table}
          {byYearRows.length > 1 || savedByYear ? (
            <div className="grid items-start gap-x-8 gap-y-4 border-t border-line px-4 py-3 sm:px-6 md:grid-cols-2">
              {byYearRows.length > 1 ? (
              <div className="min-w-0">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Travel Combined by Year</h3>
              <div className="overflow-x-auto">
                <table className="min-w-[28rem] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-muted">
                      <th className="px-3 py-1 text-center font-semibold">Year</th>
                      <th className="px-3 py-1 text-center font-semibold">Trips</th>
                      <th className="whitespace-nowrap px-3 py-1 text-center font-semibold">Spent</th>
                      <th className="whitespace-nowrap px-3 py-1 text-center font-semibold">Planned</th>
                      <th className="whitespace-nowrap px-3 py-1 text-center font-semibold">Pts used</th>
                      <th className="px-3 py-1 text-center font-semibold">Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byYearRows.map(([y, row]) => (
                      <tr key={y} className="border-t border-line/60">
                        <td className="px-3 py-1.5 text-center font-semibold tabular-nums">{y}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums">{row ? row.trips : DASH}</td>
                        <td className="px-3 py-1.5 text-center font-semibold tabular-nums text-negative">
                          {row ? money(row.total) : DASH}
                        </td>
                        <td className="px-3 py-1.5 text-center tabular-nums text-muted">
                          {row ? money(row.planned) : DASH}
                        </td>
                        <td className="px-3 py-1.5 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                          {row && row.points > 0 ? row.points.toLocaleString() : DASH}
                        </td>
                        <td className="px-3 py-1.5 text-center tabular-nums text-positive">{row ? money(row.saved) : DASH}</td>
                      </tr>
                    ))}
                  </tbody>
                  {/* The same Total line the stays rollup beside it carries. */}
                  <tfoot>
                    <tr className="border-t-2 border-line font-bold">
                      <td className="px-3 py-1.5 text-center">Total</td>
                      <td className="px-3 py-1.5 text-center tabular-nums">{byYearTotals.trips}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums text-negative">
                        {formatMoneyWhole(byYearTotals.total, currency)}
                      </td>
                      <td className="px-3 py-1.5 text-center tabular-nums text-muted">
                        {money(byYearTotals.planned)}
                      </td>
                      <td className="px-3 py-1.5 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {byYearTotals.points > 0 ? byYearTotals.points.toLocaleString() : DASH}
                      </td>
                      <td className="px-3 py-1.5 text-center tabular-nums text-positive">{money(byYearTotals.saved)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              </div>
              ) : null}
              {savedByYear ? (
                /* The rule between the two rollups, from md up — side by side
                   they read as one table without it. It stacks on a phone,
                   where the rule would sit across the middle of the page. */
                <div
                  /* The shared table rhythm: the hotel rollup keeps its own
                     markup, but its header stays on one line and its rows take
                     the same padding as "By year", so the two year columns sit
                     on the same lines. */
                  className={`min-w-0 [&_th]:whitespace-nowrap [&_th]:py-1 [&_td]:py-1.5 ${byYearRows.length > 1 ? "md:border-l md:border-line md:pl-8" : ""}`}
                >
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Total Stays Cost/Saved by Year</h3>
                  {savedByYear}
                </div>
              ) : null}
            </div>
          ) : null}
        </ModalShell>
      ) : null}
    </section>
  );
}

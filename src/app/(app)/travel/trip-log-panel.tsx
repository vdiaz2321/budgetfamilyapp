"use client";

import { useMemo, useState } from "react";
import { ExpandIcon } from "./travel-board";
import { SearchBox } from "./search-box";
import { YearPicker, inYears, useSessionYears } from "./year-picker";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney } from "@/lib/money";
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
// the rental last.
const MONEY_COLUMNS: { label: string; read: (t: TripSummary) => number }[] = [
  { label: "Flights", read: (t) => t.flights },
  { label: "Hotels", read: (t) => t.hotels },
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
  ).map(([key, label]) => ({ label, read: (t: TripSummary) => t.misc[key] })),
  { label: "Rental", read: (t) => t.rentals },
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
}: {
  summaries: TripSummary[];
  currency: string;
  onOpenTrip: (tripId: string) => void;
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
  // This year on a fresh login; a pick afterwards is remembered for the session.
  const [year, setYear] = useSessionYears("travel-trip-log-years", () => [String(new Date().getFullYear())]);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = summaries.filter(
    (t) => inYears(year, t.start?.slice(0, 4)) && (!q || searchText(t).includes(q)),
  );

  const sum = (read: (t: TripSummary) => number) => shown.reduce((total, t) => total + read(t), 0);
  const totalSpent = sum((t) => t.total);

  // The sheet's year block: what each year's trips came to.
  const byYear = useMemo(() => {
    const map = new Map<string, { trips: number; total: number; saved: number; points: number }>();
    for (const t of summaries) {
      const y = t.start?.slice(0, 4);
      if (!y) continue;
      const row = map.get(y) ?? { trips: 0, total: 0, saved: 0, points: 0 };
      row.trips += 1;
      row.total += t.total;
      row.saved += t.saved;
      row.points += t.points;
      map.set(y, row);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [summaries]);

  const money = (cents: number) => (cents > 0 ? formatMoney(cents, currency) : DASH);

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
            <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">Total spent</th>
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
                <span className="block max-w-[14rem] truncate">{placeName(t.trip.name)}</span>
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-muted">
                {t.start ? sheetDateRange(t.start, t.end) : DASH}
              </td>
              <td className="px-2 py-2 text-center tabular-nums">{t.nights ?? DASH}</td>
              {MONEY_COLUMNS.map((c) => (
                <td key={c.label} className="whitespace-nowrap px-2 py-2 text-center tabular-nums">{money(c.read(t))}</td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 text-center font-bold tabular-nums text-negative">
                {money(t.total)}
                {t.hasEstimates ? <span className="block text-[10px] font-semibold text-muted">incl. planned</span> : null}
              </td>
              <td className="px-2 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                {t.points > 0 ? t.points.toLocaleString() : <span className="text-muted">{DASH}</span>}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-center font-semibold tabular-nums text-positive">
                {t.saved > 0 ? formatMoney(t.saved, currency) : <span className="font-normal text-muted">{DASH}</span>}
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
                <td key={c.label} className="whitespace-nowrap px-2 py-2 text-center tabular-nums">{money(sum(c.read))}</td>
              ))}
              <td className="whitespace-nowrap px-2 py-2 text-center tabular-nums text-negative">{money(totalSpent)}</td>
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 text-left"
        >
          <ExpandIcon />
          <span className="text-sm font-bold">Travel Combined Log</span>
        </button>
        {/* Collapsed the card carries the one figure and the year it covers.
            The trip count and the search belong to the table, which only ever
            opens full width. */}
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total spent:</span>
          <span className="text-sm font-bold tabular-nums text-negative">{formatMoney(totalSpent, currency)}</span>
        </span>
        {yearSelect}
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
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total spent:</span>
                <span className="text-sm font-bold tabular-nums text-negative">{formatMoney(totalSpent, currency)}</span>
              </span>
              <SearchBox value={query} onChange={setQuery} placeholder="Search trip, hotel, flight…" label="Search trips" className="w-44" />
              {yearSelect}
            </span>
          }
        >
          {table}
          {byYear.length > 1 ? (
            <div className="border-t border-line px-4 py-3 sm:px-6">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">By year</h3>
              <div className="overflow-x-auto">
                <table className="min-w-[28rem] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-muted">
                      <th className="px-3 py-1 text-center font-semibold">Year</th>
                      <th className="px-3 py-1 text-center font-semibold">Trips</th>
                      <th className="whitespace-nowrap px-3 py-1 text-center font-semibold">Total spent</th>
                      <th className="whitespace-nowrap px-3 py-1 text-center font-semibold">Pts used</th>
                      <th className="px-3 py-1 text-center font-semibold">Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byYear.map(([y, row]) => (
                      <tr key={y} className="border-t border-line/60">
                        <td className="px-3 py-1.5 text-center font-semibold tabular-nums">{y}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums">{row.trips}</td>
                        <td className="px-3 py-1.5 text-center font-semibold tabular-nums text-negative">{formatMoney(row.total, currency)}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                          {row.points > 0 ? row.points.toLocaleString() : DASH}
                        </td>
                        <td className="px-3 py-1.5 text-center tabular-nums text-positive">{money(row.saved)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </ModalShell>
      ) : null}
    </section>
  );
}

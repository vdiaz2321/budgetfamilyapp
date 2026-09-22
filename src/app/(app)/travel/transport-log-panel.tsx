"use client";

import { useMemo, useState } from "react";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney } from "@/lib/money";
import { ExpandIcon } from "./travel-board";
import { CarsList } from "./cars-panel";
import { FlightsList } from "./flights-panel";
import { SearchBox } from "./search-box";
import { YearPicker, inYears, thisAndFutureYears, useSessionYears } from "./year-picker";
import type { TravelCar, TravelFlight } from "./types";

// What the search matches on a flight: airline, booking code, flight numbers,
// airports and who flew.
function flightText(f: TravelFlight): string {
  return [
    f.airline,
    f.bookingCode,
    ...f.legs.flatMap((l) => [l.flightNumber, l.fromPlace, l.toPlace]),
    ...f.passengers.map((p) => p.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function carText(c: TravelCar): string {
  return [c.company, c.bookingCode, c.pickupPlace, c.returnPlace].filter(Boolean).join(" ").toLowerCase();
}

/**
 * Flights and rentals in one card: how you got there and got around. Each
 * keeps its own list under a small heading; the header adds both up.
 */
export function TransportLogPanel({
  flights,
  cars,
  currency,
  onEditFlight,
  onEditCar,
}: {
  flights: TravelFlight[];
  cars: TravelCar[];
  currency: string;
  onEditFlight: (flight: TravelFlight) => void;
  onEditCar: (car: TravelCar) => void;
}) {
  // The list opens in a full-width popup rather than unfolding here: this card
  // is a third of a row, and the flight rows need the whole width.
  const [expanded, setExpanded] = useState(false);
  const years = useMemo(
    () =>
      Array.from(new Set([...flights.map((f) => f.firstFlightOn.slice(0, 4)), ...cars.map((c) => c.pickupOn.slice(0, 4))]))
        .sort()
        .reverse(),
    [flights, cars],
  );
  // This year plus any later year with a booking; every year (none ticked)
  // when neither has anything.
  const [year, setYear] = useSessionYears("travel-transport-log-years", () => {
    const current = String(new Date().getFullYear());
    return years.some((y) => y >= current) ? thisAndFutureYears(years, current) : [];
  });
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shownFlights = flights.filter(
    (f) => inYears(year, f.firstFlightOn.slice(0, 4)) && (!q || flightText(f).includes(q)),
  );
  const shownCars = cars.filter((c) => inYears(year, c.pickupOn.slice(0, 4)) && (!q || carText(c).includes(q)));
  const total =
    shownFlights.filter((f) => !f.cancelledAt).reduce((sum, f) => sum + f.pocketCostCents, 0) +
    shownCars.filter((c) => !c.cancelledAt).reduce((sum, c) => sum + c.pocketCostCents, 0);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Kept to one line — see the note on the Travel Combined Log header. */}
      {/* Whole row opens the log — see the note on the Travel Combined Log
          header; the year picker stops the click. */}
      <div
        onClick={() => setExpanded(true)}
        className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 transition hover:bg-black/[0.03] sm:flex-nowrap dark:hover:bg-white/[0.06]"
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <ExpandIcon />
          <span className="text-sm font-bold sm:truncate">Flights &amp; Rentals Log</span>
        </button>
        {/* One figure and the year it covers; the counts and the search open
            with the list. */}
        <Figure label="Spent" value={formatMoney(total, currency)} className="text-negative" />
        <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <YearPicker years={years} value={year} onChange={setYear} label="Flights & Rentals Log year" />
        </span>
      </div>

      {expanded ? (
        <ModalShell
          title="Flights & Rentals Log"
          onClose={() => setExpanded(false)}
          className="sm:max-w-[96vw]"
          headerExtra={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Figure label="Total flights" value={String(shownFlights.length)} />
              <Figure label="Total rentals" value={String(shownCars.length)} />
              <Figure label="Spent" value={formatMoney(total, currency)} className="text-negative" />
              <SearchBox value={query} onChange={setQuery} placeholder="Search airline, airport…" label="Search flights and rentals" className="w-44" />
              <YearPicker years={years} value={year} onChange={setYear} label="Flights & Rentals Log year" />
            </span>
          }
        >
          {shownFlights.length > 0 ? (
            <>
              <GroupHeading title="Flights" />
              <FlightsList flights={shownFlights} currency={currency} onEdit={onEditFlight} />
            </>
          ) : null}
          {shownCars.length > 0 ? (
            <>
              <GroupHeading title="Rentals" divided={shownFlights.length > 0} />
              <CarsList cars={shownCars} currency={currency} onEdit={onEditCar} />
            </>
          ) : null}
          {shownFlights.length === 0 && shownCars.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted sm:px-6">No flights or rentals match.</p>
          ) : null}
        </ModalShell>
      ) : null}
    </section>
  );
}

function GroupHeading({ title, divided }: { title: string; divided?: boolean }) {
  return (
    <h3
      className={`border-b border-line bg-black/[0.02] px-4 py-2 text-xs font-bold uppercase tracking-wide text-muted dark:bg-white/[0.04] sm:px-6 ${divided ? "border-t" : ""}`}
    >
      {title}
    </h3>
  );
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted">{label}:</span>
      <span className={`text-sm font-bold tabular-nums ${className ?? ""}`}>{value}</span>
    </span>
  );
}

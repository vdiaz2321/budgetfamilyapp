"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { CarsList } from "./cars-panel";
import { FlightsList } from "./flights-panel";
import { SearchBox } from "./search-box";
import { YearPicker, inYears, useSessionYears } from "./year-picker";
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
  const [state, setState] = useSessionCollapse("travel-transport-log", () => ({ open: false }));
  const open = !!state.open;
  const years = useMemo(
    () =>
      Array.from(new Set([...flights.map((f) => f.firstFlightOn.slice(0, 4)), ...cars.map((c) => c.pickupOn.slice(0, 4))]))
        .sort()
        .reverse(),
    [flights, cars],
  );
  // This year when it has anything booked, otherwise every year (none ticked).
  const [year, setYear] = useSessionYears("travel-transport-log-years", () => {
    const current = String(new Date().getFullYear());
    return years.includes(current) ? [current] : [];
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
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 ${open ? "border-b border-line" : ""}`}>
        <button
          type="button"
          onClick={() => setState({ open: !open })}
          aria-expanded={open}
          className="flex items-center gap-2 text-left"
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
          <span className="text-sm font-bold">Flights &amp; Rentals Log</span>
        </button>
        <Figure label="Total flights" value={String(shownFlights.length)} />
        <Figure label="Total rentals" value={String(shownCars.length)} />
        <Figure label="Total spent" value={formatMoney(total, currency)} className="text-negative" />
        <SearchBox value={query} onChange={setQuery} placeholder="Search airline, airport…" label="Search flights and rentals" className="w-44" />
        <YearPicker years={years} value={year} onChange={setYear} label="Flights & Rentals Log year" className="ml-auto" />
      </div>

      {open ? (
        <>
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
        </>
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
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}:</span>
      <span className={`text-sm font-bold tabular-nums ${className ?? ""}`}>{value}</span>
    </span>
  );
}

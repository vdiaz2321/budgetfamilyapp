"use client";

import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { CarsList } from "./cars-panel";
import { FlightsList } from "./flights-panel";
import type { TravelCar, TravelFlight } from "./types";

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
  const [state, setState] = useSessionCollapse("travel-transport-log", () => ({ open: true }));
  const open = !!state.open;
  const total =
    flights.filter((f) => !f.cancelledAt).reduce((sum, f) => sum + f.pocketCostCents, 0) +
    cars.filter((c) => !c.cancelledAt).reduce((sum, c) => sum + c.pocketCostCents, 0);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setState({ open: !open })}
        aria-expanded={open}
        className={`flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:px-6 ${open ? "border-b border-line" : ""}`}
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
          <span className="text-sm font-bold">Flights &amp; Rentals Log</span>
        </span>
        <Figure label="Total flights" value={String(flights.length)} />
        <Figure label="Total rentals" value={String(cars.length)} />
        <Figure label="Total spent" value={formatMoney(total, currency)} className="text-negative" />
      </button>

      {open ? (
        <>
          {flights.length > 0 ? (
            <>
              <GroupHeading title="Flights" />
              <FlightsList flights={flights} currency={currency} onEdit={onEditFlight} />
            </>
          ) : null}
          {cars.length > 0 ? (
            <>
              <GroupHeading title="Rentals" divided={flights.length > 0} />
              <CarsList cars={cars} currency={currency} onEdit={onEditCar} />
            </>
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

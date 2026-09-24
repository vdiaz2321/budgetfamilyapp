"use client";

import { formatMoneyWhole } from "@/lib/money";
import { sheetDateRange } from "./trip-summary";
import type { TravelFlight } from "./types";

// "Stuttgart → Málaga → Stuttgart": each place once, in flying order. A gap
// between legs (landing in one city, leaving from another) shows both.
function route(flight: TravelFlight): string {
  const stops: string[] = [];
  for (const leg of flight.legs) {
    if (leg.fromPlace && stops[stops.length - 1] !== leg.fromPlace) stops.push(leg.fromPlace);
    if (leg.toPlace) stops.push(leg.toPlace);
  }
  return stops.join(" → ");
}

/**
 * Every flight booking, newest first. One row per booking: a round trip reads
 * as one line with both dates, its route, who flew and what it cost.
 */
export function FlightsList({
  flights,
  currency,
  onEdit,
}: {
  flights: TravelFlight[];
  currency: string;
  onEdit: (flight: TravelFlight) => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {flights.map((f) => {
        const first = f.legs[0]?.flightOn ?? f.firstFlightOn;
        const last = f.legs[f.legs.length - 1]?.flightOn ?? first;
        return (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onEdit(f)}
              className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:flex-nowrap sm:px-6 ${f.cancelledAt ? "opacity-60" : ""}`}
            >
              <span className="flex min-w-0 flex-1 basis-full flex-col gap-y-0.5 sm:basis-0 sm:flex-row sm:items-center sm:gap-x-3">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 sm:shrink-0">
                  <span className="truncate text-sm font-semibold">{route(f) || f.airline}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {f.airline}
                    {f.bookingCode ? <span className="text-slate-700 dark:text-neutral-200"> · {f.bookingCode}</span> : null}
                  </span>
                  {f.isEstimate ? (
                    <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
                      Planned fare
                    </span>
                  ) : null}
                  {f.cancelledAt ? (
                    <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
                      Cancelled
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
                  <span className="tabular-nums">
                    {sheetDateRange(first, last)}
                  </span>
                  <span>{f.passengers.map((p) => p.name).join(", ")}</span>
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
                {f.pointsUsed && f.pointsCost > 0 ? (
                  <Figure label="Pts used" value={f.pointsCost.toLocaleString()} style={{ color: "var(--viz-savings)" }} />
                ) : null}
                <Figure label="Flight cost" value={formatMoneyWhole(f.flightCostCents, currency)} />
                {/* Only when points paid part of it — otherwise it repeats the flight cost. */}
                {f.pocketCostCents !== f.flightCostCents ? (
                  <Figure
                    label="Pocket cost"
                    value={formatMoneyWhole(f.pocketCostCents, currency)}
                    className={f.pocketCostCents > 0 ? "text-negative" : "text-muted"}
                  />
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Figure({
  label,
  value,
  className,
  style,
}: {
  label: string;
  value: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}:</span>
      <span className={`text-sm font-bold tabular-nums ${className ?? ""}`} style={style}>{value}</span>
    </span>
  );
}

"use client";

import { formatMoney } from "@/lib/money";
import { sheetDateRange } from "./trip-summary";
import type { TravelCar } from "./types";

/** Car rentals and family-car drives, newest first — one line each. */
export function CarsList({
  cars,
  currency,
  onEdit,
}: {
  cars: TravelCar[];
  currency: string;
  onEdit: (car: TravelCar) => void;
}) {
  return (
    <ul className="divide-y divide-line">
      {cars.map((c) => {
        const rental = c.kind === "rental";
        const places = [c.pickupPlace, c.returnPlace && c.returnPlace !== c.pickupPlace ? c.returnPlace : null]
          .filter(Boolean)
          .join(" → ");
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onEdit(c)}
              className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06] sm:flex-nowrap sm:px-6 ${c.cancelledAt ? "opacity-60" : ""}`}
            >
              <span className="flex min-w-0 flex-1 basis-full flex-col gap-y-0.5 sm:basis-0 sm:flex-row sm:items-center sm:gap-x-3">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 sm:shrink-0">
                  <span className="truncate text-sm font-semibold">
                    {rental ? c.company ?? "Car rental" : places || "Drive"}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {rental ? "Rental" : "Our car"}
                    {c.bookingCode ? <span className="text-slate-700 dark:text-neutral-200"> · {c.bookingCode}</span> : null}
                  </span>
                  {c.isEstimate ? (
                    <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
                      Planned
                    </span>
                  ) : null}
                  {c.cancelledAt ? (
                    <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
                      Cancelled
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
                  <span className="tabular-nums">
                    {sheetDateRange(c.pickupOn, c.returnOn)}
                  </span>
                  {rental && places ? <span>{places}</span> : null}
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
                {c.pointsUsed && c.pointsCost > 0 ? (
                  <Figure label="Pts used" value={c.pointsCost.toLocaleString()} style={{ color: "var(--viz-savings)" }} />
                ) : null}
                <Figure label={rental ? "Rental cost" : "Fuel & tolls"} value={formatMoney(c.costCents, currency)} />
                {/* Only when points paid part of it — otherwise it repeats the cost. */}
                {c.pocketCostCents !== c.costCents ? (
                  <Figure
                    label="Pocket cost"
                    value={formatMoney(c.pocketCostCents, currency)}
                    className={c.pocketCostCents > 0 ? "text-negative" : "text-muted"}
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

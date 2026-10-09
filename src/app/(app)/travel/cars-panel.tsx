"use client";

import { formatMoneyWhole } from "@/lib/money";
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
      {/* Desktop column headers — the rows below sit in the same grid, so
          every figure lines up under its label. Sticky inside the popup's
          scrolling body. Phones keep the stacked, self-labelled rows. */}
      <li className="sticky top-0 z-10 hidden bg-surface px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-foreground shadow-[inset_0_-1px_0_var(--color-line)] sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_10rem_minmax(0,1.2fr)_6.5rem_6.5rem_6.5rem] sm:gap-x-3">
        <span>Rental</span>
        <span>Type</span>
        <span className="text-center">Dates</span>
        <span>Pick-up → return</span>
        <span className="text-center">Pts used</span>
        <span className="text-center">Pocket cost</span>
        <span className="text-center">Cost</span>
      </li>
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
              className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-sky-50 dark:hover:bg-sky-950/40 sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_10rem_minmax(0,1.2fr)_6.5rem_6.5rem_6.5rem] sm:gap-x-3 sm:px-6 ${c.cancelledAt ? "opacity-60" : ""}`}
            >
              <span className="flex min-w-0 flex-1 basis-full flex-col gap-y-0.5 sm:contents">
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 sm:contents">
                  <span className="truncate text-sm font-semibold sm:whitespace-normal">
                    {rental ? c.company ?? "Car rental" : places || "Drive"}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold sm:!text-sm text-foreground dark:bg-sky-900/50 dark:text-foreground">
                      {rental ? "Rental" : "Our car"}
                      {c.bookingCode ? <span className="text-foreground dark:text-foreground"> · {c.bookingCode}</span> : null}
                    </span>
                    {c.isEstimate ? (
                      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold sm:!text-sm text-muted dark:bg-sky-900/50">
                        Planned
                      </span>
                    ) : null}
                    {c.cancelledAt ? (
                      <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold sm:!text-sm text-muted dark:bg-sky-900/50">
                        Cancelled
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted sm:contents sm:text-sm">
                  <span className="tabular-nums sm:text-center">
                    {sheetDateRange(c.pickupOn, c.returnOn)}
                  </span>
                  {rental && places ? <span>{places}</span> : <span className="hidden sm:block" />}
                </span>
              </span>
              {/* Desktop order matches the headers: points, pocket, cost —
                  an absent figure keeps an empty cell so columns stay put. */}
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:contents">
                {c.pointsUsed && c.pointsCost > 0 ? (
                  <Figure label="Pts used" value={c.pointsCost.toLocaleString()} style={{ color: "var(--viz-savings)" }} />
                ) : <span className="hidden sm:block" />}
                {/* Only when points paid part of it — otherwise it repeats the cost. */}
                {c.pocketCostCents !== c.costCents ? (
                  <Figure
                    label="Pocket cost"
                    value={formatMoneyWhole(c.pocketCostCents, currency)}
                    className={c.pocketCostCents > 0 ? "text-negative" : "text-muted"}
                  />
                ) : <span className="hidden sm:block" />}
                <Figure label={rental ? "Rental cost" : "Fuel & tolls"} value={formatMoneyWhole(c.costCents, currency)} />
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
    <span className="flex items-baseline gap-1.5 sm:justify-center">
      {/* Desktop shows the label once, in the column header. */}
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted sm:hidden">{label}:</span>
      <span className={`text-sm font-semibold tabular-nums ${className ?? ""}`} style={style}>{value}</span>
    </span>
  );
}

"use client";

import { formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import type { TravelCar } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function sheetDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}

/** Car rentals and family-car drives, newest first — one line each. */
export function CarsPanel({
  cars,
  currency,
  onEdit,
}: {
  cars: TravelCar[];
  currency: string;
  onEdit: (car: TravelCar) => void;
}) {
  const [state, setState] = useSessionCollapse("travel-cars-log", () => ({ open: true }));
  const open = !!state.open;
  const total = cars.filter((c) => !c.cancelledAt).reduce((sum, c) => sum + c.pocketCostCents, 0);

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setState({ open: !open })}
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
          <span className="text-sm font-bold">Rental Log</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-muted dark:bg-white/10">
            {cars.length} {cars.length === 1 ? "entry" : "entries"}
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Total spent:</span>
            <span className="text-sm font-bold tabular-nums text-negative">{formatMoney(total, currency)}</span>
          </span>
        </span>
      </button>

      {open ? (
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
                  <span className="flex min-w-0 flex-1 basis-full flex-col gap-y-0.5 sm:basis-0">
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">
                        {rental ? c.company ?? "Car rental" : places || "Drive"}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {rental ? "Rental" : "Our car"}
                        {c.bookingCode ? <span className="text-slate-700 dark:text-slate-200"> · {c.bookingCode}</span> : null}
                      </span>
                      {c.cancelledAt ? (
                        <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
                          Cancelled
                        </span>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
                      <span className="tabular-nums">
                        {sheetDate(c.pickupOn)}
                        {c.returnOn && c.returnOn !== c.pickupOn ? ` – ${sheetDate(c.returnOn)}` : ""}
                      </span>
                      {rental && places ? <span>{places}</span> : null}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 sm:shrink-0 sm:gap-x-4">
                    {c.pointsUsed && c.pointsCost > 0 ? (
                      <Figure label="Pts used" value={c.pointsCost.toLocaleString()} style={{ color: "var(--viz-savings)" }} />
                    ) : null}
                    <Figure label={rental ? "Rental cost" : "Fuel & tolls"} value={formatMoney(c.costCents, currency)} />
                    <Figure
                      label="Pocket cost"
                      value={formatMoney(c.pocketCostCents, currency)}
                      className={c.pocketCostCents > 0 ? "text-negative" : "text-muted"}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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

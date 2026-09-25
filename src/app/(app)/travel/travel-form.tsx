// Field pieces shared by the Travel Log's flight, stay and car forms.

import { FX_CURRENCIES } from "@/components/currency-converter";
import { currencySymbol, foreignSymbol } from "@/lib/money";
import type { TravelTrip } from "./types";

/**
 * A date typed outside the trip it is being filed under — nearly always the
 * wrong year. The server refuses it too (tripDateError); this says so sooner.
 */
export function outsideTripNote(trips: TravelTrip[] | undefined, tripId: string, dates: string[]): string | null {
  const trip = trips?.find((t) => t.id === tripId);
  if (!trip || (!trip.startOn && !trip.endOn)) return null;
  const typed = dates.filter(Boolean);
  const outside = typed.some((d) => (trip.startOn && d < trip.startOn) || (trip.endOn && d > trip.endOn));
  if (!outside) return null;
  const short = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "…";
  return `Outside ${trip.name} (${short(trip.startOn)} – ${short(trip.endOn)}) — won't save; check the year`;
}

/**
 * A booking is bought once anything is typed under Spent, or its booking date
 * is filled in; until then it is a plan. Planned and Spent sit side by side,
 * so there is no switch to flip.
 */
export function isPlannedOnly(spentTyped: boolean, reservedOn: string): boolean {
  return !spentTyped && !reservedOn.trim();
}

/**
 * Shown while a booking is still only planned and its points are ticked as
 * used: nothing leaves the card until it is bought.
 */
export function PlannedPointsNote({ show, what = "points" }: { show: boolean; what?: string }) {
  if (!show) return null;
  return (
    <p className="text-[11px] font-medium text-negative">
      Still planned — no {what} come off the card until a Spent amount or the booking date is entered.
    </p>
  );
}

/** The booking's second currency — the one its foreign columns are in. */
export function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-background px-2 text-xs font-semibold ring-1 ring-line">
      <span className="text-muted">Other currency:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent font-semibold focus:outline-none"
      >
        {FX_CURRENCIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}

/** A booking's cost as planned and as spent, each in dollars and its other currency. */
export type PlanSpent = { planned: string; plannedForeign: string; spent: string; spentForeign: string };
export type PlanSpentSlot = keyof PlanSpent;

/**
 * Planned and Spent side by side — one set of boxes for the plan, one for what
 * was paid, instead of a switch that flips one set between the two. Two per
 * row on a phone, all four on one line from sm up.
 */
export function PlanSpentFields({
  value,
  onChange,
  currency,
  foreignCurrency,
  what = "cost",
  onFocusSlot,
}: {
  value: PlanSpent;
  onChange: (next: PlanSpent) => void;
  currency: string;
  foreignCurrency: string;
  /** "cost", "hotel cost", … — read in the labels as "Planned cost ($)". */
  what?: string;
  /** The last box clicked into, so the currency converter can fill it. */
  onFocusSlot?: (slot: PlanSpentSlot) => void;
}) {
  const usd = currencySymbol(currency);
  const fx = foreignSymbol(foreignCurrency);
  const boxes: { slot: PlanSpentSlot; label: string }[] = [
    { slot: "planned", label: `Planned ${what} (${usd})` },
    { slot: "plannedForeign", label: `Planned ${what} (${fx})` },
    { slot: "spent", label: `Spent ${what} (${usd})` },
    { slot: "spentForeign", label: `Spent ${what} (${fx})` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {boxes.map((b) => (
        <Field key={b.slot} label={b.label}>
          <input
            value={value[b.slot]}
            onChange={(e) => onChange({ ...value, [b.slot]: e.target.value })}
            onFocus={() => onFocusSlot?.(b.slot)}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500";

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
        {/* An opened currency converter takes the whole line under the title. */}
        {action ? <div className="has-[.rounded-xl]:basis-full">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${className ?? ""}`}>
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

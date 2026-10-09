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
    <p className="text-xs font-medium text-negative">
      Still planned — no {what} come off the card until a Spent amount or the booking date is entered.
    </p>
  );
}

/** The booking's second currency — the one its foreign columns are in. */
/** The outline for the small pill controls at the top of a booking's costs. */
export const PILL_CONTROL =
  "ring-1 ring-black/25! transition hover:bg-sky-100 hover:ring-sky-400! dark:ring-white/30! dark:hover:bg-sky-900/40 dark:hover:ring-sky-500!";

export function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    // A stronger outline and a readable label — the faint ring-line and muted
    // grey label read as disabled (Victor, 2026-09-30). Same look as the
    // form's "Paid with points" picker beside it.
    <label className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-2 text-xs font-semibold ${PILL_CONTROL}`}>
      <span className="text-foreground">Select if using other currency:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent font-semibold focus:outline-none"
      >
        {/* None — dollars only — hides the second-currency columns. */}
        <option value="">None</option>
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
  spentLocked = false,
  spentOnPoints = false,
  showForeign = true,
}: {
  value: PlanSpent;
  onChange: (next: PlanSpent) => void;
  currency: string;
  foreignCurrency: string;
  /** "cost", "hotel cost", … — read in the labels as "Planned cost ($)". */
  what?: string;
  /** The last box clicked into, so the currency converter can fill it. */
  onFocusSlot?: (slot: PlanSpentSlot) => void;
  /** Spent comes from linked transactions: shown locked, not typed. */
  spentLocked?: boolean;
  /** Paid with points: Spent is only the cash paid on top of the points, and
   *  Planned is what it would have cost. The labels say so. */
  spentOnPoints?: boolean;
  /** False hides the second-currency boxes (kept in state, still saved) —
   *  the short form shows only the home-currency figures. */
  showForeign?: boolean;
}) {
  const usd = currencySymbol(currency);
  const fx = foreignSymbol(foreignCurrency);
  const allBoxes: { slot: PlanSpentSlot; label: string }[] = [
    { slot: "planned", label: `Planned ${what} (${usd})` },
    { slot: "plannedForeign", label: `Planned ${what} (${fx})` },
    { slot: "spent", label: spentOnPoints ? `Cash paid with pts (${usd})` : `Spent ${what} (${usd})` },
    { slot: "spentForeign", label: spentOnPoints ? `Cash paid with pts (${fx})` : `Spent ${what} (${fx})` },
  ];
  const boxes = allBoxes.filter((b) => showForeign || !b.slot.endsWith("Foreign"));
  const box = (b: (typeof boxes)[number]) => {
    const locked = spentLocked && b.slot === "spent";
    return (
      <Field key={b.slot} label={b.label}>
        <input
          value={value[b.slot]}
          onChange={(e) => onChange({ ...value, [b.slot]: e.target.value })}
          onFocus={() => onFocusSlot?.(b.slot)}
          readOnly={locked}
          tabIndex={locked ? -1 : undefined}
          inputMode="decimal"
          className={`${inputClass} ${locked ? "opacity-70" : ""}`}
        />
        {locked ? <PaidNote linked /> : null}
      </Field>
    );
  };
  // Planned and Spent each in their own group; Spent's sits in the blue
  // frame the flight form and trip tables use, so the two never blur.
  const group = showForeign ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3";
  return (
    <div className={`grid gap-3 ${showForeign ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
      <div className={`${group} p-2`}>{boxes.filter((b) => b.slot.startsWith("planned")).map(box)}</div>
      <div className={`${group} rounded-lg p-2 ring-2 ring-sky-400 dark:ring-sky-500`}>
        {boxes.filter((b) => b.slot.startsWith("spent")).map(box)}
      </div>
    </div>
  );
}

// Under a locked Pocket cost: where its figure comes from. It shows only the
// linked payments and stays blank until one is linked (Victor, 2026-09-30) —
// the trip still counts the Spent figures typed here until then.
export function PaidNote({ linked }: { linked: boolean }) {
  return (
    <span className="mt-0.5 block text-[11px] font-medium text-muted">
      {linked ? "From linked transactions" : "Fills in from linked transactions"}
    </span>
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
      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * The line between a booking form's basics and the rest (points, credits,
 * the second currency, card owner, remarks). The rest stays mounted while
 * hidden, so nothing typed there is lost or left out of the save.
 */
export function MoreDetailsToggle({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex w-full items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-left text-xs font-semibold text-foreground transition hover:bg-sky-50 dark:hover:bg-sky-950/40 ${className ?? ""}`}
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 7.5 10 12.5 15 7.5" />
      </svg>
      {open ? "Fewer details" : "More details: points, credits, other currency, card owner, remarks"}
    </button>
  );
}

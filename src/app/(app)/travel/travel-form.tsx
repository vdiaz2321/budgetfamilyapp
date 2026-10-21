// Field pieces shared by the Travel Log's flight, stay and car forms.

import { useEffect, useRef, useState } from "react";
import { FX_CURRENCIES, loadFxRates } from "@/components/currency-converter";
import { centsToDisplay, currencySymbol, foreignSymbol } from "@/lib/money";
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
 * A booking date with nothing in Spent: booked but nothing paid, so it counted
 * in neither Spent nor the plan still to go (the Budget and the trip log both
 * missed it). Refused with what to do instead. A booking on points, a free
 * night, pay-at-check-in or linked payments has a reason to be empty.
 */
export function spentMissingError(opts: {
  reservedOn: string;
  spentTyped: boolean;
  exempt: boolean;
  dateLabel: string;
  alsoTry?: string;
}): string | null {
  if (!opts.reservedOn.trim() || opts.spentTyped || opts.exempt) return null;
  return `${opts.dateLabel} has a date, so it counts as booked — enter what you paid in Spent, or clear the date to keep it as a plan.${opts.alsoTry ? ` ${opts.alsoTry}` : ""}`;
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
    // The real <select> is stretched invisibly over the whole pill, so a click
    // on the words opens the list too — not just a click on the code.
    <label className={`relative inline-flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-lg bg-background px-2 text-xs font-semibold focus-within:ring-2! focus-within:ring-sky-500! sm:text-sm ${PILL_CONTROL}`}>
      <span className="text-foreground">Select if using other currency:</span>
      <span>{value || "None"}</span>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 7.5 10 12.5 15 7.5" />
      </svg>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Other currency"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
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
  onOpenSpent,
  spentOnPoints = false,
  showForeign = true,
  spentRateDate,
  picker,
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
  /** Opens those linked transactions — clicking the locked box does it. */
  onOpenSpent?: () => void;
  /** Paid with points: Spent is only the cash paid on top of the points, and
   *  Planned is what it would have cost. The labels say so. */
  spentOnPoints?: boolean;
  /** False hides the second-currency boxes (kept in state, still saved) —
   *  the short form shows only the home-currency figures. */
  showForeign?: boolean;
  /** The booking date: Spent converts at that day's rate (what the card
   *  charged); Planned at today's. Blank → today's for both. */
  spentRateDate?: string;
  /** The currency picker. Dollars only, it shares the row with the two
   *  boxes instead of taking a line of its own above two half-width boxes. */
  picker?: React.ReactNode;
}) {
  const usd = currencySymbol(currency);
  // Typing in a foreign box fills the dollar box beside it, the way the
  // flight form does. Rates load as soon as a currency is picked.
  const [rates, setRates] = useState<{ key: string; planned: Record<string, number> | null; spent: Record<string, number> | null } | null>(null);
  const ratesKey = `${foreignCurrency}|${spentRateDate ?? ""}`;
  useEffect(() => {
    if (!foreignCurrency) return;
    let live = true;
    Promise.all([loadFxRates(), loadFxRates(spentRateDate || undefined)]).then(([planned, spent]) => {
      if (live) setRates({ key: ratesKey, planned, spent });
    });
    return () => { live = false; };
  }, [foreignCurrency, spentRateDate, ratesKey]);
  const toUsd = (raw: string, spent: boolean): string | null => {
    const rate = rates?.key === ratesKey ? (spent ? rates.spent : rates.planned)?.[foreignCurrency] : undefined;
    if (!rate) return null;
    if (!raw.trim()) return "";
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? centsToDisplay(Math.round((n / rate) * 100)) : null;
  };
  const fromUsd = (raw: string, spent: boolean): string | null => {
    const rate = rates?.key === ratesKey ? (spent ? rates.spent : rates.planned)?.[foreignCurrency] : undefined;
    if (!rate) return null;
    if (!raw.trim()) return "";
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? centsToDisplay(Math.round(n * rate * 100)) : null;
  };
  // Boxes this form filled in by converting, not typed — those may be
  // refilled; a figure typed by hand (the card's real charge) never is.
  const autoFilled = useRef(new Set<PlanSpentSlot>());
  const PARTNER: Record<PlanSpentSlot, PlanSpentSlot> = {
    planned: "plannedForeign",
    plannedForeign: "planned",
    spent: "spentForeign",
    spentForeign: "spent",
  };
  const type = (slot: PlanSpentSlot, raw: string) => {
    const next = { ...value, [slot]: raw };
    autoFilled.current.delete(slot);
    const partner = PARTNER[slot];
    const isSpent = slot.startsWith("spent");
    // Typing either box fills the other at the day's rate: euros into
    // dollars, or dollars into euros. Linked payments own Spent ($).
    if (!(isSpent && spentLocked) && (!value[partner].trim() || autoFilled.current.has(partner))) {
      const converted = slot.endsWith("Foreign") ? toUsd(raw, isSpent) : fromUsd(raw, isSpent);
      if (converted != null) {
        next[partner] = converted;
        autoFilled.current.add(partner);
      }
    }
    onChange(next);
  };
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
      <Field key={b.slot} center label={b.label} action={locked && onOpenSpent ? <OpenLinkedButton onOpen={onOpenSpent} /> : undefined}>
        <input
          value={value[b.slot]}
          onChange={(e) => type(b.slot, e.target.value)}
          onFocus={() => onFocusSlot?.(b.slot)}
          onClick={locked ? onOpenSpent : undefined}
          readOnly={locked}
          tabIndex={locked ? -1 : undefined}
          inputMode="decimal"
          className={`${inputClass} text-center ${locked ? "opacity-70" : ""} ${locked && onOpenSpent ? openableClass : ""}`}
        />
        {locked ? <PaidNote linked onOpen={onOpenSpent} /> : null}
      </Field>
    );
  };
  // Planned and Spent each in their own group; Spent's sits in the blue
  // frame the flight form and trip tables use, so the two never blur.
  const group = showForeign ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3";
  const groups = (
    <>
      <div className={`${group} p-2`}>{boxes.filter((b) => b.slot.startsWith("planned")).map(box)}</div>
      <div className={`${group} rounded-lg p-2 ring-2 ring-sky-400 dark:ring-sky-500`}>
        {boxes.filter((b) => b.slot.startsWith("spent")).map(box)}
      </div>
    </>
  );
  if (picker && !showForeign) {
    // One row: picker, Planned, Spent. The picker sits level with the boxes
    // (each group has p-2 under its box). On a phone it takes its own line.
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
        <div className="col-span-2 sm:col-span-1 sm:mb-[11px]">{picker}</div>
        {groups}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {picker ? <div>{picker}</div> : null}
      <div className={`grid gap-3 ${showForeign ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>{groups}</div>
    </div>
  );
}

// Under a locked Pocket cost: where its figure comes from. It shows only the
// linked payments and stays blank until one is linked (Victor, 2026-09-30) —
// the trip still counts the Spent figures typed here until then.
export function PaidNote({ linked, onOpen }: { linked: boolean; onOpen?: () => void }) {
  // With a payment to open, the Open button beside the box says it instead.
  if (linked && onOpen) return null;
  return (
    <span className="mt-0.5 block text-[11px] font-medium text-muted">
      {linked ? "From linked transactions" : "Fills in from linked transactions"}
    </span>
  );
}

/** Opens a booking's linked payment; sits on its Spent box's label line. */
export function OpenLinkedButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      // preventDefault: inside a <label>, a click would also reach the box,
      // which opens the payment too — a second load of the same thing.
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
      className="-my-1 shrink-0 whitespace-nowrap rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-foreground transition hover:bg-sky-200 dark:bg-sky-900/50 dark:hover:bg-sky-800/60"
    >
      {/* Just "Open" on a phone, where the full name would crowd out the
          label it sits beside. */}
      <span className="sm:hidden">Open</span>
      <span className="hidden sm:inline">Open linked transaction</span>
    </button>
  );
}

/** A locked Spent box that opens its linked payment when clicked. */
export const openableClass = "cursor-pointer hover:ring-2 hover:ring-sky-400";

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

export function Field({ label, action, center = false, className, children }: { label: string; action?: React.ReactNode; center?: boolean; className?: string; children: React.ReactNode }) {
  return (
    // center: the label sits over a centred figure, so it is centred too.
    <label className={`block min-w-0 ${center ? "text-center" : ""} ${className ?? ""}`}>
      {action ? (
        // A button on the label's own line, right after it. It keeps the
        // line's height, so the box stays level with the boxes beside it.
        <span className={`mb-0.5 flex h-[18px] items-center gap-2 ${center ? "justify-center" : ""}`}>
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
          {action}
        </span>
      ) : (
        <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      )}
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
      {open ? "Fewer details" : "More details: points, credits, card owner, remarks"}
    </button>
  );
}

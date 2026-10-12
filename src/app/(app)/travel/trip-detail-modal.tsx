"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { formatForeignWhole, formatMoneyWhole } from "@/lib/money";
import { deleteTrip, updateTrip } from "./trip-actions";
import { Field, inputClass } from "./travel-form";
import { bookingForeign, bookingPlannedOnly, bookingLines, bookingPlanActual, bookingWhen, freeCancelOpen, stayDueAtHotel, tripDate, type Booking, type BookingLine, type TripSummary } from "./trip-summary";
import { EXPENSE_CATEGORIES, actualCents, type TripTaggedPurchase } from "./types";
import { MatchPurchasesModal } from "./match-purchases-modal";
import { AddTransactionButton } from "./add-transaction-button";
import { useLinkedPayments } from "./linked-payments";

const DASH = "—";
const KIND_LABEL = { flight: "Flight", stay: "Stay", car: "Rental" } as const;

// Each booking kind gets its own tint + icon so Flight / Stay / Rental tell
// apart at a glance. Sky, teal and rose — no purple or orange.
const KIND_STYLE = {
  flight: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
  stay: "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200",
  car: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
} as const;
const KIND_ICON = {
  // plane
  flight: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  // bed
  stay: <><path d="M2 4v16" /><path d="M2 8h18a2 2 0 0 1 2 2v10" /><path d="M2 17h20" /><path d="M6 8v9" /></>,
  // car
  car: <><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A2 2 0 0 0 13.7 6H10.3a2 2 0 0 0-1.6.8L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M9 17h6" /></>,
} as const;

// The chip with the booking's first day under it ("Sun"), read at a glance
// down the column.
function KindDay({ booking, className = "" }: { booking: Booking; className?: string }) {
  const day = new Date(`${booking.start}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return (
    <span className={`flex shrink-0 flex-col items-center gap-0.5 ${className}`}>
      <KindChip kind={booking.kind} label={bookingWho(booking)} />
      <span className="text-[11px] font-semibold text-foreground">{day}</span>
    </span>
  );
}

// The booking's own remarks, under its date line.
function bookingRemarks(booking: Booking) {
  return (booking.kind === "flight" ? booking.flight : booking.kind === "stay" ? booking.stay : booking.car).remarks?.trim() || null;
}

// Who the booking is with — the airline, the hotel brand or site it was
// booked through, the rental company — named on its chip in place of the
// bare kind. The icon and tint still say which kind it is.
function bookingWho(b: Booking): string | null {
  const who = b.kind === "flight" ? b.flight.airline : b.kind === "stay" ? b.stay.brand ?? b.stay.bookingChannel : b.car.company;
  return who?.trim() || null;
}

// Wide enough for a name like "Eurowings" or "Booking.com"; a longer one is
// cut short rather than wrapping.
function KindChip({ kind, label, className = "" }: { kind: keyof typeof KIND_LABEL; label?: string | null; className?: string }) {
  return (
    <span className={`inline-flex w-24 shrink-0 items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${KIND_STYLE[kind]} ${className}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
        {KIND_ICON[kind]}
      </svg>
      <span className="min-w-0 truncate">{label ?? KIND_LABEL[kind]}</span>
    </span>
  );
}
// A flight's seats, one line each, on the same planned / spent rule as the
// flight itself: a flight not bought yet has only a plan.
// The transactions linked to a booking on the Budget ("Pays for").
function bookingPayments(b: Booking) {
  return (b.kind === "flight" ? b.flight.payments : b.kind === "stay" ? b.stay.payments : b.car.payments) ?? [];
}

function flightSeats(b: Booking) {
  if (b.kind !== "flight" || b.flight.passengers.length < 2) return [];
  const f = b.flight;
  return f.passengers.map((p, i) => {
    const planned = f.isEstimate ? p.fareCents : p.plannedFareCents;
    const plannedFx = f.isEstimate ? p.fareEurCents : p.plannedFareForeignCents;
    // A points seat's cash is only what was paid on top of the points (taxes,
    // fees); its fare is what the points stood in for.
    const actual = f.isEstimate ? null : p.pointsUsed ? (p.cashPaidCents ?? 0) : p.fareCents;
    const actualFx = f.isEstimate ? null : p.fareEurCents;
    return {
      key: `${i}-${p.name}`,
      name: p.name || `Passenger ${i + 1}`,
      planned,
      plannedFx,
      actual,
      actualFx,
      points: p.pointsUsed ? p.pointsCost : 0,
      diff: planned != null && actual != null ? planned - actual : null,
      code: f.foreignCurrency,
    };
  });
}

// The plan's figures in the header and the tiles: a clear sky blue, apart
// from the red spent figures. --viz-savings read periwinkle on dark cards,
// too close to the purple Victor rejects.
const PLAN_BLUE = "text-sky-700 dark:text-sky-300";

// A section's action, sat right beside its heading. Bordered and on the page
// background so it reads as a button, not a faint outline. Hover is a light
// blue wash — grey read as disabled, black as too heavy, and Victor rejects
// the purple brand colour anywhere new.
// Sized like the Travel Log's own buttons, a step down for the popup (16px
// bold) — the 13.5px version read as a tiny chip. Labels never wrap.
const SECTION_BUTTON =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/25 bg-background px-3 py-1.5 text-sm font-bold text-foreground shadow-sm transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40";
// Adding is a different act from editing, so it gets the filled blue of the
// page's own "Add Trip" button rather than the outline one.
const ADD_BUTTON =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-700 bg-sky-700 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-sky-800";

/**
 * One trip, whole: its bookings in date order, its spending planned against
 * actual, and what it all came to. Each booking opens its own form; the
 * spending opens the Misc form already on this trip.
 */
export function TripDetailModal({
  summary: t,
  currency,
  cardNames,
  onEditBooking,
  onAddBooking,
  onEditSpending,
  onClose,
}: {
  summary: TripSummary;
  currency: string;
  /** Card names by account id — a room line says which card or account paid. */
  cardNames?: Map<string, string>;
  onEditBooking: (booking: Booking) => void;
  onAddBooking: () => void;
  onEditSpending: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  // The stat cards stay pinned while the popup scrolls (desktop), so the
  // tables' sticky headers sit just under them — their height feeds `top`.
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsHeight, setStatsHeight] = useState(0);
  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStatsHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [matching, setMatching] = useState(false);
  // The Spending row whose tagged purchases are listed under it.
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Flights whose passengers are shown under them — all folded to start.
  const [openSeats, setOpenSeats] = useState<Set<string>>(() => new Set());
  const toggleSeats = (id: string) =>
    setOpenSeats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Purchases can only be matched once the trip has begun and has dates.
  const todayIso = new Date().toISOString().slice(0, 10);
  const canMatch = Boolean(t.start && t.end && t.start <= todayIso);
  const [name, setName] = useState(t.trip.name);
  const [startOn, setStartOn] = useState(t.trip.startOn ?? "");
  const [endOn, setEndOn] = useState(t.trip.endOn ?? "");
  const [notes, setNotes] = useState(t.trip.notes ?? "");

  // A hotel booked as several reservations (two rooms, night by night) is
  // listed once, its reservations under it.
  const lines = bookingLines(t.bookings);
  const tripYear = t.start?.slice(0, 4);
  // Cancelled bookings stay listed but are left out of the totals.
  const bookingTotals = t.bookings
    .filter((b) => !b.cancelled)
    .reduce(
      (sum, b) => {
        const { planned, actual } = bookingPlanActual(b);
        return {
          rows: sum.rows + 1,
          planned: sum.planned + (planned ?? 0),
          actual: sum.actual + (actual ?? 0),
          // The flights' share, for the Flights box beside Stays/Rentals.
          flightPlanned: sum.flightPlanned + (b.kind === "flight" ? planned ?? 0 : 0),
        };
      },
      { rows: 0, planned: 0, actual: 0, flightPlanned: 0 },
    );
  // The bookings' other-currency figures added up — only when every booking
  // that has one is in the same currency (euros and pounds don't add).
  const liveFx = t.bookings.filter((b) => !b.cancelled).map(bookingForeign).filter((x) => x.planned != null || x.actual != null);
  const fxCodes = new Set(liveFx.map((x) => x.code));
  const bookingFxTotals =
    fxCodes.size === 1
      ? {
          code: liveFx[0].code,
          planned: liveFx.some((x) => x.planned != null) ? liveFx.reduce((sum, x) => sum + (x.planned ?? 0), 0) : null,
          actual: liveFx.some((x) => x.actual != null) ? liveFx.reduce((sum, x) => sum + (x.actual ?? 0), 0) : null,
        }
      : null;
  // A difference in the other currency, on the same rule as the dollars:
  // only once there is both a plan and a spend.
  const fxDiffText = (planned: number | null | undefined, actual: number | null | undefined, code: string) =>
    planned != null && actual != null
      ? `${planned - actual >= 0 ? "" : "−"}${formatForeignWhole(Math.abs(planned - actual), code)}`
      : null;

  // The Spending Total's difference covers only rows with both a plan and an
  // actual (see spendingDiff); with none, it's a dash too.
  const comparedRows = t.expenses
    .map((e) => spendingDiff(e.plannedCents, actualCents(e)))
    .filter((d): d is number => d != null);
  const spendingTotalDiff = comparedRows.length ? comparedRows.reduce((a, b) => a + b, 0) : null;

  // The spending table rounds to whole units and keeps dollars and euros on
  // one line — "$507 / €428" — instead of stacking ".00" figures.
  const money = (cents: number | null | undefined) => (cents ? formatMoneyWhole(cents, currency) : DASH);
  // Money spent reads red everywhere on the trip — tiles, rows and totals.
  const redIfSpent = (cents: number | null | undefined) =>
    cents && cents > 0 ? <span className="text-negative">{money(cents)}</span> : money(cents);
  // In the trip's own Spending currency — euros unless it was changed.
  const euros = (cents: number | null | undefined) => (cents != null ? formatForeignWhole(cents, t.trip.spendingCurrency) : "");
  // The euro side of a Total cell — only when some row has a euro figure.
  // Once purchases are tagged to a row its dollar Actual comes from them, so a
  // euro figure typed before then no longer describes it — hide it rather than
  // show "$1 / €230". Tagged purchases carry no euro amount, so the euro Actual
  // total is left off too once any row is tagged: it would be a partial sum.
  const actualEur = (e: (typeof t.expenses)[number]) => (e.txCount > 0 ? null : e.actualEurCents);
  const eurTotal = (field: "plannedEurCents" | "actualEurCents") => {
    if (field === "actualEurCents" && t.expenses.some((e) => e.txCount > 0)) return null;
    const values = t.expenses.map((e) => e[field]).filter((v): v is number => v != null);
    return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
  };

  // Under each tile's spent figure: the whole plan, and what of it is still
  // unbought when that differs — "Planned: $648" on a trip not bought yet,
  // "Planned: $2,110 · left $1,300" once some of it is paid. "Plan left" on
  // its own hid the plan's total (Victor, 2026-09-30).
  // The plan's figures in PLAN_BLUE, so they read apart from the spent
  // figure above them (red once anything is spent).
  // The summary cards match the tables' columns: Planned / Spent /
  // Difference. Spent = money that left the wallet; Planned = every planned
  // figure (bookings + spending rows); Difference = the two tables'
  // Difference totals, by their rule — a row counts once it has both a plan
  // and spending. (Replaced Flights / Stays / Spending / Total spent / Saved,
  // which repeated Planned twice and called points value "Saved" —
  // Victor, 2026-10-08.)
  const spentFlights = t.flights - t.planOnly.flights;
  const spentStays = t.hotels + t.rentals - t.planOnly.hotels - t.planOnly.rentals;
  const spentSpending = t.miscTotal - t.planOnly.miscTotal;
  const plannedBookings = bookingTotals.planned;
  const plannedFlights = bookingTotals.flightPlanned;
  const plannedTotal = t.plannedTotal;
  // What the Difference compares, and its planned and spent totals — shown
  // under it as "Planned $1,660 / Spent $830". Same rule as the Spending
  // popup: each booking type (all flights, all stays, all rentals) compares
  // its whole plan with what's been paid so far — an unpaid flight's plan is
  // money still to go (Victor, 2026-10-08) — and a spending row counts once
  // it has both a plan and spending. Nothing paid, or no plan: left out.
  const live = t.bookings.filter((b) => !b.cancelled);
  const byKind = (["flight", "stay", "car"] as const).map((kind) =>
    live
      .filter((b) => b.kind === kind)
      .map((b) => bookingPlanActual(b))
      .reduce<{ planned: number; actual: number }>(
        (sum, x) => ({ planned: sum.planned + (x.planned ?? 0), actual: sum.actual + (x.actual ?? 0) }),
        { planned: 0, actual: 0 },
      ),
  );
  const compared = [
    ...byKind.filter((k) => k.planned > 0 && k.actual > 0),
    ...t.expenses
      .map((e) => ({ planned: e.plannedCents, actual: actualCents(e) }))
      .filter((x): x is { planned: number; actual: number } => x.planned != null && x.actual != null),
  ];
  const comparedPlanned = compared.reduce((sum, x) => sum + x.planned, 0);
  const comparedSpent = compared.reduce((sum, x) => sum + x.actual, 0);
  const differenceCents = compared.length ? comparedPlanned - comparedSpent : null;
  // "Flights: $0 / Spending: $320" under a card's figure — "Spending" on the
  // Planned card (money set aside), "Spent" on the Spent card. Flights and
  // the third part always show, $0 included; Stays only on a trip that has a stay
  // or rental, so most trips aren't padded with "Stays: $0".
  const hasStays = t.bookings.some((b) => !b.cancelled && b.kind !== "flight");
  const parts = (flights: number, stays: number, spending: number, spendingLabel: string) => {
    const list: [string, number][] = [["Flights", flights], ...(hasStays || stays ? [["Stays", stays] as [string, number]] : []), [spendingLabel, spending]];
    // One part per line on a phone (no slashes); "Flights / Stays" from sm
    // up with Spending/Spent always on its own second line, so every card
    // breaks in the same place instead of wherever its width runs out.
    return list.map(([label, cents], i) => {
      const last = i === list.length - 1;
      return (
        <span key={label} className={`block whitespace-nowrap ${last ? "" : "sm:inline-block"}`}>
          {label}: {formatMoneyWhole(cents, currency)}
          {i < list.length - 2 ? <span className="hidden sm:inline">&nbsp;/&nbsp;</span> : null}
        </span>
      );
    });
  };

  // What this trip adds to the Budget (view v_trip_budget_plans): its spending
  // plan plus bookings not bought yet, in the month it starts.
  const budgetPlanCents =
    t.plannedMisc +
    t.bookings
      .filter((b) => !b.cancelled && (b.kind === "flight" ? b.flight : b.kind === "stay" ? b.stay : b.car).isEstimate)
      .reduce((sum, b) => sum + b.pocket, 0) +
    // Pay-at-hotel rooms not charged yet: still to go out, at check-in.
    t.bookings.reduce((sum, b) => sum + (b.kind === "stay" && stayDueAtHotel(b.stay) ? b.stay.plannedCostCents ?? 0 : 0), 0);
  const budgetMonth = t.start ? t.start.slice(0, 7) : null;

  function run(action: () => Promise<{ error: string | null }>, after: () => void) {
    start(async () => {
      setError(null);
      const result = await action();
      if (result.error) setError(result.error);
      else {
        router.refresh();
        after();
      }
    });
  }

  return (
    <ModalShell
      // Plain trip name — the old trip-switching dropdown went (Victor,
      // 2026-10-08): another trip is opened from its card. The trip's actions
      // sit on their own line under it in the header, pinned while the body
      // scrolls.
      title={t.trip.name}
      headerActionsBelow
      headerActions={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground">
          {/* The trip's two actions side by side: add a flight/stay/rental,
              then edit the trip itself. */}
          <button
            type="button"
            onClick={onAddBooking}
            className={ADD_BUTTON}
          >
            Add to this trip
          </button>
          {mode !== "edit" ? (
            <button
              type="button"
              onClick={() => {
                setName(t.trip.name);
                setStartOn(t.trip.startOn ?? "");
                setEndOn(t.trip.endOn ?? "");
                setNotes(t.trip.notes ?? "");
                setMode("edit");
              }}
              className={SECTION_BUTTON}
            >
              <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.5 3.5l3 3L7 16H4v-3z" />
              </svg>
              Edit trip
            </button>
          ) : null}
          {/* Log a purchase for this trip without leaving the popup. */}
          {/* The Transactions page's "+ Transaction" colours, at this row's size. */}
          <AddTransactionButton
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent bg-brand-soft px-3 py-1.5 text-sm font-bold text-brand shadow-sm ring-1 ring-brand/15 transition hover:bg-brand hover:text-white"
            label="+ Transaction"
          />
          {/* The trip's dates, level with the buttons: its weekday over each
              date on a light-blue pill (the Flight tag's tint — never grey).
              Nights and pax sit centred above it — lifted out of the row from
              sm up, so the pill stays level with the buttons; stacked on a
              phone, where the pill has a line of its own. All bold. */}
          <span className="flex flex-col items-center gap-0.5 font-semibold tabular-nums text-foreground sm:relative">
            {t.nights != null || t.pax ? (
              <span className="whitespace-nowrap sm:absolute sm:bottom-full sm:left-1/2 sm:mb-3 sm:-translate-x-1/2">
                {t.nights != null ? `${t.nights} night${t.nights === 1 ? "" : "s"}` : null}
                {t.nights != null && t.pax ? <>&nbsp;&nbsp;/&nbsp;&nbsp;</> : null}
                {t.pax ? `${t.pax} pax` : null}
              </span>
            ) : null}
            {t.start ? (
              <span className="flex items-end gap-2 rounded-full bg-sky-100 px-4 py-1.5 dark:bg-sky-900/50">
                <TripDay iso={t.start} />
                {t.end && t.end !== t.start ? (
                  <>
                    <span>–</span>
                    <TripDay iso={t.end} />
                  </>
                ) : null}
              </span>
            ) : (
              <span>No dates yet</span>
            )}
          </span>
          {budgetPlanCents > 0 && !budgetMonth ? (
            <span className="self-end font-semibold text-negative">Add dates to put its plan on the Budget</span>
          ) : null}
        </div>
      }
      // Close / Delete trip pinned at the header's right edge (in place of the
      // X) so they're reachable without scrolling to the bottom.
      headerEnd={
        mode === "delete" ? (
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            <span className="font-semibold text-foreground">Delete this trip and everything in it?</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteTrip(t.trip.id), onClose)}
              className="rounded-md bg-negative px-3 py-1.5 font-semibold text-white disabled:opacity-60"
            >
              Delete trip
            </button>
            <button type="button" onClick={() => setMode("view")} className="px-2 py-1.5 font-semibold text-foreground hover:underline">
              Keep
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setMode("delete")}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/10"
            >
              Delete trip
            </button>
            {/* Hidden while Edit trip is open: Close doesn't save, so the
                way out of that form is Save trip or Cancel. */}
            {mode !== "edit" ? (
              <button type="button" onClick={onClose} className="rounded-md border border-black/25 bg-background px-4 py-1.5 text-xs font-semibold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40">
                Close
              </button>
            ) : null}
          </>
        )
      }
      onClose={onClose}
      className="sm:max-w-[min(94vw,68rem)]"
      mobileAlign="top"
    >
      <div
        className="space-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        style={{ "--trip-stats-h": `${statsHeight}px` } as React.CSSProperties}
      >
        {error ? <p className="rounded-md bg-negative/10 px-3 py-2 text-xs font-medium text-negative">{error}</p> : null}
        {/* ---- Edit trip (name, dates, notes) opens right under the button
             that starts it; otherwise the notes read here. */}
        {mode === "edit" ? (
          <section>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => updateTrip(t.trip.id, { name, startOn, endOn, notes }), () => setMode("view"));
              }}
              className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_9.5rem_9.5rem]"
            >
              <Field label="Trip name" className="col-span-2 sm:col-span-1">
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Starts">
                <input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Ends">
                <input type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Notes" className="col-span-2 sm:col-span-3">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={`${inputClass} resize-y`} />
              </Field>
              <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-3">
                <button type="submit" disabled={pending} className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                  {pending ? "Saving…" : "Save trip"}
                </button>
                <button type="button" onClick={() => setMode("view")} className="rounded-md px-3 py-1.5 text-xs font-semibold text-foreground hover:underline">
                  Cancel
                </button>
              </div>
            </form>
          </section>
        ) : t.trip.notes ? (
          // A labelled box, so the trip's notes don't read as a footnote to
          // the header above them.
          <p className="whitespace-pre-line rounded-lg px-3 py-2 text-xs ring-1 ring-line">
            <span className="font-bold uppercase tracking-wide">Notes/Remarks:</span> {t.trip.notes}
          </p>
        ) : null}

        {/* The trip at a glance, in the tables' own columns: Planned, Spent,
            Difference. Each card says one thing; its breakdown sits under. */}
        {/* Pinned from sm up; on a phone the stacked cards would eat a third
            of the screen, so they scroll away there. */}
        <div ref={statsRef} className="grid grid-cols-2 gap-2 sm:sticky sm:top-0 sm:z-20 sm:-mx-5 sm:grid-cols-3 sm:bg-surface sm:px-5 sm:py-2">
          <Stat
            label="Total Planned"
            value={plannedTotal > 0 ? formatMoneyWhole(plannedTotal, currency) : "—"}
            className={plannedTotal > 0 ? PLAN_BLUE : undefined}
            note={parts(plannedFlights, plannedBookings - plannedFlights, t.plannedMisc, "Spending")}
          />
          <Stat
            label="Total Spent"
            value={formatMoneyWhole(t.spent, currency)}
            className={t.spent > 0 ? "text-negative" : undefined}
            note={
              <>
                {parts(spentFlights, spentStays, spentSpending, "Spent")}
                {t.points > 0 ? <span className="block">+ {t.points.toLocaleString()} pts</span> : null}
              </>
            }
          />
          <Stat
            wide
            label="Total Difference"
            value={differenceCents == null ? "—" : `${differenceCents < 0 ? "−" : ""}${formatMoneyWhole(Math.abs(differenceCents), currency)}`}
            className={differenceCents == null ? undefined : differenceCents >= 0 ? "text-positive" : "text-negative"}
            note={
              differenceCents == null ? (
                "nothing to compare yet"
              ) : (
                <>
                  {/* Only what has spending against it, so not Total
                      Planned — the bare "Planned" read as a mismatch. */}
                  <span className="block">Planned Items Paid: <span className={PLAN_BLUE}>{formatMoneyWhole(comparedPlanned, currency)}</span></span>
                  <span className="block">Spent: <span className="text-negative">{formatMoneyWhole(comparedSpent, currency)}</span></span>
                </>
              )
            }
          />
        </div>

        {/* ---- Bookings */}
        <section>
          {/* Phones only: the desktop table's own header names the section. */}
          <div className="mb-1.5 sm:hidden">
            <h3 className="text-xs font-bold uppercase tracking-wide">Flights/Stays/Rentals</h3>
          </div>
          {t.bookings.length ? (
            // Planned against actual, like Spending below. A flight not bought
            // yet sits under Planned; once bought it moves to Actual and keeps
            // its estimate beside it.
            <>
            {/* Phones: one card per booking, its three figures side by side
                under the name — the table's four columns don't fit. */}
            <ul className="divide-y divide-line/60 rounded-lg ring-1 ring-line sm:hidden">
              {lines.map((line) => {
                if (line.type === "rooms") {
                  return (
                    <RoomsMobile key={line.key} line={line} currency={currency} tripYear={tripYear} cardNames={cardNames} todayIso={todayIso} onEdit={onEditBooking} />
                  );
                }
                const b = line.booking;
                const { planned, actual } = bookingPlanActual(b);
                const fx = bookingForeign(b);
                const diff = planned != null && actual != null ? planned - actual : null;
                return (
                  <li key={`${b.kind}-${b.id}`} className={b.cancelled ? "opacity-60" : ""}>
                    <button type="button" onClick={() => onEditBooking(b)} className="w-full px-3 py-2 text-left transition active:bg-sky-50 dark:active:bg-sky-950/40">
                      <span className="flex min-w-0 items-start gap-2">
                        <KindDay booking={b} className="mt-0.5" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[13px] font-semibold">
                            {b.title}
                            <BookingDate booking={b} tripYear={t.start?.slice(0, 4)} />
                            <BookingPax booking={b} />
                            {b.cancelled ? <span className="ml-1.5 text-[11px] font-semibold text-foreground">Cancelled</span> : null}
                          </span>
                          <span className="text-xs text-foreground">
                            <BookingWhen booking={b} tripYear={t.start?.slice(0, 4)} />
                          </span>
                          <CancelRemarks booking={b} todayIso={todayIso} tripYear={tripYear} />
                        </span>
                      </span>
                      <MobileFigures
                        planned={
                          planned != null ? (
                            <>
                              {formatMoneyWhole(planned, currency)}
                              {fx.planned != null ? (
                                <span className="block text-xs text-foreground">{formatForeignWhole(fx.planned, fx.code)}</span>
                              ) : null}
                            </>
                          ) : DASH
                        }
                        actual={
                          <>
                            {actual != null ? (
                              <span className={actual > 0 ? "text-negative" : "text-muted"}>{formatMoneyWhole(actual, currency)}</span>
                            ) : (
                              <NothingPaid booking={b} />
                            )}
                            {actual != null && fx.actual != null ? (
                              <span className="block text-xs font-normal text-foreground">{formatForeignWhole(fx.actual, fx.code)}</span>
                            ) : null}
                            {b.points > 0 ? (
                              <span className="block text-xs font-semibold" style={{ color: "var(--viz-savings)" }}>
                                {b.points.toLocaleString()} pts
                              </span>
                            ) : null}
                          </>
                        }
                        diff={
                          diff == null ? DASH : (
                            <>
                              {`${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                              {fxDiffText(fx.planned, fx.actual, fx.code) ? (
                                <span className="block text-xs">{fxDiffText(fx.planned, fx.actual, fx.code)}</span>
                              ) : null}
                            </>
                          )
                        }
                        diffClass={diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}
                      />
                    </button>
                    {bookingPayments(b).length ? (
                      <div className="-mt-1 px-3 pb-2">
                        <PurchasesToggle
                          count={bookingPayments(b).length}
                          noun="payment"
                          open={openRow === `booking:${b.id}`}
                          onClick={() => setOpenRow(openRow === `booking:${b.id}` ? null : `booking:${b.id}`)}
                          className=""
                        />
                        {openRow === `booking:${b.id}` ? <TaggedPurchaseList list={bookingPayments(b)} currency={currency} tripYear={t.start?.slice(0, 4)} /> : null}
                      </div>
                    ) : null}
                    {flightSeats(b).length ? (
                      <div className="-mt-1 px-3 pb-2">
                        <PaxToggle open={openSeats.has(b.id)} onClick={() => toggleSeats(b.id)} />
                      </div>
                    ) : null}
                      {openSeats.has(b.id) ? (
                        <span className="mx-3 mb-2 block space-y-0.5 border-t border-line/60 pt-1.5">
                          {flightSeats(b).map((p) => (
                            <span key={p.key} className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.5rem)] items-baseline gap-1 rounded px-1 py-0.5 text-xs tabular-nums  ">
                              <span className="truncate text-foreground">{p.name}</span>
                              <span className="text-center">{p.planned != null ? formatMoneyWhole(p.planned, currency) : DASH}</span>
                              <span className="text-center">
                                {p.points > 0 ? (
                                  <>
                                    <span className="font-semibold" style={{ color: "var(--viz-savings)" }}>{p.points.toLocaleString()} pts</span>
                                    {p.actual ? <span className="block text-negative">+ {formatMoneyWhole(p.actual, currency)}</span> : null}
                                  </>
                                ) : p.actual != null ? (
                                  <span className={p.actual > 0 ? "text-negative" : "text-muted"}>{formatMoneyWhole(p.actual, currency)}</span>
                                ) : (
                                  <span className="text-muted">{DASH}</span>
                                )}
                              </span>
                              <span className={`text-center ${p.diff == null ? "text-muted" : p.diff >= 0 ? "text-positive" : "text-negative"}`}>
                                {p.diff == null ? DASH : `${p.diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(p.diff), currency)}`}
                              </span>
                            </span>
                          ))}
                        </span>
                      ) : null}
                  </li>
                );
              })}
              {bookingTotals.rows > 1 ? (
                <li className="border-t-2 border-line px-3 py-2 font-bold">
                  <span className="text-sm">Total</span>
                  <MobileFigures
                    planned={
                      bookingTotals.planned ? (
                        <>
                          {formatMoneyWhole(bookingTotals.planned, currency)}
                          {bookingFxTotals?.planned ? (
                            <span className="block text-xs font-normal text-foreground">{formatForeignWhole(bookingFxTotals.planned, bookingFxTotals.code)}</span>
                          ) : null}
                        </>
                      ) : DASH
                    }
                    actual={
                      bookingTotals.actual ? (
                        <>
                          <span className="text-negative">{formatMoneyWhole(bookingTotals.actual, currency)}</span>
                          {bookingFxTotals?.actual ? (
                            <span className="block text-xs font-normal text-foreground">{formatForeignWhole(bookingFxTotals.actual, bookingFxTotals.code)}</span>
                          ) : null}
                        </>
                      ) : DASH
                    }
                    diff={DASH}
                    diffClass="text-muted"
                  />
                </li>
              ) : null}
            </ul>
            <div className="hidden overflow-clip rounded-lg ring-1 ring-line sm:block">
              {/* Same fixed column widths as Spending below, so the two tables'
                  Planned / Actual / Difference columns line up. */}
              <table className="w-full min-w-[34rem] table-fixed text-sm">
                <colgroup>
                  {/* Name widest: a stay's name and its dates fit on one
                      line. Same widths in both tables, so they line up. */}
                  <col className="w-[46%]" />
                  <col className="w-[16%]" />
                  <col className="w-[22%] border-x-2 border-sky-400 dark:border-sky-500" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-foreground">
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Flight/Stay/Rental</th>
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Planned</th>
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Spent</th>
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Difference</th>
                  </tr>
                </thead>
                {/* One <tbody> per booking: its figures row, then its remarks
                    on a row of their own spanning every column — so a long
                    remark runs out under the figures instead of wrapping
                    inside the name column. Hover and click cover both rows. */}
                  {lines.map((line) => {
                    if (line.type === "rooms") {
                      return (
                        <RoomsDesktop key={line.key} line={line} currency={currency} tripYear={tripYear} cardNames={cardNames} todayIso={todayIso} onEdit={onEditBooking} />
                      );
                    }
                    const b = line.booking;
                    const { planned, actual } = bookingPlanActual(b);
                    const fx = bookingForeign(b);
                    const diff = planned != null && actual != null ? planned - actual : null;
                    // The cancel date rides on the remarks line, left of them.
                    const remarks = bookingRemarks(b) || (b.kind === "stay" && freeCancelOpen(b.stay, todayIso)) || null;
                    const allSeats = flightSeats(b);
                    const seats = openSeats.has(b.id) ? allSeats : [];
                    const payments = bookingPayments(b);
                    const paymentsOpen = openRow === `booking:${b.id}` && payments.length > 0;
                    return (
                      <tbody
                        key={`${b.kind}-${b.id}`}
                        onClick={() => onEditBooking(b)}
                        className={`cursor-pointer border-b border-line/60 transition hover:bg-sky-50 dark:hover:bg-sky-900/20 ${b.cancelled ? "opacity-60" : ""}`}
                      >
                      <tr className={remarks || seats.length || paymentsOpen ? "[&>td]:pb-0" : ""}>
                        <td className="px-3 py-2 text-left">
                          <button type="button" onClick={(e) => { e.stopPropagation(); onEditBooking(b); }} className="flex min-w-0 items-start gap-2 text-left">
                            <KindDay booking={b} />
                            <span className="flex min-w-0 flex-col">
                              <span className="text-sm font-semibold">
                                {b.title}
                                <BookingDate booking={b} tripYear={t.start?.slice(0, 4)} />
                                <BookingPax booking={b} />
                                {b.cancelled ? <span className="ml-1.5 text-[11px] font-semibold text-foreground">Cancelled</span> : null}
                              </span>
                              <span className="text-xs text-foreground">
                                <BookingWhen booking={b} tripYear={t.start?.slice(0, 4)} />
                              </span>
                            </span>
                          </button>
                          {allSeats.length ? (
                            <span className="ml-[6.5rem] block" onClick={(e) => e.stopPropagation()}>
                              <PaxToggle open={seats.length > 0} onClick={() => toggleSeats(b.id)} />
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
                          {planned != null ? formatMoneyWhole(planned, currency) : DASH}
                          {planned != null && fx.planned != null ? (
                            <span className="text-foreground"> / {formatForeignWhole(fx.planned, fx.code)}</span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center font-semibold tabular-nums">
                          {actual != null ? (
                            <span className={actual > 0 ? "text-negative" : "text-muted"}>{formatMoneyWhole(actual, currency)}</span>
                          ) : (
                            <NothingPaid booking={b} />
                          )}
                          {actual != null && fx.actual != null ? (
                            <span className="font-normal text-foreground"> / {formatForeignWhole(fx.actual, fx.code)}</span>
                          ) : null}
                          {b.points > 0 ? (
                            <span className="block text-xs font-semibold" style={{ color: "var(--viz-savings)" }}>
                              {b.points.toLocaleString()} pts
                            </span>
                          ) : null}
                          {/* The transactions paying for it (Budget "Pays for"). */}
                          {payments.length ? (
                            <span className="block">
                              <PurchasesToggle count={payments.length} noun="payment" open={paymentsOpen} onClick={() => setOpenRow(paymentsOpen ? null : `booking:${b.id}`)} className="" />
                            </span>
                          ) : null}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                          {diff != null && fxDiffText(fx.planned, fx.actual, fx.code) ? (
                            <span className="font-normal"> / {fxDiffText(fx.planned, fx.actual, fx.code)}</span>
                          ) : null}
                        </td>
                      </tr>
                      {/* Each passenger's seat under the flight, in the same
                          columns — so the total reads as the seats added up. */}
                      {seats.map((p, i) => (
                        // Clicking a seat opens the flight's form, like the rest of the booking.
                        <tr key={p.key} className={`tabular-nums   hover:bg-sky-100/70 dark:hover:bg-sky-900/30 [&>td]:py-0.5 ${i === 0 ? "[&>td]:pt-1.5" : ""} ${i === seats.length - 1 && !remarks ? "[&>td]:pb-2" : ""}`}>
                          <td className="truncate px-3 pl-[7.25rem] text-left">{p.name}</td>
                          <td className="whitespace-nowrap px-3 text-center">
                            {p.planned != null ? formatMoneyWhole(p.planned, currency) : DASH}
                            {p.planned != null && p.plannedFx != null ? (
                              <span className="text-foreground"> / {formatForeignWhole(p.plannedFx, p.code)}</span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 text-center">
                            {p.points > 0 ? (
                              <>
                                <span className="font-semibold" style={{ color: "var(--viz-savings)" }}>{p.points.toLocaleString()} pts</span>
                                {p.actual ? <span className="text-negative"> + {formatMoneyWhole(p.actual, currency)}</span> : null}
                              </>
                            ) : p.actual != null ? (
                              <>
                                <span className={p.actual > 0 ? "text-negative" : "text-muted"}>{formatMoneyWhole(p.actual, currency)}</span>
                                {p.actualFx != null ? <span className="text-foreground"> / {formatForeignWhole(p.actualFx, p.code)}</span> : null}
                              </>
                            ) : (
                              <span className="text-muted">{DASH}</span>
                            )}
                          </td>
                          <td className={`whitespace-nowrap px-3 text-center ${p.diff == null ? "text-muted" : p.diff >= 0 ? "text-positive" : "text-negative"}`}>
                            {p.diff == null ? DASH : `${p.diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(p.diff), currency)}`}
                          </td>
                        </tr>
                      ))}
                      {paymentsOpen ? <PurchaseRows list={payments} currency={currency} tripYear={t.start?.slice(0, 4)} /> : null}
                      {remarks ? (
                        <tr>
                          <td colSpan={4} className={`px-3 pb-2 pl-[7.25rem] ${seats.length || paymentsOpen ? "pt-1.5" : ""}`}>
                            <CancelRemarks booking={b} todayIso={todayIso} tripYear={tripYear} />
                          </td>
                        </tr>
                      ) : null}
                      </tbody>
                    );
                  })}
                {bookingTotals.rows > 1 ? (
                  <tfoot>
                    <tr className="border-t-2 border-line font-bold">
                      <td className="px-3 py-1.5 text-left">Total</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                        {bookingTotals.planned ? formatMoneyWhole(bookingTotals.planned, currency) : DASH}
                        {bookingTotals.planned && bookingFxTotals?.planned ? (
                          <span className="font-normal text-foreground"> / {formatForeignWhole(bookingFxTotals.planned, bookingFxTotals.code)}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                        {bookingTotals.actual ? <span className="text-negative">{formatMoneyWhole(bookingTotals.actual, currency)}</span> : DASH}
                        {bookingTotals.actual && bookingFxTotals?.actual ? (
                          <span className="font-normal text-foreground"> / {formatForeignWhole(bookingFxTotals.actual, bookingFxTotals.code)}</span>
                        ) : null}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            </>
          ) : (
            <p className="rounded-lg px-3 py-2 text-xs text-foreground ring-1 ring-line">No flights, stays or rentals in this trip yet.</p>
          )}
        </section>

        {/* ---- Spending, planned against actual */}
        <section>
          <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide sm:hidden">Spending</h3>
            <button
              type="button"
              onClick={onEditSpending}
              className={SECTION_BUTTON}
            >
              {t.expenses.length ? "Edit Spending Category" : "Add Spending Category"}
            </button>
            {/* Tags the card purchases dated inside the trip — how a trip from
                before trip tagging gets its real actuals. */}
            {canMatch ? (
              <button type="button" onClick={() => setMatching(true)} className={SECTION_BUTTON}>
                Match purchases
              </button>
            ) : null}
          </div>
          {matching ? <MatchPurchasesModal summary={t} currency={currency} onClose={() => setMatching(false)} /> : null}
          {t.expenses.length ? (
            <>
            {/* Phones: one row per category, its three figures side by side
                under the name — the table's four columns don't fit. */}
            <ul className="divide-y divide-line/60 rounded-lg ring-1 ring-line sm:hidden">
              {EXPENSE_CATEGORIES.map(({ key, label }) => {
                const e = t.expenses.find((x) => x.category === key);
                if (!e) return null;
                const actual = actualCents(e);
                const diff = spendingDiff(e.plannedCents, actual);
                return (
                  <li key={key} className="px-3 py-2">
                    <span className="text-sm font-semibold">
                      {label}
                      {e.txCount > 0 ? <PurchasesToggle count={e.txCount} open={openRow === key} onClick={() => setOpenRow(openRow === key ? null : key)} /> : null}
                    </span>
                    <MobileFigures
                      planned={
                        <>
                          {money(e.plannedCents)}
                          {e.plannedEurCents != null ? <span className="block text-xs text-foreground">{euros(e.plannedEurCents)}</span> : null}
                        </>
                      }
                      actual={
                        <>
                          {redIfSpent(actual)}
                          {actualEur(e) != null ? <span className="block text-xs font-normal text-foreground">{euros(actualEur(e))}</span> : null}
                        </>
                      }
                      diff={
                        diff == null ? DASH : (
                          <>
                            {`${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                            {fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency) ? (
                              <span className="block text-xs">{fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency)}</span>
                            ) : null}
                          </>
                        )
                      }
                      diffClass={diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}
                    />
                    {openRow === key ? <TaggedPurchaseList list={e.txList} currency={currency} tripYear={t.start?.slice(0, 4)} /> : null}
                  </li>
                );
              })}
              <li className="border-t-2 border-line px-3 py-2 font-bold">
                <span className="text-sm">Total</span>
                <MobileFigures
                  planned={
                    <>
                      {money(t.plannedMisc)}
                      {eurTotal("plannedEurCents") != null ? <span className="block text-xs font-normal text-foreground">{euros(eurTotal("plannedEurCents"))}</span> : null}
                    </>
                  }
                  actual={
                    <>
                      {redIfSpent(t.actualMisc)}
                      {eurTotal("actualEurCents") != null ? <span className="block text-xs font-normal text-foreground">{euros(eurTotal("actualEurCents"))}</span> : null}
                    </>
                  }
                  diff={
                    spendingTotalDiff == null ? DASH : (
                      <>
                        {`${spendingTotalDiff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(spendingTotalDiff), currency)}`}
                        {fxDiffText(eurTotal("plannedEurCents"), eurTotal("actualEurCents"), t.trip.spendingCurrency) ? (
                          <span className="block text-xs">
                            {fxDiffText(eurTotal("plannedEurCents"), eurTotal("actualEurCents"), t.trip.spendingCurrency)}
                          </span>
                        ) : null}
                      </>
                    )
                  }
                  diffClass={spendingTotalDiff == null ? "text-muted" : spendingTotalDiff >= 0 ? "text-positive" : "text-negative"}
                />
              </li>
            </ul>
            <div className="hidden overflow-clip rounded-lg ring-1 ring-line sm:block">
              <table className="w-full min-w-[34rem] table-fixed text-sm">
                <colgroup>
                  {/* Name widest: a stay's name and its dates fit on one
                      line. Same widths in both tables, so they line up. */}
                  <col className="w-[46%]" />
                  <col className="w-[16%]" />
                  <col className="w-[22%] border-x-2 border-sky-400 dark:border-sky-500" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-foreground">
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Spending Category</th>
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Planned</th>
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Spent</th>
                    <th className="sticky top-[var(--trip-stats-h,0px)] z-10 bg-surface px-3 py-2 text-center font-bold shadow-[inset_0_-1px_0_var(--color-line)]">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {EXPENSE_CATEGORIES.map(({ key, label }) => {
                    const e = t.expenses.find((x) => x.category === key);
                    if (!e) return null;
                    // Blank counts as zero, same as the spending form, so the
                    // Total row's difference is its planned minus its actual.
                    const actual = actualCents(e);
                    const diff = spendingDiff(e.plannedCents, actual);
                    return (
                      <Fragment key={key}>
                      {/* Open, the divider moves below its purchases so they read as the row's. */}
                      <tr className={`${openRow === key ? "" : "border-b border-line/60 last:border-0"} hover:bg-sky-100/70 dark:hover:bg-sky-900/30`}>
                        <td className="px-3 py-1.5 text-left font-semibold">{label}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums">
                          {money(e.plannedCents)}
                          {e.plannedEurCents != null ? <span className="text-foreground"> / {euros(e.plannedEurCents)}</span> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-center font-semibold tabular-nums">
                          {redIfSpent(actual)}
                          {actualEur(e) != null ? <span className="font-normal text-foreground"> / {euros(actualEur(e))}</span> : null}
                          {/* From the Budget: how many tagged purchases make this
                              figure — click to list them under the row. */}
                          {e.txCount > 0 ? (
                            <span className="block">
                              <PurchasesToggle count={e.txCount} open={openRow === key} onClick={() => setOpenRow(openRow === key ? null : key)} className="" />
                            </span>
                          ) : null}
                        </td>
                        <td className={`px-3 py-1.5 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                          {diff != null && fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency) ? (
                            <span className="font-normal"> / {fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency)}</span>
                          ) : null}
                        </td>
                      </tr>
                      {openRow === key ? <PurchaseRows list={e.txList} currency={currency} tripYear={t.start?.slice(0, 4)} /> : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <td className="px-3 py-1.5 text-left">Total</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {money(t.plannedMisc)}
                      {eurTotal("plannedEurCents") != null ? <span className="font-normal text-foreground"> / {euros(eurTotal("plannedEurCents"))}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {redIfSpent(t.actualMisc)}
                      {eurTotal("actualEurCents") != null ? <span className="font-normal text-foreground"> / {euros(eurTotal("actualEurCents"))}</span> : null}
                    </td>
                    {(() => {
                      const diff = spendingTotalDiff;
                      const fxText = fxDiffText(eurTotal("plannedEurCents"), eurTotal("actualEurCents"), t.trip.spendingCurrency);
                      return (
                        <td className={`px-3 py-1.5 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                          {diff != null && fxText ? <span className="font-normal"> / {fxText}</span> : null}
                        </td>
                      );
                    })()}
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          ) : (
            <p className="rounded-lg px-3 py-2 text-xs text-foreground ring-1 ring-line">No restaurants, groceries or other spending yet.</p>
          )}
        </section>
      </div>
    </ModalShell>
  );
}

function Stat({ label, value, className, note, wide }: { label: string; value: string; className?: string; note?: React.ReactNode; wide?: boolean }) {
  return (
    // `wide` takes the whole row on a phone, so the odd third card leaves no gap.
    <div className={`rounded-lg bg-background/60 px-3 py-2 text-center ring-1 ring-line ${wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-foreground sm:text-sm">{label}</p>
      <p className={`text-xl font-bold tabular-nums sm:text-2xl ${className ?? ""}`}>{value}</p>
      {/* Readable, not a faint grey caption — the plan under the spent
          figure was hard to see in dark mode (Victor, 2026-09-30). */}
      {note ? <p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground sm:text-sm">{note}</p> : null}
    </div>
  );
}

// Planned minus actual, only once a row has BOTH. A plan with nothing spent
// yet used to read as green savings (+$840 before the trip), and an imported
// actual with no plan as red overspend (Berlin −$1,460) — neither is a
// difference, so both show a dash.
function spendingDiff(planned: number | null, actual: number | null): number | null {
  return planned != null && actual != null ? planned - actual : null;
}

// A phone row's Planned / Actual / Difference, side by side under its name —
// the stacked stand-in for the desktop table's three figure columns.
function MobileFigures({
  planned,
  actual,
  diff,
  diffClass = "",
}: {
  planned: React.ReactNode;
  actual: React.ReactNode;
  diff: React.ReactNode;
  diffClass?: string;
}) {
  const cell = (label: string, value: React.ReactNode, className = "") => (
    <span className="flex flex-col items-center">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{label}</span>
      <span className={`text-sm tabular-nums ${className}`}>{value}</span>
    </span>
  );
  return (
    <span className="mt-1.5 grid grid-cols-3 gap-2">
      {cell("Planned", planned)}
      {cell("Spent", actual, "font-semibold")}
      {cell("Difference", diff, diffClass)}
    </span>
  );
}

// "8 purchases ▾" beside a Spending row's actual — the purchases tagged to
// the trip that make up that figure. (Was a bare "8 tx", which read as code.)
// "Flight Pax Breakdown ▾" under a flight — folds its passengers' own lines out and back.
function PaxToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="-ml-1 inline-flex items-center gap-0.5 rounded px-1 text-xs font-semibold text-sky-700 underline decoration-sky-700/40 underline-offset-2 transition hover:decoration-sky-700 dark:text-sky-300 dark:decoration-sky-300/40 dark:hover:decoration-sky-300"
    >
      Flight Pax Breakdown
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? "rotate-180" : ""}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

// "2 purchases ▾" (a Spending row's tagged purchases) or "1 payment ▾" (the
// transactions paying a booking). Inline beside a phone row's name; on the
// desktop table it sits on its own line under the Spent figure (`className`).
function PurchasesToggle({ count, open, onClick, noun = "purchase", className = "ml-1.5" }: { count: number; open: boolean; onClick: () => void; noun?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-expanded={open}
      className={`${className} inline-flex items-center gap-0.5 rounded px-1 text-xs font-semibold text-sky-700 underline decoration-sky-700/40 underline-offset-2 transition hover:decoration-sky-700 dark:text-sky-300 dark:decoration-sky-300/40 dark:hover:decoration-sky-300`}
    >
      {count} {noun}{count === 1 ? "" : "s"}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? "rotate-180" : ""}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

// One end of the trip in the popup header: "Thursday" over "8 Oct 2026".
function TripDay({ iso }: { iso: string }) {
  const d = new Date(`${iso}T00:00:00Z`);
  return (
    <span className="flex flex-col items-center leading-tight">
      <span className="text-xs font-semibold">{d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}</span>
      <span>{d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</span>
    </span>
  );
}

// A booking's day(s), beside its title: "STR → Lisbon  28-Mar". Left off a
// flight whose legs already print their own days underneath — the range
// beside the title only repeated them.
function BookingDate({ booking, tripYear }: { booking: Booking; tripYear: string | undefined }) {
  const { date, legs } = bookingWhen(booking, tripYear);
  if (legs.some((l) => l.day)) return null;
  // Spaced off the name and as bold as it from sm up — small and close in,
  // it ran into the name.
  return <span className="ml-3 whitespace-nowrap text-xs font-semibold tabular-nums text-foreground sm:text-sm">{date}</span>;
}

// A flight's head count, right after its route (and date): the line under
// the legs used to read "Vueling · 2 pax", repeating the airline its chip
// already names.
function BookingPax({ booking }: { booking: Booking }) {
  if (booking.kind !== "flight" || !booking.flight.passengers.length) return null;
  return (
    <span className="ml-3 whitespace-nowrap text-xs font-semibold tabular-nums text-foreground sm:text-sm">
      {booking.flight.passengers.length} pax
    </span>
  );
}

// Under the title: a flight's legs in columns — day, Depart, Arrive — so a
// round trip's two times line up, then the detail (airline · pax) on its own
// line. A stay or rental has no legs: just its detail (city, nights).
function BookingWhen({ booking, tripYear }: { booking: Booking; tripYear: string | undefined }) {
  const { legs } = bookingWhen(booking, tripYear);
  // A flight's detail is its airline (on the chip) and pax (beside the
  // route), so it adds nothing here.
  const detail = booking.kind === "flight" ? null : booking.detail;
  if (!legs.length) return <>{detail}</>;
  const withDay = legs.some((l) => l.day);
  return (
    <>
      <span className={`grid justify-start gap-x-1.5 tabular-nums sm:gap-x-2 ${withDay ? "grid-cols-[auto_auto_auto]" : "grid-cols-[auto_auto]"}`}>
        {legs.map((leg, i) => (
          <Fragment key={i}>
            {withDay ? <span className="whitespace-nowrap">{leg.day}</span> : null}
            <span className="whitespace-nowrap">{leg.depart ? `Depart: ${leg.depart}` : ""}</span>
            {/* The arrow is dropped on a phone, where the three columns only just fit. */}
            <span className="whitespace-nowrap">
              {leg.arrive ? (
                <>
                  <span className="hidden sm:inline">→ </span>Arrive: {leg.arrive}
                </>
              ) : null}
            </span>
          </Fragment>
        ))}
      </span>
      {detail ? <span className="block">{detail}</span> : null}
    </>
  );
}

// Transaction rows under a figure share one soft cream "receipt" fill — not
// teal (the Stay chip), sky (the Flight chip and the row hover) or rose (the
// Rental chip) — so they read as the payments behind it, not another booking.
const PURCHASE_FILL = "bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-950/30 dark:hover:bg-yellow-900/40";

// The same list on the desktop table: one row per transaction in the table's
// own columns — what it was set against the Spent column, its amount under
// Spent. Text stays full colour; the amount is regular weight, not the row's
// bold red, so it isn't mistaken for a second total. A click opens the
// transaction's own edit form over the trip (and stays off the booking row).
function PurchaseRows({ list, currency, tripYear }: { list: TripTaggedPurchase[]; currency: string; tripYear: string | undefined }) {
  const linked = useLinkedPayments(list, currency);
  return (
    <>
      {list.map((p, i) => (
        <tr
          key={p.id}
          onClick={(e) => {
            e.stopPropagation();
            linked.openOne(p.id);
          }}
          className={`cursor-pointer tabular-nums text-foreground transition ${PURCHASE_FILL} [&>td]:py-1.5 ${i === list.length - 1 ? "border-b border-line/60" : ""}`}
        >
          <td colSpan={2} className="truncate px-3 pl-6 text-right">
            <ReceiptIcon />
            <span>{tripDate(p.date, tripYear)}</span>
            <span className="ml-3 font-semibold">{p.payee ?? "—"}</span>
            <span> · {p.item}</span>
          </td>
          <td className="whitespace-nowrap px-3 text-center">
            {linked.loadingId === p.id ? "Opening…" : (
              <>
                {p.amountCents < 0 ? "+" : ""}
                {formatMoneyWhole(Math.abs(p.amountCents), currency)}
              </>
            )}
          </td>
          <td />
        </tr>
      ))}
      {linked.overlay}
    </>
  );
}

function ReceiptIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="mr-2 inline h-4 w-4 -translate-y-px align-middle text-sky-700 dark:text-sky-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

// The tagged purchases behind one row on a phone, one line each; a tap opens
// the transaction's edit form. (A Remove button was built and taken out on
// Victor's call, 2026-09-23: taking a purchase off a trip changes nothing
// outside the Travel Log, so it read as a delete that wasn't one.)
function TaggedPurchaseList({ list, currency, tripYear }: { list: TripTaggedPurchase[]; currency: string; tripYear: string | undefined }) {
  const linked = useLinkedPayments(list, currency);
  return (
    <>
      <ul className="mt-1.5 divide-y divide-line/60 overflow-hidden rounded-md text-xs text-foreground">
        {list.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                linked.openOne(p.id);
              }}
              className={`flex w-full items-center gap-3 px-2.5 py-1.5 text-left transition ${PURCHASE_FILL}`}
            >
              <span className="shrink-0 whitespace-nowrap tabular-nums">{tripDate(p.date, tripYear)}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{p.payee ?? "—"}</span>
                <span> · {p.item}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {linked.loadingId === p.id ? "Opening…" : (
                  <>
                    {p.amountCents < 0 ? "+" : ""}
                    {formatMoneyWhole(Math.abs(p.amountCents), currency)}
                  </>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {linked.overlay}
    </>
  );
}

// "Pay at check-in" in a Spent cell: a pay-at-hotel room that is reserved but
// not charged yet. Plain text rather than a red figure — nothing has gone out,
// and it isn't money saved either.
function PayAtCheckIn() {
  return <span className="block whitespace-nowrap text-xs font-semibold text-foreground">Pay at check-in</span>;
}

// A Spent cell with no money paid, saying why — so a "—" is never left to
// guess between "not booked" and "booked, paid later": "Not Booked Yet" while
// it's only planned, "Pay at check-in" for a pay-at-hotel stay, or "Booked"
// when it's reserved and nothing is due (its points show beside it).
function NothingPaid({ booking }: { booking: Booking }) {
  if (booking.cancelled) return <span className="font-normal text-muted">{DASH}</span>;
  if (bookingPlannedOnly(booking)) return <NotBookedYet />;
  if (booking.kind === "stay" && stayDueAtHotel(booking.stay)) return <PayAtCheckIn />;
  if (booking.kind === "stay" && booking.stay.freeNightUsed) {
    return <span className="block text-xs font-semibold" style={{ color: "var(--viz-savings)" }}>Free night</span>;
  }
  if (booking.points > 0) return null;
  return <StatusText>Booked</StatusText>;
}

// Red: still to book, so it's the thing on the trip that needs doing.
function NotBookedYet() {
  return <span className="block whitespace-nowrap text-xs font-semibold text-negative">Not Booked Yet</span>;
}

function StatusText({ children }: { children: React.ReactNode }) {
  return <span className="block whitespace-nowrap text-xs font-semibold text-foreground">{children}</span>;
}

// A booking's note line: "Cancel by 21-Mar" (while that day is still ahead)
// on the left, then its remarks — one line, not two stacked.
function CancelRemarks({ booking, todayIso, tripYear }: { booking: Booking; todayIso: string; tripYear: string | undefined }) {
  const until = booking.kind === "stay" ? freeCancelOpen(booking.stay, todayIso) : null;
  const remarks = bookingRemarks(booking);
  if (!until && !remarks) return null;
  return (
    <span className="block text-xs text-foreground">
      {until ? <span className="mr-3 whitespace-nowrap font-semibold text-negative">Cancel by {tripDate(until, tripYear)}</span> : null}
      {remarks ? <span className="whitespace-pre-line">{remarks}</span> : null}
    </span>
  );
}

type RoomsLine = Extract<BookingLine, { type: "rooms" }>;
type RoomsProps = {
  line: RoomsLine;
  currency: string;
  tripYear: string | undefined;
  cardNames: Map<string, string> | undefined;
  todayIso: string;
  onEdit: (booking: Booking) => void;
};

// One reservation under its hotel: which card or account it's on.
function roomCard(b: Booking, cardNames: Map<string, string> | undefined): string | null {
  if (b.kind !== "stay") return null;
  const s = b.stay;
  return (s.accountId ? cardNames?.get(s.accountId) : null) ?? s.cardLabel?.trim() ?? null;
}

// How one reservation was paid, for its Spent cell: a free-night certificate,
// points, cash still due at the hotel, or the money already paid.
function RoomPaid({ booking, currency }: { booking: Booking; currency: string }) {
  if (booking.kind !== "stay") return null;
  const s = booking.stay;
  const { actual } = bookingPlanActual(booking);
  const fx = bookingForeign(booking);
  const parts: React.ReactNode[] = [];
  if (s.freeNightUsed) {
    parts.push(<span key="free" className="block font-semibold" style={{ color: "var(--viz-savings)" }}>Free night</span>);
  }
  if (booking.points > 0) {
    parts.push(<span key="pts" className="block font-semibold" style={{ color: "var(--viz-savings)" }}>{booking.points.toLocaleString()} pts</span>);
  }
  if (s.isEstimate) return <NotBookedYet />;
  if (stayDueAtHotel(s)) parts.push(<PayAtCheckIn key="due" />);
  else if (actual != null && actual > 0) {
    parts.push(
      <span key="cash" className="block font-semibold text-negative">
        {formatMoneyWhole(actual, currency)}
        {fx.actual != null ? <span className="font-normal text-foreground"> / {formatForeignWhole(fx.actual, fx.code)}</span> : null}
      </span>,
    );
  }
  return parts.length ? <>{parts}</> : <StatusText>Booked</StatusText>;
}

// The hotel's figures: its reservations added up, and how many people across
// its rooms (each room's largest count).
function roomsFigures(line: RoomsLine) {
  let planned = 0;
  let actual = 0;
  let diff: number | null = null;
  const notBooked = line.members.every((m) => bookingPlannedOnly(m.booking));
  // Unpicked reservations count as rooms of their own.
  const paxByRoom = new Map<string, number>();
  const fx = line.members.map((m) => bookingForeign(m.booking));
  for (const m of line.members) {
    const pa = bookingPlanActual(m.booking);
    planned += pa.planned ?? 0;
    actual += pa.actual ?? 0;
    if (pa.planned != null && pa.actual != null) diff = (diff ?? 0) + pa.planned - pa.actual;
    if (m.booking.kind === "stay") {
      const key = m.room != null ? `room:${m.room}` : `own:${m.booking.id}`;
      paxByRoom.set(key, Math.max(paxByRoom.get(key) ?? 0, m.booking.stay.pax ?? 0));
    }
  }
  const codes = new Set(fx.filter((x) => x.planned != null || x.actual != null).map((x) => x.code));
  const code = codes.size === 1 ? [...codes][0] : null;
  const sumFx = (k: "planned" | "actual") =>
    code && fx.some((x) => x[k] != null) ? fx.reduce((sum, x) => sum + (x.code === code ? x[k] ?? 0 : 0), 0) : null;
  const pax = [...paxByRoom.values()].reduce((a, b) => a + b, 0);
  const nights = Math.round((Date.parse(line.end) - Date.parse(line.start)) / 86_400_000);
  const first = line.members[0].booking;
  const city = first.kind === "stay" ? first.stay.city : null;
  return {
    planned, actual, diff, notBooked, pax, nights, city,
    plannedFx: sumFx("planned"), actualFx: sumFx("actual"), code: code ?? "",
  };
}

// "2 rooms · 5 pax" once each reservation has its room picked; until then
// "4 reservations", since no room is claimed that wasn't picked.
function roomsSummaryText(line: RoomsLine, f: ReturnType<typeof roomsFigures>) {
  const what = line.roomCount != null
    ? `${line.roomCount} room${line.roomCount === 1 ? "" : "s"}`
    : `${line.members.length} reservations`;
  // People only once rooms are picked: unpicked, a room's nights would each
  // count its guests again.
  return `${what}${f.pax && line.roomCount != null ? ` · ${f.pax} pax` : ""}`;
}

// A reservation's first line under its hotel: "Room 2 · 29-Mar – 30-Mar".
function RoomLabel({ room, date }: { room: number | null; date: string }) {
  return (
    <>
      {room != null ? <span className="whitespace-nowrap font-semibold">Room {room} · </span> : null}
      <span className="whitespace-nowrap">{date}</span>
    </>
  );
}

// The hotel's Spent cell: only the cash paid (or "Not Booked Yet" while every
// room is only planned). Points, free nights and "Pay at check-in" show on
// each room's line below.
function RoomsSpent({ f, currency }: { f: ReturnType<typeof roomsFigures>; currency: string }) {
  return f.actual > 0 ? (
    <span className="text-negative">
      {formatMoneyWhole(f.actual, currency)}
      {f.actualFx != null ? <span className="font-normal text-foreground"> / {formatForeignWhole(f.actualFx, f.code)}</span> : null}
    </span>
  ) : f.notBooked ? (
    <NotBookedYet />
  ) : (
    <span className="font-normal text-muted">{DASH}</span>
  );
}

/**
 * A hotel booked as several reservations, on the desktop table: one line for
 * the hotel (its dates, rooms, people and the reservations added up), then a
 * line per reservation — its room, nights, card, how it was paid and its
 * confirmation in the remarks. Each reservation opens its own stay form.
 */
function RoomsDesktop({ line, currency, tripYear, cardNames, todayIso, onEdit }: RoomsProps) {
  const f = roomsFigures(line);
  const first = line.members[0].booking;
  return (
    <tbody className="border-b border-line/60">
      <tr className="[&>td]:pb-1">
        <td className="px-3 py-2 text-left">
          <span className="flex min-w-0 items-start gap-2">
            <KindDay booking={first} />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold">
                {line.title}
                <span className="ml-3 whitespace-nowrap text-xs font-semibold tabular-nums text-foreground sm:text-sm">
                  {tripDate(line.start, tripYear)} – {tripDate(line.end, tripYear)}
                </span>
              </span>
              {/* Rooms and people on the line under the name, so the name and
                  its dates keep one line. */}
              <span className="text-xs text-foreground">
                {f.city ? `${f.city} ` : ""}({f.nights}&nbsp;night{f.nights === 1 ? "" : "s"}) ·{" "}
                <span className="font-semibold">{roomsSummaryText(line, f)}</span>
              </span>
            </span>
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
          {f.planned ? formatMoneyWhole(f.planned, currency) : DASH}
          {f.planned && f.plannedFx != null ? <span className="text-foreground"> / {formatForeignWhole(f.plannedFx, f.code)}</span> : null}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-center font-semibold tabular-nums">
          <RoomsSpent f={f} currency={currency} />
        </td>
        <td className={`whitespace-nowrap px-3 py-2 text-center tabular-nums ${f.diff == null ? "text-muted" : f.diff >= 0 ? "text-positive" : "text-negative"}`}>
          {f.diff == null ? DASH : `${f.diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(f.diff), currency)}`}
        </td>
      </tr>
      {line.members.map((m, i) => {
        const b = m.booking;
        const { planned, actual } = bookingPlanActual(b);
        const fx = bookingForeign(b);
        const diff = planned != null && actual != null ? planned - actual : null;
        const card = roomCard(b, cardNames);
        const pax = b.kind === "stay" ? b.stay.pax : null;
        return (
          <tr
            key={b.id}
            onClick={() => onEdit(b)}
            className={`cursor-pointer align-top text-xs tabular-nums transition hover:bg-sky-50 dark:hover:bg-sky-900/20 [&>td]:py-1 ${i === line.members.length - 1 ? "[&>td]:pb-2" : ""}`}
          >
            <td className="px-3 pl-[7.25rem] text-left">
              <RoomLabel room={m.room} date={bookingWhen(b, tripYear).date} />
              {pax ? <span className="whitespace-nowrap"> · {pax} pax</span> : null}
              {card ? <span> · {card}</span> : null}
              <CancelRemarks booking={b} todayIso={todayIso} tripYear={tripYear} />
            </td>
            <td className="whitespace-nowrap px-3 text-center">
              {planned != null ? formatMoneyWhole(planned, currency) : DASH}
              {planned != null && fx.planned != null ? <span className="text-foreground"> / {formatForeignWhole(fx.planned, fx.code)}</span> : null}
            </td>
            <td className="whitespace-nowrap px-3 text-center">
              <RoomPaid booking={b} currency={currency} />
            </td>
            <td className={`whitespace-nowrap px-3 text-center ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
              {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

// The same hotel on a phone: its card with the totals, then a short line per
// reservation — room, nights and card on the left, how it was paid on the right.
function RoomsMobile({ line, currency, tripYear, cardNames, todayIso, onEdit }: RoomsProps) {
  const f = roomsFigures(line);
  const first = line.members[0].booking;
  return (
    <li className="px-3 py-2">
      <span className="flex min-w-0 items-start gap-2">
        <KindDay booking={first} className="mt-0.5" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold">
            {line.title}
            <span className="ml-3 whitespace-nowrap text-xs font-semibold tabular-nums text-foreground">
              {tripDate(line.start, tripYear)} – {tripDate(line.end, tripYear)}
            </span>
          </span>
          <span className="text-xs text-foreground">
            {f.city ? `${f.city} ` : ""}({f.nights}&nbsp;night{f.nights === 1 ? "" : "s"}) ·{" "}
            <span className="font-semibold">{roomsSummaryText(line, f)}</span>
          </span>
        </span>
      </span>
      <MobileFigures
        planned={
          f.planned ? (
            <>
              {formatMoneyWhole(f.planned, currency)}
              {f.plannedFx != null ? <span className="block text-xs text-foreground">{formatForeignWhole(f.plannedFx, f.code)}</span> : null}
            </>
          ) : DASH
        }
        actual={<RoomsSpent f={f} currency={currency} />}
        diff={f.diff == null ? DASH : `${f.diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(f.diff), currency)}`}
        diffClass={f.diff == null ? "text-muted" : f.diff >= 0 ? "text-positive" : "text-negative"}
      />
      <ul className="mt-2 space-y-0.5 border-t border-line/60 pt-1.5">
        {line.members.map((m) => {
          const b = m.booking;
          const { planned } = bookingPlanActual(b);
          const card = roomCard(b, cardNames);
          const pax = b.kind === "stay" ? b.stay.pax : null;
          const due = b.kind === "stay" && stayDueAtHotel(b.stay);
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onEdit(b)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded px-1 py-1 text-left text-xs transition active:bg-sky-50 dark:active:bg-sky-950/40"
              >
                <span className="min-w-0">
                  <RoomLabel room={m.room} date={bookingWhen(b, tripYear).date} />
                  {/* People and card on their own line: beside the dates they
                      ran into the figure on the right. */}
                  {pax || card ? <span className="block">{[pax ? `${pax} pax` : null, card].filter(Boolean).join(" · ")}</span> : null}
                  <CancelRemarks booking={b} todayIso={todayIso} tripYear={tripYear} />
                </span>
                <span className="text-right tabular-nums">
                  {due && planned ? <span className="block">{formatMoneyWhole(planned, currency)}</span> : null}
                  <RoomPaid booking={b} currency={currency} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { formatForeignWhole, formatMoneyWhole } from "@/lib/money";
import { deleteTrip, updateTrip } from "./trip-actions";
import { Field, inputClass } from "./travel-form";
import { bookingForeign, bookingPlanActual, sheetDate, sheetDateRange, type Booking, type TripSummary } from "./trip-summary";
import { EXPENSE_CATEGORIES, actualCents, type TripTaggedPurchase } from "./types";
import { MatchPurchasesModal } from "./match-purchases-modal";

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
      <KindChip kind={booking.kind} />
      <span className="text-[10px] font-semibold text-muted">{day}</span>
    </span>
  );
}

// The booking's own remarks, under its date line.
function bookingRemarks(booking: Booking) {
  return (booking.kind === "flight" ? booking.flight : booking.kind === "stay" ? booking.stay : booking.car).remarks?.trim() || null;
}
function BookingRemarks({ booking }: { booking: Booking }) {
  const remarks = bookingRemarks(booking);
  return remarks ? <span className="whitespace-pre-line text-[11px] text-foreground/80">{remarks}</span> : null;
}

function KindChip({ kind, className = "" }: { kind: keyof typeof KIND_LABEL; className?: string }) {
  return (
    <span className={`inline-flex w-16 shrink-0 items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_STYLE[kind]} ${className}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {KIND_ICON[kind]}
      </svg>
      {KIND_LABEL[kind]}
    </span>
  );
}
// A section's action, sat right beside its heading. Bordered and on the page
// background so it reads as a button, not a faint outline. Hover is a light
// blue wash — grey read as disabled, black as too heavy, and Victor rejects
// the purple brand colour anywhere new.
const SECTION_BUTTON =
  "rounded-md border border-black/25 bg-background px-2.5 py-1 text-[11px] font-semibold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40";

/**
 * One trip, whole: its bookings in date order, its spending planned against
 * actual, and what it all came to. Each booking opens its own form; the
 * spending opens the Misc form already on this trip.
 */
export function TripDetailModal({
  summary: t,
  allTrips,
  onSwitchTrip,
  currency,
  onEditBooking,
  onAddBooking,
  onEditSpending,
  onClose,
}: {
  summary: TripSummary;
  /** Every trip, for the title's dropdown — pick one to jump to it. */
  allTrips: TripSummary[];
  onSwitchTrip: (tripId: string) => void;
  currency: string;
  onEditBooking: (booking: Booking) => void;
  onAddBooking: () => void;
  onEditSpending: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [matching, setMatching] = useState(false);
  // The Spending row whose tagged purchases are listed under it.
  const [openRow, setOpenRow] = useState<string | null>(null);
  // Purchases can only be matched once the trip has begun and has dates.
  const todayIso = new Date().toISOString().slice(0, 10);
  const canMatch = Boolean(t.start && t.end && t.start <= todayIso);
  const [name, setName] = useState(t.trip.name);
  const [startOn, setStartOn] = useState(t.trip.startOn ?? "");
  const [endOn, setEndOn] = useState(t.trip.endOn ?? "");
  const [notes, setNotes] = useState(t.trip.notes ?? "");

  // Cancelled bookings stay listed but are left out of the totals.
  const bookingTotals = t.bookings
    .filter((b) => !b.cancelled)
    .reduce(
      (sum, b) => {
        const { planned, actual } = bookingPlanActual(b);
        return { rows: sum.rows + 1, planned: sum.planned + (planned ?? 0), actual: sum.actual + (actual ?? 0) };
      },
      { rows: 0, planned: 0, actual: 0 },
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

  // What this trip adds to the Budget (view v_trip_budget_plans): its spending
  // plan plus bookings not bought yet, in the month it starts.
  const budgetPlanCents =
    t.plannedMisc +
    t.bookings
      .filter((b) => !b.cancelled && (b.kind === "flight" ? b.flight : b.kind === "stay" ? b.stay : b.car).isEstimate)
      .reduce((sum, b) => sum + b.pocket, 0);
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
      title={
        // The title is the trip picker: another trip opens in place.
        <select
          aria-label="Trip"
          value={t.trip.id}
          onChange={(e) => onSwitchTrip(e.target.value)}
          className="max-w-full cursor-pointer truncate rounded-md bg-transparent py-0.5 pr-1 text-lg font-bold [field-sizing:content] hover:bg-sky-100 focus:outline-none dark:hover:bg-sky-900/40"
        >
          {allTrips.map((x) => (
            <option key={x.trip.id} value={x.trip.id}>
              {x.trip.name}
            </option>
          ))}
        </select>
      }
      onClose={onClose}
      className="sm:max-w-[min(94vw,68rem)]"
      mobileAlign="top"
    >
      <div className="space-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
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
              className={`${SECTION_BUTTON} text-foreground`}
            >
              Edit trip
            </button>
          ) : null}
          {t.start ? (
            <span className="tabular-nums">
              {sheetDateRange(t.start, t.end)}
            </span>
          ) : (
            <span>No dates yet</span>
          )}
          {t.nights != null ? <span>{t.nights} night{t.nights === 1 ? "" : "s"}</span> : null}
          {t.pax ? <span>{t.pax} pax</span> : null}
          {budgetPlanCents > 0 ? (
            budgetMonth ? (
              <span className="font-semibold text-foreground">{formatMoneyWhole(budgetPlanCents, currency)} planned</span>
            ) : (
              <span className="font-semibold text-negative">Add dates to put its plan on the Budget</span>
            )
          ) : null}
        </div>

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
                <button type="button" onClick={() => setMode("view")} className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:text-foreground">
                  Cancel
                </button>
              </div>
            </form>
          </section>
        ) : t.trip.notes ? (
          <p className="whitespace-pre-line text-xs">{t.trip.notes}</p>
        ) : null}

        {/* What the trip came to, left to right as it adds up: the two parts,
            then their total, then what the points and credits saved. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {/* Each box counts only money that left the wallet; what's still
              a plan (unbought bookings, spending with no actual yet) sits
              under it as "Plan left: $X" — a paid item drops out of the plan. */}
          <Stat
            label="Flights/Stays/Rentals"
            value={formatMoneyWhole(t.flights + t.hotels + t.rentals - t.planOnly.bookings, currency)}
            note={t.planOnly.bookings > 0 ? `Plan left: ${formatMoneyWhole(t.planOnly.bookings, currency)}` : "flights · stays · rental"}
          />
          <Stat
            label="Spending"
            value={formatMoneyWhole(t.miscTotal - t.planOnly.miscTotal, currency)}
            note={t.planOnly.miscTotal > 0 ? `Plan left: ${formatMoneyWhole(t.planOnly.miscTotal, currency)}` : "day to day"}
          />
          <Stat
            label="Total spent"
            value={formatMoneyWhole(t.spent, currency)}
            className={t.spent > 0 ? "text-negative" : "text-muted"}
            note={t.planOnly.total > 0 ? `Plan left: ${formatMoneyWhole(t.planOnly.total, currency)}` : undefined}
          />
          <Stat
            label={t.points > 0 ? "Pts used · saved" : "Saved"}
            value={t.points > 0 ? `${t.points.toLocaleString()} · ${formatMoneyWhole(t.saved, currency)}` : formatMoneyWhole(t.saved, currency)}
            className="text-positive"
          />
        </div>

        {/* ---- Bookings */}
        <section>
          <div className="mb-1 flex items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide">Flights/Stays/Rentals</h3>
            <button
              type="button"
              onClick={onAddBooking}
              className={SECTION_BUTTON}
            >
              + Add to this trip
            </button>
          </div>
          {t.bookings.length ? (
            // Planned against actual, like Spending below. A flight not bought
            // yet sits under Planned; once bought it moves to Actual and keeps
            // its estimate beside it.
            <>
            {/* Phones: one card per booking, its three figures side by side
                under the name — the table's four columns don't fit. */}
            <ul className="divide-y divide-line/60 rounded-lg ring-1 ring-line sm:hidden">
              {t.bookings.map((b) => {
                const { planned, actual } = bookingPlanActual(b);
                const fx = bookingForeign(b);
                const diff = planned != null && actual != null ? planned - actual : null;
                return (
                  <li key={`${b.kind}-${b.id}`} className={b.cancelled ? "opacity-60" : ""}>
                    <button type="button" onClick={() => onEditBooking(b)} className="w-full px-3 py-2 text-left transition active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                      <span className="flex min-w-0 items-start gap-2">
                        <KindDay booking={b} className="mt-0.5" />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[13px] font-semibold">
                            {b.title}
                            {b.cancelled ? <span className="ml-1.5 text-[10px] font-semibold text-muted">Cancelled</span> : null}
                          </span>
                          <span className="text-[11px] text-muted">
                            <span className="tabular-nums">{sheetDateRange(b.start, b.end)}</span> · {b.detail}
                          </span>
                          <BookingRemarks booking={b} />
                        </span>
                      </span>
                      <MobileFigures
                        planned={
                          planned != null ? (
                            <>
                              {formatMoneyWhole(planned, currency)}
                              {fx.planned != null ? (
                                <span className="block text-[11px] text-muted">{formatForeignWhole(fx.planned, fx.code)}</span>
                              ) : null}
                            </>
                          ) : DASH
                        }
                        actual={
                          <>
                            {actual != null ? (
                              <span className={actual > 0 ? "text-negative" : "text-muted"}>{formatMoneyWhole(actual, currency)}</span>
                            ) : (
                              <span className="font-normal text-muted">{DASH}</span>
                            )}
                            {actual != null && fx.actual != null ? (
                              <span className="block text-[11px] font-normal text-muted">{formatForeignWhole(fx.actual, fx.code)}</span>
                            ) : null}
                            {b.points > 0 ? (
                              <span className="block text-[11px] font-semibold" style={{ color: "var(--viz-savings)" }}>
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
                                <span className="block text-[11px] opacity-70">{fxDiffText(fx.planned, fx.actual, fx.code)}</span>
                              ) : null}
                            </>
                          )
                        }
                        diffClass={diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}
                      />
                    </button>
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
                            <span className="block text-[11px] font-normal text-muted">{formatForeignWhole(bookingFxTotals.planned, bookingFxTotals.code)}</span>
                          ) : null}
                        </>
                      ) : DASH
                    }
                    actual={
                      bookingTotals.actual ? (
                        <>
                          {formatMoneyWhole(bookingTotals.actual, currency)}
                          {bookingFxTotals?.actual ? (
                            <span className="block text-[11px] font-normal text-muted">{formatForeignWhole(bookingFxTotals.actual, bookingFxTotals.code)}</span>
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
            <div className="hidden overflow-x-auto rounded-lg ring-1 ring-line sm:block">
              {/* Same fixed column widths as Spending below, so the two tables'
                  Planned / Actual / Difference columns line up. */}
              <table className="w-full min-w-[34rem] table-fixed text-sm">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[18%]" />
                  <col className="w-[24%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-1.5 text-center font-semibold">Flight/Stay/Rental</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Planned</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Spent</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Difference</th>
                  </tr>
                </thead>
                {/* One <tbody> per booking: its figures row, then its remarks
                    on a row of their own spanning every column — so a long
                    remark runs out under the figures instead of wrapping
                    inside the name column. Hover and click cover both rows. */}
                  {t.bookings.map((b) => {
                    const { planned, actual } = bookingPlanActual(b);
                    const fx = bookingForeign(b);
                    const diff = planned != null && actual != null ? planned - actual : null;
                    const remarks = bookingRemarks(b);
                    return (
                      <tbody
                        key={`${b.kind}-${b.id}`}
                        onClick={() => onEditBooking(b)}
                        className={`cursor-pointer border-b border-line/60 transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${b.cancelled ? "opacity-60" : ""}`}
                      >
                      <tr className={remarks ? "[&>td]:pb-0" : ""}>
                        <td className="px-3 py-2 text-left">
                          <button type="button" onClick={(e) => { e.stopPropagation(); onEditBooking(b); }} className="flex min-w-0 items-start gap-2 text-left">
                            <KindDay booking={b} />
                            <span className="flex min-w-0 flex-col">
                              <span className="text-[13px] font-semibold">
                                {b.title}
                                {b.cancelled ? <span className="ml-1.5 text-[10px] font-semibold text-muted">Cancelled</span> : null}
                              </span>
                              <span className="text-[11px] text-muted">
                                <span className="tabular-nums">{sheetDateRange(b.start, b.end)}</span> · {b.detail}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
                          {planned != null ? formatMoneyWhole(planned, currency) : DASH}
                          {planned != null && fx.planned != null ? (
                            <span className="text-muted"> / {formatForeignWhole(fx.planned, fx.code)}</span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center font-semibold tabular-nums">
                          {actual != null ? (
                            <span className={actual > 0 ? "text-negative" : "text-muted"}>{formatMoneyWhole(actual, currency)}</span>
                          ) : (
                            <span className="font-normal text-muted">{DASH}</span>
                          )}
                          {actual != null && fx.actual != null ? (
                            <span className="font-normal text-muted"> / {formatForeignWhole(fx.actual, fx.code)}</span>
                          ) : null}
                          {b.points > 0 ? (
                            <span className="block text-[11px] font-semibold" style={{ color: "var(--viz-savings)" }}>
                              {b.points.toLocaleString()} pts
                            </span>
                          ) : null}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                          {diff != null && fxDiffText(fx.planned, fx.actual, fx.code) ? (
                            <span className="font-normal opacity-70"> / {fxDiffText(fx.planned, fx.actual, fx.code)}</span>
                          ) : null}
                        </td>
                      </tr>
                      {remarks ? (
                        <tr>
                          <td colSpan={4} className="whitespace-pre-line px-3 pb-2 pl-[5.25rem] text-[11px] text-foreground/80">
                            {remarks}
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
                          <span className="font-normal text-muted"> / {formatForeignWhole(bookingFxTotals.planned, bookingFxTotals.code)}</span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                        {bookingTotals.actual ? formatMoneyWhole(bookingTotals.actual, currency) : DASH}
                        {bookingTotals.actual && bookingFxTotals?.actual ? (
                          <span className="font-normal text-muted"> / {formatForeignWhole(bookingFxTotals.actual, bookingFxTotals.code)}</span>
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
            <p className="rounded-lg px-3 py-2 text-xs text-muted ring-1 ring-line">No flights, stays or rentals in this trip yet.</p>
          )}
        </section>

        {/* ---- Spending, planned against actual */}
        <section>
          <div className="mb-1 flex items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide">Spending</h3>
            <button
              type="button"
              onClick={onEditSpending}
              className={SECTION_BUTTON}
            >
              {t.expenses.length ? "Edit spending" : "+ Add spending"}
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
                          {e.plannedEurCents != null ? <span className="block text-[11px] text-muted">{euros(e.plannedEurCents)}</span> : null}
                        </>
                      }
                      actual={
                        <>
                          {money(actual)}
                          {actualEur(e) != null ? <span className="block text-[11px] font-normal text-muted">{euros(actualEur(e))}</span> : null}
                        </>
                      }
                      diff={
                        diff == null ? DASH : (
                          <>
                            {`${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                            {fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency) ? (
                              <span className="block text-[11px] opacity-70">{fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency)}</span>
                            ) : null}
                          </>
                        )
                      }
                      diffClass={diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}
                    />
                    {openRow === key ? <TaggedPurchaseList list={e.txList} currency={currency} /> : null}
                  </li>
                );
              })}
              <li className="border-t-2 border-line px-3 py-2 font-bold">
                <span className="text-sm">Total</span>
                <MobileFigures
                  planned={
                    <>
                      {money(t.plannedMisc)}
                      {eurTotal("plannedEurCents") != null ? <span className="block text-[11px] font-normal text-muted">{euros(eurTotal("plannedEurCents"))}</span> : null}
                    </>
                  }
                  actual={
                    <>
                      {money(t.actualMisc)}
                      {eurTotal("actualEurCents") != null ? <span className="block text-[11px] font-normal text-muted">{euros(eurTotal("actualEurCents"))}</span> : null}
                    </>
                  }
                  diff={
                    spendingTotalDiff == null ? DASH : (
                      <>
                        {`${spendingTotalDiff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(spendingTotalDiff), currency)}`}
                        {fxDiffText(eurTotal("plannedEurCents"), eurTotal("actualEurCents"), t.trip.spendingCurrency) ? (
                          <span className="block text-[11px] opacity-70">
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
            <div className="hidden overflow-x-auto rounded-lg ring-1 ring-line sm:block">
              <table className="w-full min-w-[34rem] table-fixed text-sm">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[18%]" />
                  <col className="w-[24%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-1.5 text-center font-semibold">Category</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Planned</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Spent</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Difference</th>
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
                      <tr className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-1.5 text-left font-semibold">{label}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums">
                          {money(e.plannedCents)}
                          {e.plannedEurCents != null ? <span className="text-muted"> / {euros(e.plannedEurCents)}</span> : null}
                        </td>
                        {/* One line: the amount and "8 purchases ▾" side by side
                            (the Actual column is sized for it). */}
                        <td className="whitespace-nowrap px-3 py-1.5 text-center font-semibold tabular-nums">
                          {money(actual)}
                          {actualEur(e) != null ? <span className="font-normal text-muted"> / {euros(actualEur(e))}</span> : null}
                          {/* From the Budget: how many tagged purchases make this
                              figure — click to list them under the row. */}
                          {e.txCount > 0 ? <PurchasesToggle count={e.txCount} open={openRow === key} onClick={() => setOpenRow(openRow === key ? null : key)} /> : null}
                        </td>
                        <td className={`px-3 py-1.5 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                          {diff != null && fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency) ? (
                            <span className="font-normal opacity-70"> / {fxDiffText(e.plannedEurCents, actualEur(e), t.trip.spendingCurrency)}</span>
                          ) : null}
                        </td>
                      </tr>
                      {openRow === key ? (
                        <tr className="border-b border-line/60">
                          <td colSpan={4} className="px-3 pb-2">
                            <TaggedPurchaseList list={e.txList} currency={currency} />
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <td className="px-3 py-1.5 text-left">Total</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {money(t.plannedMisc)}
                      {eurTotal("plannedEurCents") != null ? <span className="font-normal text-muted"> / {euros(eurTotal("plannedEurCents"))}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {money(t.actualMisc)}
                      {eurTotal("actualEurCents") != null ? <span className="font-normal text-muted"> / {euros(eurTotal("actualEurCents"))}</span> : null}
                    </td>
                    {(() => {
                      const diff = spendingTotalDiff;
                      const fxText = fxDiffText(eurTotal("plannedEurCents"), eurTotal("actualEurCents"), t.trip.spendingCurrency);
                      return (
                        <td className={`px-3 py-1.5 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                          {diff != null && fxText ? <span className="font-normal opacity-70"> / {fxText}</span> : null}
                        </td>
                      );
                    })()}
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          ) : (
            <p className="rounded-lg px-3 py-2 text-xs text-muted ring-1 ring-line">No restaurants, groceries or other spending yet.</p>
          )}
        </section>

        {/* ---- The trip itself */}
        <section className="border-t border-line pt-3">
          {mode === "delete" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Delete this trip and everything in it — its stays, flights, rentals and spending?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteTrip(t.trip.id), onClose)}
                className="rounded-md bg-negative px-3 py-1.5 font-semibold text-white disabled:opacity-60"
              >
                Delete trip
              </button>
              <button type="button" onClick={() => setMode("view")} className="px-2 py-1.5 font-semibold text-muted hover:text-foreground">
                Keep
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* Hidden while Edit trip is open: Close doesn't save, so the
                  way out of that form is Save trip or Cancel. */}
              {mode !== "edit" ? (
                <button type="button" onClick={onClose} className="rounded-md border border-black/25 bg-background px-4 py-1.5 text-xs font-semibold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40">
                  Close
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setMode("delete")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/10"
              >
                Delete trip
              </button>
            </div>
          )}
          {error ? <p className="mt-2 text-xs font-medium text-negative">{error}</p> : null}
        </section>
      </div>
    </ModalShell>
  );
}

function Stat({ label, value, className, note }: { label: string; value: string; className?: string; note?: string }) {
  return (
    <div className="rounded-lg bg-background/60 px-3 py-2 text-center ring-1 ring-line">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-base font-bold tabular-nums ${className ?? ""}`}>{value}</p>
      {note ? <p className="text-[10px] font-semibold text-muted">{note}</p> : null}
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
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
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
function PurchasesToggle({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="ml-1.5 inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-semibold text-sky-700 underline decoration-sky-700/40 underline-offset-2 transition hover:decoration-sky-700 dark:text-sky-300 dark:decoration-sky-300/40 dark:hover:decoration-sky-300"
    >
      {count} purchase{count === 1 ? "" : "s"}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? "rotate-180" : ""}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

// The tagged purchases behind one Spending row, one line each — a read-only
// look at what makes up the Actual. (A Remove button was built and taken out
// on Victor's call, 2026-09-23: taking a purchase off a trip changes nothing
// outside the Travel Log, so it read as a delete that wasn't one.)
function TaggedPurchaseList({ list, currency }: { list: TripTaggedPurchase[]; currency: string }) {
  return (
    <ul className="mt-1.5 divide-y divide-line/60 rounded-md bg-background/60 text-xs ring-1 ring-line">
      {list.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-2.5 py-1.5">
          <span className="shrink-0 whitespace-nowrap tabular-nums text-muted">{sheetDate(p.date)}</span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold">{p.payee ?? "—"}</span>
            <span className="text-muted"> · {p.item}</span>
          </span>
          <span className="shrink-0 font-semibold tabular-nums">{formatMoneyWhole(p.amountCents, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

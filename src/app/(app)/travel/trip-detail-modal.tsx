"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney, formatMoneyWhole } from "@/lib/money";
import { deleteTrip, updateTrip } from "./trip-actions";
import { Field, inputClass } from "./travel-form";
import { bookingPlanActual, sheetDate, sheetDateRange, type Booking, type TripSummary } from "./trip-summary";
import { EXPENSE_CATEGORIES, actualCents, type TripTaggedPurchase } from "./types";
import { MatchPurchasesModal } from "./match-purchases-modal";

const DASH = "—";
const KIND_LABEL = { flight: "Flight", stay: "Stay", car: "Rental" } as const;
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
  const [editingNotes, setEditingNotes] = useState(false);
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

  // The Spending Total's difference covers only rows with both a plan and an
  // actual (see spendingDiff); with none, it's a dash too.
  const comparedRows = t.expenses
    .map((e) => spendingDiff(e.plannedCents, actualCents(e)))
    .filter((d): d is number => d != null);
  const spendingTotalDiff = comparedRows.length ? comparedRows.reduce((a, b) => a + b, 0) : null;

  // The spending table rounds to whole units and keeps dollars and euros on
  // one line — "$507 / €428" — instead of stacking ".00" figures.
  const money = (cents: number | null | undefined) => (cents ? formatMoneyWhole(cents, currency) : DASH);
  const euros = (cents: number | null | undefined) => (cents != null ? formatMoneyWhole(cents, "€") : "");
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
  const budgetMonthLabel = budgetMonth
    ? new Date(`${budgetMonth}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : null;

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
      className="sm:max-w-4xl"
      mobileAlign="top"
    >
      <div className="space-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
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
              <Link href={`/budget?month=${budgetMonth}`} className="font-semibold text-foreground underline decoration-line underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300">
                {formatMoney(budgetPlanCents, currency)} planned on Budget · {budgetMonthLabel} →
              </Link>
            ) : (
              <span className="font-semibold text-negative">Add dates to put its plan on the Budget</span>
            )
          ) : null}
          {!editingNotes ? (
            <button type="button" onClick={() => { setNotes(t.trip.notes ?? ""); setEditingNotes(true); }} className={`${SECTION_BUTTON} text-foreground`}>
              {t.trip.notes ? "Edit notes" : "+ Add notes"}
            </button>
          ) : null}
        </div>

        {/* ---- Notes: edited in place, right where they are read; the Edit
             notes button sits on the dates line above. */}
        {editingNotes || t.trip.notes ? (
        <section>
          {editingNotes ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => updateTrip(t.trip.id, { name: t.trip.name, startOn: t.trip.startOn ?? "", endOn: t.trip.endOn ?? "", notes }),
                  () => setEditingNotes(false),
                );
              }}
              className="space-y-2"
            >
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                autoFocus
                className={`${inputClass} resize-y`}
              />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--viz-income)" }}>
                  {pending ? "Saving…" : "Save notes"}
                </button>
                <button type="button" onClick={() => setEditingNotes(false)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:text-foreground">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="whitespace-pre-line text-xs">{t.trip.notes}</p>
          )}
        </section>
        ) : null}

        {/* What the trip came to, left to right as it adds up: the two parts,
            then their total, then what the points and credits saved. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {/* Each box counts only money that left the wallet; what's still
              a plan (unbought bookings, spending with no actual yet) sits
              under it as "+ $X planned" — same split as the Combined Log. */}
          <Stat
            label="Bookings"
            value={formatMoney(t.flights + t.hotels + t.rentals - t.planOnly.bookings, currency)}
            note={t.planOnly.bookings > 0 ? `+ ${formatMoney(t.planOnly.bookings, currency)} planned` : "flights · stays · rental"}
          />
          <Stat
            label="Spending"
            value={formatMoney(t.miscTotal - t.planOnly.miscTotal, currency)}
            note={t.planOnly.miscTotal > 0 ? `+ ${formatMoney(t.planOnly.miscTotal, currency)} planned` : "day to day"}
          />
          <Stat
            label="Total spent"
            value={formatMoney(t.spent, currency)}
            className={t.spent > 0 ? "text-negative" : "text-muted"}
            note={t.planOnly.total > 0 ? `+ ${formatMoney(t.planOnly.total, currency)} planned` : undefined}
          />
          <Stat
            label={t.points > 0 ? "Pts used · saved" : "Saved"}
            value={t.points > 0 ? `${t.points.toLocaleString()} · ${formatMoney(t.saved, currency)}` : formatMoney(t.saved, currency)}
            className="text-positive"
          />
        </div>

        {/* ---- Bookings */}
        <section>
          <div className="mb-1 flex items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide">Bookings</h3>
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
                const diff = planned != null && actual != null ? planned - actual : null;
                return (
                  <li key={`${b.kind}-${b.id}`} className={b.cancelled ? "opacity-60" : ""}>
                    <button type="button" onClick={() => onEditBooking(b)} className="w-full px-3 py-2 text-left transition active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                      <span className="flex min-w-0 items-start gap-2">
                        <span className="mt-0.5 w-14 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-semibold text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {KIND_LABEL[b.kind]}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[13px] font-semibold">
                            {b.title}
                            {b.cancelled ? <span className="ml-1.5 text-[10px] font-semibold text-muted">Cancelled</span> : null}
                          </span>
                          <span className="text-[11px] text-muted">
                            <span className="tabular-nums">{sheetDateRange(b.start, b.end)}</span> · {b.detail}
                          </span>
                        </span>
                      </span>
                      <MobileFigures
                        planned={planned != null ? formatMoney(planned, currency) : DASH}
                        actual={
                          <>
                            {actual != null ? (
                              <span className={actual > 0 ? "text-negative" : "text-muted"}>{formatMoney(actual, currency)}</span>
                            ) : (
                              <span className="font-normal text-muted">{DASH}</span>
                            )}
                            {b.points > 0 ? (
                              <span className="block text-[11px] font-semibold" style={{ color: "var(--viz-savings)" }}>
                                {b.points.toLocaleString()} pts
                              </span>
                            ) : null}
                          </>
                        }
                        diff={diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoney(Math.abs(diff), currency)}`}
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
                    planned={bookingTotals.planned ? formatMoney(bookingTotals.planned, currency) : DASH}
                    actual={bookingTotals.actual ? formatMoney(bookingTotals.actual, currency) : DASH}
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
                    <th className="px-3 py-1.5 text-center font-semibold">Booking</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Planned</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Actual</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {t.bookings.map((b) => {
                    const { planned, actual } = bookingPlanActual(b);
                    const diff = planned != null && actual != null ? planned - actual : null;
                    return (
                      <tr
                        key={`${b.kind}-${b.id}`}
                        onClick={() => onEditBooking(b)}
                        className={`cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${b.cancelled ? "opacity-60" : ""}`}
                      >
                        <td className="px-3 py-2 text-left">
                          <button type="button" onClick={(e) => { e.stopPropagation(); onEditBooking(b); }} className="flex min-w-0 items-center gap-2 text-left">
                            <span className="w-14 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-semibold text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
                              {KIND_LABEL[b.kind]}
                            </span>
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
                          {planned != null ? formatMoney(planned, currency) : DASH}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center font-semibold tabular-nums">
                          {actual != null ? (
                            <span className={actual > 0 ? "text-negative" : "text-muted"}>{formatMoney(actual, currency)}</span>
                          ) : (
                            <span className="font-normal text-muted">{DASH}</span>
                          )}
                          {b.points > 0 ? (
                            <span className="block text-[11px] font-semibold" style={{ color: "var(--viz-savings)" }}>
                              {b.points.toLocaleString()} pts
                            </span>
                          ) : null}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-2 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoney(Math.abs(diff), currency)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {bookingTotals.rows > 1 ? (
                  <tfoot>
                    <tr className="border-t-2 border-line font-bold">
                      <td className="px-3 py-1.5 text-left">Total</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                        {bookingTotals.planned ? formatMoney(bookingTotals.planned, currency) : DASH}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums">
                        {bookingTotals.actual ? formatMoney(bookingTotals.actual, currency) : DASH}
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
                      diff={diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
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
                  diff={spendingTotalDiff == null ? DASH : `${spendingTotalDiff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(spendingTotalDiff), currency)}`}
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
                    <th className="px-3 py-1.5 text-center font-semibold">Actual</th>
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
                      return (
                        <td className={`px-3 py-1.5 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
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
          {mode === "edit" ? (
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
          ) : mode === "delete" ? (
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
              <button
                type="button"
                onClick={() => { setNotes(t.trip.notes ?? ""); setMode("edit"); }}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                Edit trip
              </button>
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
      {cell("Actual", actual, "font-semibold")}
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
          <span className="shrink-0 font-semibold tabular-nums">{formatMoney(p.amountCents, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

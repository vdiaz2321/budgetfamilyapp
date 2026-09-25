"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CurrencyConverter, type ConvertedFrom } from "@/components/currency-converter";
import { centsToDisplay, currencySymbol, displayToCents, foreignSymbol, formatForeignWhole, formatMoneyWhole } from "@/lib/money";
import { saveTripExpenses } from "./expense-actions";
import { CurrencySelect, Field, inputClass } from "./travel-form";
import { TripPicker, useTripChoice } from "./trip-picker";
import type { Embed } from "./embedded-section";
import { bookingForeignTotalsFor, bookingTotalsFor } from "./trip-summary";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type TravelCar, type TravelFlight, type TravelStay, type TravelTrip, type TripExpense } from "./types";

type Row = {
  category: ExpenseCategory;
  planned: string;
  plannedEur: string;
  actual: string;
  actualEur: string;
  // No longer picked in this form; carried through so a card saved earlier
  // isn't wiped on the next save.
  accountId: string;
  // Purchases tagged to the trip on the Budget: when there are any, the
  // Actual ($) box shows their total and can't be typed over.
  txActualCents: number | null;
  txCount: number;
};
type Slot = "planned" | "actual";

const show = (cents: number | null | undefined) => (cents == null ? "" : centsToDisplay(cents));

/** A booked figure in the spending table: read-only, but sitting in the same
 *  column as the boxes above and below it. */
function BookedCell({ label, value }: { label: string; value: string }) {
  return (
    <span className="block min-w-0">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted sm:hidden">{label}</span>
      <span className="block py-1.5 text-sm tabular-nums text-muted sm:text-center">{value}</span>
    </span>
  );
}

function rowsFor(tripId: string, expenses: TripExpense[]): Row[] {
  return EXPENSE_CATEGORIES.map(({ key }) => {
    const e = expenses.find((x) => x.tripId === tripId && x.category === key);
    return {
      category: key,
      planned: show(e?.plannedCents),
      plannedEur: show(e?.plannedEurCents),
      actual: show(e?.actualCents),
      actualEur: show(e?.actualEurCents),
      accountId: e?.accountId ?? "",
      txActualCents: e?.txActualCents ?? null,
      txCount: e?.txCount ?? 0,
    };
  });
}

/**
 * A trip's day-to-day spending, typed once for the whole trip instead of day
 * by day: one planned and one actual figure per category, each with its euros.
 * Picking a trip loads what it already has, so this is also how it is edited.
 */
export function MiscModal({
  trips,
  expenses,
  stays = [],
  flights = [],
  cars = [],
  defaultTripId,
  currency,
  embed,
  dates,
  onClose,
}: {
  currency: string;
  trips: TravelTrip[];
  expenses: TripExpense[];
  /** The trip's saved bookings. They are not typed here — they appear as three
   *  read-only rows above the categories so the Total is the whole trip, not
   *  just its day-to-day spending. */
  stays?: TravelStay[];
  flights?: TravelFlight[];
  cars?: TravelCar[];
  defaultTripId?: string | null;
  /** Inside the Add Travel Log popup the trip's dates are typed in that
   *  popup's header, next to the trip name — they describe the whole trip, not
   *  its spending. Passed in here so the save still carries them, and the two
   *  date boxes drop out of this section. Standalone, this section keeps its
   *  own pair. */
  dates?: { startOn: string; endOn: string };
  /** Shown as a section of the Add Travel Log popup — see embedded-section.
   *  Remount it (key) when the popup's trip changes, to load that trip's figures. */
  embed?: Embed;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ownTrip, setTripChoice] = useTripChoice(defaultTripId);
  const trip = embed ? embed.trip : ownTrip;
  const current = trips.find((t) => t.id === trip.tripId) ?? null;
  const [ownStartOn, setStartOn] = useState(current?.startOn ?? "");
  const [ownEndOn, setEndOn] = useState(current?.endOn ?? "");
  const startOn = dates ? dates.startOn : ownStartOn;
  const endOn = dates ? dates.endOn : ownEndOn;
  const [rows, setRows] = useState<Row[]>(() => rowsFor(trip.tripId, expenses));
  // The currency the second Planned / Spent columns are in — one per trip.
  const [foreignCurrency, setForeignCurrency] = useState(current?.spendingCurrency ?? "EUR");
  const fx = foreignSymbol(foreignCurrency);
  // The field the currency converter fills: the one last clicked into.
  const focused = useRef<{ category: ExpenseCategory; slot: Slot } | null>(null);

  // Switching trips shows that trip's own figures and dates.
  function setTrip(next: { tripId: string; newTripName: string }) {
    if (next.tripId !== trip.tripId) {
      const t = trips.find((x) => x.id === next.tripId);
      setRows(rowsFor(next.tripId, expenses));
      setStartOn(t?.startOn ?? "");
      setEndOn(t?.endOn ?? "");
      setForeignCurrency(t?.spendingCurrency ?? "EUR");
    }
    setTripChoice(next);
  }

  useEffect(() => {
    if (!embed) return;
    embed.register({
      // Loaded figures and dates left as they were count as nothing typed.
      isEmpty: () => {
        const loaded = rowsFor(trip.tripId, expenses);
        const datesUntouched =
          (dates != null || (startOn === (current?.startOn ?? "") && endOn === (current?.endOn ?? ""))) &&
          foreignCurrency === (current?.spendingCurrency ?? "EUR");
        return (
          datesUntouched && rows.every((r, i) => JSON.stringify(r) === JSON.stringify(loaded[i]))
        );
      },
      save: async () => {
        const result = await saveTripExpenses({ ...trip, startOn, endOn, foreignCurrency, rows });
        return { error: result.error ?? null };
      },
    });
  });

  const update = (category: ExpenseCategory, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.category === category ? { ...r, ...patch } : r)));

  function applyConverted(cents: number, from: ConvertedFrom) {
    const target = focused.current ?? { category: rows[0].category, slot: "actual" as Slot };
    update(target.category, {
      [target.slot]: centsToDisplay(cents),
      ...(from.currency === foreignCurrency ? { [`${target.slot}Eur`]: centsToDisplay(from.amountCents) } : {}),
    });
  }

  const sum = (key: "planned" | "plannedEur" | "actual" | "actualEur") =>
    rows.reduce((total, r) => total + (r[key] ? Math.max(0, displayToCents(r[key])) : 0), 0);
  // A row's actual, in cents: the tagged purchases when there are any, else
  // what is typed. The typed box is kept aside, not overwritten.
  const rowActual = (r: Row) => (r.txCount > 0 ? Math.max(0, r.txActualCents ?? 0) : r.actual.trim() ? Math.max(0, displayToCents(r.actual)) : 0);
  const hasActual = (r: Row) => r.txCount > 0 || Boolean(r.actual.trim());
  // What the trip's own bookings already come to. A booking still on estimate
  // counts as planned; a real one as actual — the same split the Trip Log uses.
  const booked = bookingTotalsFor(trip.tripId, stays, flights, cars);
  // Their figures in the trip's other currency — from bookings kept in that
  // same currency only.
  const bookedFx = bookingForeignTotalsFor(trip.tripId, stays, flights, cars, foreignCurrency);
  const bookedRows: { label: string; planned: number; actual: number; fx: { planned: number | null; actual: number | null } }[] = [
    { label: "Stays", ...booked.stay, fx: bookedFx.stay },
    { label: "Flights", ...booked.flight, fx: bookedFx.flight },
    { label: "Rental", ...booked.car, fx: bookedFx.car },
  ];
  const bookedFxSum = (side: "planned" | "actual") => bookedRows.reduce((t, r) => t + (r.fx[side] ?? 0), 0);
  const bookedPlanned = bookedRows.reduce((t, r) => t + r.planned, 0);
  const bookedActual = bookedRows.reduce((t, r) => t + r.actual, 0);
  const totals = {
    planned: sum("planned") + bookedPlanned,
    plannedEur: sum("plannedEur") + bookedFxSum("planned"),
    actual: rows.reduce((total, r) => total + rowActual(r), 0) + bookedActual,
    actualEur: sum("actualEur") + bookedFxSum("actual"),
  };
  // Planned less actual, in dollars, with a blank counted as zero — plain
  // arithmetic, so the Total row's difference is exactly its planned minus its
  // actual. Positive is under plan, negative over. Empty rows show a dash.
  const cents = (v: string) => (v.trim() ? Math.max(0, displayToCents(v)) : 0);
  const difference = (r: Row) => (r.planned.trim() || hasActual(r) ? cents(r.planned) - rowActual(r) : null);
  const totalDiff = totals.planned || totals.actual ? totals.planned - totals.actual : null;
  // The same sum in the trip's other currency, from its own two columns.
  const differenceFx = (r: Row) =>
    r.plannedEur.trim() || r.actualEur.trim() ? cents(r.plannedEur) - cents(r.actualEur) : null;
  const totalDiffFx = totals.plannedEur || totals.actualEur ? totals.plannedEur - totals.actualEur : null;
  const diffCell = (d: number | null, foreign = false) => (
    <span className={`tabular-nums ${d == null ? "text-muted" : d >= 0 ? "text-positive" : "text-negative"}`}>
      {d == null
        ? "—"
        : `${d >= 0 ? "" : "−"}${foreign ? formatForeignWhole(Math.abs(d), foreignCurrency) : formatMoneyWhole(Math.abs(d), currency)}`}
    </span>
  );
  // A Difference figure: its own labelled line on a phone, a column on a wide screen.
  const diffSlot = (d: number | null, foreign = false) => (
    <span className="col-span-2 flex items-baseline justify-between text-sm font-semibold sm:col-span-1 sm:block sm:text-center">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted sm:hidden">
        Difference ({foreign ? fx : currencySymbol(currency)})
      </span>
      {diffCell(d, foreign)}
    </span>
  );
  const usdHead = currency === "USD" ? "USD $" : currencySymbol(currency);
  const fxHead = fx === foreignCurrency ? fx : `${foreignCurrency} ${fx}`;

  // On a wide screen the column headings sit once above the rows; on a phone
  // each category is its own card, so every box keeps its own label.
  const money = (r: Row, key: "planned" | "plannedEur" | "actual" | "actualEur", label: string) => (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted sm:hidden">{label}</span>
      {key === "actual" && r.txCount > 0 ? (
        // Backed by tagged purchases: shown, not typed. The count says why.
        <span className="relative block">
          <input value={centsToDisplay(Math.max(0, r.txActualCents ?? 0))} readOnly tabIndex={-1} className={`${inputClass} opacity-70 sm:text-center`} />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted">{r.txCount} tx</span>
        </span>
      ) : (
      <input
        value={r[key]}
        onChange={(e) => update(r.category, { [key]: e.target.value })}
        onFocus={() => (focused.current = { category: r.category, slot: key.startsWith("planned") ? "planned" : "actual" })}
        inputMode="decimal"
        className={`${inputClass} sm:text-center`}
      />
      )}
    </label>
  );

  const body = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (embed) return;
          start(async () => {
            setError(null);
            const result = await saveTripExpenses({ ...trip, startOn, endOn, foreignCurrency, rows });
            if (result.error) setError(result.error);
            else {
              router.refresh();
              onClose();
            }
          });
        }}
        className={`grid grid-cols-1 gap-3 ${embed ? "" : "px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]"}`}
      >
        {/* Which trip, and the span it covers, on one line: the picker on the
            left, the trip's own dates on the right. Inside the Add Travel Log
            popup both live in that popup's header instead, so neither is typed
            twice. */}
        {embed ? null : (
          <TripPicker
            trips={trips}
            value={trip}
            onChange={setTrip}
            oneLine
            trailing={
              <>
                <Field label="Trip starts" className="w-[9.5rem]">
                  <input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Trip ends" className="w-[9.5rem]">
                  <input type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} className={inputClass} />
                </Field>
              </>
            }
          />
        )}

        <section className={embed ? "" : "border-t border-line pt-3"}>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide">Spending for the whole trip</h3>
            <CurrencySelect value={foreignCurrency} onChange={setForeignCurrency} />
            <div className="has-[.rounded-xl]:basis-full sm:ml-auto">
              <CurrencyConverter onUse={applyConverted} blue defaultFrom={foreignCurrency} />
            </div>
          </div>

          {/* Two-level header, the same as the flight form: Planned and Spent
              each span their two columns, with the currency under each. */}
          <div className="hidden grid-cols-[8.5rem_repeat(6,minmax(0,1fr))] items-end gap-x-2 gap-y-1 pb-1.5 text-center text-[11px] font-bold uppercase tracking-wide sm:grid">
            <span className="row-span-2 self-end pb-0.5 text-left text-muted">Category</span>
            <span className="col-span-2 border-b-2 border-line pb-0.5 text-muted">Planned</span>
            <span className="col-span-2 border-b-2 border-sky-400 pb-0.5 text-foreground dark:border-sky-500">Spent</span>
            <span className="col-span-2 border-b-2 border-line pb-0.5 text-muted">Difference</span>
            <span className="font-semibold text-muted">{usdHead}</span>
            <span className="font-semibold text-muted">{fxHead}</span>
            <span className="font-semibold text-foreground">{usdHead}</span>
            <span className="font-semibold text-foreground">{fxHead}</span>
            <span className="font-semibold text-muted">{usdHead}</span>
            <span className="font-semibold text-muted">{fxHead}</span>
          </div>
          <ul className="space-y-2">
            {/* From the trip's own bookings, not typed here — shown so the
                Total below is the whole trip. Editing one is the Stay, Flight
                or Rental section itself. */}
            {bookedRows.map((b) => (
              <li
                key={b.label}
                className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background/60 p-2.5 ring-1 ring-line sm:grid-cols-[8.5rem_repeat(6,minmax(0,1fr))] sm:items-center sm:rounded-none sm:bg-transparent sm:p-0 sm:ring-0"
              >
                <span className="col-span-2 flex items-baseline gap-2 text-sm font-semibold sm:col-span-1">
                  {b.label}
                  <span className="text-[10px] font-normal uppercase tracking-wide text-muted">Booked</span>
                </span>
                <BookedCell label={`Planned (${currencySymbol(currency)})`} value={b.planned ? formatMoneyWhole(b.planned, currency) : "—"} />
                <BookedCell label={`Planned (${fx})`} value={b.fx.planned ? formatForeignWhole(b.fx.planned, foreignCurrency) : "—"} />
                <BookedCell label={`Spent (${currencySymbol(currency)})`} value={b.actual ? formatMoneyWhole(b.actual, currency) : "—"} />
                <BookedCell label={`Spent (${fx})`} value={b.fx.actual ? formatForeignWhole(b.fx.actual, foreignCurrency) : "—"} />
                {/* Nothing to compare against when the booking never was an
                    estimate — a dash, not a red "over by the full price". */}
                {diffSlot(b.planned ? b.planned - b.actual : null)}
                {diffSlot(b.fx.planned ? b.fx.planned - (b.fx.actual ?? 0) : null, true)}
              </li>
            ))}
            {rows.map((r) => {
              const label = EXPENSE_CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category;
              return (
                <li
                  key={r.category}
                  className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background/60 p-2.5 ring-1 ring-line sm:grid-cols-[8.5rem_repeat(6,minmax(0,1fr))] sm:items-center sm:rounded-none sm:bg-transparent sm:p-0 sm:ring-0"
                >
                  <span className="col-span-2 text-sm font-semibold sm:col-span-1">{label}</span>
                  {money(r, "planned", `Planned (${currencySymbol(currency)})`)}
                  {money(r, "plannedEur", `Planned (${fx})`)}
                  {money(r, "actual", `Spent (${currencySymbol(currency)})`)}
                  {money(r, "actualEur", `Spent (${fx})`)}
                  {diffSlot(difference(r))}
                  {diffSlot(differenceFx(r), true)}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-2 text-sm font-bold tabular-nums sm:grid-cols-[8.5rem_repeat(6,minmax(0,1fr))] sm:text-center">
            <span className="col-span-2 sm:col-span-1 sm:text-left">Total</span>
            <span><span className="text-[10px] font-semibold uppercase text-muted sm:hidden">Planned </span>{formatMoneyWhole(totals.planned, currency)}</span>
            <span>{formatForeignWhole(totals.plannedEur, foreignCurrency)}</span>
            <span><span className="text-[10px] font-semibold uppercase text-muted sm:hidden">Spent </span>{formatMoneyWhole(totals.actual, currency)}</span>
            <span>{formatForeignWhole(totals.actualEur, foreignCurrency)}</span>
            <span className="col-span-2 sm:col-span-1">
              <span className="text-[10px] font-semibold uppercase text-muted sm:hidden">Difference </span>
              {diffCell(totalDiff)}
            </span>
            <span className="col-span-2 sm:col-span-1">
              <span className="text-[10px] font-semibold uppercase text-muted sm:hidden">Difference ({fx}) </span>
              {diffCell(totalDiffFx, true)}
            </span>
          </div>
        </section>

        {error && !embed ? <p className="rounded-md bg-negative/10 px-3 py-2 text-sm font-medium text-negative">{error}</p> : null}

        {embed ? null : (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save spending"}
            </button>
          </div>
        </div>
        )}
      </form>
  );
  return embed ? body : (
    <ModalShell title="Trip spending" onClose={onClose} className="sm:max-w-4xl">
      {body}
    </ModalShell>
  );
}

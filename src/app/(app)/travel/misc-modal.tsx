"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CurrencyConverter, type ConvertedFrom } from "@/components/currency-converter";
import { centsToDisplay, currencySymbol, displayToCents, formatMoney } from "@/lib/money";
import { saveTripExpenses } from "./expense-actions";
import { Field, inputClass } from "./travel-form";
import { TripPicker, useTripChoice } from "./trip-picker";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type TravelCard, type TravelTrip, type TripExpense } from "./types";

type Row = {
  category: ExpenseCategory;
  planned: string;
  plannedEur: string;
  actual: string;
  actualEur: string;
  accountId: string;
};
type Slot = "planned" | "actual";

const show = (cents: number | null | undefined) => (cents == null ? "" : centsToDisplay(cents));

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
  cards,
  defaultTripId,
  currency,
  kindSwitch,
  onClose,
}: {
  currency: string;
  trips: TravelTrip[];
  expenses: TripExpense[];
  cards: TravelCard[];
  defaultTripId?: string | null;
  kindSwitch?: React.ReactNode;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [trip, setTripChoice] = useTripChoice(defaultTripId);
  const current = trips.find((t) => t.id === trip.tripId) ?? null;
  const [startOn, setStartOn] = useState(current?.startOn ?? "");
  const [endOn, setEndOn] = useState(current?.endOn ?? "");
  const [rows, setRows] = useState<Row[]>(() => rowsFor(trip.tripId, expenses));
  // The field the currency converter fills: the one last clicked into.
  const focused = useRef<{ category: ExpenseCategory; slot: Slot } | null>(null);

  // Switching trips shows that trip's own figures and dates.
  function setTrip(next: { tripId: string; newTripName: string }) {
    if (next.tripId !== trip.tripId) {
      const t = trips.find((x) => x.id === next.tripId);
      setRows(rowsFor(next.tripId, expenses));
      setStartOn(t?.startOn ?? "");
      setEndOn(t?.endOn ?? "");
    }
    setTripChoice(next);
  }

  const update = (category: ExpenseCategory, patch: Partial<Row>) =>
    setRows((all) => all.map((r) => (r.category === category ? { ...r, ...patch } : r)));

  function applyConverted(cents: number, from: ConvertedFrom) {
    const target = focused.current ?? { category: rows[0].category, slot: "actual" as Slot };
    update(target.category, {
      [target.slot]: centsToDisplay(cents),
      ...(from.currency === "EUR" ? { [`${target.slot}Eur`]: centsToDisplay(from.amountCents) } : {}),
    });
  }

  const sum = (key: keyof Row) => rows.reduce((total, r) => total + (r[key] ? Math.max(0, displayToCents(r[key])) : 0), 0);
  const totals = { planned: sum("planned"), plannedEur: sum("plannedEur"), actual: sum("actual"), actualEur: sum("actualEur") };
  // What counts toward the trip: each category's actual, or its plan until then.
  const counted = rows.reduce(
    (total, r) => total + (r.actual.trim() ? displayToCents(r.actual) : r.planned.trim() ? displayToCents(r.planned) : 0),
    0,
  );

  // On a wide screen the column headings sit once above the rows; on a phone
  // each category is its own card, so every box keeps its own label.
  const money = (r: Row, key: "planned" | "plannedEur" | "actual" | "actualEur", label: string) => (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted sm:hidden">{label}</span>
      <input
        value={r[key]}
        onChange={(e) => update(r.category, { [key]: e.target.value })}
        onFocus={() => (focused.current = { category: r.category, slot: key.startsWith("planned") ? "planned" : "actual" })}
        inputMode="decimal"
        className={inputClass}
      />
    </label>
  );
  const headings = [`Planned (${currencySymbol(currency)})`, "Planned (€)", `Actual (${currencySymbol(currency)})`, "Actual (€)", "Card"];

  return (
    <ModalShell title="Trip spending" onClose={onClose} className="sm:max-w-4xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const result = await saveTripExpenses({ ...trip, startOn, endOn, rows });
            if (result.error) setError(result.error);
            else {
              router.refresh();
              onClose();
            }
          });
        }}
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        {kindSwitch}
        <TripPicker trips={trips} value={trip} onChange={setTrip} />

        {/* The span these totals cover — the trip's own dates. */}
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Field label="Trip starts">
            <input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Trip ends">
            <input type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <section className="border-t border-line pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide">Spending for the whole trip</h3>
            <div className="has-[.rounded-xl]:basis-full">
              <CurrencyConverter onUse={applyConverted} />
            </div>
          </div>

          <div className="hidden grid-cols-[8.5rem_1fr_1fr_1fr_1fr_10rem] gap-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted sm:grid">
            <span>Category</span>
            {headings.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
          <ul className="space-y-2">
            {rows.map((r) => {
              const label = EXPENSE_CATEGORIES.find((c) => c.key === r.category)?.label ?? r.category;
              return (
                <li
                  key={r.category}
                  className="grid grid-cols-2 items-end gap-2 rounded-lg bg-background/60 p-2.5 ring-1 ring-line sm:grid-cols-[8.5rem_1fr_1fr_1fr_1fr_10rem] sm:items-center sm:rounded-none sm:bg-transparent sm:p-0 sm:ring-0"
                >
                  <span className="col-span-2 text-sm font-semibold sm:col-span-1">{label}</span>
                  {money(r, "planned", `Planned (${currencySymbol(currency)})`)}
                  {money(r, "plannedEur", "Planned (€)")}
                  {money(r, "actual", `Actual (${currencySymbol(currency)})`)}
                  {money(r, "actualEur", "Actual (€)")}
                  <label className="col-span-2 block min-w-0 sm:col-span-1">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted sm:hidden">Card</span>
                    <select value={r.accountId} onChange={(e) => update(r.category, { accountId: e.target.value })} className={inputClass}>
                      <option value="">—</option>
                      {cards.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-2 text-sm font-bold tabular-nums sm:grid-cols-[8.5rem_1fr_1fr_1fr_1fr_10rem]">
            <span className="col-span-2 sm:col-span-1">Total</span>
            <span><span className="text-[10px] font-semibold uppercase text-muted sm:hidden">Planned </span>{formatMoney(totals.planned, currency)}</span>
            <span>€{centsToDisplay(totals.plannedEur)}</span>
            <span><span className="text-[10px] font-semibold uppercase text-muted sm:hidden">Actual </span>{formatMoney(totals.actual, currency)}</span>
            <span>€{centsToDisplay(totals.actualEur)}</span>
          </div>
        </section>

        {error ? <p className="rounded-md bg-negative/10 px-3 py-2 text-sm font-medium text-negative">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            Counts toward the trip{" "}
            <span className="font-bold tabular-nums text-foreground">{formatMoney(counted, currency)}</span>
            <span className="ml-1">(actual, or planned where there is no actual yet)</span>
          </p>
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
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save spending"}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

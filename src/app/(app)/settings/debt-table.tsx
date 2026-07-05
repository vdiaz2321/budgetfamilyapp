"use client";

import { useTransition } from "react";
import { upsertDebt } from "./actions";
import { centsToDisplay, formatMoney } from "@/lib/money";

type Sub = { id: string; name: string; due_day: number | null };

type Debt = {
  subcategory_id: string;
  current_balance_cents: number;
  min_payment_cents: number;
  apr: number;
  due_day: number | null;
};

type Props = {
  currency: string;
  debtSubcategories: Sub[];
  debts: Debt[];
};

export function DebtTable({ currency, debtSubcategories, debts }: Props) {
  const debtsBySub = new Map(debts.map((d) => [d.subcategory_id, d]));

  const totals = debtSubcategories.reduce(
    (acc, s) => {
      const d = debtsBySub.get(s.id);
      if (d) {
        acc.balance += d.current_balance_cents;
        acc.min += d.min_payment_cents;
      }
      return acc;
    },
    { balance: 0, min: 0 },
  );

  return (
    <section>
      <header className="mb-3 rounded-t-xl bg-violet-200 px-4 py-2 text-center text-sm font-semibold tracking-widest text-violet-900 dark:bg-violet-950 dark:text-violet-100">
        D E B T &nbsp; S N O W B A L L
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-[minmax(180px,1.5fr),1fr,1fr,90px,60px] gap-2 border-b border-zinc-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <span>Debt</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Min. Payment</span>
          <span className="text-right">Interest</span>
          <span className="text-right">Due</span>
        </div>

        {debtSubcategories.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            Add Debt entries (auto loans and credit cards) in the Categories
            grid above first, then set their balance / min / interest here.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {debtSubcategories.map((s) => (
              <DebtRow
                key={s.id}
                sub={s}
                debt={debtsBySub.get(s.id)}
              />
            ))}
          </ul>
        )}

        <div className="grid grid-cols-[minmax(180px,1.5fr),1fr,1fr,90px,60px] gap-2 border-t-2 border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
          <span>TOTAL</span>
          <span className="text-right tabular-nums">{formatMoney(totals.balance, currency)}</span>
          <span className="text-right tabular-nums">{formatMoney(totals.min, currency)}</span>
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}

function DebtRow({ sub, debt }: { sub: Sub; debt: Debt | undefined }) {
  const [pending, start] = useTransition();

  return (
    <li>
      <form
        action={(fd) => start(() => upsertDebt(fd))}
        className="grid grid-cols-[minmax(180px,1.5fr),1fr,1fr,90px,60px,auto] items-center gap-2 px-4 py-2"
      >
        <input type="hidden" name="subcategoryId" value={sub.id} />
        <span className="text-sm text-zinc-800 dark:text-zinc-200">{sub.name}</span>
        <MoneyInput name="balance" defaultCents={debt?.current_balance_cents ?? 0} />
        <MoneyInput name="minPayment" defaultCents={debt?.min_payment_cents ?? 0} />
        <input
          name="apr"
          type="number"
          step="0.001"
          defaultValue={debt?.apr ?? 0}
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <input
          name="dueDay"
          type="number"
          min={1}
          max={31}
          defaultValue={debt?.due_day ?? sub.due_day ?? ""}
          placeholder="—"
          className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "…" : "Save"}
        </button>
      </form>
    </li>
  );
}

function MoneyInput({ name, defaultCents }: { name: string; defaultCents: number }) {
  return (
    <input
      name={name}
      type="number"
      step="0.01"
      defaultValue={centsToDisplay(defaultCents)}
      className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
    />
  );
}

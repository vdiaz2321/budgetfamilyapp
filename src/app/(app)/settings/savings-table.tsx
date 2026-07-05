"use client";

import { useTransition } from "react";
import { upsertSavingsGoal } from "./actions";
import { centsToDisplay, formatMoney } from "@/lib/money";

type Sub = { id: string; name: string };

type SavingsGoal = {
  subcategory_id: string;
  goal_cents: number;
  start_cents: number;
  monthly_contribution_cents: number;
};

type Props = {
  currency: string;
  savingsSubcategories: Sub[];
  goals: SavingsGoal[];
};

export function SavingsTable({ currency, savingsSubcategories, goals }: Props) {
  const goalsBySub = new Map(goals.map((g) => [g.subcategory_id, g]));

  const totals = savingsSubcategories.reduce(
    (acc, s) => {
      const g = goalsBySub.get(s.id);
      if (g) {
        acc.goal += g.goal_cents;
        acc.start += g.start_cents;
        acc.monthly += g.monthly_contribution_cents;
      }
      return acc;
    },
    { goal: 0, start: 0, monthly: 0 },
  );

  return (
    <section>
      <header className="mb-3 rounded-t-xl bg-rose-200 px-4 py-2 text-center text-sm font-semibold tracking-widest text-rose-900 dark:bg-rose-950 dark:text-rose-100">
        S A V I N G S &nbsp; &amp; &nbsp; S I N K I N G &nbsp; F U N D S
      </header>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-[minmax(160px,1.5fr),1fr,1fr,1fr] gap-2 border-b border-zinc-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <span>Fund</span>
          <span className="text-right">Goal</span>
          <span className="text-right">Start</span>
          <span className="text-right">Monthly</span>
        </div>

        {savingsSubcategories.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            Add Savings entries in the Categories grid above first, then set
            their goal / start / monthly here.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {savingsSubcategories.map((s) => (
              <SavingsRow
                key={s.id}
                sub={s}
                goal={goalsBySub.get(s.id)}
              />
            ))}
          </ul>
        )}

        <div className="grid grid-cols-[minmax(160px,1.5fr),1fr,1fr,1fr] gap-2 border-t-2 border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
          <span>TOTAL</span>
          <span className="text-right tabular-nums">{formatMoney(totals.goal, currency)}</span>
          <span className="text-right tabular-nums">{formatMoney(totals.start, currency)}</span>
          <span className="text-right tabular-nums">{formatMoney(totals.monthly, currency)}</span>
        </div>
      </div>
    </section>
  );
}

function SavingsRow({ sub, goal }: { sub: Sub; goal: SavingsGoal | undefined }) {
  const [pending, start] = useTransition();

  return (
    <li>
      <form
        action={(fd) => start(() => upsertSavingsGoal(fd))}
        className="grid grid-cols-[minmax(160px,1.5fr),1fr,1fr,1fr,auto] items-center gap-2 px-4 py-2"
      >
        <input type="hidden" name="subcategoryId" value={sub.id} />
        <span className="text-sm text-zinc-800 dark:text-zinc-200">{sub.name}</span>
        <MoneyInput name="goal" defaultCents={goal?.goal_cents ?? 0} />
        <MoneyInput name="start" defaultCents={goal?.start_cents ?? 0} />
        <MoneyInput name="monthly" defaultCents={goal?.monthly_contribution_cents ?? 0} />
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

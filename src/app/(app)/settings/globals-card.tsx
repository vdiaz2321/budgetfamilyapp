"use client";

import { useTransition } from "react";
import { updateGlobals } from "./actions";
import { centsToDisplay } from "@/lib/money";

type Props = {
  currency: string;
  year: number;
  snowballStartDate: string | null;
  snowballMonthlyExtraCents: number;
};

export function GlobalsCard({
  currency,
  year,
  snowballStartDate,
  snowballMonthlyExtraCents,
}: Props) {
  const [pending, start] = useTransition();

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-800">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Globals
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Currency, budget year, and the debt snowball settings that carry through
        every other tab.
      </p>

      <form
        className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        action={(fd) => start(() => updateGlobals(fd))}
      >
        <Field label="Currency">
          <input
            name="currency"
            defaultValue={currency}
            maxLength={3}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
        <Field label="Year">
          <input
            name="year"
            type="number"
            defaultValue={year}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
        <Field label="Snowball start date">
          <input
            name="snowballStartDate"
            type="date"
            defaultValue={snowballStartDate ?? ""}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>
        <Field label="Snowball monthly extra">
          <input
            name="snowballMonthlyExtra"
            type="number"
            step="0.01"
            defaultValue={centsToDisplay(snowballMonthlyExtraCents)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </Field>

        <div className="sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save globals"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

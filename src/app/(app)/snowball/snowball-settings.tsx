"use client";

import { useTransition } from "react";
import { centsToDisplay } from "@/lib/money";
import { updateGlobals } from "../budget/actions";

type Props = {
  currency: string;
  snowballStartDate: string | null;
  snowballMonthlyExtraCents: number;
};

export function SnowballSettings({
  currency,
  snowballStartDate,
  snowballMonthlyExtraCents,
}: Props) {
  const [pending, start] = useTransition();

  return (
    <section className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <h2 className="text-sm font-semibold">Snowball settings</h2>
      <p className="mt-0.5 text-xs text-muted">
        The extra you throw at your smallest debt each month, on top of every
        minimum payment. These carry across every tab.
      </p>
      <form
        action={(fd) => start(() => updateGlobals(fd))}
        className="mt-4 grid gap-3 sm:grid-cols-3"
      >
        <Field label="Currency">
          <input
            name="currency"
            defaultValue={currency}
            maxLength={3}
            className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <Field label="Snowball start date">
          <input
            name="snowballStartDate"
            type="date"
            defaultValue={snowballStartDate ?? ""}
            className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <Field label="Monthly extra">
          <input
            name="snowballMonthlyExtra"
            type="number"
            step="0.01"
            defaultValue={centsToDisplay(snowballMonthlyExtraCents)}
            className="w-full rounded-lg bg-background px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

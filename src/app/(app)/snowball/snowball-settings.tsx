"use client";

import { useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { addSnowballPeriod, deleteSnowballPeriod, updateGlobals } from "../budget/actions";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monthLabel(month: string): string {
  const idx = parseInt(month.slice(5, 7), 10) - 1;
  return `${MONTHS_SHORT[idx]} ${month.slice(0, 4)}`;
}

type Period = {
  id: string;
  startMonth: string;
  endMonth: string | null;
  amountCents: number;
};

type Props = {
  currency: string;
  snowballStartDate: string | null;
  snowballMonthlyExtraCents: number;
  periods: Period[];
};

export function SnowballSettings({
  currency,
  snowballStartDate,
  snowballMonthlyExtraCents,
  periods,
}: Props) {
  const [pending, start] = useTransition();

  return (
    <section className="rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <h2 className="text-sm font-semibold">Snowball settings</h2>
      <p className="mt-0.5 text-xs text-muted">
        The extra you throw at your smallest debt each month, on top of every
        minimum payment. Used by the Classic Snowball view.
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
        <Field label="Monthly extra (base)">
          <input
            name="snowballMonthlyExtra"
            type="number"
            step="0.01"
            defaultValue={centsToDisplay(snowballMonthlyExtraCents)}
            onFocus={(e) => e.currentTarget.select()}
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

      {/* Time-varying extra periods */}
      <div className="mt-6 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Extra payment periods</h3>
        <p className="mt-0.5 text-xs text-muted">
          Optional. Add extra for a date range on top of the base above — e.g. pay more while a
          0% promo is running, then stop. Leave the end date blank for ongoing.
        </p>

        {periods.length > 0 ? (
          <ul className="mt-3 divide-y divide-line/60">
            {periods.map((p) => (
              <PeriodRow key={p.id} period={p} currency={currency} />
            ))}
          </ul>
        ) : null}

        <AddPeriodForm />
      </div>
    </section>
  );
}

function PeriodRow({ period, currency }: { period: Period; currency: string }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="text-muted">
        {monthLabel(period.startMonth)} –{" "}
        {period.endMonth ? monthLabel(period.endMonth) : "ongoing"}
      </span>
      <div className="flex items-center gap-3">
        <span className="font-semibold tabular-nums">
          +{formatMoney(period.amountCents, currency)}/mo
        </span>
        <form action={(fd) => start(() => deleteSnowballPeriod(fd))}>
          <input type="hidden" name="id" value={period.id} />
          <button
            type="submit"
            disabled={pending}
            className="text-xs font-medium text-negative hover:underline disabled:opacity-60"
          >
            Remove
          </button>
        </form>
      </div>
    </li>
  );
}

function AddPeriodForm() {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-sm font-medium text-brand hover:text-brand-strong"
      >
        + Add period
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        start(async () => {
          await addSnowballPeriod(fd);
          setOpen(false);
        })
      }
      className="mt-3 grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
    >
      <Field label="Start month">
        <input
          name="startMonth"
          type="date"
          required
          className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label="End month (blank = ongoing)">
        <input
          name="endMonth"
          type="date"
          className="w-full rounded-lg bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <Field label="Extra / mo">
        <input
          name="amount"
          type="number"
          step="0.01"
          placeholder="0.00"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg bg-background px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </Field>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-2 py-1.5 text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
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

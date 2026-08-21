"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  currentPeriodKey,
  periodOptions,
  priorKey,
  type Granularity,
} from "./period";

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

// One control, three segments: [Last month] [This month] [<selected> ▾].
// The third segment opens a two-level menu (granularity → specific period),
// mirroring the Rocket Money period picker.
export function PeriodPicker({
  granularity,
  periodKey,
  label,
  minYear,
}: {
  granularity: Granularity;
  periodKey: string;
  label: string;
  minYear: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Granularity | null>(null);

  const go = (g: Granularity, p: string) => {
    setOpen(false);
    setSubmenu(null);
    router.push(`/insights?g=${g}&p=${encodeURIComponent(p)}`);
  };

  const thisMonth = currentPeriodKey("monthly");
  const lastMonth = priorKey("monthly", thisMonth);
  const isThisMonth = granularity === "monthly" && periodKey === thisMonth;
  const isLastMonth = granularity === "monthly" && periodKey === lastMonth;
  const isOther = !isThisMonth && !isLastMonth;

  const seg = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-surface text-foreground shadow-sm"
        : "text-muted hover:text-foreground"
    }`;

  return (
    <div className="relative">
      <div className="inline-flex items-center gap-0.5 rounded-full bg-black/[0.06] p-1 dark:bg-white/10">
        <button type="button" className={seg(isLastMonth)} onClick={() => go("monthly", lastMonth)}>
          Last month
        </button>
        <button type="button" className={seg(isThisMonth)} onClick={() => go("monthly", thisMonth)}>
          This month
        </button>
        <button
          type="button"
          className={`flex items-center gap-1 ${seg(isOther)}`}
          onClick={() => {
            setOpen((o) => !o);
            setSubmenu(null);
          }}
          aria-expanded={open}
        >
          {isOther ? label : "More"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => {
              setOpen(false);
              setSubmenu(null);
            }}
          />
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl bg-surface py-1 shadow-lg ring-1 ring-black/10 dark:ring-white/10">
            {submenu == null ? (
              GRANULARITIES.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setSubmenu(g.value)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {g.label}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ))
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSubmenu(null)}
                  className="flex w-full items-center gap-1.5 border-b border-line px-3 py-2 text-left text-sm font-semibold transition hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Back
                </button>
                <div className="max-h-72 overflow-y-auto py-1">
                  {periodOptions(submenu, minYear).map((o) => {
                    const selected = submenu === granularity && o.key === periodKey;
                    return (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => go(submenu, o.key)}
                        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        {o.label}
                        {selected ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground" aria-hidden>
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

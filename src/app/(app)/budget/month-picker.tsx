"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function MonthPicker({
  monthKey,
  basePath = "/budget",
}: {
  monthKey: string;
  basePath?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [year, month1] = monthKey.split("-").map(Number); // month1 is 1-based
  const [viewYear, setViewYear] = useState(year);

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const isCurrent = monthKey === currentKey;

  function goTo(key: string) {
    setOpen(false);
    router.push(`${basePath}?month=${key}`);
  }

  function toggle() {
    setViewYear(year); // reset view to the active month's year each open
    setOpen((v) => !v);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-2xl tracking-tight"
      >
        <span className="font-bold text-foreground">{MONTHS_FULL[month1 - 1]}</span>
        <span className="font-normal text-muted">{year}</span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`mt-0.5 text-brand transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute left-0 top-11 z-50 w-80 rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
            {/* Year navigator */}
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setViewYear((v) => v - 1)}
                aria-label="Previous year"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-brand hover:bg-brand-soft"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="text-lg font-bold text-foreground">{viewYear}</span>
              <button
                type="button"
                onClick={() => setViewYear((v) => v + 1)}
                aria-label="Next year"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-brand hover:bg-brand-soft"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>

            {/* Month grid */}
            <div className="grid grid-cols-4 gap-2">
              {MONTHS_SHORT.map((name, i) => {
                const key = `${viewYear}-${pad2(i + 1)}`;
                const isSelected = key === monthKey;
                const isThisMonth = key === currentKey;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => goTo(key)}
                    className={`rounded-lg py-2.5 text-sm font-medium transition ${
                      isSelected
                        ? "bg-brand text-white"
                        : isThisMonth
                          ? "ring-1 ring-brand text-brand hover:bg-brand-soft"
                          : "text-foreground hover:bg-brand-soft"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-3 border-t border-line pt-3 text-center text-sm">
              {isCurrent ? (
                <span className="text-muted">You&apos;re on the current month</span>
              ) : (
                <button
                  type="button"
                  onClick={() => goTo(currentKey)}
                  className="font-medium text-brand hover:text-brand-strong"
                >
                  Back to current month
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

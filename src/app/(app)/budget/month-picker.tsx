"use client";

import { useEffect, useState, useTransition } from "react";
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
  label,
}: {
  monthKey: string;
  basePath?: string;
  // Shown in place of the month when the page isn't on a single month (All
  // time). The arrows go, since there's no month to step from; the grid stays.
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The server render for a month takes a while, so the click needs to say so
  // immediately: the title swaps to the month being opened and dims until the
  // new page commits. Without it the picker just closed and nothing appeared
  // to happen.
  const [pending, startNavigation] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const [year, month1] = monthKey.split("-").map(Number); // month1 is 1-based
  const [viewYear, setViewYear] = useState(year);

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const isCurrent = monthKey === currentKey;

  function goTo(key: string) {
    setOpen(false);
    setTarget(key);
    // Session cookie (no Max-Age) — cleared when browser closes, so fresh
    // logins always land on the current month.
    document.cookie = `budget-month=${key}; path=/; SameSite=Lax`;
    startNavigation(() => router.push(`${basePath}?month=${key}`));
  }

  function toggle() {
    setViewYear(year); // reset view to the active month's year each open
    setOpen((v) => !v);
    // Warm the months either side of this one while the panel is open, so the
    // most likely picks are already on their way when they're clicked.
    if (!open) {
      for (const offset of [-1, 1]) {
        const d = new Date(year, month1 - 1 + offset, 1);
        router.prefetch(`${basePath}?month=${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
      }
    }
  }

  // One step back or forward without opening the panel. Both neighbours are
  // prefetched on load so an arrow tap opens almost at once.
  const shiftKey = (offset: number) => {
    const d = new Date(year, month1 - 1 + offset, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  };
  useEffect(() => {
    for (const offset of [-1, 1]) router.prefetch(`${basePath}?month=${shiftKey(offset)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, basePath]);
  const arrow = "flex h-9 w-8 shrink-0 touch-manipulation select-none items-center justify-center rounded-lg text-brand ring-1 ring-line transition hover:bg-brand-soft disabled:opacity-50 sm:h-8 sm:w-8";

  // While a month is loading the trigger shows where you're going, not where
  // you were.
  const [shownYear, shownMonth1] = (pending && target ? target : monthKey).split("-").map(Number);
  const shownLabel = pending && target ? undefined : label;

  // `select-none` on the trigger and the panel is load-bearing on touch: the
  // month labels are plain text, so a tap that drifts a pixel starts a text
  // selection and the browser swallows the click — the picker looked frozen on
  // a phone until the page was reloaded. `touch-manipulation` drops the
  // double-tap-zoom delay on the same taps.
  return (
    <div className="relative flex items-center gap-1 sm:gap-1.5">
      {label ? null : (
        <button type="button" onClick={() => goTo(shiftKey(-1))} disabled={pending} aria-label="Previous month" className={arrow}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`flex touch-manipulation select-none items-center gap-1.5 text-2xl tracking-tight transition-opacity ${pending ? "opacity-50" : ""}`}
      >
        {/* Short name on a phone so the ‹ › arrows and Summary fit beside it. */}
        {shownLabel ? (
          <span className="font-bold text-foreground">{shownLabel}</span>
        ) : (
          <>
            <span className="font-bold text-foreground">
              <span className="sm:hidden">{MONTHS_SHORT[shownMonth1 - 1]}</span>
              <span className="max-sm:hidden">{MONTHS_FULL[shownMonth1 - 1]}</span>
            </span>
            <span className="font-normal text-muted">{shownYear}</span>
          </>
        )}
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
      {label ? null : (
        <button type="button" onClick={() => goTo(shiftKey(1))} disabled={pending} aria-label="Next month" className={arrow}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute left-0 top-11 z-50 w-80 touch-manipulation select-none rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
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
                const isSelected = !label && key === monthKey;
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
              {isCurrent && !label ? (
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

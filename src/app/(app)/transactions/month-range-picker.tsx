"use client";

import { useEffect, useRef, useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthName = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1];

// "Aug – Oct 2026", "Nov 2025 – Feb 2026", or "Aug 2026" for a single month.
function spanLabel(start: string, end: string) {
  const startYear = start.slice(0, 4);
  const endYear = end.slice(0, 4);
  if (start === end) return `${monthName(start)} ${startYear}`;
  return startYear === endYear
    ? `${monthName(start)} – ${monthName(end)} ${endYear}`
    : `${monthName(start)} ${startYear} – ${monthName(end)} ${endYear}`;
}

function lastDayOfMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${key}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

// The first and last month when the dates are whole months, else null (an old
// bookmark with days in it).
function wholeMonths(from: string | null, to: string | null): [string, string] | null {
  if (!from || !to || !from.endsWith("-01")) return null;
  const end = to.slice(0, 7);
  return to === lastDayOfMonth(end) ? [from.slice(0, 7), end] : null;
}

// What the page title says for a date range.
export function rangeLabel(from: string | null, to: string | null) {
  const months = wholeMonths(from, to);
  return months ? spanLabel(months[0], months[1]) : "Custom range";
}

export function MonthRangePicker({
  monthKey,
  monthLabel,
  from,
  to,
  isAllTime,
  onRange,
  onMonth,
  onAllTime,
  onClear,
}: {
  monthKey: string;
  monthLabel: string;
  from: string | null;
  to: string | null;
  isAllTime: boolean;
  onRange: (from: string, to: string) => void;
  onMonth: (key: string) => void;
  onAllTime: () => void;
  onClear: () => void;
}) {
  const active = Boolean(from || to);
  const current = wholeMonths(from, to);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [viewYear, setViewYear] = useState(Number(monthKey.slice(0, 4)));
  const boxRef = useRef<HTMLDivElement>(null);

  // A document listener, not a full-screen backdrop: the page header's blur
  // would trap a `fixed` backdrop inside the header on a phone.
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  function toggle() {
    if (!open) {
      // Reopens on what's showing, so a range can be adjusted.
      setStart(current?.[0] ?? null);
      setEnd(current?.[1] ?? null);
      setViewYear(Number((current?.[1] ?? monthKey).slice(0, 4)));
    }
    setOpen((v) => !v);
  }

  function pick(key: string) {
    if (!start || end) {
      setStart(key);
      setEnd(null);
    } else if (key < start) {
      setEnd(start);
      setStart(key);
    } else {
      setEnd(key);
    }
  }

  function apply() {
    if (!start) return;
    setOpen(false);
    // One month is just that month, with its arrows back.
    if (!end || end === start) onMonth(start);
    else onRange(`${start}-01`, lastDayOfMonth(end));
  }

  const arrow = "flex h-8 w-8 items-center justify-center rounded-lg text-brand hover:bg-brand-soft";

  return (
    <div ref={boxRef} className="order-2 flex self-stretch sm:relative sm:order-4 sm:self-auto">
      <button
        type="button"
        aria-pressed={active}
        aria-expanded={open}
        onClick={toggle}
        className={`shrink-0 rounded-xl px-1.5 py-1.5 font-semibold transition max-sm:text-[11px] sm:px-3 sm:text-sm ${
          active
            ? "text-white shadow-sm ring-1"
            : "bg-surface text-foreground ring-1 ring-line hover:bg-sky-50 dark:hover:bg-sky-950/40"
        }`}
        style={active ? { backgroundColor: "var(--viz-savings)", boxShadow: "inset 0 0 0 1px var(--viz-savings)" } : undefined}
      >
        Date Range
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-full touch-manipulation select-none rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-black/5 sm:w-80 dark:ring-white/10">
          <p className="mb-2 text-center text-sm font-semibold text-foreground">
            {start ? (end ? spanLabel(start, end) : `${spanLabel(start, start)} – pick the last month`) : "Pick the first month"}
          </p>
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => setViewYear((v) => v - 1)} aria-label="Previous year" className={arrow}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="text-lg font-bold text-foreground">{viewYear}</span>
            <button type="button" onClick={() => setViewYear((v) => v + 1)} aria-label="Next year" className={arrow}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {MONTHS.map((name, i) => {
              const key = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
              const isEnd = key === start || key === end;
              const isBetween = Boolean(start && end && key > start && key < end);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={isEnd || isBetween}
                  onClick={() => pick(key)}
                  className={`rounded-lg py-2.5 text-sm font-medium transition ${
                    isEnd
                      ? "bg-brand text-white"
                      : isBetween
                        ? "bg-sky-100 text-foreground dark:bg-sky-900/50"
                        : "text-foreground hover:bg-sky-50 dark:hover:bg-sky-950/40"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              {isAllTime ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onAllTime();
                  }}
                  className="font-medium text-brand hover:text-brand-strong"
                >
                  All time
                </button>
              )}
              {active ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onClear();
                  }}
                  className="font-medium text-brand hover:text-brand-strong"
                >
                  Back to {monthLabel}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              disabled={!start}
              onClick={apply}
              className="ml-auto rounded-lg bg-brand px-4 py-2 font-bold text-white shadow-sm transition hover:bg-brand-strong disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

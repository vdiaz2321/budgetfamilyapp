"use client";

import { useState, useRef } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";

export type CatMonthRow = {
  subId: string;
  name: string;
  months: number[]; // 12 entries, cents
  total: number;
};

export type CatMonthGroup = {
  kind: CategoryKind;
  label: string;
  rows: CatMonthRow[];
  monthTotals: number[]; // 12 entries, cents
  total: number;
};

type Props = {
  groups: CatMonthGroup[];
  monthLabels: string[]; // 12 short labels (Jan…Dec)
  currency: string;
};

// subcategory label + 12 months + Total
const GRID_COLS = "grid-cols-[10rem_repeat(13,minmax(5rem,1fr))]";

export function CategoryMonthsTable({ groups, monthLabels, currency }: Props) {
  const [open, setOpen] = useState(false);
  const scrollersRef = useRef<Set<HTMLDivElement>>(new Set());

  function syncScrollX(scrollLeft: number) {
    scrollersRef.current.forEach((el) => {
      if (el.scrollLeft !== scrollLeft) el.scrollLeft = scrollLeft;
    });
  }

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-brand-soft/25"
      >
        <Chevron open={open} />
        <span className="font-semibold">Category by Months</span>
      </button>

      {open ? (
        groups.length ? (
          <div className="space-y-3 border-t border-line bg-brand-soft/10 p-3">
            {groups.map((g) => (
              <Group
                key={g.kind}
                group={g}
                monthLabels={monthLabels}
                currency={currency}
                scrollersRef={scrollersRef}
                syncScrollX={syncScrollX}
              />
            ))}
          </div>
        ) : (
          <p className="border-t border-line px-4 py-3 text-sm text-muted">
            No actuals recorded yet this year. Line items appear here once they have logged
            transactions.
          </p>
        )
      ) : null}
    </section>
  );
}

function Group({
  group,
  monthLabels,
  currency,
  scrollersRef,
  syncScrollX,
}: {
  group: CatMonthGroup;
  monthLabels: string[];
  currency: string;
  scrollersRef: React.RefObject<Set<HTMLDivElement>>;
  syncScrollX: (x: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const headerRef = useRef<HTMLDivElement>(null);

  function syncHeader() {
    const body = [...(scrollersRef.current ?? [])].find(
      (el) => el.closest(`[data-kind="${group.kind}"]`) !== null,
    );
    if (headerRef.current && body) {
      headerRef.current.scrollLeft = body.scrollLeft;
    }
  }

  return (
    <div
      data-kind={group.kind}
      className="overflow-hidden rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-brand-soft/40 px-4 py-2 text-left transition hover:bg-brand-soft/60"
      >
        <Chevron open={open} small />
        <span className="text-[11px] font-bold uppercase tracking-wide">{group.label}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-muted">
          {formatMoney(group.total, currency)}
        </span>
      </button>

      {open ? (
        <>
          <div
            ref={headerRef}
            className="border-y border-line bg-surface"
            style={{ overflowX: "hidden" }}
          >
            <div className="min-w-[74rem]">
              <div className={`grid ${GRID_COLS} items-center gap-2 pr-4 py-2`}>
                <span className="sticky left-0 z-10 bg-surface pl-4 text-[11px] font-medium uppercase tracking-wide text-muted">
                  Category
                </span>
                {monthLabels.map((m) => (
                  <span
                    key={m}
                    className="text-center text-[11px] font-medium uppercase tracking-wide text-muted"
                  >
                    {m}
                  </span>
                ))}
                <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                  Total
                </span>
              </div>
            </div>
          </div>

          <div
            ref={(el) => {
              if (el) scrollersRef.current.add(el);
            }}
            onScroll={(e) => {
              syncHeader();
              syncScrollX(e.currentTarget.scrollLeft);
            }}
            className="overflow-x-auto"
          >
            <div className="min-w-[74rem]">
              <ul className="divide-y divide-line">
                {group.rows.map((r) => (
                  <li key={r.subId} className={`grid ${GRID_COLS} items-center gap-2 pr-4 py-2`}>
                    <span className="sticky left-0 z-10 truncate bg-surface pl-4 text-sm font-medium" title={r.name}>
                      {r.name}
                    </span>
                    {r.months.map((v, i) => (
                      <span key={i} className="text-center text-xs tabular-nums">
                        {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
                      </span>
                    ))}
                    <span className="text-center text-xs font-semibold tabular-nums">
                      {formatMoney(r.total, currency)}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Subtotal */}
              <div className={`grid ${GRID_COLS} items-center gap-2 border-t border-line pr-4 py-2`}>
                <span className="sticky left-0 z-10 bg-surface pl-4 text-sm font-bold">Total</span>
                {group.monthTotals.map((v, i) => (
                  <span key={i} className="text-center text-xs font-bold tabular-nums">
                    {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
                  </span>
                ))}
                <span className="text-center text-xs font-bold tabular-nums">
                  {formatMoney(group.total, currency)}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Chevron({ open, small }: { open: boolean; small?: boolean }) {
  const size = small ? 13 : 15;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

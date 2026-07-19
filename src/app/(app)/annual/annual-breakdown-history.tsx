"use client";

import { useState, type CSSProperties } from "react";
import { formatMoney } from "@/lib/money";

export type BreakdownLine = {
  label: string;
  byYear: Record<number, number>; // cents, positive magnitude
  total: number;
};

export type BreakdownGroup = {
  label: string;
  lines: BreakdownLine[];
  subtotalByYear: Record<number, number>;
  total: number;
};

export type BreakdownKind = {
  kind: "income" | "expenses" | "savings" | "investment";
  label: string;
  groups: BreakdownGroup[];
  totalByYear: Record<number, number>;
  total: number;
};

type Props = {
  kinds: BreakdownKind[];
  years: number[]; // newest-first
  netByYear: Record<number, number>; // income − expenses − savings − investment
  currency: string;
};

export function AnnualBreakdownHistory({ kinds, years, netByYear, currency }: Props) {
  const [open, setOpen] = useState(false);

  if (!kinds.length) return null;

  // Dynamic column count (label + N years + Total) → inline style, since Tailwind's
  // JIT can't see a computed grid-cols-[…] arbitrary value.
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `12rem repeat(${years.length + 1}, minmax(5.5rem, 1fr))`,
  };
  const minW = `${13 + (years.length + 1) * 5.75}rem`;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-brand-soft/25"
      >
        <Chevron open={open} />
        <span className="font-semibold">Annual Breakdown</span>
        <span className="text-xs text-muted">
          {years[years.length - 1]}–{years[0]} history · yearly totals
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line bg-brand-soft/10 p-3">
          {/* Summary strip */}
          <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10">
            <div className="overflow-x-auto">
              <div style={{ minWidth: minW }}>
                <div className="grid items-center gap-2 border-b border-line pr-4 py-2" style={gridStyle}>
                  <span className="sticky left-0 z-10 bg-surface pl-4 text-[11px] font-bold uppercase tracking-wide">
                    Summary
                  </span>
                  {years.map((y) => (
                    <span key={y} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                      {y}
                    </span>
                  ))}
                  <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Total</span>
                </div>
                {kinds.map((k) => (
                  <SummaryRow
                    key={k.kind}
                    label={k.label}
                    byYear={k.totalByYear}
                    total={k.total}
                    years={years}
                    gridStyle={gridStyle}
                    currency={currency}
                  />
                ))}
                {/* Net (unallocated) — Income − Expenses − Savings − Investment */}
                <div className="grid items-center gap-2 border-t border-line pr-4 py-2" style={gridStyle}>
                  <span className="sticky left-0 z-10 bg-surface pl-4 text-sm font-bold">Net</span>
                  {years.map((y) => {
                    const v = netByYear[y] ?? 0;
                    return (
                      <span
                        key={y}
                        className={`text-center text-xs font-bold tabular-nums ${v < 0 ? "text-negative" : "text-positive"}`}
                      >
                        {formatMoney(v, currency)}
                      </span>
                    );
                  })}
                  <span className="text-center text-xs font-bold tabular-nums text-muted">—</span>
                </div>
              </div>
            </div>
          </div>

          {/* Per-kind detail */}
          {kinds.map((k) => (
            <KindBlock key={k.kind} kind={k} years={years} gridStyle={gridStyle} minW={minW} currency={currency} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SummaryRow({
  label, byYear, total, years, gridStyle, currency,
}: {
  label: string; byYear: Record<number, number>; total: number;
  years: number[]; gridStyle: CSSProperties; currency: string;
}) {
  return (
    <div className="grid items-center gap-2 pr-4 py-1.5" style={gridStyle}>
      <span className="sticky left-0 z-10 bg-surface pl-4 text-sm font-medium">{label}</span>
      {years.map((y) => {
        const v = byYear[y] ?? 0;
        return (
          <span key={y} className="text-center text-xs tabular-nums">
            {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
          </span>
        );
      })}
      <span className="text-center text-xs font-semibold tabular-nums">{formatMoney(total, currency)}</span>
    </div>
  );
}

function KindBlock({
  kind, years, gridStyle, minW, currency,
}: {
  kind: BreakdownKind; years: number[]; gridStyle: CSSProperties; minW: string; currency: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-black/5 dark:ring-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-brand-soft/40 px-4 py-2 text-left transition hover:bg-brand-soft/60"
      >
        <Chevron open={open} small />
        <span className="text-[11px] font-bold uppercase tracking-wide">{kind.label}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-muted">
          {formatMoney(kind.total, currency)}
        </span>
      </button>

      {open ? (
        <div className="overflow-x-auto">
          <div style={{ minWidth: minW }}>
            {/* Header */}
            <div className="grid items-center gap-2 border-y border-line pr-4 py-2" style={gridStyle}>
              <span className="sticky left-0 z-10 bg-surface pl-4 text-[11px] font-medium uppercase tracking-wide text-muted">
                Line item
              </span>
              {years.map((y) => (
                <span key={y} className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">
                  {y}
                </span>
              ))}
              <span className="text-center text-[11px] font-medium uppercase tracking-wide text-muted">Total</span>
            </div>

            {kind.groups.map((g) => (
              <Group
                key={g.label}
                group={g}
                years={years}
                gridStyle={gridStyle}
                currency={currency}
                singleGroup={kind.groups.length === 1}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Group({
  group, years, gridStyle, currency, singleGroup,
}: {
  group: BreakdownGroup; years: number[]; gridStyle: CSSProperties; currency: string; singleGroup: boolean;
}) {
  return (
    <div className="border-b border-line last:border-b-0">
      {/* Group subtotal header — omitted when the kind is a single group (Income,
          Savings, Investment) whose name would just repeat the section. */}
      {!singleGroup ? (
        <div className="grid items-center gap-2 bg-brand-soft/15 pr-4 py-1.5" style={gridStyle}>
          <span className="sticky left-0 z-10 truncate bg-surface pl-4 text-xs font-bold" title={group.label}>
            {group.label}
          </span>
          {years.map((y) => {
            const v = group.subtotalByYear[y] ?? 0;
            return (
              <span key={y} className="text-center text-[11px] font-semibold tabular-nums text-muted">
                {v !== 0 ? formatMoney(v, currency) : "—"}
              </span>
            );
          })}
          <span className="text-center text-[11px] font-semibold tabular-nums text-muted">
            {formatMoney(group.total, currency)}
          </span>
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {group.lines.map((l) => (
          <li key={l.label} className="grid items-center gap-2 pr-4 py-1.5" style={gridStyle}>
            <span
              className={`sticky left-0 z-10 truncate bg-surface text-sm ${singleGroup ? "pl-4" : "pl-7"}`}
              title={l.label}
            >
              {l.label}
            </span>
            {years.map((y) => {
              const v = l.byYear[y] ?? 0;
              return (
                <span key={y} className="text-center text-xs tabular-nums">
                  {v !== 0 ? formatMoney(v, currency) : <span className="text-muted">—</span>}
                </span>
              );
            })}
            <span className="text-center text-xs font-semibold tabular-nums">{formatMoney(l.total, currency)}</span>
          </li>
        ))}
      </ul>
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

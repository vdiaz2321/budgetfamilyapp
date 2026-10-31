"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import { ModalShell } from "@/components/modal-shell";
import { AnnualHero } from "./annual-hero";
import { KIND_COLOR } from "./annual-selection";
import type { CatMonthGroup } from "./category-months-table";

// The phone's Annual Overview. Twelve months across every group is too wide a
// table for 375px, so the year reads as a list instead: the hero cards, then
// one row per group (total + share of income). Tapping a group opens its
// months, newest first; tapping a month opens what made it up — one month at
// a time, never a "show all". Tap-to-add-up stays on tablet and desktop.
export function AnnualPhone({
  year,
  outflowKinds,
  totals,
  kidsTotal,
  totalNet,
  remainingMonths,
  currentMonthIdx,
  groups,
  monthLabels,
  emptyNote,
  currency,
}: {
  year: number;
  outflowKinds: CategoryKind[];
  totals: Record<CategoryKind, number>;
  kidsTotal: number;
  totalNet: number;
  remainingMonths: (number | null)[];
  currentMonthIdx: number | null;
  groups: CatMonthGroup[];
  monthLabels: string[];
  emptyNote?: string;
  currency: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const income = totals.income;
  const share = (v: number) => (income > 0 ? `${((v / income) * 100).toFixed(1)}% of income` : null);
  // Months run to the last one with anything logged, like the desktop table.
  const lastActive = groups.reduce(
    (last, g) => Math.max(last, g.monthTotals.reduce((acc, v, i) => (v !== 0 ? i : acc), -1)),
    -1,
  );
  const openGroup = groups.find((g) => g.categoryId === openId) ?? null;
  const spendingAlso = groups
    .filter((g) => (g.kind === "bills" || g.kind === "expenses") && !["bills", "expenses"].includes(g.label.toLowerCase()))
    .map((g) => g.label);

  return (
    <div className="space-y-3">
      <AnnualHero
        year={year}
        outflowKinds={outflowKinds}
        totals={totals}
        kidsTotal={kidsTotal}
        spendingAlso={spendingAlso}
        currency={currency}
        incomeMonths={groups.find((g) => g.kind === "income")?.monthTotals.filter((v) => v !== 0).length ?? 0}
      />

      {groups.length === 0 ? (
        <p className="rounded-xl bg-surface p-4 text-sm text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          {emptyNote ?? "No actuals recorded yet this year."}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          {groups.map((g) => (
            <li key={g.categoryId}>
              <button
                type="button"
                onClick={() => setOpenId(g.categoryId)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold uppercase tracking-wide">{g.label}</span>
                <span className="flex flex-col items-end tabular-nums">
                  <span className="text-[16px] font-bold" style={{ color: KIND_COLOR[g.kind] }}>
                    {formatMoney(g.total, currency)}
                  </span>
                  {g.kind !== "income" && share(g.total) ? (
                    <span className="text-[12px] font-semibold" style={{ color: KIND_COLOR[g.kind] }}>
                      {share(g.total)}
                    </span>
                  ) : null}
                </span>
                <Chevron />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setOpenId("__remaining")}
              className="flex min-h-14 w-full items-center gap-3 bg-[color-mix(in_srgb,var(--positive)_8%,var(--surface))] px-4 py-2.5 text-left"
            >
              <span className="min-w-0 flex-1 text-[15px] font-bold uppercase tracking-wide">Remaining</span>
              <span className="flex flex-col items-end tabular-nums">
                <span className={`text-[16px] font-bold ${totalNet >= 0 ? "text-positive" : "text-negative"}`}>
                  {formatMoney(totalNet, currency)}
                </span>
                {share(totalNet) ? (
                  <span className={`text-[12px] font-semibold ${totalNet >= 0 ? "text-positive" : "text-negative"}`}>
                    {share(totalNet)}
                  </span>
                ) : null}
              </span>
              <Chevron />
            </button>
          </li>
        </ul>
      )}

      {openGroup ? (
        <ModalShell title={`${openGroup.label} · ${year}`} onClose={() => setOpenId(null)}>
          <GroupMonths
            group={openGroup}
            lastActive={lastActive}
            monthLabels={monthLabels}
            currentMonthIdx={currentMonthIdx}
            currency={currency}
          />
        </ModalShell>
      ) : null}
      {openId === "__remaining" ? (
        <ModalShell title={`Remaining · ${year}`} onClose={() => setOpenId(null)}>
          <ul className="divide-y divide-line">
            {monthsNewestFirst(lastActive).map((i) => {
              const v = remainingMonths[i];
              return (
                <li key={i} className="flex min-h-12 items-center justify-between px-5 py-2">
                  <MonthName label={monthLabels[i]} current={i === currentMonthIdx} />
                  <span className={`text-[16px] font-bold tabular-nums ${v == null ? "" : v >= 0 ? "text-positive" : "text-negative"}`}>
                    {v == null ? "—" : formatMoney(v, currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </ModalShell>
      ) : null}
    </div>
  );
}

function monthsNewestFirst(lastActive: number) {
  return Array.from({ length: lastActive + 1 }, (_, i) => lastActive - i);
}

// A group's months, newest first. Each month opens on its own to list the
// items behind it (largest first).
function GroupMonths({
  group,
  lastActive,
  monthLabels,
  currentMonthIdx,
  currency,
}: {
  group: CatMonthGroup;
  lastActive: number;
  monthLabels: string[];
  currentMonthIdx: number | null;
  currency: string;
}) {
  const [openMonths, setOpenMonths] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <ul className="divide-y divide-line">
      {monthsNewestFirst(lastActive).map((i) => {
        const v = group.monthTotals[i] ?? 0;
        const items = group.rows
          .map((r) => ({ name: r.name, cents: r.months[i] ?? 0 }))
          .filter((r) => r.cents !== 0)
          .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
        const open = openMonths.has(i);
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => toggle(i)}
              disabled={items.length === 0}
              aria-expanded={open}
              className="flex min-h-12 w-full items-center gap-2 px-5 py-2 text-left transition enabled:hover:bg-sky-50 dark:enabled:hover:bg-sky-950/40"
            >
              <span className="flex flex-1 items-center gap-2">
                {items.length > 0 ? <Chevron down={open} /> : <span className="w-[13px]" aria-hidden />}
                <MonthName label={monthLabels[i]} current={i === currentMonthIdx} />
              </span>
              <span className="text-[16px] font-bold tabular-nums" style={v !== 0 ? { color: KIND_COLOR[group.kind] } : undefined}>
                {v !== 0 ? formatMoney(v, currency) : "—"}
              </span>
            </button>
            {open ? (
              <ul className="border-t border-line/60 bg-sky-50 dark:bg-sky-950/40">
                {items.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-3 py-2 pl-12 pr-5 text-[14px]">
                    <span className="min-w-0 truncate text-foreground">{r.name}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMoney(r.cents, currency)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MonthName({ label, current }: { label: string; current: boolean }) {
  return (
    <span className="text-[15px] font-semibold uppercase tracking-wide">
      {label}
      {current ? <span className="ml-1.5 text-[12px] font-medium normal-case tracking-normal">(so far)</span> : null}
    </span>
  );
}

function Chevron({ down = false }: { down?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-foreground transition-transform ${down ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

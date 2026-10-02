"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { centsToGroupedDisplay, displayToCents } from "@/lib/money";
import type { AccountData } from "./types";
import { clearMonthEndCheck, saveMonthEndValue } from "./month-end-actions";

// Month-end update: one list of every balance Victor keys in by hand from a
// statement (Investments, Kids Funding, Savings), with last month beside the
// new value, the change between them, and a checkmark so he can stop partway
// and pick up where he left off. Banking checking and cards are left out —
// transactions drive those.

export type MonthEndCheck = { month: string; accountId: string | null; bucketId: string | null };

type Item = {
  key: string;
  accountId: string;
  bucketId: string | null;
  name: string;
  liveCents: number;
  balancesByMonth: Record<string, number>;
};

type Group = { account: AccountData; items: Item[] };

function monthBefore(firstOfMonth: string): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthName(firstOfMonth: string, style: "short" | "long" = "short"): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: style });
}

// Read-only figures in whole dollars, the way Investments and Kids Funding
// read on the board.
function money(cents: number): string {
  return Math.round(Math.abs(cents) / 100).toLocaleString("en-US");
}

// The input keeps the exact figure — cents only when there are any — so a
// saved value is never rounded.
function inputValue(cents: number): string {
  const s = centsToGroupedDisplay(cents);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

function itemsOf(a: AccountData): Item[] {
  if (a.buckets.length > 0) {
    return a.buckets.map((b) => ({
      key: `b:${b.id}`,
      accountId: a.id,
      bucketId: b.id,
      name: b.name,
      liveCents: b.balanceCents,
      balancesByMonth: b.balancesByMonth,
    }));
  }
  return [
    {
      key: `a:${a.id}`,
      accountId: a.id,
      bucketId: null,
      name: a.name,
      liveCents: a.balanceCents,
      balancesByMonth: a.balancesByMonth ?? {},
    },
  ];
}

const SECTIONS: { label: string; match: (a: AccountData) => boolean }[] = [
  { label: "Investments", match: (a) => !a.isKidsAccount && a.kind === "investment" },
  { label: "Savings", match: (a) => !a.isKidsAccount && a.kind === "savings_bucket" },
  { label: "Kids Funding", match: (a) => a.isKidsAccount },
];

const GRID =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)_2rem] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_8rem_6.5rem_2rem]";

export function MonthEndUpdateModal({
  accounts,
  currentMonth,
  checks,
  onClose,
}: {
  accounts: AccountData[];
  currentMonth: string;
  checks: MonthEndCheck[];
  onClose: () => void;
}) {
  const router = useRouter();
  const lastMonth = monthBefore(currentMonth);
  // Early in a month you're closing last month's statements; later on you're
  // updating this one.
  const [month, setMonth] = useState(() => (new Date().getDate() <= 10 ? lastMonth : currentMonth));
  const compareMonth = monthBefore(month);
  const [hideDone, setHideDone] = useState(false);
  // Typed values, keyed by month + row, so switching months never mixes them.
  const [typed, setTyped] = useState<Record<string, string>>({});
  // Optimistic ticks on top of the server's, keyed by month + row.
  const [tickOverride, setTickOverride] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const serverTicks = useMemo(() => {
    const s = new Set<string>();
    for (const c of checks) {
      if (c.month !== month) continue;
      s.add(c.bucketId ? `b:${c.bucketId}` : `a:${c.accountId}`);
    }
    return s;
  }, [checks, month]);
  const isDone = (key: string) => tickOverride[`${month}|${key}`] ?? serverTicks.has(key);

  const sections = SECTIONS.map((sec) => ({
    label: sec.label,
    groups: accounts
      .filter((a) => a.active && sec.match(a))
      .map((a): Group => ({ account: a, items: itemsOf(a) })),
  })).filter((s) => s.groups.length > 0);

  const allItems = sections.flatMap((s) => s.groups.flatMap((g) => g.items));
  const doneCount = allItems.filter((i) => isDone(i.key)).length;

  // The month's recorded value: the live balance for this month, the snapshot
  // for last month.
  const baseCents = (i: Item): number | null =>
    month === currentMonth ? i.liveCents : (i.balancesByMonth[month] ?? null);
  const shownCents = (i: Item): number | null => {
    const t = typed[`${month}|${i.key}`];
    if (t != null && t.trim() !== "") return displayToCents(t);
    return baseCents(i);
  };

  const save = (i: Item, raw: string) => {
    const rowKey = `${month}|${i.key}`;
    setError(null);
    setSaving((s) => new Set(s).add(rowKey));
    setTickOverride((o) => ({ ...o, [rowKey]: true }));
    startTransition(async () => {
      const res = await saveMonthEndValue({ month, accountId: i.accountId, bucketId: i.bucketId, balance: raw });
      setSaving((s) => {
        const n = new Set(s);
        n.delete(rowKey);
        return n;
      });
      if (res.error) {
        setError(`${i.name}: ${res.error}`);
        setTickOverride((o) => ({ ...o, [rowKey]: false }));
        return;
      }
      router.refresh();
    });
  };

  const onBlur = (i: Item) => {
    const t = typed[`${month}|${i.key}`];
    if (t == null || t.trim() === "") return;
    if (displayToCents(t) === baseCents(i)) return;
    save(i, t);
  };

  // Closing with Escape (or the X) can unmount a box before its blur save
  // runs, so anything typed but not yet saved is saved on the way out.
  const close = () => {
    for (const i of allItems) {
      const rowKey = `${month}|${i.key}`;
      const t = typed[rowKey];
      if (t == null || t.trim() === "" || saving.has(rowKey)) continue;
      if (displayToCents(t) === baseCents(i)) continue;
      void saveMonthEndValue({ month, accountId: i.accountId, bucketId: i.bucketId, balance: t }).then(() =>
        router.refresh(),
      );
    }
    onClose();
  };

  const toggle = (i: Item) => {
    const rowKey = `${month}|${i.key}`;
    if (isDone(i.key)) {
      setTickOverride((o) => ({ ...o, [rowKey]: false }));
      startTransition(async () => {
        const res = await clearMonthEndCheck({ month, accountId: i.accountId, bucketId: i.bucketId });
        if (res.error) {
          setError(`${i.name}: ${res.error}`);
          setTickOverride((o) => ({ ...o, [rowKey]: true }));
          return;
        }
        router.refresh();
      });
      return;
    }
    // Ticking with nothing typed confirms the figure already there.
    const cents = shownCents(i) ?? i.balancesByMonth[compareMonth] ?? 0;
    save(i, String(cents / 100));
  };

  const chip = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-inset transition ${
      active
        ? "bg-black/10 text-foreground ring-black/20 dark:bg-white/15 dark:ring-white/25"
        : "bg-surface text-muted ring-line hover:bg-black/5 dark:hover:bg-white/10"
    }`;

  return (
    <ModalShell
      title="Month-end update"
      onClose={close}
      className="sm:max-w-3xl"
      headerActions={
        <>
          {[lastMonth, currentMonth].map((m) => (
            <button key={m} type="button" aria-pressed={month === m} onClick={() => setMonth(m)} className={chip(month === m)}>
              {monthName(m, "long")}
            </button>
          ))}
          <button type="button" aria-pressed={hideDone} onClick={() => setHideDone((h) => !h)} className={chip(hideDone)}>
            {hideDone ? "Show all" : "Hide done"}
          </button>
        </>
      }
    >
      <div className="px-4 pb-4 pt-3 sm:px-5">
        {/* Progress */}
        <div className="mb-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">
              {doneCount} of {allItems.length} done
            </span>
            <span className="text-xs text-muted">
              {monthName(compareMonth)} → {monthName(month)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${allItems.length ? (doneCount / allItems.length) * 100 : 0}%`,
                background: "var(--positive)",
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Saves and ticks when you leave a box.
            {month === lastMonth
              ? ` ${monthName(month, "long")} values also fill ${monthName(currentMonth, "long")} unless it's ticked there.`
              : null}
          </p>
          {error ? <p className="mt-2 text-xs font-semibold text-negative">{error}</p> : null}
        </div>

        {/* Column headers */}
        <div className={`${GRID} sticky top-0 z-10 -mx-2 border-b border-line bg-surface px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted`}>
          <span className="hidden text-left sm:block">Account</span>
          <span>{monthName(compareMonth)}</span>
          <span>{monthName(month)}</span>
          <span>Change</span>
          <span>Done</span>
        </div>

        {sections.map((sec) => {
          const groups = sec.groups
            .map((g) => ({ ...g, visible: hideDone ? g.items.filter((i) => !isDone(i.key)) : g.items }))
            .filter((g) => g.visible.length > 0);
          if (groups.length === 0) return null;
          return (
            <div key={sec.label} className="mt-4">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{sec.label}</h3>
              <ul className="divide-y divide-line/60">
                {groups.map((g) => {
                  const bucketed = g.account.buckets.length > 0;
                  const prevTotal = g.items.reduce((s, i) => s + (i.balancesByMonth[compareMonth] ?? 0), 0);
                  const newTotal = g.items.reduce((s, i) => s + (shownCents(i) ?? 0), 0);
                  const allDone = g.items.every((i) => isDone(i.key));
                  return (
                    <li key={g.account.id} className="py-1">
                      {bucketed ? (
                        // The account's grand total — shaded and tagged so it reads as the sum
                        // of the buckets under it, not one more row to fill in. -mx/px keep its
                        // figures lined up with the bucket rows.
                        <div className={`${GRID} -mx-2 gap-y-1 rounded-lg bg-black/[0.05] px-2 py-2 dark:bg-white/[0.07]`}>
                          <span className="col-span-4 flex min-w-0 items-center gap-2 sm:col-span-1">
                            <span className="truncate text-sm font-semibold">{g.account.name}</span>
                            <span className="shrink-0 rounded bg-black/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted dark:bg-white/10">
                              Total
                            </span>
                          </span>
                          <span className="text-center text-sm font-semibold tabular-nums text-muted">${money(prevTotal)}</span>
                          <span className="text-center text-sm font-semibold tabular-nums">${money(newTotal)}</span>
                          <Change cents={newTotal - prevTotal} bold />
                          <span className="flex justify-center">
                            {allDone ? <CheckDot done static /> : null}
                          </span>
                        </div>
                      ) : null}
                      {g.visible.map((i) => {
                        const rowKey = `${month}|${i.key}`;
                        const prev = i.balancesByMonth[compareMonth] ?? null;
                        const shown = shownCents(i);
                        const done = isDone(i.key);
                        const base = baseCents(i);
                        return (
                          <div key={i.key} className={`${GRID} gap-y-1 py-1.5 ${bucketed ? "sm:pl-4" : ""}`}>
                            <span className={`col-span-4 truncate text-sm sm:col-span-1 ${bucketed ? "pl-3 text-muted sm:pl-0" : "font-semibold"}`}>
                              {i.name}
                            </span>
                            <span className="text-center text-sm tabular-nums text-muted">
                              {prev == null ? "—" : `$${money(prev)}`}
                            </span>
                            <input
                              inputMode="decimal"
                              aria-label={`${i.name} ${monthName(month, "long")} balance`}
                              value={typed[rowKey] ?? (base == null ? "" : inputValue(base))}
                              placeholder={prev == null ? "" : inputValue(prev)}
                              onChange={(e) => setTyped((t) => ({ ...t, [rowKey]: e.target.value }))}
                              onFocus={(e) => e.target.select()}
                              onBlur={() => onBlur(i)}
                              data-month-end-input
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Tab") tabDown(e);
                              }}
                              className={`w-full min-w-0 rounded-md bg-background px-2 py-1 text-center text-sm tabular-nums ring-1 ring-inset transition focus:outline-none focus:ring-2 focus:ring-brand ${
                                done ? "ring-[color:var(--positive)]/50" : "ring-line"
                              }`}
                            />
                            <Change cents={shown == null || prev == null ? null : shown - prev} />
                            <span className="flex justify-center">
                              <button
                                type="button"
                                aria-label={done ? `Mark ${i.name} not done` : `Mark ${i.name} done`}
                                aria-pressed={done}
                                disabled={saving.has(rowKey)}
                                onClick={() => toggle(i)}
                                className="rounded-full disabled:opacity-50"
                              >
                                <CheckDot done={done} />
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {hideDone && doneCount === allItems.length ? (
          <p className="mt-6 text-center text-sm font-semibold" style={{ color: "var(--positive)" }}>
            All {allItems.length} done for {monthName(month, "long")}.
          </p>
        ) : null}
      </div>
      {/* A plain, red Close pinned to the bottom, so leaving never depends on
          spotting the small X. Values are already saved; this just closes. */}
      <div className="sticky bottom-0 flex justify-end border-t border-line bg-surface px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-5">
        <button
          type="button"
          onClick={close}
          className="w-full rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 sm:w-auto"
        >
          Close
        </button>
      </div>
    </ModalShell>
  );
}

// Tab moves down the value column (Shift+Tab up) instead of across to the
// checkmark — the popup is filled in top to bottom. Leaving the field still
// saves it, through its onBlur.
function tabDown(e: React.KeyboardEvent<HTMLInputElement>) {
  const inputs = Array.from(
    e.currentTarget.closest("[data-column-tab-scope]")?.querySelectorAll<HTMLInputElement>("input[data-month-end-input]") ?? [],
  );
  const next = inputs[inputs.indexOf(e.currentTarget) + (e.shiftKey ? -1 : 1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

function Change({ cents, bold = false }: { cents: number | null; bold?: boolean }) {
  if (cents == null || cents === 0) {
    return <span className="text-center text-sm text-muted">—</span>;
  }
  return (
    <span className={`text-center text-sm tabular-nums ${bold ? "font-semibold" : ""} ${cents > 0 ? "text-positive" : "text-negative"}`}>
      {cents > 0 ? "+" : "−"}${money(cents)}
    </span>
  );
}

function CheckDot({ done, static: isStatic = false }: { done: boolean; static?: boolean }) {
  return (
    <span
      aria-hidden={isStatic || undefined}
      className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-inset transition ${
        done ? "text-white ring-transparent" : "text-transparent ring-line hover:bg-black/5 dark:hover:bg-white/10"
      } ${isStatic ? "h-5 w-5" : ""}`}
      style={done ? { background: "var(--positive)" } : undefined}
    >
      <svg width={isStatic ? 12 : 15} height={isStatic ? 12 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}

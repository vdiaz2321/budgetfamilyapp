"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMoney } from "@/lib/money";

export type SidebarAccount = {
  id: string;
  name: string;
  balanceCents: number;
  // false = listed but excluded from the Net Worth pill (kids' 529/UTMA).
  inNetWorth?: boolean;
};

export type SidebarGroup = {
  label: string;
  items: SidebarAccount[];
  /** Render balances as liabilities (red, shown negative). */
  liability?: boolean;
};

type Props = {
  groups: SidebarGroup[];
  currency: string;
};

// Fixed palette so each account name always hashes to the same dot color —
// a quick visual anchor when scanning ("the blue dot is always Schwab").
const DOT_COLORS = [
  "#60a5fa", // blue-400
  "#c084fc", // purple-400
  "#4ade80", // green-400
  "#fb923c", // orange-400
  "#facc15", // yellow-400
  "#f472b6", // pink-400
  "#22d3ee", // cyan-400
];
function dotColorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return DOT_COLORS[Math.abs(h) % DOT_COLORS.length];
}

function formatWhole(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${sign}$${dollars.toLocaleString("en-US")}`;
}

// YNAB-style account list under the nav: collapsible sections with a group
// total in the header and per-account balances, plus Add Account at the foot.
export function SidebarAccounts({ groups, currency }: Props) {
  // Net worth = every group's total, liabilities subtracted — so it stays
  // correct as groups are added (e.g. a future Real Estate group) without
  // needing to touch this calculation.
  const netWorthCents = groups.reduce(
    (sum, g) =>
      sum +
      (g.liability ? -1 : 1) *
        g.items.reduce((s, a) => s + (a.inNetWorth === false ? 0 : a.balanceCents), 0),
    0,
  );

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="mx-4 mb-3 border-t border-white/[0.06] pt-3">
        <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-3">
          <p className="text-[15px] font-bold uppercase tracking-wide text-slate-300">Net Worth</p>
          <p className={`text-[15px] font-bold tabular-nums ${netWorthCents < 0 ? "text-red-400" : "text-green-400"}`}>
            {formatWhole(netWorthCents)}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pr-2">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => {
            const excluded = g.items.every((a) => a.inNetWorth === false);
            return (
              <AccountGroup key={g.label} group={g} currency={currency} showDivider={excluded} />
            );
          })}
      </div>

    </div>
  );
}

function AccountGroup({ group, currency, showDivider }: { group: SidebarGroup; currency: string; showDivider?: boolean }) {
  const [open, setOpen] = useState(false);
  const total = group.items.reduce((s, a) => s + a.balanceCents, 0);
  const sign = group.liability ? -1 : 1;

  return (
    <div>
      {showDivider && <div className="mx-2 my-1.6 border-t border-white/[0.20]" />}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.04]"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-400">
          {group.label}
        </span>
        <span
          className={`shrink-0 text-[12px] font-medium tabular-nums ${
            sign * total < 0 ? "text-red-400" : "text-slate-400"
          }`}
        >
          {formatWhole(sign * total)}
        </span>
      </button>

      {open ? (
        <ul className="space-y-0.5">
          {group.items.map((a) => (
            <li key={a.id}>
              <div className="flex items-center gap-2 rounded-md py-[5px] pl-7 pr-2 transition hover:bg-white/[0.04]">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColorFor(a.name) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-400">{a.name}</span>
                <span
                  className={`shrink-0 text-[13px] tabular-nums ${
                    sign * a.balanceCents < 0 ? "text-red-400" : "text-slate-400"
                  }`}
                >
                  {formatWhole(sign * a.balanceCents)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

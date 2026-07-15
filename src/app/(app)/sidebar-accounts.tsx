"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMoney } from "@/lib/money";

export type SidebarAccount = {
  id: string;
  name: string;
  balanceCents: number;
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

// YNAB-style account list under the nav: collapsible sections with a group
// total in the header and per-account balances, plus Add Account at the foot.
export function SidebarAccounts({ groups, currency }: Props) {
  // Net worth = every group's total, liabilities subtracted — so it stays
  // correct as groups are added (e.g. a future Real Estate group) without
  // needing to touch this calculation.
  const netWorthCents = groups.reduce(
    (sum, g) => sum + (g.liability ? -1 : 1) * g.items.reduce((s, a) => s + a.balanceCents, 0),
    0,
  );

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-white/10 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">
          Net Worth
        </span>
        <span
          className={`text-sm font-bold tabular-nums ${
            netWorthCents < 0 ? "text-red-300" : "text-green-300"
          }`}
        >
          {formatMoney(netWorthCents, currency)}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <AccountGroup key={g.label} group={g} currency={currency} />
          ))}
      </div>

      <Link
        href="/accounts"
        className="mt-3 flex items-center justify-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add Account
      </Link>
    </div>
  );
}

function AccountGroup({ group, currency }: { group: SidebarGroup; currency: string }) {
  const [open, setOpen] = useState(true);
  const total = group.items.reduce((s, a) => s + a.balanceCents, 0);
  const sign = group.liability ? -1 : 1;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition hover:bg-white/10"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-white/50 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wider text-white/60">
          {group.label}
        </span>
        <span
          className={`shrink-0 text-[11px] font-semibold tabular-nums ${
            sign * total < 0 ? "text-red-300" : "text-white/80"
          }`}
        >
          {formatMoney(sign * total, currency)}
        </span>
      </button>

      {open ? (
        <ul className="mt-0.5 space-y-0.5">
          {group.items.map((a) => (
            <li key={a.id}>
              <Link
                href={group.liability ? "/snowball" : "/accounts"}
                className="flex items-center justify-between gap-2 rounded-md py-0.5 pl-5 pr-2 transition hover:bg-white/10"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{a.name}</span>
                <span
                  className={`shrink-0 text-[10px] font-medium tabular-nums ${
                    sign * a.balanceCents < 0 ? "text-red-300" : "text-white/70"
                  }`}
                >
                  {formatMoney(sign * a.balanceCents, currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

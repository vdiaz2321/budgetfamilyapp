"use client";

import { formatMoney } from "@/lib/money";
import type { DueItem } from "./types";

function dateLabel(date: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return target.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function DueThisWeekPanel({
  items,
  currency,
  isCurrentMonth,
  onPay,
  collapsible = false,
  open = true,
  onToggle,
}: {
  items: DueItem[];
  currency: string;
  isCurrentMonth: boolean;
  onPay: (item: DueItem) => void;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const Header = collapsible ? "button" : "div";

  return (
    <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <Header
        {...(collapsible ? { type: "button", onClick: onToggle, "aria-expanded": open } : {})}
        className={`flex w-full items-center justify-between px-4 py-3 text-left ${open ? "border-b border-line" : "transition hover:bg-brand-soft/40"}`}
      >
        <div>
          <h2 className="text-sm font-bold">Due this week</h2>
          {open ? (
            <p className="mt-0.5 text-[11px] text-muted">Mark paid when you are ready — nothing posts automatically.</p>
          ) : (
            <p className="mt-0.5 text-[11px] text-muted">Tap to view upcoming payments</p>
          )}
        </div>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{items.length}</span>
          {collapsible ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          ) : null}
        </span>
      </Header>

      {open && items.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-muted">
          {isCurrentMonth ? "No bills or subscriptions due in the next 7 days." : "Upcoming due dates appear while viewing the current month."}
        </p>
      ) : open ? (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={`${item.source}:${item.id}`} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-xs font-semibold text-brand">{dateLabel(item.dueDate)}</span>
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted">
                  {item.accountName ? `Charged to ${item.accountName}` : "No account linked"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{formatMoney(item.amountCents, currency)}</p>
                <button
                  type="button"
                  onClick={() => onPay(item)}
                  className="mt-1 rounded-md bg-brand-soft px-2 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/20"
                >
                  Paid
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

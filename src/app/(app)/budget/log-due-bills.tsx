"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { displayToCents, formatMoney } from "@/lib/money";
import { advanceSubscriptionRenewal } from "../subscriptions/actions";
import { logDueBills } from "./actions";
import type { DueItem } from "./types";

// Posts several due bills in one confirm instead of a Pay → modal → Save round
// per bill. Each row starts ticked when it has an amount and an account (what
// a fixed bill looks like); the amount can be changed before logging.
export function LogDueBillsButton({ dueItems, currency }: { dueItems: DueItem[]; currency: string }) {
  const [open, setOpen] = useState(false);
  if (dueItems.filter((i) => i.amountCents > 0).length < 2) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center rounded-lg bg-negative/15 px-3 text-xs font-bold text-negative transition hover:bg-negative/25 sm:h-7 sm:rounded-full"
      >
        Log due bills
      </button>
      {open ? <LogDueBillsModal dueItems={dueItems} currency={currency} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function LogDueBillsModal({ dueItems, currency, onClose }: { dueItems: DueItem[]; currency: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const keyOf = (i: DueItem) => `${i.source}:${i.id}`;
  const [ticked, setTicked] = useState(() => new Set(dueItems.filter((i) => i.amountCents > 0 && i.accountId).map(keyOf)));
  const [amounts, setAmounts] = useState(() =>
    Object.fromEntries(dueItems.map((i) => [keyOf(i), i.amountCents > 0 ? (i.amountCents / 100).toFixed(2) : ""])),
  );
  const chosen = dueItems.filter((i) => ticked.has(keyOf(i)) && displayToCents(amounts[keyOf(i)] ?? "") > 0);
  const totalCents = chosen.reduce((sum, i) => sum + displayToCents(amounts[keyOf(i)] ?? ""), 0);

  const save = () => {
    setError(null);
    start(async () => {
      const result = await logDueBills(
        chosen.map((i) => ({
          subcategoryId: i.subId,
          date: i.dueDate,
          amountCents: displayToCents(amounts[keyOf(i)] ?? ""),
          accountId: i.accountId,
          name: i.name,
          isSubscription: i.source === "subscription",
        })),
      );
      // A subscription's Pay also rolls it to its next renewal — do the same
      // for the ones that were logged, so they drop off the list.
      const logged = chosen.slice(0, result.saved);
      await Promise.all(
        logged
          .filter((i) => i.source === "subscription")
          .map((i) => {
            const fd = new FormData();
            fd.set("id", i.id);
            fd.set("dueDate", i.dueDate);
            return advanceSubscriptionRenewal(fd);
          }),
      );
      router.refresh();
      if (result.error) setError(result.error);
      else onClose();
    });
  };

  return (
    <ModalShell title="Log due bills" onClose={onClose} mobileAlign="top" className="sm:max-w-lg">
      <ul className="divide-y divide-line">
        {dueItems.map((item) => {
          const key = keyOf(item);
          const on = ticked.has(key);
          return (
            <li key={key} className="flex items-center gap-3 px-5 py-2.5">
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                aria-label={`Log ${item.name}`}
                className="h-5 w-5 shrink-0 accent-[color:var(--negative)]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                <p className="truncate text-[11px] italic text-foreground">
                  {new Date(`${item.dueDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {" · "}
                  {item.accountName ?? "No account linked"}
                </p>
              </div>
              <input
                inputMode="decimal"
                value={amounts[key] ?? ""}
                placeholder="0.00"
                onChange={(e) => setAmounts((prev) => ({ ...prev, [key]: e.target.value }))}
                aria-label={`${item.name} amount`}
                className="h-10 w-24 shrink-0 rounded-lg border border-line bg-surface px-2 text-right text-sm font-semibold tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {error ? <p className="basis-full text-xs font-semibold text-negative">{error}</p> : null}
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg px-3 text-sm font-bold text-foreground">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending || chosen.length === 0}
          className="min-h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? "Logging…" : `Log ${chosen.length} · ${formatMoney(totalCents, currency)}`}
        </button>
      </div>
    </ModalShell>
  );
}

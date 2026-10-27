"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { transferBetweenAccounts } from "./actions";
import { transferFromInvestment } from "@/app/(app)/invest/actions";
import { addTransaction } from "../budget/actions";
import { loadMoveMoneyOptions } from "./move-money-actions";
import type { AccountData, InvestItem } from "./types";

// What the popup reads of an account. The Accounts page passes its full
// AccountData; Transactions loads just this (move-money-actions).
export type MoveAccount = Pick<AccountData, "id" | "name" | "kind" | "active" | "isKidsAccount" | "balanceCents"> & {
  buckets: { id: string; name: string; balanceCents: number }[];
};

type MoveKind = "transfer" | "invest" | "withdraw";

// The three moves, always listed so the difference is in front of you; the
// one your From / To make lights up. Picking the type was the confusing part
// (three buttons that read alike — Victor, 2026-10-27), so the app works it
// out from the accounts instead.
const KINDS: { kind: MoveKind; name: string; flow: string; budget: string; icon: string }[] = [
  { kind: "transfer", name: "Bank transfer", flow: "Bank → bank", budget: "Budget: not counted", icon: "M7 7h13m0 0-4-4m4 4-4 4M17 17H4m0 0 4 4m-4-4 4-4" },
  { kind: "invest", name: "Invest", flow: "Bank → investment", budget: "Budget: counts as saved", icon: "M12 19V5m0 0-5 5m5-5 5 5" },
  { kind: "withdraw", name: "Withdraw", flow: "Investment → bank", budget: "Budget: not counted", icon: "M12 5v14m0 0-5-5m5 5 5-5" },
];

const SAVE_LABEL: Record<MoveKind, string> = {
  transfer: "Save transfer",
  invest: "Save investment",
  withdraw: "Save withdrawal",
};

// One popup for every move between your own accounts: bank → bank (a
// transfer), bank → investment (the Budget's Invest/Savings entry, so it
// counts as saved), and investment → bank (a withdrawal). Each still saves
// through the same action it always did.
export function MoveMoneyModal({
  accounts,
  investItems,
  currency,
  onClose,
}: {
  accounts: MoveAccount[];
  investItems: InvestItem[];
  currency: string;
  onClose: () => void;
}) {
  useScrollLock();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Cards and loans have their own payment flows; Kids Funding cash moves
  // like a bank account (in or out of Net Worth).
  const live = accounts.filter((a) => a.active && a.kind !== "credit_card");
  const isBank = (a: MoveAccount) => a.kind !== "investment" && a.kind !== "property" && a.kind !== "debt_loan";
  const banks = live.filter((a) => !a.isKidsAccount && isBank(a));
  const kidsCash = live.filter((a) => a.isKidsAccount && isBank(a));
  const investments = live.filter((a) => !a.isKidsAccount && a.kind === "investment");

  // Both start blank: a preselected account is one missed glance from the
  // wrong move.
  const [fromId, setFromId] = useState("");
  // "acct:<id>" for a bank, "item:<id>" for an Invest/Savings item.
  const [toKey, setToKey] = useState("");
  const [fromBucketId, setFromBucketId] = useState("");
  const [toBucketId, setToBucketId] = useState("");

  const from = accounts.find((a) => a.id === fromId);
  const fromIsInvestment = from?.kind === "investment";
  const toAcct = toKey.startsWith("acct:") ? accounts.find((a) => a.id === toKey.slice(5)) : undefined;
  const toItem = toKey.startsWith("item:") ? investItems.find((i) => i.subId === toKey.slice(5)) : undefined;
  const kind: MoveKind | null =
    !from || (!toAcct && !toItem) ? null : fromIsInvestment ? "withdraw" : toItem ? "invest" : "transfer";

  const withBalance = (a: MoveAccount) => `${a.name} · ${formatMoney(a.balanceCents, currency)}`;
  const field =
    "w-full rounded-xl bg-surface px-3 py-2.5 text-base text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:text-sm dark:bg-background";
  const label = "mb-1 block px-1 text-xs font-semibold text-foreground";
  const bankOptions = (list: MoveAccount[]) =>
    list.filter((a) => a.id !== fromId).map((a) => (
      <option key={a.id} value={`acct:${a.id}`}>{withBalance(a)}</option>
    ));

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10"
      onClick={onClose}
    >
      <div
        className="flex max-h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-surface pt-[max(env(safe-area-inset-top),1.75rem)] shadow-sm ring-1 ring-black/5 sm:h-auto sm:max-h-[85vh] sm:max-w-[520px] sm:rounded-2xl sm:pt-0 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Move money</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-foreground hover:bg-sky-50 dark:hover:bg-sky-950/40"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <ul className="mt-3 space-y-1.5">
            {KINDS.map((k) => {
              const on = kind === k.kind;
              return (
                <li
                  key={k.kind}
                  className={
                    "flex items-center gap-3 rounded-xl px-3 py-2 transition " +
                    (on ? "bg-sky-100 ring-2 ring-sky-500 dark:bg-sky-900/60 dark:ring-sky-400" : "ring-1 ring-line")
                  }
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: "var(--viz-savings)" }} aria-hidden>
                    <path d={k.icon} />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                      {k.name}
                      {on ? (
                        <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white">✓ This one</span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-foreground">{k.flow}</span>
                    {/* Under the name on a phone, where the row is too narrow
                        for a right-hand column. */}
                    <span className={"block text-xs text-foreground sm:hidden " + (on ? "font-bold" : "font-semibold")}>{k.budget}</span>
                  </span>
                  <span className={"hidden shrink-0 text-right text-xs text-foreground sm:block " + (on ? "font-bold" : "font-semibold")}>{k.budget}</span>
                </li>
              );
            })}
          </ul>

          {/* onSubmit, not <form action>: a rejected save must keep what was typed. */}
          <form
            id="move-money-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!kind || !from) return;
              const typed = new FormData(e.currentTarget);
              const amount = String(typed.get("amount") ?? "");
              const date = String(typed.get("date") ?? "");
              const memo = String(typed.get("memo") ?? "");
              start(async () => {
                setErrorMsg(null);
                const fd = new FormData();
                fd.set("amount", amount);
                fd.set("date", date);
                fd.set("memo", memo);
                let error: string | null = null;
                try {
                  if (kind === "withdraw" && toAcct) {
                    fd.set("sourceAccountId", from.id);
                    fd.set("sourceBucketId", fromBucketId);
                    fd.set("destAccountId", toAcct.id);
                    fd.set("destBucketId", toBucketId);
                    error = (await transferFromInvestment(fd)).error;
                  } else if (kind === "transfer" && toAcct) {
                    fd.set("fromAccountId", from.id);
                    fd.set("fromBucketId", fromBucketId);
                    fd.set("toAccountId", toAcct.id);
                    fd.set("toBucketId", toBucketId);
                    error = (await transferBetweenAccounts(fd)).error;
                  } else if (kind === "invest" && toItem) {
                    // The Budget's own Invest/Savings entry: paid from the
                    // bank, filed under the item, so the fund's bucket goes
                    // up and the month counts it as saved.
                    fd.set("subcategoryId", toItem.subId);
                    fd.set("accountId", from.id);
                    fd.set("sourceBucketId", fromBucketId);
                    fd.set("payee", accounts.find((a) => a.id === toItem.accountId)?.name ?? toItem.name);
                    await addTransaction(fd);
                  }
                } catch (err) {
                  error = `Couldn't save — ${err instanceof Error ? err.message : String(err)}`;
                }
                if (error) setErrorMsg(error);
                else {
                  // The totals behind didn't move until a reload, which read
                  // as "it didn't work".
                  router.refresh();
                  onClose();
                }
              });
            }}
            className="mt-4 space-y-3"
          >
            <label className="block">
              <span className={label}>From</span>
              <select
                value={fromId}
                onChange={(e) => {
                  const next = accounts.find((a) => a.id === e.target.value);
                  setFromId(e.target.value);
                  setFromBucketId("");
                  // Investment → investment isn't a move here (withdraw to a
                  // bank, then invest), and nothing moves to itself.
                  if ((next?.kind === "investment" && toItem) || toKey === `acct:${e.target.value}`) {
                    setToKey("");
                    setToBucketId("");
                  }
                }}
                required
                className={field}
              >
                <option value="">Pick an account</option>
                <optgroup label="Banks">
                  {banks.map((a) => <option key={a.id} value={a.id}>{withBalance(a)}</option>)}
                </optgroup>
                {kidsCash.length > 0 ? (
                  <optgroup label="Kids Funding">
                    {kidsCash.map((a) => <option key={a.id} value={a.id}>{withBalance(a)}</option>)}
                  </optgroup>
                ) : null}
                <optgroup label="Investments">
                  {investments.map((a) => <option key={a.id} value={a.id}>{withBalance(a)}</option>)}
                </optgroup>
              </select>
            </label>
            {from && from.buckets.length > 0 ? (
              <select
                aria-label="From bucket"
                value={fromBucketId}
                onChange={(e) => setFromBucketId(e.target.value)}
                required
                className={field}
              >
                <option value="">From which bucket?</option>
                {from.buckets.map((b) => <option key={b.id} value={b.id}>{b.name} · {formatMoney(b.balanceCents, currency)}</option>)}
              </select>
            ) : null}

            <label className="block">
              <span className={label}>To</span>
              <select
                value={toKey}
                onChange={(e) => {
                  setToKey(e.target.value);
                  setToBucketId("");
                }}
                required
                className={field}
              >
                <option value="">Pick where it goes</option>
                <optgroup label="Banks">{bankOptions(banks)}</optgroup>
                {kidsCash.length > 0 ? <optgroup label="Kids Funding">{bankOptions(kidsCash)}</optgroup> : null}
                {/* Money into a fund is saved through its Budget item. Not
                    offered from an investment: that goes to a bank first. */}
                {!fromIsInvestment ? (
                  <optgroup label="Invest (Budget items)">
                    {investItems.map((i) => <option key={i.subId} value={`item:${i.subId}`}>{i.name}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </label>
            {toAcct && toAcct.buckets.length > 0 ? (
              <select
                aria-label="To bucket"
                value={toBucketId}
                onChange={(e) => setToBucketId(e.target.value)}
                required
                className={field}
              >
                <option value="">Into which bucket?</option>
                {toAcct.buckets.map((b) => <option key={b.id} value={b.id}>{b.name} · {formatMoney(b.balanceCents, currency)}</option>)}
              </select>
            ) : null}

            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <label className="block">
                <span className={label}>Amount</span>
                <input name="amount" type="number" step="0.01" min="0.01" required placeholder="$ 0.00" inputMode="decimal" className={field} />
              </label>
              <label className="block">
                <span className={label}>Date</span>
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={field + " w-[9.5rem] sm:w-40"}
                />
              </label>
            </div>
            <input name="memo" placeholder="Add note (optional)" className={field} />
            {errorMsg ? <p className="px-1 text-sm font-semibold text-negative">{errorMsg}</p> : null}
          </form>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-1.5 py-1 text-xs font-bold text-foreground transition hover:bg-sky-50 sm:px-2 sm:py-1.5 sm:text-sm dark:hover:bg-sky-950/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="move-money-form"
            disabled={pending || !kind}
            className="rounded-xl bg-brand px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60 sm:px-3.5 sm:py-1.5 sm:text-sm"
          >
            {pending ? "Saving…" : kind ? SAVE_LABEL[kind] : "Pick From and To"}
          </button>
        </div>
      </div>
    </div>
  );
}

type MoveMoneyOptions = Awaited<ReturnType<typeof loadMoveMoneyOptions>>;

/**
 * Move Money on a page that doesn't hold every account (Transactions): the
 * lists load in the background once the page is up, so opening is instant.
 * Reloaded after each close, since a save moves the balances it shows.
 */
export function LazyMoveMoney({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [options, setOptions] = useState<MoveMoneyOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const load = () => {
    inFlight.current ??= loadMoveMoneyOptions()
      .then((o) => {
        setOptions(o);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your accounts."))
      .finally(() => {
        inFlight.current = null;
      });
    return inFlight.current;
  };

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, []);
  // Opened before the background load landed (or after it failed): try now.
  useEffect(() => {
    if (open && !options) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  if (!options) {
    return error ? (
      <div className="fixed inset-x-4 top-[max(env(safe-area-inset-top),1.75rem)] z-[60] mx-auto max-w-sm rounded-xl bg-surface p-4 shadow-lg ring-1 ring-line">
        <p className="text-sm font-semibold text-negative">{error}</p>
        <button type="button" onClick={onClose} className="mt-2 rounded-lg px-2 py-1 text-sm font-bold text-foreground hover:bg-sky-50 dark:hover:bg-sky-950/40">
          Close
        </button>
      </div>
    ) : null;
  }
  return (
    <MoveMoneyModal
      accounts={options.accounts}
      investItems={options.investItems}
      currency={options.currency}
      onClose={() => {
        onClose();
        void load();
      }}
    />
  );
}

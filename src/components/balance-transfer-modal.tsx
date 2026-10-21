"use client";

import { useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { addMonths, paymentToClearByPromoEnd } from "@/lib/snowball";
import { createBalanceTransfer } from "@/app/(app)/snowball/actions";
import { ModalShell } from "@/components/modal-shell";

const FIELD = "mt-1 block w-full rounded-md bg-background px-2.5 py-2 text-sm font-normal ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand/40";
const LABEL = "block text-xs font-semibold text-foreground";

// One card's balance moved onto another card's promo offer. Saved as its own
// debt so its end date, fee and payment stay apart from any promo already on
// that card; the old card's owed figure drops by the amount.
export function BalanceTransferModal({ cards, startMonth, currency, onClose }: {
  cards: { id: string; name: string; owedCents: number }[];
  startMonth: string;
  currency: string;
  onClose: () => void;
}) {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const biggest = [...cards].sort((a, b) => b.owedCents - a.owedCents)[0];
  const [fromId, setFromId] = useState(biggest?.owedCents > 0 ? biggest.id : "");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [feePct, setFeePct] = useState("3");
  const [promoEndsOn, setPromoEndsOn] = useState("");
  const [planned, setPlanned] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const from = cards.find((c) => c.id === fromId) ?? null;
  const amountCents = Math.max(0, Math.round((parseFloat(amount) || 0) * 100));
  const feeCents = Math.round((amountCents * (parseFloat(feePct) || 0)) / 100);
  const totalCents = amountCents + feeCents;
  // First payment lands next month: the transfer takes a week or two to post.
  const clearCents = totalCents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(promoEndsOn)
    ? paymentToClearByPromoEnd(totalCents, addMonths(startMonth, 1), promoEndsOn)
    : null;

  const submit = (formData: FormData) => {
    setError(null);
    if (!String(formData.get("planned") ?? "").trim() && clearCents) formData.set("planned", centsToDisplay(clearCents));
    start(async () => {
      const result = await createBalanceTransfer(formData);
      if (result?.error) setError(result.error);
      else onClose();
    });
  };

  return (
    <ModalShell title="Balance transfer" onClose={onClose} className="sm:max-w-xl">
      <form action={submit} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <label className={`${LABEL} col-span-2 sm:col-span-1`}>
            From card
            <select name="fromAccountId" value={fromId} onChange={(e) => setFromId(e.target.value)} required className={FIELD}>
              <option value="">Pick a card</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.owedCents > 0 ? ` · owes ${formatMoney(c.owedCents, currency)}` : ""}</option>
              ))}
            </select>
          </label>
          <label className={`${LABEL} col-span-2 sm:col-span-1`}>
            To card (the offer)
            <select name="toAccountId" value={toId} onChange={(e) => setToId(e.target.value)} required className={FIELD}>
              <option value="">Pick a card</option>
              {cards.filter((c) => c.id !== fromId).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Amount to transfer
            <input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} className={FIELD} />
            {from && from.owedCents > 0 ? (
              <button type="button" onClick={() => setAmount(centsToDisplay(from.owedCents))} className="mt-1 text-xs font-semibold text-sky-700 underline decoration-sky-700/40 underline-offset-2 dark:text-sky-300">
                Use all {formatMoney(from.owedCents, currency)}
              </button>
            ) : null}
          </label>
          <label className={LABEL}>
            Transfer fee %
            <input name="feePct" type="number" min="0" max="10" step="0.01" inputMode="decimal" required value={feePct} onChange={(e) => setFeePct(e.target.value)} className={FIELD} />
          </label>
          <label className={LABEL}>
            Transfer date
            <input name="date" type="date" defaultValue={today} className={FIELD} />
          </label>
          <label className={LABEL}>
            Promo APR %
            <input name="promoApr" type="number" min="0" step="0.01" inputMode="decimal" defaultValue="0" className={FIELD} />
          </label>
          <label className={LABEL}>
            Promo ends
            <input name="promoEndsOn" type="date" required value={promoEndsOn} onChange={(e) => setPromoEndsOn(e.target.value)} className={FIELD} />
          </label>
          <label className={LABEL}>
            APR after promo %
            <input name="postPromoApr" type="number" min="0" step="0.01" inputMode="decimal" placeholder="e.g. 18.74" className={FIELD} />
          </label>
          <label className={LABEL}>
            Minimum / mo
            <input name="minimum" type="number" min="0" step="0.01" inputMode="decimal" className={FIELD} />
          </label>
          <label className={LABEL}>
            Planned / mo
            <input name="planned" type="number" min="0" step="0.01" inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} placeholder={clearCents ? centsToDisplay(clearCents) : ""} className={FIELD} />
          </label>
        </div>

        {totalCents > 0 ? (
          <div className="space-y-1 rounded-lg bg-sky-50 px-4 py-3 text-sm dark:bg-sky-950/40">
            <p>
              New balance: <strong className="tabular-nums">{formatMoney(totalCents, currency)}</strong>{" "}
              <span className="tabular-nums">(fee {formatMoney(feeCents, currency)})</span>
            </p>
            {clearCents ? (
              <p>
                Clears by promo end at <strong className="tabular-nums" style={{ color: "var(--viz-savings)" }}>{formatMoney(clearCents, currency)}/mo</strong>
              </p>
            ) : null}
            {from ? (
              <p>
                {from.name} owes <strong className="tabular-nums">{formatMoney(from.owedCents - amountCents, currency)}</strong> after
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm font-semibold text-negative">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? "Saving…" : "Save transfer"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-sky-300 transition hover:bg-sky-100 dark:ring-sky-700 dark:hover:bg-sky-900/50">
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

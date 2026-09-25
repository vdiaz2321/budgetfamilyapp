"use client";

import { useState } from "react";

// Shared by Add transaction and the Travel Log forms: type a receipt amount in
// its own currency, "Use" hands the dollar figure to the form.

// Currencies most likely to come up on travel receipts. Add more as needed —
// the API returns rates for ~150 currencies, but a big <select> is worse UX.
// Also the list the Travel forms offer for a booking's second currency.
export const FX_CURRENCIES = [
  "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY",
  "MXN", "INR", "KRW", "TRY", "BRL", "SGD", "HKD",
  "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "THB", "ZAR",
] as const;

// Module-level cache so the modal doesn't re-fetch every time it opens.
let cachedRates: { rates: Record<string, number>; fetchedAt: number } | null = null;

/** What was typed into the converter, for forms that keep the receipt's own
 *  figure beside the dollars (the Travel Log keeps euros). */
export type ConvertedFrom = { currency: string; amountCents: number };

export function CurrencyConverter({
  onUse,
  blue = false,
  defaultFrom,
}: {
  onUse: (usdCents: number, from: ConvertedFrom) => void;
  /** The currency it opens on — a Travel booking's own foreign currency. */
  defaultFrom?: string;
  /** Blue instead of the indigo brand colour — the Travel forms use no purple. */
  blue?: boolean;
}) {
  const link = blue ? "text-sky-700 hover:text-sky-800 dark:text-sky-400" : "text-brand hover:text-brand-strong";
  const focusRing = blue ? "focus:ring-sky-500" : "focus:ring-brand";
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState<string>("EUR");
  const [rates, setRates] = useState<Record<string, number> | null>(cachedRates?.rates ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetching belongs in the handler for the interaction that needs it, not in
  // an effect watching `open` — opening the panel IS the event. Rates cached
  // for the session are good enough: FX moves slowly at family-budget scale
  // and one-tap "Use $X.XX" always shows the number.
  function openConverter() {
    setOpen(true);
    if (defaultFrom) setFrom(defaultFrom);
    if (rates) return;
    setLoading(true);
    setError(null);
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((d) => {
        if (d?.rates && typeof d.rates === "object") {
          cachedRates = { rates: d.rates, fetchedAt: Date.now() };
          setRates(d.rates);
        } else {
          setError("Couldn't load rates");
        }
      })
      .catch(() => setError("Network error — check connection"))
      .finally(() => setLoading(false));
  }

  const num = parseFloat(amount);
  const rate = rates?.[from];
  const usd = rate && !isNaN(num) && num > 0 ? num / rate : null;
  const usdCents = usd != null ? Math.round(usd * 100) : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={openConverter}
        className={`inline-flex w-fit items-center gap-1 rounded-md py-1.5 text-sm font-semibold ${link} hover:underline sm:py-0`}
      >
        ↗ Convert currency to USD
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-background p-3 ring-1 ring-line">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">Convert to USD</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md bg-negative/10 px-3 py-1.5 text-xs font-semibold text-negative hover:bg-negative/15"
          >
            Close
          </button>
          {usdCents != null && (
            <button
              type="button"
              onClick={() => { onUse(usdCents, { currency: from, amountCents: Math.round(num * 100) }); setOpen(false); setAmount(""); }}
              className="rounded-md bg-positive/15 px-3.5 py-2 text-sm font-bold text-positive transition hover:bg-positive/25"
            >
              Use
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className={`w-24 rounded-lg bg-surface px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 ${focusRing}`}
        />
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={`rounded-lg bg-surface px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 ${focusRing}`}
        >
          {FX_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-sm text-muted">=</span>
        <span className="text-sm font-bold tabular-nums text-foreground">
          {loading ? "…" : usd != null ? `$${usd.toFixed(2)}` : "$0.00"}
        </span>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-negative">{error}</p>
      ) : rate ? (
        <p className="mt-1.5 text-[10px] text-muted">
          1 USD = {rate.toFixed(4)} {from}
        </p>
      ) : null}
    </div>
  );
}

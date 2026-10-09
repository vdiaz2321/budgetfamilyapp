"use client";

import { useEffect, useState } from "react";

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

/** USD-based rates plus the day they're from — null for today's live rates.
 *  A weekend date gets the Friday before, the last day the ECB published. */
export type FxRates = { rates: Record<string, number>; asOf: string | null };

// Module-level caches so the modal doesn't re-fetch every time it opens.
let cachedRates: { rates: Record<string, number>; fetchedAt: number } | null = null;
const pastRates = new Map<string, Promise<FxRates | null>>();

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Rates for `date` (YYYY-MM-DD). A past day uses that day's ECB rate, so a
 *  purchase logged late converts the way it did when it was bought; no date,
 *  today or later uses today's rates. Resolves to null when they can't load. */
export function loadFxRatesOn(date?: string): Promise<FxRates | null> {
  if (!date || date >= todayIso()) {
    if (cachedRates) return Promise.resolve({ rates: cachedRates.rates, asOf: null });
    return fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.rates || typeof d.rates !== "object") return null;
        cachedRates = { rates: d.rates, fetchedAt: Date.now() };
        return { rates: d.rates as Record<string, number>, asOf: null };
      })
      .catch(() => null);
  }
  let p = pastRates.get(date);
  if (!p) {
    p = fetch(`https://api.frankfurter.dev/v1/${date}?base=USD`)
      .then((r) => r.json())
      .then((d) =>
        d?.rates && typeof d.rates === "object"
          ? { rates: d.rates as Record<string, number>, asOf: String(d.date ?? date) }
          : null,
      )
      .catch(() => null);
    // A failed load isn't kept, so the next try fetches again.
    p.then((r) => { if (!r) pastRates.delete(date); });
    pastRates.set(date, p);
  }
  return p;
}

/** Just the rates — see loadFxRatesOn. */
export function loadFxRates(date?: string): Promise<Record<string, number> | null> {
  return loadFxRatesOn(date).then((r) => r?.rates ?? null);
}

/** What was typed into the converter, for forms that keep the receipt's own
 *  figure beside the dollars (the Travel Log keeps euros). */
export type ConvertedFrom = { currency: string; amountCents: number };

export function CurrencyConverter({
  onUse,
  blue = false,
  defaultFrom,
  date,
}: {
  onUse: (usdCents: number, from: ConvertedFrom) => void;
  /** The currency it opens on — a Travel booking's own foreign currency. */
  defaultFrom?: string;
  /** The purchase date; a past day converts at that day's rate. */
  date?: string;
  /** Blue instead of the indigo brand colour — the Travel forms use no purple. */
  blue?: boolean;
}) {
  const link = blue ? "text-sky-700 hover:text-sky-800 dark:text-sky-400" : "text-brand hover:text-brand-strong";
  const focusRing = blue ? "focus:ring-sky-500" : "focus:ring-brand";
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState<string>("EUR");
  // What loaded, and for which date: "loading" is just "nothing yet for this
  // date", so changing the date shows … until its rates arrive.
  const [loaded, setLoaded] = useState<{ for: string; fx: FxRates | null } | null>(null);
  const dateKey = date ?? "";
  const current = loaded?.for === dateKey ? loaded : null;
  const fx = current?.fx ?? null;
  const loading = open && !current;
  const error = current && !current.fx ? "Couldn't load rates" : null;

  // Loads while the panel is open, and again when the form's date changes —
  // the rate belongs to the purchase day, not to when it's typed in.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    loadFxRatesOn(date).then((r) => {
      if (!stale) setLoaded({ for: date ?? "", fx: r });
    });
    return () => { stale = true; };
  }, [open, date]);

  function openConverter() {
    setOpen(true);
    if (defaultFrom) setFrom(defaultFrom);
  }

  const num = parseFloat(amount);
  const rate = loading ? undefined : fx?.rates[from];
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
            onClick={() => setAmount("")}
            className="rounded-md bg-sky-100 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-sky-200 dark:bg-sky-900/50 dark:hover:bg-sky-900"
          >
            Clear
          </button>
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
              className="rounded-md bg-positive/15 px-3 py-1.5 text-xs font-semibold text-positive transition hover:bg-positive/25"
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
          1 USD = {rate.toFixed(4)} {from} ·{" "}
          {fx?.asOf
            ? `rate on ${new Date(`${fx.asOf}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
            : "today's rate"}
        </p>
      ) : null}
    </div>
  );
}

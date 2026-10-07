"use client";

import { useEffect, useRef, useState } from "react";
import { TransactionModal } from "../budget/transaction-modal";
import { listPayees } from "../budget/actions";
import { loadTxFormOptions } from "../budget/tx-form-options";
import { usePrefetchTripTagging, useTripTagging } from "../budget/trip-tagging-cache";
import { useScrollLock } from "@/lib/use-scroll-lock";

// The same add-transaction form as the Transactions page, opened from the
// Travel Log so a trip purchase can be logged without leaving the page. The
// form's Trip field tags it to the trip, which is what feeds Spent here.
// Its pickers load in the background once the page is up, so a tap opens
// the form at once instead of waiting ~1.5s for them.
export function AddTransactionButton() {
  usePrefetchTripTagging();
  const [options, setOptions] = useState<Awaited<ReturnType<typeof loadTxFormOptions>> | null>(null);
  // Opened from the Travel Log, a purchase is most likely for the next trip:
  // it's the fallback when no trip's dates cover the purchase date (a trip
  // under way still wins, as it does everywhere else).
  const { trips } = useTripTagging();
  const today = new Date().toISOString().slice(0, 10);
  const nextTripId =
    trips
      .filter((t) => t.startOn && t.startOn > today)
      .sort((a, b) => (a.startOn! < b.startOn! ? -1 : 1))[0]?.id ?? undefined;
  const [payees, setPayees] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useScrollLock(open && !!options);

  type Loaded = { opts: Awaited<ReturnType<typeof loadTxFormOptions>>; payees: { id: string; name: string }[] };
  const inFlight = useRef<Promise<Loaded> | null>(null);
  const load = () => {
    if (!inFlight.current) {
      inFlight.current = Promise.all([loadTxFormOptions(), listPayees()])
        .then(([opts, payeeList]) => {
          setOptions(opts);
          setPayees(payeeList);
          return { opts, payees: payeeList };
        })
        .finally(() => {
          inFlight.current = null;
        });
    }
    return inFlight.current;
  };

  // Background load after the page has painted. A failure here stays quiet;
  // the tap retries and shows the error then.
  useEffect(() => {
    const t = setTimeout(() => void load().catch(() => {}), 300);
    return () => clearTimeout(t);
  }, []);

  const openForm = async () => {
    setError(null);
    setOpen(true);
    if (options) return;
    setLoading(true);
    try {
      await load();
    } catch (err) {
      setOpen(false);
      setError(err instanceof Error ? err.message : "Couldn't open the form.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openForm}
        disabled={loading}
        // Same colours as the Transactions page's "+ Transaction" button; sized
        // to sit beside Add Trip / Edit trip.
        className="flex items-center gap-1.5 rounded-lg bg-brand-soft px-4 py-2 text-base font-bold text-brand shadow-sm ring-1 ring-brand/15 transition hover:bg-brand hover:text-white disabled:opacity-60 sm:text-lg"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M10 4v12M4 10h12" />
        </svg>
        {loading ? "Opening…" : "Add transaction"}
      </button>
      {error ? <p className="w-full text-xs text-negative">{error}</p> : null}

      {open && options ? (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 sm:items-start sm:overflow-y-auto sm:px-4 sm:py-10">
          <div className="w-full sm:max-w-[520px]">
            <TransactionModal
              editTx={null}
              monthKey={options.month.key}
              firstOfMonth={options.month.firstOfMonth}
              subOptions={options.subOptions}
              accountOptions={options.accountOptions}
              propertyOptions={options.propertyOptions}
              bucketsByAccount={options.bucketsByAccount}
              payeeOptions={payees}
              payeeLineItems={options.payeeLineItems}
              initialKind="expenses"
              defaultTripId={nextTripId}
              onClose={() => {
                setOpen(false);
                // A save moves balances and Remaining: refresh in the
                // background, keeping the current lists until it lands.
                void load().catch(() => {});
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

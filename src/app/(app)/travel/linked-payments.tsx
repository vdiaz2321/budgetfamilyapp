"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ModalShell, useCloseOnEscape } from "@/components/modal-shell";
import { formatMoney } from "@/lib/money";
import { TransactionModal } from "../budget/transaction-modal";
import { listPayees } from "../budget/actions";
import { loadTransactionForEdit, loadTxFormOptions } from "../budget/tx-form-options";
import type { TxData } from "../budget/types";
import type { TripTaggedPurchase } from "./types";

// "2026-10-11" → "Oct 11, 2026".
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Loaded = {
  tx: TxData;
  opts: Awaited<ReturnType<typeof loadTxFormOptions>>;
  payees: { id: string; name: string }[];
};

/**
 * Opens a booking's linked payment in the transaction form, from its locked
 * Spent boxes. One payment opens straight away; with several the booking
 * doesn't know which seat or night each one paid for, so a short list of
 * them comes first.
 */
export function useLinkedPayments(payments: TripTaggedPurchase[] | undefined, currency: string) {
  const list = payments ?? [];
  const [picking, setPicking] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // The form's pickers and the booking's payments load in the background
  // once a booking with payments is open, so a click opens the form without
  // a trip to the server. A failure stays quiet here; the click retries and
  // shows it.
  const pickers = useRef<Promise<[Loaded["opts"], Loaded["payees"]]> | null>(null);
  const loadPickers = () => {
    pickers.current ??= Promise.all([loadTxFormOptions(), listPayees()]).catch((err) => {
      pickers.current = null;
      throw err;
    });
    return pickers.current;
  };
  const txs = useRef(new Map<string, Promise<TxData>>());
  const loadTx = (id: string) => {
    let tx = txs.current.get(id);
    if (!tx) {
      tx = loadTransactionForEdit(id).catch((err) => {
        txs.current.delete(id);
        throw err;
      });
      txs.current.set(id, tx);
    }
    return tx;
  };
  const prefetch = (ids: string[]) => {
    void loadPickers().catch(() => {});
    for (const id of ids) void loadTx(id).catch(() => {});
  };
  // A new or removed payment changes the ids, which fetches the new one.
  const idKey = list.map((p) => p.id).join(",");
  useEffect(() => {
    if (!idKey) return;
    const t = setTimeout(() => prefetch(idKey.split(",")), 300);
    return () => clearTimeout(t);
  }, [idKey]);

  const openTx = async (id: string) => {
    setError(null);
    setLoadingId(id);
    try {
      const [tx, [opts, payees]] = await Promise.all([loadTx(id), loadPickers()]);
      setPicking(false);
      setLoaded({ tx, opts, payees });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open the transaction.");
      setPicking(true);
    } finally {
      setLoadingId(null);
    }
  };

  const open = () => {
    if (!list.length || loadingId) return;
    if (list.length === 1) void openTx(list[0].id);
    else setPicking(true);
  };

  // Portalled to the body: the booking popups are forms, and the transaction
  // form can't sit inside another form.
  const overlay = typeof document === "undefined" ? null : createPortal(
    <>
      {picking ? (
        <ModalShell title="Linked payments" onClose={() => setPicking(false)} className="sm:max-w-md" mobileAlign="top">
          <div className="space-y-2 p-4">
            <p className="text-xs font-semibold">Pick one to open</p>
            <ul className="space-y-1.5">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => void openTx(p.id)}
                    disabled={loadingId != null}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 disabled:opacity-60 dark:hover:bg-sky-900/50"
                  >
                    <span className="shrink-0 tabular-nums">{shortDate(p.date)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold">{p.payee ?? "—"}</span>
                      <span className="hidden sm:inline"> · {p.item}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums" style={{ color: "var(--negative)" }}>
                      {loadingId === p.id ? "Opening…" : formatMoney(p.amountCents, currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {error ? <p className="text-xs text-negative">{error}</p> : null}
          </div>
        </ModalShell>
      ) : null}
      {loaded ? (
        <EditPayment
          loaded={loaded}
          onClose={() => {
            setLoaded(null);
            // A save can change the payment, balances and Remaining: fetch
            // them all afresh, ready for the next click.
            pickers.current = null;
            txs.current.clear();
            prefetch(list.map((p) => p.id));
          }}
        />
      ) : null}
    </>,
    document.body,
  );

  return {
    /** True when there is a payment to open — the Spent boxes are clickable. */
    canOpen: list.length > 0,
    opening: loadingId != null && !picking,
    /** An error opening a single payment, shown under the box. */
    error: picking ? null : error,
    open,
    /** Opens one payment straight in the form — a transaction row's click. */
    openOne: (id: string) => {
      if (!loadingId) void openTx(id);
    },
    /** The payment being fetched, so its row can say "Opening…". */
    loadingId,
    overlay,
  };
}

// The form over the booking popup. It joins the popup stack so Escape closes
// the form and leaves the booking open behind it.
function EditPayment({ loaded, onClose }: { loaded: Loaded; onClose: () => void }) {
  useCloseOnEscape(onClose);
  return (
    <div
      // React events still bubble up the component tree through the portal:
      // keep this form's clicks and submit from reaching the booking form.
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => e.stopPropagation()}
      // Solid on a phone: the form stops short of the bottom, and the booking
      // form showing through under it read as part of it.
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-surface sm:items-start sm:bg-black/40 sm:overflow-y-auto sm:px-4 sm:py-10"
    >
      <div className="w-full sm:max-w-[520px]">
        <TransactionModal
          editTx={loaded.tx}
          monthKey={loaded.opts.month.key}
          firstOfMonth={loaded.opts.month.firstOfMonth}
          subOptions={loaded.opts.subOptions}
          accountOptions={loaded.opts.accountOptions}
          propertyOptions={loaded.opts.propertyOptions}
          bucketsByAccount={loaded.opts.bucketsByAccount}
          payeeOptions={loaded.payees}
          payeeLineItems={loaded.opts.payeeLineItems}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

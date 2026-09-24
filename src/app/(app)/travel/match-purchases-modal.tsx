"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { formatMoneyWhole } from "@/lib/money";
import { listTripPurchaseCandidates, tagTripPurchases } from "@/app/(app)/budget/actions";
import type { TripPurchaseCandidate } from "@/app/(app)/budget/types";
import { sheetDate, sheetDateRange, type TripSummary } from "./trip-summary";
import { EXPENSE_CATEGORIES, actualCents } from "./types";

const columnLabel = (key: string) => EXPENSE_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";

// The columns a catch-all (Traveling/Trips) purchase can take — the same list
// the transaction modal offers.
const CATCH_ALL_COLUMNS = ["other", "groceries", "entertainment", "transport", "fuel_tolls", "parking", "cash"] as const;

// A first guess at the column from the payee, so Parking, the Zoo and a bus
// ticket don't all pile into "Other" beside a typed Parking / Entertainment /
// Transport figure (which would count them twice). Always changeable.
function guessColumn(payee: string | null): string {
  const p = (payee ?? "").toLowerCase();
  if (/park(ing|haus|platz)|parken/.test(p)) return "parking";
  if (/fuel|tank|shell|aral|esso|toll|vignette/.test(p)) return "fuel_tolls";
  if (/vvs|mvv|bvg|\bbus\b|bus tix|train|bahn|metro|tram|ticket|tix|berlin card|transit/.test(p)) return "transport";
  if (/\beuros?\b|\batm\b|cash/.test(p)) return "cash";
  if (/grocer|rewe|aldi|lidl|edeka|kaufland|trinkgut|spar\b/.test(p)) return "groceries";
  if (/mus(eu|ue)m|zoo|cinem|gorge|cable|tour|castle|schloss|aquarium|park\b|ticket/.test(p)) return "entertainment";
  return "other";
}

/**
 * "Match purchases": the untagged purchases dated inside a trip, ticked where
 * they are plainly trip spending, tagged to the trip in one save. Trips from
 * before trip tagging existed carry hand-typed actuals; this is how their
 * card purchases get attached after the fact. Saving follows the transaction
 * modal's rules — trip spending moves to the trip budget items (Restaurant
 * Travel, Traveling/Trips) keeping its Travel Log column.
 */
export function MatchPurchasesModal({
  summary: t,
  currency,
  onClose,
}: {
  summary: TripSummary;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<TripPurchaseCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // The Travel Log column for each catch-all purchase (guessed, then picked).
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const from = t.start;
  const to = t.end;

  useEffect(() => {
    if (!from || !to) return;
    let alive = true;
    listTripPurchaseCandidates(t.trip.id, from, to)
      .then((found) => {
        if (!alive) return;
        setRows(found);
        // Everything starts ticked except a likely booking payment.
        setChecked(new Set(found.filter((r) => !r.looksLike).map((r) => r.id)));
        setColumns(Object.fromEntries(found.filter((r) => r.catchAll).map((r) => [r.id, guessColumn(r.payee)])));
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the purchases."));
    return () => {
      alive = false;
    };
  }, [t.trip.id, from, to]);

  // The list is only what can be tagged. A payment that looks like one of the
  // trip's bookings (Four Points → the Four Points stay) already counts under
  // Hotels / Flights, so it is left out and just named below the list —
  // offering it with a checkbox and a column picker asked a question with no
  // right answer (Victor, 2026-09-23).
  const taggable = useMemo(() => (rows ?? []).filter((r) => !r.looksLike), [rows]);
  const leftOut = useMemo(() => (rows ?? []).filter((r) => r.looksLike), [rows]);

  const colOf = (r: TripPurchaseCandidate) => (r.catchAll ? columns[r.id] ?? "other" : r.column);

  // What each Travel Log row becomes: tagged purchases replace a typed
  // actual, and add to purchases already tagged. Typed rows nothing lands on
  // are listed too, as staying — so a figure counted twice is visible here.
  const preview = useMemo(() => {
    const ticked = new Map<string, { cents: number; count: number }>();
    for (const r of rows ?? []) {
      if (!checked.has(r.id)) continue;
      const column = colOf(r);
      const cur = ticked.get(column) ?? { cents: 0, count: 0 };
      ticked.set(column, { cents: cur.cents + r.amountCents, count: cur.count + 1 });
    }
    type PreviewRow = { key: string; label: string; before: number | null; typed: boolean; after: number | null; count: number };
    return EXPENSE_CATEGORIES.flatMap(({ key, label }): PreviewRow[] => {
      const add = ticked.get(key);
      const e = t.expenses.find((x) => x.category === key);
      if (!add) {
        const kept = e ? actualCents(e) : null;
        return kept ? [{ key, label, before: kept, typed: e!.txCount === 0, after: null, count: e!.txCount }] : [];
      }
      const before = e ? actualCents(e) : null;
      const typed = Boolean(e && e.txCount === 0 && e.actualCents != null);
      const base = e && e.txCount > 0 ? e.txActualCents ?? 0 : 0;
      return [{ key, label, before, typed, after: Math.max(0, base + add.cents), count: add.count + (e?.txCount ?? 0) }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colOf reads `columns`
  }, [rows, checked, columns, t.expenses]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    if (!from || !to) return;
    // Named reason, not a greyed-out button (the app's save-button rule).
    if (checked.size === 0) {
      setError("Tick at least one purchase to tag.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        await tagTripPurchases(
          t.trip.id,
          from,
          to,
          (rows ?? []).filter((r) => checked.has(r.id)).map((r) => ({ id: r.id, column: r.catchAll ? colOf(r) : null })),
        );
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not tag the purchases.");
      }
    });
  };

  return (
    <ModalShell title={`Match purchases · ${t.trip.name.split(" · ")[0]}`} onClose={onClose} className="sm:max-w-3xl" mobileAlign="top">
      <div className="space-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <p className="text-xs text-muted">
          Purchases dated {from && to ? sheetDateRange(from, to) : "during the trip"}{" "}that aren&apos;t on a trip yet. Ticked ones are
          tagged to this trip and moved to the trip budget items.
        </p>

        {rows == null && !error ? <p className="py-6 text-center text-sm text-muted">Loading purchases…</p> : null}
        {rows != null && taggable.length === 0 ? (
          <p className="rounded-lg px-3 py-4 text-center text-sm text-muted ring-1 ring-line">
            No untagged purchases on these dates.
          </p>
        ) : null}

        {taggable.length ? (
          <section>
            <ul className="divide-y divide-line/60 rounded-lg ring-1 ring-line">
              {taggable.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06]">
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-sky-600"
                    />
                    {/* On a phone the column picker drops under the name, so
                        the name isn't squeezed to "Mus…"; from sm up it sits
                        inline before the amount. */}
                    <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-semibold">{r.payee ?? r.itemName}</span>
                        <span className="truncate text-[11px] text-muted">
                          <span className="tabular-nums">{sheetDate(r.date)}</span> · {r.itemName}
                          {r.catchAll ? "" : ` → ${columnLabel(r.column)}`}
                        </span>
                      </span>
                      {r.catchAll ? (
                        <select
                          value={columns[r.id] ?? "other"}
                          onChange={(e) => setColumns((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Travel Log column for ${r.payee ?? r.itemName}`}
                          className="self-start rounded-md bg-background px-1.5 py-1 text-xs ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-sky-500 sm:shrink-0 sm:self-auto"
                        >
                          {CATCH_ALL_COLUMNS.map((key) => (
                            <option key={key} value={key}>{columnLabel(key)}</option>
                          ))}
                        </select>
                      ) : null}
                    </span>
                    {/* Fixed width so every row's column picker lines up. */}
                    <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">{formatMoneyWhole(r.amountCents, currency)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {leftOut.length ? (
          <p className="text-xs text-muted">
            Left out:{" "}
            {leftOut.map((r, i) => (
              <span key={r.id}>
                {i ? "; " : ""}
                <span className="font-semibold text-foreground">{r.payee ?? r.itemName} {formatMoneyWhole(r.amountCents, currency)}</span>
                {` — payment for ${r.looksLike}, already under ${r.looksLikeColumn ?? "Hotels"}`}
              </span>
            ))}
            .
          </p>
        ) : null}

        {/* Nothing to match: no preview, and the only way out is Close. */}
        {taggable.length && preview.length ? (
          <section className="rounded-lg bg-background/60 px-3 py-2 ring-1 ring-line">
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide">Travel Log after saving</h3>
            <ul className="space-y-0.5 text-xs">
              {preview.map((p) => (
                <li key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold">{p.label}</span>
                  {p.after == null ? (
                    <span className="tabular-nums text-muted">
                      {formatMoneyWhole(p.before ?? 0, currency)}{p.typed ? " typed" : ""} — stays
                    </span>
                  ) : (
                    <span className="tabular-nums text-muted">
                      {p.before != null ? `${formatMoneyWhole(p.before, currency)}${p.typed ? " typed" : ""} → ` : ""}
                      <span className="font-semibold text-foreground">{formatMoneyWhole(p.after, currency)}</span>
                      {` from ${p.count} purchase${p.count === 1 ? "" : "s"}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {error ? <p className="text-xs font-medium text-negative">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {taggable.length ? (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? "Tagging…" : `Tag ${checked.size} purchase${checked.size === 1 ? "" : "s"}`}
          </button>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-black/5 dark:hover:bg-white/10">
            {taggable.length ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

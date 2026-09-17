"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { formatMoney, formatMoneyWhole } from "@/lib/money";
import { deleteTrip, updateTrip } from "./trip-actions";
import { Field, inputClass } from "./travel-form";
import { sheetDateRange, type Booking, type TripSummary } from "./trip-summary";
import { EXPENSE_CATEGORIES } from "./types";

const DASH = "—";
const KIND_LABEL = { flight: "Flight", stay: "Stay", car: "Rental" } as const;
// A section's action, sat right beside its heading. Bordered and on the page
// background so it reads as a button, not a faint outline. Hover is a light
// blue wash — grey read as disabled, black as too heavy, and Victor rejects
// the purple brand colour anywhere new.
const SECTION_BUTTON =
  "rounded-md border border-black/25 bg-background px-2.5 py-1 text-[11px] font-semibold transition hover:border-sky-400 hover:bg-sky-100 dark:border-white/30 dark:hover:border-sky-500 dark:hover:bg-sky-900/40";

/**
 * One trip, whole: its bookings in date order, its spending planned against
 * actual, and what it all came to. Each booking opens its own form; the
 * spending opens the Misc form already on this trip.
 */
export function TripDetailModal({
  summary: t,
  currency,
  onEditBooking,
  onAddBooking,
  onEditSpending,
  onClose,
}: {
  summary: TripSummary;
  currency: string;
  onEditBooking: (booking: Booking) => void;
  onAddBooking: () => void;
  onEditSpending: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [editingNotes, setEditingNotes] = useState(false);
  const [name, setName] = useState(t.trip.name);
  const [startOn, setStartOn] = useState(t.trip.startOn ?? "");
  const [endOn, setEndOn] = useState(t.trip.endOn ?? "");
  const [notes, setNotes] = useState(t.trip.notes ?? "");

  // The spending table rounds to whole units and keeps dollars and euros on
  // one line — "$507 / €428" — instead of stacking ".00" figures.
  const money = (cents: number | null | undefined) => (cents ? formatMoneyWhole(cents, currency) : DASH);
  const euros = (cents: number | null | undefined) => (cents != null ? formatMoneyWhole(cents, "€") : "");
  // The euro side of a Total cell — only when some row has a euro figure.
  const eurTotal = (field: "plannedEurCents" | "actualEurCents") => {
    const values = t.expenses.map((e) => e[field]).filter((v): v is number => v != null);
    return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
  };

  function run(action: () => Promise<{ error: string | null }>, after: () => void) {
    start(async () => {
      setError(null);
      const result = await action();
      if (result.error) setError(result.error);
      else {
        router.refresh();
        after();
      }
    });
  }

  return (
    <ModalShell
      title={t.trip.name}
      onClose={onClose}
      className="sm:max-w-4xl"
      mobileAlign="top"
    >
      <div className="space-y-4 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {t.start ? (
            <span className="tabular-nums">
              {sheetDateRange(t.start, t.end)}
            </span>
          ) : (
            <span>No dates yet</span>
          )}
          {t.nights != null ? <span>{t.nights} night{t.nights === 1 ? "" : "s"}</span> : null}
          {t.pax ? <span>{t.pax} pax</span> : null}
          {!editingNotes ? (
            <button type="button" onClick={() => { setNotes(t.trip.notes ?? ""); setEditingNotes(true); }} className={`${SECTION_BUTTON} text-foreground`}>
              {t.trip.notes ? "Edit notes" : "+ Add notes"}
            </button>
          ) : null}
        </div>

        {/* ---- Notes: edited in place, right where they are read; the Edit
             notes button sits on the dates line above. */}
        {editingNotes || t.trip.notes ? (
        <section>
          {editingNotes ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => updateTrip(t.trip.id, { name: t.trip.name, startOn: t.trip.startOn ?? "", endOn: t.trip.endOn ?? "", notes }),
                  () => setEditingNotes(false),
                );
              }}
              className="space-y-2"
            >
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                autoFocus
                className={`${inputClass} resize-y`}
              />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className="rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--viz-income)" }}>
                  {pending ? "Saving…" : "Save notes"}
                </button>
                <button type="button" onClick={() => setEditingNotes(false)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:text-foreground">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="whitespace-pre-line text-xs">{t.trip.notes}</p>
          )}
        </section>
        ) : null}

        {/* What the trip came to. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Total spent" value={formatMoney(t.total, currency)} className="text-negative" note={t.hasEstimates ? "incl. planned" : undefined} />
          <Stat label="Bookings" value={formatMoney(t.flights + t.hotels + t.rentals, currency)} />
          <Stat label="Spending" value={formatMoney(t.miscTotal, currency)} />
          <Stat
            label={t.points > 0 ? "Pts used · saved" : "Saved"}
            value={t.points > 0 ? `${t.points.toLocaleString()} · ${formatMoney(t.saved, currency)}` : formatMoney(t.saved, currency)}
            className="text-positive"
          />
        </div>

        {/* ---- Bookings */}
        <section>
          <div className="mb-1 flex items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide">Bookings</h3>
            <button
              type="button"
              onClick={onAddBooking}
              className={SECTION_BUTTON}
            >
              + Add to this trip
            </button>
          </div>
          {t.bookings.length ? (
            <ul className="divide-y divide-line/60 rounded-lg ring-1 ring-line">
              {t.bookings.map((b) => (
                <li key={`${b.kind}-${b.id}`}>
                  <button
                    type="button"
                    onClick={() => onEditBooking(b)}
                    className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-left transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06] ${b.cancelled ? "opacity-60" : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-14 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {KIND_LABEL[b.kind]}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold">
                          {b.title}
                          {b.cancelled ? <span className="ml-1.5 text-[10px] font-semibold text-muted">Cancelled</span> : null}
                        </span>
                        <span className="text-[11px] text-muted">
                          <span className="tabular-nums">
                            {sheetDateRange(b.start, b.end)}
                          </span>{" "}
                          · {b.detail}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-baseline gap-3 pl-16 sm:pl-0">
                      {b.points > 0 ? (
                        <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--viz-savings)" }}>
                          {b.points.toLocaleString()} pts
                        </span>
                      ) : null}
                      <span className={`text-sm font-bold tabular-nums ${b.pocket > 0 ? "text-negative" : "text-muted"}`}>
                        {formatMoney(b.pocket, currency)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg px-3 py-2 text-xs text-muted ring-1 ring-line">No flights, stays or rentals in this trip yet.</p>
          )}
        </section>

        {/* ---- Spending, planned against actual */}
        <section>
          <div className="mb-1 flex items-center gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide">Spending</h3>
            <button
              type="button"
              onClick={onEditSpending}
              className={SECTION_BUTTON}
            >
              {t.expenses.length ? "Edit spending" : "+ Add spending"}
            </button>
          </div>
          {t.expenses.length ? (
            <div className="overflow-x-auto rounded-lg ring-1 ring-line">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-1.5 text-center font-semibold">Category</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Planned</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Actual</th>
                    <th className="px-3 py-1.5 text-center font-semibold">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {EXPENSE_CATEGORIES.map(({ key, label }) => {
                    const e = t.expenses.find((x) => x.category === key);
                    if (!e) return null;
                    const diff = e.plannedCents != null && e.actualCents != null ? e.plannedCents - e.actualCents : null;
                    return (
                      <tr key={key} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-1.5 text-left font-semibold">{label}</td>
                        <td className="px-3 py-1.5 text-center tabular-nums">
                          {money(e.plannedCents)}
                          {e.plannedEurCents != null ? <span className="text-muted"> / {euros(e.plannedEurCents)}</span> : null}
                        </td>
                        <td className="px-3 py-1.5 text-center font-semibold tabular-nums">
                          {money(e.actualCents)}
                          {e.actualEurCents != null ? <span className="font-normal text-muted"> / {euros(e.actualEurCents)}</span> : null}
                        </td>
                        <td className={`px-3 py-1.5 text-center tabular-nums ${diff == null ? "text-muted" : diff >= 0 ? "text-positive" : "text-negative"}`}>
                          {diff == null ? DASH : `${diff >= 0 ? "" : "−"}${formatMoneyWhole(Math.abs(diff), currency)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-bold">
                    <td className="px-3 py-1.5 text-left">Total</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {money(t.plannedMisc)}
                      {eurTotal("plannedEurCents") != null ? <span className="font-normal text-muted"> / {euros(eurTotal("plannedEurCents"))}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-center tabular-nums">
                      {money(t.actualMisc)}
                      {eurTotal("actualEurCents") != null ? <span className="font-normal text-muted"> / {euros(eurTotal("actualEurCents"))}</span> : null}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="rounded-lg px-3 py-2 text-xs text-muted ring-1 ring-line">No restaurants, groceries or other spending yet.</p>
          )}
        </section>

        {/* ---- The trip itself */}
        <section className="border-t border-line pt-3">
          {mode === "edit" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => updateTrip(t.trip.id, { name, startOn, endOn, notes }), () => setMode("view"));
              }}
              className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_9.5rem_9.5rem]"
            >
              <Field label="Trip name" className="col-span-2 sm:col-span-1">
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Starts">
                <input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Ends">
                <input type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Notes" className="col-span-2 sm:col-span-3">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={`${inputClass} resize-y`} />
              </Field>
              <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-3">
                <button type="submit" disabled={pending} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                  {pending ? "Saving…" : "Save trip"}
                </button>
                <button type="button" onClick={() => setMode("view")} className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted hover:text-foreground">
                  Cancel
                </button>
              </div>
            </form>
          ) : mode === "delete" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Delete this trip and everything in it — its stays, flights, rentals and spending?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteTrip(t.trip.id), onClose)}
                className="rounded-md bg-negative px-3 py-1.5 font-semibold text-white disabled:opacity-60"
              >
                Delete trip
              </button>
              <button type="button" onClick={() => setMode("view")} className="px-2 py-1.5 font-semibold text-muted hover:text-foreground">
                Keep
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setNotes(t.trip.notes ?? ""); setMode("edit"); }}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                Edit trip
              </button>
              <button
                type="button"
                onClick={() => setMode("delete")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/10"
              >
                Delete trip
              </button>
            </div>
          )}
          {error ? <p className="mt-2 text-xs font-medium text-negative">{error}</p> : null}
        </section>
      </div>
    </ModalShell>
  );
}

function Stat({ label, value, className, note }: { label: string; value: string; className?: string; note?: string }) {
  return (
    <div className="rounded-lg bg-background/60 px-3 py-2 text-center ring-1 ring-line">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-base font-bold tabular-nums ${className ?? ""}`}>{value}</p>
      {note ? <p className="text-[10px] font-semibold text-muted">{note}</p> : null}
    </div>
  );
}

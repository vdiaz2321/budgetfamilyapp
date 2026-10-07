"use client";

import { useEffect, useRef, useState } from "react";
import { loadFxRates } from "@/components/currency-converter";
import { centsToDisplay, displayToCents, foreignSymbol, formatMoney } from "@/lib/money";
import { CurrencySelect } from "../travel/travel-form";
import type { AccountOption, TripBookingOption } from "./types";

// What a payment for a trip booking does to that booking, shown under "Pays
// for" on the transaction form: a flight's Spent per passenger, in dollars and
// the booking's other currency — the same columns as the Travel Log's flight
// popup — and the booking's Payment figures (card, points, value per point,
// cost, pocket cost) as they will be once this is saved.

export type PaxRow = { name: string; cents: string; foreign: string; points: string };

const box = "w-full min-w-0 rounded-lg bg-surface px-2 py-1.5 text-center text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
const label = "block text-[10px] font-semibold uppercase tracking-wide text-muted";
// Name, Spent $, Spent in the other currency, Points. On a phone the name
// takes its own line and the boxes share the next. A flight priced only in
// dollars has no other-currency column.
const PAX_GRID = "grid grid-cols-3 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_5.5rem]";
const PAX_GRID_USD = "grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_5.5rem]";
const toInt = (v: string) => Math.max(0, Math.trunc(Number(v.replace(/,/g, ""))) || 0);

export function BookingPaymentPanel({
  booking,
  rows,
  onRow,
  onTotalPoints,
  onResetSplit,
  foreignCurrency,
  onForeignCurrency,
  totalCents,
  isRefund,
  editTxId,
  accountId,
  accountOptions,
  bookingPoints,
  onBookingPoints,
  pointsValue,
  onPointsValue,
  freeNight,
  onFreeNight,
  credit,
  onCredit,
}: {
  booking: TripBookingOption;
  /** Flights: one row per passenger. Empty for stays and cars. */
  rows: PaxRow[];
  onRow: (name: string, patch: Partial<Omit<PaxRow, "name">>) => void;
  /** Flights: a points total typed in Points used, shared across the seats. */
  onTotalPoints: (points: number) => void;
  onResetSplit: () => void;
  foreignCurrency: string;
  onForeignCurrency: (code: string) => void;
  totalCents: number;
  isRefund: boolean;
  editTxId: string | null;
  /** The account picked for this payment. */
  accountId: string;
  accountOptions: AccountOption[];
  bookingPoints: string;
  onBookingPoints: (v: string) => void;
  /** Value per point typed in cents; blank works it out from the points. */
  pointsValue: string;
  onPointsValue: (v: string) => void;
  /** Stays: "on"/"off" once ticked here; "" keeps the stay's own. */
  freeNight: "" | "on" | "off";
  onFreeNight: (v: "on" | "off") => void;
  /** Stays: hotel credit typed in dollars; "" keeps the stay's own. */
  credit: string;
  onCredit: (v: string) => void;
}) {
  const isStay = booking.ref.startsWith("stay:");
  const nightOn = freeNight === "" ? booking.freeNightUsed : freeNight === "on";
  const isFlight = booking.ref.startsWith("flight:") && rows.length > 0;
  const splitCents = rows.reduce((sum, r) => sum + Math.max(0, displayToCents(r.cents)), 0);
  const splitForeign = rows.reduce((sum, r) => sum + Math.max(0, displayToCents(r.foreign)), 0);
  const left = totalCents - splitCents;
  const fx = foreignSymbol(foreignCurrency);
  const foreign = booking.usesForeign;
  const grid = foreign ? PAX_GRID : PAX_GRID_USD;
  const nameSpan = foreign ? "col-span-3 sm:col-span-1" : "col-span-2 sm:col-span-1";

  // Typing in the other currency fills that passenger's dollars at today's
  // rate, as the flight popup does. The rates load with the panel.
  const rates = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (!isFlight) return;
    loadFxRates().then((r) => {
      rates.current = r;
    });
  }, [isFlight]);
  function typeForeign(name: string, value: string) {
    const rate = rates.current?.[foreignCurrency];
    const n = Number(value.replace(/,/g, ""));
    onRow(name, rate && value.trim() && Number.isFinite(n) ? { foreign: value, cents: centsToDisplay(Math.round((n / rate) * 100)) } : { foreign: value });
  }

  // Card: the booking's own, or — none yet — this payment's card, which
  // saving links to it.
  const paying = accountOptions.find((a) => a.id === accountId);
  const cardName = booking.accountId
    ? accountOptions.find((a) => a.id === booking.accountId)?.name ?? "Linked card"
    : paying?.group === "Credit Cards"
      ? paying.name
      : null;

  // Points: a flight's passengers added up; otherwise the figure typed here,
  // or the booking's own when left blank.
  const points = isFlight
    ? rows.reduce((sum, r) => sum + toInt(r.points), 0)
    : bookingPoints.trim()
      ? toInt(bookingPoints)
      : booking.pointsUsed
        ? booking.pointsCost
        : 0;
  // What's in the flight's Points used box while it is being typed.
  const [pointsDraft, setPointsDraft] = useState<string | null>(null);
  // A flight's points are valued at what those seats would have cost.
  const pointsFares = isFlight
    ? booking.passengers.reduce((sum, p, i) => sum + (toInt(rows[i]?.points ?? "") > 0 ? p.plannedCents : 0), 0)
    : 0;
  // Blank, the value per point is worked out (shown as the hint), as on the
  // flight popup; a figure typed here is kept instead.
  const impliedCents = isFlight
    ? points > 0 && pointsFares > 0
      ? pointsFares / points
      : null
    : booking.pointsValueMicros
      ? booking.pointsValueMicros / 10_000
      : null;

  const plannedCents = isFlight ? booking.passengers.reduce((sum, p) => sum + p.plannedCents, 0) : booking.plannedCents ?? booking.costCents;
  const otherPaid = booking.payments.filter((p) => p.txId !== editTxId).reduce((sum, p) => sum + p.amountCents, 0);
  const pocketCents = Math.max(0, otherPaid + (isRefund ? -totalCents : totalCents));

  return (
    <div className="mt-2 space-y-3 rounded-xl bg-background p-3 ring-1 ring-line">
      {isFlight ? (
        <div>
          {foreign ? (
            <div className="mb-2">
              <CurrencySelect value={foreignCurrency} onChange={onForeignCurrency} />
            </div>
          ) : null}
          <div className={`${grid} pb-1`}>
            <span className={`${label} hidden sm:block`}>Passenger</span>
            <span className={`${label} text-center`}>Spent USD $</span>
            {foreign ? (
              <span className={`${label} text-center`}>Spent {foreignCurrency === fx ? fx : `${foreignCurrency} ${fx}`}</span>
            ) : null}
            <span className={`${label} text-center`}>Points</span>
          </div>
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.name} className={grid}>
                <span className={`${nameSpan} truncate text-sm font-medium`}>{r.name}</span>
                <input
                  aria-label={`${r.name} spent USD`}
                  value={r.cents}
                  onChange={(e) => onRow(r.name, { cents: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  inputMode="decimal"
                  className={box}
                />
                {foreign ? (
                  <input
                    aria-label={`${r.name} spent ${foreignCurrency}`}
                    value={r.foreign}
                    onChange={(e) => typeForeign(r.name, e.target.value)}
                    onFocus={(e) => e.target.select()}
                    inputMode="decimal"
                    className={box}
                  />
                ) : null}
                <input
                  aria-label={`${r.name} points`}
                  value={r.points}
                  onChange={(e) => onRow(r.name, { points: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  placeholder="0"
                  inputMode="numeric"
                  className={box}
                />
              </li>
            ))}
          </ul>
          <div className={`${grid} mt-1.5 border-t border-line pt-1.5 text-sm font-bold tabular-nums`}>
            <span className={nameSpan}>Total</span>
            <span className="text-center">{formatMoney(splitCents)}</span>
            {foreign ? <span className="text-center">{fx}{centsToDisplay(splitForeign)}</span> : null}
            <span className="text-center">{points ? points.toLocaleString() : ""}</span>
          </div>
          {left !== 0 && totalCents > 0 ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold text-negative">
              {left > 0 ? `${formatMoney(left)} left to split` : `${formatMoney(-left)} over the amount`}
              <button type="button" onClick={onResetSplit} className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-foreground ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-900/40">
                Split by planned fares
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The booking's Payment figures, as the Travel Log will show them. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-center sm:grid-cols-4">
        <div className="col-span-2 min-w-0 sm:col-span-4">
          <span className={label}>Card</span>
          <span className="block truncate text-sm font-semibold">{cardName ?? "Not linked"}</span>
        </div>
        <label className="min-w-0">
          <span className={label}>Points used</span>
          <input
            inputMode="numeric"
            value={isFlight ? pointsDraft ?? (points ? points.toLocaleString() : "") : bookingPoints}
            onChange={(e) => {
              if (!isFlight) return onBookingPoints(e.target.value);
              setPointsDraft(e.target.value);
              onTotalPoints(toInt(e.target.value));
            }}
            onFocus={(e) => e.target.select()}
            onBlur={() => setPointsDraft(null)}
            placeholder={!isFlight && booking.pointsUsed && booking.pointsCost ? booking.pointsCost.toLocaleString() : "0"}
            className={`${box} mt-0.5`}
          />
        </label>
        <label className="min-w-0">
          <span className={label}>Value / pt (¢)</span>
          <input
            inputMode="decimal"
            value={pointsValue}
            onChange={(e) => onPointsValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={impliedCents ? String(Number(impliedCents.toFixed(2))) : ""}
            className={`${box} mt-0.5`}
            style={{ color: "var(--viz-savings)" }}
          />
        </label>
        <Stat label="Planned cost" value={plannedCents ? formatMoney(plannedCents) : "—"} />
        <Stat label="Pocket cost" value={formatMoney(pocketCents)} color="var(--negative)" />
        {/* Stays: what else the booking takes off the card, so a free night
            or credit used is recorded here and the card updates itself —
            no trip to the card's Edit form. */}
        {isStay ? (
          <>
            <div className="min-w-0">
              <span className={label}>Free night</span>
              <button
                type="button"
                aria-pressed={nightOn}
                onClick={() => onFreeNight(nightOn ? "off" : "on")}
                className={`mt-0.5 w-full rounded-lg px-2 py-1.5 text-sm font-semibold ring-1 transition ${
                  nightOn
                    ? "bg-brand text-white ring-brand"
                    : "bg-surface text-foreground ring-line hover:bg-black/5 dark:hover:bg-white/10"
                }`}
              >
                {nightOn ? "Used" : "Not used"}
              </button>
            </div>
            <label className="min-w-0">
              <span className={label}>Hotel credit ($)</span>
              <input
                inputMode="decimal"
                value={credit}
                onChange={(e) => onCredit(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder={booking.hotelCreditCents ? centsToDisplay(booking.hotelCreditCents) : "0"}
                className={`${box} mt-0.5`}
              />
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label: text, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <span className={label}>{text}</span>
      <span className="mt-0.5 block truncate py-1.5 text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

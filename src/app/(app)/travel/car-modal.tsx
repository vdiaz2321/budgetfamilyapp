"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CurrencyConverter } from "@/components/currency-converter";
import { centsToDisplay, currencySymbol, displayToCents, formatMoney } from "@/lib/money";
import { deleteTravelCar, saveTravelCar, setTravelCarCancelled } from "./car-actions";
import { Field, Section, inputClass } from "./travel-form";
import { TripPicker, useTripChoice } from "./trip-picker";
import type { TravelCard, TravelCar, TravelTrip } from "./types";

const rateDisplay = (micros: number) => String(Number((micros / 1_000_000).toFixed(4)));

/**
 * A rental car booking. Driving the family car is not a booking — its fuel,
 * tolls and parking are the trip's Misc spending instead.
 */
export function CarModal({
  car,
  cards,
  trips,
  defaultTripId,
  currency,
  kindSwitch,
  onClose,
}: {
  car: TravelCar | null;
  trips: TravelTrip[];
  defaultTripId?: string | null;
  cards: TravelCard[];
  currency: string;
  /** The Stay | Flight | Rental | Misc switch, shown only when adding. */
  kindSwitch?: React.ReactNode;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [trip, setTrip] = useTripChoice(car ? car.tripId : defaultTripId);
  const [company, setCompany] = useState(car?.company ?? "");
  const [bookingCode, setBookingCode] = useState(car?.bookingCode ?? "");
  const [reservedOn, setReservedOn] = useState(car?.reservedOn ?? "");
  const [pickupOn, setPickupOn] = useState(car?.pickupOn ?? "");
  const [pickupTime, setPickupTime] = useState(car?.pickupTime?.slice(0, 5) ?? "");
  const [pickupPlace, setPickupPlace] = useState(car?.pickupPlace ?? "");
  const [returnOn, setReturnOn] = useState(car?.returnOn ?? "");
  const [returnTime, setReturnTime] = useState(car?.returnTime?.slice(0, 5) ?? "");
  const [returnPlace, setReturnPlace] = useState(car?.returnPlace ?? "");
  const [accountId, setAccountId] = useState(car?.accountId ?? "");
  const [cardLabel, setCardLabel] = useState(car?.cardLabel ?? "");
  const [holder, setHolder] = useState(car?.holder ?? "");
  const [cost, setCost] = useState(car?.costCents ? centsToDisplay(car.costCents) : "");
  const [costEur, setCostEur] = useState(car?.costEurCents != null ? centsToDisplay(car.costEurCents) : "");
  const [pointsUsed, setPointsUsed] = useState(car?.pointsUsed ?? false);
  const [points, setPoints] = useState(car?.pointsCost ? String(car.pointsCost) : "");
  const [pointsValue, setPointsValue] = useState(() => {
    if (!car?.pointsValueMicros) return "";
    const implied = car.pointsCost > 0 && car.costCents > 0 ? Math.round((car.costCents / car.pointsCost) * 10_000) : null;
    return car.pointsValueMicros !== implied ? rateDisplay(car.pointsValueMicros) : "";
  });
  const [pocketCost, setPocketCost] = useState(() => {
    if (!car) return "";
    const expected = car.pointsUsed ? 0 : car.costCents;
    return car.pocketCostCents !== expected ? centsToDisplay(car.pocketCostCents) : "";
  });
  const [remarks, setRemarks] = useState(car?.remarks ?? "");

  const card = cards.find((c) => c.id === accountId) ?? null;
  const costCents = Math.max(0, displayToCents(cost));
  const pointsTyped = Number(points.replace(/,/g, "")) || 0;
  const onPoints = pointsUsed && pointsTyped > 0;
  const impliedMicros = pointsTyped > 0 && costCents > 0 ? Math.round((costCents / pointsTyped) * 10_000) : null;
  const pocketCents = pocketCost.trim() ? displayToCents(pocketCost) : onPoints ? 0 : costCents;
  const days = pickupOn && returnOn && returnOn >= pickupOn
    ? Math.round((Date.parse(returnOn) - Date.parse(pickupOn)) / 86_400_000)
    : null;
  const moves = !car || car.movesCardPoints;
  const alreadyDrawn = car && !car.cancelledAt && car.pointsUsed && car.accountId === accountId ? car.pointsCost : 0;
  const draw = card && moves ? (onPoints ? pointsTyped : 0) - alreadyDrawn : 0;

  function pickCard(nextId: string) {
    setAccountId(nextId);
    const next = cards.find((c) => c.id === nextId);
    if (next && !holder.trim() && next.holder) setHolder(next.holder);
  }

  function finish(result: { error: string | null }) {
    if (result?.error) setError(result.error);
    else {
      router.refresh();
      onClose();
    }
  }

  return (
    <ModalShell title={car ? "Edit rental" : "Add rental"} onClose={onClose} className="sm:max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            finish(
              await saveTravelCar({
                id: car?.id ?? null,
                ...trip,
                kind: "rental",
                company, bookingCode, reservedOn,
                pickupOn, pickupTime, pickupPlace, returnOn, returnTime, returnPlace,
                accountId, cardLabel, holder, cost, costEur, pocketCost, pointsUsed, points, pointsValue, remarks,
              }),
            );
          });
        }}
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        {kindSwitch}
        <TripPicker trips={trips} value={trip} onChange={setTrip} />
        {car?.cancelledAt ? (
          <p className="rounded-md bg-black/5 px-3 py-2 text-xs font-semibold text-muted dark:bg-white/10">
            Cancelled booking — kept on record, left out of every total.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Rental company" className="col-span-2 sm:col-span-1">
            <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Booking code">
            <input value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} autoComplete="off" className={`${inputClass} uppercase`} />
          </Field>
          <Field label="Booking made">
            <input type="date" value={reservedOn} onChange={(e) => setReservedOn(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Section title="Pick-up and return">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-background/60 p-2.5 ring-1 ring-line sm:grid-cols-[9.5rem_7rem_1fr]">
              <Field label="Pick-up date">
                <input type="date" value={pickupOn} onChange={(e) => setPickupOn(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Time">
                <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Pick-up place" className="col-span-2 sm:col-span-1">
                <input value={pickupPlace} onChange={(e) => setPickupPlace(e.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-background/60 p-2.5 ring-1 ring-line sm:grid-cols-[9.5rem_7rem_1fr]">
              <Field label="Return date">
                <input type="date" value={returnOn} onChange={(e) => setReturnOn(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Time">
                <input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Return place" className="col-span-2 sm:col-span-1">
                <input value={returnPlace} onChange={(e) => setReturnPlace(e.target.value)} className={inputClass} />
              </Field>
            </div>
            {days != null ? (
              <p className="text-[11px] text-muted">
                {days} day{days === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        </Section>

        <Section
          title="Payment"
          action={
            <CurrencyConverter
              onUse={(cents, from) => {
                setCost(centsToDisplay(cents));
                if (from.currency === "EUR") setCostEur(centsToDisplay(from.amountCents));
              }}
            />
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Card used">
              <select value={accountId} onChange={(e) => pickCard(e.target.value)} className={inputClass}>
                <option value="">Not linked to a card</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {card ? (
                <span className="mt-1 block text-[10px] font-semibold" style={{ color: "var(--viz-savings)" }}>
                  {card.currentPoints.toLocaleString()} pts
                </span>
              ) : null}
            </Field>
            <Field label="Card used (if not linked)">
              <input value={cardLabel} onChange={(e) => setCardLabel(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Card owner">
              <input value={holder} onChange={(e) => setHolder(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label={`Rental cost (${currencySymbol(currency)})`}>
              <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Rental cost (€)">
              <input value={costEur} onChange={(e) => setCostEur(e.target.value)} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label={pointsUsed ? "Points used" : "Pts if used"}>
              <input type="number" min="0" step="1" value={points} onChange={(e) => setPoints(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Value per pt">
              <input
                value={pointsValue}
                onChange={(e) => setPointsValue(e.target.value)}
                placeholder={impliedMicros ? rateDisplay(impliedMicros) : ""}
                inputMode="decimal"
                className={inputClass}
              />
              {impliedMicros ? (
                <span className="mt-0.5 block text-[10px] font-medium text-muted">
                  <span style={{ color: "var(--viz-savings)" }}>{(impliedMicros / 10_000).toFixed(2)}¢/pt</span> ={" "}
                  {formatMoney(costCents, currency)} ÷ {pointsTyped.toLocaleString()} pts
                </span>
              ) : null}
            </Field>
            <Field label={`Pocket cost (${currencySymbol(currency)})`}>
              <input
                value={pocketCost}
                onChange={(e) => setPocketCost(e.target.value)}
                placeholder={centsToDisplay(pocketCents)}
                inputMode="decimal"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3 sm:flex-nowrap">
            <label className="flex shrink-0 items-center gap-2 text-xs font-semibold leading-tight">
              <input
                type="checkbox"
                checked={pointsUsed}
                onChange={(e) => setPointsUsed(e.target.checked)}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              <span>
                Paid with
                <br />
                points
              </span>
            </label>
            <Field label="Remarks" className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </Section>

        {error ? <p className="rounded-md bg-negative/10 px-3 py-2 text-sm font-medium text-negative">{error}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            Pocket cost <span className="font-bold tabular-nums text-foreground">{formatMoney(pocketCents, currency)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {car ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => finish(await setTravelCarCancelled(car.id, !car.cancelledAt)))}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                {car.cancelledAt ? "Restore booking" : "Cancel booking"}
              </button>
            ) : null}
            {car ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => finish(await deleteTravelCar(car.id)))}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/10"
              >
                Delete
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : car ? "Save rental" : "Add rental"}
            </button>
          </div>
        </div>
        {draw !== 0 ? (
          <p className="text-[11px] text-muted">
            Saving {draw < 0 ? "returns" : "takes"} {Math.abs(draw).toLocaleString()} pts {draw < 0 ? "to" : "from"} {card?.name} on Accounts.
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}

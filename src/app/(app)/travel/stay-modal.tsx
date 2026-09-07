"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { deleteTravelStay, saveTravelStay, setTravelStayCancelled } from "./actions";
import { BrandPicker } from "./brand-picker";
import type { TravelBrand, TravelCard, TravelStay } from "./types";

const NO_CARD = "";

export function StayModal({
  stay,
  cards,
  brands,
  currency,
  defaultAccountId,
  onClose,
}: {
  stay: TravelStay | null;
  cards: TravelCard[];
  brands: TravelBrand[];
  currency: string;
  // Opened from a card's own panel on Accounts, the card is already known —
  // it starts selected, with the same fill-in a manual pick would do.
  defaultAccountId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(stay?.accountId ?? defaultAccountId ?? NO_CARD);
  const preset = defaultAccountId ? cards.find((c) => c.id === defaultAccountId) ?? null : null;
  const [holder, setHolder] = useState(stay?.holder ?? (stay ? "" : preset?.holder ?? ""));
  const [brand, setBrand] = useState(stay?.brand ?? "");
  const [points, setPoints] = useState(stay?.pointsCost ? String(stay.pointsCost) : "");
  const [pointsValue, setPointsValue] = useState(() => {
    if (stay?.pointsValueMicros) return String(stay.pointsValueMicros / 1_000_000);
    if (!stay && preset?.pointsValueMicros) return String(preset.pointsValueMicros / 1_000_000);
    return "";
  });
  // A zero reads as a real number you have to clear before typing, so an
  // unset amount stays blank and only a saved non-zero value is filled in.
  const money = (cents: number | undefined) => (cents ? centsToDisplay(cents) : "");
  const [hotelCredit, setHotelCredit] = useState(money(stay?.hotelCreditCents));
  // Live totals so the saving is visible while typing, not only after saving.
  const [hotelCost, setHotelCost] = useState(money(stay?.hotelCostCents));
  const [pocketCost, setPocketCost] = useState(money(stay?.pocketCostCents));

  const card = cards.find((c) => c.id === accountId) ?? null;

  // Picking a card fills in what the card already knows — its owner and its
  // cents-per-point valuation — so the same stay isn't typed twice. Fields you
  // have already filled in are left alone.
  function pickCard(nextId: string) {
    setAccountId(nextId);
    const next = cards.find((c) => c.id === nextId) ?? null;
    if (!next) return;
    if (!holder.trim() && next.holder) setHolder(next.holder);
    if (!pointsValue.trim() && next.pointsValueMicros) {
      setPointsValue(String(next.pointsValueMicros / 1_000_000));
    }
  }
  const pointsTyped = Number(points) || 0;
  const overAllotment =
    card?.freeNightPointsLimit && pointsTyped > card.freeNightPointsLimit
      ? pointsTyped - card.freeNightPointsLimit
      : 0;
  // What saving will move on the linked card: the difference between what the
  // stay already draws and what the form now says. Negative = comes off the
  // card, positive = handed back.
  const creditTyped = Math.round((Number(hotelCredit.replace(/[$,\s]/g, "")) || 0) * 100);
  const alreadyDrawn = stay && !stay.cancelledAt && stay.accountId === accountId
    ? { points: stay.pointsCost, credit: stay.hotelCreditCents }
    : { points: 0, credit: 0 };
  const draw = card
    ? { points: pointsTyped - alreadyDrawn.points, credit: creditTyped - alreadyDrawn.credit }
    : null;

  const saved =
    Math.round((Number(hotelCost.replace(/[$,\s]/g, "")) || 0) * 100) -
    Math.round((Number(pocketCost.replace(/[$,\s]/g, "")) || 0) * 100);

  return (
    <ModalShell title={stay ? "Edit stay" : "Add stay"} onClose={onClose}>
      <form
        action={(formData) => start(async () => {
          setError(null);
          const result = await saveTravelStay(formData);
          if (result?.error) setError(result.error);
          else {
            // revalidatePath alone leaves the client router cache in place,
            // so the new row wouldn't appear until a manual reload.
            router.refresh();
            onClose();
          }
        })}
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        {stay ? <input type="hidden" name="id" value={stay.id} /> : null}
        {stay?.cancelledAt ? (
          <p className="sm:col-span-2 rounded-md bg-black/5 px-3 py-2 text-xs font-semibold text-muted dark:bg-white/10">
            Cancelled booking — kept in the archive, left out of every total.
          </p>
        ) : null}

        <Field label="Hotel / Apartment Name">
          <input
            name="propertyName"
            defaultValue={stay?.propertyName ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="City, State/Country">
          <input name="city" defaultValue={stay?.city ?? ""} className={inputClass} />
        </Field>

        <Field label="Reservation made">
          <input type="date" name="reservedOn" defaultValue={stay?.reservedOn ?? ""} className={inputClass} />
        </Field>
        <Field label="Check-in date">
          <input type="date" name="checkIn" defaultValue={stay?.checkIn ?? ""} className={inputClass} />
        </Field>

        <Field label="Nights">
          <input type="number" name="nights" min="1" step="1" defaultValue={stay?.nights ?? 1} className={inputClass} />
        </Field>
        <Field label="Total pax">
          <input type="number" name="pax" min="1" step="1" defaultValue={stay?.pax ?? ""} className={inputClass} />
        </Field>

        <Field label="Booked thru / Brand">
          <BrandPicker brands={brands} value={brand} onChange={setBrand} />
        </Field>
        {/* What the card has left is spelled out in the strip below. */}
        <Field label="Card used">
          <select
            name="accountId"
            value={accountId}
            onChange={(e) => pickCard(e.target.value)}
            className={inputClass}
          >
            <option value={NO_CARD}>Not linked to a card</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {/* What this card still has to spend, the moment you pick it. */}
          {card ? (
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-semibold">
              <span style={{ color: "var(--viz-savings)" }}>
                {card.currentPoints.toLocaleString()} pts
              </span>
              {card.freeNightCreditCents ? (
                <span style={{ color: "var(--viz-bills)" }}>
                  {formatMoney(card.freeNightCreditCents, currency)} night credit
                </span>
              ) : null}
              {card.freeNightPointsLimit ? (
                <span className="text-muted">
                  {card.freeNightPointsLimit.toLocaleString()} pt free-night cap
                </span>
              ) : null}
            </span>
          ) : null}
        </Field>
        <Field label="Card name (if not linked)">
          <input name="cardLabel" defaultValue={stay?.cardLabel ?? ""} className={inputClass} />
        </Field>
        <Field label="Card owner">
          <input
            name="holder"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Points cost">
          <input
            type="number"
            name="pointsCost"
            min="0"
            step="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className={inputClass}
          />
          {/* Whether the night fits inside the card's yearly certificate. */}
          {overAllotment > 0 ? (
            <span className="mt-0.5 block text-[10px] font-medium text-negative">
              {overAllotment.toLocaleString()} pts over the{" "}
              {card?.freeNightPointsLimit?.toLocaleString()} allotted — you pay the difference
            </span>
          ) : null}
        </Field>
        <Field label="Value per point">
          <input
            name="pointsValue"
            value={pointsValue}
            onChange={(e) => setPointsValue(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label={`Hotel cost (${currencySymbol(currency)})`}>
          <input
            name="hotelCost"
            value={hotelCost}
            onChange={(e) => setHotelCost(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>
        <Field label={`Pocket cost (${currencySymbol(currency)})`}>
          <input
            name="pocketCost"
            value={pocketCost}
            onChange={(e) => setPocketCost(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>

        <Field label={`Hotel credit used (${currencySymbol(currency)})`}>
          <input
            name="hotelCredit"
            value={hotelCredit}
            onChange={(e) => setHotelCredit(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>

        <Field label="Remarks" className="sm:col-span-2">
          <input name="remarks" defaultValue={stay?.remarks ?? ""} className={inputClass} />
        </Field>

        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            Saved on this stay{" "}
            <span className="font-bold tabular-nums text-positive">{formatMoney(saved, currency)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* A booking that falls through is cancelled, not deleted: it keeps
                its place in the archive and drops out of every total. */}
            {stay ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => {
                  const result = await setTravelStayCancelled(stay.id, !stay.cancelledAt);
                  if (result?.error) setError(result.error);
                  else {
                    router.refresh();
                    onClose();
                  }
                })}
                className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                {stay.cancelledAt ? "Restore booking" : "Cancel booking"}
              </button>
            ) : null}
            {stay ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => {
                  const fd = new FormData();
                  fd.set("id", stay.id);
                  const result = await deleteTravelStay(fd);
                  if (result?.error) setError(result.error);
                  else {
                    router.refresh();
                    onClose();
                  }
                })}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-negative transition hover:bg-negative/10"
              >
                Delete
              </button>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
            >
              {pending ? "Saving…" : stay ? "Save stay" : "Add stay"}
            </button>
          </div>
        </div>
        {error ? <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p> : null}
        {draw && (draw.points !== 0 || draw.credit !== 0) ? (
          <p className="sm:col-span-2 text-[11px] text-muted">
            Saving {draw.points < 0 || draw.credit < 0 ? "returns" : "takes"}{" "}
            {[
              draw.points ? `${Math.abs(draw.points).toLocaleString()} pts` : null,
              draw.credit ? `${formatMoney(Math.abs(draw.credit), currency)} night credit` : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            {draw.points < 0 || draw.credit < 0 ? "to" : "from"} {card?.name} on Accounts.
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}

const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

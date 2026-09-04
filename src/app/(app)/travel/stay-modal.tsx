"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { centsToDisplay, currencySymbol, formatMoney } from "@/lib/money";
import { deleteTravelStay, saveTravelStay } from "./actions";
import { POCKET_PAID_LABELS, type PocketPaidWith, type TravelCard, type TravelStay } from "./types";

const NO_CARD = "";

export function StayModal({
  stay,
  cards,
  currency,
  onClose,
}: {
  stay: TravelStay | null;
  cards: TravelCard[];
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(stay?.accountId ?? NO_CARD);
  const [holder, setHolder] = useState(stay?.holder ?? "");
  const [points, setPoints] = useState(stay?.pointsCost ? String(stay.pointsCost) : "");
  const [pointsValue, setPointsValue] = useState(
    stay?.pointsValueMicros ? String(stay.pointsValueMicros / 1_000_000) : "",
  );
  const [hotelCredit, setHotelCredit] = useState(centsToDisplay(stay?.hotelCreditCents ?? 0));
  // Live totals so the saving is visible while typing, not only after saving.
  const [hotelCost, setHotelCost] = useState(centsToDisplay(stay?.hotelCostCents ?? 0));
  const [pocketCost, setPocketCost] = useState(centsToDisplay(stay?.pocketCostCents ?? 0));

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
  // The points on an existing stay have already been taken off the card's
  // balance. Reversing a redemption is not this form's job, so the points and
  // the card are read-only once saved.
  const pointsLocked = Boolean(stay?.rewardActivityId);
  const creditAvailable = card?.freeNightCreditCents ?? 0;
  const pointsTyped = Number(points) || 0;
  const overAllotment =
    card?.freeNightPointsLimit && pointsTyped > card.freeNightPointsLimit
      ? pointsTyped - card.freeNightPointsLimit
      : 0;
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

        <Field label="Hotel / apartment" className="sm:col-span-2">
          <input
            name="propertyName"
            defaultValue={stay?.propertyName ?? ""}
            placeholder="Hilton Frankfurt Gravenbruch"
            className={inputClass}
          />
        </Field>

        <Field label="Check-in date">
          <input type="date" name="checkIn" defaultValue={stay?.checkIn ?? ""} className={inputClass} />
        </Field>
        <Field label="Reservation made">
          <input type="date" name="reservedOn" defaultValue={stay?.reservedOn ?? ""} className={inputClass} />
        </Field>

        <Field label="Nights">
          <input type="number" name="nights" min="1" step="1" defaultValue={stay?.nights ?? 1} className={inputClass} />
        </Field>
        <Field label="Guests">
          <input type="number" name="pax" min="1" step="1" defaultValue={stay?.pax ?? ""} placeholder="5" className={inputClass} />
        </Field>

        <Field label="City">
          <input name="city" defaultValue={stay?.city ?? ""} placeholder="Frankfurt, GM" className={inputClass} />
        </Field>
        <Field label="Brand">
          <input name="brand" defaultValue={stay?.brand ?? ""} placeholder="Hilton" className={inputClass} />
        </Field>

        <Field label="Booked through">
          <input name="bookingChannel" defaultValue={stay?.bookingChannel ?? ""} placeholder="Booking.com / direct" className={inputClass} />
        </Field>
        <Field label="Card owner">
          <input
            name="holder"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder="Vic"
            className={inputClass}
          />
        </Field>

        <Field
          label="Card used"
          // What the card has left is spelled out in the strip below, so the
          // hint only carries the case the strip can't: a frozen redemption.
          hint={pointsLocked ? "Locked — points already deducted" : undefined}
        >
          <select
            name="accountId"
            value={accountId}
            disabled={pointsLocked}
            onChange={(e) => pickCard(e.target.value)}
            className={`${inputClass} disabled:opacity-60`}
          >
            <option value={NO_CARD}>Not linked to a card</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {pointsLocked ? <input type="hidden" name="accountId" value={stay?.accountId ?? ""} /> : null}
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
          <input name="cardLabel" defaultValue={stay?.cardLabel ?? ""} placeholder="Sapphire" className={inputClass} />
        </Field>

        <Field
          label="Points cost"
          hint={pointsLocked ? "Locked after saving" : accountId ? "Comes off this card's balance" : "No card linked — nothing is deducted"}
        >
          <input
            type="number"
            name="pointsCost"
            min="0"
            step="1"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            disabled={pointsLocked}
            placeholder="35000"
            className={`${inputClass} disabled:opacity-60`}
          />
          {/* Whether the night fits inside the card's yearly certificate. */}
          {overAllotment > 0 ? (
            <span className="mt-0.5 block text-[10px] font-medium text-negative">
              {overAllotment.toLocaleString()} pts over the{" "}
              {card?.freeNightPointsLimit?.toLocaleString()} allotted — you pay the difference
            </span>
          ) : null}
        </Field>
        <Field label="Value per point" hint="Dollars, e.g. 0.006">
          <input
            name="pointsValue"
            value={pointsValue}
            onChange={(e) => setPointsValue(e.target.value)}
            placeholder="0.006"
            className={inputClass}
          />
        </Field>

        <Field label={`Cash rate (${currencySymbol(currency)})`} hint="What the room would have cost">
          <input
            name="hotelCost"
            value={hotelCost}
            onChange={(e) => setHotelCost(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>
        <Field label={`Out of pocket (${currencySymbol(currency)})`} hint="What actually left the wallet">
          <input
            name="pocketCost"
            value={pocketCost}
            onChange={(e) => setPocketCost(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </Field>

        <Field label="Out of pocket paid with">
          <select name="pocketPaidWith" defaultValue={stay?.pocketPaidWith ?? "cash"} className={inputClass}>
            {(Object.keys(POCKET_PAID_LABELS) as PocketPaidWith[]).map((k) => (
              <option key={k} value={k}>{POCKET_PAID_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        <Field
          label={`Hotel credit used (${currencySymbol(currency)})`}
          hint={
            pointsLocked
              ? "Locked after saving"
              : card
                ? creditAvailable > 0
                  ? `${formatMoney(creditAvailable, currency)} available — comes off this card`
                  : "This card has no night credit left"
                : undefined
          }
        >
          <input
            name={pointsLocked ? "hotelCreditLocked" : "hotelCredit"}
            value={hotelCredit}
            onChange={(e) => setHotelCredit(e.target.value)}
            disabled={pointsLocked}
            inputMode="decimal"
            className={`${inputClass} disabled:opacity-60`}
          />
          {/* Disabled inputs don't post, and the update path writes this column
              on every save — without this the stored credit would blank out. */}
          {pointsLocked ? (
            <input type="hidden" name="hotelCredit" value={centsToDisplay(stay?.hotelCreditCents ?? 0)} />
          ) : null}
        </Field>

        <Field label="Remarks" className="sm:col-span-2">
          <input name="remarks" defaultValue={stay?.remarks ?? ""} placeholder="5 x pax / breakfast / $200 credit" className={inputClass} />
        </Field>

        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            Saved on this stay{" "}
            <span className="font-bold tabular-nums text-positive">{formatMoney(saved, currency)}</span>
          </p>
          <div className="flex items-center gap-2">
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
        {stay?.rewardActivityId ? (
          <p className="sm:col-span-2 text-[11px] text-muted">
            Deleting this stay leaves the points redemption on the card&apos;s rewards ledger — the points were really spent.
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
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-[10px] text-muted">{hint}</span> : null}
    </label>
  );
}

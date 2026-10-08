"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CurrencyConverter } from "@/components/currency-converter";
import { centsToDisplay, displayToCents, moneyExpressionToCents } from "@/lib/money";
import { shareOut } from "@/lib/share-out";
import { BookingPaymentPanel, type PaxRow } from "./booking-payment-panel";
import { Fragment } from "react";
import { CATEGORY_KINDS, type CategoryKind } from "@/lib/categories";
import { addTransaction, addSplitTransaction, replaceWithSplit, updateTransaction, deleteTransaction, deletePayee, toggleCleared } from "./actions";
import { refreshTripTagging, useTripTagging } from "./trip-tagging-cache";
import type { AccountOption, BucketsByAccount, PayeeLineItem, PayeeOption, SubOption, TxData } from "./types";
import { EXPENSE_CATEGORIES } from "../travel/types";

// Button label (short), plus tab labels.
const KIND_SHORT: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bill",
  expenses: "Expense",
  debt: "Payment",
};
const KIND_TAB: Record<CategoryKind, string> = {
  income: "Income",
  savings: "Savings",
  bills: "Bills",
  expenses: "Expenses",
  debt: "Debt",
};
const PAYEE_PLACEHOLDER: Record<CategoryKind, string> = {
  income: "Payee",
  savings: "Payee",
  bills: "Payee",
  expenses: "Payee",
  debt: "Payee",
};

const HEADER_TINT: Record<CategoryKind, string> = {
  income: "bg-surface",
  savings: "bg-surface",
  bills: "bg-surface",
  expenses: "bg-surface",
  debt: "bg-surface",
};
const BTN_COLOR: Record<CategoryKind, string> = {
  income: "bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-800/70 dark:hover:bg-emerald-700",
  savings: "bg-sky-600 hover:bg-sky-700",
  bills: "bg-slate-700 hover:bg-slate-800 dark:bg-neutral-500 dark:hover:bg-neutral-400",
  expenses: "bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/50 dark:hover:bg-rose-900/70",
  debt: "bg-rose-600 hover:bg-rose-700",
};
const BTN_TEXT: Record<CategoryKind, string> = {
  income: "text-foreground",
  savings: "text-white",
  bills: "text-white",
  expenses: "text-foreground dark:text-foreground",
  debt: "text-white",
};
const TAB_ACTIVE_TEXT: Record<CategoryKind, string> = {
  income: "bg-emerald-200 text-foreground dark:bg-emerald-800/70 dark:text-foreground",
  savings: "bg-surface text-sky-600 dark:text-sky-400",
  bills: "bg-surface text-teal-600 dark:text-teal-400",
  expenses: "bg-rose-100 text-foreground dark:bg-rose-900/50 dark:text-foreground",
  debt: "bg-surface text-rose-600 dark:text-rose-400",
};

type SplitEntry = { subId: string; amountCents: number };

type TransactionModalProps = Omit<Parameters<typeof TransactionModalForm>[0], "onAddRefund">;

/**
 * The add / edit transaction form. "+ Add refund" on a saved purchase swaps
 * it for a fresh form: a refund of the same item, account and payee, dated
 * today and for the full amount (either can be changed before saving).
 */
export function TransactionModal(props: TransactionModalProps) {
  const [refundOf, setRefundOf] = useState<TxData | null>(null);
  if (refundOf) {
    return (
      <TransactionModalForm
        key={`refund-${refundOf.id}`}
        {...props}
        editTx={null}
        initialKind={refundOf.kind ?? undefined}
        initialSubId={refundOf.subId ?? undefined}
        initialAccountId={refundOf.accountId ?? undefined}
        initialAmountCents={Math.abs(refundOf.amountCents)}
        initialPayee={refundOf.payee ?? undefined}
        initialMemo={refundOf.memo ?? undefined}
        initialDate={new Date().toISOString().slice(0, 10)}
        initialIsWithdrawal={false}
        initialIsRefund
        restrictToInitialKind={false}
      />
    );
  }
  return <TransactionModalForm {...props} onAddRefund={setRefundOf} />;
}

function TransactionModalForm({
  editTx,
  monthKey,
  firstOfMonth,
  subOptions,
  accountOptions,
  bucketsByAccount = {},
  payeeOptions = [],
  payeeLineItems = [],
  propertyOptions = [],
  initialKind,
  initialSubId,
  initialAccountId,
  initialAmountCents,
  initialPayee,
  initialDate,
  initialIsWithdrawal = false,
  initialIsRefund = false,
  initialMemo,
  restrictToInitialKind = false,
  onAddRefund,
  onClose,
}: {
  editTx: TxData | null;
  monthKey: string;
  firstOfMonth: string;
  subOptions: SubOption[];
  accountOptions: AccountOption[];
  bucketsByAccount?: BucketsByAccount;
  payeeOptions?: PayeeOption[];
  payeeLineItems?: PayeeLineItem[];
  // Property accounts this transaction can be tagged to. Empty for a
  // household that owns none, and then the field never renders.
  propertyOptions?: AccountOption[];
  initialKind?: CategoryKind;
  initialSubId?: string;
  initialAccountId?: string;
  initialAmountCents?: number;
  initialPayee?: string;
  initialDate?: string;
  initialIsWithdrawal?: boolean;
  initialIsRefund?: boolean;
  initialMemo?: string;
  restrictToInitialKind?: boolean;
  // Set by the wrapper below: swaps this form for a new refund of the
  // saved purchase being edited.
  onAddRefund?: (tx: TxData) => void;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  // Which footer button started the pending work, so only that one shows its
  // "…ing" label (Clear → Clearing…) instead of every button saying Saving….
  const [busy, setBusy] = useState<"save" | "clear" | "delete" | "toggle" | null>(null);
  const isEdit = editTx != null;
  const [txType, setTxType] = useState<CategoryKind>(editTx?.kind ?? initialKind ?? "expenses");
  // A refund is stored as a NEGATIVE amount on the same subcategory/account —
  // the actuals view (`sum(amount_cents)`) and ledger delta naturally undo it
  // from spending and return the money to the account. Seed from the sign of
  // the existing tx so the toggle reflects reality on edit.
  const [isRefund, setIsRefund] = useState<boolean>(
    initialIsRefund || (editTx != null && editTx.amountCents < 0),
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string>(editTx?.accountId ?? initialAccountId ?? "");
  const availableBuckets = bucketsByAccount[selectedAccountId] ?? [];
  const [selectedBucketId, setSelectedBucketId] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [convertedCents, setConvertedCents] = useState<number | null>(null);

  // Split state — add and edit share the same picker. On edit it's seeded
  // with the transaction's own item; saving with 2+ items replaces the
  // original tx with N new ones (delete + insert × N) that all share the same
  // date / account / payee / memo. Refunds are stored negative but typed
  // positive, so the seed uses the absolute amount.
  // Opening any part of a split opens the whole purchase: every part, and
  // their sum as the total.
  const editParts = editTx?.splitParts && editTx.splitParts.length > 1 ? editTx.splitParts : null;
  const isSplitEdit = editParts != null;
  const [totalCents, setTotalCents] = useState(
    editParts
      ? editParts.reduce((sum, p) => sum + Math.abs(p.amountCents), 0)
      : editTx ? Math.abs(editTx.amountCents) : initialAmountCents ?? 0,
  );
  const [splits, setSplits] = useState<SplitEntry[]>(() => {
    if (editParts) return editParts.map((p) => ({ subId: p.subId, amountCents: Math.abs(p.amountCents) }));
    const seedSubId = editTx ? editTx.subId : initialSubId;
    return seedSubId
      ? [{ subId: seedSubId, amountCents: editTx ? Math.abs(editTx.amountCents) : initialAmountCents ?? 0 }]
      : [];
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  // Why the save button wouldn't fire. The footer button used to be silently
  // disabled until a budget item was picked, which read as a broken button.
  // It now stays clickable and submitting with something missing lists the
  // reason(s) here, right above the button, and rings the offending field.
  const [errors, setErrors] = useState<string[]>([]);
  const [errorFields, setErrorFields] = useState<Set<string>>(new Set());
  const [errorSplitIds, setErrorSplitIds] = useState<Set<string>>(new Set());
  // Saved, but the booking it pays for couldn't take all of it (usually the
  // card is short on points). The payment stays; the modal stays open to say
  // so, with Done in place of Save so it can't be added twice.
  const [savedWarning, setSavedWarning] = useState<string | null>(null);
  function clearErrors() {
    setErrors([]);
    setErrorFields(new Set());
    setErrorSplitIds(new Set());
  }

  const splitTotal = splits.reduce((s, sp) => s + sp.amountCents, 0);
  const leftToSplit = totalCents - splitTotal;

  // When exactly one item is selected, auto-fill it with the full total so the
  // user doesn't have to re-enter it after changing the amount or removing splits.
  useEffect(() => {
    if (splits.length !== 1) return;
    if (splits[0].amountCents === totalCents) return;
    // Keep the single selected item synchronized with the entered total.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSplits([{ subId: splits[0].subId, amountCents: totalCents }]);
  }, [splits, totalCents]);

  function handlePayeeMatch(item: PayeeLineItem) {
    if (item.subcategoryId) {
      const kind = subOptions.find((s) => s.id === item.subcategoryId)?.kind;
      if (kind) setTxType(kind);
      setSplits([{ subId: item.subcategoryId, amountCents: item.amountCents ?? totalCents }]);
    }
    if (item.amountCents != null && amountRef.current) {
      amountRef.current.value = centsToDisplay(item.amountCents);
      setTotalCents(item.amountCents);
    }
  }

  // A saved payee's usual budget item and account (see listPayees) fill those
  // fields when the payee is picked — but only into an empty field, or over a
  // value a previous payee filled, so they never replace one chosen by hand. A
  // payee with no usual value (null) takes back what the last payee filled.
  // A Subscription/Irregular match (handlePayeeMatch) sets the item itself,
  // so then only the account comes from here.
  function handleUsualPicks(payee: PayeeOption | null, itemMatched: boolean) {
    if (!itemMatched) handleUsualItem(payee?.usualSubId ?? null);
    handleUsualAccount(payee?.usualAccountId ?? null);
  }
  const autoFilledAccountId = useRef<string | null>(null);
  function handleUsualAccount(accountId: string | null) {
    if (selectedAccountId && selectedAccountId !== autoFilledAccountId.current) return;
    const next = accountId && accountOptions.some((a) => a.id === accountId) ? accountId : "";
    autoFilledAccountId.current = next || null;
    if (next === selectedAccountId) return;
    setSelectedAccountId(next);
    setSelectedBucketId("");
    if (next) clearErrors();
  }
  const autoFilledSubId = useRef<string | null>(null);
  function handleUsualItem(subId: string | null) {
    const current = splits.length === 1 ? splits[0].subId : null;
    if (splits.length > 1 || (current && current !== autoFilledSubId.current)) return;
    const kind = subId ? subOptions.find((s) => s.id === subId)?.kind : undefined;
    if (!subId || !kind || (restrictToInitialKind && initialKind && kind !== initialKind)) {
      if (current) setSplits([]);
      autoFilledSubId.current = null;
      return;
    }
    if (current === subId) return;
    autoFilledSubId.current = subId;
    clearErrors();
    setTxType(kind);
    setSplits([{ subId, amountCents: totalCents }]);
  }

  // When txType changes, clear splits (stale subcategories no longer valid).
  // Only when the list actually changes (Income ↔ Expense) — re-tapping the
  // active Expense tab on an edit mustn't wipe the item it already has.
  function handleTypeChange(kind: CategoryKind) {
    if ((kind === "income") !== (txType === "income")) setSplits([]);
    setTxType(kind);
  }

  function handlePickerConfirm(selectedIds: string[]) {
    autoFilledSubId.current = null;
    setPickerOpen(false);
    clearErrors();
    setSplits((prev) => {
      const kept = prev.filter((sp) => selectedIds.includes(sp.subId));
      const keptIds = new Set(kept.map((sp) => sp.subId));
      const newIds = selectedIds.filter((id) => !keptIds.has(id));
      // Multiple splits: new items start at 0 so the user enters each amount
      // explicitly. Single item is filled by the effect below.
      const added = newIds.map((id) => ({ subId: id, amountCents: 0 }));
      return [...kept, ...added];
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = editTx?.date ?? initialDate ?? (today.startsWith(monthKey) ? today : firstOfMonth);
  // ---- Trip tag. A purchase on a trip is tagged to it here, once, and
  // shows on the Travel Log as that trip's Actual spending — no retyping.
  // The list is loaded when the page opens (trip-tagging-cache.ts). A new
  // transaction starts as "Not part of a trip" — the trip is only ever
  // picked by hand, never guessed from the date.
  const { trips, bookingsByTrip, spendingRowsByTrip } = useTripTagging();
  const [dateValue, setDateValue] = useState(defaultDate);
  const [tripId, setTripId] = useState(editTx?.tripId ?? "");
  // The dropdown lists trips still running this year or ahead — plus
  // whichever trip is selected, however old, so an edit never loses it.
  const thisYearStart = `${new Date().getFullYear()}-01-01`;
  const tripChoices = trips.filter(
    (t) => !t.startOn || (t.endOn ?? t.startOn) >= thisYearStart || t.id === tripId,
  );
  // What the payment is for: one of the trip's bookings (its pocket cost
  // follows this payment) or nothing in particular (day-to-day spending).
  const bookings = (tripId && bookingsByTrip[tripId]) || [];
  // Points typed beside the payment. Blank leaves the booking's own figure.
  const [bookingPoints, setBookingPoints] = useState("");
  const [bookingPointsValue, setBookingPointsValue] = useState("");
  // Stays: free night / hotel credit set on the payment ("" = the stay's own).
  const [bookingFreeNight, setBookingFreeNight] = useState<"" | "on" | "off">("");
  const [bookingCredit, setBookingCredit] = useState("");
  const [bookingRef, setBookingRef] = useState(editTx?.bookingRef ?? "");
  const bookingOk = bookings.some((b) => b.ref === bookingRef);
  // Which Travel Log column a trip purchase lands in when it's on one of the
  // two trip items: the catch-all (Traveling/Trips, own column Other) or the
  // trip food item (Restaurant Travel: Restaurants or Groceries). Every other
  // item has one fixed column, set on its item form. Each is read from its own
  // part of a split, whichever row was opened.
  const savedColumnOn = (itemColumn: string) => {
    const onItem = (subId: string | null | undefined) => subOptions.find((o) => o.id === subId && o.receivesTripPlans)?.travelCategory === itemColumn;
    const part = editParts?.find((p) => onItem(p.subId));
    return part ? part.travelCategory ?? null : onItem(editTx?.subId) ? editTx?.travelCategory ?? null : null;
  };
  const [travelCategory, setTravelCategory] = useState(savedColumnOn("other") ?? "other");
  const [foodColumn, setFoodColumn] = useState(savedColumnOn("restaurants") === "groceries" ? "groceries" : "restaurants");
  // The catch-all's choices are the rows the trip's card shows — Other always,
  // as the default — plus the one already saved. A trip with no rows yet offers
  // all. Never Groceries: trip groceries are trip food (Restaurant Travel).
  const CATCH_ALL_COLUMNS = ["other", "entertainment", "transport", "fuel_tolls", "parking", "cash"] as const;
  const tripRows = (tripId && spendingRowsByTrip[tripId]) || [];
  const columnChoices = tripRows.length
    ? CATCH_ALL_COLUMNS.filter((key) => key === "other" || key === travelCategory || tripRows.includes(key))
    : CATCH_ALL_COLUMNS;
  const paidBooking = bookings.find((b) => b.ref === bookingRef) ?? null;
  // A flight payment split per passenger — each share is that passenger's
  // Spent on the Travel Log, in dollars and the flight's other currency, as on
  // its popup. It starts as this payment's own saved split (on an edit) or the
  // passengers' planned fares, scaled to the amount; a figure typed by hand is
  // kept until the booking changes, and the amount follows the dollars typed.
  const flightPax = paidBooking?.ref.startsWith("flight:") ? paidBooking.passengers : [];
  const ownShares = editTx ? paidBooking?.payments.find((p) => p.txId === editTx.id)?.shares ?? null : null;
  const [paxCents, setPaxCents] = useState<Record<string, string> | null>(null);
  const [paxForeign, setPaxForeign] = useState<Record<string, string> | null>(null);
  const [paxPoints, setPaxPoints] = useState<Record<string, string> | null>(null);
  const [paxCurrency, setPaxCurrency] = useState<string | null>(null);
  const flightCurrency = paxCurrency ?? (paidBooking?.foreignCurrency || "EUR");
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const ownShare = (name: string) => ownShares?.find((s) => sameName(s.name, name));
  const defaultShares = shareOut(
    totalCents,
    flightPax.map((p) => (ownShares ? ownShare(p.name)?.cents ?? 0 : p.plannedCents)),
  );
  const paxRows: PaxRow[] = flightPax.map((p, i) => ({
    name: p.name,
    cents: paxCents?.[p.name] ?? (defaultShares[i] ? centsToDisplay(defaultShares[i]) : ""),
    foreign: paxForeign?.[p.name] ?? (ownShare(p.name)?.foreignCents ? centsToDisplay(ownShare(p.name)!.foreignCents!) : ""),
    points: paxPoints?.[p.name] ?? (p.points ? String(p.points) : ""),
  }));
  const paxSplitCents = paxRows.reduce((sum, r) => sum + Math.max(0, displayToCents(r.cents)), 0);
  function pickBooking(ref: string) {
    setBookingRef(ref);
    setPaxCents(null);
    setPaxForeign(null);
    setPaxPoints(null);
    setPaxCurrency(null);
    setBookingPoints("");
    setBookingPointsValue("");
    setBookingFreeNight("");
    setBookingCredit("");
  }
  function editPaxRow(name: string, patch: Partial<Omit<PaxRow, "name">>) {
    clearErrors();
    const pick = (key: "cents" | "foreign" | "points") =>
      Object.fromEntries(paxRows.map((r) => [r.name, r.name === name && patch[key] !== undefined ? patch[key]! : r[key]]));
    if (patch.foreign !== undefined) setPaxForeign(pick("foreign"));
    if (patch.points !== undefined) setPaxPoints(pick("points"));
    if (patch.cents !== undefined) {
      const next = pick("cents");
      setPaxCents(next);
      // The amount is what the passengers' dollars add up to.
      const sum = Object.values(next).reduce((s, v) => s + Math.max(0, displayToCents(v)), 0);
      setTotalCents(sum);
      setConvertedCents(sum);
    }
  }
  // A points total typed in "Points used" is shared evenly across the seats.
  function setTotalPaxPoints(points: number) {
    const parts = shareOut(points, flightPax.map(() => 1));
    setPaxPoints(Object.fromEntries(flightPax.map((p, i) => [p.name, parts[i] ? String(parts[i]) : ""])));
  }
  // On a trip, an item with a travel twin — the trip item for its Travel Log
  // column (Restaurants and Groceries → Restaurant Travel, the trip food item)
  // — switches to that twin, so the purchase counts on the trip budget, not
  // the everyday one; Groceries keeps its column there. Taking the trip off
  // switches it back. Adjusted during render (not in an effect) so the form
  // never shows the wrong item for a frame. Same rule as the server's
  // routeTripPurchase.
  const tripItemRole = (column: string) => (column === "restaurants" || column === "groceries" ? "restaurants" : "other");
  const travelTwinOf = (subId: string) => {
    const o = subOptions.find((x) => x.id === subId);
    if (!o?.travelCategory || o.receivesTripPlans) return null;
    const role = tripItemRole(o.travelCategory);
    if (role === "other") return null;
    return subOptions.find((x) => x.id !== o.id && x.receivesTripPlans && x.travelCategory === role)?.id ?? null;
  };
  // Items with a Travel Log column but no twin (Groceries, Fuel,
  // Entertainment…) are saved on the catch-all trip item instead, keeping
  // their column — the server does the move per split; this only names it.
  const tripCatchAll = subOptions.find((x) => x.receivesTripPlans && x.travelCategory === "other") ?? null;
  const movedToCatchAll = tripId && !bookingOk && tripCatchAll
    ? splits
        .map((sp) => subOptions.find((o) => o.id === sp.subId))
        .filter((o): o is SubOption => Boolean(o?.travelCategory && !o.receivesTripPlans && !travelTwinOf(o.id)))
    : [];
  // twin id → the item it replaced, for switching back.
  const [swappedFrom, setSwappedFrom] = useState<Record<string, string>>({});
  if (tripId) {
    const next = splits.map((sp) => {
      const twin = travelTwinOf(sp.subId);
      return twin && !splits.some((o) => o.subId === twin) ? { ...sp, subId: twin } : sp;
    });
    if (next.some((sp, i) => sp.subId !== splits[i].subId)) {
      const record = { ...swappedFrom };
      next.forEach((sp, i) => {
        if (sp.subId !== splits[i].subId) {
          record[sp.subId] = splits[i].subId;
          // Groceries moved onto the food item keeps its Groceries column.
          const from = subOptions.find((o) => o.id === splits[i].subId)?.travelCategory;
          if (from === "groceries" || from === "restaurants") setFoodColumn(from);
        }
      });
      setSplits(next);
      setSwappedFrom(record);
    }
  } else if (Object.keys(swappedFrom).length > 0) {
    setSplits(
      splits.map((sp) => {
        const original = swappedFrom[sp.subId];
        return original && !splits.some((o) => o.subId === original) ? { ...sp, subId: original } : sp;
      }),
    );
    setSwappedFrom({});
  }
  const swapNote = Object.entries(swappedFrom)
    .filter(([twin]) => splits.some((sp) => sp.subId === twin))
    .map(([twin, original]) => `${subOptions.find((o) => o.id === original)?.name} → ${subOptions.find((o) => o.id === twin)?.name}`)
    .join(", ");
  // Both add and edit share the two-tab UI now, so "Income" narrows to income
  // subs and "Expense" opens to any spend kind (savings/bills/expenses/debt).
  // A locked initial kind (Budget's Debt/Savings row context) still filters
  // to exactly that kind so a payment posted from a debt row can't drift.
  const SPEND_KINDS = new Set<CategoryKind>(["savings", "bills", "expenses", "debt"]);
  const options =
    restrictToInitialKind && initialKind
      ? subOptions.filter((s) => s.kind === initialKind)
      : subOptions.filter((s) =>
          txType === "income" ? s.kind === "income" : SPEND_KINDS.has(s.kind),
        );

  const allowedGroups = txType === "income" ? new Set(["Banking"]) : new Set(["Banking", "Credit Cards"]);
  const filteredAccounts = accountOptions.filter((a) => allowedGroups.has(a.group ?? "Other"));
  const accountGroups: string[] = [];
  const accountByGroup = new Map<string, typeof accountOptions>();
  for (const a of filteredAccounts) {
    const g = a.group ?? "Other";
    if (!accountByGroup.has(g)) { accountGroups.push(g); accountByGroup.set(g, []); }
    accountByGroup.get(g)!.push(a);
  }
  accountGroups.sort((a, b) => {
    if (a === "Credit Cards") return -1;
    if (b === "Credit Cards") return 1;
    return 0;
  });

  // Client-side gate mirroring what the server action silently drops
  // (no subcategory / no date / amount <= 0) plus the split-allocation rules.
  // Every message names the field (or the split item) that's missing, so the
  // user never has to guess which one blocked the save.
  function validate(fd: FormData): { messages: string[]; fields: Set<string>; splitIds: Set<string> } {
    const messages: string[] = [];
    const fields = new Set<string>();
    const splitIds = new Set<string>();
    if (splits.length === 0) {
      messages.push("Budget Items — pick at least one item.");
      fields.add("subcategory");
    }

    if (totalCents <= 0) {
      messages.push("Amount — enter a value greater than $0.");
      fields.add("amount");
    }

    if (!String(fd.get("date") ?? "").trim()) {
      messages.push("Date — pick a date.");
      fields.add("date");
    }

    // Account and Payee aren't enforced by the server action (it attaches
    // an account only when one is passed), but a transaction with no account
    // never reaches an account ledger — actuals move and balances don't. Both
    // are blocked here so nothing saves half-filled. Bucket and Note stay
    // optional; they're labelled as such.
    if (!selectedAccountId.trim()) {
      messages.push("Account — pick an account.");
      fields.add("account");
    }

    if (!String(fd.get("payee") ?? "").trim()) {
      messages.push("Payee — enter a name.");
      fields.add("payee");
    }

    // A flight payment's passenger split has to add up to the payment.
    if (bookingOk && flightPax.length > 0 && totalCents > 0 && paxSplitCents !== totalCents) {
      messages.push(
        `Passengers — the split adds up to $${centsToDisplay(paxSplitCents)}, not the $${centsToDisplay(totalCents)} paid.`,
      );
    }

    if (splits.length > 1) {
      const blank = splits.filter((sp) => sp.amountCents <= 0);
      for (const sp of blank) {
        splitIds.add(sp.subId);
        messages.push(
          `${options.find((o) => o.id === sp.subId)?.name ?? "Split item"} — enter an amount.`,
        );
      }
      if (blank.length === 0 && leftToSplit !== 0) {
        messages.push(
          leftToSplit > 0
            ? `Splits are $${centsToDisplay(leftToSplit)} short of the $${centsToDisplay(totalCents)} total.`
            : `Splits are $${centsToDisplay(-leftToSplit)} over the $${centsToDisplay(totalCents)} total.`,
        );
      }
    }
    return { messages, fields, splitIds };
  }

  const missingBudgetItem = errorFields.has("subcategory");
  const missingAmount = errorFields.has("amount");
  const missingAccount = errorFields.has("account");
  const missingPayee = errorFields.has("payee");
  const missingDate = errorFields.has("date");

  function handleFormAction(fd: FormData) {
    const problems = validate(fd);
    setErrors(problems.messages);
    setErrorFields(problems.fields);
    setErrorSplitIds(problems.splitIds);
    if (problems.messages.length > 0) return;
    setBusy(fd.get("cleared") === "on" ? "clear" : "save");
    start(async () => {
      // A split is saved in one server call (one transaction per item). If
      // it throws — a lookup failing on a weak connection is the realistic
      // case — say so (the server names how many parts landed) instead of
      // letting the rejection vanish behind a modal that did half the work.
      const warnings: string[] = [];
      const note = (r: { warning?: string } | void) => { if (r?.warning) warnings.push(r.warning); };
      try {
      if (isEdit) {
        // A split (or a plain transaction being split): the server replaces
        // every existing part with the parts on the form, in one call, under
        // one split id. A plain one-item save stays an update so ids and
        // audit trails don't churn.
        if (editTx && (splits.length > 1 || isSplitEdit)) {
          fd.set("splits", JSON.stringify(splits.map((sp) => ({ subcategoryId: sp.subId, amountCents: sp.amountCents }))));
          note(await replaceWithSplit(fd));
        } else {
          fd.set("subcategoryId", splits[0].subId);
          fd.set("amount", (splits[0].amountCents / 100).toFixed(2));
          note(await updateTransaction(fd));
        }
        if (warnings.length) return setSavedWarning(warnings.join(" "));
        onClose();
      } else {
        if (splits.length === 0) return;
        if (splits.length > 1) {
          // Every part in one server call, linked as one split.
          fd.set("splits", JSON.stringify(splits.map((sp) => ({ subcategoryId: sp.subId, amountCents: sp.amountCents }))));
          note(await addSplitTransaction(fd));
        } else {
          fd.set("subcategoryId", splits[0].subId);
          fd.set("amount", (splits[0].amountCents / 100).toFixed(2));
          note(await addTransaction(fd));
        }
        if (warnings.length) return setSavedWarning(warnings.join(" "));
        if (fd.get("createAnother") === "on") {
          formRef.current?.reset();
          setSplits([]);
          setTotalCents(0);
        } else {
          onClose();
        }
      }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setErrors([
          // A split that failed partway says how many parts landed.
          `Couldn't save — ${detail}`,
          "Nothing else was written. Check your connection and try again.",
        ]);
        setErrorFields(new Set());
        setErrorSplitIds(new Set());
      }
      // A payment can change a booking (its Pocket cost, Planned → Booked),
      // so the next open shows it as it is now. Only a save that touched a
      // trip can do that; refreshing after every save cost a server call.
      if (fd.get("tripId") || editTx?.tripId) void refreshTripTagging();
    });
  }

  return (
    <>
      {/* Budget item picker — full-screen overlay */}
      {pickerOpen && (
        <BudgetItemPicker
          options={options}
          selectedIds={new Set(splits.map((s) => s.subId))}
          onConfirm={handlePickerConfirm}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {accountPickerOpen && (
        <AccountPicker
          accountGroups={accountGroups}
          accountByGroup={accountByGroup}
          selectedAccountId={selectedAccountId}
          onSelect={(accountId) => {
            autoFilledAccountId.current = null;
            setSelectedAccountId(accountId);
            setSelectedBucketId("");
            setAccountPickerOpen(false);
            clearErrors();
          }}
          onClose={() => setAccountPickerOpen(false)}
        />
      )}

      {/* The sheet is pinned to the top of a phone screen, so the notch and
          status bar sit over its first row — the Income/Expense toggle began
          22px down. The inset lives on this outer, non-scrolling box so it
          can't scroll away with the fields; the desktop dialog is centred and
          needs none of it. */}
      <div className="flex max-h-[92dvh] min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface pt-[max(env(safe-area-inset-top),1.75rem)] shadow-sm ring-1 ring-black/5 sm:h-auto sm:max-h-[85vh] sm:flex-none sm:rounded-2xl sm:pt-0 dark:ring-white/10">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {/* Tabs: same simple two-way (Income / Expense) in both add and edit.
              Picking a subcategory in the dropdown below is what pins the true
              kind (savings / bills / expenses / debt) — the tabs only filter
              the picker into inflow vs outflow, so an edit reads as clean as
              an add. Only exception: a locked initial kind (debt/savings from
              the Budget row context) still shows its own tab. */}
          {initialKind === "debt" || initialKind === "savings" ? (
            <div className="flex gap-1.5 rounded-xl bg-background p-1.5 ring-1 ring-line">
              <div
                className={
                  "flex-1 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold shadow-sm ring-1 ring-line " +
                  TAB_ACTIVE_TEXT[initialKind]
                }
              >
                {KIND_TAB[initialKind]}
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5 rounded-xl bg-background p-1.5 ring-1 ring-line">
              {(["income", "expenses"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => handleTypeChange(kind)}
                  className={
                    "flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition " +
                    (txType === kind || (kind === "expenses" && txType !== "income")
                      ? "shadow-sm ring-1 ring-line " + TAB_ACTIVE_TEXT[kind]
                      : "text-muted hover:bg-foreground/8 hover:text-foreground")
                  }
                >
                  {kind === "income" ? "Income" : "Expense"}
                </button>
              ))}
            </div>
          )}

          {/* Enter inside a text field used to trigger the browser's implicit
              submission, and the form's first submit button in tree order is
              the footer's "Clear" — so a stray Enter in Payee saved the
              transaction, marked it cleared and closed the modal. Saving is a
              deliberate click on the footer button only. Fields that give
              Enter its own meaning (the amount inputs, the merchant
              autocomplete picking a highlighted row) call preventDefault in
              their own handler, which runs first and is left untouched here. */}
          <form
            id="tx-form"
            ref={formRef}
            // onSubmit, not `action=`: a form action runs inside React's own
            // transition, which held every busy label ("Clearing…",
            // "Saving…") back until the save had finished — so a 3-second
            // save looked like nothing happened. The clicked button (Clear
            // or Add) is passed as the submitter so its name/value arrive.
            onSubmit={(e) => {
              e.preventDefault();
              handleFormAction(new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter));
            }}
            // Native bubbles ("Please fill out this field") fire on the amount
            // and date inputs before our own check runs, so half the missing
            // fields were reported one way and half another. Turning the
            // browser's validation off routes every reason through the single
            // banner above the footer, which names the field.
            noValidate
            // Saved with a warning: the form is finished with, and editing
            // it again would suggest the save hadn't happened. Only the
            // message stays.
            hidden={savedWarning != null}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const el = e.target as HTMLElement;
              // Textareas need Enter for newlines; buttons need it to activate.
              if (el.tagName === "TEXTAREA" || el.tagName === "BUTTON") return;
              e.preventDefault();
            }}
            className="mt-4 space-y-4"
          >
            {isEdit ? <input type="hidden" name="id" value={editTx.id} /> : null}
            {!isEdit && initialIsWithdrawal ? <input type="hidden" name="isWithdrawal" value="on" /> : null}
            {/* Signals to the server action to negate the amount (refund) and
                skip bucket/debt side effects. The input's own value stays a
                positive amount either way — server does the sign flip. */}
            <input type="hidden" name="isRefund" value={isRefund ? "on" : ""} />

            <CurrencyConverter
              date={dateValue}
              onUse={(usdCents) => {
                setConvertedCents(usdCents);
                setTotalCents(usdCents);
              }}
            />

            {/* Amount | Payee */}
            <div className="grid grid-cols-2 items-start gap-2">
              <AmountInput
                inputRef={amountRef}
                defaultValue={
                  editTx
                    // Refunds are stored negative in the DB but always typed as
                    // positive dollars — flip the sign for display so the input
                    // reads $50 instead of −$50 while the Refund pill is on.
                    ? centsToDisplay(totalCents)
                    : initialAmountCents != null
                    ? centsToDisplay(initialAmountCents)
                    : ""
                }
                onChangeCents={(cents) => {
                  setTotalCents(cents);
                  clearErrors();
                }}
                forcedCents={convertedCents}
                invalid={missingAmount}
              />

              <PayeeField
                invalid={missingPayee}
                onDirty={clearErrors}
                placeholder={PAYEE_PLACEHOLDER[txType]}
                defaultValue={editTx?.payee ?? initialPayee ?? ""}
                payeeOptions={payeeOptions}
                payeeLineItems={payeeLineItems}
                onMatch={handlePayeeMatch}
                onUsualPicks={handleUsualPicks}
              />
            </div>

            {/* Account — full width, sits above Budget Items/Date so the name has
                the whole row and isn't cut off on mobile. */}
            <div>
              <input type="hidden" name="accountId" value={selectedAccountId} />
              {/* The app's own picker at every width, not a native <select>:
                  the list needs search and each account's owed/balance. */}
              <button
                type="button"
                onClick={() => setAccountPickerOpen(true)}
                className={
                  "flex w-full items-center justify-between gap-2 rounded-xl bg-background px-3 py-2.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-brand " +
                  (missingAccount ? "ring-2 ring-negative" : "ring-1 ring-line")
                }
              >
                <span className={`min-w-0 flex-1 truncate ${selectedAccountId ? "text-foreground" : "text-muted"}`}>
                  {selectedAccountId
                    ? accountOptions.find((account) => account.id === selectedAccountId)?.name ?? "Accounts"
                    : "Accounts"}
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {txType === "debt" ? (
                <p className="mt-1 px-1 text-[11px] text-muted">
                  Paying off a credit card? Use <span className="font-semibold">Pay Card</span> on the Accounts page.
                </p>
              ) : null}
            </div>

            {/* Budget Item(s) | Date */}
            <div className="grid grid-cols-[1fr_auto] items-start gap-2">
              {/* Budget item: the same searchable picker for add and edit. */}
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className={
                    "w-full truncate rounded-xl bg-background px-2 py-2.5 text-left text-base focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm " +
                    (missingBudgetItem ? "ring-2 ring-negative" : "ring-1 ring-line")
                  }
                >
                  {splits.length === 0
                    ? <span className="text-muted">Budget Items</span>
                    : splits.length === 1
                      ? <span>{options.find((o) => o.id === splits[0].subId)?.name ?? "1 item"}</span>
                      : <span>{splits.length} items</span>
                  }
                </button>
                {splits.length === 1 && (
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="text-left text-xs font-semibold text-brand px-1"
                  >
                    + Add Split
                  </button>
                )}
              </div>
              <input
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                onChange={(e) => {
                  setDateValue(e.target.value);
                  clearErrors();
                }}
                className={
                  "w-[9.5rem] rounded-xl bg-background px-2 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand sm:w-40 sm:px-3 sm:text-sm " +
                  (missingDate ? "ring-2 ring-negative" : "ring-1 ring-line")
                }
              />
            </div>

            {/* Edit-only: a single item tied to a savings bucket can be marked
                as money coming back out of that bucket. */}
            {isEdit && splits.length === 1 && options.find((o) => o.id === splits[0].subId)?.linkedBucketId ? (
              <label className="-mt-2 flex items-center gap-2 px-1 text-xs text-muted">
                <input
                  type="checkbox"
                  name="isWithdrawal"
                  defaultChecked={editTx?.isWithdrawal ?? false}
                  className="h-4 w-4 rounded accent-[var(--brand)]"
                />
                This is a withdrawal — money coming out of the linked bucket (e.g. using savings for a purchase)
              </label>
            ) : null}

            {/* Split rows — only shown when 2+ splits exist */}
            {splits.length > 1 && (
              <SplitRows
                splits={splits}
                options={options}
                leftToSplit={leftToSplit}
                onRemove={(subId) => setSplits((prev) => prev.filter((sp) => sp.subId !== subId))}
                invalidSubIds={errorSplitIds}
                onAmountChange={(subId, cents) => {
                  setSplits((prev) => prev.map((sp) => sp.subId === subId ? { ...sp, amountCents: cents } : sp));
                  clearErrors();
                }}
                onAddSplit={() => setPickerOpen(true)}
              />
            )}

            {/* Bucket picker */}
            {availableBuckets.length > 0 ? (
              <select
                name="bucketId"
                value={selectedBucketId}
                onChange={(e) => setSelectedBucketId(e.target.value)}
                className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
              >
                <option value="">Bucket (optional)</option>
                {availableBuckets.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            ) : null}

            {/* Property tag — only a household that owns property sees this.
                It is what joins a rental's income to its expenses, which live
                in different category groups. */}
            {propertyOptions.length > 0 ? (
              <select
                name="propertyId"
                defaultValue={editTx?.propertyId ?? ""}
                className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
              >
                <option value="">Property (optional)</option>
                {propertyOptions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : null}

            {/* Trip tag — only for spending, and only once there is a trip
                this year or ahead to tag it to. */}
            {txType !== "income" && trips.length > 0 ? (
              <div>
                <select
                  name="tripId"
                  value={tripId}
                  onChange={(e) => {
                    setTripId(e.target.value);
                    // A booking belongs to one trip; changing trips unlinks it.
                    pickBooking("");
                  }}
                  className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
                >
                  <option value="">Not part of a trip</option>
                  {tripChoices.map((t) => (
                    <option key={t.id} value={t.id}>Trip: {t.name}</option>
                  ))}
                </select>
                {tripId && bookings.length > 0 ? (
                  <select
                    name="bookingRef"
                    value={bookingOk ? bookingRef : ""}
                    onChange={(e) => pickBooking(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
                  >
                    <option value="">Pays for: day-to-day spending</option>
                    {bookings.map((b) => (
                      <option key={b.ref} value={b.ref}>
                        Pays for: {b.label}{b.isEstimate ? " (planned)" : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
                {/* What the payment does to that booking: a flight's split
                    per passenger, its points, and the same Payment figures
                    the Travel Log's popup shows. */}
                {paidBooking && bookingOk ? (
                  <>
                    <input
                      type="hidden"
                      name="bookingPassengers"
                      value={JSON.stringify(
                        paxRows.map((r) => ({
                          name: r.name,
                          cents: Math.max(0, displayToCents(r.cents)),
                          foreignCents: r.foreign.trim() ? Math.max(0, displayToCents(r.foreign)) : null,
                          points: Math.max(0, Math.trunc(Number(r.points.replace(/,/g, ""))) || 0),
                        })),
                      )}
                    />
                    <input type="hidden" name="bookingCurrency" value={flightCurrency} />
                    <input type="hidden" name="bookingPoints" value={bookingPoints} />
                    <input type="hidden" name="bookingPointsValue" value={bookingPointsValue} />
                    <input type="hidden" name="bookingFreeNight" value={bookingFreeNight} />
                    <input type="hidden" name="bookingCredit" value={bookingCredit} />
                    <BookingPaymentPanel
                      booking={paidBooking}
                      rows={paxRows}
                      onRow={editPaxRow}
                      onTotalPoints={setTotalPaxPoints}
                      onResetSplit={() => setPaxCents(null)}
                      foreignCurrency={flightCurrency}
                      date={dateValue}
                      onForeignCurrency={setPaxCurrency}
                      totalCents={totalCents}
                      isRefund={isRefund}
                      editTxId={editTx?.id ?? null}
                      accountId={selectedAccountId}
                      accountOptions={accountOptions}
                      bookingPoints={bookingPoints}
                      onBookingPoints={setBookingPoints}
                      pointsValue={bookingPointsValue}
                      onPointsValue={setBookingPointsValue}
                      freeNight={bookingFreeNight}
                      onFreeNight={setBookingFreeNight}
                      credit={bookingCredit}
                      onCredit={setBookingCredit}
                    />
                  </>
                ) : null}
                {tripId && !bookingOk && splits.some((sp) => subOptions.find((o) => o.id === sp.subId)?.travelCategory === "other") ? (
                  <select
                    name="travelCategory"
                    value={travelCategory}
                    onChange={(e) => setTravelCategory(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
                  >
                    {columnChoices.map((key) => (
                      <option key={key} value={key}>
                        {/* In a split only the catch-all item's part uses it — say which. */}
                        {splits.length > 1
                          ? `${subOptions.find((o) => o.travelCategory === "other" && splits.some((sp) => sp.subId === o.id))?.name ?? "Travel"} column: `
                          : "Travel Log column: "}
                        {EXPENSE_CATEGORIES.find((c) => c.key === key)?.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {tripId && !bookingOk && splits.some((sp) => subOptions.find((o) => o.id === sp.subId && o.receivesTripPlans)?.travelCategory === "restaurants") ? (
                  <select
                    name="foodColumn"
                    value={foodColumn}
                    onChange={(e) => setFoodColumn(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
                  >
                    {(["restaurants", "groceries"] as const).map((key) => (
                      <option key={key} value={key}>
                        {splits.length > 1
                          ? `${subOptions.find((o) => o.receivesTripPlans && o.travelCategory === "restaurants")?.name ?? "Restaurant Travel"} column: `
                          : "Travel Log column: "}
                        {EXPENSE_CATEGORIES.find((c) => c.key === key)?.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {tripId && !bookingOk ? (
                  <span className="mt-1 block px-1 text-[11px] text-muted">
                    {bookingOk
                      ? null
                      : `Counts on the Travel Log as this trip's spending.${swapNote ? ` Switched ${swapNote} for this trip.` : ""}${movedToCatchAll.length ? ` ${movedToCatchAll.map((o) => o.name).join(", ")} will save on ${tripCatchAll!.name} (${movedToCatchAll.map((o) => EXPENSE_CATEGORIES.find((c) => c.key === o.travelCategory)?.label ?? o.name).join(", ")} column), not your everyday budget.` : ""}`}
                  </span>
                ) : null}
              </div>
            ) : null}

            {/* Note */}
            <input
              name="memo"
              type="text"
              placeholder="Add a note (optional)"
              defaultValue={editTx?.memo ?? initialMemo ?? ""}
              className="w-full rounded-xl bg-background px-2 py-2.5 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm"
            />
            {/* Delete moved into the footer next to Refund so all row-level
                controls sit on one line — see the bottom action bar below. */}
          </form>
        </div>

        {/* Bottom action bar — flex-wrap so the right-side controls fall
            under the left group on narrow (mobile) widths instead of running
            off the edge, and everything shrinks a step tighter on mobile. */}
        {errors.length > 0 ? (
          <div
            role="alert"
            className="border-t border-negative/30 bg-negative/10 px-3 py-2 text-xs font-semibold text-negative"
          >
            {errors.map((msg) => (
              <p key={msg}>{msg}</p>
            ))}
          </div>
        ) : null}
        {savedWarning ? (
          <div
            role="alert"
            className="border-t border-negative/30 bg-negative/10 px-3 py-2 text-xs font-semibold text-negative"
          >
            <p>Transaction saved. {savedWarning}</p>
          </div>
        ) : null}

        {savedWarning ? (
          <div className={"flex justify-end border-t border-line px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] " + HEADER_TINT[txType]}>
            <button
              type="button"
              onClick={onClose}
              className={"rounded-xl px-2.5 py-1 text-xs font-bold transition-colors sm:px-3.5 sm:py-1.5 sm:text-sm " + BTN_COLOR[txType] + " " + BTN_TEXT[txType]}
            >
              Done
            </button>
          </div>
        ) : (
        <div className={"flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-line px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]  " + HEADER_TINT[txType]}>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-1.5 py-1 text-xs font-bold text-muted transition hover:text-foreground sm:px-2 sm:py-1.5 sm:text-sm"
            >
              Cancel
            </button>
            {/* Refund toggle — only meaningful for spend kinds. Off: normal
                spend; On: server stores amount as negative so it credits the
                account and reduces the sub's actual spend. Hidden on income
                (a refund of income doesn't exist) and on the locked
                debt/savings context (those flows have their own semantics). */}
            {txType !== "income" && !initialIsWithdrawal && !(restrictToInitialKind && (initialKind === "debt" || initialKind === "savings")) ? (
              // A saved purchase isn't flipped into a refund — that erased the
              // purchase and moved spending by twice the amount (2026-10-06).
              // Its Refund button opens a new refund row for the same item,
              // card and payee instead, so both stay on the account's history.
              isEdit && editTx.amountCents > 0 && onAddRefund ? (
                <button
                  type="button"
                  onClick={() => onAddRefund(editTx)}
                  className="rounded-full bg-transparent px-2.5 py-1 text-[11px] font-bold text-muted ring-1 ring-line transition hover:text-foreground"
                >
                  + Add refund
                </button>
              ) : (
              <button
                type="button"
                onClick={() => setIsRefund((v) => !v)}
                aria-pressed={isRefund}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
                  isRefund
                    ? "bg-positive/20 text-positive ring-positive/40 hover:bg-positive/30"
                    : "bg-transparent text-muted ring-line hover:text-foreground"
                }`}
              >
                {isRefund ? "✓ Refund" : "Refund"}
              </button>
              )
            ) : null}
            {/* Row-level controls all sit on the left next to Cancel so the
                right side stays a single primary action. Add mode: Clear
                (submit with cleared=on). Edit mode: Delete + Clear/Unclear
                toggle. Same 11px sizing on mobile as Refund. */}
            {!isEdit ? (
              <button
                type="submit"
                form="tx-form"
                name="cleared"
                value="on"
                disabled={pending}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition disabled:cursor-wait ${
                  pending && busy === "clear"
                    ? "bg-emerald-600 text-white ring-emerald-600"
                    : "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60 dark:hover:bg-emerald-900/40"
                }`}
              >
                {pending && busy === "clear" ? <><Spinner />Clearing…</> : "Clear"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setBusy("delete");
                    start(async () => {
                      const fd = new FormData();
                      fd.set("id", editTx.id);
                      await deleteTransaction(fd);
                      onClose();
                    });
                  }}
                  className="rounded-full px-2.5 py-1 text-[11px] font-bold text-negative ring-1 ring-negative/30 transition hover:bg-negative/10 disabled:opacity-60"
                >
                  {pending && busy === "delete" ? "Deleting..." : "Delete"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setBusy("toggle");
                    start(async () => {
                      const fd = new FormData();
                      fd.set("id", editTx.id);
                      fd.set("cleared", editTx.cleared ? "false" : "true");
                      await toggleCleared(fd);
                      onClose();
                    });
                  }}
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold text-foreground ring-1 transition disabled:opacity-60 ${
                    editTx.cleared
                      ? "bg-positive/25 ring-positive/40 hover:bg-positive/35"
                      : "bg-positive/10 ring-positive/25 hover:bg-positive/20"
                  }`}
                >
                  {pending && busy === "toggle"
                    ? editTx.cleared
                      ? "Unclearing..."
                      : "Clearing..."
                    : editTx.cleared
                    ? "Unclear"
                    : "Clear"}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="submit"
              form="tx-form"
              disabled={pending}
              className={"inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold transition-colors disabled:cursor-wait disabled:opacity-60 sm:px-3.5 sm:py-1.5 sm:text-sm " + BTN_COLOR[txType] + " " + BTN_TEXT[txType]}
            >
              {/* A save takes a few seconds; Clear is a save too, so both show
                  it here, on the button the eye goes to. */}
              {pending && (busy === "save" || busy === "clear")
                ? <><Spinner />Saving…</>
                : isRefund
                ? isEdit
                  ? "Save Refund"
                  : "Add Refund"
                : isEdit
                ? "Save"
                : initialIsWithdrawal
                ? "Withdraw"
                : "Add " + KIND_SHORT[txType]}
            </button>
          </div>
        </div>
        )}
      </div>
    </>
  );
}

// Split rows shown below the account/item row for new multi-item transactions.
function SplitRows({
  splits,
  options,
  leftToSplit,
  invalidSubIds,
  onRemove,
  onAmountChange,
  onAddSplit,
}: {
  splits: SplitEntry[];
  options: SubOption[];
  leftToSplit: number;
  invalidSubIds: Set<string>;
  onRemove: (subId: string) => void;
  onAmountChange: (subId: string, cents: number) => void;
  onAddSplit: () => void;
}) {
  return (
    <div className="rounded-xl ring-1 ring-line overflow-hidden">
      {splits.map((sp) => {
        const opt = options.find((o) => o.id === sp.subId);
        return (
          /* items-start + an input-height (h-8) label box: when the input's
             + − = strip opens below it, the name stays level with the input
             instead of re-centering down into the strip. */
          <div key={sp.subId} className="flex items-start gap-2 border-b border-line/60 px-3 py-2.5 last:border-b-0">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => onRemove(sp.subId)}
                className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-negative text-white text-xs font-bold leading-none"
                aria-label="Remove"
              >
                −
              </button>
              <span className="flex-1 truncate text-sm font-medium">{opt?.name ?? sp.subId}</span>
            </div>
            <div className={"shrink-0 rounded-lg " + (invalidSubIds.has(sp.subId) ? "ring-2 ring-negative" : "")}>
              <SplitAmountInput
                amountCents={sp.amountCents}
                onChange={(cents) => onAmountChange(sp.subId, cents)}
              />
            </div>
          </div>
        );
      })}

      {/* Add Split + Left to Split footer */}
      <div className="flex items-center justify-between border-t border-line/60 bg-background/60 px-3 py-2">
        <button
          type="button"
          onClick={onAddSplit}
          className="text-sm font-semibold text-brand"
        >
          + Add Split
        </button>
        <span className={`text-xs font-semibold tabular-nums ${Math.abs(leftToSplit) < 2 ? "text-positive" : leftToSplit < 0 ? "text-negative" : "text-warning"}`}>
          {leftToSplit >= 0 ? "$" + (leftToSplit / 100).toFixed(2) + " left to split" : "−$" + (Math.abs(leftToSplit) / 100).toFixed(2) + " over"}
        </span>
      </div>
    </div>
  );
}

// The main "$ amount" field. Supports arithmetic expressions (e.g. "26.10 + 8.19"
// via moneyExpressionToCents), which desktop users can type directly. On mobile
// the total is normally a single number, so the operator chips live on the split
// rows instead (where multiple items get combined more often).
function AmountInput({
  inputRef,
  defaultValue,
  onChangeCents,
  forcedCents,
  invalid = false,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  defaultValue: string;
  onChangeCents: (cents: number) => void;
  forcedCents?: number | null;
  invalid?: boolean;
}) {
  const [raw, setRaw] = useState(defaultValue);
  const [focused, setFocused] = useState(false);

  // Adjust `raw` when the converter hands down a new amount. Done during
  // render against the previous prop rather than in an effect: an effect here
  // would paint the stale amount first and then immediately re-render.
  const [prevForcedCents, setPrevForcedCents] = useState(forcedCents);
  if (forcedCents !== prevForcedCents) {
    setPrevForcedCents(forcedCents);
    if (forcedCents != null && forcedCents > 0) {
      setRaw((forcedCents / 100).toFixed(2));
    }
  }

  const commit = (value: string) => {
    const cents = moneyExpressionToCents(value);
    onChangeCents(cents);
    const display = cents === 0 ? "" : (cents / 100).toFixed(2);
    setRaw(display);
    if (inputRef.current) inputRef.current.value = display;
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        {!focused && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold text-muted">$</span>
        )}
        <input
          ref={inputRef}
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          placeholder="0.00"
          value={raw}
          onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
          onBlur={() => { setTimeout(() => setFocused(false), 150); commit(raw); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(raw); e.currentTarget.blur(); }
          }}
          onChange={(e) => {
            setRaw(e.target.value);
            const v = parseFloat(e.target.value);
            onChangeCents(isNaN(v) ? 0 : Math.round(v * 100));
          }}
          className={`w-full rounded-xl bg-background py-2.5 pr-2 text-base font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand ${invalid ? "ring-2 ring-negative" : "ring-1 ring-line"} ${focused ? "pl-3" : "pl-7"}`}
        />
      </div>
    </div>
  );
}

// Uncontrolled-style amount input: keeps raw string while typing, formats on blur.
// Accepts arithmetic expressions (e.g. "45 + 12.50 - 3") — Enter evaluates.
function SplitAmountInput({ amountCents, onChange }: { amountCents: number; onChange: (cents: number) => void }) {
  const [raw, setRaw] = useState(amountCents === 0 ? "" : (amountCents / 100).toFixed(2));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = (value: string) => {
    const cents = moneyExpressionToCents(value);
    onChange(cents);
    setRaw(cents === 0 ? "" : (cents / 100).toFixed(2));
  };

  const insertAtCaret = (ch: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + ch + el.value.slice(end);
    setRaw(next);
    el.value = next;
    const caret = start + ch.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={raw}
        placeholder="0.00"
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={() => { setTimeout(() => setFocused(false), 150); commit(raw); }}
        onChange={(e) => {
          setRaw(e.target.value);
          const v = parseFloat(e.target.value);
          onChange(isNaN(v) ? 0 : Math.round(v * 100));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(raw);
          }
        }}
        className="w-24 rounded-lg bg-background px-2 py-1.5 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      />
      {focused ? (
        /* Wider than the input it belongs to — the negative margin keeps its
           right edge aligned, so the row's layout doesn't shift when the strip
           appears. At the input's own 96px these three keys were ~30px wide
           with 4px between them: small enough to hit the wrong one with a
           thumb. */
        <div className="-ml-20 flex w-44 gap-2.5 sm:hidden">
          {[
            { label: "+", ch: "+" },
            { label: "−", ch: "-" },
            { label: "=", ch: "=" },
          ].map((k) => (
            <button
              key={k.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={() => {
                if (k.ch === "=") { commit(raw); return; }
                insertAtCaret(k.ch);
              }}
              className="flex-1 rounded-lg bg-black/[0.06] px-1 py-2.5 text-base font-semibold tabular-nums text-foreground active:bg-black/10 dark:bg-white/10 dark:active:bg-white/20"
            >
              {k.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// The account picker, laid out like BudgetItemPicker: full screen on a phone,
// a centred dialog on desktop, with search and each account's figure on the
// right — Owed for a credit card, Balance for a bank account.
function AccountPicker({
  accountGroups,
  accountByGroup,
  selectedAccountId,
  onSelect,
  onClose,
}: {
  accountGroups: string[];
  accountByGroup: Map<string, AccountOption[]>;
  selectedAccountId: string;
  onSelect: (accountId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  // Row the arrow keys have landed on; Enter picks it. Resets to the top
  // match whenever the search text changes.
  const [activeIndex, setActiveIndex] = useState(0);
  // Only paint that highlight while the search box has focus — otherwise a
  // phone would show the top row lit up for no reason.
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = search.trim().toLowerCase();

  // Straight into the search box on desktop. Not on a phone, where focusing
  // throws the keyboard over half the list before anything is typed.
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) searchRef.current?.focus();
  }, []);

  const groups = accountGroups
    .map((group) => ({
      group,
      accounts: (accountByGroup.get(group) ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)),
    }))
    .filter((g) => g.accounts.length > 0);
  const flat = groups.flatMap((g) => g.accounts);
  const activeAccount = flat[Math.min(activeIndex, flat.length - 1)];

  // Keep the highlighted row in view as the arrows walk past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-account-id="${activeAccount?.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeAccount?.id]);

  return (
    <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col overflow-hidden bg-surface pt-[max(env(safe-area-inset-top),1.75rem)] sm:h-auto sm:items-center sm:justify-start sm:bg-black/50 sm:p-4 sm:pt-[10vh]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface sm:h-auto sm:max-h-[80vh] sm:w-full sm:max-w-lg sm:flex-none sm:rounded-2xl sm:shadow-xl sm:ring-1 sm:ring-line">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <button type="button" onClick={onClose} className="text-sm font-medium text-muted hover:text-foreground">
          Cancel
        </button>
        <h2 className="text-base font-bold">Choose account</h2>
        <span className="w-12" aria-hidden />
      </div>

      <div className="shrink-0 border-b border-line px-4 py-2">
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setActiveIndex(0); }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              // Arrows move the highlight; Enter picks it (the top match
              // until an arrow is pressed), so "sapp" + Enter picks the card.
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (activeAccount) onSelect(activeAccount.id);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            className="w-full rounded-xl bg-background py-2 pl-9 pr-3 text-base ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand sm:text-sm"
          />
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y pb-[env(safe-area-inset-bottom)]">
        {groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No accounts found</p>
        ) : null}
        {groups.map(({ group, accounts }) => (
          <div key={group}>
            <div className="flex items-center justify-between border-b border-line/40 bg-background/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span>{group}</span>
              <span>{group === "Credit Cards" ? "Owed" : "Balance"}</span>
            </div>
            {accounts.map((account) => {
              const selected = account.id === selectedAccountId;
              const active = searchFocused && account.id === activeAccount?.id;
              const cents = account.balanceCents;
              return (
                <button
                  key={account.id}
                  data-account-id={account.id}
                  type="button"
                  onClick={() => onSelect(account.id)}
                  className={`flex w-full items-center gap-3 border-b border-line/40 px-4 py-3.5 text-left transition hover:bg-black/[0.03] active:bg-brand-soft/40 dark:hover:bg-white/[0.06] ${active ? "sm:bg-sky-100 sm:hover:bg-sky-100 sm:dark:bg-sky-400/15 sm:dark:hover:bg-sky-400/15" : ""} ${selected ? "bg-black/[0.04] dark:bg-white/[0.08]" : ""}`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${selected ? "border-brand bg-brand text-white" : "border-zinc-400 bg-transparent dark:border-zinc-600"}`}>
                    {selected ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m2 6 3 3 5-5" />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{account.name}</span>
                  {cents != null ? (
                    <span className="shrink-0 text-sm tabular-nums text-muted">
                      {(cents < 0 ? "−$" : "$") + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}

// One selectable row of the picker. Split out of BudgetItemPicker so the
// toggle handler is invoked from this component's own onClick rather than
// closed over inside a render-time helper.
function PickerRow({
  option,
  checked,
  active,
  showPlanned,
  onToggle,
}: {
  option: SubOption;
  checked: boolean;
  active: boolean;
  showPlanned: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-option-id={option.id}
      onClick={() => onToggle(option.id)}
      className={`flex w-full items-center gap-3 border-b border-line/40 px-4 py-3.5 text-left last:border-b-0 active:bg-brand-soft/40 ${active ? "sm:bg-sky-100 sm:dark:bg-sky-400/15" : ""}`}
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${checked ? "border-brand bg-brand text-white" : "border-zinc-400 bg-transparent dark:border-zinc-600"}`}>
        {checked && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      {/* Break after a slash ("Talkatone/<wbr>Phone") so a narrow phone column
          wraps at the slash rather than mid-word. */}
      <span className="min-w-0 flex-1 text-sm font-medium break-words">
        {option.name.split("/").map((part, i) => (
          <Fragment key={i}>{i > 0 && <>/<wbr /></>}{part}</Fragment>
        ))}
      </span>
      {showPlanned && (
        <span className={`${PICKER_AMOUNT_COL} text-sm tabular-nums text-muted`}>
          {option.plannedCents != null ? pickerMoney(option.plannedCents) : ""}
        </span>
      )}
      <span className={`${PICKER_AMOUNT_COL} text-sm tabular-nums`}>
        {option.remainingCents != null && (
          <span className={option.remainingCents < 0 ? "rounded-full bg-negative/20 px-2 py-0.5 font-medium text-negative" : option.remainingCents > 0 ? "text-positive" : "text-muted"}>
            {pickerMoney(option.remainingCents)}
          </span>
        )}
      </span>
    </button>
  );
}

// Planned and Remaining share one fixed width so each column's figures stack
// under a centered header, whatever the item name's length.
const PICKER_AMOUNT_COL = "w-[5.5rem] shrink-0 text-center sm:w-28";

function pickerMoney(cents: number) {
  return (cents < 0 ? "−$" : "$") + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Full-screen budget item picker with search + checkboxes + remaining amounts.
function BudgetItemPicker({
  options,
  selectedIds,
  onConfirm,
  onClose,
}: {
  options: SubOption[];
  selectedIds: Set<string>;
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set(selectedIds));
  // Keyboard highlight (desktop): null until something is typed or an arrow
  // is pressed, so Enter on an empty search box means Done.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Desktop opens with the cursor already in the search box, so the picker can
  // be driven from the keyboard. Never on a phone: focusing there throws the
  // keyboard up over half the list before anything is typed (same rule as the
  // account picker above).
  const focusSearchOnDesktop = () => {
    if (window.matchMedia("(min-width: 640px)").matches) searchRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    focusSearchOnDesktop();
  }, []);

  const filtered = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;
  // Snowball's debt picker carries balances only, no plan — skip the column there.
  const showPlanned = options.some((o) => o.plannedCents != null);

  // Rows in the order they're drawn — Selected first, then each category —
  // so the arrow keys walk down the list exactly as it reads.
  const selectedItems = options.filter((o) => checked.has(o.id));
  const unselectedFiltered = filtered.filter((o) => !checked.has(o.id));
  const multiKind = new Set(unselectedFiltered.map((o) => o.kind)).size > 1;
  const visibleKinds = CATEGORY_KINDS.filter(({ kind }) => unselectedFiltered.some((o) => o.kind === kind));
  const ordered = [
    ...selectedItems,
    ...visibleKinds.flatMap(({ kind }) => unselectedFiltered.filter((o) => o.kind === kind)),
  ];
  // Typing lands the highlight on the first match that isn't already ticked.
  const activeId = activeIndex == null ? null : ordered[Math.min(activeIndex, ordered.length - 1)]?.id ?? null;

  useEffect(() => {
    if (activeId) listRef.current?.querySelector<HTMLElement>(`[data-option-id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Return cursor to the search box so the user can keep typing to filter
    // and pick the next item without an extra tap.
    setSearch("");
    setActiveIndex(null);
    focusSearchOnDesktop();
  }

  return (
    <div className="fixed inset-0 z-[70] flex h-[100dvh] flex-col overflow-hidden bg-surface sm:h-auto sm:items-center sm:justify-start sm:bg-black/50 sm:p-4 sm:pt-[10vh]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface sm:h-auto sm:max-h-[80vh] sm:w-full sm:max-w-lg sm:flex-none sm:rounded-2xl sm:shadow-xl sm:ring-1 sm:ring-line">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:rounded-t-2xl">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <h2 className="text-base font-bold">
          Select Budget Item(s)
          {checked.size > 0 ? (
            <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold text-amber-900 tabular-nums dark:bg-amber-300 dark:text-amber-950">
              {checked.size}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          onClick={() => onConfirm([...checked])}
          className="text-sm font-semibold text-brand"
        >
          Done
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-line px-4 py-2">
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIndex(e.target.value ? selectedItems.length : null);
            }}
            onKeyDown={(e) => {
              // Arrows move the highlight; Enter ticks it. With nothing
              // highlighted, Enter is Done.
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i == null ? 0 : Math.min(i + 1, ordered.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i == null ? 0 : Math.max(i - 1, 0)));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (activeId) toggle(activeId);
                else onConfirm([...checked]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            className="w-full rounded-xl bg-background py-2 pl-9 pr-3 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
      </div>

      {/* Item list. The header row lives INSIDE the scroller, stuck to its
          top: outside it, the list's scrollbar made every row narrower than
          the header and the column labels sat to the right of their own
          figures. */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line/40 bg-surface px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <span className="flex-1">Item</span>
          {showPlanned && <span className={PICKER_AMOUNT_COL}>Planned</span>}
          <span className={PICKER_AMOUNT_COL}>Remaining</span>
        </div>
        {filtered.length === 0 && checked.size === 0
          ? <p className="px-4 py-8 text-center text-sm text-muted">No items found</p>
          : (() => {
              const renderItem = (o: SubOption) => (
                <PickerRow key={o.id} option={o} checked={checked.has(o.id)} active={o.id === activeId} showPlanned={showPlanned} onToggle={toggle} />
              );

              return (
                <>
                  {selectedItems.length > 0 && (
                    <>
                      <div className="border-b border-line/40 bg-brand-soft/40 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
                        Selected
                      </div>
                      {selectedItems.map(renderItem)}
                    </>
                  )}
                  {visibleKinds
                    .map(({ kind, name }) => {
                  const categoryItems = unselectedFiltered.filter((o) => o.kind === kind);

                  return (
                    <Fragment key={kind}>
                      {multiKind && (
                        <div className="border-b border-line/40 bg-background/40 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                          {name}
                        </div>
                      )}
                      {categoryItems.map(renderItem)}
                    </Fragment>
                  );
                    })}
                </>
              );
            })()
        }
      </div>
    </div>
    </div>
  );
}

// Payee field (unchanged)
function PayeeField({
  placeholder,
  defaultValue,
  payeeOptions,
  payeeLineItems = [],
  onMatch,
  onUsualPicks,
  invalid = false,
  onDirty,
}: {
  placeholder: string;
  defaultValue: string;
  payeeOptions?: PayeeOption[];
  payeeLineItems?: PayeeLineItem[];
  onMatch?: (item: PayeeLineItem) => void;
  onUsualPicks?: (payee: PayeeOption | null, itemMatched: boolean) => void;
  invalid?: boolean;
  onDirty?: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [, startDel] = useTransition();

  const q = value.trim().toLowerCase();
  const lineItemNames = new Set(payeeLineItems.map((i) => i.name.toLowerCase()));
  const lineMatches = q
    ? payeeLineItems.filter((i) => i.name.toLowerCase() !== q && i.name.toLowerCase().includes(q))
    : payeeLineItems;
  const plainOptions = (payeeOptions ?? []).filter((p) => !deletedIds.has(p.id));
  const plainMatches = (
    q
      ? plainOptions.filter((p) => p.name.toLowerCase() !== q && p.name.toLowerCase().includes(q))
      : plainOptions
  ).filter((p) => !lineItemNames.has(p.name.toLowerCase()));
  const lineSlice = lineMatches.slice(0, 6);
  const plainSlice = plainMatches.slice(0, 6 - Math.min(6, lineSlice.length));
  type Entry = PayeeLineItem | { id: string; name: string };
  const matches: Entry[] = [...lineSlice, ...plainSlice];

  function select(name: string) {
    setValue(name);
    onDirty?.();
    setOpen(false);
    setHighlighted(-1);
    const item = payeeLineItems.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (item) onMatch?.(item);
    onUsualPicks?.(payeeOptions?.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null, Boolean(item));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? matches.length - 1 : h - 1));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      select(matches[highlighted].name);
    } else if (e.key === "Tab" && highlighted >= 0) {
      // Tab takes the arrowed-to suggestion too, then moves on as usual —
      // otherwise the blur threw the highlighted pick away.
      select(matches[highlighted].name);
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  return (
    <div className="relative">
      <input
        name="payee"
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { setValue(e.target.value); onDirty?.(); setOpen(e.target.value.trim().length > 0); setHighlighted(-1); }}
        onFocus={() => { if (value.trim().length > 0) setOpen(true); }}
        onBlur={() => {
          setOpen(false);
          setHighlighted(-1);
          // A payee typed out in full has no suggestion left to tap (exact
          // matches drop off the list), so its usual item fills on leaving.
          onUsualPicks?.(payeeOptions?.find((p) => !deletedIds.has(p.id) && p.name.toLowerCase() === q) ?? null, lineItemNames.has(q));
        }}
        onKeyDown={handleKeyDown}
        className={
          "w-full rounded-xl bg-background px-2 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-brand sm:px-3 sm:text-sm " +
          (invalid ? "ring-2 ring-negative" : "ring-1 ring-line")
        }
      />
      {open && value.trim().length > 0 && matches.length > 0 ? (
        // Above the field on a phone, where the keyboard covers what's below;
        // below it on desktop, where the eye is already moving down the form.
        <ul className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-48 overflow-y-auto rounded-xl bg-surface py-1 shadow-lg ring-1 ring-line sm:bottom-auto sm:top-full sm:mb-0 sm:mt-1">
          {matches.map((entry, idx) => {
            const isLineItem = "kind" in entry;
            const isHighlighted = idx === highlighted;
            return (
              <li key={entry.name} className={`group flex items-center ${isHighlighted ? "bg-brand-soft ring-1 ring-inset ring-brand/20" : "hover:bg-brand-soft/40"}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(entry.name)}
                  className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                >
                  <span className="flex-1 truncate">{entry.name}</span>
                  {isLineItem ? (
                    <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                      {entry.kind === "subscription" ? "Sub" : "Irregular"}
                    </span>
                  ) : null}
                </button>
                {!isLineItem ? (
                  <button
                    type="button"
                    aria-label="Remove suggestion"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setDeletedIds((s) => new Set([...s, entry.id]));
                      startDel(() => deletePayee(entry.id));
                    }}
                    className="mr-2 shrink-0 rounded px-1 py-0.5 text-sm font-bold text-muted opacity-0 transition group-hover:opacity-100 hover:text-negative"
                  >
                    ×
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// Small busy indicator for the footer buttons while a save is in flight.
function Spinner() {
  return (
    <svg className="h-3 w-3 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

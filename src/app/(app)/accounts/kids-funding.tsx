"use client";

import { useRouter } from "next/navigation";
import React, { useRef, useState, useTransition } from "react";
import {
  KID_ACCOUNT_TYPES,
  TRUMP_ANNUAL_LIMIT_CENTS,
  controllerLabelFor,
  fullDate,
  handOverFrom,
  kidActionsFor,
  kidTypeOf,
  kidTypeRank,
  monthAtAge,
  monthYear,
  trumpOpensOn,
  utmaAgeOptions,
  type KidAccountType,
} from "@/lib/kids-funding";
import { TAX_LABEL_SHORT, type TaxTreatment } from "@/lib/tax-treatment";
import { addAccount, deleteAccount, deleteBucket } from "./actions";
import {
  changeKidBeneficiary,
  deleteKid,
  endKidItem,
  moveBetween529s,
  reopenKidItem,
  saveKid,
  saveKidItemField,
  setKidUtmaAge,
  updateKidItem,
} from "./kids-actions";
import { monthAbbr, monthHeadTier, monthTier } from "./month-columns";
import { LABEL_CLS, LabeledInput } from "./shared-ui";
import type { AccountData, KidData, KidEvent, KidsFundingData } from "./types";

// Kids Funding, organised the way the money actually works: by child. Who it's
// for, who runs it and when it hands over are all per child, while the brokerage
// login it sits under is only a label. Fidelity and Cap One stay as they are
// underneath (their buckets keep every snapshot and Budget link) and every bucket
// is shown here as the real account it is.

export type KidItem = {
  key: string;
  accountId: string;
  bucketId: string | null;
  name: string;
  type: string | null;
  kidId: string | null;
  institution: string | null;
  last4: string | null;
  accountNumber: string | null;
  controlledBy: string | null;
  successorOwner: string | null;
  dateClosed: string | null;
  closedReason: string | null;
  balanceCents: number;
  balancesByMonth: Record<string, number>;
  taxTreatment: string | null;
};

const lastFour = (n: string | null | undefined) => n?.replace(/\s/g, "").slice(-4) || null;

/** Every bucket, and every account without buckets, as one list. */
export function kidItemsOf(accounts: AccountData[]): KidItem[] {
  return accounts.flatMap((a): KidItem[] => {
    if (a.buckets.length > 0) {
      return a.buckets.map((b) => ({
        key: `b:${b.id}`,
        accountId: a.id,
        bucketId: b.id,
        name: b.name,
        type: kidTypeOf(b.subtype ?? a.subtype, b.retirementKind ?? a.retirementKind),
        kidId: b.kidId ?? a.kidId ?? null,
        institution: b.institution ?? a.institution ?? a.name,
        last4: lastFour(b.accountNumber),
        accountNumber: b.accountNumber ?? null,
        controlledBy: b.controlledBy ?? a.controlledBy ?? null,
        successorOwner: b.successorOwner ?? a.successorOwner ?? null,
        dateClosed: b.dateClosed ?? null,
        closedReason: b.closedReason ?? null,
        balanceCents: b.balanceCents,
        balancesByMonth: b.balancesByMonth,
        taxTreatment: b.taxTreatment ?? a.taxTreatment,
      }));
    }
    return [{
      key: `a:${a.id}`,
      accountId: a.id,
      bucketId: null,
      name: a.name,
      type: kidTypeOf(a.subtype, a.retirementKind),
      kidId: a.kidId ?? null,
      institution: a.institution,
      last4: lastFour(a.accountNumber),
      accountNumber: a.accountNumber,
      controlledBy: a.controlledBy ?? null,
      successorOwner: a.successorOwner ?? null,
      dateClosed: a.dateClosed,
      closedReason: a.closedReason ?? null,
      balanceCents: a.balanceCents,
      balancesByMonth: a.balancesByMonth ?? {},
      taxTreatment: a.taxTreatment,
    }];
  });
}

const byType = (a: KidItem, b: KidItem) => kidTypeRank(a.type) - kidTypeRank(b.type) || a.name.localeCompare(b.name);

const localToday = () => new Date().toLocaleDateString("en-CA");

// Kids' balances are whole dollars under $100,000, so their columns give up
// 1.5rem each to the name, which keeps the summary line on one line.
const KID_ROW_GRID =
  "grid-cols-[minmax(0,1fr)_6rem] @[560px]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem] @[860px]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_5.5rem_5.5rem] @[1180px]:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_5.5rem_5.5rem_5.5rem_5.5rem]";

// The pale sage of heading rows, mixed into the surface.
const SAGE = "bg-[color-mix(in_srgb,var(--positive)_8%,var(--surface))]";
const FIELD = "w-full rounded-md bg-surface px-2 py-1.5 text-sm text-foreground ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand max-sm:py-2.5";
// The panel's buttons. The one whose form is open stays lit, since that form
// has no title of its own.
const actionClass = (active: boolean) =>
  `shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm ring-1 transition sm:text-[15px] ${
    active ? "bg-sky-100 ring-sky-500 dark:bg-sky-900/50" : "bg-surface ring-line hover:bg-sky-50 dark:hover:bg-sky-950/40"
  }`;
const dangerClass = (active: boolean) =>
  `shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-negative shadow-sm ring-1 transition sm:text-[15px] ${
    active ? "bg-negative/25 ring-negative" : "bg-negative/10 ring-negative/40 hover:bg-negative/20"
  }`;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// One short statement of who runs it and what happens next, under each name.
function itemSummary(item: KidItem, kid: KidData | null, contributed: number | undefined, money: (c: number) => string) {
  const place = item.institution ? `${item.institution} · ` : "";
  const who = item.controlledBy ?? "You";
  const child = kid?.name ?? "the child";
  if (item.type === "529") return { line: `${place}${item.controlledBy ? `${who} owns` : "You own"} · No handover` };
  if (item.type === "UTMA") {
    const when = kid ? ` ${monthYear(monthAtAge(kid.birthMonth, kid.utmaHandoverAge))}` : "";
    return { line: `${place}${who}, custodian · To ${child}${when}` };
  }
  if (item.type === "Trump Account") {
    const when = kid ? ` ${fullDate(trumpOpensOn(kid.birthMonth))}` : " the year they turn 18";
    return {
      line: `${place}${who} · To ${child}${when}`,
      limit: `${money(contributed ?? 0)} of ${money(TRUMP_ANNUAL_LIMIT_CENTS)} this year`,
      overLimit: (contributed ?? 0) > TRUMP_ANNUAL_LIMIT_CENTS,
    };
  }
  if (item.type === "Checking" || item.type === "Savings") return { line: `${place}Bank's rules at 18` };
  return { line: place.replace(/ · $/, "") };
}

function eventText(e: KidEvent, kidName: (id: string | null) => string | null, money: (c: number) => string) {
  const from = kidName(e.fromKidId);
  const to = kidName(e.toKidId);
  const amount = e.amountCents ? ` · ${money(e.amountCents)}` : "";
  switch (e.event) {
    case "closed": return `Closed${amount}`;
    case "handed_over": return `Handed over${from ? ` to ${from}` : ""}${amount}`;
    case "reopened": return `Reopened${amount}`;
    case "beneficiary_changed": return `Transferred${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`;
    case "moved_529": return `Transferred ${(e.detail ?? "").toLowerCase().startsWith("from") ? "from" : "to"} ${(e.detail ?? "").replace(/^(to|from) /i, "")}${amount}`;
  }
}

// The shared shell of each action: one tight row of fields sized to what they
// hold, with its buttons on the same row. Keeps what was typed when a save is
// refused (onSubmit, not <form action>, which wipes the fields).
function ActionForm({
  submit,
  danger = false,
  action,
  onDone,
  extra,
  lostConnection = "Couldn't save. Check your connection and try again.",
  children,
}: {
  submit: string;
  danger?: boolean;
  action: (fd: FormData) => Promise<{ error: string | null }>;
  onDone: () => void;
  extra?: React.ReactNode;
  /** Shown when the connection drops mid-save, when it can't be known whether it landed. */
  lostConnection?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The disabled button only takes effect on the next render, so taps in the
  // same instant all get through it. This closes that gap: one save at a time,
  // and a save that worked stays locked until the form closes.
  const saving = useRef(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (saving.current) return;
        saving.current = true;
        const fd = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          try {
            const res = await action(fd);
            if (res.error) {
              setError(res.error);
              saving.current = false;
            } else {
              router.refresh();
              onDone();
            }
          } catch {
            // A lost connection rejects instead of returning an error.
            setError(lostConnection);
            saving.current = false;
          }
        });
      }}
      className="flex flex-wrap items-end gap-x-3 gap-y-2"
    >
      {children}
      <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
        <button
          type="submit"
          disabled={pending}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50 sm:text-[15px] max-sm:py-2.5 ${danger ? "bg-negative" : "bg-brand"}`}
        >
          {pending ? "Saving…" : submit}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-2 py-1.5 text-xs font-medium text-foreground hover:bg-sky-50 sm:text-[15px] max-sm:py-2.5 dark:hover:bg-sky-950/40">
          Cancel
        </button>
        {extra}
      </div>
      {error ? <p className="basis-full text-sm font-semibold text-negative">{error}</p> : null}
    </form>
  );
}

const W_NAME = "max-sm:w-full sm:w-44";
const W_PICK = "max-sm:w-full sm:w-56";
const W_NOTE = "max-sm:w-full sm:w-56";
const W_DATE = "max-sm:w-[calc(50%-0.375rem)] sm:w-44";
const W_AMOUNT = "max-sm:w-[calc(50%-0.375rem)] sm:w-32";

function Field({ label, width, children }: { label: string; width: string; children: React.ReactNode }) {
  return (
    <label className={`block ${width}`}>
      <span className={LABEL_CLS}>{label}</span>
      {children}
    </label>
  );
}

function Select({ label, width = "", children, ...props }: { label: string; width?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} width={width}>
      <select {...props} className={FIELD}>{children}</select>
    </Field>
  );
}

function TextField({ label, width, ...props }: { label: string; width: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} width={width}>
      <input autoComplete="off" {...props} className={FIELD} />
    </Field>
  );
}

function DateField({ label = "Date", name = "date" }: { label?: string; name?: string }) {
  return (
    <TextField
      label={label}
      width={W_DATE}
      name={name}
      type="date"
      required
      defaultValue={localToday()}
      onClick={(e) => {
        // showPicker throws without browser support; the calendar icon still works then.
        try {
          e.currentTarget.showPicker?.();
        } catch {
          /* no-op */
        }
      }}
    />
  );
}

function ItemIds({ item }: { item: KidItem }) {
  return (
    <>
      <input type="hidden" name="accountId" value={item.accountId} />
      <input type="hidden" name="bucketId" value={item.bucketId ?? ""} />
    </>
  );
}

// "Born" because it holds a month and a year.
function ChildFields({ kid, nameField = "name", bornField = "birthMonth", onName }: { kid?: KidData | null; nameField?: string; bornField?: string; onName?: (name: string) => void }) {
  return (
    <>
      <TextField label="Name" width={W_NAME} name={nameField} defaultValue={kid?.name ?? ""} required onChange={(e) => onName?.(e.target.value)} />
      <TextField label="Born" width={W_NAME} name={bornField} type="month" defaultValue={kid?.birthMonth.slice(0, 7) ?? ""} required />
    </>
  );
}

// One way to give a 529 to someone else. The whole account changes its
// beneficiary, so the account itself moves under them; part of it moves money
// into a 529 they already have. Which of those it is decides which action runs.
function TransferForm({ item, kids, others, money, onDone }: { item: KidItem; kids: KidData[]; others: KidItem[]; money: (c: number) => string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [howMuch, setHowMuch] = useState<"all" | "part">("all");
  const [amount, setAmount] = useState("");
  const [newName, setNewName] = useState("");
  const targets = others.filter((o) => o.kidId === to);
  const canPart = targets.length > 0 && item.balanceCents > 0;
  // A child's own second 529 can only receive part: it's already theirs.
  const sameChild = to !== "" && to === item.kidId;
  const part = canPart && (howMuch === "part" || sameChild);
  const toName = to === "__new" ? newName : kids.find((k) => k.id === to)?.name ?? "";
  const label = !toName
    ? "Transfer"
    : part
      ? `Transfer ${amount ? `$${amount}` : "part"} to ${toName}`
      : `Transfer whole account to ${toName}`;
  return (
    <ActionForm
      submit={label}
      action={(fd) => (part ? moveBetween529s(fd) : changeKidBeneficiary(fd))}
      onDone={onDone}
      // A retry after a save that did land would move the money twice.
      lostConnection={part ? "Connection lost. The transfer may have saved. Reload the page and check the balances before trying again." : undefined}
    >
      <ItemIds item={item} />
      <input type="hidden" name="fromAccountId" value={item.accountId} />
      <input type="hidden" name="fromBucketId" value={item.bucketId ?? ""} />
      <Select label="To" width={W_PICK} name="toKidId" required value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Pick who</option>
        {kids.filter((k) => k.id !== item.kidId || others.some((o) => o.kidId === k.id)).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        <option value="__new">+ Someone new</option>
      </Select>
      {to === "__new" ? <ChildFields onName={setNewName} /> : null}
      {canPart && !sameChild ? (
        <Select label="How much" width="max-sm:w-full sm:w-44" value={howMuch} onChange={(e) => setHowMuch(e.target.value as "all" | "part")}>
          <option value="all">Whole account</option>
          <option value="part">Part of it</option>
        </Select>
      ) : null}
      {part ? (
        <>
          {targets.length > 1 ? (
            <Select label="Into" width={W_PICK} name="to" required defaultValue="">
              <option value="">Pick a 529</option>
              {targets.map((o) => <option key={o.key} value={`${o.accountId}:${o.bucketId ?? ""}`}>{o.name} · {money(o.balanceCents)}</option>)}
            </Select>
          ) : (
            <input type="hidden" name="to" value={`${targets[0].accountId}:${targets[0].bucketId ?? ""}`} />
          )}
          <TextField label="Amount" width={W_AMOUNT} name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" placeholder={`${money(item.balanceCents)} max`} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </>
      ) : null}
      <DateField />
      <TextField label="Note" width={W_NOTE} name="note" placeholder="Optional" />
    </ActionForm>
  );
}

function EndItemForm({ item, kid, reason, money, onDone }: { item: KidItem; kid: KidData | null; reason: "closed" | "handed_over"; money: (c: number) => string; onDone: () => void }) {
  const closing = reason === "closed";
  const amount = item.balanceCents !== 0 ? money(item.balanceCents) : null;
  const submit = closing
    ? `Close account${amount ? ` · ${amount}` : ""}`
    : `Hand over${amount ? ` ${amount}` : ""} to ${kid?.name ?? "the child"}`;
  return (
    <ActionForm submit={submit} danger={closing} action={endKidItem} onDone={onDone}>
      <ItemIds item={item} />
      <input type="hidden" name="reason" value={reason} />
      <DateField />
      <TextField label={closing ? "Where did the money go?" : "Note"} width="max-sm:w-full sm:w-64" name="note" placeholder="Optional" />
    </ActionForm>
  );
}

// Only the rare things: every other value saves right in its own cell.
function EditItemForm({ item, onDone }: { item: KidItem; onDone: () => void }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  return (
    <ActionForm
      submit="Save"
      action={updateKidItem}
      onDone={onDone}
      extra={confirmDelete ? (
        <>
          <span className="text-xs sm:text-[15px]">Erases all its past months.</span>
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              const fd = new FormData();
              fd.set("id", item.bucketId ?? item.accountId);
              startDelete(async () => {
                setDeleteError(null);
                try {
                  await (item.bucketId ? deleteBucket(fd) : deleteAccount(fd));
                  router.refresh();
                  onDone();
                } catch {
                  // Uncaught here, a lost connection takes down the whole page.
                  setDeleteError("Couldn't delete. Check your connection and try again.");
                }
              });
            }}
            className="rounded-md bg-negative px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 sm:text-[15px]"
          >
            {deleting ? "Deleting…" : "Yes, erase"}
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2 py-1.5 text-xs font-medium hover:bg-sky-50 sm:text-[15px] dark:hover:bg-sky-950/40">Keep</button>
          {deleteError ? <span className="text-sm font-semibold text-negative">{deleteError}</span> : null}
        </>
      ) : (
        <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-md px-2 py-1.5 text-xs font-medium text-negative transition hover:bg-negative/10 sm:text-[15px]">
          Delete (entered by mistake)
        </button>
      )}
    >
      <ItemIds item={item} />
      <TextField label="Name" width="max-sm:w-full sm:w-64" name="name" defaultValue={item.name} required />
      <Select label="Account type" width={W_NAME} name="type" defaultValue={item.type ?? ""}>
        {KID_ACCOUNT_TYPES.some((t) => t.type === item.type) ? null : <option value={item.type ?? ""}>{item.type ?? "Not set"}</option>}
        {KID_ACCOUNT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
      </Select>
    </ActionForm>
  );
}

type PanelAction = "edit" | "transfer" | "close" | "handover" | null;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-center text-xs font-medium sm:text-[15px] @[560px]:flex-auto">
      <dt className="font-semibold">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

// A value that edits in place: it reads as plain text until hovered or focused.
// A hidden copy of the text sets the width, so the cell stays as wide as its
// value instead of an input's default 20 characters.
const INLINE_BOX = "relative inline-block min-w-[3rem] max-w-full align-top";
const INLINE_SIZER = "invisible block whitespace-pre px-1.5";
const INLINE_CONTROL =
  "absolute inset-0 h-full w-full min-w-0 rounded bg-transparent px-1.5 text-center transition hover:bg-sky-50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand dark:hover:bg-sky-950/40";

function InlineText({ label, value, save, inputMode }: { label: string; value: string | null; save: (value: string) => void; inputMode?: "numeric" }) {
  const [text, setText] = useState(value ?? "");
  return (
    <span className={INLINE_BOX}>
      <span aria-hidden className={INLINE_SIZER}>{text || "Not set"}</span>
      <input
        aria-label={label}
        value={text}
        inputMode={inputMode}
        autoComplete="off"
        placeholder="Not set"
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() !== (value ?? "")) save(e.currentTarget.value);
        }}
        className={`${INLINE_CONTROL} placeholder:text-foreground`}
      />
    </span>
  );
}

function InlineSelect({ label, value, options, save }: { label: string; value: string; options: { value: string; label: string }[]; save: (value: string) => void }) {
  const shown = options.find((o) => o.value === value)?.label ?? "";
  return (
    <span className={INLINE_BOX}>
      <span aria-hidden className={INLINE_SIZER}>{shown}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => save(e.target.value)}
        className={`${INLINE_CONTROL} cursor-pointer appearance-none [text-align-last:center]`}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

// Everything entered about one item, and only the actions the law allows for it.
function KidItemPanel({
  item,
  kid,
  allItems,
  data,
  estate,
  money,
}: {
  item: KidItem;
  kid: KidData | null;
  allItems: KidItem[];
  data: KidsFundingData;
  estate: { beneficiary?: string | null; transfer?: string | null; contact?: string | null; notes?: string | null } | null;
  money: (c: number) => string;
}) {
  const router = useRouter();
  const [action, setAction] = useState<PanelAction>(null);
  const [reopening, startReopen] = useTransition();
  const [, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = () => setAction(null);
  const toggle = (next: PanelAction) => setAction((current) => (current === next ? null : next));
  const allowed = kidActionsFor({
    type: item.type,
    balanceCents: item.balanceCents,
    birthMonth: kid?.birthMonth ?? null,
    utmaAge: kid?.utmaHandoverAge ?? 21,
    today: localToday(),
  });
  const kidName = (id: string | null) => data.kids.find((k) => k.id === id)?.name ?? null;
  const events = data.events.filter((e) => e.accountId === item.accountId && e.bucketId === item.bucketId);
  const linkedItem = data.linkedItems[item.bucketId ?? item.accountId] ?? null;
  const handOverDate = handOverFrom(item.type, kid?.birthMonth ?? null, kid?.utmaHandoverAge ?? 21);
  const closed = item.dateClosed != null;
  const other529s = allItems.filter((o) => o.type === "529" && !o.dateClosed && o.key !== item.key);
  const tax = item.taxTreatment ? TAX_LABEL_SHORT[item.taxTreatment as TaxTreatment] ?? item.taxTreatment : null;

  const run = (write: () => Promise<{ error: string | null }>) =>
    startSave(async () => {
      setError(null);
      try {
        const res = await write();
        if (res.error) setError(res.error);
        else router.refresh();
      } catch {
        // A lost connection rejects instead of returning an error.
        setError("Couldn't save. Check your connection and try again.");
      }
    });
  const saveField = (field: string) => (value: string) =>
    run(() => saveKidItemField(item.accountId, item.bucketId, field, value));
  const notSet = { value: "", label: "Not set" };
  // Keyed by the saved value, so a cell picks up what the server now holds.
  const text = (field: string, label: string, value: string | null, inputMode?: "numeric") =>
    closed ? (value ?? "Not set") : <InlineText key={value ?? ""} label={label} value={value} save={saveField(field)} inputMode={inputMode} />;
  const forLabel = item.type === "529" ? "Beneficiary" : "For";
  const controllerLabel = controllerLabelFor(item.type);
  const controllerNames = [...new Set([...data.controllers, ...(item.controlledBy ? [item.controlledBy] : [])])];

  return (
    <div className="space-y-3 border-t border-line/60 bg-background/60 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @[560px]:flex @[560px]:flex-wrap @[560px]:gap-x-6">
        <Detail label={forLabel}>
          {closed || (item.type === "529" && item.kidId) ? (kid?.name ?? "Not set") : (
            <InlineSelect
              label={forLabel}
              value={item.kidId ?? ""}
              options={[notSet, ...data.kids.map((k) => ({ value: k.id, label: k.name }))]}
              save={saveField("kidId")}
            />
          )}
        </Detail>
        <Detail label="Type">{item.type ?? "Not set"}</Detail>
        <Detail label="Institution">{text("institution", "Institution", item.institution)}</Detail>
        <Detail label="Last 4">{text("accountNumber", "Last 4", item.last4, "numeric")}</Detail>
        <Detail label={controllerLabel}>
          {closed ? (item.controlledBy ?? "Not set") : (
            <InlineSelect
              label={controllerLabel}
              value={item.controlledBy ?? ""}
              options={[notSet, ...controllerNames.map((n) => ({ value: n, label: n }))]}
              save={saveField("controlledBy")}
            />
          )}
        </Detail>
        {item.type === "529" ? <Detail label="Successor owner">{text("successorOwner", "Successor owner", item.successorOwner)}</Detail> : null}
        {item.type === "UTMA" && kid && !closed ? (
          <Detail label="Hands over at">
            <InlineSelect
              label="Hands over at"
              value={String(kid.utmaHandoverAge)}
              options={utmaAgeOptions(kid.utmaHandoverAge).map((n) => ({ value: String(n), label: String(n) }))}
              save={(age) => run(() => setKidUtmaAge(kid.id, Number(age)))}
            />
          </Detail>
        ) : null}
        {handOverDate ? <Detail label="Hands over">{item.type === "UTMA" ? monthYear(handOverDate) : fullDate(handOverDate)}</Detail> : null}
        {tax ? <Detail label="Tax">{tax}</Detail> : null}
        {linkedItem ? <Detail label="Budget item">{linkedItem}</Detail> : null}
        {estate?.beneficiary ? <Detail label="Estate beneficiary">{estate.beneficiary}</Detail> : null}
        {estate?.contact ? <Detail label="Estate contact">{estate.contact}</Detail> : null}
        {estate?.notes ? <Detail label="Estate notes">{estate.notes}</Detail> : null}
      </dl>
      {error ? <p className="text-sm font-semibold text-negative">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {closed ? (
          <button
            type="button"
            disabled={reopening}
            className={actionClass(false)}
            onClick={() => {
              const fd = new FormData();
              fd.set("accountId", item.accountId);
              fd.set("bucketId", item.bucketId ?? "");
              startReopen(async () => {
                setError(null);
                try {
                  const res = await reopenKidItem(fd);
                  if (res.error) setError(res.error);
                  else router.refresh();
                } catch {
                  setError("Couldn't reopen. Check your connection and try again.");
                }
              });
            }}
          >
            {reopening ? "Reopening…" : "Reopen (entered by mistake)"}
          </button>
        ) : (
          <>
            <button type="button" aria-pressed={action === "edit"} className={actionClass(action === "edit")} onClick={() => toggle("edit")}>Edit details</button>
            {allowed.changeBeneficiary ? <button type="button" aria-pressed={action === "transfer"} className={actionClass(action === "transfer")} onClick={() => toggle("transfer")}>Transfer</button> : null}
            {allowed.handOver ? <button type="button" aria-pressed={action === "handover"} className={actionClass(action === "handover")} onClick={() => toggle("handover")}>Hand over</button> : null}
            {allowed.close ? <button type="button" aria-pressed={action === "close"} className={dangerClass(action === "close")} onClick={() => toggle("close")}>Close account</button> : null}
          </>
        )}
      </div>

      {action === "transfer" ? <TransferForm item={item} kids={data.kids} others={other529s} money={money} onDone={done} /> : null}
      {action === "close" ? <EndItemForm item={item} kid={kid} reason="closed" money={money} onDone={done} /> : null}
      {action === "handover" ? <EndItemForm item={item} kid={kid} reason="handed_over" money={money} onDone={done} /> : null}
      {action === "edit" ? <EditItemForm item={item} onDone={done} /> : null}

      {events.length > 0 ? (
        <div>
          <p className="text-xs font-semibold sm:text-[15px]">History</p>
          <ul className="mt-0.5 space-y-0.5">
            {events.map((e) => (
              <li key={e.id} className="text-xs font-medium sm:text-[15px]">
                {fullDate(e.occurredOn)}: {eventText(e, kidName, money)}{e.note ? ` (${e.note})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  kid,
  allItems,
  data,
  estate,
  historyMonths,
  money,
  renderCell,
}: {
  item: KidItem;
  kid: KidData | null;
  allItems: KidItem[];
  data: KidsFundingData;
  estate: { beneficiary?: string | null; transfer?: string | null; contact?: string | null; notes?: string | null } | null;
  historyMonths: string[];
  money: (c: number) => string;
  renderCell: (item: KidItem, monthIndex: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closed = item.dateClosed != null;
  const summary = itemSummary(item, kid, data.contributedThisYear[item.bucketId ?? item.accountId], money);
  const title = item.type ? `${item.type}${item.last4 ? ` ·${item.last4}` : ""}` : item.name;
  return (
    <li>
      <div className={`grid ${KID_ROW_GRID} items-center gap-1.5 px-4 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-950/40`}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 items-start gap-1.5 text-left">
          <span className="pt-1"><Chevron open={open} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">
              {title}
              {!closed && summary.limit ? (
                <span className={`block text-xs sm:ml-2 sm:inline sm:text-[15px] ${summary.overLimit ? "font-semibold text-negative" : "font-medium"}`}>{summary.limit}</span>
              ) : null}
            </span>
            <span className="block text-xs font-medium sm:text-[15px]">
              {closed
                ? `${item.closedReason === "handed_over" ? `Handed over to ${kid?.name ?? "the child"}` : "Closed"} ${fullDate(item.dateClosed!)}`
                : summary.line}
            </span>
          </span>
        </button>
        {historyMonths.map((m, i) => (
          <div key={m} className={monthTier(i)}>
            {closed ? (
              <span className="block text-center text-sm font-medium tabular-nums">{item.balancesByMonth[m] ? money(item.balancesByMonth[m]) : ""}</span>
            ) : renderCell(item, i)}
          </div>
        ))}
      </div>
      {open ? <KidItemPanel item={item} kid={kid} allItems={allItems} data={data} estate={estate} money={money} /> : null}
    </li>
  );
}

function ChildGroup({
  kid,
  items,
  allItems,
  data,
  estateOf,
  historyMonths,
  isPastPeriod,
  money,
  renderCell,
}: {
  kid: KidData | null;
  items: KidItem[];
  allItems: KidItem[];
  data: KidsFundingData;
  estateOf: (item: KidItem) => { beneficiary?: string | null; transfer?: string | null; contact?: string | null; notes?: string | null } | null;
  historyMonths: string[];
  isPastPeriod: boolean;
  money: (c: number) => string;
  renderCell: (item: KidItem, monthIndex: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [closedOpen, setClosedOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const live = items.filter((i) => !i.dateClosed).sort(byType);
  const ended = items.filter((i) => i.dateClosed).sort(byType);

  // A column's total, or nothing if none of its items had a value that month.
  const totalFor = (month: string, column: number): number | null => {
    if (column === 0 && !isPastPeriod) return items.reduce((s, i) => s + i.balanceCents, 0);
    const values = items.map((i) => i.balancesByMonth[month]).filter((v): v is number => v != null);
    return values.length > 0 ? values.reduce((s, v) => s + v, 0) : null;
  };
  const adultOn = kid ? monthAtAge(kid.birthMonth, 18) : null;

  return (
    <section>
      <div className={`grid ${KID_ROW_GRID} items-center gap-1.5 border-y border-line/60 ${SAGE} px-4 py-1.5`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 items-center gap-1.5 text-left">
            <Chevron open={open} />
            <span className="text-sm font-semibold">{kid?.name ?? "Not assigned"}</span>
            {adultOn ? (
              <span className="text-xs font-medium sm:text-[15px]">· {adultOn <= localToday() ? "turned" : "turns"} 18 in {monthYear(adultOn)}</span>
            ) : null}
          </button>
          {kid ? (
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded px-1 text-xs font-medium underline sm:text-[15px]">
              Edit
            </button>
          ) : null}
        </div>
        {historyMonths.map((m, i) => {
          const total = totalFor(m, i);
          return (
            <div key={m} className={monthTier(i)}>
              <span className="block text-center text-sm font-semibold tabular-nums">{total ? money(total) : ""}</span>
            </div>
          );
        })}
      </div>
      {editing && kid ? (
        <div className="border-b border-line/60 bg-background/60 px-4 py-3">
          <ActionForm
            submit="Save"
            action={saveKid}
            onDone={() => setEditing(false)}
            extra={items.length === 0 ? (
              <button
                type="button"
                disabled={removing}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("id", kid.id);
                  startRemove(async () => {
                    setRemoveError(null);
                    try {
                      const res = await deleteKid(fd);
                      if (res.error) setRemoveError(res.error);
                      else router.refresh();
                    } catch {
                      setRemoveError("Couldn't remove them. Check your connection and try again.");
                    }
                  });
                }}
                className="rounded-md px-2 py-1.5 text-xs font-medium text-negative transition hover:bg-negative/10 sm:text-[15px]"
              >
                Remove {kid.name}
              </button>
            ) : null}
          >
            <input type="hidden" name="id" value={kid.id} />
            <ChildFields kid={kid} />
          </ActionForm>
          {removeError ? <p className="pt-1 text-sm font-semibold text-negative">{removeError}</p> : null}
        </div>
      ) : null}
      {open ? (
        <>
          <ul className="divide-y divide-line/60">
            {live.map((item) => (
              <ItemRow key={item.key} item={item} kid={kid} allItems={allItems} data={data} estate={estateOf(item)} historyMonths={historyMonths} money={money} renderCell={renderCell} />
            ))}
          </ul>
          {live.length === 0 && ended.length === 0 ? <p className="px-4 py-2 text-xs">Nothing yet. Use Add account above.</p> : null}
          {ended.length > 0 ? (
            <div className="border-t border-line/60">
              <button type="button" onClick={() => setClosedOpen((v) => !v)} aria-expanded={closedOpen} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold">
                <Chevron open={closedOpen} />
                Closed and handed over ({ended.length})
              </button>
              {closedOpen ? (
                <ul className="divide-y divide-line/60">
                  {ended.map((item) => (
                    <ItemRow key={item.key} item={item} kid={kid} allItems={allItems} data={data} estate={estateOf(item)} historyMonths={historyMonths} money={money} renderCell={renderCell} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** The Kids Funding popup's body: a strip per child, a two-line row per account. */
export function KidsFundingBody({
  accounts,
  data,
  estate,
  historyMonths,
  isPastPeriod,
  money,
  renderCell,
}: {
  accounts: AccountData[];
  data: KidsFundingData;
  estate: Record<string, { beneficiary?: string | null; transfer?: string | null; contact?: string | null; notes?: string | null }>;
  historyMonths: string[];
  isPastPeriod: boolean;
  money: (c: number) => string;
  renderCell: (item: KidItem, monthIndex: number) => React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const allItems = kidItemsOf(accounts);
  const unassigned = allItems.filter((i) => !i.kidId || !data.kids.some((k) => k.id === i.kidId));
  const shared = {
    allItems,
    data,
    historyMonths,
    isPastPeriod,
    money,
    renderCell,
    // Estate details live on the account, so only an item that IS the account
    // shows them. Fidelity's and Cap One's stay in the Estate guide.
    estateOf: (item: KidItem) => (item.bucketId ? null : estate[item.accountId] ?? null),
  };
  return (
    <div>
      <div className={`grid ${KID_ROW_GRID} sticky top-0 z-10 items-center gap-1.5 border-b border-line/60 bg-background px-4 py-1 font-semibold uppercase tracking-wide max-sm:text-[11px] sm:text-[14px]`}>
        <span>Not in Net Worth</span>
        {historyMonths.map((m, i) => (
          <span key={m} className={`text-center ${monthHeadTier(i)}`}>{monthAbbr(m)}</span>
        ))}
      </div>
      {data.kids.map((kid) => (
        <ChildGroup key={kid.id} kid={kid} items={allItems.filter((i) => i.kidId === kid.id)} {...shared} />
      ))}
      {unassigned.length > 0 ? <ChildGroup kid={null} items={unassigned} {...shared} /> : null}
      <div className="border-t border-line/60 px-4 py-2">
        {adding ? (
          <ActionForm submit="Add" action={saveKid} onDone={() => setAdding(false)}>
            <ChildFields />
          </ActionForm>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-xs font-medium text-brand hover:text-brand-strong">
            + Add child
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Add account for Kids Funding. One Account type sets the account's kind, tax
 * treatment and limit behind the scenes, so they can't contradict each other,
 * and the name fills itself in from the type and the child.
 */
export function KidsAddForm({
  data,
  onDone,
}: {
  data: KidsFundingData;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Same guard as ActionForm: taps in the same instant beat the disabled button.
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<KidAccountType>("Trump Account");
  const [kidId, setKidId] = useState("");
  const [newName, setNewName] = useState("");
  // Someone new, once saved: a retry after the account was refused updates them
  // instead of adding them twice.
  const [savedNewKidId, setSavedNewKidId] = useState<string | null>(null);
  const [typedName, setTypedName] = useState<string | null>(null);
  const isNew = kidId === "__new";
  const childName = isNew ? newName.trim() : data.kids.find((k) => k.id === kidId)?.name ?? "";
  const preset = KID_ACCOUNT_TYPES.find((t) => t.type === type)!;
  const suggested = childName
    ? type === "Checking" || type === "Savings" ? `${childName} ${type}` : `${type} ${childName}`
    : "";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (saving.current) return;
        saving.current = true;
        const fd = new FormData(e.currentTarget);
        start(async () => {
          setError(null);
          try {
            if (isNew) {
              const person = new FormData();
              if (savedNewKidId) person.set("id", savedNewKidId);
              person.set("name", String(fd.get("newKidName") ?? ""));
              person.set("birthMonth", String(fd.get("newKidBorn") ?? ""));
              const saved = await saveKid(person);
              if (saved.error || !saved.id) {
                setError(saved.error ?? "Couldn't add them.");
                saving.current = false;
                return;
              }
              setSavedNewKidId(saved.id);
              fd.set("kidId", saved.id);
            }
            const res = await addAccount(fd);
            if (res?.error) {
              setError(res.error);
              saving.current = false;
            } else {
              router.refresh();
              onDone();
            }
          } catch {
            // A lost connection rejects instead of returning an error.
            setError("Couldn't save. Check your connection and try again.");
            saving.current = false;
          }
        });
      }}
      className="grid gap-3 px-5 py-4 sm:grid-cols-2"
    >
      <input type="hidden" name="kidsAccount" value="on" />
      <input type="hidden" name="kind" value={preset.kind} />
      <input type="hidden" name="subtype" value={preset.type} />
      <input type="hidden" name="taxTreatment" value={preset.tax} />
      <input type="hidden" name="retirementKind" value={preset.retirementKind ?? ""} />
      <input type="hidden" name="holder" value={childName} />
      <Select label="Account type" value={type} onChange={(e) => setType(e.target.value as KidAccountType)}>
        {KID_ACCOUNT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
      </Select>
      <Select label={type === "529" ? "Beneficiary" : "For"} name="kidId" required value={kidId} onChange={(e) => setKidId(e.target.value)}>
        <option value="">Pick a child</option>
        {data.kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        <option value="__new">+ Someone new</option>
      </Select>
      {isNew ? (
        <>
          <TextField label="Name" width="" name="newKidName" required value={newName} onChange={(e) => setNewName(e.target.value)} />
          <TextField label="Born" width="" name="newKidBorn" type="month" required />
        </>
      ) : null}
      <LabeledInput label="Account name" name="name" required autoComplete="off" value={typedName ?? suggested} onChange={(e) => { setTypedName(e.target.value); setError(null); }} placeholder="e.g. Trump Account Leo" />
      <LabeledInput label="Institution" name="institution" autoComplete="off" placeholder="e.g. Fidelity" />
      <LabeledInput label="Last 4" name="accountNumber" autoComplete="off" inputMode="numeric" placeholder="e.g. 1028" />
      <Select label={preset.controllerLabel} name="controlledBy" defaultValue="">
        <option value="">Not set</option>
        {data.controllers.map((n) => <option key={n} value={n}>{n}</option>)}
      </Select>
      <LabeledInput label="Current balance" name="balance" type="number" step="0.01" inputMode="decimal" placeholder="0.00" />
      {type === "529" ? <LabeledInput label="Successor owner" name="successorOwner" autoComplete="off" /> : null}
      {error ? <p className="text-sm font-semibold text-negative sm:col-span-2">{error}</p> : null}
      <div className="flex items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60">
          {pending ? "Adding…" : "Add account"}
        </button>
        <button type="button" onClick={onDone} className="rounded-md px-2 py-2 text-sm text-foreground hover:bg-sky-50 dark:hover:bg-sky-950/40">
          Cancel
        </button>
      </div>
    </form>
  );
}

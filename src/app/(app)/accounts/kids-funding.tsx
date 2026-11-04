"use client";

import { useRouter } from "next/navigation";
import React, { useRef, useState, useTransition } from "react";
import {
  KID_ACCOUNT_TYPES,
  TRUMP_ANNUAL_LIMIT_CENTS,
  fullDate,
  handOverFrom,
  handOverStatus,
  kidActionsFor,
  kidDeleteWarning,
  kidSaveLabel,
  kidTypeLocked,
  kidTypeOf,
  kidTypeRank,
  monthAtAge,
  monthYear,
  successorLabelFor,
  trumpOpensOn,
  US_STATES,
  utmaAgeOptions,
  utmaGiftAge,
  utmaLine,
  utmaStateName,
  utmaTransferNote,
  type KidAccountType,
} from "@/lib/kids-funding";
import { displayToCents } from "@/lib/money";
import { TAX_LABEL_SHORT, type TaxTreatment } from "@/lib/tax-treatment";
import { addAccount } from "./actions";
import { deleteKid, deleteKidItem, kidItemBudgetItems, reopenKidItem, saveKid, saveKidItem } from "./kids-actions";
import { monthAbbr, monthHeadTier, monthTier } from "./month-columns";
import { LABEL_CLS } from "./shared-ui";
import type { AccountData, KidData, KidEvent, KidsFundingData } from "./types";

// Kids Funding, organised the way the money actually works: by child. A UTMA's
// state and hand-over age are per account, and the brokerage login it sits under
// is only a label. Fidelity and Cap One stay as they are
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
  successorOwner: string | null;
  utmaState: string | null;
  utmaAge: number | null;
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
        successorOwner: b.successorOwner ?? a.successorOwner ?? null,
        utmaState: b.utmaState ?? null,
        utmaAge: b.utmaHandoverAge ?? null,
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
      successorOwner: a.successorOwner ?? null,
      utmaState: a.utmaState ?? null,
      utmaAge: a.utmaHandoverAge ?? null,
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
// A clear edge, so a field reads as something to type in. A changed one turns
// teal until it's saved, so a look at the form shows what Save will write.
const fieldClass = (changed?: boolean) =>
  `w-full rounded-md bg-surface px-2 py-1 text-sm text-foreground sm:h-8 placeholder:text-foreground/70 focus:outline-none focus:ring-2 focus:ring-brand max-sm:py-2.5 ${
    changed ? "ring-2 ring-[var(--viz-bills)]" : "ring-1 ring-foreground/50"
  }`;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Under each name: where it is and, if it hands over, when. Whose it is and who
// runs it are in the title and the open row, so they aren't repeated here.
function itemSummary(item: KidItem, kid: KidData | null, contributed: number | undefined, money: (c: number) => string): { line: string; limit?: string; overLimit?: boolean } {
  const parts = (...p: (string | null)[]) => p.filter(Boolean).join(" · ");
  if (item.type === "UTMA") {
    const status = handOverStatus(handOverFrom(item.type, kid?.birthMonth ?? null, item.utmaAge), localToday());
    return {
      line: parts(item.institution, utmaLine(item.utmaState, item.utmaAge, kid?.birthMonth ?? null)),
      limit: status === "past" ? "Past transfer date" : status === "soon" ? "Transfer soon" : undefined,
      overLimit: status === "past",
    };
  }
  if (item.type === "Trump Account") {
    return {
      line: parts(item.institution, kid ? `Transfers ${fullDate(trumpOpensOn(kid.birthMonth))}` : null),
      limit: `${money(contributed ?? 0)} of ${money(TRUMP_ANNUAL_LIMIT_CENTS)} this year`,
      overLimit: (contributed ?? 0) > TRUMP_ANNUAL_LIMIT_CENTS,
    };
  }
  return { line: parts(item.institution) };
}

function eventText(e: KidEvent, kidName: (id: string | null) => string | null, money: (c: number) => string) {
  const from = kidName(e.fromKidId);
  const to = kidName(e.toKidId);
  const amount = e.amountCents ? ` · ${money(e.amountCents)}` : "";
  switch (e.event) {
    case "closed": return `Closed${amount}`;
    case "handed_over": return `Transferred${from ? ` to ${from}` : ""}${amount}`;
    case "reopened": return `Reopened${amount}`;
    case "beneficiary_changed": return `Transferred${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`;
    case "moved_529": return `Transferred ${(e.detail ?? "").toLowerCase().startsWith("from") ? "from" : "to"} ${(e.detail ?? "").replace(/^(to|from) /i, "")}${amount}`;
    case "details_changed": return e.detail ?? "Details changed";
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
// The account form's fields: two across on a phone. Once the popup has room they
// sit on one line, each as wide as what it holds.
const FORM_GRID = "grid grid-cols-2 gap-x-3 gap-y-2.5 @[860px]:flex @[860px]:flex-wrap @[860px]:items-end @[860px]:gap-x-2.5";
const WIDE_ON_PHONE = "col-span-2";

function Field({ label, width, center = false, children }: { label: string; width: string; center?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${width}`}>
      <span className={`${LABEL_CLS}${center ? " text-center" : ""}`}>{label}</span>
      {children}
    </label>
  );
}

type FieldLook = { label: string; width?: string; center?: boolean; changed?: boolean };

function Select({ label, width = "", center, changed, children, ...props }: FieldLook & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} width={width} center={center}>
      <select {...props} className={fieldClass(changed)}>{children}</select>
    </Field>
  );
}

function TextField({ label, width = "", center, changed, className = "", ...props }: FieldLook & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} width={width} center={center}>
      <input autoComplete="off" {...props} className={`${fieldClass(changed)} ${className}`} />
    </Field>
  );
}

// A click anywhere in the box opens the calendar. showPicker throws without
// browser support; the calendar icon still works then.
const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    /* no-op */
  }
};

// "Born" because it holds a month and a year.
function ChildFields({ kid, nameField = "name", bornField = "birthMonth", onName }: { kid?: KidData | null; nameField?: string; bornField?: string; onName?: (name: string) => void }) {
  return (
    <>
      <TextField label="Name" width={W_NAME} name={nameField} defaultValue={kid?.name ?? ""} required onChange={(e) => onName?.(e.target.value)} />
      <TextField label="Born" width={W_NAME} name={bornField} type="month" defaultValue={kid?.birthMonth.slice(0, 7) ?? ""} required onClick={openPicker} />
    </>
  );
}

// For a row entered by mistake. Everything real ends through Status instead,
// which keeps the row and its past months. The warning names the Budget item too,
// so it has to ask the server before it can show.
function DeleteItem({ item }: { item: KidItem }) {
  const router = useRouter();
  const [warning, setWarning] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (warning == null) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={checking}
          onClick={() => {
            startCheck(async () => {
              setError(null);
              try {
                const res = await kidItemBudgetItems(item.accountId, item.bucketId);
                if (res.error) setError(res.error);
                else setWarning(kidDeleteWarning(res));
              } catch {
                setError("Couldn't check that. Check your connection and try again.");
              }
            });
          }}
          className="rounded-full bg-negative/10 px-3 py-1.5 text-xs font-semibold text-negative ring-1 ring-negative/40 transition hover:bg-negative/20 disabled:opacity-50 sm:text-[15px] max-sm:py-2.5"
        >
          Delete
        </button>
        {error ? <span className="text-sm font-semibold text-negative">{error}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-negative sm:text-[15px]">{warning}</span>
      <button
        type="button"
        disabled={deleting}
        onClick={() => {
          const fd = new FormData();
          fd.set("accountId", item.accountId);
          fd.set("bucketId", item.bucketId ?? "");
          startDelete(async () => {
            setError(null);
            try {
              const res = await deleteKidItem(fd);
              if (res.error) setError(res.error);
              else router.refresh();
            } catch {
              // Uncaught here, a lost connection takes down the whole page.
              setError("Couldn't delete. Check your connection and try again.");
            }
          });
        }}
        className="rounded-md bg-negative px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 sm:text-[15px] max-sm:py-2.5 dark:text-background"
      >
        {deleting ? "Deleting…" : "Yes, erase"}
      </button>
      <button type="button" onClick={() => setWarning(null)} className="rounded-md px-2 py-1.5 text-xs font-medium hover:bg-sky-50 sm:text-[15px] max-sm:py-2.5 dark:hover:bg-sky-950/40">Keep</button>
      {error ? <span className="text-sm font-semibold text-negative">{error}</span> : null}
    </span>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-center text-xs font-medium sm:text-[15px] @[560px]:flex-auto">
      <dt className="font-semibold">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

// What can't be typed over: it follows from something else on the form.
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium sm:text-[15px]">
      <span className="font-semibold">{label}:</span> {children}
    </span>
  );
}

// One short line: "Label: a few words".
function Footnote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium sm:text-[15px]">
      <span className="font-semibold">{label}:</span> {children}
    </p>
  );
}

// A step that opened because of a choice above, marked by its coloured left bar.
function Strip({ title, bar, children }: { title: string; bar: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-2 rounded-md border-l-[3px] ${SAGE} px-3 py-2 @[860px]:w-fit`} style={{ borderLeftColor: bar }}>
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

const UtmaStateOptions = () => (
  <>
    <option value="">Not sure yet</option>
    {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
  </>
);

const UtmaAgeOptions = () => (
  <>
    <option value="">Not sure yet</option>
    {utmaAgeOptions().map((n) => <option key={n} value={n}>{n}</option>)}
  </>
);

// Where to find what's missing, then what the age means for this child.
function UtmaNote({ state, age, kidName, birthMonth }: { state: string; age: string; kidName: string; birthMonth: string | null }) {
  if (!state) return <Footnote label="State">Not where you live or were born. It&apos;s on the account title, e.g. UTMA FL.</Footnote>;
  if (!age) return <Footnote label="Age to transfer">Ask the institution which age it has on file.</Footnote>;
  return <Footnote label="Age to transfer">{utmaTransferNote(state, Number(age), kidName, birthMonth)}</Footnote>;
}

type Tracking = "keep" | "closed" | "handed_over";
type Status = "open" | "transfer" | "closed" | "handed_over";

type EstateInfo = { beneficiary?: string | null; transfer?: string | null; contact?: string | null; notes?: string | null };

// Everything about one account is here, on one Save: its details and its Status.
// Picking a Status opens what that needs, so a transfer can also end the tracking
// in a single step.
function KidItemForm({
  item,
  kid,
  allItems,
  data,
  estate,
  money,
  hasEvents,
  onSaved,
}: {
  item: KidItem;
  kid: KidData | null;
  allItems: KidItem[];
  data: KidsFundingData;
  estate: EstateInfo | null;
  money: (c: number) => string;
  hasEvents: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Same guard as ActionForm: taps in the same instant beat the disabled button.
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const initial = {
    name: item.name,
    type: item.type ?? "",
    kidId: item.kidId ?? "",
    institution: item.institution ?? "",
    last4: item.last4 ?? "",
    successor: item.successorOwner ?? "",
    utmaState: item.utmaState ?? "",
    utmaAge: item.utmaAge == null ? "" : String(item.utmaAge),
  };
  const [f, setF] = useState({
    ...initial,
    howMuch: "all" as "all" | "part",
    into: "",
    amount: "",
    date: localToday(),
    note: "",
    newName: "",
    newBorn: "",
    newInstitution: item.institution ?? "",
    newLast4: "",
    status: "open" as Status,
    tracking: "keep" as Tracking,
    endNote: "",
  });
  const bind = (key: keyof typeof f) => ({
    value: f[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setError(null);
      setF((current) => ({ ...current, [key]: e.target.value }));
    },
  });
  const edited = (key: keyof typeof initial) => f[key].trim() !== initial[key].trim();
  // Picking a state fills in its age, which can still be changed.
  const pickState = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const utmaState = e.target.value;
    setError(null);
    setF((current) => ({ ...current, utmaState, utmaAge: String(utmaGiftAge(utmaState) ?? "") }));
  };

  const allowed = kidActionsFor({
    type: item.type,
    balanceCents: item.balanceCents,
    birthMonth: kid?.birthMonth ?? null,
    utmaAge: item.utmaAge,
    today: localToday(),
  });
  const typeLocked = kidTypeLocked(item.type, hasEvents, Object.keys(item.balancesByMonth).length);
  // The type on screen decides the labels; a saved type decides what's allowed.
  const shownType = f.type || null;
  const preset = KID_ACCOUNT_TYPES.find((t) => t.type === shownType);
  const tax = preset ? TAX_LABEL_SHORT[preset.tax] : item.taxTreatment ? TAX_LABEL_SHORT[item.taxTreatment as TaxTreatment] ?? item.taxTreatment : null;
  const successorLabel = successorLabelFor(shownType);
  const linkedItem = data.linkedItems[item.bucketId ?? item.accountId] ?? null;
  const handOverDate = handOverFrom(item.type, kid?.birthMonth ?? null, f.utmaAge ? Number(f.utmaAge) : null);
  const handOverNow = item.type === "UTMA" ? handOverStatus(handOverDate, localToday()) : null;

  // A UTMA or Trump Account legally belongs to its child, so it never moves.
  const childFixed = !!item.kidId && (item.type === "UTMA" || item.type === "Trump Account");
  const canTransfer = allowed.changeBeneficiary && !!item.kidId;
  const transferring = canTransfer && f.kidId !== item.kidId;
  const isNew = f.kidId === "__new";
  const toName = isNew ? f.newName.trim() : data.kids.find((k) => k.id === f.kidId)?.name ?? "";
  const targets = transferring && !isNew ? allItems.filter((o) => o.type === "529" && !o.dateClosed && o.key !== item.key && o.kidId === f.kidId) : [];
  const canPart = transferring && item.balanceCents > 0;
  const part = canPart && f.howMuch === "part";
  const partCents = part ? displayToCents(f.amount || "0") : null;
  const stopping = f.tracking === "closed";
  const handingOver = f.tracking === "handed_over";
  const wholeGone = transferring && !part && stopping;
  const restCents = item.balanceCents - (partCents ?? 0);
  const statusOptions: { value: Status; label: string }[] = [
    { value: "open", label: "Open" },
    ...(canTransfer ? [{ value: "transfer" as const, label: "Transfer to another child" }] : []),
    ...(allowed.close ? [{ value: "closed" as const, label: "Closed, stop tracking" }] : []),
    ...(allowed.handOver ? [{ value: "handed_over" as const, label: `Transferred to ${kid?.name ?? "the child"}` }] : []),
  ];
  const pickStatus = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const status = e.target.value as Status;
    setError(null);
    setF((current) => ({
      ...current,
      status,
      tracking: status === "closed" || status === "handed_over" ? status : "keep",
      kidId: item.kidId ?? "",
      howMuch: "all",
    }));
  };
  // Back on nobody picked, there's no transfer left to stop tracking after.
  const pickTransferTo = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kidId = e.target.value;
    setError(null);
    setF((current) => ({ ...current, kidId, tracking: kidId === item.kidId ? "keep" : current.tracking }));
  };

  // On a phone, a field left alone on its row takes the whole row.
  const halfFields = 2 + (item.kidId ? 0 : 1) + (successorLabel ? 1 : 0) + (shownType === "UTMA" ? 2 : 0);
  const lastOnItsOwn = halfFields % 2 === 1 ? WIDE_ON_PHONE : "";
  const noteOnItsOwn = part && targets.length <= 1 ? WIDE_ON_PHONE : "";

  const detailsEdited = (["name","institution", "last4", "successor", "utmaState", "utmaAge"] as const).some(edited) || (!typeLocked && edited("type")) || (!canTransfer && !childFixed && edited("kidId"));
  const dirty = detailsEdited || transferring || f.tracking !== "keep";
  const saveLabel = kidSaveLabel({ dirty, transferring, toName, partCents, tracking: f.tracking, restCents, kidName: kid?.name ?? "the child", money });

  const save = () => {
    const fd = new FormData();
    fd.set("accountId", item.accountId);
    fd.set("bucketId", item.bucketId ?? "");
    if (edited("name")) fd.set("name", f.name);
    if (!typeLocked && edited("type")) fd.set("type", f.type);
    if (!canTransfer && !childFixed && edited("kidId")) fd.set("kidId", f.kidId);
    if (edited("institution")) fd.set("institution", f.institution);
    if (edited("last4")) fd.set("accountNumber", f.last4);
    if (edited("successor")) fd.set("successorOwner", f.successor);
    if (edited("utmaState")) fd.set("utmaState", f.utmaState);
    if (edited("utmaAge")) fd.set("utmaAge", f.utmaAge);
    if (transferring || f.tracking !== "keep") fd.set("date", f.date);
    if (transferring) {
      fd.set("toKidId", f.kidId);
      fd.set("howMuch", part ? "part" : "all");
      fd.set("note", f.note);
      fd.set("newKidName", f.newName);
      fd.set("newKidBorn", f.newBorn);
      if (part) {
        const onlyTarget = targets.length === 1 ? `${targets[0].accountId}:${targets[0].bucketId ?? ""}` : "";
        fd.set("to", f.into || onlyTarget);
        fd.set("amount", f.amount);
        fd.set("newInstitution", f.newInstitution);
        fd.set("newLast4", f.newLast4);
      }
    }
    if (f.tracking !== "keep") {
      fd.set("tracking", f.tracking);
      fd.set("endNote", f.endNote);
    }
    return saveKidItem(fd);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (saving.current || !dirty) return;
        saving.current = true;
        start(async () => {
          setError(null);
          try {
            const res = await save();
            if (res.error) {
              setError(res.error);
              saving.current = false;
              // The money has moved, so a second Save mustn't move it again.
              if (res.moved) setF((current) => ({ ...current, status: "open", tracking: "keep", kidId: item.kidId ?? "", howMuch: "all", amount: "", into: "" }));
            } else {
              router.refresh();
              onSaved();
            }
          } catch {
            // A lost connection rejects instead of returning an error. A retry
            // after a move that did land would move the money twice.
            setError(part ? "Connection lost. The transfer may have saved. Reload the page and check the balances before trying again." : "Couldn't save. Check your connection and try again.");
            saving.current = part;
          }
        });
      }}
      className="space-y-3"
    >
      <div className={FORM_GRID}>
        <TextField label="Name" center width="col-span-2 @[860px]:w-40" required changed={edited("name")} {...bind("name")} />
        {typeLocked ? null : (
          <Select label="Account type" center width="col-span-2 @[860px]:w-36" changed={edited("type")} {...bind("type")}>
            {KID_ACCOUNT_TYPES.some((t) => t.type === item.type) ? null : <option value={item.type ?? ""}>{item.type ?? "Not set"}</option>}
            {KID_ACCOUNT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
          </Select>
        )}
        <TextField label="Institution" center width="@[860px]:w-32" placeholder="e.g. Fidelity" changed={edited("institution")} {...bind("institution")} />
        <TextField label="Last 4" center width="@[860px]:w-20" inputMode="numeric" placeholder="e.g. 1028" changed={edited("last4")} {...bind("last4")} />
        {item.kidId ? null : (
          <Select label="For" center width={`${successorLabel ? "" : lastOnItsOwn} @[860px]:w-32`} changed={edited("kidId")} {...bind("kidId")}>
            <option value="">Not set</option>
            {data.kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Select>
        )}
        {successorLabel ? <TextField label={successorLabel} center width={`${shownType === "UTMA" ? "" : lastOnItsOwn} @[860px]:w-56`} placeholder="Person's name" changed={edited("successor")} {...bind("successor")} /> : null}
        {shownType === "UTMA" ? (
          <>
            <Select label="State on account" center width="@[860px]:w-40" changed={edited("utmaState")} value={f.utmaState} onChange={pickState}>
              <UtmaStateOptions />
            </Select>
            <Select label="Age to Transfer" center width={`${lastOnItsOwn} @[860px]:w-36`} changed={edited("utmaAge")} {...bind("utmaAge")}>
              <UtmaAgeOptions />
            </Select>
          </>
        ) : null}
        {statusOptions.length > 1 ? (
          <Select label="Status" center width="col-span-2 @[860px]:w-56" changed={f.status !== "open"} value={f.status} onChange={pickStatus}>
            {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ) : null}
      </div>
      {shownType === "UTMA" ? <UtmaNote state={f.utmaState} age={f.utmaAge} kidName={kid?.name ?? "The child"} birthMonth={kid?.birthMonth ?? null} /> : null}

      {edited("institution") && item.type === "529" ? <Footnote label="Rollover">Once per 12 months, same child</Footnote> : null}

      {f.status === "transfer" ? (
        <Strip title={`Transfer${transferring && toName ? ` to ${toName}` : ""}`} bar="var(--viz-bills)">
          <div className={FORM_GRID}>
            <Select label="To" center width="col-span-2 @[860px]:w-44" required value={f.kidId} onChange={pickTransferTo}>
              <option value={item.kidId ?? ""}>Pick who</option>
              {data.kids.filter((k) => k.id !== item.kidId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              <option value="__new">+ Someone new</option>
            </Select>
            {isNew ? (
              <>
                <TextField label="Their name" center width={`${wholeGone ? "col-span-2" : ""} @[860px]:w-44`} required {...bind("newName")} />
                {wholeGone ? null : <TextField label="Born" center width="@[860px]:w-40" type="month" required onClick={openPicker} {...bind("newBorn")} />}
              </>
            ) : null}
            {canPart ? (
              <Select label="How much" center width="col-span-2 @[860px]:w-72" {...bind("howMuch")}>
                <option value="all">{`Whole account becomes ${toName || "theirs"}${toName ? "'s" : ""}`}</option>
                <option value="part">{targets.length > 0 ? `Part moves to ${toName}'s 529` : `Part starts a 529 for ${toName || "them"}`}</option>
              </Select>
            ) : null}
            {part && targets.length > 1 ? (
              <Select label="Into" center width="@[860px]:w-56" required {...bind("into")}>
                <option value="">Pick a 529</option>
                {targets.map((o) => <option key={o.key} value={`${o.accountId}:${o.bucketId ?? ""}`}>{o.name} · {money(o.balanceCents)}</option>)}
              </Select>
            ) : null}
            {part ? <TextField label="Amount" center width="@[860px]:w-28" className="text-center" type="number" step="0.01" min="0.01" inputMode="decimal" placeholder={`${money(item.balanceCents)} max`} required {...bind("amount")} /> : null}
            {part && targets.length === 0 ? (
              <>
                <TextField label="New 529 institution" center width="@[860px]:w-40" placeholder="e.g. Fidelity" {...bind("newInstitution")} />
                <TextField label="New 529 last 4" center width="@[860px]:w-32" inputMode="numeric" placeholder="e.g. 1028" {...bind("newLast4")} />
              </>
            ) : null}
            <TextField label="Date" center width="@[860px]:w-40" type="date" required onClick={openPicker} {...bind("date")} />
            <TextField label="Note" center width={`${noteOnItsOwn} @[860px]:w-56`} placeholder="Optional" {...bind("note")} />
            {transferring ? (
              <Select label="After this" center width="col-span-2 @[860px]:w-56" {...bind("tracking")}>
                <option value="keep">Keep tracking it here</option>
                <option value="closed">Stop tracking it here</option>
              </Select>
            ) : null}
          </div>
          <div className="space-y-0.5">
            {isNew ? <Footnote label="New person">{wholeGone ? "Not added, since this stops here" : "Gets their own strip here"}</Footnote> : null}
            {!part && !wholeGone ? <Footnote label="Last 4">Update it if the plan gives a new number</Footnote> : null}
            <Footnote label="Family only">Others owe tax and a penalty</Footnote>
            <Footnote label="Younger generation">Possible gift tax</Footnote>
          </div>
        </Strip>
      ) : null}

      {(stopping || handingOver) && !wholeGone ? (
        <Strip title={handingOver ? `Transfer to ${kid?.name ?? "the child"}` : "Stop tracking"} bar="var(--negative)">
          <div className={FORM_GRID}>
            {transferring ? null : <TextField label="Date" center width="@[860px]:w-40" type="date" required onClick={openPicker} {...bind("date")} />}
            {handingOver ? (
              <TextField label="Note" center width="col-span-2 @[860px]:w-64" placeholder="Optional" {...bind("endNote")} />
            ) : (
              <TextField label={part ? "Where did the rest go?" : "Where did the money go?"} center width="col-span-2 @[860px]:w-64" required={restCents > 0} placeholder={restCents > 0 ? "" : "Optional"} {...bind("endNote")} />
            )}
          </div>
          {stopping ? <Footnote label="Here only">Also close it at the plan</Footnote> : null}
        </Strip>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {tax ? <Fact label="Tax">{tax}</Fact> : null}
        {linkedItem ? <Fact label="Budget item">{linkedItem}</Fact> : null}
        {estate?.beneficiary ? <Fact label="Estate beneficiary">{estate.beneficiary}</Fact> : null}
        {estate?.contact ? <Fact label="Estate contact">{estate.contact}</Fact> : null}
        {estate?.notes ? <Fact label="Estate notes">{estate.notes}</Fact> : null}
      </div>

      {handOverNow === "past" ? <Footnote label="Past transfer date">Some, like Fidelity, block new money and purchases until it&apos;s done.</Footnote> : null}

      {error ? <p className="text-sm font-semibold text-negative">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || !dirty}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50 sm:text-[15px] max-sm:py-2.5 ${stopping && !wholeGone && restCents > 0 ? "bg-negative text-white dark:text-background" : "bg-brand text-white"}`}
        >
          {pending ? "Saving…" : saveLabel}
        </button>
        {dirty ? (
          <button type="button" onClick={onSaved} className="rounded-md px-2 py-1.5 text-xs font-medium text-foreground hover:bg-sky-50 sm:text-[15px] max-sm:py-2.5 dark:hover:bg-sky-950/40">
            Cancel
          </button>
        ) : null}
        <DeleteItem item={item} />
      </div>
    </form>
  );
}

// A closed row is the record of what it was, with the way back.
function ClosedItem({ item, data }: { item: KidItem; data: KidsFundingData }) {
  const router = useRouter();
  const [reopening, startReopen] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const linkedItem = data.linkedItems[item.bucketId ?? item.accountId] ?? null;
  const tax = item.taxTreatment ? TAX_LABEL_SHORT[item.taxTreatment as TaxTreatment] ?? item.taxTreatment : null;
  const successorLabel = successorLabelFor(item.type);
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @[560px]:flex @[560px]:flex-wrap @[560px]:gap-x-6">
        <Detail label="Institution">{item.institution ?? "Not set"}</Detail>
        <Detail label="Last 4">{item.last4 ?? "Not set"}</Detail>
        {successorLabel ? <Detail label={successorLabel}>{item.successorOwner ?? "Not set"}</Detail> : null}
        {item.type === "UTMA" ? <Detail label="State on account">{utmaStateName(item.utmaState) ?? "Not set"}</Detail> : null}
        {tax ? <Detail label="Tax">{tax}</Detail> : null}
        {linkedItem ? <Detail label="Budget item">{linkedItem}</Detail> : null}
      </dl>
      {error ? <p className="text-sm font-semibold text-negative">{error}</p> : null}
      <button
        type="button"
        disabled={reopening}
        className="shrink-0 rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 sm:text-[15px] dark:hover:bg-sky-900/50"
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
        {reopening ? "Reopening…" : "Reopen"}
      </button>
    </>
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
  estate: EstateInfo | null;
  money: (c: number) => string;
}) {
  // Cancel and a save both start the form over, and a saved value changes the
  // key, so it always shows what the server now holds.
  const [resets, setResets] = useState(0);
  const kidName = (id: string | null) => data.kids.find((k) => k.id === id)?.name ?? null;
  const events = data.events.filter((e) => e.accountId === item.accountId && e.bucketId === item.bucketId);
  const formKey = [resets, item.name, item.type, item.kidId, item.institution, item.last4, item.successorOwner, item.utmaState, item.utmaAge].join("|");

  return (
    <div className="space-y-3 border-t border-line/60 bg-background/60 px-4 py-3">
      {item.dateClosed != null ? (
        <ClosedItem item={item} data={data} />
      ) : (
        <KidItemForm key={formKey} item={item} kid={kid} allItems={allItems} data={data} estate={estate} money={money} hasEvents={events.length > 0} onSaved={() => setResets((n) => n + 1)} />
      )}

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
  estate: EstateInfo | null;
  historyMonths: string[];
  money: (c: number) => string;
  renderCell: (item: KidItem, monthIndex: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closed = item.dateClosed != null;
  const summary = itemSummary(item, kid, data.contributedThisYear[item.bucketId ?? item.accountId], money);
  const title = item.type && kid ? `${kid.name}'s ${item.type}` : item.name;
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
                ? `${item.closedReason === "handed_over" ? `Transferred to ${kid?.name ?? "the child"}` : `${kid ? `${kid.name} · ` : ""}Closed`} ${fullDate(item.dateClosed!)}`
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
  estateOf: (item: KidItem) => EstateInfo | null;
  historyMonths: string[];
  isPastPeriod: boolean;
  money: (c: number) => string;
  renderCell: (item: KidItem, monthIndex: number) => React.ReactNode;
}) {
  const live = items.filter((i) => !i.dateClosed).sort(byType);
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

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
              Edit {kid.name}
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
          {items.length === 0 ? <p className="px-4 py-2 text-xs">Nothing yet. Use Add account above.</p> : null}
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
  estate: Record<string, EstateInfo>;
  historyMonths: string[];
  isPastPeriod: boolean;
  money: (c: number) => string;
  renderCell: (item: KidItem, monthIndex: number) => React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const allItems = kidItemsOf(accounts);
  const unassigned = allItems.filter((i) => !i.dateClosed && (!i.kidId || !data.kids.some((k) => k.id === i.kidId)));
  // Once an account ends it's no longer tracked, so it leaves its child's list,
  // and a child left with nothing open leaves with it. One collapsed list at the
  // bottom keeps them all for a Reopen.
  const closed = allItems.filter((i) => i.dateClosed).sort(byType);
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
      {data.kids.map((kid) => {
        const items = allItems.filter((i) => i.kidId === kid.id);
        if (items.length > 0 && items.every((i) => i.dateClosed)) return null;
        return <ChildGroup key={kid.id} kid={kid} items={items} {...shared} />;
      })}
      {unassigned.length > 0 ? <ChildGroup kid={null} items={unassigned} {...shared} /> : null}
      {closed.length > 0 ? (
        <div className="border-t border-line/60">
          <button type="button" onClick={() => setClosedOpen((v) => !v)} aria-expanded={closedOpen} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold sm:text-[15px]">
            <Chevron open={closedOpen} />
            Closed accounts ({closed.length})
          </button>
          {closedOpen ? (
            <ul className="divide-y divide-line/60">
              {closed.map((item) => (
                <ItemRow key={item.key} item={item} kid={data.kids.find((k) => k.id === item.kidId) ?? null} allItems={allItems} data={data} estate={shared.estateOf(item)} historyMonths={historyMonths} money={money} renderCell={renderCell} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
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
  const [utmaState, setUtmaState] = useState("");
  const [utmaAge, setUtmaAge] = useState("");
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
      <Select label="For" name="kidId" required value={kidId} onChange={(e) => setKidId(e.target.value)}>
        <option value="">Pick a child</option>
        {data.kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        <option value="__new">+ Someone new</option>
      </Select>
      {isNew ? (
        <>
          <TextField label="Name" name="newKidName" required value={newName} onChange={(e) => setNewName(e.target.value)} />
          <TextField label="Born" name="newKidBorn" type="month" required onClick={openPicker} />
          <div className="sm:col-span-2"><Footnote label="New person">Gets their own strip here</Footnote></div>
        </>
      ) : null}
      <TextField label="Account name" name="name" required value={typedName ?? suggested} onChange={(e) => { setTypedName(e.target.value); setError(null); }} placeholder="e.g. Trump Account Leo" />
      <TextField label="Institution" name="institution" placeholder="e.g. Fidelity" />
      <TextField label="Last 4" name="accountNumber" inputMode="numeric" placeholder="e.g. 1028" />
      <TextField label="Current balance" name="balance" type="number" step="0.01" inputMode="decimal" placeholder="0.00" />
      {successorLabelFor(type) ? <TextField label={successorLabelFor(type)!} name="successorOwner" placeholder="Person's name" /> : null}
      {type === "UTMA" ? (
        <>
          <Select label="State on account" name="utmaState" value={utmaState} onChange={(e) => { setUtmaState(e.target.value); setUtmaAge(String(utmaGiftAge(e.target.value) ?? "")); }}>
            <UtmaStateOptions />
          </Select>
          <Select label="Age to Transfer" name="utmaAge" value={utmaAge} onChange={(e) => setUtmaAge(e.target.value)}>
            <UtmaAgeOptions />
          </Select>
          <div className="sm:col-span-2"><UtmaNote state={utmaState} age={utmaAge} kidName={childName || "The child"} birthMonth={data.kids.find((k) => k.id === kidId)?.birthMonth ?? null} /></div>
        </>
      ) : null}
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

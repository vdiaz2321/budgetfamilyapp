"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ModalShell } from "@/components/modal-shell";
import { centsToDisplay, formatMoneyWhole } from "@/lib/money";
import type { AccountData, BudgetDebt } from "./types";
import {
  addEstateItem,
  deleteEstateItem,
  saveAccountEstateField,
  saveEstateGuideField,
  saveEstateItemField,
} from "./estate-actions";
import { AccentEdge } from "../budget/category-icons";

// Estate guide (Accounts → "Estate guide"): one place, and one printout, for
// Victor's family to see every open account, who it passes to, who to call,
// and the steps his will asks for. No account numbers: the guide is printed
// and handed around.

export type EstateAccountFields = {
  beneficiary: string | null;
  transfer: string | null;
  contact: string | null;
  notes: string | null;
  /** Left off the guide (and its printout); still on the Accounts page. */
  hidden: boolean;
};

export type EstateItem = {
  id: string;
  kind: string;
  name: string;
  amountCents: number | null;
  beneficiary: string | null;
  contact: string | null;
  notes: string | null;
};

export type EstateData = {
  accounts: Record<string, EstateAccountFields>;
  guide: {
    executor: string | null;
    willLocation: string | null;
    attorney: string | null;
    powerOfAttorney: string | null;
    instructions: string | null;
  };
  items: EstateItem[];
};

const TRANSFER_LABEL: Record<string, string> = {
  beneficiary: "Named beneficiary",
  pod: "Payable on death (POD)",
  tod: "Transfer on death (TOD)",
  joint: "Joint owner keeps it",
  will: "Goes through the will",
  close: "Close the account",
};

const ITEM_KIND_LABEL: Record<string, string> = {
  insurance: "Life insurance",
  benefit: "Survivor benefit",
  property: "Property",
  digital: "Digital account",
  other: "Other",
};

// The usual military-family entries, one tap each.
const PRESETS: { kind: string; name: string }[] = [
  { kind: "insurance", name: "SGLI" },
  { kind: "insurance", name: "VGLI" },
  { kind: "benefit", name: "SBP (Survivor Benefit Plan)" },
  { kind: "benefit", name: "VA DIC" },
  { kind: "benefit", name: "Social Security survivor" },
];

const SECTIONS: { label: string; match: (a: AccountData) => boolean }[] = [
  { label: "Bank", match: (a) => !a.isKidsAccount && (a.kind === "checking" || a.kind === "cash") },
  { label: "Savings", match: (a) => !a.isKidsAccount && a.kind === "savings_bucket" },
  { label: "Investments & retirement", match: (a) => !a.isKidsAccount && a.kind === "investment" },
  { label: "Property", match: (a) => !a.isKidsAccount && a.kind === "property" },
  { label: "Kids", match: (a) => a.isKidsAccount },
  { label: "Credit cards", match: (a) => !a.isKidsAccount && a.kind === "credit_card" },
  { label: "Loans", match: (a) => !a.isKidsAccount && a.kind === "debt_loan" },
];
const inSomeSection = (a: AccountData) => SECTIONS.some((s) => s.match(a));

const EMPTY_FIELDS: EstateAccountFields = { beneficiary: null, transfer: null, contact: null, notes: null, hidden: false };
const HIDDEN = "__hidden";
const NEW_NAME = "__new";

const uniqueNames = (names: (string | null | undefined)[]) =>
  Array.from(new Set(names.map((n) => (n ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

/** Open accounts on the guide whose "Passes by" is still blank — the badge
 *  on the Accounts header, so a new account isn't forgotten. */
export function estateToFillCount(accounts: AccountData[], estate: EstateData): number {
  return accounts.filter((a) => {
    if (!a.active || !inSomeSection(a)) return false;
    const f = estate.accounts[a.id];
    return !f?.hidden && !f?.transfer;
  }).length;
}

const ownerLabel = (a: AccountData) =>
  [a.holder, a.ownership === "joint" ? "Joint" : null].filter(Boolean).join(" · ") || "—";

// Cards and loans read as what's owed; everything else as what it holds.
const owes = (a: AccountData) => a.kind === "credit_card" || a.kind === "debt_loan";
const valueOf = (a: AccountData) =>
  a.kind === "credit_card" ? -(a.owedCents ?? 0) : a.kind === "debt_loan" ? -Math.abs(a.balanceCents) : a.balanceCents;

// White boxes with an accent-tinted ring, so they read as fillable on the
// tinted section cards (the old pale boxes on a pale page read as disabled).
// The var(--viz-savings) fallback covers Add account, which sets no --acc.
const inputCls =
  "w-full min-w-0 rounded-md bg-surface px-2 py-1.5 text-sm font-semibold ring-1 ring-[color-mix(in_srgb,var(--foreground)_22%,var(--border))] placeholder:font-normal placeholder:italic placeholder:text-foreground dark:placeholder:text-[color-mix(in_srgb,var(--foreground)_70%,var(--surface))] hover:ring-[color-mix(in_srgb,var(--foreground)_40%,var(--border))] focus:outline-none focus:ring-2 focus:ring-brand";
// Inside a NotesBox: the box draws the border, the field stays plain.
const bareCls =
  "w-full min-w-0 bg-transparent py-0.5 text-sm font-semibold placeholder:font-normal placeholder:italic placeholder:text-foreground dark:placeholder:text-[color-mix(in_srgb,var(--foreground)_70%,var(--surface))] focus:outline-none";

// Saves on blur when the text changed. Uncontrolled, keyed by the saved value,
// so a refresh after saving shows what the server holds.
function SaveField({
  initial,
  placeholder,
  onSave,
  multiline = false,
  label,
  bare = false,
}: {
  initial: string | null;
  placeholder?: string;
  onSave: (value: string) => void;
  multiline?: boolean;
  label: string;
  bare?: boolean;
}) {
  const start = initial ?? "";
  const common = {
    defaultValue: start,
    placeholder,
    "aria-label": label,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.currentTarget.value.trim() !== start.trim()) onSave(e.currentTarget.value);
    },
  };
  return multiline ? (
    // Starts two lines tall; drag the corner for more.
    <textarea key={start} rows={2} {...common} className={`${bare ? bareCls : inputCls} min-h-[61px] resize-y`} />
  ) : (
    <input key={start} type="text" autoComplete="off" {...common} className={bare ? bareCls : inputCls} />
  );
}

// A person picked from the names already in the guide. "New name…" asks for
// one; once saved it joins every other name dropdown too.
function NameSelect({
  label,
  value,
  names,
  onSave,
}: {
  label: string;
  value: string | null;
  names: string[];
  onSave: (value: string) => void;
}) {
  const current = value ?? "";
  // A saved name always shows, even if it's somehow not in the shared list.
  const options = current && !names.includes(current) ? [...names, current] : names;
  // "New name…" turns the dropdown into a box right here. (A browser pop-up
  // was used before, but the app's own browser blocks those silently.)
  const [typing, setTyping] = useState(false);
  if (typing) {
    const finish = (v: string) => {
      setTyping(false);
      if (v.trim() && v.trim() !== current) onSave(v.trim());
    };
    return (
      <input
        autoFocus
        aria-label={label}
        placeholder="Type a name, then Enter"
        onBlur={(e) => finish(e.currentTarget.value)}
        // Clicking away with the box empty cancels.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={inputCls}
      />
    );
  }
  return (
    <select
      aria-label={label}
      defaultValue={current}
      key={current}
      onChange={(e) => {
        const v = e.currentTarget.value;
        if (v === NEW_NAME) {
          e.currentTarget.value = current;
          setTyping(true);
          return;
        }
        onSave(v);
      }}
      className={inputCls}
    >
      <option value="">—</option>
      {options.map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
      <option value={NEW_NAME}>New name…</option>
    </select>
  );
}

// Column labels sit centered over their boxes, and so do the values typed in
// them (Victor centers headers and figures alike). The one full-width text
// box (Steps for the family) keeps its label and text at the left.
function Labeled({ label, children, className = "", center = true }: { label: string; children: React.ReactNode; className?: string; center?: boolean }) {
  return (
    <label className={`block min-w-0 ${center ? "text-center [&_input]:text-center [&_select]:text-center [&_select]:[text-align-last:center]" : ""} ${className}`}>
      <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-foreground">{label}</span>
      {children}
    </label>
  );
}

// Each step card and account group carries a calm accent as --acc.
const acc = (c: string) => ({ "--acc": c }) as React.CSSProperties;
const GROUP_ACC: Record<string, string> = {
  Bank: "var(--viz-income)",
  Savings: "var(--viz-savings)",
  "Investments & retirement": "var(--positive)",
  Property: "var(--viz-bills)",
  Kids: "var(--viz-expenses)",
  "Credit cards": "var(--viz-debt)",
  Loans: "var(--negative)",
};
// Plain white step cards: a tinted wash here read as washed-out blue-on-blue
// (and navy at 6% came out lavender). The accent lives in the number badge.
// Dark mode: the cards step down to the darker page colour so the input and
// notes boxes (bg-surface) stand out as lighter boxes instead of blending in.
const STEP_CLS = "relative space-y-3 rounded-xl bg-surface p-3 shadow-sm ring-1 ring-line sm:p-4 dark:bg-background";
// Dashed "+ add" buttons: the usual look for "this adds something".
const ADD_CHIP =
  "inline-flex items-center gap-1 rounded-full border border-dashed border-[color-mix(in_srgb,var(--foreground)_35%,var(--border))] bg-surface px-3 py-1.5 text-xs font-bold text-foreground transition hover:border-solid hover:bg-sky-50 disabled:opacity-60 dark:hover:bg-sky-950/40";

// Numbered step heading: the guide reads as a 1-2-3-4 checklist.
function StepHead({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-foreground text-sm font-bold text-[color:var(--surface)]">
        {n}
      </span>
      <h3 className="text-base font-bold">{title}</h3>
      {children ? <div className="ml-auto">{children}</div> : null}
    </div>
  );
}

// "N of M set" with a small bar; turns green once every one is set.
function Progress({ done, total }: { done: number; total: number }) {
  const full = total > 0 && done === total;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--acc)_18%,var(--surface))] sm:w-24 dark:bg-[color-mix(in_srgb,var(--acc)_35%,var(--background))]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${total ? (done / total) * 100 : 0}%`, background: full ? "var(--positive)" : "var(--acc)" }}
        />
      </span>
      <span className={`whitespace-nowrap text-xs font-bold tabular-nums ${full ? "text-positive" : "text-foreground"}`}>
        {done} of {total} set
      </span>
    </span>
  );
}

// Plain bordered notes box with its bold caps label inline (Victor's notes style).
function NotesBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 items-start gap-2 rounded-md bg-surface px-2.5 py-1.5 ring-1 ring-line focus-within:ring-2 focus-within:ring-brand">
      <span className="shrink-0 pt-1 text-[11px] font-bold uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

export function EstateGuideModal({
  accounts,
  debts,
  estate,
  currency,
  onClose,
}: {
  accounts: AccountData[];
  debts: BudgetDebt[];
  estate: EstateData;
  currency: string;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  // Every save goes through here so the header can say Saving… / Saved.
  const save = (fn: () => Promise<void>) => {
    setSaved(false);
    start(async () => {
      await fn();
      setSaved(true);
    });
  };
  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(t);
  }, [saved]);

  const fieldsOf = (id: string): EstateAccountFields => estate.accounts[id] ?? EMPTY_FIELDS;
  const listed = accounts.filter((a) => a.active && inSomeSection(a));
  const open = listed.filter((a) => !fieldsOf(a.id).hidden);
  const hiddenAccounts = listed.filter((a) => fieldsOf(a.id).hidden);
  const setCount = open.filter((a) => fieldsOf(a.id).transfer).length;
  // Every group starts collapsed; open the ones being worked on.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (label: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  // One list of people for every name dropdown: anyone already an owner,
  // beneficiary, executor or power of attorney. "New name…" adds to it.
  const names = estateNames(accounts, estate);
  const owing = debts.filter((d) => d.balanceCents > 0 && !d.accountId);
  const usedPresets = new Set(estate.items.map((i) => i.name));

  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("printing-estate");
    const done = () => {
      document.body.classList.remove("printing-estate");
      setPrinting(false);
    };
    window.addEventListener("afterprint", done, { once: true });
    // Let the portal render before the print dialog opens.
    const t = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("printing-estate");
    };
  }, [printing]);

  const g = estate.guide;

  return (
    <>
      <ModalShell
        title="Estate guide"
        onClose={onClose}
        className="sm:max-w-5xl"
        mobileAlign="top"
        headerExtra={
          <span className={`text-xs font-bold ${saved && !pending ? "text-positive" : "text-foreground"}`} aria-live="polite">
            {pending ? "Saving…" : saved ? "Saved" : ""}
          </span>
        }
        headerActions={
          <button
            type="button"
            onClick={() => setPrinting(true)}
            className="rounded-lg bg-surface px-3 py-1.5 text-xs font-semibold text-foreground ring-1 ring-inset ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40"
          >
            Print
          </button>
        }
      >
        <div className="space-y-5 px-3 py-4 sm:px-5">
          {/* 1 · Who handles things */}
          <section style={acc("var(--viz-income)")} className={STEP_CLS}>
            <StepHead n={1} title="Who handles things" />
            {/* All four on one line on a desktop, Power of attorney first; two by two on a tablet. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Labeled label="Power of attorney">
                <NameSelect label="Power of attorney" value={g.powerOfAttorney} names={names} onSave={(v) => save(() => saveEstateGuideField("power_of_attorney", v))} />
              </Labeled>
              <Labeled label="Executor">
                <NameSelect label="Executor" value={g.executor} names={names} onSave={(v) => save(() => saveEstateGuideField("executor", v))} />
              </Labeled>
              <Labeled label="Will kept at">
                <SaveField label="Will kept at" initial={g.willLocation} placeholder="Where the signed will is" onSave={(v) => save(() => saveEstateGuideField("will_location", v))} />
              </Labeled>
              <Labeled label="Attorney / JAG office">
                <SaveField label="Attorney" initial={g.attorney} placeholder="Name and phone" onSave={(v) => save(() => saveEstateGuideField("attorney", v))} />
              </Labeled>
            </div>
          </section>

          {/* 2 · Accounts */}
          <section style={acc("var(--viz-income)")} className={STEP_CLS}>
            <StepHead n={2} title="Accounts">
              <Progress done={setCount} total={open.length} />
            </StepHead>
            {SECTIONS.map((section) => {
              const rows = open.filter(section.match);
              if (rows.length === 0) return null;
              const done = rows.filter((a) => fieldsOf(a.id).transfer).length;
              const isOpen = openSections.has(section.label);
              return (
                <div
                  key={section.label}
                  style={acc(GROUP_ACC[section.label])}
                  className="relative overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-line dark:bg-background"
                >
                  <AccentEdge />
                  {/* Starts collapsed; the bar says which groups still need work. */}
                  <button
                    type="button"
                    onClick={() => toggleSection(section.label)}
                    aria-expanded={isOpen}
                    className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 py-2.5 pl-4 pr-3 text-left transition hover:bg-sky-50 dark:hover:bg-sky-950/40"
                  >
                    <svg aria-hidden viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 7.5 10 12.5 15 7.5" />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-wide">{section.label}</span>
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-line">{rows.length}</span>
                    <span className="ml-auto">
                      <Progress done={done} total={rows.length} />
                    </span>
                  </button>
                  {isOpen ? (
                  <ul className="divide-y divide-line border-t border-line">
                    {rows.map((a) => {
                      const f = fieldsOf(a.id);
                      const value = valueOf(a);
                      return (
                        <li key={a.id} className="space-y-2 py-3 pl-4 pr-3">
                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                              <span className="font-semibold">{a.name}</span>
                              {!f.transfer ? (
                                <span className="rounded-full bg-negative/15 px-1.5 py-0.5 text-[10px] font-bold text-foreground ring-1 ring-negative/15">
                                  Not set
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-semibold tabular-nums ${value < 0 ? "text-negative" : ""}`}>
                                {owes(a) ? `Owes ${formatMoneyWhole(-value, currency)}` : formatMoneyWhole(value, currency)}
                              </span>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => save(() => saveAccountEstateField(a.id, "hidden", "1"))}
                                className="rounded-md px-2 py-0.5 text-xs font-semibold text-foreground ring-1 ring-inset ring-line transition hover:bg-sky-100 hover:ring-sky-400 disabled:opacity-60 dark:hover:bg-sky-950/40"
                              >
                                Hide
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
                            <Labeled label="Bank / company">
                              <SaveField label={`${a.name} bank`} initial={a.institution} placeholder="e.g. USAA" onSave={(v) => save(() => saveAccountEstateField(a.id, "institution", v))} />
                            </Labeled>
                            <Labeled label="Owner">
                              <NameSelect
                                label={`${a.name} owner`}
                                value={a.holder}
                                names={names}
                                onSave={(v) => save(() => saveAccountEstateField(a.id, "holder", v))}
                              />
                            </Labeled>
                            <Labeled label="Passes by" className="col-span-2 sm:col-span-1">
                              <select
                                aria-label={`${a.name} passes by`}
                                defaultValue={f.transfer ?? ""}
                                key={f.transfer ?? ""}
                                onChange={(e) => {
                                  const v = e.currentTarget.value;
                                  save(() => saveAccountEstateField(a.id, "transfer", v));
                                }}
                                className={inputCls}
                              >
                                <option value="">Not set</option>
                                {Object.entries(TRANSFER_LABEL).map(([k, label]) => (
                                  <option key={k} value={k}>{label}</option>
                                ))}
                              </select>
                            </Labeled>
                            <Labeled label="Beneficiary">
                              <NameSelect
                                label={`${a.name} beneficiary`}
                                value={f.beneficiary}
                                names={names}
                                onSave={(v) => save(() => saveAccountEstateField(a.id, "beneficiary", v))}
                              />
                            </Labeled>
                            <Labeled label="Contact">
                              <SaveField label={`${a.name} contact`} initial={f.contact} placeholder="Phone or website" onSave={(v) => save(() => saveAccountEstateField(a.id, "contact", v))} />
                            </Labeled>
                          </div>
                          {/* Notes on their own line under the fields, in the
                              plain bordered notes style. */}
                          <NotesBox label="Notes:">
                            <SaveField bare label={`${a.name} notes`} initial={f.notes} placeholder="Where the paperwork is kept" onSave={(v) => save(() => saveAccountEstateField(a.id, "notes", v))} />
                          </NotesBox>
                        </li>
                      );
                    })}
                  </ul>
                  ) : null}
                </div>
              );
            })}

            {/* Left off the guide — still on Accounts, never printed. */}
            {hiddenAccounts.length > 0 ? (
              <div className="overflow-hidden rounded-xl ring-1 ring-line">
                <button
                  type="button"
                  onClick={() => toggleSection(HIDDEN)}
                  aria-expanded={openSections.has(HIDDEN)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-sky-100 dark:hover:bg-sky-950/40"
                >
                  <svg aria-hidden viewBox="0 0 20 20" className={`h-3.5 w-3.5 shrink-0 text-foreground transition-transform ${openSections.has(HIDDEN) ? "" : "-rotate-90"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 7.5 10 12.5 15 7.5" />
                  </svg>
                  <span className="text-xs font-bold uppercase tracking-wide text-foreground">Hidden</span>
                  <span className="text-xs font-semibold text-foreground">{hiddenAccounts.length}</span>
                </button>
                {openSections.has(HIDDEN) ? (
                  <ul className="divide-y divide-line border-t border-line">
                    {hiddenAccounts.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-semibold text-foreground">{a.name}</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => save(() => saveAccountEstateField(a.id, "hidden", ""))}
                          className="rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-line transition hover:bg-sky-100 hover:ring-sky-400 disabled:opacity-60 dark:hover:bg-sky-950/40"
                        >
                          Show
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* Debts not already listed as a card */}
          {owing.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-sm font-bold">Debts</h3>
              <p className="text-xs font-semibold text-foreground">Debts: paid from the estate first</p>
              <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
                {owing.map((d) => (
                  <li key={d.subcategoryId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-semibold">{d.name}</span>
                    <span className="font-semibold tabular-nums text-negative">{formatMoneyWhole(d.balanceCents, currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* 3 · Insurance & benefits */}
          <section style={acc("var(--viz-bills)")} className={STEP_CLS}>
            <StepHead n={3} title="Insurance &amp; benefits" />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.filter((p) => !usedPresets.has(p.name)).map((p) => (
                <button
                  key={p.name}
                  type="button"
                  disabled={pending}
                  onClick={() => save(() => addEstateItem(p.kind, p.name))}
                  className={ADD_CHIP}
                >
                  <span aria-hidden className="text-sm leading-none">+</span>
                  {p.name}
                </button>
              ))}
              <AddOther disabled={pending} onAdd={(name) => save(() => addEstateItem("other", name))} />
            </div>
            {estate.items.length > 0 ? (
              <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
                {estate.items.map((item) => (
                  <li key={item.id} className="space-y-2 px-3 py-2.5">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7rem_minmax(0,1.2fr)_minmax(0,1.3fr)_auto] sm:items-end">
                      <Labeled label="Name" className="col-span-2 sm:col-span-1">
                        <SaveField label="Name" initial={item.name} onSave={(v) => save(() => saveEstateItemField(item.id, "name", v))} />
                      </Labeled>
                      <Labeled label="Type">
                        <select
                          aria-label={`${item.name} type`}
                          defaultValue={item.kind}
                          key={item.kind}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            save(() => saveEstateItemField(item.id, "kind", v));
                          }}
                          className={inputCls}
                        >
                          {Object.entries(ITEM_KIND_LABEL).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                          ))}
                        </select>
                      </Labeled>
                      {/* Read by the Net Worth survivor view: a benefit is
                          monthly, insurance pays out once. */}
                      <Labeled label={item.kind === "benefit" ? "Per month" : item.kind === "insurance" ? "Payout" : "Value"}>
                        <div className="mx-auto w-28">
                          <SaveField
                            label={`${item.name} amount`}
                            initial={item.amountCents != null ? centsToDisplay(item.amountCents) : null}
                            placeholder="0.00"
                            onSave={(v) => save(() => saveEstateItemField(item.id, "amount", v))}
                          />
                        </div>
                      </Labeled>
                      <Labeled label="Beneficiary">
                        <NameSelect
                          label={`${item.name} beneficiary`}
                          value={item.beneficiary}
                          names={names}
                          onSave={(v) => save(() => saveEstateItemField(item.id, "beneficiary", v))}
                        />
                      </Labeled>
                      <Labeled label="Contact">
                        <SaveField label={`${item.name} contact`} initial={item.contact} placeholder="Phone or website" onSave={(v) => save(() => saveEstateItemField(item.id, "contact", v))} />
                      </Labeled>
                      <RemoveButton disabled={pending} onRemove={() => save(() => deleteEstateItem(item.id))} />
                    </div>
                    <NotesBox label="Notes:">
                      <SaveField bare label={`${item.name} notes`} initial={item.notes} placeholder="Policy number, where the papers are" onSave={(v) => save(() => saveEstateItemField(item.id, "notes", v))} />
                    </NotesBox>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-[color-mix(in_srgb,var(--foreground)_25%,var(--border))] px-3 py-3 text-center text-sm font-semibold">
                Tap a button above to add each policy or benefit.
              </p>
            )}
          </section>

          {/* 4 · Steps for the family — last, since it's written once the
              people and accounts above are in. */}
          <section style={acc("var(--viz-income)")} className={STEP_CLS}>
            <StepHead n={4} title="Steps for the family" />
            <NotesBox label="Steps:">
              <SaveField
                bare
                label="Steps for the family"
                multiline
                initial={g.instructions}
                placeholder={"1. Who to call first\n2. Where the papers are"}
                onSave={(v) => save(() => saveEstateGuideField("instructions", v))}
              />
            </NotesBox>
          </section>
        </div>
      </ModalShell>
      {printing ? createPortal(<EstatePrint accounts={open} debts={owing} estate={estate} currency={currency} />, document.body) : null}
    </>
  );
}

/** Every person already named on accounts or in the guide — the list the
 *  name dropdowns offer. */
export function estateNames(accounts: AccountData[], estate: EstateData): string[] {
  return uniqueNames([
    ...accounts.map((a) => a.holder),
    ...Object.values(estate.accounts).map((f) => f.beneficiary),
    ...estate.items.map((i) => i.beneficiary),
    estate.guide.executor,
    estate.guide.powerOfAttorney,
  ]);
}

/**
 * The guide's fields inside Add account, so a new account is filled in while
 * it's being created instead of waiting on the "to fill in" badge. Closed
 * until asked for; posts estateTransfer / estateBeneficiary / estateContact /
 * estateNotes with the rest of the form.
 */
export function EstateAddFields({ names }: { names: string[] }) {
  const [open, setOpen] = useState(false);
  const [beneficiary, setBeneficiary] = useState("");
  const [typing, setTyping] = useState(false);
  const labelCls = "mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-foreground";
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="justify-self-start rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset ring-line transition hover:bg-sky-100 hover:ring-sky-400 sm:col-span-2 dark:hover:bg-sky-950/40"
      >
        + Add estate details
      </button>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg p-3 ring-1 ring-line sm:col-span-2 sm:grid-cols-2">
      <p className="text-xs font-semibold sm:col-span-2">Estate details</p>
      <label className="block">
        <span className={labelCls}>Passes by</span>
        <select name="estateTransfer" defaultValue="" className={inputCls}>
          <option value="">Not set</option>
          {Object.entries(TRANSFER_LABEL).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>Beneficiary</span>
        <input type="hidden" name="estateBeneficiary" value={beneficiary} />
        {typing ? (
          <input
            autoFocus
            placeholder="Type a name, then Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // don't submit the whole form
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => {
              setBeneficiary(e.currentTarget.value.trim());
              setTyping(false);
            }}
            className={inputCls}
          />
        ) : (
          <select
            value={beneficiary}
            onChange={(e) => (e.target.value === NEW_NAME ? setTyping(true) : setBeneficiary(e.target.value))}
            className={inputCls}
          >
            <option value="">—</option>
            {(beneficiary && !names.includes(beneficiary) ? [...names, beneficiary] : names).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value={NEW_NAME}>New name…</option>
          </select>
        )}
      </label>
      <label className="block">
        <span className={labelCls}>Contact</span>
        <input name="estateContact" placeholder="Phone or website" autoComplete="off" className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Notes</span>
        <input name="estateNotes" placeholder="Where the paperwork is" autoComplete="off" className={inputCls} />
      </label>
    </div>
  );
}

// Two taps: Remove, then "Yes, remove". Goes back to Remove after a few
// seconds, so a stray tap never deletes anything.
function RemoveButton({ disabled, onRemove }: { disabled: boolean; onRemove: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (armed) onRemove();
        else setArmed(true);
      }}
      className={`col-span-2 justify-self-end whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold transition disabled:opacity-60 sm:col-span-1 ${
        armed ? "bg-negative/15 text-foreground ring-1 ring-negative/30" : "text-negative hover:bg-negative/10"
      }`}
    >
      {armed ? "Yes, remove" : "Remove"}
    </button>
  );
}

function AddOther({ disabled, onAdd }: { disabled: boolean; onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className={ADD_CHIP}
      >
        <span aria-hidden className="text-sm leading-none">+</span>
        Other
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
        if (name) onAdd(name);
        setAdding(false);
      }}
      className="flex items-center gap-1.5"
    >
      <input name="name" autoFocus placeholder="e.g. Car, Google account" className={`${inputCls} w-44 sm:w-56`} />
      <button type="submit" disabled={disabled} className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
        Add
      </button>
      <button type="button" onClick={() => setAdding(false)} className="px-1.5 text-xs font-semibold text-foreground hover:text-negative">
        Cancel
      </button>
    </form>
  );
}

// The printout: plain black on white, read-only. Shown only while printing
// (see the printing-estate rules in globals.css).
function EstatePrint({
  accounts,
  debts,
  estate,
  currency,
}: {
  accounts: AccountData[];
  debts: BudgetDebt[];
  estate: EstateData;
  currency: string;
}) {
  const g = estate.guide;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const cell = "border border-black/30 px-1.5 py-1 align-top";
  const head = `${cell} bg-surface text-left font-semibold`;
  return (
    <div id="estate-print" className="text-[11px] leading-snug">
      <h1 className="text-lg font-bold">Estate guide</h1>
      <p className="mb-3">Printed {today}.</p>

      <h2 className="mb-1 mt-3 text-sm font-bold">Who handles things</h2>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Power of attorney", g.powerOfAttorney],
            ["Executor", g.executor],
            ["Will kept at", g.willLocation],
            ["Attorney / JAG office", g.attorney],
          ].map(([k, v]) => (
            <tr key={k}>
              <th className={`${head} w-44`}>{k}</th>
              <td className={cell}>{v || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {g.instructions ? (
        <>
          <h2 className="mb-1 mt-3 text-sm font-bold">Steps for the family</h2>
          <p className="whitespace-pre-wrap">{g.instructions}</p>
        </>
      ) : null}

      <h2 className="mb-1 mt-3 text-sm font-bold">Accounts</h2>
      {SECTIONS.map((section) => {
        const rows = accounts.filter(section.match);
        if (rows.length === 0) return null;
        return (
          <table key={section.label} className="mb-2 w-full border-collapse">
            <thead>
              <tr>
                <th className={head} colSpan={7}>{section.label}</th>
              </tr>
              <tr>
                {["Account", "Bank / company", "Owner", "Balance", "Passes by", "Beneficiary", "Contact / notes"].map((h) => (
                  <th key={h} className={head}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const f = estate.accounts[a.id];
                const value = valueOf(a);
                return (
                  <tr key={a.id} className="break-inside-avoid">
                    <td className={cell}>{a.name}</td>
                    <td className={cell}>{a.institution || "—"}</td>
                    <td className={cell}>{ownerLabel(a)}</td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {owes(a) ? `Owes ${formatMoneyWhole(-value, currency)}` : formatMoneyWhole(value, currency)}
                    </td>
                    <td className={cell}>{f?.transfer ? TRANSFER_LABEL[f.transfer] : "Not set"}</td>
                    <td className={cell}>{f?.beneficiary || "—"}</td>
                    <td className={cell}>{[f?.contact, f?.notes].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}

      {debts.length > 0 ? (
        <>
          <h2 className="mb-1 mt-3 text-sm font-bold">Debts</h2>
          <table className="w-full border-collapse">
            <tbody>
              {debts.map((d) => (
                <tr key={d.subcategoryId}>
                  <td className={cell}>{d.name}</td>
                  <td className={`${cell} w-32 whitespace-nowrap`}>{formatMoneyWhole(d.balanceCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {estate.items.length > 0 ? (
        <>
          <h2 className="mb-1 mt-3 text-sm font-bold">Insurance &amp; benefits</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Name", "Type", "Amount", "Beneficiary", "Contact", "Notes"].map((h) => (
                  <th key={h} className={head}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {estate.items.map((i) => (
                <tr key={i.id} className="break-inside-avoid">
                  <td className={cell}>{i.name}</td>
                  <td className={cell}>{ITEM_KIND_LABEL[i.kind] ?? i.kind}</td>
                  <td className={`${cell} whitespace-nowrap`}>{i.amountCents != null ? `${formatMoneyWhole(i.amountCents, currency)}${i.kind === "benefit" ? "/mo" : ""}` : "—"}</td>
                  <td className={cell}>{i.beneficiary || "—"}</td>
                  <td className={cell}>{i.contact || "—"}</td>
                  <td className={cell}>{i.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

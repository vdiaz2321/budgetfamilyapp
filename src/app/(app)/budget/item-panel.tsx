"use client";

import { useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { KINDS_WITH_DUE, type CategoryKind } from "@/lib/categories";
import {
  deleteSubcategory,
  updateSubcategory,
  upsertDebt,
  upsertPlan,
  upsertSavingsGoal,
} from "./actions";
import type { RowData } from "./types";

const HEADER_ACCENT: Record<CategoryKind, string> = {
  income: "bg-positive",
  savings: "bg-sky-500",
  bills: "bg-brand",
  expenses: "bg-accent",
  debt: "bg-negative",
};

type Props = {
  row: RowData;
  kind: CategoryKind;
  currency: string;
  monthKey: string; // YYYY-MM-01
  onClose: () => void;
};

export function ItemPanel({ row, kind, currency, monthKey, onClose }: Props) {
  const isIncome = kind === "income";
  const remaining = row.plannedCents - row.spentCents;
  const headerLabel = isIncome ? "Received" : remaining < 0 ? "Overspent" : "Remaining";
  const headerValue = isIncome ? row.spentCents : remaining;

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {/* Colored header */}
      <div className={`relative ${HEADER_ACCENT[kind]} px-5 pb-4 pt-3`}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/30"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/80">{kind}</p>
        <div className="mt-3 flex items-end justify-between gap-2">
          <h2 className="min-w-0 truncate text-lg font-bold text-white">{row.name}</h2>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide text-white/80">
              {headerLabel}
            </p>
            <p className="text-xl font-bold text-white tabular-nums">
              {formatMoney(headerValue, currency)}
            </p>
          </div>
        </div>
        <p className="mt-0.5 text-xs text-white/90 tabular-nums">
          {formatMoney(row.spentCents, currency)} {isIncome ? "received" : "spent"} of{" "}
          {formatMoney(row.plannedCents, currency)}
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        <PlannedForm subId={row.subId} monthKey={monthKey} plannedCents={row.plannedCents} />
        {kind === "debt" && row.debt ? <DebtForm row={row} /> : null}
        {kind === "savings" && row.savings ? <SavingsForm row={row} /> : null}
        <RenameForm row={row} kind={kind} onDeleted={onClose} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

function PlannedForm({
  subId,
  monthKey,
  plannedCents,
}: {
  subId: string;
  monthKey: string;
  plannedCents: number;
}) {
  const [pending, start] = useTransition();
  return (
    <Section title="Planned this month">
      <form action={(fd) => start(() => upsertPlan(fd))} className="flex items-center gap-2">
        <input type="hidden" name="subcategoryId" value={subId} />
        <input type="hidden" name="month" value={monthKey} />
        <input
          key={plannedCents}
          name="planned"
          type="number"
          step="0.01"
          defaultValue={centsToDisplay(plannedCents)}
          className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 text-right text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <SaveBtn pending={pending} />
      </form>
    </Section>
  );
}

function DebtForm({ row }: { row: RowData }) {
  const [pending, start] = useTransition();
  const d = row.debt!;
  return (
    <Section title="Debt details">
      <form action={(fd) => start(() => upsertDebt(fd))} className="space-y-2">
        <input type="hidden" name="subcategoryId" value={row.subId} />
        <Grid>
          <Labeled label="Balance" name="balance" type="number" step="0.01" defaultValue={centsToDisplay(d.balanceCents)} />
          <Labeled label="Min. payment" name="minPayment" type="number" step="0.01" defaultValue={centsToDisplay(d.minCents)} />
          <Labeled label="Interest %" name="apr" type="number" step="0.001" defaultValue={String(d.apr)} />
          <Labeled label="Due day" name="dueDay" type="number" min={1} max={31} defaultValue={d.dueDay ?? ""} />
        </Grid>
        <SaveBtn pending={pending} full />
      </form>
    </Section>
  );
}

function SavingsForm({ row }: { row: RowData }) {
  const [pending, start] = useTransition();
  const s = row.savings!;
  return (
    <Section title="Savings goal">
      <form action={(fd) => start(() => upsertSavingsGoal(fd))} className="space-y-2">
        <input type="hidden" name="subcategoryId" value={row.subId} />
        <Grid>
          <Labeled label="Goal" name="goal" type="number" step="0.01" defaultValue={centsToDisplay(s.goalCents)} />
          <Labeled label="Start" name="start" type="number" step="0.01" defaultValue={centsToDisplay(s.startCents)} />
          <Labeled label="Monthly" name="monthly" type="number" step="0.01" defaultValue={centsToDisplay(s.monthlyCents)} />
        </Grid>
        <SaveBtn pending={pending} full />
      </form>
    </Section>
  );
}

function RenameForm({
  row,
  kind,
  onDeleted,
}: {
  row: RowData;
  kind: CategoryKind;
  onDeleted: () => void;
}) {
  const [savePending, startSave] = useTransition();
  const [delPending, startDel] = useTransition();
  const hasDue = KINDS_WITH_DUE.includes(kind);

  return (
    <Section title="Rename or remove">
      <form action={(fd) => startSave(() => updateSubcategory(fd))} className="space-y-2">
        <input type="hidden" name="id" value={row.subId} />
        <Grid>
          <Labeled label="Name" name="name" type="text" defaultValue={row.name} required />
          {hasDue ? (
            <Labeled label="Due day" name="dueDay" type="number" min={1} max={31} defaultValue={row.dueDay ?? ""} />
          ) : null}
        </Grid>
        <SaveBtn pending={savePending} full label="Save changes" />
      </form>
      <form
        action={(fd) => startDel(() => deleteSubcategory(fd).then(onDeleted))}
        className="mt-2"
      >
        <input type="hidden" name="id" value={row.subId} />
        <button
          type="submit"
          disabled={delPending}
          className="w-full rounded-lg bg-background py-2 text-sm font-medium text-negative ring-1 ring-line hover:bg-negative/5 disabled:opacity-60"
        >
          {delPending ? "Deleting…" : "Delete item"}
        </button>
      </form>
    </Section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function Labeled({
  label,
  ...inputProps
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">{label}</span>
      <input
        {...inputProps}
        className="w-full rounded-lg bg-background px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
      />
    </label>
  );
}

function SaveBtn({ pending, full, label }: { pending: boolean; full?: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60 ${full ? "w-full" : ""}`}
    >
      {pending ? "Saving…" : label ?? "Save"}
    </button>
  );
}

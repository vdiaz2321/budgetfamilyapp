"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { ageInYear, projectFi } from "@/lib/retirement";
import { saveRetirementPlan } from "./actions";

export type FiPlan = {
  birthYear: number | null;
  targetRetireYear: number | null;
  annualSpendCents: number | null;
  annualContributionCents: number | null;
  realReturnPct: number;
  withdrawalRatePct: number;
  includeCash: boolean;
};

export type FiMeasured = {
  /** Invested (non-kids) accounts today. */
  investedCents: number;
  /** Cash sitting in savings and checking, offered as an opt-in. */
  cashCents: number;
  /** Bills + expenses over the last twelve months. */
  spendCents: number;
  /** Into savings and investments over the last twelve months. */
  contributionCents: number;
  /** The window those two figures were measured over. */
  fromMonth: string;
  toMonth: string;
};

export function FiSection({
  plan,
  measured,
  currency,
  thisYear,
}: {
  plan: FiPlan;
  measured: FiMeasured;
  currency: string;
  thisYear: number;
}) {
  // Collapsed on a fresh login, remembered while navigating.
  const [collapse, setCollapse] = useSessionCollapse("networth-fi", () => ({ open: false }));
  const open = !!collapse.open;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) =>
    setCollapse((s) => ({ ...s, open: typeof next === "function" ? next(!!s.open) : next }));
  const [editing, setEditing] = useState(false);

  const portfolioCents = measured.investedCents + (plan.includeCash ? measured.cashCents : 0);
  const spendCents = plan.annualSpendCents ?? measured.spendCents;
  const contributionCents = plan.annualContributionCents ?? measured.contributionCents;

  const fi = useMemo(
    () =>
      projectFi(
        {
          portfolioCents,
          annualContributionCents: contributionCents,
          annualSpendCents: spendCents,
          realReturnPct: plan.realReturnPct,
          withdrawalRatePct: plan.withdrawalRatePct,
        },
        thisYear,
      ),
    [portfolioCents, contributionCents, spendCents, plan.realReturnPct, plan.withdrawalRatePct, thisYear],
  );

  const fiAge = ageInYear(plan.birthYear, fi.fiYear ?? thisYear);
  // What the plan says about the year he'd like to stop, when one is set.
  const atTarget = plan.targetRetireYear
    ? fi.years.find((y) => y.year === plan.targetRetireYear) ?? null
    : null;

  return (
    <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
          <span className="text-sm font-bold">Financial independence</span>
        </button>

        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Figure
            label="FI number"
            value={formatMoney(fi.fiNumberCents, currency)}
            tone="text-foreground"
          />
          <Figure
            label="Funded"
            value={`${Math.round(fi.progress * 100)}%`}
            tone=""
            style={{ color: "var(--viz-savings)" }}
          />
          <Figure
            label={fi.fiYear ? "Independent in" : "Independent"}
            value={
              fi.fiYear
                ? `${fi.fiYear}${fiAge != null ? ` · age ${fiAge}` : ""}`
                : "not on this path"
            }
            tone={fi.fiYear ? "text-positive" : "text-negative"}
          />
        </span>
      </div>

      {open ? (
        <div className="border-t border-line px-4 py-4 sm:px-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label="Portfolio today"
              value={formatMoney(portfolioCents, currency)}
              sub={plan.includeCash ? "investments + cash" : "investments only"}
            />
            <Tile
              label="Spending / yr"
              value={formatMoney(spendCents, currency)}
              sub={plan.annualSpendCents == null ? "last 12 months" : "you set this"}
            />
            <Tile
              label="Adding / yr"
              value={formatMoney(contributionCents, currency)}
              sub={plan.annualContributionCents == null ? "last 12 months" : "you set this"}
            />
            <Tile
              label="Supports today"
              value={`${formatMoney(fi.sustainableSpendCents, currency)}/yr`}
              sub={`at ${plan.withdrawalRatePct}%`}
            />
          </div>

          <p className="mt-3 text-xs text-muted">
            At a {plan.realReturnPct}% real return, {formatMoney(contributionCents, currency)} added
            a year covers {formatMoney(spendCents, currency)} of spending
            {fi.fiYear ? (
              <>
                {" "}
                by <span className="font-semibold text-foreground">{fi.fiYear}</span> — {fi.yearsToFi}{" "}
                {fi.yearsToFi === 1 ? "year" : "years"} from now
                {fiAge != null ? `, at age ${fiAge}` : ""}.
              </>
            ) : (
              <> nowhere inside 60 years. Raise the contributions or lower the spending.</>
            )}{" "}
            Every figure is in today&rsquo;s money.
          </p>

          {atTarget ? (
            <p className="mt-1 text-xs text-muted">
              By your target of{" "}
              <span className="font-semibold text-foreground">{plan.targetRetireYear}</span> the
              portfolio reaches{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(atTarget.endCents, currency)}
              </span>
              , which supports{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(Math.round((atTarget.endCents * plan.withdrawalRatePct) / 100), currency)}
              </span>{" "}
              a year —{" "}
              {atTarget.endCents >= fi.fiNumberCents ? (
                <span className="font-semibold text-positive">enough</span>
              ) : (
                <span className="font-semibold text-negative">
                  {formatMoney(fi.fiNumberCents - atTarget.endCents, currency)} short
                </span>
              )}
              .
            </p>
          ) : null}

          <FiChart fi={fi} currency={currency} />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-[11px] text-muted">
              Measured from {measured.fromMonth} to {measured.toMonth}.
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ring-line transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              Assumptions
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <PlanModal
          plan={plan}
          measured={measured}
          currency={currency}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </section>
  );
}

// The climb to the FI line, one bar a year. A plain bar chart because the
// question is "when does this cross the line", and a line crossing a line is
// harder to read than a bar reaching one.
function FiChart({
  fi,
  currency,
}: {
  fi: ReturnType<typeof projectFi>;
  currency: string;
}) {
  if (fi.years.length === 0) return null;
  const max = Math.max(fi.fiNumberCents, ...fi.years.map((y) => y.endCents));
  // Every year is a bar, but only a few get a label or the axis turns to mush.
  const labelEvery = Math.max(1, Math.ceil(fi.years.length / 8));

  return (
    <div className="mt-4">
      <div className="relative h-32">
        {/* The FI line itself, with the number on it. */}
        <div
          className="absolute inset-x-0 border-t border-dashed"
          style={{
            bottom: `${(fi.fiNumberCents / max) * 100}%`,
            borderColor: "var(--positive)",
          }}
        >
          {/* Left-aligned: the right-hand end of the line is exactly where the
              bars that cross it live, and the label sat on top of them. */}
          <span className="absolute -top-4 left-0 rounded bg-surface/90 px-1 text-[10px] font-semibold text-positive">
            FI {formatMoney(fi.fiNumberCents, currency)}
          </span>
        </div>
        <div className="flex h-full items-end gap-[2px]">
          {fi.years.map((y) => (
            <span
              key={y.year}
              className="flex-1 rounded-t-[2px]"
              style={{
                height: `${Math.max(1, (y.endCents / max) * 100)}%`,
                backgroundColor: y.independent ? "var(--positive)" : "var(--viz-spending)",
              }}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px]">
        {fi.years.map((y, i) => (
          <span key={y.year} className="flex-1 text-center text-[10px] tabular-nums text-muted">
            {i % labelEvery === 0 ? `'${String(y.year).slice(2)}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function PlanModal({
  plan,
  measured,
  currency,
  onClose,
}: {
  plan: FiPlan;
  measured: FiMeasured;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <ModalShell title="Assumptions" onClose={onClose}>
      <form
        action={(formData) =>
          start(async () => {
            const result = await saveRetirementPlan(formData);
            if (result?.error) setError(result.error);
            else {
              router.refresh();
              onClose();
            }
          })
        }
        className="grid grid-cols-1 gap-3 px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:grid-cols-2"
      >
        <Field label="Birth year">
          <input
            name="birthYear"
            inputMode="numeric"
            defaultValue={plan.birthYear ?? ""}
            className={inputClass}
          />
        </Field>
        <Field label="Target retirement year">
          <input
            name="targetRetireYear"
            inputMode="numeric"
            defaultValue={plan.targetRetireYear ?? ""}
            className={inputClass}
          />
        </Field>

        <Field label="Real return (%)">
          <input
            name="realReturnPct"
            inputMode="decimal"
            defaultValue={plan.realReturnPct}
            className={inputClass}
          />
        </Field>
        <Field label="Withdrawal rate (%)">
          <input
            name="withdrawalRatePct"
            inputMode="decimal"
            defaultValue={plan.withdrawalRatePct}
            className={inputClass}
          />
        </Field>

        <Field label="Spending / yr — blank uses the last 12 months">
          <input
            name="annualSpend"
            inputMode="decimal"
            defaultValue={plan.annualSpendCents ? centsToDisplay(plan.annualSpendCents) : ""}
            placeholder={centsToDisplay(measured.spendCents)}
            className={inputClass}
          />
        </Field>
        <Field label="Adding / yr — blank uses the last 12 months">
          <input
            name="annualContribution"
            inputMode="decimal"
            defaultValue={
              plan.annualContributionCents ? centsToDisplay(plan.annualContributionCents) : ""
            }
            placeholder={centsToDisplay(measured.contributionCents)}
            className={inputClass}
          />
        </Field>

        <label className="sm:col-span-2 flex items-start gap-2">
          <input
            type="checkbox"
            name="includeCash"
            defaultChecked={plan.includeCash}
            className="mt-0.5 h-4 w-4 rounded accent-[var(--brand)]"
          />
          <span className="text-xs">
            Count cash savings ({formatMoney(measured.cashCents, currency)}) as retirement money.
            <span className="block text-muted">
              Off by default — money earmarked for a house or a car isn&rsquo;t funding a
              retirement.
            </span>
          </span>
        </label>

        <div className="sm:col-span-2 flex items-center justify-end gap-2 border-t border-line pt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? (
          <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p>
        ) : null}
      </form>
    </ModalShell>
  );
}

const inputClass =
  "w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function Figure({
  label,
  value,
  tone,
  style,
}: {
  label: string;
  value: string;
  tone: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}:</span>
      <span className={`text-sm font-bold tabular-nums ${tone}`} style={style}>
        {value}
      </span>
    </span>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-background px-3 py-2 ring-1 ring-line">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted">{sub}</p>
    </div>
  );
}

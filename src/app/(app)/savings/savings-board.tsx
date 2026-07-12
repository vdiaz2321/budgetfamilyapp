"use client";

import { formatMoney } from "@/lib/money";

export type SavingsCardData = {
  id: string;
  name: string;
  goalCents: number;
  startCents: number;
  savedCents: number;
  monthlyCents: number;
  leftToSaveCents: number;
  targetDate: string | null; // YYYY-MM-DD
  pace: "none" | "reached" | "on_track" | "behind" | "overdue";
  requiredMonthlyCents: number | null;
};

type Props = {
  cards: SavingsCardData[];
  currency: string;
};

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[m - 1]} ${y}`;
}

export function SavingsBoard({ cards, currency }: Props) {
  const totals = cards.reduce(
    (acc, c) => ({
      goal: acc.goal + c.goalCents,
      monthly: acc.monthly + c.monthlyCents,
      saved: acc.saved + c.savedCents,
    }),
    { goal: 0, monthly: 0, saved: 0 },
  );
  const leftToSave = totals.goal - totals.saved;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Savings</h1>
        <p className="text-sm text-muted">
          Every savings goal, tracked toward its target — set one in a Savings item&apos;s panel
          on Budget.
        </p>
      </div>

      {cards.length === 0 ? (
        <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="px-4 py-8 text-center text-sm text-muted">
            No Savings items yet — add one in the Savings group on the Budget tab, then set its
            Goal there to see it here.
          </p>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile label="Total goal" value={totals.goal} currency={currency} />
            <SummaryTile label="Total monthly" value={totals.monthly} currency={currency} />
            <SummaryTile label="Total saved" value={totals.saved} currency={currency} tone="text-positive" />
            <SummaryTile
              label="Left to save"
              value={leftToSave}
              currency={currency}
              tone={leftToSave <= 0 ? "text-positive" : "text-foreground"}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            {cards.map((c) => (
              <SavingsGoalCard key={c.id} card={c} currency={currency} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone ?? ""}`}>
        {formatMoney(value, currency)}
      </p>
    </div>
  );
}

const PACE_BADGE: Record<SavingsCardData["pace"], { label: string; className: string } | null> = {
  none: null,
  reached: { label: "🎉 Reached", className: "bg-positive/15 text-positive" },
  on_track: { label: "✅ On track", className: "bg-positive/15 text-positive" },
  behind: { label: "⚠️ Behind pace", className: "bg-negative/15 text-negative" },
  overdue: { label: "⚠️ Past target date", className: "bg-negative/15 text-negative" },
};

function SavingsGoalCard({ card, currency }: { card: SavingsCardData; currency: string }) {
  const hasGoal = card.goalCents > 0;
  const percent = hasGoal ? Math.min(100, Math.max(0, (card.savedCents / card.goalCents) * 100)) : 0;
  const reached = card.pace === "reached";
  const badge = PACE_BADGE[card.pace];

  return (
    <div className="w-[200px] shrink-0 overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="px-3 pt-3 pb-1 text-center">
        <p className="truncate text-xs font-bold">{card.name}</p>
      </div>
      <div className="flex justify-center py-2">
        <Ring percent={percent} label={formatMoney(card.savedCents, currency)} reached={reached} />
      </div>
      {badge ? (
        <div className="flex justify-center pb-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>
            {badge.label}
          </span>
        </div>
      ) : null}
      <dl className="space-y-1 border-t border-line px-3 py-2 text-xs">
        <Row label="Goal" value={hasGoal ? formatMoney(card.goalCents, currency) : "Not set"} />
        <Row label="Start" value={formatMoney(card.startCents, currency)} />
        <Row label="Saved" value={formatMoney(card.savedCents, currency)} />
        <Row
          label="Left to save"
          value={hasGoal ? formatMoney(Math.max(0, card.leftToSaveCents), currency) : "—"}
        />
        <Row label="Monthly" value={formatMoney(card.monthlyCents, currency)} />
        <Row label="Target" value={card.targetDate ? monthLabel(card.targetDate) : "Not set"} />
      </dl>
      {card.pace === "behind" && card.requiredMonthlyCents != null ? (
        <p className="border-t border-line px-3 py-1.5 text-[10px] text-negative">
          Need {formatMoney(card.requiredMonthlyCents, currency)}/mo to hit it in time.
        </p>
      ) : null}
      {card.pace === "overdue" ? (
        <p className="border-t border-line px-3 py-1.5 text-[10px] text-negative">
          Target date has passed — {formatMoney(Math.max(0, card.leftToSaveCents), currency)} still
          needed.
        </p>
      ) : null}
    </div>
  );
}

function Ring({ percent, label, reached }: { percent: number; label: string; reached: boolean }) {
  const R = 34;
  const STROKE = 7;
  const C = 2 * Math.PI * R;
  const len = (percent / 100) * C;

  return (
    <div className="relative h-[84px] w-[84px]">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
        <circle cx="42" cy="42" r={R} fill="none" strokeWidth={STROKE} className="stroke-line/60" />
        <circle
          cx="42" cy="42" r={R} fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${len} ${C - len}`}
          className={reached ? "stroke-positive" : "stroke-brand"}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold tabular-nums">{label}</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

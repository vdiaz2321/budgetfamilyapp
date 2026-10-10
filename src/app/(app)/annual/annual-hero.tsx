"use client";

import { formatMoney } from "@/lib/money";
import type { CategoryKind } from "@/lib/categories";
import type { CardId } from "./annual-selection";

/**
 * When cells are selected in the Months table, the hero stops showing the
 * year and shows the selection instead: only the cards those cells feed, each
 * summing just those cells. `sums` carries the money, `captions` the
 * "2 months selected" line that replaces "% of income".
 */
export type HeroFilter = {
  cards: CardId[];
  sums: Record<CardId, number>;
  captions: Record<CardId, string>;
  /** Newest selected month less the oldest, when the selection spans two or
   *  more months of one card. `upIsGood` sets the tone: spending up is bad,
   *  income up is good. */
  difference: { cents: number; caption: string; upIsGood: boolean } | null;
};

type Props = {
  year: number;
  outflowKinds: CategoryKind[];
  totals: Record<CategoryKind, number>;
  /** The kids' 529s — out of Savings, in a card of their own. */
  kidsTotal: number;
  currency: string;
  filter?: HeroFilter | null;
  onClear?: () => void;
};

const CARD_ORDER: CardId[] = ["income", "spending", "savings", "kids", "debt", "net"];

export function AnnualHero({
  year,
  outflowKinds,
  totals,
  kidsTotal,
  currency,
  filter,
  onClear,
}: Props) {
  // Group totals. Investment contributions get
  // folded into "savings" upstream, so the Savings card already reflects both.
  const spendingTotal = totals.bills + totals.expenses;
  const savingsTotal = totals.savings;
  const debtTotal = totals.debt;
  const outflowTotal = outflowKinds.reduce((sum, k) => sum + totals[k], 0);
  const netTotal = totals.income - outflowTotal - kidsTotal;
  const pct = (v: number) =>
    totals.income === 0 ? null : (v / totals.income) * 100;
  const share = (v: number) => {
    const p = pct(v);
    return p === null ? null : `${p.toFixed(1)}% of income`;
  };

  const active = filter && filter.cards.length > 0 ? filter : null;
  const shows = (id: CardId) => !active || active.cards.includes(id);
  // Filtered: the selected cells' sum, captioned with the months it came from.
  // Unfiltered: the year's own total and its share of income.
  const val = (id: CardId, yearValue: number) => (active ? active.sums[id] : yearValue);
  const cap = (id: CardId, yearCaption: string | null) =>
    active ? active.captions[id] : yearCaption;

  const card = (id: CardId) => {
    switch (id) {
      case "income":
        return (
          <Stat
            label={`${year} Income`}
            value={val("income", totals.income)}
            currency={currency}
            tone="text-positive"
            subtitle={cap("income", null)}
            subtitleTone="text-positive"
          />
        );
      case "spending":
        return (
          <Stat
            label={`${year} Bills/Expenses`}
            value={val("spending", spendingTotal)}
            currency={currency}
            tone="text-negative"
            subtitleTone="text-negative"
            subtitle={cap("spending", share(spendingTotal))}
          />
        );
      case "savings":
        return (
          <Stat
            label={`${year} Savings`}
            value={val("savings", savingsTotal)}
            currency={currency}
            color="var(--viz-savings)"
            subtitleColor="var(--viz-savings)"
            subtitle={cap("savings", share(savingsTotal))}
          />
        );
      case "kids":
        return (
          <Stat
            label={`${year} Kids Funding`}
            value={val("kids", kidsTotal)}
            currency={currency}
            subtitle={cap("kids", share(kidsTotal))}
          />
        );
      case "debt":
        return (
          <Stat
            label={`${year} Debt`}
            value={val("debt", debtTotal)}
            currency={currency}
            tone="text-negative"
            subtitleTone="text-negative"
            subtitle={cap("debt", share(debtTotal))}
          />
        );
      case "net": {
        const v = val("net", netTotal);
        const p = pct(netTotal);
        return (
          <Stat
            label={`${year} Remaining`}
            value={v}
            currency={currency}
            tone={v >= 0 ? "text-positive" : "text-negative"}
            subtitleTone={v >= 0 ? "text-positive" : "text-negative"}
            subtitle={cap(
              "net",
              p === null ? null : `${p.toFixed(1)}% of income`,
            )}
          />
        );
      }
    }
  };

  // Cards that drop out of a filtered view leave their grid slot behind rather
  // than collapsing it: clicking a second cell must not move the row the
  // pointer is already over. The first freed slot carries the way back.
  const freeSlots = CARD_ORDER.filter((id) => !shows(id));
  const clearSlot = freeSlots[0];
  // The difference rides in the next freed slot, beside the card it compares.
  const diffSlot = active?.difference ? freeSlots[1] : undefined;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {CARD_ORDER.map((id) => {
        if (shows(id)) return <div key={id}>{card(id)}</div>;
        if (id === clearSlot) {
          return (
            <button
              key={id}
              type="button"
              onClick={onClear}
              // Same sky treatment as the Clear button by the table, so the way
              // back reads as a control rather than an empty slot.
              className="rounded-2xl border border-sky-400 bg-sky-100 px-4 py-3 text-center text-sm font-bold uppercase tracking-wide text-foreground transition hover:bg-sky-200 dark:border-sky-500 dark:bg-sky-900/40 dark:hover:bg-sky-900/60"
            >
              Clear
            </button>
          );
        }
        if (id === diffSlot && active?.difference) {
          const { cents, caption, upIsGood } = active.difference;
          const good = cents === 0 ? null : cents > 0 === upIsGood;
          const tone = good === null ? "text-foreground" : good ? "text-positive" : "text-negative";
          return (
            <div key={id}>
              <Stat
                label="Difference"
                value={cents}
                signed
                currency={currency}
                tone={tone}
                subtitle={caption}
                subtitleTone={tone}
              />
            </div>
          );
        }
        return <div key={id} aria-hidden />;
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  signed,
  currency,
  tone,
  color,
  subtitle,
  subtitleTone,
  subtitleColor,
}: {
  label: string;
  value: number;
  /** Prefix "+" on a positive value, for a change rather than an amount. */
  signed?: boolean;
  currency: string;
  // Either `tone` (Tailwind semantic class like text-positive) or `color`
  // (an explicit CSS var / hex — used when the color isn't a semantic token
  // and NEVER for our indigo brand token, which reads as purple in charts).
  tone?: string;
  color?: string;
  subtitle?: string | null;
  // Same shape as tone/color, but for the subtitle line. Default is muted
  // foreground; caller passes matching color when the subtitle should track
  // the value color above it.
  subtitleTone?: string;
  subtitleColor?: string;
}) {
  return (
    <div className="h-full rounded-2xl bg-surface px-3 py-3 text-center xl:px-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-0.5 text-lg font-bold tabular-nums tracking-[-0.01em] ${tone ?? ""}`}
        style={color ? { color } : undefined}
      >
        {signed && value > 0 ? "+" : ""}
        {formatMoney(value, currency)}
      </p>
      {subtitle ? (
        // Wraps rather than runs on: a long caption like "Jan, Feb, Mar" is wider than
        // a fifth of the row, and holding it on one line pushed the whole hero
        // grid past the page edge — with nothing to scroll it back into view.
        <p
          className={`mt-0.5 text-xs font-semibold ${
            subtitleTone ?? (subtitleColor ? "" : "text-foreground")
          }`}
          style={subtitleColor ? { color: subtitleColor } : undefined}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

"use client";

// Travel & Credit Card Rewards.
//
// This section used to live on /accounts. It sits here because everything it
// answers — what a point is worth, which free night is still unbooked, what a
// stay actually redeemed at — is a travel question, and splitting it from the
// stay log meant two pages to keep one story straight. Accounts keeps the
// plain card list: what each card owes and how to pay it.

import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState, useTransition } from "react";
import { centsToDisplay, formatMoney } from "@/lib/money";
import { useSessionCollapse } from "@/lib/use-session-collapse";
import { GripHandle, LabeledInput, PayCardModal, StatTile, usePointerReorder } from "../accounts/shared-ui";
import {
  CREDIT_SECTIONS,
  type AccountData,
  type BucketData,
  type NonCardAccount,
  type RewardActivity,
  type Section,
} from "../accounts/types";
import {
  closeCard,
  deleteAccount,
  deleteCreditCardRewardActivity,
  logCreditCardRewardActivity,
  reopenCard,
  reorderAccounts,
  updateAccount,
  upsertCardDetails,
} from "../accounts/actions";
import { ModalShell } from "@/components/modal-shell";
import { StayModal } from "./stay-modal";
import type { TravelBrand, TravelCard } from "./types";

// A card's own site, opened from its panel. Stored without a scheme more
// often than not, so add one rather than resolving it against /travel.
function externalCardUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

// Everything the shared Add stay modal needs, made available to the card
// panels without threading it through four levels of props. The cards are
// derived from the accounts this board already has.
const TravelStayContext = React.createContext<{ cards: TravelCard[]; brands: TravelBrand[] }>({
  cards: [],
  brands: [],
});

// Clicking a row in the Rewards activity ledger jumps to that card's own
// rewards log instead of leaving you to scroll the card list hunting for it.
// The panel that owns the card watches this id, opens itself and scrolls into
// view; the section above it clears whatever filter might be hiding the card.
const RewardFocusContext = React.createContext<{
  focusCardId: string | null;
  requestFocus: (cardId: string) => void;
  clearFocus: () => void;
}>({ focusCardId: null, requestFocus: () => {}, clearFocus: () => {} });

// The two halves of the rewards block are rendered in two different places on
// /travel — the card sections above the Hotel Reservations Log, the points
// ledger below it — so the provider holds the shared data and state and the
// two pieces below pull what they need out of it.
const RewardsDataContext = React.createContext<{
  accounts: AccountData[];
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  rewardEntries: Array<RewardActivity & { cardName: string; cardId: string }>;
  collapsed: Record<string, boolean>;
  toggleSection: (key: string) => void;
} | null>(null);

function useRewardsData() {
  const ctx = React.useContext(RewardsDataContext);
  if (!ctx) throw new Error("Rewards piece rendered outside <CreditCardRewardsProvider>");
  return ctx;
}

/**
 * Wraps the part of /travel that shows rewards. The card sections
 * (<CreditCardSections />) and the points ledger (<RewardsPointsLog />) are
 * placed separately by the board, with the reservations log between them.
 */
export function CreditCardRewardsProvider({
  children,
  accounts,
  currency,
  nonCardAccounts,
  allBuckets,
  travelBrands,
}: {
  children: React.ReactNode;
  // Every credit card in the household, closed ones included — the closed
  // sections below filter them apart.
  accounts: AccountData[];
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  travelBrands: TravelBrand[];
}) {
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  // Each card section remembers its own open/closed state for the session.
  // "credit" starts open; the two closed-card sections start shut.
  const [collapsed, setCollapsed] = useSessionCollapse(
    "travel-credit-sections-collapsed",
    () => ({ credit: false, credit_closed: true, credit_archived: true }),
  );
  const toggleSection = (key: string) =>
    setCollapsed((state) => ({ ...state, [key]: !state[key] }));

  // The card list the shared Add stay form offers. A closed card is left out
  // of a NEW booking's dropdown — its old stays still reference it.
  const travelCards: TravelCard[] = accounts
    .filter((c) => !c.dateClosed)
    .map((c) => ({
      id: c.id,
      name: c.name,
      holder: c.holder ?? null,
      currentPoints: c.cardDetails?.currentPoints ?? 0,
      pointsValueMicros: c.cardDetails?.pointsValueMicros ?? null,
      freeNightCreditCents: c.cardDetails?.freeNightCreditCents ?? null,
      freeNightPointsLimit: c.cardDetails?.freeNightPointsLimit ?? null,
    }));

  const rewardEntries = accounts
    .flatMap((card) => card.rewardActivities.map((a) => ({ ...a, cardName: card.name, cardId: card.id })))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  return (
    <TravelStayContext.Provider value={{ cards: travelCards, brands: travelBrands }}>
      <RewardFocusContext.Provider
        value={{
          focusCardId,
          requestFocus: (cardId) => {
            // A collapsed section never renders the panel, so the click would
            // do nothing at all — open whichever one holds this card first.
            const card = accounts.find((a) => a.id === cardId);
            const section = card ? CREDIT_SECTIONS.find((sec) => sec.match(card)) : null;
            if (section) setCollapsed((c) => ({ ...c, [section.key]: false }));
            setFocusCardId(cardId);
          },
          clearFocus: () => setFocusCardId(null),
        }}
      >
        <RewardsDataContext.Provider
          value={{
            accounts,
            currency,
            nonCardAccounts,
            allBuckets,
            rewardEntries,
            collapsed,
            toggleSection,
          }}
        >
          {children}
        </RewardsDataContext.Provider>
      </RewardFocusContext.Provider>
    </TravelStayContext.Provider>
  );
}

/** The credit-card sections themselves. Sits above the reservations log. */
export function CreditCardSections() {
  const {
    accounts, currency, nonCardAccounts, allBuckets, collapsed, toggleSection,
  } = useRewardsData();
  return (
    <div className="space-y-3">
      {CREDIT_SECTIONS.map((section) => {
        const sectionAccounts = accounts.filter((a) => section.match(a));
        if (sectionAccounts.length === 0 && section.key !== "credit") return null;
        return (
          <CreditCardSection
            key={section.key}
            section={section}
            accounts={sectionAccounts}
            allCreditCards={accounts}
            currency={currency}
            nonCardAccounts={nonCardAccounts}
            allBuckets={allBuckets}
            open={!collapsed[section.key]}
            onToggle={() => toggleSection(section.key)}
          />
        );
      })}
    </div>
  );
}

/**
 * The points ledger. Its own card, not a tail welded onto the rewards card —
 * a separate report that collapses on its own, sitting under the reservations
 * log where the stays it paid for are listed.
 */
export function RewardsPointsLog() {
  const { accounts, rewardEntries, currency } = useRewardsData();
  if (accounts.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <RewardsActivityLedger entries={rewardEntries} currency={currency} />
    </div>
  );
}

// The bank a card is issued by: the Edit form's own Bank field first, then
// whatever the account was created with. One definition so the row chip, the
// Bank filter and the Bank dropdown can never disagree.
function cardBank(a: AccountData): string {
  return (a.cardDetails?.bank ?? a.institution ?? a.subtype ?? "").trim();
}

// ---- Credit Card section: expandable panels, holder grouping, Pay Card modal ----

function CreditCardSection({
  section,
  accounts,
  allCreditCards,
  currency,
  nonCardAccounts,
  allBuckets,
  open,
  onToggle,
}: {
  section: Section;
  accounts: AccountData[];
  allCreditCards: AccountData[];
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  open: boolean;
  onToggle: () => void;
}) {
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [, startReorder] = useTransition();
  const [localAccounts, setLocalAccounts] = useState(accounts);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalAccounts(accounts);
  }, [accounts]);
  const [collapsedBanks, setCollapsedBanks] = useState<Set<string>>(new Set());
  const { focusCardId } = React.useContext(RewardFocusContext);
  const [showOnlyFeeCards, setShowOnlyFeeCards] = useState(false);
  const [showOnlyOwedCards, setShowOnlyOwedCards] = useState(false);
  const [showOnlyPtsCards, setShowOnlyPtsCards] = useState(false);
  const [showOnlyTravelRedeem, setShowOnlyTravelRedeem] = useState(false);
  const [showOnlyHotelRedeem, setShowOnlyHotelRedeem] = useState(false);
  // Free-night certificates still on the table: the card grants one, nothing
  // has been booked against it, and it hasn't run out of time.
  const [showOnlyUnbookedNights, setShowOnlyUnbookedNights] = useState(false);
  // Which rewards column the section is showing. Null = both, plus Other.
  const [categoryFilter, setCategoryFilter] = useState<"travel" | "hotel" | null>(null);
  // Holder filter — clicking a name (Vic / Johana / …) limits the visible
  // cards to that holder. Null = all holders.
  const [holderFilter, setHolderFilter] = useState<string | null>(null);
  const [bankFilter, setBankFilter] = useState<string | null>(null);
  const hasActiveFee = (a: AccountData) => !a.feeWaived && (a.annualFeeCents ?? 0) > 0;
  const hasOwed = (a: AccountData) => (a.owedCents ?? 0) > 0;
  const hasPts = (a: AccountData) => (a.cardDetails?.currentPoints ?? 0) > 0;
  // "Available" is all three: there is a night credit, no stay has been booked
  // against it (benefitUsedOn is the booking), and its expiry hasn't passed —
  // an expired certificate is no more spendable than a used one.
  const sectionToday = new Date().toISOString().slice(0, 10);
  const hasUnbookedNight = (a: AccountData) => {
    const d = a.cardDetails;
    if (!d) return false;
    if (!d.freeNightCreditCents && !d.freeNightPointsLimit) return false;
    if (d.benefitUsedOn) return false;
    if (d.freeNightExpiresOn && d.freeNightExpiresOn < sectionToday) return false;
    return true;
  };
  // A card "contributes" to the Redeemable tile when it's in that rewards
  // category and has redeemable value (points × micro-value + free-night credit).
  const hasRedeemableIn = (a: AccountData, cat: "travel" | "hotel") => {
    const d = a.cardDetails;
    if (!d || d.rewardsCategory !== cat) return false;
    const pts = d.pointsValueMicros ? Math.round((d.currentPoints * d.pointsValueMicros) / 10_000) : 0;
    return pts + (d.freeNightCreditCents ?? 0) > 0;
  };
  const toggleBank = (bank: string) => setCollapsedBanks((prev) => {
    const next = new Set(prev);
    if (next.has(bank)) next.delete(bank);
    else next.add(bank);
    return next;
  });

  const reorder = (fromId: string, toId: string) => {
    const fromIdx = localAccounts.findIndex((a) => a.id === fromId);
    const toIdx = localAccounts.findIndex((a) => a.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...localAccounts];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalAccounts(next);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(next.map((a) => a.id)));
    startReorder(async () => {
      const res = await reorderAccounts(fd);
      setReorderError(res?.error ?? null);
    });
  };
  const { dragOverId, startDrag } = usePointerReorder("credit-card", reorder);

  // Bank-group order: dragging a bank header moves its whole card block. The
  // underlying store is still per-account sort_order — we just splice the
  // block, then persist the flattened order.
  const bankLabel = (a: AccountData) => {
    const raw = (a.cardDetails?.bank ?? a.institution ?? a.subtype ?? "Other").trim();
    if (!raw) return "Other";
    // Keep institution sections together even when entries use different
    // capitalization or spacing, while preserving the first card's display.
    const normalized = raw.replace(/\s+/g, " ").toLowerCase();
    const existing = localAccounts.find((candidate) => {
      const candidateRaw = (candidate.cardDetails?.bank ?? candidate.institution ?? candidate.subtype ?? "Other").trim();
      return candidateRaw.replace(/\s+/g, " ").toLowerCase() === normalized;
    });
    return existing
      ? (existing.cardDetails?.bank ?? existing.institution ?? existing.subtype ?? "Other").trim().replace(/\s+/g, " ")
      : raw.replace(/\s+/g, " ");
  };
  const reorderBank = (fromBank: string, toBank: string) => {
    if (fromBank === toBank) return;
    const fromCards = localAccounts.filter((a) => bankLabel(a) === fromBank);
    const otherCards = localAccounts.filter((a) => bankLabel(a) !== fromBank);
    const toIdx = otherCards.findIndex((a) => bankLabel(a) === toBank);
    if (fromCards.length === 0 || toIdx === -1) return;
    const next = [...otherCards.slice(0, toIdx), ...fromCards, ...otherCards.slice(toIdx)];
    setLocalAccounts(next);
    const fd = new FormData();
    fd.set("orderedIds", JSON.stringify(next.map((a) => a.id)));
    startReorder(async () => {
      const res = await reorderAccounts(fd);
      setReorderError(res?.error ?? null);
    });
  };
  const { dragOverId: dragOverBank, startDrag: startBankDrag } = usePointerReorder("credit-bank", reorderBank);
  const isArchived = section.key === "credit_archived";
  const isMain = section.key === "credit";
  const feeFilter = (a: AccountData) => !showOnlyFeeCards || hasActiveFee(a);
  const owedFilter = (a: AccountData) => !showOnlyOwedCards || hasOwed(a);
  const ptsFilter = (a: AccountData) => !showOnlyPtsCards || hasPts(a);
  const holderFilterFn = (a: AccountData) => !holderFilter || (a.holder ?? "") === holderFilter;
  const bankFilterFn = (a: AccountData) => !bankFilter || cardBank(a) === bankFilter;
  const nightFilter = (a: AccountData) => !showOnlyUnbookedNights || hasUnbookedNight(a);
  // A card jumped to from the Rewards activity ledger is always shown, whatever
  // the section is filtered down to — otherwise the card the click is aiming at
  // is filtered out, its panel never mounts, and the click looks broken.
  const isFocused = (a: AccountData) => a.id === focusCardId;
  const passesFilters = (a: AccountData) =>
    isFocused(a)
    || (feeFilter(a) && owedFilter(a) && ptsFilter(a) && holderFilterFn(a) && bankFilterFn(a) && nightFilter(a));
  // Per-category "contributes to Redeemable" filters — scoped to their own
  // section so clicking Travel Redeemable doesn't empty the Hotel list.
  const travelCards = localAccounts.filter((a) =>
    a.cardDetails?.rewardsCategory === "travel"
    && passesFilters(a)
    && (isFocused(a) || !showOnlyTravelRedeem || hasRedeemableIn(a, "travel")),
  );
  const hotelCards = localAccounts.filter((a) =>
    a.cardDetails?.rewardsCategory === "hotel"
    && passesFilters(a)
    && (isFocused(a) || !showOnlyHotelRedeem || hasRedeemableIn(a, "hotel")),
  );
  const otherCards = localAccounts.filter((a) => !a.cardDetails?.rewardsCategory && passesFilters(a));
  const focusedCard = focusCardId ? localAccounts.find((a) => a.id === focusCardId) ?? null : null;
  const focusedCategory = focusedCard?.cardDetails?.rewardsCategory ?? (focusedCard ? "other" : null);
  const hideTravelColumn = (showOnlyHotelRedeem || categoryFilter === "hotel") && focusedCategory !== "travel";
  const hideHotelColumn = (showOnlyTravelRedeem || categoryFilter === "travel") && focusedCategory !== "hotel";
  // Each rewards group collapses on its own header, persisted for the session
  // like the other collapsibles on this page. Undefined means open.
  const [groupOpen, setGroupOpen] = useSessionCollapse(
    "travel-credit-groups-open",
    () => ({ travel: true, hotel: true, other: true }),
  );
  const toggleGroup = (key: string) =>
    setGroupOpen((state) => ({ ...state, [key]: state[key] === false }));

  const travelOpen = groupOpen.travel !== false || focusedCategory === "travel";
  const hotelOpen = groupOpen.hotel !== false || focusedCategory === "hotel";
  const otherOpen = groupOpen.other !== false || focusedCategory === "other";
  const travelOwed = travelCards.reduce((sum, a) => sum + (a.owedCents ?? 0), 0);
  const hotelOwed = hotelCards.reduce((sum, a) => sum + (a.owedCents ?? 0), 0);
  const renderCards = (cards: AccountData[]) => (
    <ul className="divide-y divide-line">
      {cards.map((a) => (
        <CreditCardPanel
          key={a.id}
          card={a}
          currency={currency}
          nonCardAccounts={nonCardAccounts}
          allBuckets={allBuckets}
          isArchived={isArchived}
          onDragStart={() => startDrag(a.id)}
          isDragOver={dragOverId === a.id}
        />
      ))}
    </ul>
  );

  // Every headline figure and count respects both people-and-bank filters, so
  // the tiles never describe a wider set than the list under them.
  const holderScoped = <T extends AccountData>(list: T[]) =>
    list.filter((a) => holderFilterFn(a) && bankFilterFn(a));
  // Compact number formatter tuned so the sub-line's pieces still visibly add
  // up to the headline value. E.g. 1,025,563 → "1.03M" (not "1.0M"), so
  // Travel 395k + Hotel 1.03M reads consistent with total 1,420,563.
  const compactNum = (n: number) => {
    if (n >= 100_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 100_000) return `${(n / 1_000).toFixed(0)}k`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString();
  };
  // The same figures computed twice: once over the filtered cards (what the
  // tiles show) and once over every card (what decides which tiles exist).
  // Keeping presence on the unfiltered set means picking a bank re-values the
  // tiles in place — down to $0 where that bank has nothing — instead of
  // dropping tiles and reflowing the row under the cursor.
  const computeStats = (scope: <T extends AccountData>(list: T[]) => T[]) => {
    const open = scope(allCreditCards.filter((a) => !a.dateClosed));
    const feesPaid = open
      .filter((a) => !a.feeWaived && (a.annualFeeCents ?? 0) > 0)
      .reduce((s, a) => s + (a.annualFeeCents ?? 0), 0);
    const feesWaived = open
      .filter((a) => a.feeWaived && (a.annualFeeCents ?? 0) > 0)
      .reduce((s, a) => s + (a.annualFeeCents ?? 0), 0);
    const totalOwed = scope(accounts).reduce((s, a) => s + (a.owedCents ?? 0), 0);
    const rewardCards = scope(allCreditCards.filter((a) => a.cardDetails));
    const inCategory = (cat: "travel" | "hotel") =>
      rewardCards.filter((a) => a.cardDetails?.rewardsCategory === cat);
    const pointsForCategory = (cat: "travel" | "hotel") =>
      inCategory(cat).reduce((sum, a) => sum + (a.cardDetails?.currentPoints ?? 0), 0);
    // Cash value of the points balance itself, summed with each card's own
    // cents-per-point — the section-level total of the per-card "Total value"
    // metric. Free-night credits are excluded here (they show in the Travel /
    // Hotel redeemable tiles) so this tile answers "what are the points worth".
    const totalCardValueCents = rewardCards.reduce((sum, a) => {
      const d = a.cardDetails;
      if (!d || d.currentPoints <= 0 || !d.pointsValueMicros) return sum;
      return sum + Math.round((d.currentPoints * d.pointsValueMicros) / 10_000);
    }, 0);
    const redeemableForCategory = (cat: "travel" | "hotel") =>
      inCategory(cat).reduce((sum, a) => {
        const d = a.cardDetails!;
        const pts = d.pointsValueMicros ? Math.round((d.currentPoints * d.pointsValueMicros) / 10_000) : 0;
        return sum + pts + (d.freeNightCreditCents ?? 0);
      }, 0);
    // ---- Credit utilisation: balances owed as a share of total credit limit.
    // The single biggest lever on a credit score, and computable from limits
    // already stored per card. Only cards with a recorded limit are counted, so
    // the figure isn't skewed by cards whose limit hasn't been entered.
    const cardsWithLimit = open.filter((a) => (a.cardDetails?.spendingLimitCents ?? 0) > 0);
    const totalLimitCents = cardsWithLimit.reduce(
      (s, a) => s + (a.cardDetails?.spendingLimitCents ?? 0),
      0,
    );
    const owedOnLimitedCards = cardsWithLimit.reduce((s, a) => s + Math.max(0, a.owedCents ?? 0), 0);
    return {
      openCards: open,
      feesPaid,
      feesAll: feesPaid + feesWaived,
      totalOwed,
      rewardCards,
      totalPoints: rewardCards.reduce((sum, a) => sum + (a.cardDetails?.currentPoints ?? 0), 0),
      travelPoints: pointsForCategory("travel"),
      hotelPoints: pointsForCategory("hotel"),
      totalCardValueCents,
      travelRedeemable: redeemableForCategory("travel"),
      hotelRedeemable: redeemableForCategory("hotel"),
      totalLimitCents,
      utilisationPct: totalLimitCents > 0 ? (owedOnLimitedCards / totalLimitCents) * 100 : null,
      unbookedNights: open.filter(hasUnbookedNight).length,
    };
  };
  const stats = computeStats(holderScoped);
  const allStats = computeStats((list) => list);
  const {
    openCards, feesPaid, feesAll, totalOwed, totalPoints, travelPoints, hotelPoints,
    totalCardValueCents, travelRedeemable, hotelRedeemable, totalLimitCents, utilisationPct,
  } = stats;
  return (
    <section id={section.key === "credit" ? "credit-cards" : undefined} className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      {isMain ? (
        <div className="px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              // Keeps its own row until there is real width for the chips
              // beside it. Sharing the line squeezed the title to one word per
              // line on a phone, where the overflowing words then ran under
              // the chips, and to three cramped lines on a narrow desktop.
              className="w-full min-w-0 text-left lg:w-auto lg:flex-1"
              aria-expanded={open}
            >
              <span className="text-base font-bold sm:text-lg">Travel & Credit Card Rewards</span>
            </button>
            {/* Free nights still available, under the holder filter in force —
                the count and the list it filters to always agree. It sits in
                the title row because it is the question this section gets
                opened to answer, not one more way to narrow a list. */}
            {(() => {
              // Present whenever any card holds one, so the filters re-count
              // it in place rather than removing it from the title row.
              if (allStats.unbookedNights === 0) return null;
              return (
                <button
                  type="button"
                  onClick={() => setShowOnlyUnbookedNights((v) => !v)}
                  // Its own row on a phone: sharing the title line squeezed
                  // "Travel & Credit Card Rewards" onto three.
                  // Outlined like the calculator control beside it, so it
                  // reads as something to press rather than a label.
                  className={`order-last w-full shrink-0 rounded-md border px-2 py-1 text-left text-[11px] font-semibold transition sm:order-none sm:w-auto ${
                    showOnlyUnbookedNights
                      ? "border-transparent text-white"
                      : "border-black/25 bg-background text-foreground hover:bg-slate-100 dark:border-white/30 dark:hover:bg-slate-800"
                  }`}
                  style={showOnlyUnbookedNights ? { backgroundColor: "var(--viz-savings)" } : undefined}
                >
                  Free nights unbooked:{" "}
                  <span className="tabular-nums">{stats.unbookedNights}</span>
                </button>
              );
            })()}
            <a
              href="https://www.dailydrop.com/calculator"
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-brand/30 bg-background px-2 py-1 text-[11px] font-semibold text-brand transition hover:border-brand hover:bg-brand-soft dark:bg-slate-950"
            >
              <span className="sm:hidden">Calculator</span>
              <span className="hidden sm:inline">Points value calculator</span>
              <span aria-hidden>↗</span>
            </a>
            <button
              type="button"
              onClick={onToggle}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={open ? "Collapse credit card rewards" : "Expand credit card rewards"}
            >
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${open ? "" : "-rotate-90"}`}
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>

          {/* The stat tiles describe the *filtered* set, so they can all fall to
              zero (e.g. one bank whose cards hold no points and owe nothing).
              Only the grid is gated on that — the filter row below is what
              clears the filter, so it must never be hidden by it. */}
          {(allStats.totalPoints > 0 || allStats.travelRedeemable > 0 || allStats.hotelRedeemable > 0 || allStats.feesPaid > 0 || allStats.totalOwed > 0) ? (
            <div className="mt-4 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {allStats.totalPoints > 0 ? (
                <StatTile
                  label="Current Pts"
                  value={totalPoints.toLocaleString()}
                  sub={(() => {
                    const other = Math.max(0, totalPoints - travelPoints - hotelPoints);
                    const parts: string[] = [];
                    if (travelPoints > 0) parts.push(`Travel ${compactNum(travelPoints)}`);
                    if (hotelPoints > 0) parts.push(`Hotel ${compactNum(hotelPoints)}`);
                    if (other > 0) parts.push(`Other ${compactNum(other)}`);
                    return parts.length ? parts.join(" · ") : undefined;
                  })()}
                  tone="emerald"
                  onClick={() => setShowOnlyPtsCards((v) => !v)}
                  active={showOnlyPtsCards}
                />
              ) : null}
              {allStats.totalCardValueCents > 0 ? (
                <StatTile
                  label="Total Card Value"
                  value={formatMoney(totalCardValueCents, currency)}
                  sub="Points only"
                  tone="emerald"
                />
              ) : null}
              {allStats.travelRedeemable > 0 ? (
                <StatTile
                  label="Travel Value Redeemable"
                  value={formatMoney(travelRedeemable, currency)}
                  tone="sky"
                  onClick={() => setShowOnlyTravelRedeem((v) => !v)}
                  active={showOnlyTravelRedeem}
                />
              ) : null}
              {allStats.hotelRedeemable > 0 ? (
                <StatTile
                  label="Hotel Value Redeemable"
                  value={formatMoney(hotelRedeemable, currency)}
                  tone="teal"
                  onClick={() => setShowOnlyHotelRedeem((v) => !v)}
                  active={showOnlyHotelRedeem}
                />
              ) : null}
              {allStats.totalOwed > 0 ? (
                <StatTile
                  label="Total CC Owed"
                  value={formatMoney(totalOwed, currency)}
                  sub={
                    utilisationPct != null
                      ? `${utilisationPct.toFixed(0)}% of ${formatMoney(totalLimitCents, currency).replace(/\.00$/, "")} limit`
                      : undefined
                  }
                  // Under 30% is the conventional healthy threshold.
                  subColor={
                    utilisationPct == null
                      ? undefined
                      : utilisationPct < 30
                        ? "var(--positive)"
                        : "var(--negative)"
                  }
                  tone="rose"
                  onClick={() => setShowOnlyOwedCards((v) => !v)}
                  active={showOnlyOwedCards}
                />
              ) : null}
            </div>
          ) : null}
          {/* Fees, holder filter and card counts belong to the open section —
              collapsing leaves only the headline stat tiles. */}
          {open ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-muted">
              {allStats.feesPaid > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowOnlyFeeCards((v) => !v)}
                  className={`rounded-md px-2 py-1 font-semibold transition ${showOnlyFeeCards ? "bg-black/10 text-foreground dark:bg-white/15" : "text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                  title={showOnlyFeeCards ? "Show all cards" : "Show only cards with active annual fees"}
                >
                  Active fees <span className="tabular-nums text-negative">{formatMoney(feesPaid, currency)}/yr</span>
                </button>
              ) : null}
              {allStats.feesAll > 0 ? (
                <span>
                  Total fees w/out waiver <span className="font-semibold tabular-nums text-foreground">{formatMoney(feesAll, currency)}/yr</span>
                </span>
              ) : null}
              {/* Holder filter — chip per unique cardholder plus an "All" reset.
                  Clicking narrows every card list (Travel / Hotel / Other) to
                  that person's cards. */}
              {(() => {
                const holders = Array.from(
                  new Set(
                    allCreditCards
                      .map((a) => (a.holder ?? "").trim())
                      .filter(Boolean),
                  ),
                ).sort();
                if (holders.length < 2) return null;
                const chip = (active: boolean) =>
                  `rounded-md px-2 py-1 font-semibold transition ${
                    active
                      ? "text-white"
                      : "text-foreground hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`;
                return (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setHolderFilter(null)}
                      className={chip(holderFilter == null)}
                      style={holderFilter == null ? { backgroundColor: "var(--viz-savings)" } : undefined}
                    >
                      All
                    </button>
                    {holders.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() =>
                          setHolderFilter((prev) => (prev === h ? null : h))
                        }
                        className={chip(holderFilter === h)}
                        style={holderFilter === h ? { backgroundColor: "var(--viz-savings)" } : undefined}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                );
              })()}
              {/* Bank filter — a dropdown rather than a chip row: there are
                  more issuers than people, and they read as a list. */}
              {(() => {
                const banks = [...new Set(allCreditCards.map(cardBank).filter(Boolean))]
                  .sort((a, b) => a.localeCompare(b));
                if (banks.length < 2) return null;
                return (
                  <select
                    value={bankFilter ?? ""}
                    onChange={(e) => setBankFilter(e.target.value || null)}
                    aria-label="Filter by bank"
                    className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="">All banks</option>
                    {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                );
              })()}
              {/* The card counts double as the column filter: travel shows the
                  travel column alone, hotel the hotel one, total puts both
                  back with Other underneath. */}
              {(() => {
                const scoped = holderScoped(accounts);
                const count = (cat: "travel" | "hotel" | null) =>
                  cat === null
                    ? scoped.length
                    : scoped.filter((a) => a.cardDetails?.rewardsCategory === cat).length;
                // Outlined so all three read as pressable, filled only when
                // one is actually narrowing the list. "Total" is the resting
                // state, so a filled pill there said a filter was on when
                // none was.
                const countChip = (cat: "travel" | "hotel" | null, label: string) => {
                  const active = cat !== null && categoryFilter === cat;
                  return (
                    <button
                      type="button"
                      // Clicking the chip that's already on clears the filter,
                      // so getting back to everything doesn't mean hunting for
                      // "total".
                      onClick={() => setCategoryFilter((prev) => (prev === cat ? null : cat))}
                      className={`rounded-md border px-1.5 py-0.5 transition ${
                        active
                          ? "border-transparent text-white"
                          : "border-black/20 bg-background hover:bg-slate-100 dark:border-white/25 dark:hover:bg-slate-800"
                      }`}
                      style={active ? { backgroundColor: "var(--viz-savings)" } : undefined}
                    >
                      <span className={`font-semibold tabular-nums ${active ? "" : "text-foreground"}`}>
                        {count(cat)}
                      </span>{" "}
                      {label}
                    </button>
                  );
                };
                return (
                  <span className="flex items-center gap-1 sm:ml-auto">
                    {countChip("travel", "travel")}
                    {countChip("hotel", "hotel")}
                    {countChip(null, "total")}
                  </span>
                );
              })()}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2.5 text-left"
            aria-expanded={open}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${section.dot}`} />
            <span className="font-semibold">{section.label}</span>
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
              {accounts.length} card{accounts.length !== 1 ? "s" : ""}
            </span>
            <svg
              width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {totalOwed > 0 ? (
            <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-negative sm:text-sm">
              {formatMoney(totalOwed, currency)} owed
            </span>
          ) : null}
        </div>
      )}

      {open ? (
        <div className="border-t-2 border-foreground/25">
          {reorderError ? (
            <p className="border-b border-line px-4 py-1.5 text-xs font-medium text-negative">{reorderError}</p>
          ) : null}
          {localAccounts.length === 0 ? (
            <p className="px-4 py-2.5 text-sm text-muted">
              {isArchived ? "No archived cards." : "No credit cards yet — add one below."}
            </p>
          ) : isMain ? (
            <div>
              {/* Travel stacks above Hotel at every width. Side-by-side halves
                  squeezed each card's badges into a 3-4 line pile; full width
                  lets the per-card metrics line up in columns left-to-right. */}
              <div className="grid grid-cols-1 divide-y divide-line">
                {hideTravelColumn ? null : (
                <section>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-background/60 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleGroup("travel")}
                      aria-expanded={travelOpen}
                      className="flex flex-1 items-center gap-2 text-left sm:gap-2.5"
                    >
                    <GroupChevron open={travelOpen} />
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                      </svg>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-sm font-bold text-foreground sm:text-base">Travel Rewards</span>
                    <span className="shrink-0 whitespace-nowrap rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {travelCards.length} card{travelCards.length !== 1 ? "s" : ""}
                    </span>
                    </button>
                    <span className={`ml-auto whitespace-nowrap text-sm font-bold tabular-nums ${travelOwed > 0 ? "text-negative" : "text-muted"}`}>
                      {formatMoney(travelOwed, currency)} owed
                    </span>
                  </div>
                  {!travelOpen ? null : travelCards.length > 0 ? renderCards(travelCards) : <p className="px-4 py-4 text-sm text-muted">No travel cards yet.</p>}
                </section>
                )}
                {hideHotelColumn ? null : (
                <section>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-background/60 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleGroup("hotel")}
                      aria-expanded={hotelOpen}
                      className="flex flex-1 items-center gap-2 text-left sm:gap-2.5"
                    >
                    <GroupChevron open={hotelOpen} />
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 21V7l7-4v4h11v14" />
                        <path d="M7 10h.01M11 10h.01M15 14h.01M11 14h.01M7 14h.01M15 18h.01M11 18h.01M7 18h.01" />
                      </svg>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-sm font-bold text-foreground sm:text-base">Hotel Rewards</span>
                    <span className="shrink-0 whitespace-nowrap rounded-md bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {hotelCards.length} card{hotelCards.length !== 1 ? "s" : ""}
                    </span>
                    </button>
                    <span className={`ml-auto whitespace-nowrap text-sm font-bold tabular-nums ${hotelOwed > 0 ? "text-negative" : "text-muted"}`}>
                      {formatMoney(hotelOwed, currency)} owed
                    </span>
                  </div>
                  {!hotelOpen ? null : hotelCards.length > 0 ? renderCards(hotelCards) : <p className="px-4 py-4 text-sm text-muted">No hotel cards yet.</p>}
                </section>
                )}
              </div>
              {otherCards.length > 0 && !showOnlyTravelRedeem && !showOnlyHotelRedeem && categoryFilter === null ? (
                <section className="border-t border-line">
                  <div className="flex items-center gap-2.5 border-b-2 border-foreground/25 bg-slate-500/[0.06] px-4 py-3 dark:bg-slate-500/10">
                    <button
                      type="button"
                      onClick={() => toggleGroup("other")}
                      aria-expanded={otherOpen}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                    <GroupChevron open={otherOpen} />
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-500/15 text-slate-600 dark:text-slate-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="2" y="5" width="20" height="14" rx="2" />
                        <path d="M2 10h20" />
                      </svg>
                    </span>
                    <span className="whitespace-nowrap text-sm font-bold text-foreground sm:text-base">Other Cards</span>
                    <span className="shrink-0 whitespace-nowrap rounded-md bg-slate-500/15 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {otherCards.length} card{otherCards.length !== 1 ? "s" : ""}
                    </span>
                    </button>
                    <span className="ml-auto text-xs text-muted">Choose Travel or Hotel when editing a card.</span>
                  </div>
                  {otherOpen ? renderCards(otherCards) : null}
                </section>
              ) : null}
            </div>
          ) : (() => {
            const groups = localAccounts.reduce<{ bank: string; cards: AccountData[] }[]>((acc, a) => {
              const b = bankLabel(a);
              const existing = acc.find((g) => g.bank === b);
              if (existing) { existing.cards.push(a); } else { acc.push({ bank: b, cards: [a] }); }
              return acc;
            }, []);
            return (
              <div className="divide-y divide-line">
                {groups.map((group) => {
                  const collapsed =
                    collapsedBanks.has(group.bank)
                    && !group.cards.some((c) => c.id === focusCardId);
                  const isBankDragOver = dragOverBank === group.bank;
                  return (
                    <div
                      key={group.bank}
                      data-drop-key={`credit-bank:${group.bank}`}
                      className={isBankDragOver ? "ring-2 ring-inset ring-brand/50" : ""}
                    >
                      <div
                        className={`flex items-center gap-1 pl-2 pr-4 py-1.5 bg-black/[0.04] dark:bg-white/[0.05] ${
                          isBankDragOver ? "bg-brand-soft/40" : "hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                        }`}
                      >
                        <GripHandle size="sm" onMouseDown={() => startBankDrag(group.bank)} />
                        <button
                          type="button"
                          onClick={() => toggleBank(group.bank)}
                          className="flex flex-1 items-center gap-2 text-left"
                        >
                          <svg
                            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                            className={`shrink-0 text-muted transition-transform ${collapsed ? "-rotate-90" : ""}`}
                            aria-hidden
                          >
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                          <span className="text-xs font-bold uppercase tracking-wide text-foreground">
                            {group.bank}
                          </span>
                          <span className="text-xs font-medium text-muted">
                            {group.cards.length} card{group.cards.length !== 1 ? "s" : ""}
                          </span>
                        </button>
                      </div>
                      {!collapsed && (
                        <ul className="divide-y divide-line">
                          {group.cards.map((a) => (
                            <CreditCardPanel
                              key={a.id}
                              card={a}
                              currency={currency}
                              nonCardAccounts={nonCardAccounts}
                              allBuckets={allBuckets}
                              isArchived={isArchived}
                              onDragStart={() => startDrag(a.id)}
                              isDragOver={dragOverId === a.id}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      ) : null}
    </section>
  );
}

// One cell of the credit-card metric grid: a small fixed label with the value
// under it, so the same metric lands at the same x across every card. Empty
// values print an em dash rather than collapsing the cell.
// Disclosure caret for the rewards group headers (Travel / Hotel / Other).
function GroupChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function MetricCell({
  label,
  children,
  omit = false,
}: {
  label: string;
  children: React.ReactNode;
  // `omit` = the metric doesn't apply to this card at all (not just blank):
  // the cell keeps its grid slot on wide screens so neighbouring cards stay in
  // register, but shows no label and no dash.
  omit?: boolean;
}) {
  // Empty cells hold the column open from 420px up so the grid stays aligned,
  // but drop out entirely on a phone, where six dashes per card would triple
  // the scroll for no information.
  const empty = children === null || children === undefined || children === false;
  if (omit) return <span aria-hidden className="hidden min-[420px]:block" />;
  return (
    <span className={`min-w-0 text-center ${empty ? "hidden min-[420px]:block" : "block"}`}>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="block truncate text-[12px] leading-tight">
        {empty ? <span className="text-muted/60">&mdash;</span> : children}
      </span>
    </span>
  );
}


function RewardsActivityLedger({
  entries,
  currency,
}: {
  entries: Array<RewardActivity & { cardName: string; cardId: string }>;
  currency: string;
}) {
  const labels: Record<RewardActivity["type"], string> = {
    points_redemption: "Points used",
    points_earned: "Points earned",
    hotel_credit_redemption: "Hotel credit used",
    free_night_booking: "Free night booked",
    reward_refund: "Points refunded",
  };
  // Default to this year: the ledger is a running log and the rows worth
  // seeing on arrival are the ones from the year being lived. Older years are
  // one pick away, and "All" is still there for the whole history.
  const thisYear = String(new Date().getFullYear());
  const years = [...new Set([thisYear, ...entries.map((e) => e.occurredOn.slice(0, 4))])].sort().reverse();
  const [yearState, setYear] = useState<string>(thisYear);
  const year = yearState === "all" || years.includes(yearState) ? yearState : thisYear;
  const visibleEntries = year === "all" ? entries : entries.filter((e) => e.occurredOn.slice(0, 4) === year);
  // Starts collapsed on a fresh login — it sits below Card payments and is
  // reference data, not something to scan on every visit; sessionStorage still
  // carries whatever it was last set to while moving around the app.
  const [openState, setOpenState] = useSessionCollapse("travel-rewards-activity-open", () => ({ open: false }));
  const { requestFocus } = React.useContext(RewardFocusContext);
  const open = openState.open;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={() => setOpenState((s) => ({ ...s, open: !s.open }))}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden
            className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0">
            <span className="block text-sm font-bold">Rewards Points Transactions Log</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="cursor-pointer rounded-lg bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
            <option value="all">All years</option>
          </select>
          <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
            {visibleEntries.length} {visibleEntries.length === 1 ? "entry" : "entries"}
          </span>
        </div>
      </div>
      {!open ? null : visibleEntries.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">
          {entries.length === 0
            ? "No rewards activity yet. Open a card and choose “Rewards Activity Log” to create the first entry."
            : `No rewards activity in ${year}.`}
        </p>
      ) : (
        <ul className="divide-y divide-line bg-background/70">
          {visibleEntries.map((entry) => (
            <li key={entry.id} className="grid grid-cols-[4.75rem_minmax(0,1fr)_auto_auto] items-center gap-2 px-4 py-2.5 text-xs hover:bg-black/[0.03] sm:grid-cols-[5.5rem_11rem_minmax(0,1fr)_auto_auto] dark:hover:bg-white/[0.04]">
              {/* The row is the way back to the card that made the entry:
                  clicking it opens that card's rewards log and scrolls to it,
                  instead of leaving you to hunt for the card by hand. Only the
                  reading cells are the button — Delete keeps its own hit
                  area, and a <button> can't nest inside another one. */}
              <button
                type="button"
                onClick={() => requestFocus(entry.cardId)}
                className="col-span-4 grid cursor-pointer grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-2 text-left sm:col-span-4 sm:grid-cols-[5.5rem_11rem_minmax(0,1fr)_auto] sm:contents"
              >
                <span className="text-muted tabular-nums">{entry.occurredOn}</span>
                <span className="min-w-0 truncate font-semibold">{entry.cardName}</span>
                <span className="min-w-0 truncate text-muted">{labels[entry.type]}{entry.bookedOn ? ` · Booked ${entry.bookedOn}` : ""}{entry.note ? ` · ${entry.note}` : ""}</span>
                <span className={`whitespace-nowrap font-semibold tabular-nums ${entry.pointsDelta > 0 || entry.hotelCreditDeltaCents > 0 ? "text-positive" : "text-negative"}`}>
                  {entry.pointsDelta ? `${entry.pointsDelta > 0 ? "+" : ""}${entry.pointsDelta.toLocaleString()} pts` : entry.hotelCreditDeltaCents ? formatMoney(entry.hotelCreditDeltaCents, currency) : "Booked"}
                </span>
              </button>
              <RewardActivityRowActions entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Delete undoes an entry outright — the AFTER DELETE trigger hands back
// whatever the row took. There used to be an Archive button beside it that
// only set a hidden flag and moved nothing; Victor had it removed once Delete
// existed ("delete is enough"), since a ledger you can correct doesn't also
// need a way to hide a wrong row.
function RewardActivityRowActions({ entry, compact = false }: { entry: RewardActivity; compact?: boolean }) {
  const [deletePending, startDelete] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    // In the bottom ledger this sits in a 4-column grid below sm, where it is
    // the 5th child: it has to span all four columns or it lands in the narrow
    // first one and the buttons get clipped off the edge. In the card panel's
    // own recent list the row is a plain flex, so no spanning is wanted.
    <div
      className={`flex flex-col items-end gap-1 ${
        compact
          // Confirming adds two wider buttons; on a phone they only fit if
          // they take the whole line instead of squeezing the entry's label
          // down to "Points …".
          ? confirming ? "w-full sm:w-auto" : ""
          : "col-span-4 sm:col-span-1"
      }`}
    >
      <div className="flex items-center gap-1">
        {confirming ? (
          <>
            <form
              action={(formData) =>
                startDelete(async () => {
                  setError(null);
                  const result = await deleteCreditCardRewardActivity(formData);
                  if (result?.error) setError(result.error);
                  else setConfirming(false);
                })
              }
            >
              <input type="hidden" name="activityId" value={entry.id} />
              <button
                type="submit"
                disabled={deletePending}
                aria-busy={deletePending}
                className="cursor-pointer rounded-md bg-negative px-2 py-1 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-80"
              >
                {deletePending ? "Deleting…" : "Delete & give back"}
              </button>
            </form>
            {deletePending ? null : (
              <button
                type="button"
                onClick={() => { setConfirming(false); setError(null); }}
                className="cursor-pointer px-1 text-[11px] font-medium text-muted hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded-md border border-line bg-background px-2 py-1 text-[11px] font-semibold text-negative transition hover:border-negative/60 hover:bg-negative/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-negative dark:bg-slate-950 dark:hover:bg-negative/20"
          >
            Delete
          </button>
        )}
      </div>
      {error ? <span className="max-w-[18rem] text-right text-[11px] font-medium text-negative">{error}</span> : null}
    </div>
  );
}

// The card row opens a compact action tray first. Editing is an explicit choice,
// which keeps routine browsing from unexpectedly dropping a long form into view.
function CreditCardPanel({
  card,
  currency,
  nonCardAccounts,
  allBuckets,
  isArchived,
  onDragStart,
  isDragOver,
}: {
  card: AccountData;
  currency: string;
  nonCardAccounts: NonCardAccount[];
  allBuckets: BucketData[];
  isArchived: boolean;
  onDragStart?: () => void;
  isDragOver?: boolean;
}) {
  const [expandedState, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [loggingRewardsState, setLoggingRewards] = useState(false);
  // Arriving from a click on a Rewards activity row. Open-ness is DERIVED from
  // the focus rather than pushed into state by an effect — the effect only
  // scrolls, which is the one thing state can't express. Closing the panel or
  // the log clears the focus, so it never props itself back open.
  const { focusCardId, clearFocus } = React.useContext(RewardFocusContext);
  const travel = React.useContext(TravelStayContext);
  const focused = focusCardId === card.id;
  const expanded = expandedState || focused;
  const loggingRewards = loggingRewardsState || focused;
  const rowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!focused) return;
    rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const [closePending, startClose] = useTransition();
  const [reopenPending, startReopen] = useTransition();

  const d = card.cardDetails;
  const owed = card.owedCents ?? 0;

  // Free-night expiry state for highlighting
  const today = new Date().toISOString().slice(0, 10);
  const fnExpires = d?.freeNightExpiresOn ?? null;
  const fnExpired = fnExpires ? fnExpires < today : false;
  const fnExpiresColor = fnExpired ? "text-negative font-semibold" : "text-foreground font-semibold";
  const bank = cardBank(card) || null;
  // One card showing any reward figure turns the metric grid on for that row;
  // plain cards (no points, no night credit) keep the single identity line.
  // "Booked" only means something on a card that carries a free-night / hotel
  // credit — on a plain points card the column is noise, so it holds its grid
  // slot but prints nothing.
  const hasNightCredit = Boolean(d?.freeNightCreditCents || d?.freeNightPointsLimit);
  const hasMetrics = Boolean(
    d && (d.currentPoints > 0 || d.freeNightCreditCents || d.freeNightPointsLimit
      || d.freeNightExpiresOn || d.benefitUsedOn || d.charging),
  );

  return (
    <li
      ref={rowRef}
      data-drop-key={`credit-card:${card.id}`}
      className={`${expanded ? "bg-background/60" : "hover:bg-background/40"} ${isDragOver ? "outline outline-2 -outline-offset-2 outline-brand" : ""}`}
    >
      {/* Collapsed row */}
      <div className="flex items-center">
        {!isArchived && onDragStart ? (
          <span className="flex-none pl-2 py-2">
            <GripHandle onMouseDown={onDragStart} size="sm" />
          </span>
        ) : null}
      <button
        type="button"
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (!next) {
            setEditing(false);
            setPaying(false);
            setLoggingRewards(false);
            clearFocus();
          }
        }}
        className={`flex min-w-0 flex-1 items-start gap-2 ${!isArchived && onDragStart ? "pl-1" : "pl-4"} pr-3 py-2 text-left`}
        aria-expanded={expanded}
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="w-full min-w-0 whitespace-normal break-words text-sm font-semibold leading-tight sm:w-auto sm:truncate">{card.name}</span>
            {/* Labelled "Owner:" the way the authorized user is labelled "AU:"
                — a bare name beside the bank chip read as another bank. */}
            {card.holder ? (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Owner: <span className="text-slate-700 dark:text-slate-200">{card.holder}</span>
              </span>
            ) : null}
            {bank ? (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">
                Bank: <span className="text-slate-700 dark:text-slate-200">{bank}</span>
              </span>
            ) : null}
            {/* Authorized user sits right of the bank so the row reads
                holder -> bank -> who else can charge on it. The label stays
                muted so it doesn't compete with the holder chip. */}
            {d?.authUser ? (
              <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
                Authorized User: <span className="text-foreground">{d.authUser}</span>
              </span>
            ) : null}
            {card.dateClosed ? (
              <span className="shrink-0 rounded bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
                Closed {card.dateClosed}
              </span>
            ) : null}
            {d?.isRevolvingDebt ? (
              <span className="shrink-0 rounded bg-negative/10 px-1.5 py-0.5 text-[10px] font-semibold text-negative">
                Debt
              </span>
            ) : null}
            {card.annualFeeCents && !card.feeWaived ? (
              <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-muted dark:bg-white/10">
                Active Fee: <span className="text-negative">${Math.round(card.annualFeeCents / 100)}/yr</span>
              </span>
            ) : null}
          </span>
          {hasMetrics ? (
            /* Excel-style metric row: one labelled cell per column, aligned
               across every card in the section. Cells stay in place even when
               a card has no value for them ("—") so the eye can scan down a
               column instead of re-reading a wrapped badge pile. */
            <span className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5 min-[420px]:grid-cols-3 lg:grid-cols-6">
              <MetricCell label="Current pts">
                {d && d.currentPoints > 0 ? (
                  <span className="tabular-nums font-bold text-emerald-700 dark:text-emerald-300">
                    {d.currentPoints.toLocaleString()}
                  </span>
                ) : null}
              </MetricCell>
              <MetricCell label="Charging">
                {d?.charging ? <span className="font-semibold">{d.charging}</span> : null}
              </MetricCell>
              <MetricCell label="Total value">
                {d && d.currentPoints > 0 && d.pointsValueMicros ? (
                  <span className="tabular-nums font-bold text-emerald-700 dark:text-emerald-300">
                    ${Math.round((d.currentPoints * d.pointsValueMicros) / 10_000 / 100).toLocaleString()}
                  </span>
                ) : null}
              </MetricCell>
              <MetricCell label="Night credit">
                {(d?.freeNightCreditCents || d?.freeNightPointsLimit) ? (
                  <span className="tabular-nums font-bold" style={{ color: "var(--viz-savings)" }}>
                    {d?.freeNightCreditCents
                      ? `$${Math.round(d.freeNightCreditCents / 100).toLocaleString()}`
                      : `${d.freeNightPointsLimit!.toLocaleString()} pts`}
                  </span>
                ) : null}
              </MetricCell>
              <MetricCell label={fnExpired ? "Expired" : "Expires"}>
                {d?.freeNightExpiresOn ? (
                  <span className={`tabular-nums ${fnExpiresColor}`}>
                    {d.freeNightExpiresOn.replace(/-/g, "\u2011")}
                  </span>
                ) : null}
              </MetricCell>
              <MetricCell label="Booked" omit={!hasNightCredit}>
                {d?.benefitUsedOn ? (
                  <span
                    className={`tabular-nums font-semibold ${
                      d.benefitUsedOn < today ? "text-negative" : "text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    {d.benefitUsedOn.replace(/-/g, "\u2011")}
                  </span>
                ) : null}
              </MetricCell>
            </span>
          ) : null}
        </span>
        {/* Fixed width, not shrink-to-fit: a variable balance column would give
            every row a different amount of space for the metric grid, and the
            columns would zig-zag from card to card instead of lining up. */}
        <span className={`ml-2 w-20 shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums sm:w-28 ${owed > 0 ? "text-negative" : owed < 0 ? "text-positive" : "text-muted"}`}>
          {owed !== 0 ? formatMoney(owed, currency) : "—"}
        </span>
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`mt-1 shrink-0 text-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      </div>

      {expanded ? (
        <div className="border-t border-line bg-background">
          {/* Every one of these opens in a modal, the way Add stay does — the
              forms used to push the rest of the list down the page. */}
          <div className="grid grid-cols-3 items-center gap-1.5 px-3 py-2.5 min-[380px]:grid-cols-5 sm:flex sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-black/[0.04] px-1.5 py-1.5 text-[11px] font-medium text-primary hover:bg-black/[0.08] sm:w-auto sm:shrink-0 sm:px-2 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Edit
            </button>
            {d?.cardUrl ? (
              <a
                href={externalCardUrl(d.cardUrl)}
                target="_blank"
                rel="noreferrer"
                title={`Open ${d.cardUrl}`}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-line bg-background px-1.5 py-1.5 text-[11px] font-semibold text-brand transition-colors hover:border-brand hover:bg-brand-soft sm:w-auto sm:shrink-0 sm:px-2 dark:bg-slate-950"
              >
                <span className="sm:hidden">Site</span><span className="hidden sm:inline">Visit site</span> <span aria-hidden>↗</span>
              </a>
            ) : null}
            {!isArchived && !card.dateClosed ? (
              <button
                type="button"
                onClick={() => setLoggingRewards(true)}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-brand/35 bg-background px-1.5 py-1.5 text-[11px] font-semibold text-brand transition-colors hover:border-brand hover:bg-brand-soft sm:w-auto sm:shrink-0 sm:px-2 dark:bg-slate-950"
              >
                <span className="sm:hidden">Rewards</span><span className="hidden sm:inline">Rewards Activity Log</span>
              </button>
            ) : null}
            {/* A stay is not a ledger line — it has a city, nights, pax and
                a cash rate — so it opens the Travel Log's own Add stay
                form, pre-selected to this card. It sits beside Rewards Activity Log
                rather than inside it: from inside, it read as one more way
                to log a redemption. */}
            {!isArchived && !card.dateClosed ? (
              <button
                type="button"
                onClick={() => setStayOpen(true)}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-brand/35 bg-background px-1.5 py-1.5 text-[11px] font-semibold text-brand transition-colors hover:border-brand hover:bg-brand-soft sm:w-auto sm:shrink-0 sm:px-2 dark:bg-slate-950"
              >
                <span className="sm:hidden">Book stay</span><span className="hidden sm:inline">Book a stay</span>
              </button>
            ) : null}
            {!isArchived && !card.dateClosed ? (
              <button
                type="button"
                onClick={() => setPaying(true)}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-brand px-1.5 py-1.5 text-[11px] font-medium text-white hover:bg-brand-strong sm:w-auto sm:shrink-0 sm:px-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
                <span className="sm:hidden">Pay</span><span className="hidden sm:inline">{owed > 0 ? "Pay balance" : "Pay card"}</span>
              </button>
            ) : null}
            {!isArchived && !card.dateClosed ? (
              <form action={(fd) => startClose(() => closeCard(fd))} className="col-span-2 min-[380px]:col-span-1 sm:ml-auto sm:shrink-0">
                <input type="hidden" name="id" value={card.id} />
                <button
                  type="submit"
                  disabled={closePending}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-negative/10 px-1.5 py-1.5 text-[11px] font-medium text-negative hover:bg-negative/15 disabled:opacity-60 sm:w-auto sm:px-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                  {closePending ? "Closing…" : <><span className="sm:hidden">Close</span><span className="hidden sm:inline">Close card</span></>}
                </button>
              </form>
            ) : null}
            {(isArchived || card.dateClosed) ? (
              <form action={(fd) => startReopen(() => reopenCard(fd))}>
                <input type="hidden" name="id" value={card.id} />
                <button
                  type="submit"
                  disabled={reopenPending}
                  className="rounded-md bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:brightness-95 dark:hover:brightness-110 disabled:opacity-60"
                >
                  {reopenPending ? "Reopening…" : "Reopen"}
                </button>
              </form>
            ) : null}
          </div>

          {editing ? (
            <EditCreditCardForm
              key={JSON.stringify(card.cardDetails) + card.annualFeeCents + card.dateOpened + card.dateClosed + card.holder + card.name}
              card={card}
              onDone={() => setEditing(false)}
            />
          ) : null}
          {paying ? (
            <PayCardModal
              card={card}
              currency={currency}
              nonCardAccounts={nonCardAccounts}
              allBuckets={allBuckets}
              onClose={() => setPaying(false)}
            />
          ) : null}
          {stayOpen ? (
            <StayModal
              stay={null}
              cards={travel.cards}
              brands={travel.brands}
              currency={currency}
              defaultAccountId={card.id}
              // StayModal calls router.refresh() on a successful save, so the
              // card's points and Booked date are current behind it.
              onClose={() => setStayOpen(false)}
            />
          ) : null}
          {loggingRewards ? (
            <RewardActivityForm
              card={card}
              currency={currency}
              onDone={() => { setLoggingRewards(false); clearFocus(); }}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// The Direction toggle's three states, as soft washes rather than solid
// fills — a saturated pill shouted at you from inside an already-outlined
// form. Each keeps its own hue (spend / earn / correction) so the state is
// still readable at a glance, and both themes come free: the tokens flip,
// the mix follows.
const DIRECTION_TONE = {
  used: "var(--viz-debt)",
  earned: "var(--positive)",
  returned: "var(--viz-savings)",
} as const;

function softPill(tone: string): React.CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)`,
    color: tone,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 40%, transparent)`,
  };
}

function RewardActivityForm({
  card,
  currency,
  onDone,
}: {
  card: AccountData;
  currency: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Points move both ways: everyday spending earns them, redemptions spend
  // them. Earning used to have no entry at all — the balance was typed over
  // in the card's edit form, which left no record of where it came from.
  const [direction, setDirection] = useState<"used" | "earned" | "returned">("used");
  const [points, setPoints] = useState("");
  const d = card.cardDetails;
  const labels: Record<RewardActivity["type"], string> = {
    points_redemption: "Points used",
    points_earned: "Points earned",
    hotel_credit_redemption: "Hotel credit used",
    free_night_booking: "Free night booked",
    reward_refund: "Points refunded",
  };

  return (
    <ModalShell
      title={
        direction === "used"
          ? `Log points used · ${card.name}`
          : direction === "earned"
            ? `Log points earned · ${card.name}`
            : `Log points returned · ${card.name}`
      }
      onClose={onDone}
    >
      <div className="px-5 py-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <form
        action={(formData) => start(async () => {
          setError(null);
          const result = await logCreditCardRewardActivity(formData);
          if (result?.error) setError(result.error);
          else {
            // The card's points and Booked date are server-rendered; without
            // this the row keeps showing the pre-redemption balance.
            router.refresh();
            onDone();
          }
        })}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <input type="hidden" name="accountId" value={card.id} />
        {/* Hotel credit is NOT here. It is spent ON a stay, and the Add stay
            form has its own "Hotel credit used" field drawing from the same
            ledger — offering both would let one credit be logged twice. */}
        <input
          type="hidden"
          name="activityType"
          value={
            direction === "used"
              ? "points_redemption"
              : direction === "earned"
                ? "points_earned"
                : "reward_refund"
          }
        />
        <div className="sm:col-span-2">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Direction</span>
          <div className="inline-flex rounded-md ring-1 ring-line">
            {(["used", "earned", "returned"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={direction === option}
                onClick={() => setDirection(option)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  direction === option ? "" : "text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                }`}
                style={direction === option ? softPill(DIRECTION_TONE[option]) : undefined}
              >
                {option === "used" ? "Points used" : option === "earned" ? "Points earned" : "Points refunded"}
              </button>
            ))}
          </div>
        </div>
        {/* No default date: an entry is logged after the fact as often as on
            the day, and a pre-filled today gets saved by accident. Left blank
            the server answers with "Enter a valid activity date." */}
        <LabeledInput label="Activity date" name="occurredOn" type="date" defaultValue="" />
        <LabeledInput
          label={
            direction === "used"
              ? `Points used · ${d?.currentPoints.toLocaleString() ?? "0"} available`
              : direction === "earned"
                ? `Points earned · ${d?.currentPoints.toLocaleString() ?? "0"} on the card now`
                : `Points returned · ${d?.currentPoints.toLocaleString() ?? "0"} on the card now`
          }
          name="pointsUsed"
          type="number"
          min="1"
          step="1"
          placeholder="0"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
        <div className="sm:col-span-2">
          <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Note (optional)</label>
          <input name="note" placeholder="Hotel, trip, confirmation, or redemption details" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" disabled={pending} className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60">{pending ? "Saving…" : "Add activity"}</button>
        </div>
        {error ? <p className="sm:col-span-2 text-sm font-medium text-negative">{error}</p> : null}
      </form>
      {card.rewardActivities.length > 0 ? (
        <div className="mt-3 border-t border-line pt-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Recent rewards activity</p>
          <ul className="space-y-1 text-xs">
            {card.rewardActivities.slice(0, 5).map((activity) => (
              // Delete lives on the row you are already looking at. It used
              // to exist only in the Rewards activity ledger at the bottom of
              // the page, so fixing a wrong entry meant scrolling away from
              // the card that made it and finding the row again.
              <li key={activity.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 truncate">{labels[activity.type]} · {activity.bookedOn ? `Booked ${activity.bookedOn}` : activity.occurredOn}{activity.note ? ` · ${activity.note}` : ""}</span>
                <span className={`shrink-0 font-semibold ${activity.pointsDelta > 0 || activity.hotelCreditDeltaCents > 0 ? "text-positive" : "text-negative"}`}>{activity.pointsDelta ? `${activity.pointsDelta > 0 ? "+" : ""}${activity.pointsDelta.toLocaleString()} pts` : activity.hotelCreditDeltaCents ? formatMoney(activity.hotelCreditDeltaCents, currency) : "Booked"}</span>
                <RewardActivityRowActions entry={activity} compact />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>
    </ModalShell>
  );
}

function EditCreditCardForm({
  card,
  onDone,
}: {
  card: AccountData;
  onDone: () => void;
}) {
  const [savePending, startSave] = useTransition();
  const [delPending, startDel] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [migrationWarning, setMigrationWarning] = useState(false);
  const [activeTab, setActiveTab] = useState<"key" | "basics" | "debt">("key");
  const d = card.cardDetails;
  // Every bank already spelled out on another card, offered as a dropdown on
  // the Bank field. A list, not a <select>: a new issuer still gets typed in,
  // and picking an existing one keeps the spelling identical so the chips and
  // the by-bank grouping don't split "Cap 1" from "Capital One".
  const { accounts: allCards } = useRewardsData();
  const bankOptions = [...new Set(allCards.map(cardBank).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const tabBtn = (id: "key" | "basics" | "debt", label: string, mobileLabel: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`h-8 min-w-0 whitespace-nowrap px-1 text-[11px] font-semibold transition sm:px-2.5 sm:text-sm ${
        activeTab === id
          ? "text-brand shadow-[inset_0_-2px_0_var(--brand)]"
          : "text-muted hover:bg-slate-50 hover:text-foreground dark:hover:bg-slate-900"
      }`}
      aria-pressed={activeTab === id}
    >
      <span className="sm:hidden">{mobileLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <ModalShell title={`Edit ${card.name}`} onClose={onDone}>
      <div className="bg-background p-3">
      {/* One form: saves both account-level basics AND rewards details together.
          All tabs stay mounted (hidden via CSS) so a single Save submits every field. */}
      <form
        action={(fd) =>
          startSave(async () => {
            setDetailsError(null);
            setMigrationWarning(false);
            const [, detailsResult] = await Promise.all([
              updateAccount(fd),
              upsertCardDetails(fd),
            ]);
            if (detailsResult?.error) { setDetailsError(detailsResult.error); return; }
            if (detailsResult?.missingMigration) { setMigrationWarning(true); }
            onDone();
          })
        }
        className="flex flex-col gap-3 [&_input]:!bg-white [&_select]:!bg-white dark:[&_input]:!bg-slate-950 dark:[&_select]:!bg-slate-950"
      >
        <input type="hidden" name="id" value={card.id} />
        <input type="hidden" name="accountId" value={card.id} />
        <input type="hidden" name="isCreditCard" value="on" />
        <input type="hidden" name="subtype" value={card.subtype ?? ""} />
        <input type="hidden" name="active" value={card.active ? "on" : ""} />

        {/* No close button of its own any more — the modal header carries one. */}
        <div className="grid grid-cols-3 items-center border-b border-line">
          {tabBtn("key", "Points & Dates", "Points")}
          {tabBtn("basics", "Basics & Rewards", "Basics")}
          {tabBtn("debt", "Debt tracking", "Debt")}
        </div>

        {/* Tab 1: Key fields (default) */}
        <div className={activeTab === "key" ? "" : "hidden"}>
          <div className="rounded-lg border border-line bg-background/60 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&_input]:bg-white [&_input]:ring-slate-300 [&_select]:bg-white [&_select]:ring-slate-300 dark:[&_input]:bg-slate-950 dark:[&_input]:ring-slate-700 dark:[&_select]:bg-slate-950 dark:[&_select]:ring-slate-700">
              <LabeledInput label="Current points" name="currentPoints" type="text" defaultValue={d?.currentPoints ? d.currentPoints.toLocaleString() : ""} placeholder="0" />
              <LabeledInput label="Annual hotel credit" name="freeNightCredit" type="number" step="0.01" prefix="$" defaultValue={d?.freeNightCreditCents ? centsToDisplay(d.freeNightCreditCents) : ""} />
              <LabeledInput label="Benefit expiration" name="freeNightExpires" type="date" defaultValue={d?.freeNightExpiresOn ?? ""} />
              <LabeledInput label="Free-night point value" name="freeNightPointsLimit" type="number" step="1" defaultValue={d?.freeNightPointsLimit ?? ""} />
              <LabeledInput label="Booked / check-in" name="benefitUsedOn" type="date" defaultValue={d?.benefitUsedOn ?? ""} />
              <LabeledInput label="Spending limit" name="spendingLimit" type="number" step="1" prefix="$" defaultValue={d?.spendingLimitCents ? centsToDisplay(d.spendingLimitCents) : ""} />
              <LabeledInput label="Card website" name="cardUrl" type="url" defaultValue={d?.cardUrl ?? ""} placeholder="https://issuer.com/card" />
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Benefits reset</span>
                <select name="benefitCadence" defaultValue={d?.benefitCadence ?? "annual"} className="w-full rounded-md px-2 py-1.5 text-sm ring-1 focus:outline-none focus:ring-2 focus:ring-brand">
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                  <option value="anniversary">Card anniversary</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        {/* Tab 2: Basics & Rewards */}
        <div className={activeTab === "basics" ? "" : "hidden"}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LabeledInput label="Card name" name="name" defaultValue={card.name} required />
            <LabeledInput label="Holder" name="holder" defaultValue={card.holder ?? ""} placeholder="Vic / Johana" />
            <LabeledInput label="Annual fee" name="annualFee" type="number" step="0.01" prefix="$" defaultValue={card.annualFeeCents ? centsToDisplay(card.annualFeeCents) : ""} />
            <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
              <input type="checkbox" name="feeWaived" defaultChecked={card.feeWaived} className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
              Fee waived (e.g. military benefit)
            </label>
            <LabeledInput label="Date opened" name="dateOpened" type="date" defaultValue={card.dateOpened ?? ""} />
            <LabeledInput label="Date closed" name="dateClosed" type="date" defaultValue={card.dateClosed ?? ""} />
            <div>
              <LabeledInput
                label="Bank"
                name="bank"
                list={`banks-${card.id}`}
                defaultValue={d?.bank ?? card.institution ?? card.subtype ?? ""}
                placeholder="AMEX / Chase / Cap 1"
              />
              <datalist id={`banks-${card.id}`}>
                {bankOptions.map((b) => <option key={b} value={b} />)}
              </datalist>
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Rewards category</span>
              <select name="rewardsCategory" defaultValue={d?.rewardsCategory ?? ""} className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">Not set</option><option value="travel">Travel</option><option value="hotel">Hotel</option>
              </select>
            </label>
            <LabeledInput label="Rewards program" name="rewardsProgram" defaultValue={d?.rewardsProgram ?? ""} placeholder="Hilton, Hyatt, Chase UR…" />
            <LabeledInput label="Value per point ($)" name="pointsValue" type="number" step="0.0001" defaultValue={d?.pointsValueMicros ? (d.pointsValueMicros / 1_000_000).toFixed(4) : ""} placeholder="0.0020" />
            <LabeledInput label="Auth user" name="authUser" defaultValue={d?.authUser ?? ""} placeholder="" />
            <LabeledInput label="Charging" name="charging" defaultValue={d?.charging ?? ""} placeholder="Netflix, Google Drive" />
            <LabeledInput label="Bonus info" name="bonusInfo" defaultValue={d?.bonusInfo ?? ""} placeholder="60,000 pts" />
            <LabeledInput label="Bonus spend req." name="bonusSpend" type="number" step="0.01" prefix="$" defaultValue={d?.bonusSpendCents ? centsToDisplay(d.bonusSpendCents) : ""} placeholder="3000" />
            <LabeledInput label="Bonus deadline" name="bonusDeadline" type="date" defaultValue={d?.bonusSpendDeadline ?? ""} />
            <label className="flex items-end gap-1.5 pb-1.5 text-xs text-muted">
              <input type="checkbox" name="bonusEarned" defaultChecked={d?.bonusEarned ?? false} className="h-3.5 w-3.5 rounded accent-[var(--brand)]" />
              Bonus earned
            </label>
            <div className="sm:col-span-2">
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Remarks</label>
              <input name="remarks" defaultValue={d?.remarks ?? ""} placeholder="" className="w-full rounded-md bg-background px-2 py-1.5 text-sm ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
        </div>

        {/* Tab 3: Debt tracking */}
        <div className={activeTab === "debt" ? "" : "hidden"}>
          <div className="space-y-3 rounded-lg border-2 border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
            <label className="flex items-start gap-2 text-sm font-semibold text-foreground">
              <input
                type="checkbox"
                name="trackAsPayoffDebt"
                defaultChecked={d?.isRevolvingDebt ?? false}
                className="mt-0.5 h-4 w-4 rounded accent-[var(--brand)]"
              />
              <span>
                Track this card as payoff debt
                <span className="mt-0.5 block text-xs font-normal text-muted">
                  Off by default. Syncs balance, rate, and payment plan with Budget → Debt/Loans.
                </span>
              </span>
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.55fr)_minmax(0,1.55fr)]">
              <LabeledInput label="Balance owed" name="payoffBalance" type="number" min="0" step="0.01" defaultValue={d?.payoffBalanceCents ? centsToDisplay(d.payoffBalanceCents) : card.owedCents ? centsToDisplay(Math.max(0, card.owedCents)) : ""} />
              <LabeledInput label="APR %" name="payoffApr" type="number" min="0" step="0.001" defaultValue={d?.payoffApr ?? ""} />
              <LabeledInput label="0% promo ends" name="promoAprEndsOn" type="date" defaultValue={d?.promoAprEndsOn ?? ""} />
              <LabeledInput label="Minimum / mo" name="payoffMinimum" type="number" min="0" step="0.01" defaultValue={d?.payoffMinimumCents ? centsToDisplay(d.payoffMinimumCents) : ""} />
              <LabeledInput label="Due day" name="payoffDueDay" type="number" min="1" max="31" step="1" defaultValue={d?.payoffDueDay ?? ""} />
              <LabeledInput label="Planned / mo" name="payoffPlanned" type="number" min="0" step="0.01" defaultValue={d?.payoffPlannedCents ? centsToDisplay(d.payoffPlannedCents) : ""} />
            </div>
            <p className="text-[11px] text-muted">
              APR % should be <span className="font-semibold">0</span> during a 0% promo period; update to the regular rate when the promo ends. Balance and payment plan sync to Budget → Debt/Loans.
            </p>
          </div>
        </div>

        {detailsError ? (
          <p className="text-sm font-medium text-negative">{detailsError}</p>
        ) : null}
        {migrationWarning ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Saved (most fields). To also save Booked dates and free-night point values, run migration 0026 in Supabase SQL Editor.
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={savePending}
              className="h-8 rounded-md bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {savePending ? "Saving…" : "Save"}
            </button>
          </div>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-muted">Delete &quot;{card.name}&quot;?</span>
              <button
                type="button"
                disabled={delPending}
                onClick={() =>
                  startDel(async () => {
                    const fd = new FormData();
                    fd.set("id", card.id);
                    await deleteAccount(fd);
                  })
                }
                className="text-xs font-bold text-negative hover:underline disabled:opacity-60"
              >
                {delPending ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="h-8 rounded-md px-2.5 text-xs font-medium text-negative hover:bg-negative/10"
            >
              Delete card
            </button>
          )}
        </div>
      </form>
      </div>
    </ModalShell>
  );
}

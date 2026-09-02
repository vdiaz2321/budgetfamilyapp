import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { getSessionContext } from "@/lib/auth-context";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { resolveMonth } from "@/lib/month";
import { BudgetBoard } from "./budget-board";
import type { AccountOption, BucketOption, GroupData, PayeeLineItem, SubOption, TxData } from "./types";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";
import { throwIfAny } from "@/lib/supabase-result";

export const metadata = { title: "Budget · Capitall" };

type SearchParams = Promise<{ month?: string }>;

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { month: monthParam } = await searchParams;
  const month = resolveMonth(monthParam);
  const nextFirst = `${month.nextKey}-01`;
  const prevFirstOfMonth = `${month.prevKey}-01`;

  const { supabase, household } = await getSessionContext();
  const snowballExtraCents = household.snowball_monthly_extra_cents ?? 0;

  // ---- One round trip for the whole page. `ensureCategories` and the
  // rollover reads below used to be awaited separately, which made three
  // serial trips to Supabase; none of them depend on each other's results
  // (only on household.id and the resolved month), so they all go in one
  // batch. See the ROLLOVER comment further down for what the last two feed.
  const ROLLOVER_ANCHOR = "2026-01-01";
  // Reads that differ only by month are fetched for BOTH months at once and
  // split in memory below. Every extra round trip costs ~150ms against
  // Supabase and they queue rather than running truly in parallel, so four
  // fewer requests is real time off the page.
  const [
    { data: subs, error: subsError },
    { data: planRows, error: plansError },
    { data: goals, error: goalsError },
    { data: debts, error: debtsError },
    { data: txWindow, error: txRowsError },
    { data: payees, error: payeesError },
    { data: accounts, error: accountsError },
    { data: buckets, error: bucketsError },
    { data: subscriptions, error: subscriptionsError },
    { data: irregularBills, error: irregularBillsError },
    { data: irregularPlanRows, error: irregularBillPlansError },
    categories,
    { data: rolloverRows, error: rolloverRowsError },
    actualsSinceAnchor,
  ] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id, name, due_day, sort_order, linked_bucket_id, linked_account_id, payment_account_id, is_recurring")
      .eq("household_id", household.id)
      .order("sort_order"),
    // This month's plans and last month's, in one trip. Last month's feed the
    // "overspent in <prev month>" chip.
    supabase
      .from("budget_plans")
      .select("month, subcategory_id, planned_cents")
      .eq("household_id", household.id)
      .in("month", [prevFirstOfMonth, month.firstOfMonth]),
    supabase
      .from("savings_goals")
      .select("subcategory_id, goal_cents, start_cents, monthly_contribution_cents, target_date")
      .eq("household_id", household.id),
    supabase
      .from("debts")
      .select(
        "subcategory_id, current_balance_cents, min_payment_cents, apr, due_day, account_id, debt_kind, notes, promo_apr_ends_on",
      )
      .eq("household_id", household.id),
    // Two months in one window: the viewed month drives the board, the month
    // before it drives the "Prev Mo Spent" prefill. They used to be two reads
    // over the same table.
    supabase
      .from("transactions")
      .select(
        "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, bucket_id, paid_to_account_id, paid_to_bucket_id, movement_type, cleared, is_withdrawal",
      )
      .eq("household_id", household.id)
      .gte("occurred_on", prevFirstOfMonth)
      .lt("occurred_on", nextFirst)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
    // Names only — used server-side to label transactions and to match
    // irregular bills to spend. The autocomplete list is fetched on demand by
    // the client (listPayees) rather than serialised into every page payload.
    supabase
      .from("payees")
      .select("id, name")
      .eq("household_id", household.id),
    supabase
      .from("accounts")
      .select("id, name, kind, holder, is_kids_account, sort_order, active")
      .eq("household_id", household.id)
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    // Managed items — power both the transaction Payee autocomplete's
    // auto-fill AND the Subscriptions & Irregular Bills section below Debt.
    supabase
      .from("subscriptions")
      .select("id, name, amount_cents, billing_cycle, next_renewal_date, is_active, is_recurring, updated_at, subcategory_id, account_id, notes, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("irregular_bills")
      .select("id, name, typical_amount_cents, subcategory_id, account_id, notes, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    // Irregular bills are planned per month, not once and forever — a new
    // month starts at $0 until a plan is entered for that specific month.
    // Both months again: this one for the board, last one for the chip.
    supabase
      .from("irregular_bill_plans")
      .select("month, bill_id, planned_cents")
      .eq("household_id", household.id)
      .in("month", [prevFirstOfMonth, month.firstOfMonth]),
    ensureCategories(supabase, household.id),
    supabase
      .from("budget_rollovers")
      .select("month, override_cents")
      .eq("household_id", household.id)
      .gte("month", ROLLOVER_ANCHOR)
      .lte("month", month.firstOfMonth),
    // The rollover walk reads every month since the anchor, so this set grows
    // by roughly one row per budget item per month and will cross PostgREST's
    // 1000-row cap. Paged, or the running carry silently loses months. The
    // range now runs THROUGH the viewed month so this one read also supplies
    // that month's per-item actuals, which used to be a second query.
    fetchAllRows<{ month: string; subcategory_id: string; actual_cents: number }>((from, to) =>
      supabase
        .from("v_monthly_actuals")
        .select("month, subcategory_id, actual_cents")
        .eq("household_id", household.id)
        .gte("month", ROLLOVER_ANCHOR)
        .lte("month", month.firstOfMonth)
        .order("month")
        .order("subcategory_id")
        .range(from, to),
    ),
  ]);
  throwIfAny({ subs: subsError, plans: plansError, goals: goalsError, debts: debtsError, txRows: txRowsError, payees: payeesError, accounts: accountsError, buckets: bucketsError, subscriptions: subscriptionsError, irregularBills: irregularBillsError, irregularBillPlans: irregularBillPlansError, rolloverRows: rolloverRowsError });

  // ---- Split the two-month reads back into the shapes the page works with.
  const txRows = (txWindow ?? []).filter((t) => t.occurred_on >= month.firstOfMonth);
  const prevTxRows = (txWindow ?? []).filter((t) => t.occurred_on < month.firstOfMonth);
  const plans = (planRows ?? []).filter((p) => p.month === month.firstOfMonth);
  const prevPlans = (planRows ?? []).filter((p) => p.month === prevFirstOfMonth);
  const irregularBillPlans = (irregularPlanRows ?? []).filter((p) => p.month === month.firstOfMonth);
  const prevIrregularBillPlans = (irregularPlanRows ?? []).filter((p) => p.month === prevFirstOfMonth);
  // v_monthly_actuals now arrives as one range through the viewed month.
  const allActuals = actualsSinceAnchor.filter((a) => a.month < month.firstOfMonth);
  const actuals = actualsSinceAnchor.filter((a) => a.month === month.firstOfMonth);

  const plannedBySub = new Map((plans ?? []).map((p) => [p.subcategory_id, p.planned_cents]));
  // Last month's actual per item, for the "Prev Mo Spent" one-click prefill on
  // recurring items. Free: allActuals is already fetched above for the
  // rollover walk and spans every month back to the anchor, so this is a
  // filter over data in hand rather than another round-trip.
  const prevSpentBySub = new Map<string, number>();
  for (const row of allActuals) {
    if (row.month === prevFirstOfMonth) {
      prevSpentBySub.set(row.subcategory_id, (prevSpentBySub.get(row.subcategory_id) ?? 0) + row.actual_cents);
    }
  }
  const spentBySub = new Map((actuals ?? []).map((a) => [a.subcategory_id, a.actual_cents]));
  const goalBySub = new Map((goals ?? []).map((g) => [g.subcategory_id, g]));
  const debtBySub = new Map((debts ?? []).map((d) => [d.subcategory_id, d]));
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));
  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const kindBySub = new Map(
    (subs ?? []).map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );
  const payeeById = new Map((payees ?? []).map((p) => [p.id, p.name]));
  // The account/payee half of the "Prev Mo Spent" prefill: last month's most
  // recent transaction per item. prevTxRows arrives newest-first, so the first
  // row seen for a subcategory wins and the rest are skipped. Either field can
  // be null — history imported from the spreadsheet often has no account or
  // payee — in which case the prefill just leaves that field for the user.
  const prevTxDetailBySub = new Map<string, { accountId: string | null; payee: string | null }>();
  for (const t of prevTxRows ?? []) {
    if (!t.subcategory_id || prevTxDetailBySub.has(t.subcategory_id)) continue;
    prevTxDetailBySub.set(t.subcategory_id, {
      accountId: t.account_id ?? null,
      payee: t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
    });
  }
  const linkedBucketBySub = new Map(
    (subs ?? []).map((s) => [s.id, (s as { linked_bucket_id?: string | null }).linked_bucket_id ?? null]),
  );
  const linkedAccountBySub = new Map(
    (subs ?? []).map((s) => [s.id, (s as { linked_account_id?: string | null }).linked_account_id ?? null]),
  );
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const accountKindById = new Map((accounts ?? []).map((a) => [a.id, a.kind]));
  // Match a bill row's tokens against payee names so ad-hoc naming
  // ("BOC Bike Repair" tx vs "Bike Repairs" bill) still credits the row.
  const billTokens = (name: string) =>
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length >= 3)
      .map((t) => (t.endsWith("s") ? t.slice(0, -1) : t));
  const irregularMonthDetailById = new Map<string, { spentCents: number; accountNames: string[] }>();
  for (const bill of irregularBills ?? []) {
    const tokens = billTokens(bill.name);
    const matchingTransactions = (txRows ?? []).filter((tx) => {
      if (tx.subcategory_id !== bill.subcategory_id) return false;
      const payee = (payeeById.get(tx.payee_id ?? "") ?? "").toLowerCase();
      if (!payee) return false;
      if (payee === bill.name.trim().toLowerCase()) return true;
      return tokens.length > 0 && tokens.every((t) => payee.includes(t));
    });
    const accountNames = [...new Set(
      matchingTransactions
        .map((tx) => tx.account_id ? accountNameById.get(tx.account_id) ?? null : null)
        .filter((name): name is string => Boolean(name)),
    )];
    irregularMonthDetailById.set(bill.id, {
      spentCents: matchingTransactions.reduce((sum, tx) => sum + tx.amount_cents, 0),
      accountNames,
    });
  }
  // Auto-planned totals: subcategory rows linked to subscriptions or irregular
  // bills show a derived planned amount and are not directly editable.
  // Whether a subscription charges in a given month. Kept as a function of the
  // month so last month can be re-derived the same way for the "overspent in
  // <prev month>" chip, instead of being judged against this month's rule.
  const subscriptionChargesIn = (
    sub: { is_active: boolean | null; next_renewal_date: string | null; billing_cycle: string; subcategory_id: string | null },
    monthKey: string,
  ) => {
    if (!sub.subcategory_id || !sub.is_active || !sub.next_renewal_date) return false;
    if (sub.billing_cycle === "monthly") return true;
    // next_renewal_date advances by a year after each charge, so compare
    // just the month number (annual subs always charge in the same month).
    if (sub.billing_cycle === "annual") return sub.next_renewal_date.slice(5, 7) === monthKey.slice(5);
    // quarterly / weekly: next_renewal_date is the exact next occurrence
    return sub.next_renewal_date.slice(0, 7) === monthKey;
  };
  const autoPlannedBySub = new Map<string, number>();
  // Same rule, kept per subscription so the card can show a row's own Plan.
  const subMonthPlannedById = new Map<string, number>();
  const prevAutoPlannedBySub = new Map<string, number>();
  for (const sub of subscriptions ?? []) {
    if (!sub.subcategory_id) continue;
    if (subscriptionChargesIn(sub, month.key)) {
      subMonthPlannedById.set(sub.id, sub.amount_cents);
      autoPlannedBySub.set(sub.subcategory_id, (autoPlannedBySub.get(sub.subcategory_id) ?? 0) + sub.amount_cents);
    }
    if (subscriptionChargesIn(sub, month.prevKey)) {
      prevAutoPlannedBySub.set(sub.subcategory_id, (prevAutoPlannedBySub.get(sub.subcategory_id) ?? 0) + sub.amount_cents);
    }
  }

  // Per-subscription spend for the month. Subscriptions share one subcategory,
  // so the row's own figure has to come from matching the payee — the same
  // token match the irregular bills above use, for the same reason (a "Claude"
  // charge may be logged as "Anthropic Claude").
  const subMonthSpentById = new Map<string, number>();
  // The same figure for last month, feeding the "Prev Mo Spent" one-click
  // prefill on a subscription flagged Recurring. Same matcher, different rows:
  // prevTxRows is last month's transactions, already fetched for the budget
  // items' version of this prefill.
  const subPrevSpentById = new Map<string, number>();
  for (const sub of subscriptions ?? []) {
    const tokens = billTokens(sub.name);
    const isThisSub = (tx: { subcategory_id: string | null; payee_id: string | null }) => {
      if (tx.subcategory_id !== sub.subcategory_id) return false;
      const payee = (payeeById.get(tx.payee_id ?? "") ?? "").toLowerCase();
      if (!payee) return false;
      if (payee === sub.name.trim().toLowerCase()) return true;
      return tokens.length > 0 && tokens.every((t) => payee.includes(t));
    };
    const total = (rows: { amount_cents: number }[]) =>
      rows.reduce((sum, tx) => sum + tx.amount_cents, 0);
    subMonthSpentById.set(sub.id, total((txRows ?? []).filter(isThisSub)));
    subPrevSpentById.set(sub.id, total((prevTxRows ?? []).filter(isThisSub)));
  }
  // Planned per bill for THIS month only (absent row = $0), and the per
  // subcategory sum the Bills group row reads.
  const irregularPlannedByBillId = new Map<string, number>(
    (irregularBillPlans ?? []).map((p) => [p.bill_id as string, p.planned_cents as number]),
  );
  // Only months that actually carry per-bill plans are driven by the card.
  // Months from before the Irregular Bills card existed have their planned
  // amount recorded the old way, as a plain budget_plans row on the
  // subcategory — treating those as "auto, therefore $0" would erase the
  // history. So the card only takes over a subcategory once that month has
  // at least one per-bill plan; otherwise the manual row still wins.
  const irregularSubIdsWithPlans = new Set(
    (irregularBills ?? [])
      .filter((b) => b.subcategory_id && irregularPlannedByBillId.has(b.id))
      .map((b) => b.subcategory_id as string),
  );
  // Every subcategory fed by the Irregular Bills card. Its budget row is
  // read-only whether or not this month has per-bill plans yet: the card is
  // the one place those amounts are entered, so an editable row here would be
  // a second source that silently disagrees with it.
  const irregularSubcategoryIds = new Set(
    (irregularBills ?? []).filter((b) => b.subcategory_id).map((b) => b.subcategory_id!),
  );
  const irregularAutoPlannedBySub = new Map<string, number>();
  for (const bill of irregularBills ?? []) {
    if (!bill.subcategory_id) continue;
    if (!irregularSubIdsWithPlans.has(bill.subcategory_id)) continue;
    irregularAutoPlannedBySub.set(bill.subcategory_id, (irregularAutoPlannedBySub.get(bill.subcategory_id) ?? 0) + (irregularPlannedByBillId.get(bill.id) ?? 0));
  }

  // ---- Unfinished business from last month -------------------------------
  // Spending lands in a month long after you stop looking at it: a late
  // transaction on an August item pushes it past its August plan, and nothing
  // on the September board would ever say so. This collects those items so the
  // month you ARE looking at can point back at them.
  const prevPlannedBySub = new Map((prevPlans ?? []).map((p) => [p.subcategory_id as string, p.planned_cents as number]));
  const prevIrregularPlannedBySub = new Map<string, number>();
  for (const bill of irregularBills ?? []) {
    if (!bill.subcategory_id) continue;
    const planned = (prevIrregularBillPlans ?? []).find((p) => p.bill_id === bill.id)?.planned_cents;
    if (planned === undefined) continue;
    prevIrregularPlannedBySub.set(bill.subcategory_id, (prevIrregularPlannedBySub.get(bill.subcategory_id) ?? 0) + planned);
  }
  const prevOverspentItems = (subs ?? [])
    .map((s) => {
      const kind = kindBySub.get(s.id);
      if (kind !== "bills" && kind !== "expenses") return null;
      // The board's own precedence — irregular plans, then subscriptions,
      // then the month's budget_plans row — re-derived for last month, so
      // this figure is the one that month's board shows. Subscription
      // amounts aren't stored per month, so a sub whose price changed since
      // is measured at today's price; everything else is exact.
      const plannedCents =
        prevIrregularPlannedBySub.get(s.id) ??
        prevAutoPlannedBySub.get(s.id) ??
        prevPlannedBySub.get(s.id) ??
        0;
      const spentCents = prevSpentBySub.get(s.id) ?? 0;
      if (spentCents <= plannedCents) return null;
      return { subId: s.id, name: s.name, kind, plannedCents, spentCents };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => (b.spentCents - b.plannedCents) - (a.spentCents - a.plannedCents));

  const isKidsAcctByIdEarly = new Map((accounts ?? []).map((a) => [a.id, a.is_kids_account ?? false]));
  const isKidsByBucketId = new Map((buckets ?? []).map((b) => [b.id, isKidsAcctByIdEarly.get(b.account_id) ?? false]));

  const groups: GroupData[] = categories.map((cat) => {
    const kind = cat.kind as CategoryKind;
    const rows = (subs ?? [])
      .filter((s) => s.category_id === cat.id)
      .map((s) => {
        const isAutoSub = autoPlannedBySub.has(s.id);
        const isAutoIrregular = irregularAutoPlannedBySub.has(s.id);
        // For subscriptions, a budget_plans row overrides the auto-derived amount
        // (absorbs off-cycle variance). Irregular Bills is authoritative — its
        // sum from the Irregular Bills card always wins, so the budget row stays
        // in sync and can't be edited from two places.
        const hasManualPlan = plannedBySub.has(s.id);
        // Both irregular bills and subscriptions are authoritative sources —
        // their cards are the single place to update planned amounts, so we
        // never let a stale budget_plans row override them.
        const plannedCents = isAutoIrregular
          ? irregularAutoPlannedBySub.get(s.id)!
          : isAutoSub
            ? autoPlannedBySub.get(s.id)!
            : hasManualPlan
              ? plannedBySub.get(s.id)!
              : 0;
        const spentCents = spentBySub.get(s.id) ?? 0;
        const g = goalBySub.get(s.id);
        const d = debtBySub.get(s.id);
        const linkedBucketId = linkedBucketBySub.get(s.id) ?? null;
        const linkedAcctId = linkedAccountBySub.get(s.id) ?? null;
        const isKids = kind === "savings"
          ? (linkedBucketId ? isKidsByBucketId.get(linkedBucketId) ?? false
            : linkedAcctId ? isKidsAcctByIdEarly.get(linkedAcctId) ?? false
            : false)
          : false;
        return {
          subId: s.id,
          categoryId: s.category_id,
          name: s.name,
          dueDay: s.due_day,
          paymentAccountId: (s as { payment_account_id?: string | null }).payment_account_id ?? null,
          plannedCents,
          spentCents,
          prevSpentCents: prevSpentBySub.get(s.id) ?? 0,
          prevAccountId: prevTxDetailBySub.get(s.id)?.accountId ?? null,
          prevPayee: prevTxDetailBySub.get(s.id)?.payee ?? null,
          isRecurring: (s as { is_recurring?: boolean }).is_recurring ?? false,
          // Planned is read-only wherever another card owns the number:
          // subscriptions, and Irregular Bills — including a month that has
          // no per-bill plans yet, where the row still shows the legacy
          // budget_plans figure but is edited from the Irregular Bills card.
          autoPlanned: isAutoIrregular || isAutoSub || irregularSubcategoryIds.has(s.id),
          isKids,
          savings:
            kind === "savings"
              ? {
                  goalCents: g?.goal_cents ?? 0,
                  startCents: g?.start_cents ?? 0,

                  monthlyCents: g?.monthly_contribution_cents ?? 0,
                  targetDate: g?.target_date ?? null,
                  linkedBucketId: linkedBucketBySub.get(s.id) ?? null,
                  linkedAccountId: linkedAccountBySub.get(s.id) ?? null,
                }
              : null,
          debt:
            kind === "debt"
              ? {
                  balanceCents: d?.current_balance_cents ?? 0,
                  minCents: d?.min_payment_cents ?? 0,
                  apr: d ? Number(d.apr) : 0,
                  dueDay: d?.due_day ?? s.due_day,
                  debtKind: d?.debt_kind ?? null,
                  notes: d?.notes ?? null,
                  promoAprEndsOn: d?.promo_apr_ends_on ?? null,
                  accountId: d?.account_id ?? null,
                  linkedBucketId: linkedBucketBySub.get(s.id) ?? null,
                }
              : null,
        };
      });

    // Paid-off debts are hidden in the UI (BudgetGroup filters them from its
    // visible list and subtotal); exclude their planned/spent here too so the
    // hero card's Planned Budget agrees with the sum of visible group headers.
    const countableRows = kind === "debt"
      ? rows.filter((r) => (r.debt?.balanceCents ?? 0) > 0)
      : rows;
    return {
      categoryId: cat.id,
      kind,
      name: cat.name,
      isSystem: cat.is_system,
      sortOrder: cat.sort_order,
      rows,
      plannedTotal: countableRows.reduce((sum, r) => sum + r.plannedCents, 0),
      spentTotal: countableRows.reduce((sum, r) => sum + r.spentCents, 0),
    };
  });

  // Same "smallest unpaid balance first" rule as the Snowball page, so the
  // debt panel can show which debt is currently getting the extra payment.
  const debtRows = groups.find((g) => g.kind === "debt")?.rows ?? [];
  const snowballFocusSubId =
    debtRows
      .filter((r) => (r.debt?.balanceCents ?? 0) > 0)
      .sort((a, b) => (a.debt?.balanceCents ?? 0) - (b.debt?.balanceCents ?? 0))[0]?.subId ?? null;

  const incomePlanned = groups
    .filter((g) => g.kind === "income")
    .reduce((sum, g) => sum + g.plannedTotal, 0);
  const outflowPlanned = groups
    .filter((g) => g.kind !== "income")
    .reduce((sum, g) => sum + g.plannedTotal, 0);

  // ---- Rollover (destination-keyed, accumulating): the control lives on the
  // month that RECEIVES the money — a per-month include/exclude toggle for the
  // running cash carry from prior months. We walk forward from Jan 2026,
  // computing each month's income − outflow and accumulating into a running
  // balance whenever that month's rollover is enabled. Manual overrides on a
  // past month reset the incoming amount for that month; the accumulation
  // continues forward from there.
  // Bucket actuals per month, converting each into a leftover (income − outflow).
  const leftoverByMonth = new Map<string, number>();
  for (const row of allActuals ?? []) {
    const kind = kindBySub.get(row.subcategory_id);
    if (!kind) continue;
    const delta = kind === "income" ? row.actual_cents : -row.actual_cents;
    leftoverByMonth.set(row.month, (leftoverByMonth.get(row.month) ?? 0) + delta);
  }

  // Index rollover rows by month for quick lookup.
  const rolloverByMonth = new Map<string, { override_cents: number | null }>();
  for (const r of rolloverRows ?? []) {
    rolloverByMonth.set(r.month, { override_cents: r.override_cents });
  }

  // Walk forward from Jan 2026 through prev month, always accumulating a
  // running cash carry — money is fungible, so unspent income from any past
  // month remains available regardless of whether an intermediate month's
  // rollover toggle was on. The toggle only controls whether the current
  // month DISPLAYS the carry as an included rollover. Manual overrides on a
  // past month reset the carry to that override amount at that point.
  const stepMonth = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m, 1); // m is 1-based, and this constructs the *next* month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };

  let carry = 0;
  let cursor = ROLLOVER_ANCHOR;
  while (cursor < month.firstOfMonth) {
    const own = leftoverByMonth.get(cursor) ?? 0;
    const meta = rolloverByMonth.get(cursor);
    // An override on a past month replaces the accumulated carry at that
    // point (user is saying "the real starting amount for this month was X").
    // Otherwise the carry just keeps rolling forward through this month.
    const baseline = meta?.override_cents ?? carry;
    carry = baseline + own;
    cursor = stepMonth(cursor);
  }

  // A cumulative deficit doesn't carry as negative money.
  const liveAvailableCents = Math.max(0, carry);
  const rolloverRow = rolloverByMonth.get(month.firstOfMonth) ?? null;
  const rolloverInEnabled = rolloverRow != null;
  const overrideCents: number | null = rolloverRow?.override_cents ?? null;
  const incomingAvailableCents = overrideCents ?? liveAvailableCents;
  const rolloverInCents = rolloverInEnabled ? incomingAvailableCents : 0;

  const labelForKey = (key: string) => {
    const [y, m] = key.split("-");
    const names = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  };

  const remainingBySub = new Map<string, number>();
  for (const group of groups) {
    for (const row of group.rows) {
      remainingBySub.set(row.subId, row.plannedCents - row.spentCents);
    }
  }

  const subOptions: SubOption[] = (subs ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    kind: (kindByCat.get(s.category_id) ?? "expenses") as CategoryKind,
    linkedBucketId: linkedBucketBySub.get(s.id) ?? null,
    remainingCents: remainingBySub.get(s.id),
    trimmableCents: Math.max(0, (plannedBySub.get(s.id) ?? 0) - (spentBySub.get(s.id) ?? 0)),
  }));

  // Disambiguate same-named accounts (e.g. two "Fidelity" accounts, one in
  // Investments and one in Kids Funding) with their holder initial.
  const nameCounts = new Map<string, number>();
  for (const a of accounts ?? []) nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1);
  const accountGroupFor = (a: { kind: string; is_kids_account?: boolean }) => {
    if (a.is_kids_account) return "Kids Funding";
    if (a.kind === "checking" || a.kind === "savings_bucket" || a.kind === "cash") return "Banking";
    if (a.kind === "investment") return "Investments";
    if (a.kind === "credit_card") return "Credit Cards";
    if (a.kind === "debt_loan") return "Loans";
    return "Other";
  };
  const accountOptions: AccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    name:
      (nameCounts.get(a.name) ?? 0) > 1 && a.holder
        ? `${a.name} (${a.holder})`
        : a.name,
    group: accountGroupFor(a),
  }));

  // Liability accounts a Budget debt can link to (credit cards, loans).
  const debtAccountOptions: AccountOption[] = (accounts ?? [])
    .filter((a) => a.kind === "credit_card" || a.kind === "debt_loan")
    .map((a) => ({ id: a.id, name: a.name }));

  // Buckets a Savings item can link to, so its contributions/withdrawals
  // flow straight into the Accounts balance.
  const accountSortById = new Map((accounts ?? []).map((a) => [a.id, a.sort_order ?? 0]));
  const isKidsAccountById = new Map((accounts ?? []).map((a) => [a.id, a.is_kids_account ?? false]));
  const bucketOptions: BucketOption[] = (buckets ?? [])
    .sort((a, b) => (accountSortById.get(a.account_id) ?? 0) - (accountSortById.get(b.account_id) ?? 0))
    .map((b) => ({
      id: b.id,
      name: b.name,
      accountName: accountNameById.get(b.account_id) ?? "Account",
      isKids: isKidsAccountById.get(b.account_id) ?? false,
    }));

  // Investment accounts with NO buckets (TSP, M1, Charles Schwab, …) can also
  // be a savings link target — contributions post straight to the account
  // balance. Grouped under "Investments" in the dropdown.
  const bucketedAccountIds = new Set((buckets ?? []).map((b) => b.account_id));
  const bareInvestmentOptions: BucketOption[] = (accounts ?? [])
    .filter((a) => a.kind === "investment" && !bucketedAccountIds.has(a.id) && a.active)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((a) => ({
      id: `account:${a.id}`,
      name: a.name,
      accountName: "Investments",
      isKids: a.is_kids_account ?? false,
      isBareAccount: true,
      accountId: a.id,
    }));
  bucketOptions.push(...bareInvestmentOptions);

  const transactions: TxData[] = (txRows ?? []).map((t) => {
    const movementType = t.movement_type ?? (
      t.paid_to_account_id
        ? accountKindById.get(t.paid_to_account_id) === "credit_card"
          ? "card_payment"
          : accountKindById.get(t.account_id ?? "") === "investment"
            ? "investment_transfer"
            : "account_transfer"
        : null
    );
    return {
      id: t.id,
      date: t.occurred_on,
      amountCents: t.amount_cents,
      memo: t.memo,
      payee: t.paid_to_account_id
        ? accountNameById.get(t.paid_to_account_id) ?? "Destination account"
        : t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
      subId: t.subcategory_id ?? null,
      subName: movementType === "account_transfer"
        ? "Transfer"
        : movementType === "investment_transfer"
          ? "Investment transfer"
          : movementType === "card_payment"
            ? "Card payment"
            : t.subcategory_id
              ? nameBySub.get(t.subcategory_id) ?? "Uncategorized"
              : "Uncategorized",
      accountId: t.account_id ?? null,
      toAccountId: t.paid_to_account_id ?? null,
      fromBucketId: t.bucket_id ?? null,
      toBucketId: t.paid_to_bucket_id ?? null,
      kind: t.subcategory_id ? kindBySub.get(t.subcategory_id) ?? null : null,
      movementType,
      isCardPayment: movementType === "card_payment",
      isTransfer: movementType === "account_transfer",
      isInvestmentTransfer: movementType === "investment_transfer",
      cleared: t.cleared ?? false,
      isWithdrawal: t.is_withdrawal ?? false,
    };
  });

  const payeeLineItems: PayeeLineItem[] = [
    ...(subscriptions ?? [])
      .filter((s) => s.is_active)
      .map((s) => ({
        name: s.name,
        amountCents: s.amount_cents,
        subcategoryId: s.subcategory_id,
        kind: "subscription" as const,
      })),
    ...(irregularBills ?? []).map((b) => ({
      name: b.name,
      amountCents: null,
      subcategoryId: b.subcategory_id,
      kind: "irregular" as const,
    })),
  ];

  const subscriptionRows: SubscriptionRow[] = (subscriptions ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    amountCents: s.amount_cents,
    billingCycle: s.billing_cycle,
    nextRenewalDate: s.next_renewal_date,
    isActive: s.is_active,
    updatedAt: (s as { updated_at?: string }).updated_at ?? null,
    subcategoryId: s.subcategory_id,
    accountId: s.account_id ?? null,
    notes: s.notes,
    sortOrder: (s as { sort_order?: number }).sort_order ?? 0,
    isRecurring: (s as { is_recurring?: boolean }).is_recurring ?? false,
    monthPlannedCents: subMonthPlannedById.get(s.id) ?? 0,
    monthSpentCents: subMonthSpentById.get(s.id) ?? 0,
    prevSpentCents: subPrevSpentById.get(s.id) ?? 0,
  }));

  const irregularBillRows: IrregularBillRow[] = (irregularBills ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    typicalAmountCents: b.typical_amount_cents,
    plannedCents: irregularPlannedByBillId.get(b.id) ?? 0,
    subcategoryId: b.subcategory_id,
    accountId: b.account_id ?? null,
    notes: b.notes,
    sortOrder: (b as { sort_order?: number }).sort_order ?? 0,
    monthSpentCents: irregularMonthDetailById.get(b.id)?.spentCents ?? 0,
    monthAccountNames: irregularMonthDetailById.get(b.id)?.accountNames ?? [],
  }));

  const creditCards = (accounts ?? [])
    .filter((a) => a.kind === "credit_card")
    .map((a) => ({ id: a.id, name: a.name }));

  // Subscription month totals — sum across all sub subcategories so the card
  // header can show Plan/Spent matching what the Bills group row shows.
  const subSubcategoryIds = new Set(
    (subscriptions ?? []).filter((s) => s.subcategory_id).map((s) => s.subcategory_id!),
  );
  const subscriptionMonthPlanned = [...subSubcategoryIds].reduce(
    (sum, id) => sum + (autoPlannedBySub.get(id) ?? 0),
    0,
  );
  const subscriptionMonthSpent = [...subSubcategoryIds].reduce(
    (sum, id) => sum + (spentBySub.get(id) ?? 0),
    0,
  );

  // Same idea for the Irregular Bills card header, but it has to honour the
  // legacy fallback above: in a month with no per-bill plans the header shows
  // the subcategory's manual budget_plans figure, so it agrees with the Bills
  // group row instead of contradicting it with $0.
  const irregularMonthPlanned = [...irregularSubcategoryIds].reduce(
    (sum, id) => sum + (irregularAutoPlannedBySub.get(id) ?? plannedBySub.get(id) ?? 0),
    0,
  );

  // Buckets grouped by parent account, restricted to investment accounts —
  // used by the transaction modal to offer a bucket picker (Fidelity → Roth
  // IRA Vic). Other kinds of accounts don't need it.
  const investmentAccountIds = new Set((accounts ?? []).filter((a) => a.kind === "investment").map((a) => a.id));
  const bucketsByAccount: Record<string, { id: string; name: string }[]> = {};
  for (const b of buckets ?? []) {
    if (!investmentAccountIds.has(b.account_id)) continue;
    (bucketsByAccount[b.account_id] ??= []).push({ id: b.id, name: b.name });
  }

  return (
    <BudgetBoard
      month={{
        key: month.key,
        label: month.label,
        prevKey: month.prevKey,
        nextKey: month.nextKey,
        firstOfMonth: month.firstOfMonth,
      }}
      currency={household.currency}
      groups={groups}
      incomePlanned={incomePlanned}
      outflowPlanned={outflowPlanned}
      leftToBudget={incomePlanned - outflowPlanned}
      rollover={{
        inCents: rolloverInCents,
        availableCents: incomingAvailableCents,
        liveAvailableCents,
        overrideCents,
        enabled: rolloverInEnabled,
        prevMonthLabel: labelForKey(month.prevKey),
      }}
      subOptions={subOptions}
      accountOptions={accountOptions}
      debtAccountOptions={debtAccountOptions}
      bucketOptions={bucketOptions}
      bucketsByAccount={bucketsByAccount}
      payeeLineItems={payeeLineItems}
      snowballExtraCents={snowballExtraCents}
      snowballFocusSubId={snowballFocusSubId}
      transactions={transactions}
      subscriptions={subscriptionRows}
      irregularBills={irregularBillRows}
      creditCards={creditCards}
      prevMonthOverspent={{
        monthKey: month.prevKey,
        monthLabel: labelForKey(month.prevKey),
        items: prevOverspentItems,
      }}
      irregularMonthPlanned={irregularMonthPlanned}
      subscriptionMonthPlanned={subscriptionMonthPlanned}
      subscriptionMonthSpent={subscriptionMonthSpent}
    />
  );
}

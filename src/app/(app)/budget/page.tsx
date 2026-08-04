import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { resolveMonth } from "@/lib/month";
import { BudgetBoard } from "./budget-board";
import type { AccountOption, BucketOption, GroupData, PayeeLineItem, SubOption, TxData } from "./types";
import type { IrregularBillRow, SubscriptionRow } from "../subscriptions/types";

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

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  const { data: household } = await supabase
    .from("households")
    .select("id, name, currency, snowball_monthly_extra_cents")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  const snowballExtraCents = household.snowball_monthly_extra_cents ?? 0;

  const categories = await ensureCategories(supabase, household.id);

  // 6-month lookback window for the row sparklines (this month inclusive).
  const [sparkYear, sparkMonth1] = month.firstOfMonth.split("-").map(Number);
  const sparkStart = new Date(Date.UTC(sparkYear, sparkMonth1 - 1 - 5, 1));
  const sparkStartKey = `${sparkStart.getUTCFullYear()}-${String(sparkStart.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const [
    { data: subs },
    { data: plans },
    { data: actuals },
    { data: goals },
    { data: debts },
    { data: txRows },
    { data: payees },
    { data: accounts },
    { data: buckets },
    { data: sparkRows },
    { data: subscriptions },
    { data: irregularBills },
  ] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id, name, due_day, sort_order, linked_bucket_id, linked_account_id")
      .eq("household_id", household.id)
      .order("sort_order"),
    supabase
      .from("budget_plans")
      .select("subcategory_id, planned_cents")
      .eq("household_id", household.id)
      .eq("month", month.firstOfMonth),
    supabase
      .from("v_monthly_actuals")
      .select("subcategory_id, actual_cents")
      .eq("household_id", household.id)
      .eq("month", month.firstOfMonth),
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
    supabase
      .from("transactions")
      .select(
        "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, paid_to_account_id, cleared, is_withdrawal",
      )
      .eq("household_id", household.id)
      .gte("occurred_on", month.firstOfMonth)
      .lt("occurred_on", nextFirst)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
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
    // Last 6 months of actuals per subcategory, for the row sparklines.
    supabase
      .from("v_monthly_actuals")
      .select("month, subcategory_id, actual_cents")
      .eq("household_id", household.id)
      .gte("month", sparkStartKey)
      .lte("month", month.firstOfMonth)
      .order("month"),
    // Managed items — power both the transaction Payee autocomplete's
    // auto-fill AND the Subscriptions & Irregular Bills section below Debt.
    supabase
      .from("subscriptions")
      .select("id, name, amount_cents, billing_cycle, next_renewal_date, is_active, updated_at, subcategory_id, account_id, notes, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("irregular_bills")
      .select("id, name, typical_amount_cents, subcategory_id, account_id, notes, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
  ]);

  const plannedBySub = new Map((plans ?? []).map((p) => [p.subcategory_id, p.planned_cents]));
  const spentBySub = new Map((actuals ?? []).map((a) => [a.subcategory_id, a.actual_cents]));
  const goalBySub = new Map((goals ?? []).map((g) => [g.subcategory_id, g]));
  const debtBySub = new Map((debts ?? []).map((d) => [d.subcategory_id, d]));
  const kindByCat = new Map(categories.map((c) => [c.id, c.kind as CategoryKind]));
  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const kindBySub = new Map(
    (subs ?? []).map((s) => [s.id, kindByCat.get(s.category_id) ?? null]),
  );
  const payeeById = new Map((payees ?? []).map((p) => [p.id, p.name]));
  const linkedBucketBySub = new Map(
    (subs ?? []).map((s) => [s.id, (s as { linked_bucket_id?: string | null }).linked_bucket_id ?? null]),
  );
  const linkedAccountBySub = new Map(
    (subs ?? []).map((s) => [s.id, (s as { linked_account_id?: string | null }).linked_account_id ?? null]),
  );
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const sparklineBySub = new Map<string, number[]>();
  for (const s of sparkRows ?? []) {
    const list = sparklineBySub.get(s.subcategory_id) ?? [];
    list.push(s.actual_cents);
    sparklineBySub.set(s.subcategory_id, list);
  }

  // Auto-planned totals: subcategory rows linked to subscriptions or irregular
  // bills show a derived planned amount and are not directly editable.
  const currentMonthNum = month.key.slice(5); // "MM" from "YYYY-MM"
  const autoPlannedBySub = new Map<string, number>();
  for (const sub of subscriptions ?? []) {
    if (!sub.subcategory_id || !sub.is_active || !sub.next_renewal_date) continue;
    let includeThisMonth = false;
    if (sub.billing_cycle === "monthly") {
      includeThisMonth = true;
    } else if (sub.billing_cycle === "annual") {
      // next_renewal_date advances by a year after each charge, so compare
      // just the month number (annual subs always charge in the same month).
      includeThisMonth = sub.next_renewal_date.slice(5, 7) === currentMonthNum;
    } else {
      // quarterly / weekly: next_renewal_date is the exact next occurrence
      includeThisMonth = sub.next_renewal_date.slice(0, 7) === month.key;
    }
    if (!includeThisMonth) continue;
    autoPlannedBySub.set(sub.subcategory_id, (autoPlannedBySub.get(sub.subcategory_id) ?? 0) + sub.amount_cents);
  }
  const irregularAutoPlannedBySub = new Map<string, number>();
  for (const bill of irregularBills ?? []) {
    if (!bill.subcategory_id) continue;
    irregularAutoPlannedBySub.set(bill.subcategory_id, (irregularAutoPlannedBySub.get(bill.subcategory_id) ?? 0) + bill.typical_amount_cents);
  }

  const isKidsAcctByIdEarly = new Map((accounts ?? []).map((a) => [a.id, a.is_kids_account ?? false]));
  const isKidsByBucketId = new Map((buckets ?? []).map((b) => [b.id, isKidsAcctByIdEarly.get(b.account_id) ?? false]));

  const groups: GroupData[] = categories.map((cat) => {
    const kind = cat.kind as CategoryKind;
    const rows = (subs ?? [])
      .filter((s) => s.category_id === cat.id)
      .map((s) => {
        const isAutoSub = autoPlannedBySub.has(s.id);
        const isAutoIrregular = irregularAutoPlannedBySub.has(s.id);
        const plannedCents = isAutoSub
          ? autoPlannedBySub.get(s.id)!
          : isAutoIrregular
            ? irregularAutoPlannedBySub.get(s.id)!
            : (plannedBySub.get(s.id) ?? 0);
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
          name: s.name,
          dueDay: s.due_day,
          plannedCents,
          spentCents,
          autoPlanned: isAutoSub || isAutoIrregular,
          sparkline: sparklineBySub.get(s.id) ?? [],
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

    return {
      categoryId: cat.id,
      kind,
      name: cat.name,
      rows,
      plannedTotal: rows.reduce((sum, r) => sum + r.plannedCents, 0),
      spentTotal: rows.reduce((sum, r) => sum + r.spentCents, 0),
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
  const ROLLOVER_ANCHOR = "2026-01-01";
  const [{ data: rolloverRows }, { data: allActuals }] = await Promise.all([
    supabase
      .from("budget_rollovers")
      .select("month, override_cents")
      .eq("household_id", household.id)
      .gte("month", ROLLOVER_ANCHOR)
      .lte("month", month.firstOfMonth),
    supabase
      .from("v_monthly_actuals")
      .select("month, subcategory_id, actual_cents")
      .eq("household_id", household.id)
      .gte("month", ROLLOVER_ANCHOR)
      .lt("month", month.firstOfMonth),
  ]);

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

  const subOptions: SubOption[] = (subs ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    kind: (kindByCat.get(s.category_id) ?? "expenses") as CategoryKind,
    linkedBucketId: linkedBucketBySub.get(s.id) ?? null,
  }));

  // Disambiguate same-named accounts (e.g. two "Fidelity" accounts, one in
  // Investments and one in Kids Funding) with their holder initial.
  const nameCounts = new Map<string, number>();
  for (const a of accounts ?? []) nameCounts.set(a.name, (nameCounts.get(a.name) ?? 0) + 1);
  const accountGroupFor = (a: { kind: string; is_kids_account?: boolean }) => {
    if (a.is_kids_account) return "Kids Funding";
    if (a.kind === "checking" || a.kind === "savings_bucket") return "Banking";
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

  const transactions: TxData[] = (txRows ?? []).map((t) => ({
    id: t.id,
    date: t.occurred_on,
    amountCents: t.amount_cents,
    memo: t.memo,
    payee: t.paid_to_account_id
      ? accountNameById.get(t.paid_to_account_id) ?? "Credit card"
      : t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
    subId: t.subcategory_id ?? null,
    subName: t.paid_to_account_id
      ? "Card payment"
      : t.subcategory_id
      ? nameBySub.get(t.subcategory_id) ?? "Uncategorized"
      : "Uncategorized",
    accountId: t.account_id ?? null,
    kind: t.subcategory_id ? kindBySub.get(t.subcategory_id) ?? null : null,
    isCardPayment: Boolean(t.paid_to_account_id),
    cleared: t.cleared ?? false,
    isWithdrawal: t.is_withdrawal ?? false,
  }));

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
  }));

  const irregularBillRows: IrregularBillRow[] = (irregularBills ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    typicalAmountCents: b.typical_amount_cents,
    subcategoryId: b.subcategory_id,
    accountId: b.account_id ?? null,
    notes: b.notes,
    sortOrder: (b as { sort_order?: number }).sort_order ?? 0,
  }));

  const creditCards = (accounts ?? [])
    .filter((a) => a.kind === "credit_card")
    .map((a) => ({ id: a.id, name: a.name }));

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
      payeeOptions={payees ?? []}
      payeeLineItems={payeeLineItems}
      snowballExtraCents={snowballExtraCents}
      snowballFocusSubId={snowballFocusSubId}
      transactions={transactions}
      subscriptions={subscriptionRows}
      irregularBills={irregularBillRows}
      creditCards={creditCards}
    />
  );
}

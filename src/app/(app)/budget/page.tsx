import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureCategories, type CategoryKind } from "@/lib/categories";
import { resolveMonth } from "@/lib/month";
import { BudgetBoard } from "./budget-board";
import type { AccountOption, BucketOption, GroupData, SubOption, TxData } from "./types";

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
  ] = await Promise.all([
    supabase
      .from("subcategories")
      .select("id, category_id, name, due_day, sort_order, linked_bucket_id")
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
        "id, occurred_on, amount_cents, memo, subcategory_id, payee_id, account_id, cleared, is_withdrawal",
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
      .select("id, name, kind")
      .eq("household_id", household.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name")
      .eq("household_id", household.id)
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
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

  const groups: GroupData[] = categories.map((cat) => {
    const kind = cat.kind as CategoryKind;
    const rows = (subs ?? [])
      .filter((s) => s.category_id === cat.id)
      .map((s) => {
        const plannedCents = plannedBySub.get(s.id) ?? 0;
        const spentCents = spentBySub.get(s.id) ?? 0;
        const g = goalBySub.get(s.id);
        const d = debtBySub.get(s.id);
        return {
          subId: s.id,
          name: s.name,
          dueDay: s.due_day,
          plannedCents,
          spentCents,
          savings:
            kind === "savings"
              ? {
                  goalCents: g?.goal_cents ?? 0,
                  startCents: g?.start_cents ?? 0,
                  monthlyCents: g?.monthly_contribution_cents ?? 0,
                  targetDate: g?.target_date ?? null,
                  linkedBucketId: linkedBucketBySub.get(s.id) ?? null,
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

  // ---- Rollover (destination-keyed): the control lives on the month that
  // RECEIVES the money — a per-month include/exclude toggle for the previous
  // month's actual leftover cash (income received minus what was actually
  // spent). A budget_rollovers row for THIS month = "include last month's
  // leftover here." The amount is recomputed live from the prior month's
  // actuals, so it stays correct as those transactions change.
  const actualLeftover = (bySub: Map<string, number>) => {
    let income = 0;
    let outflow = 0;
    for (const [subId, cents] of bySub) {
      const kind = kindBySub.get(subId);
      if (kind === "income") income += cents;
      else if (kind) outflow += cents;
    }
    return income - outflow;
  };

  const prevFirst = `${month.prevKey}-01`;
  const [{ data: rolloverRows }, { data: prevActuals }] = await Promise.all([
    supabase
      .from("budget_rollovers")
      .select("month")
      .eq("household_id", household.id)
      .eq("month", month.firstOfMonth),
    supabase
      .from("v_monthly_actuals")
      .select("subcategory_id, actual_cents")
      .eq("household_id", household.id)
      .eq("month", prevFirst),
  ]);
  const rolloverInEnabled = (rolloverRows ?? []).length > 0;
  const prevSpentBySub = new Map((prevActuals ?? []).map((a) => [a.subcategory_id, a.actual_cents]));
  // A deficit doesn't carry forward as negative money — only real leftover.
  const incomingAvailableCents = Math.max(0, actualLeftover(prevSpentBySub));
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

  const accountOptions: AccountOption[] = (accounts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
  }));

  // Liability accounts a Budget debt can link to (credit cards, loans).
  const debtAccountOptions: AccountOption[] = (accounts ?? [])
    .filter((a) => a.kind === "credit_card" || a.kind === "debt_loan")
    .map((a) => ({ id: a.id, name: a.name }));

  // Buckets a Savings item can link to, so its contributions/withdrawals
  // flow straight into the Accounts balance.
  const bucketOptions: BucketOption[] = (buckets ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    accountName: accountNameById.get(b.account_id) ?? "Account",
  }));

  const transactions: TxData[] = (txRows ?? []).map((t) => ({
    id: t.id,
    date: t.occurred_on,
    amountCents: t.amount_cents,
    memo: t.memo,
    payee: t.payee_id ? payeeById.get(t.payee_id) ?? null : null,
    subId: t.subcategory_id ?? null,
    subName: t.subcategory_id
      ? nameBySub.get(t.subcategory_id) ?? "Uncategorized"
      : "Uncategorized",
    accountId: t.account_id ?? null,
    kind: t.subcategory_id ? kindBySub.get(t.subcategory_id) ?? null : null,
    cleared: t.cleared ?? false,
    isWithdrawal: t.is_withdrawal ?? false,
  }));

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
        enabled: rolloverInEnabled,
        prevMonthLabel: labelForKey(month.prevKey),
      }}
      subOptions={subOptions}
      accountOptions={accountOptions}
      debtAccountOptions={debtAccountOptions}
      bucketOptions={bucketOptions}
      snowballExtraCents={snowballExtraCents}
      snowballFocusSubId={snowballFocusSubId}
      transactions={transactions}
    />
  );
}

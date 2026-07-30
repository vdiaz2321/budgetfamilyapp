import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentMonthFirst } from "@/lib/snapshots";
import { AccountsBoard, type AccountData, type BudgetDebt, type CardDetails } from "./accounts-board";
import { syncAllBucketedAccounts } from "./actions";

// N months before firstOfMonth, as YYYY-MM-01. n=1 → previous month.
function monthsBefore(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export const metadata = { title: "Accounts · Capitall" };

export default async function AccountsPage() {
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
    .select("id, currency")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  // Self-heal any account whose top-level balance drifted from its buckets'
  // sum before this sync existed (e.g. a manually-entered total that never
  // matched the buckets underneath it).
  await syncAllBucketedAccounts(supabase, household.id);

  const currentMonth = currentMonthFirst();
  const prevMonth = monthsBefore(currentMonth, 1);
  const prev2Month = monthsBefore(currentMonth, 2);
  const historyMonths = [prevMonth, prev2Month];

  const [
    { data: rows },
    { data: bucketRows },
    { data: debtRows },
    { data: subRows },
    { data: cardDetailRows },
    { data: acctSnapshotRows },
    { data: bktSnapshotRows },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, kind, subtype, holder, active, is_kids_account, bank_group, current_balance_cents, annual_fee_cents, fee_waived, date_opened, date_closed")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, balance_cents, bank_group")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("debts")
      .select("subcategory_id, current_balance_cents")
      .eq("household_id", household.id),
    supabase
      .from("subcategories")
      .select("id, name")
      .eq("household_id", household.id),
    supabase
      .from("credit_card_details")
      .select("account_id, bank, auth_user, charging, bonus_info, bonus_spend_cents, bonus_spend_deadline, bonus_earned, current_points, fees_paid_cents, free_night_credit_cents, free_night_expires_on, free_night_points_limit, benefit_used_on, spending_limit_cents, remarks, is_revolving_debt, debt_subcategory_id")
      .eq("household_id", household.id),
    supabase
      .from("account_snapshots")
      .select("account_id, month, balance_cents")
      .eq("household_id", household.id)
      .in("month", historyMonths),
    supabase
      .from("bucket_snapshots")
      .select("bucket_id, month, balance_cents")
      .eq("household_id", household.id)
      .in("month", historyMonths),
  ]);

  // (accountId, month) -> cents; buckets keyed by (bucketId, month) -> cents.
  const acctHistory = new Map<string, number>();
  for (const s of acctSnapshotRows ?? []) {
    acctHistory.set(`${s.account_id}:${s.month}`, s.balance_cents ?? 0);
  }
  const bktHistory = new Map<string, number>();
  for (const s of bktSnapshotRows ?? []) {
    bktHistory.set(`${s.bucket_id}:${s.month}`, s.balance_cents ?? 0);
  }

  const subName = new Map((subRows ?? []).map((s) => [s.id, s.name]));
  const budgetDebts: BudgetDebt[] = (debtRows ?? []).map((d) => ({
    subcategoryId: d.subcategory_id,
    name: subName.get(d.subcategory_id) ?? "Debt",
    balanceCents: d.current_balance_cents ?? 0,
  }));

  const cardDetailsByAccount = new Map<string, CardDetails>();
  for (const d of cardDetailRows ?? []) {
    cardDetailsByAccount.set(d.account_id, {
      bank: d.bank ?? null,
      authUser: d.auth_user ?? null,
      charging: d.charging ?? null,
      bonusInfo: d.bonus_info ?? null,
      bonusSpendCents: d.bonus_spend_cents ?? null,
      bonusSpendDeadline: d.bonus_spend_deadline ?? null,
      bonusEarned: d.bonus_earned ?? false,
      currentPoints: d.current_points ?? 0,
      feesPaidCents: d.fees_paid_cents ?? 0,
      freeNightCreditCents: d.free_night_credit_cents ?? null,
      freeNightExpiresOn: d.free_night_expires_on ?? null,
      freeNightPointsLimit: d.free_night_points_limit ?? null,
      benefitUsedOn: d.benefit_used_on ?? null,
      spendingLimitCents: d.spending_limit_cents ?? null,
      remarks: d.remarks ?? null,
      isRevolvingDebt: d.is_revolving_debt ?? false,
      debtSubcategoryId: d.debt_subcategory_id ?? null,
    });
  }

  // Auto-computed "owed" per credit card:
  //   sum(charges: account_id = card AND paid_to_account_id IS NULL)
  // minus sum(payments: paid_to_account_id = card)
  // This is the whole point — never a manually-entered number.
  const creditCardIds = (rows ?? [])
    .filter((a) => a.kind === "credit_card")
    .map((a) => a.id);

  const cardOwed = new Map<string, number>();
  const cardMonthSpend = new Map<string, number>();
  if (creditCardIds.length > 0) {
    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonth = now.getMonth() === 11
      ? `${now.getFullYear() + 1}-01-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, "0")}-01`;

    const [{ data: chargeRows }, { data: paymentRows }, { data: monthCharges }] = await Promise.all([
      supabase
        .from("transactions")
        .select("account_id, amount_cents")
        .eq("household_id", household.id)
        .in("account_id", creditCardIds)
        .is("paid_to_account_id", null),
      supabase
        .from("transactions")
        .select("paid_to_account_id, amount_cents")
        .eq("household_id", household.id)
        .in("paid_to_account_id", creditCardIds),
      supabase
        .from("transactions")
        .select("account_id, amount_cents")
        .eq("household_id", household.id)
        .in("account_id", creditCardIds)
        .is("paid_to_account_id", null)
        .gte("occurred_on", firstOfMonth)
        .lt("occurred_on", nextMonth),
    ]);
    for (const t of chargeRows ?? []) {
      cardOwed.set(t.account_id, (cardOwed.get(t.account_id) ?? 0) + (t.amount_cents ?? 0));
    }
    for (const t of paymentRows ?? []) {
      const to = t.paid_to_account_id as string;
      cardOwed.set(to, (cardOwed.get(to) ?? 0) - (t.amount_cents ?? 0));
    }
    for (const t of monthCharges ?? []) {
      cardMonthSpend.set(t.account_id, (cardMonthSpend.get(t.account_id) ?? 0) + (t.amount_cents ?? 0));
    }
  }

  const accounts: AccountData[] = (rows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    subtype: a.subtype,
    holder: a.holder,
    active: a.active,
    isKidsAccount: a.is_kids_account ?? false,
    bankGroup: (a.bank_group as "savings" | "spending" | null) ?? null,
    balanceCents: a.current_balance_cents ?? 0,
    annualFeeCents: a.annual_fee_cents ?? null,
    feeWaived: a.fee_waived ?? false,
    dateOpened: a.date_opened ?? null,
    dateClosed: a.date_closed ?? null,
    cardDetails: cardDetailsByAccount.get(a.id) ?? null,
    owedCents: cardOwed.get(a.id) ?? 0,
    monthSpendCents: cardMonthSpend.get(a.id) ?? 0,
    prevMonthCents: acctHistory.get(`${a.id}:${prevMonth}`) ?? null,
    prev2MonthCents: acctHistory.get(`${a.id}:${prev2Month}`) ?? null,
    buckets: (bucketRows ?? [])
      .filter((b) => b.account_id === a.id)
      .map((b) => ({
        id: b.id,
        accountId: b.account_id,
        name: b.name,
        balanceCents: b.balance_cents ?? 0,
        bankGroup: (b.bank_group as "savings" | "spending" | null) ?? null,
        prevMonthCents: bktHistory.get(`${b.id}:${prevMonth}`) ?? null,
        prev2MonthCents: bktHistory.get(`${b.id}:${prev2Month}`) ?? null,
      })),
  }));

  // Non-CC accounts for the "From" dropdown in the Pay Card modal.
  const nonCardAccounts = accounts
    .filter((a) => a.kind !== "credit_card" && a.active)
    .map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      hasBuckets: a.buckets.length > 0,
    }));

  return (
    <AccountsBoard
      accounts={accounts}
      budgetDebts={budgetDebts}
      currency={household.currency}
      nonCardAccounts={nonCardAccounts}
      historyMonths={[currentMonth, prevMonth, prev2Month]}
    />
  );
}

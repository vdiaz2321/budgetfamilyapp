import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountsBoard, type AccountData, type BudgetDebt } from "./accounts-board";
import { syncAllBucketedAccounts } from "./actions";

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

  const [{ data: rows }, { data: bucketRows }, { data: debtRows }, { data: subRows }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, kind, subtype, holder, active, is_kids_account, bank_group, current_balance_cents")
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
    ]);

  const subName = new Map((subRows ?? []).map((s) => [s.id, s.name]));
  const budgetDebts: BudgetDebt[] = (debtRows ?? []).map((d) => ({
    subcategoryId: d.subcategory_id,
    name: subName.get(d.subcategory_id) ?? "Debt",
    balanceCents: d.current_balance_cents ?? 0,
  }));

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
    buckets: (bucketRows ?? [])
      .filter((b) => b.account_id === a.id)
      .map((b) => ({
        id: b.id,
        accountId: b.account_id,
        name: b.name,
        balanceCents: b.balance_cents ?? 0,
        bankGroup: (b.bank_group as "savings" | "spending" | null) ?? null,
      })),
  }));

  return (
    <AccountsBoard
      accounts={accounts}
      budgetDebts={budgetDebts}
      currency={household.currency}
    />
  );
}

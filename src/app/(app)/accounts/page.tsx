import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountsBoard, type AccountData, type BudgetDebt } from "./accounts-board";

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

  const [{ data: rows }, { data: bucketRows }, { data: debtRows }, { data: subRows }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, kind, holder, active, current_balance_cents")
        .eq("household_id", household.id)
        .order("name"),
      supabase
        .from("buckets")
        .select("id, account_id, name, balance_cents")
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
    holder: a.holder,
    active: a.active,
    balanceCents: a.current_balance_cents ?? 0,
    buckets: (bucketRows ?? [])
      .filter((b) => b.account_id === a.id)
      .map((b) => ({
        id: b.id,
        accountId: b.account_id,
        name: b.name,
        balanceCents: b.balance_cents ?? 0,
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

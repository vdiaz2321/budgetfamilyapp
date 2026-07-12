import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountsBoard, type AccountData } from "./accounts-board";

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

  const { data: rows } = await supabase
    .from("accounts")
    .select("id, name, kind, holder, active, current_balance_cents")
    .eq("household_id", household.id)
    .order("name");

  const accounts: AccountData[] = (rows ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    holder: a.holder,
    active: a.active,
    balanceCents: a.current_balance_cents ?? 0,
  }));

  return <AccountsBoard accounts={accounts} currency={household.currency} />;
}

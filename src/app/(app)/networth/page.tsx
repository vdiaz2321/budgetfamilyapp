import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { captureSnapshots } from "@/lib/snapshots";
import { NetworthBoard, type GridRow, type MonthPoint } from "./networth-board";

export const metadata = { title: "Networth · Capitall" };

const LIABILITY_KINDS = ["credit_card", "debt_loan"];

export default async function NetworthPage() {
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

  // Refresh this month's snapshot on every visit — this is what freezes prior
  // months into history even if no balance was edited after a month rollover.
  await captureSnapshots(supabase, household.id);

  const [
    { data: accSnaps },
    { data: debtSnaps },
    { data: linkedDebts },
    { data: accountRows },
    { data: subRows },
  ] = await Promise.all([
    supabase
      .from("account_snapshots")
      .select("month, kind, balance_cents, account_id")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("debt_snapshots")
      .select("month, balance_cents, subcategory_id")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("debts")
      .select("account_id")
      .eq("household_id", household.id)
      .not("account_id", "is", null),
    supabase
      .from("accounts")
      .select("id, name")
      .eq("household_id", household.id),
    supabase
      .from("subcategories")
      .select("id, name")
      .eq("household_id", household.id),
  ]);

  // Accounts represented by a linked Budget debt — skip their snapshots so the
  // balance isn't counted twice (the debt_snapshots row carries it).
  const linkedAccountIds = new Set((linkedDebts ?? []).map((d) => d.account_id));

  // Aggregate per month: assets vs liabilities (liability accounts + budget debts).
  const byMonth = new Map<string, { assets: number; liabilities: number }>();
  const entry = (month: string) => {
    let e = byMonth.get(month);
    if (!e) {
      e = { assets: 0, liabilities: 0 };
      byMonth.set(month, e);
    }
    return e;
  };

  for (const s of accSnaps ?? []) {
    if (linkedAccountIds.has(s.account_id)) continue;
    const e = entry(s.month);
    if (LIABILITY_KINDS.includes(s.kind)) e.liabilities += s.balance_cents;
    else e.assets += s.balance_cents;
  }
  for (const s of debtSnaps ?? []) {
    entry(s.month).liabilities += s.balance_cents;
  }

  const points: MonthPoint[] = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, e]) => ({
      month, // YYYY-MM-01
      assets: e.assets,
      liabilities: e.liabilities,
      net: e.assets - e.liabilities,
    }));

  // ---- Monthly balances grid (the sheet's MonthlyNetWorth tab) ----
  const months = points.map((p) => p.month);
  const monthIdx = new Map(months.map((m, i) => [m, i]));
  const accountName = new Map((accountRows ?? []).map((a) => [a.id, a.name]));
  const subName = new Map((subRows ?? []).map((s) => [s.id, s.name]));

  const gridMap = new Map<string, GridRow>();
  const gridRow = (key: string, name: string, liability: boolean, linked: boolean) => {
    let r = gridMap.get(key);
    if (!r) {
      r = { name, liability, linked, balances: months.map(() => null) };
      gridMap.set(key, r);
    }
    return r;
  };

  for (const s of accSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    const liability = LIABILITY_KINDS.includes(s.kind);
    const r = gridRow(
      `acc:${s.account_id}`,
      accountName.get(s.account_id) ?? "Account",
      liability,
      linkedAccountIds.has(s.account_id),
    );
    r.balances[i] = s.balance_cents;
  }
  for (const s of debtSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    const r = gridRow(
      `debt:${s.subcategory_id}`,
      subName.get(s.subcategory_id) ?? "Debt",
      true,
      false,
    );
    r.balances[i] = s.balance_cents;
  }

  const rows = [...gridMap.values()].sort((a, b) => {
    if (a.liability !== b.liability) return a.liability ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <NetworthBoard
      points={points}
      gridMonths={months}
      gridRows={rows}
      currency={household.currency}
    />
  );
}

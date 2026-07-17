import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { captureSnapshots } from "@/lib/snapshots";
import { NetworthBoard, type GridRow, type MonthPoint } from "./networth-board";

export const metadata = { title: "Net Worth · Capitall" };

// Debts live only in Budget now, so liability-kind account snapshots (legacy
// credit-card/loan accounts) are ignored in net worth math — they'd
// double-count against the Budget debt. Assets = asset-kind accounts only.
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
    { data: bucketSnaps },
    { data: accountRows },
    { data: bucketRows },
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
      .from("bucket_snapshots")
      .select("month, balance_cents, bucket_id, account_id")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("accounts")
      .select("id, name, kind, is_kids_account")
      .eq("household_id", household.id),
    supabase
      .from("buckets")
      .select("id, account_id, name, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("subcategories")
      .select("id, name")
      .eq("household_id", household.id),
  ]);

  // Same grouping as the sidebar (Budget / Investments / Credit Cards / Loans)
  // so the two views read as one system.
  const { data: debtRows } = await supabase
    .from("debts")
    .select("subcategory_id, debt_kind")
    .eq("household_id", household.id);
  const debtKindBySub = new Map((debtRows ?? []).map((d) => [d.subcategory_id, d.debt_kind as string | null]));
  const cashKinds = new Set(["checking", "savings_bucket"]);
  const accountKindById = new Map((accountRows ?? []).map((a) => [a.id, a.kind as string]));
  const isKidsAccount = new Set(
    (accountRows ?? []).filter((a) => a.is_kids_account).map((a) => a.id),
  );
  // Kids Funding: shown in the grid for tracking, but skipped in every
  // total. Applied to history too — flipping the flag on Accounts
  // re-includes/excludes past months, which is the point.
  const excludedIds = isKidsAccount;
  const sectionForAccount = (accountId: string): GridRow["section"] => {
    if (isKidsAccount.has(accountId)) return "Kids Funding";
    return accountKindById.get(accountId) === "investment" ? "Investments" : "Budget";
  };
  const sectionForDebt = (subcategoryId: string): GridRow["section"] =>
    debtKindBySub.get(subcategoryId) === "credit_card" ? "Credit Cards" : "Loans";

  // Aggregate per month: assets (asset-kind accounts) vs liabilities (Budget
  // debts). Liability-kind account snapshots are skipped — debts live in Budget.
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
    if (LIABILITY_KINDS.includes(s.kind)) continue; // legacy debt account — ignore
    if (excludedIds.has(s.account_id)) continue; // not in net worth — ignore
    entry(s.month).assets += s.balance_cents;
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

  // Asset account rows keyed by account id (liability-kind accounts skipped).
  const accountGrid = new Map<
    string,
    { id: string; name: string; balances: (number | null)[] }
  >();
  const accountFor = (id: string) => {
    let r = accountGrid.get(id);
    if (!r) {
      r = {
        id,
        name: accountName.get(id) ?? "Account",
        balances: months.map(() => null),
      };
      accountGrid.set(id, r);
    }
    return r;
  };
  for (const s of accSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    if (LIABILITY_KINDS.includes(s.kind)) continue; // legacy debt account — ignore
    accountFor(s.account_id).balances[i] = s.balance_cents;
  }

  // Bucket rows keyed by bucket id, aligned to months.
  const bucketBalances = new Map<string, (number | null)[]>();
  for (const s of bucketSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    let arr = bucketBalances.get(s.bucket_id);
    if (!arr) {
      arr = months.map(() => null);
      bucketBalances.set(s.bucket_id, arr);
    }
    arr[i] = s.balance_cents;
  }
  // Buckets grouped by parent account, preserving query order (sort_order, name).
  const bucketsByAccount = new Map<string, { id: string; name: string }[]>();
  for (const b of bucketRows ?? []) {
    const list = bucketsByAccount.get(b.account_id) ?? [];
    list.push({ id: b.id, name: b.name });
    bucketsByAccount.set(b.account_id, list);
  }

  // Debt rows (Budget debts — the only liabilities now).
  const debtGrid = new Map<string, GridRow>();
  for (const s of debtSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    let r = debtGrid.get(s.subcategory_id);
    if (!r) {
      r = {
        name: subName.get(s.subcategory_id) ?? "Debt",
        liability: true,
        linked: false,
        section: sectionForDebt(s.subcategory_id),
        balances: months.map(() => null),
      };
      debtGrid.set(s.subcategory_id, r);
    }
    r.balances[i] = s.balance_cents;
  }

  // Assemble: asset accounts first (each followed by its buckets + an auto
  // "Unallocated" remainder), then Budget debts.
  const assetAccounts = [...accountGrid.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const liabilityRows: GridRow[] = [...debtGrid.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const rows: GridRow[] = [];
  for (const a of assetAccounts) {
    const buckets = bucketsByAccount.get(a.id) ?? [];
    const section = sectionForAccount(a.id);
    rows.push({
      name: a.name,
      liability: false,
      linked: false,
      excluded: excludedIds.has(a.id),
      section,
      balances: a.balances,
      hasChildren: buckets.length > 0,
      id: a.id,
    });
    if (buckets.length === 0) continue;
    for (const b of buckets) {
      rows.push({
        name: b.name,
        liability: false,
        linked: false,
        section,
        indent: true,
        parentId: a.id,
        balances: bucketBalances.get(b.id) ?? months.map(() => null),
      });
    }
    // Unallocated = account balance − sum of its buckets, per month. This is
    // a running check, not an error: it's whatever part of the account isn't
    // parked in one of its named buckets, so it should read $0 once every
    // dollar has a bucket, or the "spare" amount otherwise.
    const unallocated = months.map((_, i) => {
      const acct = a.balances[i];
      if (acct == null) return null;
      let allocated = 0;
      for (const b of buckets) allocated += bucketBalances.get(b.id)?.[i] ?? 0;
      return acct - allocated;
    });
    rows.push({
      name: "Unallocated",
      liability: false,
      linked: false,
      section,
      indent: true,
      parentId: a.id,
      muted: true,
      balances: unallocated,
    });
  }
  rows.push(...liabilityRows);

  return (
    <NetworthBoard
      points={points}
      gridMonths={months}
      gridRows={rows}
      currency={household.currency}
    />
  );
}

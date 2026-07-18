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
    { data: historyRows },
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
      .select("id, name, kind, is_kids_account, bank_group")
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
    supabase
      .from("networth_history")
      .select("month, savings_cents, bank_cents, stocks_cents, debt_cents")
      .eq("household_id", household.id)
      .order("month"),
  ]);

  // Same grouping as the sidebar (Budget / Investments / Credit Cards / Loans)
  // so the two views read as one system.
  const { data: debtRows } = await supabase
    .from("debts")
    .select("subcategory_id, debt_kind")
    .eq("household_id", household.id);
  const debtKindBySub = new Map((debtRows ?? []).map((d) => [d.subcategory_id, d.debt_kind as string | null]));
  const accountKindById = new Map((accountRows ?? []).map((a) => [a.id, a.kind as string]));
  const bankGroupById = new Map(
    (accountRows ?? []).map((a) => [a.id, (a as { bank_group?: string | null }).bank_group ?? null]),
  );
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

  // Which "bucket" of the four section totals does an asset account feed?
  //  - investment kind → Stocks
  //  - banking kind (checking/savings_bucket) tagged 'savings' → Savings
  //  - banking kind otherwise → Bank
  // Kids + liability-kind accounts feed none (excluded / handled as debt).
  type Slice = "savings" | "bank" | "stocks";
  const sliceForAccount = (accountId: string, kind: string): Slice | null => {
    if (excludedIds.has(accountId)) return null;
    if (LIABILITY_KINDS.includes(kind)) return null;
    if (kind === "investment") return "stocks";
    return bankGroupById.get(accountId) === "savings" ? "savings" : "bank";
  };

  // ---- Per-month section totals ----
  // For months that have per-account snapshots, derive the four slices from
  // them. Months with none fall back to the networth_history table (the
  // pre-per-account era: Victor's 2018–2025, or any user's early history).
  type Totals = { savings: number; bank: number; stocks: number; debt: number };
  const zero = (): Totals => ({ savings: 0, bank: 0, stocks: 0, debt: 0 });
  const derived = new Map<string, Totals>();
  const snapshotMonths = new Set<string>();

  for (const s of accSnaps ?? []) {
    snapshotMonths.add(s.month);
    const slice = sliceForAccount(s.account_id, s.kind);
    if (!slice) continue;
    const t = derived.get(s.month) ?? zero();
    t[slice] += s.balance_cents;
    derived.set(s.month, t);
  }
  for (const s of debtSnaps ?? []) {
    snapshotMonths.add(s.month);
    const t = derived.get(s.month) ?? zero();
    t.debt += s.balance_cents;
    derived.set(s.month, t);
  }

  const history = new Map(
    (historyRows ?? []).map((h) => [
      h.month,
      {
        savings: h.savings_cents,
        bank: h.bank_cents,
        stocks: h.stocks_cents,
        debt: h.debt_cents,
      } as Totals,
    ]),
  );

  // Union of every month we know about, in order. Per-account era wins over the
  // history fallback for any overlapping month.
  const allMonths = [...new Set([...snapshotMonths, ...history.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );

  const points: MonthPoint[] = allMonths.map((month) => {
    const fromHistory = !snapshotMonths.has(month);
    const t = (fromHistory ? history.get(month) : derived.get(month)) ?? zero();
    const assets = t.savings + t.bank + t.stocks;
    return {
      month,
      savings: t.savings,
      bank: t.bank,
      stocks: t.stocks,
      debt: t.debt,
      assets,
      liabilities: t.debt,
      net: assets - t.debt,
      nwWithoutInvest: t.savings + t.bank,
      fromHistory,
    };
  });

  // ---- Monthly balances grid (per-account era only) ----
  // The detailed accounts×months grid only spans months that actually have
  // per-account snapshots. Pre-per-account history shows in the analytics table,
  // not here (there's no account-level detail to show).
  const months = [...snapshotMonths].sort((a, b) => a.localeCompare(b));
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
      bucketCount: buckets.length,
      id: a.id,
      accountId: a.id,
      // A bucketed account's total is derived from its buckets, so its own row
      // is read-only — you edit the buckets. Plain accounts are editable.
      editable: buckets.length === 0,
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
        bucketId: b.id,
        editable: true,
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

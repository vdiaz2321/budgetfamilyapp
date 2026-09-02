import { Sidebar } from "./sidebar";
import { SessionInit } from "./session-init";
import { MobileTabBar } from "./mobile-tab-bar";
import { MobileHeaderMenu } from "./mobile-header-menu";
import type { SidebarGroup } from "./sidebar-accounts";
import { isDebtExcludedFromNetWorth, hasPropertyAsset } from "@/lib/net-worth";
import { getSessionContext } from "@/lib/auth-context";
import { throwIfAny } from "@/lib/supabase-result";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user, profile } = await getSessionContext();

  // Sidebar account list (YNAB-style): cash + investment accounts from
  // Accounts, debts from Budget (single source of truth), split like YNAB's
  // "Credit Card / Loans" sections.
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

  const [
    { data: accounts, error: accountsError },
    { data: buckets, error: bucketsError },
    { data: debts, error: debtsError },
    { data: subs, error: subsError },
    { count: txCount, error: txCountError },
  ] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, kind, active, is_kids_account, current_balance_cents")
        .eq("household_id", profile.household_id)
        .order("name"),
      supabase
        .from("buckets")
        .select("id, account_id, name, balance_cents")
        .eq("household_id", profile.household_id),
      supabase
        .from("debts")
        .select("subcategory_id, current_balance_cents, debt_kind")
        .eq("household_id", profile.household_id),
      supabase.from("subcategories").select("id, name").eq("household_id", profile.household_id),
      supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("household_id", profile.household_id)
        .gte("occurred_on", monthStart)
        .lt("occurred_on", monthEnd),
    ]);
  // The sidebar's balances and Net Worth pill come from these — a swallowed
  // error would show them as $0 on every page.
  throwIfAny({
    accounts: accountsError,
    buckets: bucketsError,
    debts: debtsError,
    subs: subsError,
    transactionCount: txCountError,
  });

  const subName = new Map((subs ?? []).map((s) => [s.id, s.name]));

  const cashKinds = new Set(["checking", "savings_bucket"]);
  // Kids Funding accounts (any kind) get their own sidebar group and are
  // always excluded from the Net Worth pill — it's their money, not the
  // household's.
  const active = (accounts ?? []).filter((a) => a.active !== false);
  // Mortgages only count against the sidebar's Net Worth pill once a Property
  // account carries the value behind them (lib/net-worth.ts).
  const ownsProperty = hasPropertyAsset(active);

  // Group buckets by their parent account so we can swap accounts-with-buckets
  // out for their individual buckets in the sidebar list.
  const bucketsByAccount = new Map<string, { id: string; name: string; balance_cents: number }[]>();
  for (const b of buckets ?? []) {
    const list = bucketsByAccount.get(b.account_id) ?? [];
    list.push(b);
    bucketsByAccount.set(b.account_id, list);
  }

  type SidebarItem = { id: string; name: string; balanceCents: number; inNetWorth?: boolean };

  const expandAccount = (a: {
    id: string;
    name: string;
    is_kids_account?: boolean | null;
    current_balance_cents: number | null;
  }): SidebarItem[] => {
    const bs = bucketsByAccount.get(a.id);
    if (bs && bs.length > 0) {
      return bs.map((b) => ({
        id: b.id,
        name: b.name,
        balanceCents: b.balance_cents ?? 0,
        inNetWorth: !a.is_kids_account,
      }));
    }
    return [
      {
        id: a.id,
        name: a.name,
        balanceCents: a.current_balance_cents ?? 0,
        inNetWorth: !a.is_kids_account,
      },
    ];
  };

  const debtItems = (debts ?? [])
    .filter((d) => (d.current_balance_cents ?? 0) > 0)
    .map((d) => ({
      id: d.subcategory_id as string,
      name: subName.get(d.subcategory_id) ?? "Debt",
      balanceCents: d.current_balance_cents ?? 0,
      kind: (d.debt_kind as string | null) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byBalanceDesc = (a: { balanceCents: number }, b: { balanceCents: number }) =>
    b.balanceCents - a.balanceCents;

  // Build a group from the raw accounts list (used for totals) plus the
  // expanded items (buckets when they exist) shown in the UI.
  const buildGroup = (
    label: string,
    accountsInGroup: typeof active,
    opts: { liability?: boolean } = {},
  ): SidebarGroup => {
    const totalCents = accountsInGroup.reduce((s, a) => s + (a.current_balance_cents ?? 0), 0);
    const netWorthCents = accountsInGroup.reduce(
      (s, a) => s + (a.is_kids_account ? 0 : a.current_balance_cents ?? 0),
      0,
    );
    return {
      label,
      items: accountsInGroup.flatMap(expandAccount).sort(byBalanceDesc),
      totalCents,
      netWorthCents,
      ...opts,
    };
  };

  const debtTotal = (items: typeof debtItems) => items.reduce((s, d) => s + d.balanceCents, 0);
  const netWorthDebtTotal = (items: typeof debtItems) =>
    items.reduce(
      (sum, debt) => sum + (isDebtExcludedFromNetWorth(debt.kind, ownsProperty) ? 0 : debt.balanceCents),
      0,
    );

  const ccItems = debtItems.filter((d) => d.kind === "credit_card").sort(byBalanceDesc);
  const loanItems = debtItems.filter((d) => d.kind !== "credit_card").sort(byBalanceDesc);

  const groups: SidebarGroup[] = [
    buildGroup("Banking", active.filter((a) => !a.is_kids_account && cashKinds.has(a.kind))),
    buildGroup("Investments", active.filter((a) => !a.is_kids_account && a.kind === "investment")),
    buildGroup("Property", active.filter((a) => !a.is_kids_account && a.kind === "property")),
    {
      label: "Debt",
      items: ccItems,
      liability: true,
      totalCents: debtTotal(ccItems),
      netWorthCents: netWorthDebtTotal(ccItems),
    },
    {
      label: "Loans",
      items: loanItems,
      liability: true,
      totalCents: debtTotal(loanItems),
      netWorthCents: netWorthDebtTotal(loanItems),
    },
    // Kids Funding sits at the bottom — it's the kids' money, excluded from the
    // Net Worth pill, so it reads as a footnote to the household's own accounts.
    buildGroup("Kids Funding", active.filter((a) => a.is_kids_account)),
  ];

  const badges: Record<string, number> = {
    ...(debtItems.length > 0 ? { "/snowball": debtItems.length } : {}),
    ...(txCount ? { "/transactions": txCount } : {}),
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar — YNAB-style navy in both themes */}
      <Sidebar
        groups={groups}
        userEmail={user.email ?? ""}
        displayName={profile.display_name}
        avatarUrl={profile.avatar_url}
        badges={badges}
      />

      {/* Mobile menu — floats above content so it does not reserve a banner
          row or push every page downward. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pointer-events-none fixed right-4 top-3 z-[60] md:hidden">
          <MobileHeaderMenu userEmail={user.email ?? ""} />
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 pb-20 md:px-8 md:py-8 md:pb-8">
          <SessionInit userId={user.id} />
          {children}
        </main>

        <MobileTabBar badges={badges} />
      </div>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "./sidebar";
import { SessionInit } from "./session-init";
import { MobileTabBar } from "./mobile-tab-bar";
import type { SidebarGroup } from "./sidebar-accounts";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("household_id, display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) redirect("/onboarding");

  // Sidebar account list (YNAB-style): cash + investment accounts from
  // Accounts, debts from Budget (single source of truth), split like YNAB's
  // "Credit Card / Loans" sections.
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: accounts }, { data: buckets }, { data: debts }, { data: subs }, { count: txCount }] =
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

  const subName = new Map((subs ?? []).map((s) => [s.id, s.name]));

  const cashKinds = new Set(["checking", "savings_bucket"]);
  // Kids Funding accounts (any kind) get their own sidebar group and are
  // always excluded from the Net Worth pill — it's their money, not the
  // household's.
  const active = (accounts ?? []).filter((a) => a.active !== false);

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

  const ccItems = debtItems.filter((d) => d.kind === "credit_card").sort(byBalanceDesc);
  const loanItems = debtItems.filter((d) => d.kind !== "credit_card").sort(byBalanceDesc);

  const groups: SidebarGroup[] = [
    buildGroup("Banking", active.filter((a) => !a.is_kids_account && cashKinds.has(a.kind))),
    buildGroup("Investments", active.filter((a) => !a.is_kids_account && a.kind === "investment")),
    {
      label: "Debt",
      items: ccItems,
      liability: true,
      totalCents: debtTotal(ccItems),
      netWorthCents: debtTotal(ccItems),
    },
    {
      label: "Loans",
      items: loanItems,
      liability: true,
      totalCents: debtTotal(loanItems),
      netWorthCents: debtTotal(loanItems),
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
        badges={badges}
      />

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center bg-sidebar px-4 py-3 text-white md:hidden">
          <Link href="/budget" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-sm font-bold text-white">
              C
            </span>
            <span className="font-semibold text-white">Capitall</span>
          </Link>
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

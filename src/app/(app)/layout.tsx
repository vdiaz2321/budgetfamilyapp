import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";
import SidebarNav from "./sidebar-nav";
import { Sidebar } from "./sidebar";
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
  const [{ data: household }, { data: accounts }, { data: debts }, { data: subs }] =
    await Promise.all([
      supabase.from("households").select("currency").eq("id", profile.household_id).single(),
      supabase
        .from("accounts")
        .select("id, name, kind, active, is_kids_account, current_balance_cents")
        .eq("household_id", profile.household_id)
        .order("name"),
      supabase
        .from("debts")
        .select("subcategory_id, current_balance_cents, debt_kind")
        .eq("household_id", profile.household_id),
      supabase.from("subcategories").select("id, name").eq("household_id", profile.household_id),
    ]);

  const currency = household?.currency ?? "USD";
  const subName = new Map((subs ?? []).map((s) => [s.id, s.name]));

  const cashKinds = new Set(["checking", "savings_bucket"]);
  // Kids Funding accounts (any kind) get their own sidebar group and are
  // always excluded from the Net Worth pill — it's their money, not the
  // household's.
  const active = (accounts ?? []).filter((a) => a.active !== false);
  const toItem = (a: {
    id: string;
    name: string;
    is_kids_account?: boolean | null;
    current_balance_cents: number | null;
  }) => ({
    id: a.id,
    name: a.name,
    balanceCents: a.current_balance_cents ?? 0,
    inNetWorth: !a.is_kids_account,
  });

  const debtItems = (debts ?? [])
    .filter((d) => (d.current_balance_cents ?? 0) > 0)
    .map((d) => ({
      id: d.subcategory_id as string,
      name: subName.get(d.subcategory_id) ?? "Debt",
      balanceCents: d.current_balance_cents ?? 0,
      kind: (d.debt_kind as string | null) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const groups: SidebarGroup[] = [
    {
      label: "Banking",
      items: active.filter((a) => !a.is_kids_account && cashKinds.has(a.kind)).map(toItem),
    },
    {
      label: "Investments",
      items: active.filter((a) => !a.is_kids_account && a.kind === "investment").map(toItem),
    },
    {
      label: "Credit Cards",
      items: debtItems.filter((d) => d.kind === "credit_card"),
      liability: true,
    },
    {
      label: "Loans",
      items: debtItems.filter((d) => d.kind !== "credit_card"),
      liability: true,
    },
    // Kids Funding sits at the bottom — it's the kids' money, excluded from the
    // Net Worth pill, so it reads as a footnote to the household's own accounts.
    {
      label: "Kids Funding",
      items: active.filter((a) => a.is_kids_account).map(toItem),
    },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar — YNAB-style navy in both themes */}
      <Sidebar
        groups={groups}
        currency={currency}
        userEmail={user.email ?? ""}
        badges={debtItems.length > 0 ? { "/snowball": debtItems.length } : undefined}
      />

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between bg-sidebar px-4 py-3 text-white md:hidden">
          <Link href="/budget" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-sm font-bold text-white">
              C
            </span>
            <span className="font-semibold text-white">Capitall</span>
          </Link>
          <SignOutButton />
        </header>

        {/* Mobile nav row */}
        <div className="flex gap-1 overflow-x-auto bg-sidebar px-2 py-2 text-white md:hidden">
          <SidebarNav />
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

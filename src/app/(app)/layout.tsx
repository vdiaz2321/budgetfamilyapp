import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";
import SidebarNav from "./sidebar-nav";
import { SidebarAccounts, type SidebarGroup } from "./sidebar-accounts";

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
        .select("id, name, kind, active, current_balance_cents")
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
  const active = (accounts ?? []).filter((a) => a.active !== false);
  const toItem = (a: { id: string; name: string; current_balance_cents: number | null }) => ({
    id: a.id,
    name: a.name,
    balanceCents: a.current_balance_cents ?? 0,
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
    { label: "Budget", items: active.filter((a) => cashKinds.has(a.kind)).map(toItem) },
    { label: "Investments", items: active.filter((a) => a.kind === "investment").map(toItem) },
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
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar — YNAB-style navy in both themes */}
      <aside className="hidden h-screen w-64 shrink-0 flex-col overflow-hidden bg-sidebar px-3 py-5 text-white md:sticky md:top-0 md:flex">
        <Link href="/budget" className="mb-5 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-base font-bold text-white">
            C
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">Capitall</span>
        </Link>

        <SidebarNav />

        <SidebarAccounts groups={groups} currency={currency} />

        <div className="mt-4 border-t border-white/15 pt-3">
          <p className="truncate px-2 text-xs text-white/50" title={user.email ?? ""}>
            {user.email}
          </p>
          <div className="mt-1 flex items-center justify-between px-1">
            <Link
              href="/household"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-white/60 hover:text-white"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              Share
            </Link>
            <SignOutButton />
          </div>
        </div>
      </aside>

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

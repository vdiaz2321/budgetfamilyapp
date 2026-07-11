import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";
import SidebarNav from "./sidebar-nav";

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

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <Link href="/budget" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base font-bold text-white">
            C
          </span>
          <span className="text-lg font-semibold tracking-tight">Capitall</span>
        </Link>

        <SidebarNav />

        <div className="mt-auto border-t border-border pt-4">
          <p className="truncate px-3 text-xs text-muted" title={user.email ?? ""}>
            {user.email}
          </p>
          <div className="mt-2 flex items-center justify-between px-1">
            <Link
              href="/settings"
              className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
            >
              Settings
            </Link>
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <Link href="/budget" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
              C
            </span>
            <span className="font-semibold">Capitall</span>
          </Link>
          <SignOutButton />
        </header>

        {/* Mobile nav row */}
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-2 md:hidden">
          <SidebarNav />
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

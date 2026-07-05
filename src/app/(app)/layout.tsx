import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

const NAV = [
  { href: "/log", label: "Log" },
  { href: "/budget", label: "Budget" },
  { href: "/annual", label: "Annual" },
  { href: "/settings", label: "Settings" },
];

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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Budget Family App
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {n.label}
              </Link>
            ))}
            <SignOutButton />
          </nav>
        </div>
      </header>

      {!profile ? (
        <div className="mx-auto max-w-2xl px-6 py-16">
          <NoProfileNotice email={user.email ?? ""} />
        </div>
      ) : (
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      )}
    </div>
  );
}

function NoProfileNotice({ email }: { email: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <p className="font-medium">One-time setup</p>
      <p className="mt-2">
        You&apos;re signed in as <strong>{email}</strong>, but haven&apos;t set
        up a household yet.
      </p>
      <p className="mt-4">
        <Link
          href="/onboarding"
          className="inline-flex rounded-lg bg-amber-600 px-4 py-2 font-medium text-white hover:bg-amber-700"
        >
          Create household
        </Link>
      </p>
    </div>
  );
}

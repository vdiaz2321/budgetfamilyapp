import Link from "next/link";

const cards = [
  {
    href: "/log",
    title: "Log",
    body: "Add and review every transaction — date, amount, category, subcategory, payee, card, memo.",
    status: "Coming next",
  },
  {
    href: "/budget",
    title: "Budget",
    body: "Planned vs. actual per subcategory, month-by-month. Drill down to the transactions behind each total.",
    status: "Coming next",
  },
  {
    href: "/annual",
    title: "Annual / Year",
    body: "Toggle between the annual pivot and the year summary — same underlying data, two views.",
    status: "Coming next",
  },
  {
    href: "/settings",
    title: "Settings",
    body: "Categories, subcategories, accounts, credit cards, and monthly planned amounts.",
    status: "Coming next",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <header className="mb-12">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Budget Family App
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
            A budget built for how your family actually spends.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            Replacing the spreadsheet, one tab at a time. Log transactions, watch
            planned vs. actual, and see the year at a glance — with receipt
            scanning coming later.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group rounded-2xl border border-zinc-200 bg-white p-6 transition hover:border-emerald-500 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-400"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {c.title}
                </h2>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {c.status}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {c.body}
              </p>
            </Link>
          ))}
        </section>

        <footer className="mt-16 text-xs text-zinc-500 dark:text-zinc-500">
          Phase 1 · Webpage · Powered by Supabase.
        </footer>
      </main>
    </div>
  );
}

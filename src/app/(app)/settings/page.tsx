import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Settings · Budget Family App" };

export default async function SettingsPage() {
  const supabase = await createClient();

  const [{ data: categories }, { data: subcategories }, { data: accounts }] =
    await Promise.all([
      supabase.from("categories").select("id, name, kind, sort_order").order("sort_order"),
      supabase.from("subcategories").select("id, name, category_id, active, sort_order").order("sort_order"),
      supabase.from("accounts").select("id, name, kind, holder, active").order("name"),
    ]);

  const subsByCat = new Map<string, { id: string; name: string }[]>();
  for (const s of subcategories ?? []) {
    if (!subsByCat.has(s.category_id)) subsByCat.set(s.category_id, []);
    subsByCat.get(s.category_id)!.push(s);
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Categories, subcategories, accounts, and monthly planned amounts. Full
          editing UI coming next — for now this is a read-only view of what got
          seeded into your household.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Categories &amp; Subcategories
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {(categories ?? []).map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {c.name}
                <span className="ml-2 text-xs font-normal uppercase tracking-wide text-zinc-500">
                  {c.kind}
                </span>
              </h3>
              <ul className="mt-2 space-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                {(subsByCat.get(c.id) ?? []).map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
                {(subsByCat.get(c.id) ?? []).length === 0 ? (
                  <li className="text-zinc-400">— no subcategories yet</li>
                ) : null}
              </ul>
            </div>
          ))}
          {(categories ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500">
              No categories yet. Go through onboarding to seed them.
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Accounts &amp; Credit Cards
        </h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Holder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {(accounts ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{a.name}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{a.kind}</td>
                  <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{a.holder ?? "—"}</td>
                </tr>
              ))}
              {(accounts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                    No accounts yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

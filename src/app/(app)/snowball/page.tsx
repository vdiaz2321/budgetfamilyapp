import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { SnowballSettings } from "./snowball-settings";

export const metadata = { title: "Debt Snowball · Capitall" };

export default async function SnowballPage() {
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
    .select("id, currency, snowball_start_date, snowball_monthly_extra_cents")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  const currency = household.currency;
  const extraCents = household.snowball_monthly_extra_cents ?? 0;

  const [{ data: debts }, { data: subs }] = await Promise.all([
    supabase
      .from("debts")
      .select("subcategory_id, current_balance_cents, min_payment_cents, apr, due_day")
      .eq("household_id", household.id),
    supabase
      .from("subcategories")
      .select("id, name")
      .eq("household_id", household.id),
  ]);

  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));

  const rows = (debts ?? []).map((d) => ({
    subId: d.subcategory_id,
    name: nameBySub.get(d.subcategory_id) ?? "Debt",
    balanceCents: d.current_balance_cents,
    minCents: d.min_payment_cents,
    apr: Number(d.apr),
    dueDay: d.due_day as number | null,
  }));

  // Classic snowball order: smallest balance first. Paid-off debts sink to the
  // bottom; the smallest unpaid balance is the "focus" that gets the extra.
  const unpaid = rows.filter((r) => r.balanceCents > 0).sort((a, b) => a.balanceCents - b.balanceCents);
  const paidOff = rows.filter((r) => r.balanceCents <= 0);
  const ordered = [...unpaid, ...paidOff];
  const focusId = unpaid[0]?.subId ?? null;

  const totalBalance = unpaid.reduce((s, r) => s + r.balanceCents, 0);
  const totalMin = unpaid.reduce((s, r) => s + r.minCents, 0);
  const monthlyAttack = totalMin + extraCents;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Debt Snowball</h1>
        <Link
          href="/budget"
          className="text-sm font-medium text-brand hover:text-brand-strong"
        >
          ← Budget
        </Link>
      </div>

      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total debt" value={formatMoney(totalBalance, currency)} />
        <SummaryCard label="Minimums / mo" value={formatMoney(totalMin, currency)} />
        <SummaryCard
          label="Monthly attack"
          value={formatMoney(monthlyAttack, currency)}
          hint={`incl. ${formatMoney(extraCents, currency)} extra`}
          highlight
        />
      </div>

      {/* Ordered debt list */}
      <section className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
        <div className="grid grid-cols-[auto_1fr_7rem_7rem] items-center gap-2 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          <span>#</span>
          <span>Debt</span>
          <span className="text-right">Balance</span>
          <span className="text-right">This month</span>
        </div>

        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No debts yet. Add them in the Debt group on the{" "}
            <Link href="/budget" className="font-medium text-brand hover:text-brand-strong">
              Budget tab
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {ordered.map((r, i) => {
              const isFocus = r.subId === focusId;
              const isPaid = r.balanceCents <= 0;
              const thisMonth = isPaid
                ? 0
                : r.minCents + (isFocus ? extraCents : 0);
              return (
                <li
                  key={r.subId}
                  className={`grid grid-cols-[auto_1fr_7rem_7rem] items-center gap-2 px-4 py-3 ${
                    isFocus ? "bg-brand-soft/40" : ""
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isPaid
                        ? "bg-positive/15 text-positive"
                        : isFocus
                          ? "bg-brand text-white"
                          : "bg-brand-soft text-brand"
                    }`}
                  >
                    {isPaid ? "✓" : i + 1}
                  </span>
                  <div>
                    <p className={`text-sm ${isPaid ? "text-muted line-through" : "text-foreground"}`}>
                      {r.name}
                      {isFocus ? (
                        <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                          Focus
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted">
                      {r.apr ? `${r.apr}% APR` : "—"}
                      {r.dueDay ? ` · due ${r.dueDay}` : ""}
                    </p>
                  </div>
                  <span className="text-right text-sm tabular-nums text-foreground">
                    {formatMoney(r.balanceCents, currency)}
                  </span>
                  <span
                    className={`text-right text-sm tabular-nums ${
                      isFocus ? "font-semibold text-brand" : "text-foreground"
                    }`}
                  >
                    {formatMoney(thisMonth, currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SnowballSettings
        currency={currency}
        snowballStartDate={household.snowball_start_date}
        snowballMonthlyExtraCents={extraCents}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl px-4 py-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${
        highlight ? "bg-brand text-white ring-0" : "bg-surface"
      }`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide ${highlight ? "text-white/80" : "text-muted"}`}>
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      {hint ? (
        <p className={`text-[11px] ${highlight ? "text-white/80" : "text-muted"}`}>{hint}</p>
      ) : null}
    </div>
  );
}

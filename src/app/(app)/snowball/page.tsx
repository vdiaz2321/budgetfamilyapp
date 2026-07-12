import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentMonthFirst } from "@/lib/snapshots";
import { projectSnowball } from "@/lib/snowball";
import { SnowballBoard } from "./snowball-board";
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
  // Manual top-up used ONLY by the classic textbook Snowball (below) — pure
  // "pay minimums + throw this much extra at the smallest debt," independent
  // of whatever's Planned per debt. Kept as a shareable reference method.
  const manualExtraCents = household.snowball_monthly_extra_cents ?? 0;
  const month = currentMonthFirst();

  const [{ data: debts }, { data: subs }, { data: plans }, { data: periodRows }] =
    await Promise.all([
      supabase
        .from("debts")
        .select("subcategory_id, current_balance_cents, min_payment_cents, apr, due_day")
        .eq("household_id", household.id),
      supabase
        .from("subcategories")
        .select("id, name")
        .eq("household_id", household.id),
      supabase
        .from("budget_plans")
        .select("subcategory_id, planned_cents")
        .eq("household_id", household.id)
        .eq("month", month),
      supabase
        .from("snowball_extra_periods")
        .select("id, start_month, end_month, amount_cents")
        .eq("household_id", household.id)
        .order("start_month"),
    ]);

  const nameBySub = new Map((subs ?? []).map((s) => [s.id, s.name]));
  const plannedBySub = new Map((plans ?? []).map((p) => [p.subcategory_id, p.planned_cents]));

  const periods = (periodRows ?? []).map((p) => ({
    id: p.id as string,
    startMonth: p.start_month as string,
    endMonth: (p.end_month as string | null) ?? null,
    amountCents: p.amount_cents as number,
  }));

  // Extra thrown at the focus debt in a given month = flat base + every period
  // whose range covers that month.
  const extraForMonth = (m: string) =>
    manualExtraCents +
    periods.reduce(
      (sum, p) => (m >= p.startMonth && (p.endMonth == null || m <= p.endMonth) ? sum + p.amountCents : sum),
      0,
    );
  const currentExtraCents = extraForMonth(month);

  const rows = (debts ?? []).map((d) => ({
    subId: d.subcategory_id,
    name: nameBySub.get(d.subcategory_id) ?? "Debt",
    balanceCents: d.current_balance_cents,
    minCents: d.min_payment_cents,
    plannedCents: plannedBySub.get(d.subcategory_id) ?? 0,
    apr: Number(d.apr),
    dueDay: d.due_day as number | null,
  }));

  // Card order: smallest balance first (used by both modes, purely for
  // display — "My Plan" doesn't attack in any particular order).
  const unpaid = rows.filter((r) => r.balanceCents > 0).sort((a, b) => a.balanceCents - b.balanceCents);
  const paidOff = rows.filter((r) => r.balanceCents <= 0);
  const ordered = [...unpaid, ...paidOff];

  const totalBalance = unpaid.reduce((s, r) => s + r.balanceCents, 0);
  const totalMin = unpaid.reduce((s, r) => s + r.minCents, 0);

  // ---- Mode 1: "My Plan" — each debt paid at ITS OWN Planned amount (or its
  // minimum, whichever's higher), independently. No waterfall, no shared
  // "extra" pool — this is what actually happens if everyone pays exactly
  // what's Planned in Budget every month. Default, since Victor pays a fixed
  // amount per debt to hit promo deadlines rather than snowballing the
  // smallest balance first.
  const focusId = unpaid[0]?.subId ?? null; // still used to badge classic mode
  const plannedTotal = unpaid.reduce((s, r) => s + Math.max(r.minCents, r.plannedCents), 0);
  const { payoffMonth: plannedPayoff, ledger: plannedLedger } = projectSnowball(
    unpaid.map((r) => ({
      id: r.subId,
      balanceCents: r.balanceCents,
      minCents: Math.max(r.minCents, r.plannedCents),
      apr: r.apr,
    })),
    0, // no shared extra — each debt's own scheduled amount is baked into minCents above
    month,
  );

  // ---- Mode 2: classic textbook Snowball — pay every minimum, throw the
  // extra (base + any active dated periods) at the smallest balance. Doesn't
  // look at Planned amounts at all — a pure reference method, kept so it can
  // be shared/explained to someone else.
  const monthlyAttack = totalMin + currentExtraCents;
  const { payoffMonth: classicPayoff, ledger: classicLedger } = projectSnowball(
    unpaid.map((r) => ({ id: r.subId, balanceCents: r.balanceCents, minCents: r.minCents, apr: r.apr })),
    extraForMonth,
    month,
  );

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

      <SnowballBoard
        rows={ordered.map((r) => ({
          subId: r.subId,
          name: r.name,
          balanceCents: r.balanceCents,
          minCents: r.minCents,
          plannedCents: r.plannedCents,
          apr: r.apr,
          dueDay: r.dueDay,
        }))}
        focusId={focusId}
        totalBalanceCents={totalBalance}
        totalMinCents={totalMin}
        plannedTotalCents={plannedTotal}
        currentExtraCents={currentExtraCents}
        monthlyAttackCents={monthlyAttack}
        plannedPayoffMonth={Object.fromEntries(plannedPayoff)}
        plannedLedger={Object.fromEntries(plannedLedger)}
        classicPayoffMonth={Object.fromEntries(classicPayoff)}
        classicLedger={Object.fromEntries(classicLedger)}
        currency={currency}
      />

      <SnowballSettings
        currency={currency}
        snowballStartDate={household.snowball_start_date}
        snowballMonthlyExtraCents={manualExtraCents}
        periods={periods}
      />
    </div>
  );
}

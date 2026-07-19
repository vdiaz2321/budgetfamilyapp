import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { captureSnapshots } from "@/lib/snapshots";
import { InvestBoard, type InvestAccount, type YearCell } from "./invest-board";

export const metadata = { title: "Invest · Capitall" };

// History goes back to the sheet's earliest investment year.
const FLOOR_YEAR = 2023;

export default async function InvestPage() {
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
    .select("id, currency")
    .eq("id", profile.household_id)
    .single();
  if (!household) redirect("/onboarding");

  // Freeze this month's balances into snapshots, same as Net Worth — that's the
  // series the year-end balances are read from.
  await captureSnapshots(supabase, household.id);

  const [
    { data: accountRows },
    { data: accSnaps },
    { data: contribRows },
    { data: yearRows },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, holder, subtype, is_kids_account, sort_order")
      .eq("household_id", household.id)
      .eq("kind", "investment")
      .order("sort_order")
      .order("name"),
    supabase
      .from("account_snapshots")
      .select("month, account_id, balance_cents")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("v_investment_contributions")
      .select("account_id, year, net_contribution_cents")
      .eq("household_id", household.id),
    supabase
      .from("investment_years")
      .select("account_id, year, contributed_cents, accrued_cents")
      .eq("household_id", household.id),
  ]);

  const accounts = accountRows ?? [];
  const investIds = new Set(accounts.map((a) => a.id));

  // Per-account year-end balance = balance of the LAST snapshot within that
  // calendar year (Dec if present, otherwise the latest month recorded that
  // year). Snapshots come ordered by month, so a later row overwrites an
  // earlier one for the same account+year.
  const endBalance = new Map<string, number>(); // key `${accountId}:${year}`
  for (const s of accSnaps ?? []) {
    if (!investIds.has(s.account_id)) continue;
    const year = Number(s.month.slice(0, 4));
    endBalance.set(`${s.account_id}:${year}`, s.balance_cents);
  }

  // Live-derived net contributions per account+year.
  const contribBy = new Map<string, number>();
  for (const c of contribRows ?? []) {
    contribBy.set(`${c.account_id}:${c.year}`, c.net_contribution_cents ?? 0);
  }

  // Stored/reviewed rows win over derivation.
  const storedBy = new Map<string, { contributed: number; accrued: number }>();
  for (const r of yearRows ?? []) {
    storedBy.set(`${r.account_id}:${r.year}`, {
      contributed: r.contributed_cents ?? 0,
      accrued: r.accrued_cents ?? 0,
    });
  }

  const nowYear = new Date().getFullYear();

  // Which years to show: the union of every year we have data for, always
  // including the current year, floored at FLOOR_YEAR, newest first.
  const yearSet = new Set<number>([nowYear]);
  for (const r of yearRows ?? []) yearSet.add(r.year);
  for (const c of contribRows ?? []) yearSet.add(c.year);
  for (const s of accSnaps ?? []) {
    if (investIds.has(s.account_id)) yearSet.add(Number(s.month.slice(0, 4)));
  }
  const years = [...yearSet].filter((y) => y >= FLOOR_YEAR).sort((a, b) => b - a);

  const data: InvestAccount[] = accounts.map((a) => {
    const cells: Record<number, YearCell> = {};
    for (const year of years) {
      const start = endBalance.get(`${a.id}:${year - 1}`) ?? null;
      const end = endBalance.get(`${a.id}:${year}`) ?? null;
      const stored = storedBy.get(`${a.id}:${year}`);

      let contributed: number;
      let accrued: number;
      if (stored) {
        contributed = stored.contributed;
        accrued = stored.accrued;
      } else {
        contributed = contribBy.get(`${a.id}:${year}`) ?? 0;
        // Unrealized gain = balance growth minus what was put in. Only
        // computable when both year-end balances exist.
        accrued = start != null && end != null ? end - start - contributed : 0;
      }

      cells[year] = {
        year,
        startBalanceCents: start,
        endBalanceCents: end,
        contributedCents: contributed,
        accruedCents: accrued,
        stored: !!stored,
      };
    }
    return {
      id: a.id,
      name: a.name,
      holder: a.holder ?? null,
      subtype: a.subtype ?? null,
      isKids: !!a.is_kids_account,
      cells,
    };
  });

  return <InvestBoard accounts={data} years={years} currency={household.currency} />;
}

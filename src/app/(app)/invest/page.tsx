import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { captureSnapshots } from "@/lib/snapshots";
import { InvestBoard, type InvestAccount, type BucketRow, type YearCell } from "./invest-board";

export const metadata = { title: "Investments · Capitall" };

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
    { data: bucketRows },
    { data: accSnaps },
    { data: contribRows },
    { data: yearRows },
    { data: bankingRows },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, holder, subtype, is_kids_account, sort_order")
      .eq("household_id", household.id)
      .or("kind.eq.investment,is_kids_account.eq.true")
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, balance_cents, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("account_snapshots")
      .select("month, account_id, balance_cents")
      .eq("household_id", household.id)
      .order("month"),
    supabase
      .from("v_investment_contributions")
      .select("account_id, bucket_id, year, net_contribution_cents")
      .eq("household_id", household.id),
    supabase
      .from("investment_years")
      .select("account_id, bucket_id, year, contributed_cents, accrued_cents, start_cents, end_cents")
      .eq("household_id", household.id),
    supabase
      .from("accounts")
      .select("id, name, kind")
      .eq("household_id", household.id)
      .eq("active", true)
      .in("kind", ["checking", "savings_bucket", "credit_card"])
      .order("sort_order")
      .order("name"),
  ]);

  const accounts = accountRows ?? [];
  const investIds = new Set(accounts.map((a) => a.id));

  // Buckets that live under investment accounts.
  const bucketsByAccount = new Map<string, { id: string; name: string; balanceCents: number }[]>();
  for (const b of bucketRows ?? []) {
    if (!investIds.has(b.account_id)) continue;
    const arr = bucketsByAccount.get(b.account_id) ?? [];
    arr.push({ id: b.id, name: b.name, balanceCents: b.balance_cents ?? 0 });
    bucketsByAccount.set(b.account_id, arr);
  }

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

  // Live-derived net contributions per (account, bucket, year).
  const contribBy = new Map<string, number>();
  for (const c of contribRows ?? []) {
    const key = `${c.account_id}:${c.bucket_id ?? "_"}:${c.year}`;
    contribBy.set(key, c.net_contribution_cents ?? 0);
  }

  // Stored/reviewed rows.
  const storedBy = new Map<string, { contributed: number; accrued: number; start: number | null; end: number | null }>();
  for (const r of yearRows ?? []) {
    const key = `${r.account_id}:${r.bucket_id ?? "_"}:${r.year}`;
    storedBy.set(key, {
      contributed: r.contributed_cents ?? 0,
      accrued: r.accrued_cents ?? 0,
      start: r.start_cents ?? null,
      end: r.end_cents ?? null,
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

  // Build a YearCell for a specific (account, bucket, year) slot. `bucketKey` is
  // the bucket_id or "_" for the account-level (no-bucket) slot.
  function buildCell(
    accountId: string,
    bucketKey: string,
    year: number,
    fallbackEnd: number | null,
  ): YearCell {
    const key = `${accountId}:${bucketKey}:${year}`;
    const stored = storedBy.get(key);
    const liveContrib = contribBy.get(key) ?? 0;
    const isCurrentYear = year === nowYear;

    // Additive rule: current year = seed + live transactions; historical years
    // stay frozen at the reviewed/seeded value. This preserves the CSV totals
    // while letting new transactions flow through going forward.
    let contributed: number;
    if (stored) {
      contributed = isCurrentYear ? stored.contributed + liveContrib : stored.contributed;
    } else {
      contributed = liveContrib;
    }

    const start = stored?.start ?? null;
    const end = stored?.end ?? fallbackEnd;

    let accrued: number;
    if (stored) {
      accrued = stored.accrued;
    } else {
      accrued = start != null && end != null ? end - start - contributed : 0;
    }

    return {
      year,
      startBalanceCents: start,
      endBalanceCents: end,
      contributedCents: contributed,
      accruedCents: accrued,
      stored: !!stored,
    };
  }

  const data: InvestAccount[] = accounts.map((a) => {
    const acctBuckets = bucketsByAccount.get(a.id) ?? [];

    // Bucket rows carry their own cells. Fallback end for the current year =
    // bucket's live balance (buckets don't have per-month snapshots today, so
    // the current balance is the best-available "now" number).
    const buckets: BucketRow[] = acctBuckets.map((b) => {
      const cells: Record<number, YearCell> = {};
      for (const year of years) {
        const fallbackEnd = year === nowYear ? b.balanceCents : null;
        cells[year] = buildCell(a.id, b.id, year, fallbackEnd);
      }
      return { id: b.id, name: b.name, balanceCents: b.balanceCents, cells };
    });

    // Account-level cells. When the account has buckets we still keep an
    // account-level slot (bucket_id NULL) because seeded CSV rows live there.
    // Rendering rolls up bucket rows plus this slot's stored contribution so
    // the seed floor is preserved.
    const cells: Record<number, YearCell> = {};
    for (const year of years) {
      const fallbackEnd = endBalance.get(`${a.id}:${year}`) ?? null;
      cells[year] = buildCell(a.id, "_", year, fallbackEnd);
    }

    return {
      id: a.id,
      name: a.name,
      holder: a.holder ?? null,
      subtype: a.subtype ?? null,
      isKids: !!a.is_kids_account,
      sortOrder: a.sort_order ?? 0,
      cells,
      buckets,
    };
  });

  const destAccounts = (bankingRows ?? []).map((a) => ({ id: a.id, name: a.name }));

  return <InvestBoard accounts={data} years={years} currency={household.currency} destAccounts={destAccounts} />;
}

import { ensureCategories } from "@/lib/categories";
import { SavingsBoard, type SavingsCardData } from "./savings-board";
import type { AccountOption, SubOption } from "../budget/types";
import { getSessionContext } from "@/lib/auth-context";
import { capsForYear, latestCapYear, pendingCapYear } from "@/lib/contribution-limits";
import { fundSlotFor, periodStartFor, signedContributionCents } from "@/lib/fund-contributions";

export const metadata = { title: "Savings · Capitall" };

// Whole calendar months from today to a YYYY-MM-DD target date (day-of-month
// ignored — Monthly contributions are a monthly cadence, so day precision
// inside a month isn't meaningful here). Negative means the date has passed.
function monthsUntil(target: string): number {
  const [ty, tm] = target.split("-").map(Number);
  const now = new Date();
  return (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth());
}

export default async function SavingsPage() {
  const { supabase, household } = await getSessionContext();

  const categories = await ensureCategories(supabase, household.id);
  const savingsCategoryIds = categories.filter((c) => c.kind === "savings").map((c) => c.id);
  const incomeCategoryIds = categories.filter((c) => c.kind === "income").map((c) => c.id);

  const { data: subs } = await supabase
    .from("subcategories")
    .select("id, category_id, name, sort_order, linked_bucket_id, linked_account_id")
    .eq("household_id", household.id)
    .order("sort_order");

  const savingsSubs = (subs ?? []).filter((s) => savingsCategoryIds.includes(s.category_id));
  const savingsSubIds = savingsSubs.map((s) => s.id);
  const incomeSubIds = (subs ?? []).filter((s) => incomeCategoryIds.includes(s.category_id)).map((s) => s.id);
  // Bills + Expenses are the "essential monthly spend" an emergency fund has
  // to cover. Savings and debt principal are deliberately excluded — in a real
  // emergency those get paused, so counting them would overstate the runway
  // needed and understate the months of cover.
  const essentialCategoryIds = categories
    .filter((c) => c.kind === "bills" || c.kind === "expenses")
    .map((c) => c.id);
  const essentialSubIds = (subs ?? [])
    .filter((s) => essentialCategoryIds.includes(s.category_id))
    .map((s) => s.id);

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  // Three complete months back — the current month is partial and would make
  // the burn rate look artificially low.
  const essentialFromMonth = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();

  const [
    { data: savingsGoals },
    { data: savingsTx },
    { data: plans },
    { data: buckets },
    { data: accounts },
    { data: payees },
    { data: incomeActuals },
    { data: essentialActuals },
  ] = await Promise.all([
    savingsSubIds.length
      ? supabase
          .from("savings_goals")
          .select("subcategory_id, goal_cents, start_cents, monthly_contribution_cents, target_date")
          .eq("household_id", household.id)
      : Promise.resolve({ data: [] }),
    savingsSubIds.length
      ? supabase
          .from("transactions")
          .select("id, subcategory_id, amount_cents, is_withdrawal, payee_id, occurred_on, account_id")
          .eq("household_id", household.id)
          .in("subcategory_id", savingsSubIds)
      : Promise.resolve({ data: [] }),
    savingsSubIds.length
      ? supabase
          .from("budget_plans")
          .select("subcategory_id, planned_cents")
          .eq("household_id", household.id)
          .eq("month", monthKey)
          .in("subcategory_id", savingsSubIds)
      : Promise.resolve({ data: [] }),
    supabase.from("buckets").select("id, account_id, name, balance_cents").eq("household_id", household.id),
    supabase.from("accounts").select("id, name, holder, kind, subtype, is_kids_account").eq("household_id", household.id),
    // Names only — used server-side (payeeNameById) to label withdrawals. The
    // autocomplete list is fetched on demand by the client (listPayees).
    supabase.from("payees").select("id, name").eq("household_id", household.id),
    incomeSubIds.length
      ? supabase
          .from("v_monthly_actuals")
          .select("subcategory_id, actual_cents")
          .eq("household_id", household.id)
          .eq("month", monthKey)
          .in("subcategory_id", incomeSubIds)
      : Promise.resolve({ data: [] }),
    // Trailing essential spend, for emergency-fund months-of-cover.
    essentialSubIds.length
      ? supabase
          .from("v_monthly_actuals")
          .select("month, actual_cents")
          .eq("household_id", household.id)
          .gte("month", essentialFromMonth)
          .lt("month", monthKey)
          .in("subcategory_id", essentialSubIds)
      : Promise.resolve({ data: [] }),
  ]);

  const isKidsAccountById = new Map((accounts ?? []).map((a) => [a.id, a.is_kids_account ?? false]));
  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const payeeNameById = new Map((payees ?? []).map((payee) => [payee.id, payee.name]));
  const accountIdByBucket = new Map((buckets ?? []).map((b) => [b.id, b.account_id]));
  const incomeReceivedCents = (incomeActuals ?? []).reduce(
    (sum, row) => sum + Math.max(0, row.actual_cents ?? 0),
    0,
  );
  // ---- Emergency fund coverage ------------------------------------------
  //
  // The first number any financial planner asks for, and the app had nowhere
  // to show it. No new schema: the fund is found by bucket name, which is how
  // it's already labelled ("Emergency Fund").
  const emergencyBucket = (buckets ?? []).find((b) =>
    /emergency/i.test((b as { name?: string }).name ?? ""),
  ) as { id: string; name: string; balance_cents: number | null } | undefined;
  const emergencyFund = (() => {
    if (!emergencyBucket) return null;
    const balanceCents = emergencyBucket.balance_cents ?? 0;
    // Average essential spend across the complete months we actually have,
    // rather than a fixed divisor — a partial history shouldn't deflate it.
    const byMonth = new Map<string, number>();
    for (const row of essentialActuals ?? []) {
      const m = (row as { month: string }).month;
      byMonth.set(m, (byMonth.get(m) ?? 0) + Math.abs(row.actual_cents ?? 0));
    }
    const months = [...byMonth.values()];
    if (months.length === 0 || balanceCents <= 0) return null;
    const monthlyEssentialCents = Math.round(months.reduce((s, v) => s + v, 0) / months.length);
    if (monthlyEssentialCents <= 0) return null;
    return {
      name: emergencyBucket.name,
      balanceCents,
      monthlyEssentialCents,
      monthsCovered: balanceCents / monthlyEssentialCents,
      basisMonths: months.length,
    };
  })();

  const currentMonthKey = monthKey.slice(0, 7);
  const withdrawalSubOptions: SubOption[] = savingsSubs.map((sub) => ({
    id: sub.id,
    name: sub.name,
    kind: "savings",
    linkedBucketId: sub.linked_bucket_id ?? null,
  }));
  const withdrawalAccountOptions: AccountOption[] = (accounts ?? [])
    .filter((account) => account.kind === "checking" || account.kind === "savings_bucket" || account.kind === "cash" || account.kind === "credit_card")
    .map((account) => ({
      id: account.id,
      name: account.name,
      group: account.kind === "credit_card" ? "Credit Cards" : "Banking",
    }));

  const goalBySub = new Map((savingsGoals ?? []).map((g) => [g.subcategory_id, g]));
  const plannedBySub = new Map((plans ?? []).map((p) => [p.subcategory_id, p.planned_cents as number]));
  const monthDepositsBySub = new Map<string, number>();
  const monthWithdrawalsBySub = new Map<string, number>();
  for (const t of savingsTx ?? []) {
    if (t.occurred_on.startsWith(currentMonthKey)) {
      const target = t.is_withdrawal ? monthWithdrawalsBySub : monthDepositsBySub;
      target.set(t.subcategory_id, (target.get(t.subcategory_id) ?? 0) + t.amount_cents);
    }
  }

  // Contributions-to-date per goal, summed from transactions inside the goal's
  // own period.
  //
  // The period and the netting rule come from @/lib/fund-contributions, which
  // /invest reads too — same window (calendar year), same treatment of
  // withdrawals. That shared definition is what keeps this page's figure equal
  // to the Investments page's for the same fund; they drifted apart once
  // already when each owned a private copy.
  //
  // This replaces the old `start_cents + this month only` formula, which
  // required `start_cents` to be re-baselined by hand every month — the moment
  // it wasn't, that month's contributions silently vanished from progress.
  // `start_cents` is still honoured as an opening balance for goals that have
  // no transactions in the period yet, so nothing regresses on a fresh goal.
  const periodNetBySub = new Map<string, number>();
  const periodTxCountBySub = new Map<string, number>();
  for (const t of savingsTx ?? []) {
    const goal = goalBySub.get(t.subcategory_id);
    const from = periodStartFor((goal?.target_date as string | null) ?? null, now);
    if (t.occurred_on < from) continue;
    periodNetBySub.set(
      t.subcategory_id,
      (periodNetBySub.get(t.subcategory_id) ?? 0) + signedContributionCents(t),
    );
    periodTxCountBySub.set(t.subcategory_id, (periodTxCountBySub.get(t.subcategory_id) ?? 0) + 1);
  }

  // ---- Contribution limits ------------------------------------------------
  //
  // Tax-advantaged accounts have hard annual caps, and overshooting one is a
  // correctable-but-unpleasant tax event while undershooting is simply lost
  // room that doesn't roll over. Neither was visible anywhere.
  //
  // Which cap applies is read from the linked account's subtype and the
  // bucket's own name — the only places the vehicle is recorded. IRA caps are
  // per person across every IRA that person holds, so each goal is shown on
  // its own line rather than merged: if a second IRA exists that isn't tracked
  // here, a merged total would quietly understate usage.
  // Caps are keyed by the current tax year, so January doesn't silently start
  // measuring against last year's figures. Anything entered from this page
  // (contribution_caps) wins over the built-in table; a year in neither yields
  // null and the card says so rather than showing a stale cap.
  const capYear = now.getFullYear();
  const { data: storedCapRows } = await supabase
    .from("contribution_caps")
    .select("tax_year, elective_deferral_cents, ira_cents")
    .eq("household_id", household.id);
  const storedCaps: Record<number, { electiveDeferralCents: number; iraCents: number }> =
    Object.fromEntries(
      (storedCapRows ?? []).map((r) => [
        r.tax_year,
        { electiveDeferralCents: r.elective_deferral_cents, iraCents: r.ira_cents },
      ]),
    );
  const caps = capsForYear(capYear, storedCaps);
  const subtypeById = new Map((accounts ?? []).map((a) => [a.id, (a as { subtype?: string | null }).subtype ?? null]));
  const bucketNameById = new Map(
    (buckets ?? []).map((b) => [b.id, (b as { name?: string }).name ?? ""]),
  );
  const contributionLimits = !caps ? [] : savingsSubs
    .map((s) => {
      const bucketName = s.linked_bucket_id ? bucketNameById.get(s.linked_bucket_id) ?? "" : "";
      const acctId = s.linked_bucket_id
        ? accountIdByBucket.get(s.linked_bucket_id)
        : (s as { linked_account_id?: string | null }).linked_account_id ?? null;
      const subtype = acctId ? subtypeById.get(acctId) ?? "" : "";
      const haystack = `${s.name} ${bucketName} ${subtype}`.toLowerCase();

      // 401(k)/TSP elective deferral takes precedence: a TSP Roth is still
      // governed by the deferral cap, not the IRA cap.
      if (/401k|401\(k\)|\btsp\b|403b|457/.test(haystack)) {
        return { subId: s.id, name: s.name, kind: "Elective deferral (TSP / 401k)", capKind: "electiveDeferral" as const, limitCents: caps.electiveDeferralCents };
      }
      if (/roth|\bira\b/.test(haystack)) {
        return { subId: s.id, name: s.name, kind: "IRA", capKind: "ira" as const, limitCents: caps.iraCents };
      }
      return null;
    })
    .filter((x): x is { subId: string; name: string; kind: string; capKind: "electiveDeferral" | "ira"; limitCents: number } => x != null)
    .map((x) => ({
      ...x,
      contributedCents: Math.max(0, periodNetBySub.get(x.subId) ?? 0),
    }));


  // Build per-subcategory transaction lists for the expanded goal details (most recent first, cap at 12).
  const txsBySub = new Map<string, SavingsCardData["transactions"]>();
  for (const t of savingsTx ?? []) {
    if (!txsBySub.has(t.subcategory_id)) txsBySub.set(t.subcategory_id, []);
    txsBySub.get(t.subcategory_id)!.push({
      id: t.id,
      date: t.occurred_on,
      payee: t.payee_id ? payeeNameById.get(t.payee_id) ?? null : null,
      amountCents: t.amount_cents,
      isWithdrawal: t.is_withdrawal,
      accountName: t.account_id ? accountNameById.get(t.account_id) ?? null : null,
    });
  }
  for (const [k, arr] of txsBySub) {
    arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    txsBySub.set(k, arr.slice(0, 12));
  }

  const cards: SavingsCardData[] = savingsSubs.map((s) => {
    // Which account this goal's money actually lands in. Bucket link wins over
    // account link — same precedence /invest resolves contributions with, so a
    // goal can't be filed under one account here and another one there.
    const slot = fundSlotFor(
      {
        linkedBucketId: s.linked_bucket_id ?? null,
        linkedAccountId: (s as { linked_account_id?: string | null }).linked_account_id ?? null,
      },
      accountIdByBucket,
    );
    const isKids = slot ? (isKidsAccountById.get(slot.accountId) ?? false) : false;

    const g = goalBySub.get(s.id);
    const goalCents = g?.goal_cents ?? 0;
    const startCents = g?.start_cents ?? 0;
    const monthlyCents = g?.monthly_contribution_cents ?? 0;
    const targetDate = (g?.target_date as string | null) ?? null;
    const plannedCents = plannedBySub.get(s.id) ?? 0;
    const monthDepositsCents = monthDepositsBySub.get(s.id) ?? 0;
    const monthWithdrawalsCents = monthWithdrawalsBySub.get(s.id) ?? 0;
    const monthNetCents = monthDepositsCents - monthWithdrawalsCents;
    // Contributions logged inside the goal's period (see periodNetBySub above).
    // Falls back to the configured opening balance only when nothing has been
    // logged yet, so a brand-new goal still shows its starting point.
    const periodNetCents = periodNetBySub.get(s.id) ?? 0;
    const hasPeriodTx = (periodTxCountBySub.get(s.id) ?? 0) > 0;
    const savedCents = hasPeriodTx ? periodNetCents : startCents;
    const leftToSaveCents = goalCents - savedCents;
    const reached = goalCents > 0 && leftToSaveCents <= 0;

    let pace: SavingsCardData["pace"] = "none";
    let requiredMonthlyCents: number | null = null;
    if (reached) {
      pace = "reached";
    } else if (targetDate && goalCents > 0) {
      const months = monthsUntil(targetDate);
      if (months <= 0) {
        pace = "overdue";
        requiredMonthlyCents = leftToSaveCents;
      } else {
        // Treat this month's planned contribution as already made — Victor
        // logs savings at end of month, so give the month a chance to land
        // before flagging behind. Required = what's needed each future month
        // after this month's planned amount comes through.
        const projectedLeft = Math.max(0, leftToSaveCents - plannedCents);
        requiredMonthlyCents = Math.ceil(projectedLeft / months);
        pace = plannedCents >= requiredMonthlyCents ? "on_track" : "behind";
      }
    }

    return {
      id: s.id,
      name: s.name,
      goalCents,
      startCents,
      savedCents,
      monthlyCents,
      plannedCents,
      leftToSaveCents,
      targetDate,
      pace,
      requiredMonthlyCents,
      monthDepositsCents,
      monthWithdrawalsCents,
      monthNetCents,
      transactions: txsBySub.get(s.id) ?? [],
      isKids,
    };
  });

  return (
    <SavingsBoard
      cards={cards}
      currency={household.currency}
      emergencyFund={emergencyFund}
      contributionLimits={contributionLimits}
      capYear={capYear}
      capsPublished={caps != null}
      latestCapYear={latestCapYear(storedCaps)}
      pendingCapYear={pendingCapYear(now, storedCaps)}
      seedCaps={caps}
      incomeReceivedCents={incomeReceivedCents}
      currentMonthKey={currentMonthKey}
      currentMonthLabel={now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      withdrawalSubOptions={withdrawalSubOptions}
      withdrawalAccountOptions={withdrawalAccountOptions}
      firstOfMonth={monthKey}
    />
  );
}

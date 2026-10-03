import { parseHealthPlans, toRentalProperty, type RentalRow } from "@/lib/retirement";
import { withCurrentMonth, captureSnapshots, currentMonthFirst } from "@/lib/snapshots";
import { NetworthBoard, type GridRow, type MonthPoint } from "./networth-board";
import { isDebtExcludedFromNetWorth, PROPERTY_KIND } from "@/lib/net-worth";
import { adoptClosedProjectionYears, anchorYearToActualStart } from "./actions";
import { getSessionContext } from "@/lib/auth-context";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { LIABILITY_KINDS as SHARED_LIABILITY_KINDS } from "@/lib/debt-identity";
import { investSlotKey, resolveContributedCents } from "@/lib/fund-contributions";
import { throwIfAny } from "@/lib/supabase-result";
import { loadUpcomingTravelPlanCents } from "../travel/upcoming-plan";

export const metadata = { title: "Net Worth · Capitall" };

// Liability-kind accounts are presentations of a debt, never the debt itself —
// the `debts` table is the sole liability ledger. See lib/debt-identity.ts for
// the full rule and why `debt_tracking_mode` is no longer consulted.
const LIABILITY_KINDS: readonly string[] = SHARED_LIABILITY_KINDS;

export default async function NetworthPage() {
  const { supabase, household } = await getSessionContext();

  // The twelve complete months behind us. September's half-month of spending
  // would drag the yearly figure down if it were included.
  const fiToMonth = currentMonthFirst();
  const fiFromMonth = (() => {
    const [y, m] = fiToMonth.split("-").map(Number);
    const d = new Date(y, m - 1 - 12, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();

  // Refresh this month's snapshot on every visit — this is what freezes prior
  // months into history even if no balance was edited after a month rollover.
  // Started beside the reads below rather than awaited first (that cost a
  // round trip on every load); withCurrentMonth below shows the current month
  // from live balances, which is exactly what this capture writes.
  const capturePromise = captureSnapshots(supabase, household.id);
  // Awaited (and so re-thrown) further down; this only stops a failure from
  // counting as unhandled if a read below throws first.
  capturePromise.catch(() => {});

  // Trips still ahead this year, planned but not paid — kept off the pace
  // forecast. Started now so it runs beside the reads below.
  const upcomingTravelPromise = loadUpcomingTravelPlanCents(
    supabase,
    household.id,
    new Date().toISOString().slice(0, 10),
    Number(fiToMonth.slice(0, 4)),
  );

  const [
    accSnapsRead,
    debtSnapsRead,
    bucketSnapsRead,
    { data: accountRows, error: accountRowsError },
    { data: bucketRows, error: bucketRowsError },
    { data: subRows, error: subRowsError },
    historyRows,
    { data: debtRows, error: debtRowsError },
    { data: planRow, error: planError },
    { data: flowRows, error: flowError },
    { data: balanceRows, error: balanceError },
    { data: catRows, error: catError },
    { data: projectionRowsInitial, error: projectionError },
    { data: gainRows, error: gainError },
    { data: liveContribRows, error: liveContribError },
    { data: incomeLineRows, error: incomeLineError },
    { data: rentalRows, error: rentalError },
    { data: fiContribRows, error: fiContribError },
    { data: janContribRows, error: janContribError },
  ] = await Promise.all([
    // Every snapshot ever taken — this page IS the history view, so none of
    // these can be date-bounded. They grow by one row per account/bucket/debt
    // per month (~50/month today), which reaches PostgREST's 1000-row cap in
    // under three years; paged so the chart can't quietly lose its oldest
    // months once it does.
    fetchAllRows<{ month: string; kind: string; balance_cents: number; account_id: string }>((from, to) =>
      supabase
        .from("account_snapshots")
        .select("month, kind, balance_cents, account_id")
        .eq("household_id", household.id)
        .order("month")
        .order("account_id")
        .range(from, to),
    ),
    fetchAllRows<{ month: string; balance_cents: number; subcategory_id: string }>((from, to) =>
      supabase
        .from("debt_snapshots")
        .select("month, balance_cents, subcategory_id")
        .eq("household_id", household.id)
        .order("month")
        .order("subcategory_id")
        .range(from, to),
    ),
    fetchAllRows<{ month: string; balance_cents: number; bucket_id: string; account_id: string }>((from, to) =>
      supabase
        .from("bucket_snapshots")
        .select("month, balance_cents, bucket_id, account_id")
        .eq("household_id", household.id)
        .order("month")
        .order("bucket_id")
        .range(from, to),
    ),
    supabase
      .from("accounts")
      .select("id, name, kind, is_kids_account, bank_group, sort_order")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, sort_order, balance_cents")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("subcategories")
      .select("id, name")
      .eq("household_id", household.id),
    fetchAllRows<{ month: string; savings_cents: number; bank_cents: number; stocks_cents: number; debt_cents: number }>((from, to) =>
      supabase
        .from("networth_history")
        .select("month, savings_cents, bank_cents, stocks_cents, debt_cents")
        .eq("household_id", household.id)
        .order("month")
        .range(from, to),
    ),
    // Debt rows share one Net Worth section so this view matches the sidebar
    // and headline metric, regardless of whether the underlying debt is a card
    // or loan. Batched with the rest — it only needs household.id, so awaiting
    // it separately was a second serial trip to Supabase for nothing.
    supabase
      .from("debts")
      .select("subcategory_id, debt_kind, property_account_id, current_balance_cents, paid_off_at")
      .eq("household_id", household.id),
    // ---- Financial independence inputs.
    supabase
      .from("retirement_plan")
      .select("birth_year, target_retire_year, target_retire_month, service_start_month, annual_spend_cents, annual_contribution_cents, real_return_pct, withdrawal_rate_pct, guaranteed_income_cents, guaranteed_income_start_year, service_start_year, high3_monthly_cents, inflation_pct, sbp_enabled, sbp_pct, retirement_tax_pct, longevity_age, healthcare_annual_cents, health_plans, dental_vision_annual_cents, healthcare_start_age, healthcare_growth_pct")
      .eq("household_id", household.id)
      .maybeSingle(),
    // A year of actual living costs and actual saving, straight from the
    // register — the two numbers the projection turns on, and the two people
    // most often guess wrong about themselves.
    supabase
      .from("v_monthly_actuals")
      .select("month, category_id, actual_cents")
      .eq("household_id", household.id),
    supabase
      .from("accounts")
      .select("id, kind, is_kids_account, active, current_balance_cents")
      .eq("household_id", household.id),
    supabase
      .from("categories")
      .select("id, kind")
      .eq("household_id", household.id),
    // The year-by-year plan Victor has kept since 2018.
    supabase
      .from("networth_projection")
      .select("year, age, boy_cents, income_cents, work_income_cents, spending_cents, base_spending_cents, debt_freed_cents, growth_cents, one_off_cents, eoy_cents, tax_pct")
      .eq("household_id", household.id)
      .order("year"),
    // The year-end gains typed on Invest / Savings — the sheet's "Growth" row,
    // measured. Kept separate from contributions: one is money you added, the
    // other is money the market added.
    supabase
      .from("investment_years")
      .select("account_id, bucket_id, year, contributed_cents, accrued_cents")
      .eq("household_id", household.id),
    // Contributions as the register sees them. Invest / Savings prefers these
    // over a typed seed while a year is still open, and this page has to agree
    // with it or the same money reads as two different numbers.
    supabase
      .from("v_investment_contributions")
      .select("account_id, bucket_id, year, net_contribution_cents")
      .eq("household_id", household.id),
    // Retirement income that switches on and off by year (VA, SS, a job…).
    supabase
      .from("retirement_income_lines")
      .select("id, name, kind, monthly_cents, start_year, end_year, taxable")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("rental_properties")
      .select("id, name, property_account_id, loan_account_id, purchase_year, value_cents, down_payment_pct, closing_cost_pct, loan_balance_cents, loan_rate_pct, loan_years, monthly_rent_cents, monthly_costs_cents, appreciation_pct")
      .eq("household_id", household.id)
      .order("sort_order")
      .order("created_at"),
    // Contributions over the FI window, by month and account — the Retirement
    // Financial Planner's backup saving rate. Monthly so the twelve-month
    // window can be cut exactly; per account so kids' accounts can be left out.
    supabase
      .from("v_investment_contributions_monthly")
      .select("account_id, month, net_contribution_cents")
      .eq("household_id", household.id)
      .gte("month", fiFromMonth)
      .lt("month", fiToMonth),
    // This January's contributions — already inside a January opening balance.
    supabase
      .from("v_investment_contributions_monthly")
      .select("account_id, net_contribution_cents")
      .eq("household_id", household.id)
      .eq("month", `${fiToMonth.slice(0, 4)}-01-01`),
  ]);
  throwIfAny({ accountRows: accountRowsError, bucketRows: bucketRowsError, subRows: subRowsError, debtRows: debtRowsError, retirementPlan: planError, fiFlows: flowError, fiBalances: balanceError, fiCategories: catError, projection: projectionError, investmentYears: gainError, investContributions: liveContribError, incomeLines: incomeLineError, rentals: rentalError, fiContributions: fiContribError, janContributions: janContribError });

  // This month's rows as the capture started above writes them.
  const accSnaps = withCurrentMonth(
    accSnapsRead,
    (balanceRows ?? [])
      .filter((a) => a.active)
      .map((a) => ({ month: fiToMonth, kind: a.kind as string, balance_cents: a.current_balance_cents ?? 0, account_id: a.id })),
    (r) => r.account_id,
  );
  const debtSnaps = withCurrentMonth(
    debtSnapsRead,
    (debtRows ?? []).map((d) => ({ month: fiToMonth, balance_cents: d.current_balance_cents ?? 0, subcategory_id: d.subcategory_id })),
    (r) => r.subcategory_id,
  );
  const bucketSnaps = withCurrentMonth(
    bucketSnapsRead,
    (bucketRows ?? []).map((b) => ({ month: fiToMonth, balance_cents: b.balance_cents ?? 0, bucket_id: b.id, account_id: b.account_id })),
    (r) => r.bucket_id,
  );

  // Once a property carries the home's value, the mortgage against it counts
  // as the liability it is — before that it stays out (lib/net-worth.ts).
  const excludedDebtIds = new Set(
    (debtRows ?? [])
      .filter((debt) => isDebtExcludedFromNetWorth(debt.debt_kind, debt.property_account_id))
      .map((debt) => debt.subcategory_id),
  );
  // Mortgage owed on each Property account (linked on Accounts).
  const loanByProperty = new Map<string, number>();
  for (const d of debtRows ?? []) {
    if (!d.property_account_id || d.paid_off_at) continue;
    loanByProperty.set(d.property_account_id, (loanByProperty.get(d.property_account_id) ?? 0) + (d.current_balance_cents ?? 0));
  }
  const accountKindById = new Map((accountRows ?? []).map((a) => [a.id, a.kind as string]));
  const bankGroupById = new Map(
    (accountRows ?? []).map((a) => [a.id, (a as { bank_group?: string | null }).bank_group ?? null]),
  );
  const isKidsAccount = new Set(
    (accountRows ?? []).filter((a) => a.is_kids_account).map((a) => a.id),
  );
  // Kids Funding: shown in the grid for tracking, but skipped in every
  // total. Applied to history too — flipping the flag on Accounts
  // re-includes/excludes past months, which is the point.
  const excludedIds = isKidsAccount;
  const sectionForAccount = (accountId: string): GridRow["section"] => {
    if (isKidsAccount.has(accountId)) return "Kids Funding";
    const kind = accountKindById.get(accountId);
    if (kind === PROPERTY_KIND) return "Property";
    return kind === "investment" ? "Investments" : "Banking";
  };
  const sectionForDebt = (): GridRow["section"] => "Debt";

  // Which "bucket" of the four section totals does an asset account feed?
  //  - investment kind → Stocks
  //  - banking kind (checking/savings_bucket) tagged 'savings' → Savings
  //  - banking kind otherwise → Bank
  // Kids + liability-kind accounts feed none (excluded / handled as debt).
  type Slice = "savings" | "bank" | "stocks" | "property";
  const sliceForAccount = (accountId: string, kind: string): Slice | null => {
    if (excludedIds.has(accountId)) return null;
    if (LIABILITY_KINDS.includes(kind)) return null;
    if (kind === PROPERTY_KIND) return "property";
    if (kind === "investment") return "stocks";
    return bankGroupById.get(accountId) === "savings" ? "savings" : "bank";
  };

  // ---- Per-month section totals ----
  // For months that have per-account snapshots, derive the four slices from
  // them. Months with none fall back to the networth_history table (the
  // pre-per-account era: Victor's 2018–2025, or any user's early history).
  type Totals = { savings: number; bank: number; stocks: number; property: number; debt: number };
  const zero = (): Totals => ({ savings: 0, bank: 0, stocks: 0, property: 0, debt: 0 });
  const derived = new Map<string, Totals>();
  const snapshotMonths = new Set<string>();

  for (const s of accSnaps ?? []) {
    snapshotMonths.add(s.month);
    // No account balance is a liability here — the `debts` table is the only
    // liability ledger (see lib/debt-identity.ts). A `debt_loan` account falls
    // through to sliceForAccount, which returns null for liability kinds, so it
    // contributes to neither side; its debt arrives via debtSnaps below.
    //
    // This replaces a `debt_tracking_mode === 'account'` branch that was
    // unreachable (nothing ever wrote that value) and which skipped the
    // mortgage exclusion applied everywhere else — the one way these totals
    // could have drifted apart from the Accounts page.
    const slice = sliceForAccount(s.account_id, s.kind);
    if (!slice) continue;
    const t = derived.get(s.month) ?? zero();
    t[slice] += s.balance_cents;
    derived.set(s.month, t);
  }
  for (const s of debtSnaps ?? []) {
    snapshotMonths.add(s.month);
    if (excludedDebtIds.has(s.subcategory_id)) continue;
    const t = derived.get(s.month) ?? zero();
    t.debt += s.balance_cents;
    derived.set(s.month, t);
  }

  const history = new Map(
    (historyRows ?? []).map((h) => [
      h.month,
      {
        savings: h.savings_cents,
        bank: h.bank_cents,
        stocks: h.stocks_cents,
        // No property before the app tracked one — history has no such column.
        property: 0,
        debt: h.debt_cents,
      } as Totals,
    ]),
  );

  // Union of every month we know about, in order. Per-account snapshots win
  // over the imported history for any month that has them, and the history
  // fills in every month that predates per-account tracking.
  //
  // It used to be the other way round, so that a bad imported month could be
  // overridden by typing its totals in. But the importer's rows ran six months
  // past the first snapshot, and this page then showed BOTH: the Monthly Actual
  // Balances grid reads the snapshots (June 2026 = $342,002.65) while the chart
  // and both analytics tables read the history (June 2026 = $334,218). One
  // page, one month, two net worths. The account-level figures are the ones
  // the user maintains and the only ones that can be corrected in the UI, so
  // they are the ones that count.
  const allMonths = [...new Set([...snapshotMonths, ...history.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );

  const points: MonthPoint[] = allMonths.map((month) => {
    const fromHistory = history.has(month) && !derived.has(month);
    const t = (fromHistory ? history.get(month) : derived.get(month)) ?? zero();
    const assets = t.savings + t.bank + t.stocks + t.property;
    return {
      month,
      savings: t.savings,
      bank: t.bank,
      stocks: t.stocks,
      property: t.property,
      debt: t.debt,
      assets,
      liabilities: t.debt,
      net: assets - t.debt,
      nwWithoutInvest: t.savings + t.bank,
      fromHistory,
    };
  });

  // ---- Monthly Actual Balances grid (per-account era only) ----
  // The detailed accounts×months grid only spans months that actually have
  // per-account snapshots. Pre-per-account history shows in the analytics table,
  // not here (there's no account-level detail to show).
  const months = [...snapshotMonths].sort((a, b) => a.localeCompare(b));
  const monthIdx = new Map(months.map((m, i) => [m, i]));
  const accountName = new Map((accountRows ?? []).map((a) => [a.id, a.name]));
  const subName = new Map((subRows ?? []).map((s) => [s.id, s.name]));

  // Asset account rows keyed by account id (liability-kind accounts skipped).
  const accountGrid = new Map<
    string,
    { id: string; name: string; balances: (number | null)[] }
  >();
  const accountFor = (id: string) => {
    let r = accountGrid.get(id);
    if (!r) {
      r = {
        id,
        name: accountName.get(id) ?? "Account",
        balances: months.map(() => null),
      };
      accountGrid.set(id, r);
    }
    return r;
  };
  for (const s of accSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    if (LIABILITY_KINDS.includes(s.kind)) continue; // legacy debt account — ignore
    accountFor(s.account_id).balances[i] = s.balance_cents;
  }

  // Bucket rows keyed by bucket id, aligned to months.
  const bucketBalances = new Map<string, (number | null)[]>();
  for (const s of bucketSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    let arr = bucketBalances.get(s.bucket_id);
    if (!arr) {
      arr = months.map(() => null);
      bucketBalances.set(s.bucket_id, arr);
    }
    arr[i] = s.balance_cents;
  }
  // Buckets grouped by parent account, preserving query order (sort_order, name).
  const bucketsByAccount = new Map<string, { id: string; name: string }[]>();
  for (const b of bucketRows ?? []) {
    const list = bucketsByAccount.get(b.account_id) ?? [];
    list.push({ id: b.id, name: b.name });
    bucketsByAccount.set(b.account_id, list);
  }

  // Debt rows (Budget debts — the only liabilities now).
  const debtGrid = new Map<string, GridRow>();
  for (const s of debtSnaps ?? []) {
    const i = monthIdx.get(s.month);
    if (i == null) continue;
    let r = debtGrid.get(s.subcategory_id);
    if (!r) {
      r = {
        name: subName.get(s.subcategory_id) ?? "Debt",
        liability: true,
        linked: false,
        excluded: excludedDebtIds.has(s.subcategory_id),
        section: sectionForDebt(),
        balances: months.map(() => null),
        // Correctable in past months, exactly like an asset row.
        subcategoryId: s.subcategory_id,
        editable: true,
      };
      debtGrid.set(s.subcategory_id, r);
    }
    r.balances[i] = s.balance_cents;
  }

  // Assemble: asset accounts first (each followed by its buckets), then
  // Budget debts. accountGrid's own Map order
  // just reflects whichever account a snapshot scan happened to hit first —
  // meaningless for display — so order explicitly by the same sort_order the
  // Accounts page's reorder arrows write to, name as the tiebreaker. Sorting
  // by name alone here (the previous behavior) silently discarded every
  // reorder — dragging or clicking Move up/down wrote sort_order correctly,
  // but this page never read it back, so the list always snapped back to
  // A-Z. See feedback: Net Worth reordering "does not work well".
  const accountSortOrder = new Map((accountRows ?? []).map((a) => [a.id, a.sort_order ?? 0]));
  const assetAccounts = [...accountGrid.values()].sort((a, b) => {
    const diff = (accountSortOrder.get(a.id) ?? 0) - (accountSortOrder.get(b.id) ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
  const liabilityRows: GridRow[] = [...debtGrid.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const rows: GridRow[] = [];
  for (const a of assetAccounts) {
    const buckets = bucketsByAccount.get(a.id) ?? [];
    const section = sectionForAccount(a.id);
    rows.push({
      name: a.name,
      liability: false,
      linked: false,
      excluded: excludedIds.has(a.id),
      section,
      balances: a.balances,
      hasChildren: buckets.length > 0,
      bucketCount: buckets.length,
      id: a.id,
      accountId: a.id,
      // A bucketed account's total is derived from its buckets, so its own row
      // is read-only — you edit the buckets. Plain accounts are editable.
      editable: buckets.length === 0,
    });
    if (buckets.length === 0) continue;
    for (const b of buckets) {
      rows.push({
        name: b.name,
        liability: false,
        linked: false,
        section,
        indent: true,
        parentId: a.id,
        bucketId: b.id,
        editable: true,
        balances: bucketBalances.get(b.id) ?? months.map(() => null),
      });
    }
  }
  rows.push(...liabilityRows);

  // Every month that actually has snapshots, newest first — the grid filters
  // these by year in the client. A rolling "current month + 11 back" window
  // used to be built here instead, which spilled into the previous calendar
  // year and rendered those months as columns of "—" before any snapshot
  // existed for them.
  const displayMonths = [...months].sort((a, b) => b.localeCompare(a));
  const displayRows = rows.map((r) => ({
    ...r,
    balances: displayMonths.map((m) => {
      const i = monthIdx.get(m);
      return i != null ? r.balances[i] : null;
    }),
  }));

  // ---- What the FI projection is measured from.
  //
  // Spending and saving come from the same monthly actuals the Budget and
  // Annual pages read, so the three pages can never disagree about what a year
  // of this household costs. Categories are matched by kind, not by name.
  let projectionRows = projectionRowsInitial;
  const catKind = new Map((catRows ?? []).map((c) => [c.id, c.kind as string]));
  let fiSpendCents = 0;
  let fiContributionCents = 0;
  // Income over the same twelve months. Needed to seed a first projection —
  // the grid's equation is saved = income − spending, so it wants the top
  // line, not just what was left over.
  let fiIncomeCents = 0;
  const spentByYear = new Map<number, number>();
  const earnedByYear = new Map<number, number>();
  const bump = (map: Map<number, number>, year: number, cents: number) =>
    map.set(year, (map.get(year) ?? 0) + cents);
  // How much of each year the register actually covers. A year with one
  // categorised month would otherwise report $142 of spending as if it were
  // the whole year.
  const monthsByYear = new Map<number, Set<string>>();
  // Months of the FI window the register actually covers. The app's history
  // starts in January 2026, so "the last 12 months" held only 8 — and eight
  // months of spending read as a year understated it by a third.
  const fiWindowMonths = new Set<string>();

  for (const row of flowRows ?? []) {
    const kind = row.category_id ? catKind.get(row.category_id) : null;
    const cents = Math.abs(row.actual_cents ?? 0);
    const yr = Number(row.month.slice(0, 4));
    const inFiWindow = row.month >= fiFromMonth && row.month < fiToMonth;
    if (kind) {
      const seen = monthsByYear.get(yr) ?? new Set<string>();
      seen.add(row.month);
      monthsByYear.set(yr, seen);
    }

    if (kind && inFiWindow) fiWindowMonths.add(row.month);

    if (kind === "bills" || kind === "expenses") {
      if (inFiWindow) fiSpendCents += cents;
      bump(spentByYear, yr, cents);
    } else if (kind === "income") {
      if (inFiWindow) fiIncomeCents += cents;
      bump(earnedByYear, yr, cents);
    }
  }

  // What went into net-worth accounts over the window. It summed the Budget's
  // Invest/Savings category before, which also holds the kids' 529 deposits —
  // money that leaves net worth, so it can't count toward retiring.
  const kidsAccountIdsFi = new Set(
    (balanceRows ?? []).filter((a) => a.is_kids_account).map((a) => a.id),
  );
  for (const row of fiContribRows ?? []) {
    if (kidsAccountIdsFi.has(row.account_id)) continue;
    fiContributionCents += row.net_contribution_cents ?? 0;
  }

  // Scale a partial window up to a yearly rate, so every "/ yr" figure fed
  // from here means a year.
  if (fiWindowMonths.size > 0 && fiWindowMonths.size < 12) {
    const toYear = (cents: number) => Math.round((cents * 12) / fiWindowMonths.size);
    fiSpendCents = toYear(fiSpendCents);
    fiContributionCents = toYear(fiContributionCents);
    fiIncomeCents = toYear(fiIncomeCents);
  }

  // The portfolio: what the household could actually draw on. Active, not a
  // kids account, not a card or loan. Victor's call (2026-09-11): cash and
  // savings count toward FI too; there is no opt-in any more.
  //
  // A PROPERTY account does not count, and the debts do get subtracted. Both
  // matter for the same reason: this number is divided by the withdrawal rate
  // to answer "could I stop working". A house pays no 4% — counting one would
  // have made "% of FI goal" and the FI date jump by the price of the home the
  // day the VA purchase is entered, while the mortgage behind it sat outside
  // the figure entirely. Debts are netted off for the mirror of that: money
  // owed on a card is not money that can fund a retirement.
  let fiAssetsCents = 0;
  for (const a of balanceRows ?? []) {
    if (a.is_kids_account || a.active === false) continue;
    if (a.kind === "credit_card" || a.kind === "debt_loan") continue;
    if (a.kind === PROPERTY_KIND) continue;
    fiAssetsCents += a.current_balance_cents ?? 0;
  }
  // The same liabilities Net Worth counts, taken from the latest point so the
  // two can't drift: a mortgage stays out while no property is tracked,
  // exactly as it does in the totals above.
  // A mortgage linked to a property nets against that property, and the
  // property isn't investable money, so both stay out of the portfolio —
  // subtracting the loan alone would sink the plan by the whole balance.
  const activePropertyIds = new Set(
    (balanceRows ?? []).filter((a) => a.kind === PROPERTY_KIND && a.active !== false && !a.is_kids_account).map((a) => a.id),
  );
  let linkedMortgageCents = 0;
  for (const [propertyId, loan] of loanByProperty) {
    if (activePropertyIds.has(propertyId)) linkedMortgageCents += loan;
  }
  fiAssetsCents -= (points.at(-1)?.debt ?? 0) - linkedMortgageCents;

  // Headline figures use the last FINISHED month. The month in progress is
  // half-updated by design — investments only move at the month-end update,
  // while checking accounts move every day — so October read as a $7,469
  // fall against September that was only bills paid on the 1st. Same rule as
  // the Monthly Actual Balances cards.
  const closedPoints = points.filter((p) => p.month < fiToMonth);
  const lastClosed = closedPoints.at(-1) ?? null;
  if (lastClosed) {
    // Same portfolio as above — no home value, debts netted off — at that close.
    fiAssetsCents = lastClosed.net - lastClosed.property + linkedMortgageCents;
  }

  // ---- NW Projections.
  //
  // The actual for a year is the last net worth the app recorded in it, taken
  // from the very same series the chart plots — so the table and the line can
  // never tell different stories. The current year is marked in-progress
  // because its "actual" is only the year so far.
  const netByYear = new Map<number, number>();
  for (const point of closedPoints) {
    netByYear.set(Number(point.month.slice(0, 4)), point.net);
  }
  const thisYearNum = Number(fiToMonth.slice(0, 4));
  // The pace forecast runs on finished months: last month's close, over how
  // many months are done (September → the close of August, over 8).
  const monthsDone = Number(fiToMonth.slice(5, 7)) - 1;
  const monthEndNet =
    monthsDone > 0
      ? points.find((p) => p.month === `${thisYearNum}-${String(monthsDone).padStart(2, "0")}-01`)?.net ?? null
      : null;

  // Contributions and gains, resolved exactly the way Invest / Savings resolves
  // them — same helper, so the two pages can't drift apart. Kids' accounts are
  // out, as they are everywhere else in Net Worth.
  const householdAccountIds = new Set(
    (balanceRows ?? []).filter((a) => !a.is_kids_account).map((a) => a.id),
  );
  const liveBySlot = new Map<string, number>();
  for (const row of liveContribRows ?? []) {
    liveBySlot.set(
      investSlotKey(row.account_id, row.bucket_id ?? null, row.year),
      row.net_contribution_cents ?? 0,
    );
  }
  const storedBySlot = new Map<string, { contributed: number; accrued: number }>();
  for (const row of gainRows ?? []) {
    storedBySlot.set(investSlotKey(row.account_id, row.bucket_id ?? null, row.year), {
      contributed: row.contributed_cents ?? 0,
      accrued: row.accrued_cents ?? 0,
    });
  }

  const kidsAccountIds = new Set(
    (balanceRows ?? []).filter((a) => a.is_kids_account).map((a) => a.id),
  );
  const gainsByYear = new Map<number, number>();
  const investedByYear = new Map<number, number>();
  // Deposits into the kids' 529s. They leave net worth, so for the projection
  // they are spending — Victor's call, 2026-09-28. Counting them as saved
  // double-dipped: the plan expected that money to land in net worth.
  const kidsByYear = new Map<number, number>();
  const slotKeys = new Set([...liveBySlot.keys(), ...storedBySlot.keys()]);
  for (const key of slotKeys) {
    const [accountId, , yearText] = key.split(":");
    const year = Number(yearText);
    const stored = storedBySlot.get(key);
    if (kidsAccountIds.has(accountId)) {
      bump(
        kidsByYear,
        year,
        resolveContributedCents({
          storedCents: stored ? stored.contributed : null,
          liveCents: liveBySlot.get(key) ?? 0,
          hasLive: liveBySlot.has(key),
          isCurrentYear: year === thisYearNum,
        }),
      );
      continue;
    }
    if (!householdAccountIds.has(accountId)) continue;
    bump(
      investedByYear,
      year,
      resolveContributedCents({
        storedCents: stored ? stored.contributed : null,
        liveCents: liveBySlot.get(key) ?? 0,
        hasLive: liveBySlot.has(key),
        isCurrentYear: year === thisYearNum,
      }),
    );
    // Gains are only ever the reviewed year-end figure — there is nothing in
    // the register to derive them from.
    bump(gainsByYear, year, stored?.accrued ?? 0);
  }
  for (const [year, cents] of kidsByYear) {
    if (cents) bump(spentByYear, year, cents);
  }
  // ---- Gains a year has actually made, measured instead of typed.
  //
  // `investment_years.accrued_cents` is entered by hand once, at year end, so
  // for eight months of every year the app knew the market had moved and could
  // not say by how much: the grid showed no gains at all for the year running,
  // and the forecast added the WHOLE year's estimated gains on top of an actual
  // net worth that already contained the real ones.
  //
  // The snapshots have the answer. What investments are worth now, less what
  // they were worth at the end of last year, less everything paid in since, is
  // what the market added — the same subtraction anyone does by hand.
  //
  //   gains = (stocks now − stocks at last December) − contributions this year
  //
  // Contributions come from v_investment_contributions, which filters to
  // investment-kind accounts, so both sides of the subtraction cover the same
  // accounts.
  //
  // BOTH ends come from `derived` — the per-account snapshots — and never from
  // the imported history, even though `points` would happily supply a stocks
  // figure for December 2025. The two are different bases: the importer's
  // December 2025 stocks total is $146,508 while the first per-account capture
  // a month later is $154,660. Measuring from the imported number produced
  // $24,291 of gains where Invest / Savings, which anchors on the per-account
  // opening, reports $16,139 — an $8,152 disagreement between two pages about
  // the same year. This mirrors that page's `openingCents` rule exactly, so
  // the two cannot drift.
  //
  // Only the year in progress, and only when all three pieces are on record:
  //  * a per-account opening — last December's, or January's when the record
  //    starts there (the case today) and January is genuinely the first month;
  //  * this year's contributions, or the subtraction collapses into
  //    "investments went up", counting every dollar paid in as a gain — the
  //    pre-2024 years have no contribution history at all and would have
  //    reported $11,969 of "gains" for a year that mostly just got deposits.
  //
  // Closed years stay blank until their reviewed figure is typed. That is the
  // point of the distinction: this number is still moving, so it reports and
  // never feeds "Use <year> actuals" or the automatic year-end adoption.
  const runningGainsByYear = new Map<number, number>();
  {
    const snapMonths = [...snapshotMonths].sort((a, b) => a.localeCompare(b));
    const inYear = snapMonths.filter((m) => m.startsWith(String(thisYearNum)));
    const closing = inYear.length > 0 ? derived.get(inYear[inYear.length - 1])?.stocks : undefined;

    const priorDec = derived.get(`${thisYearNum - 1}-12-01`)?.stocks;
    // January only stands in when the whole record starts there. A first
    // snapshot in, say, August means the account was tracked mid-year, and
    // treating August as the opening would read every earlier contribution as
    // a loss — the same trap Invest / Savings guards against.
    const janStandIn =
      snapMonths[0] === `${thisYearNum}-01-01`
        ? derived.get(`${thisYearNum}-01-01`)?.stocks
        : undefined;
    const opening = priorDec ?? janStandIn;

    // January's close already holds January's deposits, so when it stands in
    // as the opening only February onward is subtracted — same rule as
    // Invest / Savings.
    const janAlreadyIn =
      priorDec == null && janStandIn != null
        ? (janContribRows ?? [])
            .filter((r) => householdAccountIds.has(r.account_id))
            .reduce((t, r) => t + (r.net_contribution_cents ?? 0), 0)
        : 0;
    const contributed = investedByYear.get(thisYearNum);
    if (closing != null && opening != null && contributed != null) {
      runningGainsByYear.set(thisYearNum, closing - opening - (contributed - janAlreadyIn));
    }
  }

  // A finished year stops being a forecast: once the register covers it and
  // its gains are in, the plan takes the measured figures and every later year
  // is rebuilt on them. Runs on load, like the snapshot capture above, and
  // writes nothing once a year has already been adopted.
  const measuredByYear = new Map<
    number,
    { income: number | null; spending: number | null; gains: number | null; months: number }
  >();
  for (const year of new Set([...spentByYear.keys(), ...earnedByYear.keys(), ...gainsByYear.keys()])) {
    measuredByYear.set(year, {
      income: earnedByYear.get(year) ?? null,
      spending: spentByYear.get(year) ?? null,
      gains: gainsByYear.get(year) ?? null,
      months: monthsByYear.get(year)?.size ?? 0,
    });
  }
  const adoptedYears = await adoptClosedProjectionYears(
    supabase,
    household.id,
    thisYearNum,
    measuredByYear,
    projectionRows ?? undefined,
  );
  // This year opens on last year's actual close, not the plan's.
  const anchored = await anchorYearToActualStart(
    supabase,
    household.id,
    thisYearNum,
    netByYear.get(thisYearNum - 1) ?? null,
    // Adopting re-walks the chain and can move this year's opening figure, so
    // the already-read value only stands in when nothing was adopted.
    adoptedYears.length === 0 && projectionRows
      ? (projectionRows.find((r) => r.year === thisYearNum)?.boy_cents ?? null)
      : undefined,
  );
  if (adoptedYears.length > 0 || anchored) {
    // The rows just changed underneath us; read them again so the table shows
    // what was adopted rather than what it replaced.
    const refreshed = await supabase
      .from("networth_projection")
      .select("year, age, boy_cents, income_cents, work_income_cents, spending_cents, base_spending_cents, debt_freed_cents, growth_cents, one_off_cents, eoy_cents, tax_pct")
      .eq("household_id", household.id)
      .order("year");
    if (refreshed.data) projectionRows = refreshed.data;
  }


  const upcomingTravelCents = await upcomingTravelPromise;
  await capturePromise;

  const projectionYears = (projectionRows ?? []).map((r) => ({
    year: r.year,
    age: r.age ?? null,
    boyCents: r.boy_cents ?? 0,
    incomeCents: r.income_cents ?? 0,
    workIncomeCents: r.work_income_cents ?? r.income_cents ?? 0,
    taxPct: r.tax_pct == null ? null : Number(r.tax_pct),
    spendingCents: r.spending_cents ?? 0,
    baseSpendingCents: r.base_spending_cents ?? r.spending_cents ?? 0,
    debtFreedCents: r.debt_freed_cents ?? 0,
    growthCents: r.growth_cents ?? 0,
    oneOffCents: r.one_off_cents ?? 0,
    eoyCents: r.eoy_cents ?? 0,
    actualCents: netByYear.get(r.year) ?? null,
    // Where the year actually started: last year's recorded close. The pace
    // forecast grows from this, not from the plan's opening balance.
    startActualCents: netByYear.get(r.year - 1) ?? null,
    // What went into net-worth accounts — the Investments page's Contrib
    // total. NOT the Budget's Invest/Savings category: that also holds the
    // kids' 529 deposits, which are not net worth, so counting them here made
    // the forecast treat money that left net worth as already saved.
    actualSavedCents: investedByYear.get(r.year) ?? null,
    actualIncomeCents: earnedByYear.get(r.year) ?? null,
    actualSpendingCents: spentByYear.get(r.year) ?? null,
    actualKidsCents: kidsByYear.get(r.year) || null,
    actualMonths: monthsByYear.get(r.year)?.size ?? 0,
    // `|| null`, not `?? null`: every year with an investment slot gets a
    // gainsByYear entry, and mid-year that entry is 0 because the reviewed
    // figure has not been typed yet. A stored 0 is "not entered", not "the
    // market did nothing" — left as 0 it shadowed the measured figure below it.
    actualGainsCents: gainsByYear.get(r.year) || null,
    runningGainsCents: runningGainsByYear.get(r.year) ?? null,
    actualInvestedCents: investedByYear.get(r.year) ?? null,
    inProgress: r.year === thisYearNum,
    upcomingTravelCents: r.year === thisYearNum ? upcomingTravelCents : 0,
    monthEndCents: r.year === thisYearNum ? monthEndNet : null,
    monthsDone: r.year === thisYearNum ? monthsDone : 0,
  }));

  return (
    <NetworthBoard
      points={points}
      gridMonths={displayMonths}
      gridRows={displayRows}
      currency={household.currency}
      lockedFromMonth={currentMonthFirst()}
      fiPlan={{
        birthYear: planRow?.birth_year ?? null,
        targetRetireYear: planRow?.target_retire_year ?? null,
        targetRetireMonth: planRow?.target_retire_month ?? null,
        annualSpendCents: planRow?.annual_spend_cents ?? null,
        annualContributionCents: planRow?.annual_contribution_cents ?? null,
        realReturnPct: planRow?.real_return_pct == null ? 5 : Number(planRow.real_return_pct),
        withdrawalRatePct:
          planRow?.withdrawal_rate_pct == null ? 4 : Number(planRow.withdrawal_rate_pct),
        // A pension, VA, Social Security — income the portfolio never has to
        // fund, so the FI number stops pretending it does.
        guaranteedIncomeCents: planRow?.guaranteed_income_cents ?? null,
        guaranteedIncomeStartYear: planRow?.guaranteed_income_start_year ?? null,
        serviceStartYear: planRow?.service_start_year ?? null,
        serviceStartMonth: planRow?.service_start_month ?? null,
        high3MonthlyCents: planRow?.high3_monthly_cents ?? null,
        inflationPct: planRow?.inflation_pct == null ? 2.5 : Number(planRow.inflation_pct),
        sbpEnabled: !!planRow?.sbp_enabled,
        sbpPct: planRow?.sbp_pct == null ? 6.5 : Number(planRow.sbp_pct),
        retirementTaxPct: planRow?.retirement_tax_pct == null ? 12 : Number(planRow.retirement_tax_pct),
        longevityAge: planRow?.longevity_age ?? 90,
        healthcareAnnualCents: planRow?.healthcare_annual_cents ?? null,
        healthPlans: parseHealthPlans(planRow?.health_plans),
        dentalVisionAnnualCents: planRow?.dental_vision_annual_cents ?? null,
        healthcareStartAge: planRow?.healthcare_start_age ?? 65,
        healthcareGrowthPct: planRow?.healthcare_growth_pct == null ? 1.5 : Number(planRow.healthcare_growth_pct),
        rentalRows: (rentalRows ?? []) as RentalRow[],
        rentals: ((rentalRows ?? []) as RentalRow[]).map((r) =>
          toRentalProperty(
            r,
            new Map((balanceRows ?? []).map((a) => [a.id, a.current_balance_cents ?? 0])),
            loanByProperty,
          ),
        ),
        // What a rental can link to on the Accounts page.
        propertyAccounts: (accountRows ?? [])
          .filter((a) => a.kind === "property" && !a.is_kids_account)
          .map((a) => ({
            id: a.id,
            name: a.name,
            valueCents: (balanceRows ?? []).find((b) => b.id === a.id)?.current_balance_cents ?? 0,
            loanCents: loanByProperty.get(a.id) ?? null,
          })),
        incomeLines: (incomeLineRows ?? []).map((l) => ({
          id: l.id,
          name: l.name,
          kind: l.kind,
          monthlyCents: l.monthly_cents,
          startYear: l.start_year,
          endYear: l.end_year,
          taxable: l.taxable,
        })),
      }}
      fiMeasured={{
        assetsCents: fiAssetsCents,
        asOfMonth: lastClosed?.month ?? null,
        spendCents: fiSpendCents,
        contributionCents: fiContributionCents,
        fromMonth: fiFromMonth.slice(0, 7),
        toMonth: fiToMonth.slice(0, 7),
      }}
      thisYear={thisYearNum}
      projectionYears={projectionYears}
      projectionSeed={{
        // Where the plan starts: net worth as it stands today.
        boyCents: lastClosed?.net ?? points.at(-1)?.net ?? 0,
        incomeCents: fiIncomeCents,
        spendingCents: fiSpendCents,
        fromMonth: fiFromMonth.slice(0, 7),
        toMonth: fiToMonth.slice(0, 7),
      }}
    />
  );
}

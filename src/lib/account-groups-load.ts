// Reads what the account groups are built from — shared by the Net Worth page
// (to show and edit the groups) and the plan recompute (to run them), so the
// two can't disagree about which account sits where or what it put in.

import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/lib/supabase-result";
import {
  emptyBalances,
  inferGroup,
  isGroupKind,
  type GroupKind,
  type GroupRow,
} from "@/lib/account-groups";

/** Account kinds the groups hold: money, not property, cards or loans. */
const GROUPED_KINDS = ["checking", "savings_bucket", "cash", "investment"];

/** One account (or one bucket of a bucketed account) and its group. */
export type GroupSlot = {
  accountId: string;
  bucketId: string | null;
  /** "Crypto · Kraken" for a bucket (just the bucket's name when it already
   *  says the account), the account's name otherwise. */
  name: string;
  balanceCents: number;
  /** The group it lands in with nothing picked. */
  inferred: GroupKind;
  /** The group it's in: the one picked, else the inferred one. */
  group: GroupKind;
};

export type GroupInputs = {
  slots: GroupSlot[];
  /** Today's balance in each group. */
  liveCents: Record<GroupKind, number>;
  /** What each group took in over the last twelve finished months, scaled to
   *  a year when the record is younger than that. */
  measuredAddCents: Record<GroupKind, number>;
  rows: GroupRow[];
};

export async function loadGroupInputs(supabase: SupabaseClient, householdId: string): Promise<GroupInputs> {
  const now = new Date();
  const toMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const fromDate = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  const fromMonth = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}-01`;

  const [accounts, buckets, rows, contribs, firstSnap] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, kind, is_kids_account, active, current_balance_cents, tax_treatment, retirement_kind, plan_group, sort_order")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("buckets")
      .select("id, account_id, name, balance_cents, retirement_kind, plan_group, sort_order")
      .eq("household_id", householdId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("retirement_account_groups")
      .select("kind, return_pct, add_annual_cents, add_start_year, add_end_year, take_annual_cents, take_start_year, take_end_year, tax_pct")
      .eq("household_id", householdId),
    supabase
      .from("v_investment_contributions_monthly")
      .select("account_id, bucket_id, month, net_contribution_cents")
      .eq("household_id", householdId)
      .gte("month", fromMonth)
      .lt("month", toMonth),
    supabase
      .from("account_snapshots")
      .select("month")
      .eq("household_id", householdId)
      .order("month")
      .limit(1)
      .maybeSingle(),
  ]);
  const accountRows = unwrap(accounts, "accounts") ?? [];
  const bucketRows = unwrap(buckets, "buckets") ?? [];
  const groupRows = (unwrap(rows, "account groups") ?? []) as GroupRow[];
  const contribRows = unwrap(contribs, "contributions") ?? [];
  const first = unwrap(firstSnap, "snapshots");

  const bucketsByAccount = new Map<string, typeof bucketRows>();
  for (const b of bucketRows) {
    const list = bucketsByAccount.get(b.account_id) ?? [];
    list.push(b);
    bucketsByAccount.set(b.account_id, list);
  }

  const slots: GroupSlot[] = [];
  const groupOf = new Map<string, GroupKind>();
  const slotKey = (accountId: string, bucketId: string | null) => `${accountId}:${bucketId ?? ""}`;
  for (const a of accountRows) {
    if (a.is_kids_account || a.active === false || !GROUPED_KINDS.includes(a.kind)) continue;
    const accountPick = isGroupKind(a.plan_group) ? a.plan_group : null;
    const bs = bucketsByAccount.get(a.id) ?? [];
    if (bs.length === 0) {
      const inferred = inferGroup({
        accountKind: a.kind,
        accountName: a.name,
        accountTax: a.tax_treatment,
        accountRetirementKind: a.retirement_kind,
      });
      const group = accountPick ?? inferred;
      slots.push({ accountId: a.id, bucketId: null, name: a.name, balanceCents: Number(a.current_balance_cents ?? 0), inferred, group });
      groupOf.set(slotKey(a.id, null), group);
      continue;
    }
    for (const b of bs) {
      const inferred = inferGroup({
        accountKind: a.kind,
        accountName: a.name,
        accountTax: a.tax_treatment,
        accountRetirementKind: a.retirement_kind,
        bucketName: b.name,
        bucketRetirementKind: b.retirement_kind,
      });
      const group = (isGroupKind(b.plan_group) ? b.plan_group : null) ?? accountPick ?? inferred;
      // "Fidelity Roth Vic", not "Fidelity · Fidelity Roth Vic".
      const name = b.name.toLowerCase().includes(a.name.toLowerCase()) ? b.name : `${a.name} · ${b.name}`;
      slots.push({ accountId: a.id, bucketId: b.id, name, balanceCents: Number(b.balance_cents ?? 0), inferred, group });
      groupOf.set(slotKey(a.id, b.id), group);
    }
    // Contributions logged against the account itself, not a bucket.
    groupOf.set(slotKey(a.id, null), accountPick ?? groupOf.get(slotKey(a.id, bs[0].id)) ?? "brokerage");
  }

  const liveCents = emptyBalances();
  for (const s of slots) liveCents[s.group] += s.balanceCents;

  const measuredAddCents = emptyBalances();
  for (const r of contribRows) {
    const g = groupOf.get(slotKey(r.account_id, r.bucket_id ?? null)) ?? groupOf.get(slotKey(r.account_id, null));
    if (!g || g === "cash") continue;
    measuredAddCents[g] += Number(r.net_contribution_cents ?? 0);
  }
  // A record younger than the window would read as a short year.
  const startMonth = first?.month && first.month > fromMonth ? first.month : fromMonth;
  const months =
    (Number(toMonth.slice(0, 4)) - Number(startMonth.slice(0, 4))) * 12 +
    (Number(toMonth.slice(5, 7)) - Number(startMonth.slice(5, 7)));
  if (months > 0 && months < 12) {
    for (const k of Object.keys(measuredAddCents) as GroupKind[]) {
      measuredAddCents[k] = Math.round((measuredAddCents[k] * 12) / months);
    }
  }
  for (const k of Object.keys(measuredAddCents) as GroupKind[]) {
    measuredAddCents[k] = Math.max(0, measuredAddCents[k]);
  }

  return { slots, liveCents, measuredAddCents, rows: groupRows };
}

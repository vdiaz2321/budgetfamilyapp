// What a backdated, re-dated, edited or deleted transaction does to the saved
// closes of past months. The closed_month_changes trigger records the facts;
// this works out the before and after that Accounts offers.
//
// A close is the balance at a month's end, so a transaction counts toward the
// close of its own month and of every month after it. That one rule covers a
// move into a month, a move out of one, an edit and a delete: each change is
// "what the new row does" minus "what the old row did", month by month.

export type CloseChangeRow = {
  occurred_on: string;
  amount_cents: number;
  is_withdrawal: boolean | null;
  account_id: string | null;
  bucket_id: string | null;
  source_bucket_id: string | null;
  paid_to_account_id: string | null;
  paid_to_bucket_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  payee_id: string | null;
  memo: string | null;
};

export type CloseChange = {
  id: string;
  oldRow: CloseChangeRow | null;
  newRow: CloseChangeRow | null;
  changedAt: string;
};

export type CloseSnapshot = { month: string; targetId: string; balanceCents: number; updatedAt: string };

export type CloseContext = {
  accounts: { id: string; name: string; kind: string }[];
  buckets: { id: string; accountId: string; name: string }[];
  categoryKind: Map<string, string>;
  subLinks: Map<string, { linkedBucketId: string | null; linkedAccountId: string | null }>;
  payeeNames?: Map<string, string>;
  accountSnapshots: CloseSnapshot[];
  bucketSnapshots: CloseSnapshot[];
};

export type CloseAdjustment = {
  month: string;
  accountId: string;
  bucketId: string | null;
  name: string;
  nowCents: number;
  afterCents: number;
};

export type CloseChangeLine = {
  id: string;
  kind: "added" | "moved" | "edited" | "removed";
  label: string;
  date: string;
  fromDate: string | null;
  amountCents: number;
};

export type ClosePlan = {
  changes: CloseChangeLine[];
  adjustments: CloseAdjustment[];
  months: string[];
};

// The balances the Month-end update checks against a bank statement. Card and
// debt closes aren't here, and investments are typed by hand.
const BANK_KINDS = new Set(["checking", "savings_bucket", "cash"]);

type Effect = { targetId: string; isBucket: boolean; cents: number };

// Mirrors what saving the row does to balances (insertTransactionCore and
// mutate_account_transfer), keeping only the bank side.
export function rowEffects(row: CloseChangeRow, ctx: CloseContext): Effect[] {
  const accountById = new Map(ctx.accounts.map((a) => [a.id, a]));
  const bucketById = new Map(ctx.buckets.map((b) => [b.id, b]));
  const accountsWithBuckets = new Set(ctx.buckets.map((b) => b.accountId));
  const amount = row.amount_cents;
  const effects = new Map<string, Effect>();

  const onBucket = (id: string | null, cents: number) => {
    const bucket = id ? bucketById.get(id) : undefined;
    if (!bucket || !BANK_KINDS.has(accountById.get(bucket.accountId)?.kind ?? "")) return;
    const had = effects.get(bucket.id)?.cents ?? 0;
    effects.set(bucket.id, { targetId: bucket.id, isBucket: true, cents: had + cents });
  };
  const onAccount = (id: string | null, cents: number) => {
    // A bucketed account's total is always the sum of its buckets.
    if (!id || accountsWithBuckets.has(id) || !BANK_KINDS.has(accountById.get(id)?.kind ?? "")) return;
    const had = effects.get(id)?.cents ?? 0;
    effects.set(id, { targetId: id, isBucket: false, cents: had + cents });
  };

  // A movement: out of one place, into another.
  if (row.paid_to_account_id) {
    if (row.bucket_id) onBucket(row.bucket_id, -amount);
    else onAccount(row.account_id, -amount);
    if (row.paid_to_bucket_id) onBucket(row.paid_to_bucket_id, amount);
    else onAccount(row.paid_to_account_id, amount);
    return [...effects.values()];
  }

  const kind = row.category_id ? ctx.categoryKind.get(row.category_id) ?? null : null;
  const ledger = kind === "income" ? amount : -amount;
  const signed = row.is_withdrawal ? -amount : amount;
  const links = row.subcategory_id ? ctx.subLinks.get(row.subcategory_id) : undefined;
  const linkedBucket = links?.linkedBucketId ?? null;

  // Refunds only reach the account they came back to.
  if (amount >= 0) {
    onBucket(linkedBucket, signed);
    if (row.bucket_id !== linkedBucket) onBucket(row.bucket_id, signed);
    if (!linkedBucket) onAccount(links?.linkedAccountId ?? null, signed);
  }
  onBucket(row.source_bucket_id, ledger);
  onAccount(row.account_id, ledger);
  return [...effects.values()];
}

function changeKind(change: CloseChange): CloseChangeLine["kind"] {
  if (!change.oldRow) return "added";
  if (!change.newRow) return "removed";
  return change.oldRow.occurred_on !== change.newRow.occurred_on ? "moved" : "edited";
}

// Month closes on or after this row's own month (YYYY-MM-01 keys).
const countsToward = (row: CloseChangeRow, month: string) => row.occurred_on.slice(0, 7) <= month.slice(0, 7);

export function buildClosePlan(changes: CloseChange[], ctx: CloseContext, currentMonth: string): ClosePlan {
  const accountById = new Map(ctx.accounts.map((a) => [a.id, a]));
  const bucketById = new Map(ctx.buckets.map((b) => [b.id, b]));
  const snapshotsByTarget = new Map<string, CloseSnapshot[]>();
  for (const snap of [...ctx.accountSnapshots, ...ctx.bucketSnapshots]) {
    if (snap.month >= currentMonth) continue;
    snapshotsByTarget.set(snap.targetId, [...(snapshotsByTarget.get(snap.targetId) ?? []), snap]);
  }

  const deltas = new Map<string, { snap: CloseSnapshot; isBucket: boolean; cents: number }>();
  const lines: CloseChangeLine[] = [];

  for (const change of changes) {
    const changeDeltas = new Map<string, { snap: CloseSnapshot; isBucket: boolean; cents: number }>();
    const apply = (row: CloseChangeRow | null, sign: 1 | -1) => {
      if (!row) return;
      for (const effect of rowEffects(row, ctx)) {
        for (const snap of snapshotsByTarget.get(effect.targetId) ?? []) {
          if (!countsToward(row, snap.month)) continue;
          // Your statement wins: a close saved after this change already has it.
          if (Date.parse(snap.updatedAt) > Date.parse(change.changedAt)) continue;
          const key = `${snap.month}|${effect.targetId}`;
          const had = changeDeltas.get(key)?.cents ?? 0;
          changeDeltas.set(key, { snap, isBucket: effect.isBucket, cents: had + sign * effect.cents });
        }
      }
    };
    apply(change.newRow, 1);
    apply(change.oldRow, -1);

    let touches = false;
    for (const [key, delta] of changeDeltas) {
      if (delta.cents === 0) continue;
      touches = true;
      const had = deltas.get(key)?.cents ?? 0;
      deltas.set(key, { ...delta, cents: had + delta.cents });
    }
    if (!touches) continue;

    const row = (change.newRow ?? change.oldRow)!;
    const payee = row.payee_id ? ctx.payeeNames?.get(row.payee_id) : null;
    lines.push({
      id: change.id,
      kind: changeKind(change),
      label: payee || row.memo || "Transaction",
      date: row.occurred_on,
      fromDate: change.oldRow && change.newRow && change.oldRow.occurred_on !== change.newRow.occurred_on ? change.oldRow.occurred_on : null,
      amountCents: row.amount_cents,
    });
  }

  const adjustments: CloseAdjustment[] = [];
  for (const { snap, isBucket, cents } of deltas.values()) {
    if (cents === 0) continue;
    const bucket = isBucket ? bucketById.get(snap.targetId) : undefined;
    const accountId = bucket ? bucket.accountId : snap.targetId;
    const accountName = accountById.get(accountId)?.name ?? "Account";
    adjustments.push({
      month: snap.month,
      accountId,
      bucketId: bucket?.id ?? null,
      name: bucket ? `${accountName} · ${bucket.name}` : accountName,
      nowCents: snap.balanceCents,
      afterCents: snap.balanceCents + cents,
    });
  }
  adjustments.sort((a, b) => a.name.localeCompare(b.name) || a.month.localeCompare(b.month));

  return {
    changes: lines,
    adjustments,
    months: [...new Set(adjustments.map((a) => a.month))].sort(),
  };
}

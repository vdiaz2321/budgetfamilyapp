/**
 * The figure the transaction modal's account picker shows beside each
 * account: what a credit card owes (live, from v_card_balances — the same
 * number the Accounts page shows) or what any other account holds.
 */

export type CardOwedRow = { account_id: string; owed_cents: number | null };

export function pickerBalanceCents(
  account: { id: string; kind: string; current_balance_cents?: number | null },
  cardOwed: Map<string, number>,
): number {
  if (account.kind === "credit_card") return cardOwed.get(account.id) ?? 0;
  return account.current_balance_cents ?? 0;
}

export function cardOwedMap(rows: CardOwedRow[] | null | undefined): Map<string, number> {
  return new Map((rows ?? []).map((r) => [r.account_id, r.owed_cents ?? 0]));
}

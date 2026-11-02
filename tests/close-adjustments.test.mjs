// Backdated, re-dated, edited and deleted transactions against saved closes.
// The first case is the real one that prompted this: a $4,400 transfer logged on
// Nov 2 that left on Oct 31, from USAA's $5,541.02 and Amex Checking's $399.89.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClosePlan, rowEffects } from "../src/lib/close-adjustments.ts";

const OLD_CLOSE = "2026-10-31T18:20:54Z";
const CHANGED = "2026-11-02T18:11:24Z";
const LATER = "2026-11-03T09:00:00Z";
const CURRENT = "2026-11-01";

const row = (over = {}) => ({
  occurred_on: "2026-10-31",
  amount_cents: 1000,
  is_withdrawal: false,
  account_id: null,
  bucket_id: null,
  source_bucket_id: null,
  paid_to_account_id: null,
  paid_to_bucket_id: null,
  category_id: null,
  subcategory_id: null,
  payee_id: null,
  memo: null,
  ...over,
});

const snap = (targetId, month, balanceCents, updatedAt = OLD_CLOSE) => ({ month, targetId, balanceCents, updatedAt });

const ctx = (over = {}) => ({
  accounts: [
    { id: "usaa", name: "USAA", kind: "checking" },
    { id: "amex", name: "Amex Checking", kind: "checking" },
    { id: "savings", name: "Amex Savings", kind: "savings_bucket" },
    { id: "card", name: "Sapphire", kind: "credit_card" },
    { id: "tsp", name: "TSP", kind: "investment" },
  ],
  buckets: [
    { id: "house", accountId: "savings", name: "House" },
    { id: "g-fund", accountId: "tsp", name: "G Fund" },
  ],
  categoryKind: new Map([["exp", "expenses"], ["inc", "income"], ["sav", "savings"]]),
  subLinks: new Map([["to-house", { linkedBucketId: "house", linkedAccountId: null }]]),
  accountSnapshots: [
    snap("usaa", "2026-10-01", 554102),
    snap("usaa", "2026-11-01", 114102),
    snap("amex", "2026-10-01", 39989),
    snap("card", "2026-10-01", 5000),
    snap("tsp", "2026-10-01", 9000000),
  ],
  bucketSnapshots: [snap("house", "2026-10-01", 100000), snap("g-fund", "2026-10-01", 50000)],
  ...over,
});

const transfer = (occurred_on) =>
  row({ occurred_on, amount_cents: 440000, account_id: "usaa", paid_to_account_id: "amex", memo: "Transfer to Amex Checking" });
const change = (oldRow, newRow, changedAt = CHANGED) => ({ id: "c1", oldRow, newRow, changedAt });
const byName = (plan, name) => plan.adjustments.find((a) => a.name === name);

test("the real one: a transfer re-dated from Nov 2 to Oct 31 moves both October closes", () => {
  const plan = buildClosePlan([change(transfer("2026-11-02"), transfer("2026-10-31"))], ctx(), CURRENT);
  assert.deepEqual(plan.months, ["2026-10-01"]);
  assert.equal(byName(plan, "USAA").nowCents, 554102);
  assert.equal(byName(plan, "USAA").afterCents, 114102);
  assert.equal(byName(plan, "Amex Checking").afterCents, 479989);
  assert.equal(plan.changes[0].kind, "moved");
  assert.equal(plan.changes[0].fromDate, "2026-11-02");
});

test("this month's own snapshot is never offered", () => {
  const plan = buildClosePlan([change(null, transfer("2026-10-31"))], ctx(), CURRENT);
  assert.ok(plan.adjustments.every((a) => a.month < CURRENT));
});

test("moving out of a month does the opposite", () => {
  const plan = buildClosePlan([change(transfer("2026-10-31"), transfer("2026-11-02"))], ctx(), CURRENT);
  assert.equal(byName(plan, "USAA").afterCents, 994102);
});

test("a date in an earlier month shifts that close and every close after it", () => {
  const c = ctx({ accountSnapshots: [snap("usaa", "2026-09-01", 100000), snap("usaa", "2026-10-01", 200000), snap("usaa", "2026-08-01", 50000)] });
  const plan = buildClosePlan([change(null, row({ occurred_on: "2026-09-15", account_id: "usaa", category_id: "exp" }))], c, CURRENT);
  assert.deepEqual(plan.adjustments.map((a) => [a.month, a.afterCents]), [["2026-09-01", 99000], ["2026-10-01", 199000]]);
});

test("moving within one closed month changes nothing, so nothing is offered", () => {
  const plan = buildClosePlan([change(transfer("2026-10-05"), transfer("2026-10-31"))], ctx(), CURRENT);
  assert.equal(plan.adjustments.length, 0);
  assert.equal(plan.changes.length, 0);
});

test("your statement wins: a close saved after the change isn't touched", () => {
  const c = ctx({ accountSnapshots: [snap("usaa", "2026-10-01", 114102, LATER), snap("amex", "2026-10-01", 39989)] });
  const plan = buildClosePlan([change(transfer("2026-11-02"), transfer("2026-10-31"))], c, CURRENT);
  assert.equal(byName(plan, "USAA"), undefined);
  assert.equal(byName(plan, "Amex Checking").afterCents, 479989);
});

test("no saved close, no invented figure", () => {
  const c = ctx({ accountSnapshots: [] });
  assert.equal(buildClosePlan([change(null, transfer("2026-10-31"))], c, CURRENT).adjustments.length, 0);
});

test("expense spends, income adds, delete undoes", () => {
  const spend = row({ account_id: "usaa", category_id: "exp" });
  const pay = row({ account_id: "usaa", category_id: "inc" });
  assert.equal(byName(buildClosePlan([change(null, spend)], ctx(), CURRENT), "USAA").afterCents, 553102);
  assert.equal(byName(buildClosePlan([change(null, pay)], ctx(), CURRENT), "USAA").afterCents, 555102);
  const removed = buildClosePlan([change(spend, null)], ctx(), CURRENT);
  assert.equal(byName(removed, "USAA").afterCents, 555102);
  assert.equal(removed.changes[0].kind, "removed");
});

test("an edited amount moves the close by the difference only", () => {
  const was = row({ account_id: "usaa", category_id: "exp", amount_cents: 1000 });
  const now = row({ account_id: "usaa", category_id: "exp", amount_cents: 1500 });
  const plan = buildClosePlan([change(was, now)], ctx(), CURRENT);
  assert.equal(byName(plan, "USAA").afterCents, 553602);
  assert.equal(plan.changes[0].kind, "edited");
});

test("several changes add up on one close", () => {
  const a = { ...change(null, row({ account_id: "usaa", category_id: "exp", amount_cents: 1000 })), id: "a" };
  const b = { ...change(null, row({ account_id: "usaa", category_id: "exp", amount_cents: 500 })), id: "b" };
  const plan = buildClosePlan([a, b], ctx(), CURRENT);
  assert.equal(byName(plan, "USAA").afterCents, 552602);
  assert.equal(plan.changes.length, 2);
});

test("a bucket contribution moves the bucket; a withdrawal takes from it", () => {
  const add = row({ subcategory_id: "to-house", category_id: "sav", account_id: "amex" });
  const c = ctx();
  const plan = buildClosePlan([change(null, add)], c, CURRENT);
  assert.equal(byName(plan, "Amex Savings · House").afterCents, 101000);
  assert.equal(byName(plan, "Amex Checking").afterCents, 38989);
  const out = buildClosePlan([change(null, { ...add, is_withdrawal: true })], c, CURRENT);
  assert.equal(byName(out, "Amex Savings · House").afterCents, 99000);
});

test("a refund goes back to its account and never into a linked bucket", () => {
  const refund = row({ subcategory_id: "to-house", category_id: "sav", account_id: "amex", amount_cents: -1000 });
  const plan = buildClosePlan([change(null, refund)], ctx(), CURRENT);
  assert.equal(byName(plan, "Amex Savings · House"), undefined);
  assert.equal(byName(plan, "Amex Checking").afterCents, 40989);
});

test("a source bucket pays from the bucket, not the bucketed account", () => {
  const spend = row({ account_id: "savings", source_bucket_id: "house", category_id: "exp" });
  const effects = rowEffects(spend, ctx());
  assert.deepEqual(effects, [{ targetId: "house", isBucket: true, cents: -1000 }]);
});

test("a card charge and a contribution into an investment stay out of it", () => {
  const charge = row({ account_id: "card", category_id: "exp" });
  assert.equal(buildClosePlan([change(null, charge)], ctx(), CURRENT).changes.length, 0);
  const payment = row({ account_id: "amex", paid_to_account_id: "card" });
  const paid = buildClosePlan([change(null, payment)], ctx(), CURRENT);
  assert.deepEqual(paid.adjustments.map((a) => a.name), ["Amex Checking"]);
  const toFund = row({ account_id: "amex", paid_to_account_id: "tsp", paid_to_bucket_id: "g-fund" });
  assert.deepEqual(buildClosePlan([change(null, toFund)], ctx(), CURRENT).adjustments.map((a) => a.name), ["Amex Checking"]);
});

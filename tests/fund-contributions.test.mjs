// One transaction resolved the way v_investment_contributions_monthly does it,
// so the Contrib popup's rows add up to the figure in the table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contributionSlotOf } from "../src/lib/fund-contributions.ts";

const fund = new Set(["fidelity", "kids", "tsp", "m1"]);
const isFund = (id) => fund.has(id);
const buckets = new Map([["roth", "fidelity"], ["529", "kids"], ["house", "savings"]]);
const tx = (over = {}) => ({ account_id: null, bucket_id: null, movement_type: null, linked_bucket_id: null, linked_account_id: null, ...over });

test("paid from the bank into a linked bucket lands on that bucket", () => {
  assert.deepEqual(contributionSlotOf(tx({ account_id: "bank", linked_bucket_id: "roth" }), isFund, buckets), { accountId: "fidelity", bucketId: "roth" });
});

test("a kids' account counts too", () => {
  assert.deepEqual(contributionSlotOf(tx({ account_id: "bank", linked_bucket_id: "529" }), isFund, buckets), { accountId: "kids", bucketId: "529" });
});

test("a bucket on the row wins over the linked one", () => {
  assert.deepEqual(contributionSlotOf(tx({ bucket_id: "529", linked_bucket_id: "roth" }), isFund, buckets), { accountId: "kids", bucketId: "529" });
});

test("a link to the whole account lands in its account slot", () => {
  assert.deepEqual(contributionSlotOf(tx({ account_id: "bank", linked_account_id: "tsp" }), isFund, buckets), { accountId: "tsp", bucketId: null });
});

test("posted directly on the fund", () => {
  assert.deepEqual(contributionSlotOf(tx({ account_id: "m1" }), isFund, buckets), { accountId: "m1", bucketId: null });
});

test("transfers aren't contributions", () => {
  assert.equal(contributionSlotOf(tx({ account_id: "fidelity", movement_type: "investment_transfer" }), isFund, buckets), null);
});

test("ordinary spending and a bank savings bucket don't count", () => {
  assert.equal(contributionSlotOf(tx({ account_id: "bank" }), isFund, buckets), null);
  assert.equal(contributionSlotOf(tx({ account_id: "bank", linked_bucket_id: "house" }), isFund, buckets), null);
});

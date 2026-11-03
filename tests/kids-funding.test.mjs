// The dates and refusals that decide what the Kids Funding popup offers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fullDate, handOverFrom, kidActionsFor, kidMoveBlock, kidTypeOf, kidTypeRank, monthAtAge, monthYear, trumpOpensOn, utmaAgeOptions } from "../src/lib/kids-funding.ts";

const base = { balanceCents: 1000, birthMonth: "2013-04-01", utmaAge: 21, today: "2026-11-03" };

test("a Trump Account opens January 1 of the year the child turns 18, not on the birthday", () => {
  // The IRS's own example: born Oct 1, 2025 → growth period ends Dec 31, 2042.
  assert.equal(trumpOpensOn("2025-10-01"), "2043-01-01");
  assert.equal(trumpOpensOn("2013-04-01"), "2031-01-01");
});

test("a UTMA hands over in the month the child reaches the set age", () => {
  assert.equal(handOverFrom("UTMA", "2013-04-01", 21), "2034-04-01");
  assert.equal(handOverFrom("UTMA", "2013-04-01", 25), "2038-04-01");
  assert.equal(monthAtAge("2018-03-01", 18), "2036-03-01");
});

test("a 529 and a bank account have no legal hand-over date", () => {
  assert.equal(handOverFrom("529", "2013-04-01", 21), null);
  assert.equal(handOverFrom("Savings", "2013-04-01", 21), null);
  assert.equal(handOverFrom("UTMA", null, 21), null);
});

test("a 529 changes beneficiary, moves and closes, and never hands over", () => {
  assert.deepEqual(kidActionsFor({ ...base, type: "529" }), {
    changeBeneficiary: true, moveTo529: true, close: true, handOver: false, handOverOpensOn: null,
  });
});

test("an empty 529 has nothing to move", () => {
  assert.equal(kidActionsFor({ ...base, type: "529", balanceCents: 0 }).moveTo529, false);
});

test("a UTMA can't hand over before its age, and can only close at $0", () => {
  const before = kidActionsFor({ ...base, type: "UTMA" });
  assert.equal(before.handOver, false);
  assert.equal(before.handOverOpensOn, "2034-04-01");
  assert.equal(before.close, false);
  assert.equal(before.changeBeneficiary, false);
  assert.equal(kidActionsFor({ ...base, type: "UTMA", balanceCents: 0 }).close, true);
  const after = kidActionsFor({ ...base, type: "UTMA", today: "2034-04-01" });
  assert.equal(after.handOver, true);
  assert.equal(after.handOverOpensOn, null);
});

test("a Trump Account has no action at all until its date", () => {
  assert.deepEqual(kidActionsFor({ ...base, type: "Trump Account" }), {
    changeBeneficiary: false, moveTo529: false, close: false, handOver: false, handOverOpensOn: "2031-01-01",
  });
  assert.equal(kidActionsFor({ ...base, type: "Trump Account", today: "2031-01-01" }).handOver, true);
});

test("a bank account can close or hand over any time", () => {
  const a = kidActionsFor({ ...base, type: "Checking" });
  assert.equal(a.close, true);
  assert.equal(a.handOver, true);
  assert.equal(a.handOverOpensOn, null);
});

const move = { fromKidId: "leo", fromKidName: "Leo", fromBirthMonth: "2013-04-01", toKidId: "ben", today: "2026-11-03" };

test("a 529 may move to a sibling", () => {
  assert.equal(kidMoveBlock({ ...move, fromType: "529" }), null);
});

test("a UTMA may not move to a sibling, but may leave for the child's own costs", () => {
  assert.match(kidMoveBlock({ ...move, fromType: "UTMA" }), /belongs to Leo/);
  assert.equal(kidMoveBlock({ ...move, fromType: "UTMA", toKidId: null }), null);
  assert.equal(kidMoveBlock({ ...move, fromType: "UTMA", toKidId: "leo" }), null);
});

test("a Trump Account is locked before its date and still can't reach a sibling after", () => {
  assert.match(kidMoveBlock({ ...move, fromType: "Trump Account", toKidId: null }), /until Jan 1, 2031/);
  assert.equal(kidMoveBlock({ ...move, fromType: "Trump Account", toKidId: null, today: "2031-01-01" }), null);
  assert.match(kidMoveBlock({ ...move, fromType: "Trump Account", today: "2031-01-01" }), /belongs to Leo/);
});

test("types read and sort as the popup shows them", () => {
  assert.equal(kidTypeOf("Anything", "trump_account"), "Trump Account");
  assert.equal(kidTypeOf(" 529 ", null), "529");
  assert.equal(kidTypeOf(null, null), null);
  assert.ok(kidTypeRank("529") < kidTypeRank("UTMA"));
  assert.ok(kidTypeRank("Savings") < kidTypeRank("Something else"));
});

test("dates read in plain words", () => {
  assert.equal(monthYear("2031-04-01"), "Apr 2031");
  assert.equal(fullDate("2031-01-01"), "Jan 1, 2031");
});

test("the UTMA age picker offers the legal ages and keeps an unusual current one", () => {
  assert.deepEqual(utmaAgeOptions(21), [18, 21, 25]);
  assert.deepEqual(utmaAgeOptions(22), [18, 21, 22, 25]);
});

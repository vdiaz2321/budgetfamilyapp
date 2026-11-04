// The dates and refusals that decide what the Kids Funding popup offers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fullDate, handOverFrom, handOverStatus, kidActionsFor, kidDeleteWarning, kidMoveBlock, kidSaveLabel, kidTypeLocked, kidTypeOf, kidTypeRank, monthAtAge, monthYear, successorLabelFor, parseUtma, trumpOpensOn, utmaAgeOptions, utmaGiftAge, utmaLine, utmaTransferNote } from "../src/lib/kids-funding.ts";

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

test("an emptied Trump Account can close, and a funded one still can't", () => {
  assert.equal(kidActionsFor({ ...base, type: "Trump Account", balanceCents: 0 }).close, true);
  assert.equal(kidActionsFor({ ...base, type: "Trump Account" }).close, false);
});

test("a 529, UTMA and Trump Account name who takes over, and a bank account has none", () => {
  assert.equal(successorLabelFor("529"), "Takes over if you can't");
  assert.equal(successorLabelFor("UTMA"), "Takes over if you can't");
  assert.equal(successorLabelFor("Trump Account"), "Takes over if you can't");
  assert.equal(successorLabelFor("Savings"), null);
});

test("a type stays open only until the item has a past", () => {
  assert.equal(kidTypeLocked("529", false, 1), false);
  assert.equal(kidTypeLocked("529", false, 2), true);
  assert.equal(kidTypeLocked("529", true, 0), true);
  assert.equal(kidTypeLocked(null, true, 12), false);
  assert.equal(kidTypeLocked("Brokerage", true, 12), false);
});

const save = { dirty: true, transferring: false, toName: "", partCents: null, tracking: "keep", restCents: 353700, kidName: "Leo", money: (c) => `$${c / 100}` };

test("Save says what it will do", () => {
  assert.equal(kidSaveLabel({ ...save, dirty: false }), "No changes");
  assert.equal(kidSaveLabel(save), "Save changes");
  assert.equal(kidSaveLabel({ ...save, transferring: true, toName: "Mia" }), "Save and transfer to Mia");
  assert.equal(kidSaveLabel({ ...save, transferring: true, toName: "Mia", partCents: 50000 }), "Save and transfer $500 to Mia");
  assert.equal(kidSaveLabel({ ...save, transferring: true, toName: "Mia", partCents: 0 }), "Save and transfer part to Mia");
  assert.equal(kidSaveLabel({ ...save, tracking: "closed" }), "Save and stop tracking $3537");
  assert.equal(kidSaveLabel({ ...save, tracking: "closed", restCents: 0 }), "Save and stop tracking");
  assert.equal(kidSaveLabel({ ...save, tracking: "handed_over" }), "Save and transfer $3537 to Leo");
  assert.equal(kidSaveLabel({ ...save, transferring: true, toName: "Mia", tracking: "closed" }), "Transfer to Mia and stop tracking");
  assert.equal(kidSaveLabel({ ...save, transferring: true, toName: "Mia", partCents: 50000, tracking: "closed" }), "Transfer $500 to Mia, stop tracking $3537");
  assert.equal(kidSaveLabel({ ...save, transferring: true, toName: "Mia", partCents: 353700, restCents: 0, tracking: "closed" }), "Transfer $3537 to Mia and stop tracking");
});

test("Delete's warning says what happens to the Budget", () => {
  assert.equal(kidDeleteWarning({ erase: [], keep: [] }), "Erase this account and all its past months?");
  assert.equal(kidDeleteWarning({ erase: ["Leo 529"], keep: [] }), "Erase this account, all its past months and Budget item Leo 529?");
  assert.equal(kidDeleteWarning({ erase: [], keep: ["Leo 529"] }), "Erase this account and all its past months? Budget item Leo 529 stays, since it has activity.");
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

test("the UTMA age picker offers every age a state can use", () => {
  assert.deepEqual(utmaAgeOptions(), [18, 19, 20, 21, 22, 23, 24, 25]);
});

test("a UTMA with no age has no date and can't hand over, and nothing is assumed", () => {
  assert.equal(handOverFrom("UTMA", "2013-04-01", null), null);
  const unknown = kidActionsFor({ ...base, type: "UTMA", utmaAge: null, today: "2040-01-01" });
  assert.equal(unknown.handOver, false);
  assert.equal(unknown.handOverOpensOn, null);
});

test("a state only fills in an age when its law was checked", () => {
  assert.equal(utmaGiftAge("FL"), 21);
  assert.equal(utmaGiftAge("CA"), 18);
  assert.equal(utmaGiftAge("WY"), null);
  assert.equal(utmaGiftAge(null), null);
});

test("the row says what's known and what's missing", () => {
  assert.equal(utmaLine("FL", 21, "2013-04-01"), "Florida · age 21 · Apr 2034");
  assert.equal(utmaLine("WY", null, "2013-04-01"), "Wyoming · Age needed");
  assert.equal(utmaLine(null, null, "2013-04-01"), "State needed");
  assert.equal(utmaLine(null, 21, "2013-04-01"), "State needed · age 21 · Apr 2034");
  assert.equal(utmaLine("FL", 21, null), "Florida · age 21");
});

test("the age note says what the law is, what's set, and when it lands", () => {
  const end = "You start the transfer. Moving doesn't change this.";
  assert.equal(utmaTransferNote("FL", 21, "Leo", "2013-04-01"), `Florida's age for gifts is 21. Leo gets it in Apr 2034. ${end}`);
  assert.equal(utmaTransferNote("FL", 25, "Leo", "2013-04-01"), `Florida's age for gifts is 21, but this one is set to 25. Leo gets it in Apr 2038. ${end}`);
  assert.equal(utmaTransferNote("WY", 21, "Leo", "2013-04-01"), `Set to 21. Leo gets it in Apr 2034. ${end}`);
  assert.equal(utmaTransferNote("FL", 21, "Leo", null), `Florida's age for gifts is 21. ${end}`);
});

test("hand-over status turns on 12 months before, and past on the date", () => {
  assert.equal(handOverStatus("2034-04-01", "2033-03-31"), null);
  assert.equal(handOverStatus("2034-04-01", "2033-04-01"), "soon");
  assert.equal(handOverStatus("2034-04-01", "2034-03-31"), "soon");
  assert.equal(handOverStatus("2034-04-01", "2034-04-01"), "past");
  assert.equal(handOverStatus(null, "2034-04-01"), null);
});

test("a UTMA form only takes real states and legal ages, and blank means unknown", () => {
  assert.deepEqual(parseUtma("FL", "21"), { state: "FL", age: 21, error: null });
  assert.deepEqual(parseUtma("", ""), { state: null, age: null, error: null });
  assert.equal(parseUtma("ZZ", "21").error, "Pick a state from the list.");
  assert.equal(parseUtma("FL", "17").error, "The age to transfer must be 18 to 25.");
  assert.equal(parseUtma("FL", "26").error, "The age to transfer must be 18 to 25.");
});

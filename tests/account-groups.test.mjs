import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyBalances,
  groupsYear,
  inferGroup,
  parseTypedGroups,
  resolveOverrides,
  resolveGroupSettings,
  rmdCents,
  rmdStartAge,
  scaleBalances,
} from "../src/lib/account-groups.ts";

const zeroAdds = emptyBalances();
const settingsWith = (rows) =>
  resolveGroupSettings(rows, { investReturnPct: 10, cashReturnPct: 2, measuredAddCents: zeroAdds });
const ctx = (over = {}) => ({ year: 2030, thisYear: 2026, inflationPct: 0, flowCents: 0, age: 50, birthYear: 1980, ...over });
const sum = (b) => Object.values(b).reduce((t, v) => t + v, 0);

test("each group earns its own return on its opening balance", () => {
  const s = settingsWith([{ kind: "crypto", return_pct: "20" }]);
  const r = groupsYear({ ...emptyBalances(), cash: 100_000, roth: 100_000, crypto: 100_000 }, s, ctx());
  const by = Object.fromEntries(r.groups.map((g) => [g.kind, g]));
  assert.equal(by.cash.gainCents, 2_000);
  assert.equal(by.roth.gainCents, 10_000);
  assert.equal(by.crypto.gainCents, 20_000);
  assert.equal(r.gainCents, 32_000);
});

test("only tax leaves: groups sum to start + gains + flow − tax", () => {
  const s = settingsWith([
    { kind: "pretax", take_annual_cents: 50_000, take_start_year: 2030, tax_pct: "20" },
    { kind: "roth", add_annual_cents: 30_000 },
  ]);
  const open = { ...emptyBalances(), cash: 10_000, pretax: 500_000, roth: 200_000, brokerage: 100_000 };
  const r = groupsYear(open, s, ctx({ flowCents: -80_000 }));
  assert.equal(sum(r.balances), sum(open) + r.gainCents - 80_000 - r.taxCents);
  assert.equal(r.taxCents >= 10_000, true);
});

test("planned withdrawals rise with inflation from this year", () => {
  const s = settingsWith([{ kind: "brokerage", take_annual_cents: 100_000, take_start_year: 2027, tax_pct: "0" }]);
  const r = groupsYear({ ...emptyBalances(), brokerage: 10_000_000 }, s, ctx({ year: 2028, inflationPct: 10 }));
  const b = r.groups.find((g) => g.kind === "brokerage");
  assert.equal(b.takeCents, 121_000);
});

test("contributions never borrow: cut back to what Cash holds", () => {
  const s = settingsWith([{ kind: "roth", add_annual_cents: 100_000 }, { kind: "brokerage", add_annual_cents: 100_000 }]);
  const r = groupsYear({ ...emptyBalances(), cash: 0 }, s, ctx({ flowCents: 50_000, year: 2027 }));
  assert.equal(r.addCents, 50_000);
  assert.equal(r.balances.cash, 0);
  assert.equal(r.shortCents, 0);
});

test("contributions stop when the group's withdrawals start (blank end)", () => {
  const s = settingsWith([{ kind: "roth", add_annual_cents: 10_000, take_annual_cents: 5_000, take_start_year: 2030 }]);
  const before = groupsYear({ ...emptyBalances(), cash: 100_000, roth: 100_000 }, s, ctx({ year: 2029 }));
  const after = groupsYear({ ...emptyBalances(), cash: 100_000, roth: 100_000 }, s, ctx({ year: 2030 }));
  assert.equal(before.addCents, 10_000);
  assert.equal(after.addCents, 0);
});

test("blank Add to stops the year before you stop working", () => {
  const s = resolveGroupSettings([{ kind: "roth", add_annual_cents: 10_000 }], {
    investReturnPct: 10,
    cashReturnPct: 2,
    measuredAddCents: zeroAdds,
    stopWorkYear: 2033,
  });
  assert.equal(s.roth.addEndYear, 2032);
  const typed = resolveGroupSettings([{ kind: "roth", add_annual_cents: 10_000, add_end_year: 2040 }], {
    investReturnPct: 10,
    cashReturnPct: 2,
    measuredAddCents: zeroAdds,
    stopWorkYear: 2033,
  });
  assert.equal(typed.roth.addEndYear, 2040);
});

test("a shortfall draws Brokerage first, grossed up for its tax, then Roth last", () => {
  const s = settingsWith([
    { kind: "brokerage", return_pct: "0", tax_pct: "20" },
    { kind: "roth", return_pct: "0" },
  ]);
  const r = groupsYear({ ...emptyBalances(), brokerage: 50_000, roth: 1_000_000 }, s, ctx({ flowCents: -80_000 }));
  const by = Object.fromEntries(r.groups.map((g) => [g.kind, g]));
  // All of brokerage (50,000 → 40,000 after tax), the rest from Roth tax-free.
  assert.equal(by.brokerage.autoCents, 50_000);
  assert.equal(by.brokerage.taxCents, 10_000);
  assert.equal(by.roth.autoCents, 40_000);
  assert.equal(r.balances.cash, 0);
  assert.equal(r.shortCents, 0);
});

test("everything gone: the shortfall is reported, not hidden", () => {
  const s = settingsWith([{ kind: "brokerage", return_pct: "0", tax_pct: "0" }]);
  const r = groupsYear({ ...emptyBalances(), brokerage: 10_000 }, s, ctx({ flowCents: -30_000 }));
  assert.equal(r.shortCents, 20_000);
});

test("RMD age: 73 for 1951–59, 75 from 1960", () => {
  assert.equal(rmdStartAge(1955), 73);
  assert.equal(rmdStartAge(1960), 75);
  assert.equal(rmdStartAge(1981), 75);
  assert.equal(rmdCents(2_460_000, 74, 1981), 0);
  assert.equal(rmdCents(2_460_000, 75, 1981), 100_000);
});

test("Pre-tax pays at least the required minimum; Roth pays none", () => {
  const s = settingsWith([{ kind: "pretax", return_pct: "0", tax_pct: "10" }]);
  const r = groupsYear({ ...emptyBalances(), pretax: 2_460_000, roth: 2_460_000 }, s, ctx({ age: 75, birthYear: 1981 }));
  const by = Object.fromEntries(r.groups.map((g) => [g.kind, g]));
  assert.equal(by.pretax.takeCents, 100_000);
  assert.equal(by.pretax.rmdExtraCents, 100_000);
  assert.equal(by.pretax.taxCents, 10_000);
  assert.equal(by.roth.takeCents, 0);
  assert.equal(r.balances.cash, 90_000);
});

test("a typed contribution replaces the plan's and still earns the return", () => {
  const s = settingsWith([{ kind: "roth", add_annual_cents: 30_000 }]);
  const open = { ...emptyBalances(), cash: 100_000, roth: 100_000 };
  const r = groupsYear(open, s, ctx({ overrides: { roth: { add: 50_000 } } }));
  const roth = r.groups.find((g) => g.kind === "roth");
  assert.equal(roth.addCents, 50_000);
  assert.equal(roth.gainCents, 10_000);
  assert.equal(roth.endCents, 160_000);
});

test("a typed withdrawal replaces the plan's; the RMD floor still applies", () => {
  const s = settingsWith([{ kind: "brokerage", take_annual_cents: 40_000 }]);
  const open = { ...emptyBalances(), brokerage: 500_000, pretax: 1_000_000 };
  const r = groupsYear(open, s, ctx({ age: 80, birthYear: 1950, overrides: { brokerage: { take: 10_000 }, pretax: { take: 0 } } }));
  const by = Object.fromEntries(r.groups.map((g) => [g.kind, g]));
  assert.equal(by.brokerage.takeCents, 10_000);
  assert.equal(by.pretax.takeCents, rmdCents(1_000_000, 80, 1950));
});

test("typed figures carry forward; withdrawals grow with inflation, contributions stay flat", () => {
  const map = resolveOverrides(
    [
      { year: 2030, typed: { roth: { add: 20_000, take: 10_000 } } },
      { year: 2031, typed: {} },
      { year: 2032, typed: { roth: { add: 5_000 } } },
    ],
    10,
  );
  assert.deepEqual(map.get(2031).roth, { add: 20_000, addFrom: 2030, take: 11_000, takeFrom: 2030 });
  assert.deepEqual(map.get(2032).roth, { add: 5_000, addFrom: 2032, take: 12_100, takeFrom: 2030 });
});

test("parseTypedGroups ignores cash, junk and negatives", () => {
  assert.deepEqual(parseTypedGroups({ cash: { add: 5 }, roth: { add: "100", take: -1 }, nope: { add: 1 } }), { roth: { add: 100 } });
  assert.deepEqual(parseTypedGroups(null), {});
});

test("scaleBalances keeps the mix and hits the total exactly", () => {
  const out = scaleBalances({ ...emptyBalances(), cash: 100, roth: 300 }, 1_001);
  assert.equal(sum(out), 1_001);
  assert.equal(out.roth, 751);
  const none = scaleBalances(emptyBalances(), 5_000);
  assert.equal(none.cash, 5_000);
});

test("inferGroup sorts Victor's accounts the way the plan said", () => {
  const inv = { accountKind: "investment" };
  assert.equal(inferGroup({ accountKind: "checking", accountName: "USAA" }), "cash");
  assert.equal(inferGroup({ ...inv, accountName: "TSP", accountTax: "deferred", accountRetirementKind: "elective_deferral", bucketName: "TSP Roth" }), "roth");
  assert.equal(inferGroup({ ...inv, accountName: "TSP", accountTax: "deferred", accountRetirementKind: "elective_deferral", bucketName: "TSP Traditional" }), "pretax");
  assert.equal(inferGroup({ ...inv, accountName: "Fidelity", accountTax: "taxable", bucketName: "Fidelity Roth Jo", bucketRetirementKind: "roth_ira" }), "roth");
  assert.equal(inferGroup({ ...inv, accountName: "Fidelity", accountTax: "taxable", bucketName: "Fidelity (Taxable) Vic" }), "brokerage");
  assert.equal(inferGroup({ ...inv, accountName: "Charles Schwab", accountTax: "free", accountRetirementKind: "roth_ira" }), "roth");
  assert.equal(inferGroup({ ...inv, accountName: "Crypto", accountTax: "taxable", bucketName: "Kraken" }), "crypto");
  assert.equal(inferGroup({ ...inv, accountName: "Gold/Silver", accountTax: "taxable" }), "metals");
  assert.equal(inferGroup({ ...inv, accountName: "M1", accountTax: "taxable" }), "brokerage");
});

test("a Pay line stops at its end month; none means no income", async () => {
  const { incomeForYear } = await import("../src/lib/retirement.ts");
  const pay = { id: "p", name: "Pay", kind: "pay", monthlyCents: 1_000_000, startYear: null, startMonth: null, endYear: 2033, endMonth: 10, taxable: true };
  assert.equal(incomeForYear(2033, null, null, [pay], 0).afterTaxCents, 10_000_000);
  assert.equal(incomeForYear(2034, null, null, [pay], 0).afterTaxCents, 0);
  assert.equal(incomeForYear(2034, null, null, [], 0).afterTaxCents, 0);
});

// payStop/withPayEnds were removed on 2026-10-17: a blank end now means the
// line never stops — no end is guessed from a retirement year.
test("a blank Pay end never stops the line", async () => {
  const { incomeForYear } = await import("../src/lib/retirement.ts");
  const pay = { id: "p", name: "Pay", kind: "pay", monthlyCents: 1_000_000, startYear: null, startMonth: null, endYear: null, endMonth: null, taxable: true };
  assert.equal(incomeForYear(2034, null, 2033, [pay], 0).afterTaxCents, 12_000_000);
  assert.equal(incomeForYear(2060, null, 2033, [pay], 0).afterTaxCents, 12_000_000);
});

test("Pay rises by its raise each January after this year", async () => {
  const { incomeForYear } = await import("../src/lib/retirement.ts");
  const pay = { id: "p", name: "Pay", kind: "pay", monthlyCents: 1_000_000, startYear: null, startMonth: null, endYear: null, endMonth: null, raisePct: 10, taxable: true };
  const when = { thisYear: 2026, birthYear: null };
  assert.equal(incomeForYear(2026, null, null, [pay], 0, undefined, when).afterTaxCents, 12_000_000);
  assert.equal(incomeForYear(2028, null, null, [pay], 0, undefined, when).afterTaxCents, 14_520_000);
});

test("a typed return % carries forward and drives the gain", async () => {
  const { parseTypedGroups, resolveOverrides } = await import("../src/lib/account-groups.ts");
  const typed = parseTypedGroups({ crypto: { ret: 0 }, cash: { ret: 99, add: 5 } });
  assert.deepEqual(typed, { crypto: { ret: 0 }, cash: { ret: 30 } });
  const by = resolveOverrides(
    [
      { year: 2027, typed },
      { year: 2028, typed: {} },
      { year: 2029, typed: { crypto: { ret: 4 } } },
    ],
    2.5,
  );
  assert.deepEqual(by.get(2028).crypto, { ret: 0, retFrom: 2027 });
  assert.deepEqual(by.get(2029).crypto, { ret: 4, retFrom: 2029 });
});

test("group account lists name a whole bucketed account's buckets", async () => {
  const { groupAccountNames } = await import("../src/lib/account-groups.ts");
  const slots = [
    { accountId: "c", bucketId: "k", name: "Crypto · Kraken", accountName: "Crypto", group: "crypto" },
    { accountId: "c", bucketId: "r", name: "Crypto · River", accountName: "Crypto", group: "crypto" },
    { accountId: "t", bucketId: "1", name: "TSP Roth", accountName: "TSP", group: "roth" },
    { accountId: "t", bucketId: "2", name: "TSP Traditional", accountName: "TSP", group: "pretax" },
    { accountId: "s", bucketId: null, name: "Charles Schwab", accountName: "Charles Schwab", group: "roth" },
  ];
  assert.deepEqual(groupAccountNames(slots, (x) => x.group === "crypto"), ["Crypto (Kraken, River)"]);
  assert.deepEqual(groupAccountNames(slots, (x) => x.group === "roth"), ["TSP Roth", "Charles Schwab"]);
});

test("a typed Est. Withdraw total is spread across investments by balance and carries forward", async () => {
  const { groupsYear, resolveGroupSettings, resolveOverrides, emptyBalances } = await import("../src/lib/account-groups.ts");
  const settings = resolveGroupSettings([], { investReturnPct: 0, cashReturnPct: 0, measuredAddCents: emptyBalances() });
  const opening = { ...emptyBalances(), cash: 0, brokerage: 30_000_00, crypto: 10_000_00, roth: 100_000_00 };
  const by = resolveOverrides([{ year: 2040, typed: {}, withdraw: { cents: 35_000_00 } }, { year: 2041, typed: {} }], 0);
  assert.deepEqual(by.get(2041).withdraw, { cents: 35_000_00, from: 2040 });
  const r = groupsYear(opening, settings, {
    year: 2040, thisYear: 2026, inflationPct: 0, flowCents: 0, age: 59, birthYear: 1981, overrides: by.get(2040),
  });
  const take = Object.fromEntries(r.groups.map((g) => [g.kind, g.takeCents]));
  // $35,000 over $140,000 invested = 25% of each group.
  assert.equal(take.brokerage, 7_500_00);
  assert.equal(take.crypto, 2_500_00);
  assert.equal(take.roth, 25_000_00);
});

test("a typed withdraw % follows the 4% rule: % of investments that year, then dollars + inflation", async () => {
  const { groupsYear, resolveGroupSettings, resolveOverrides, emptyBalances, parseTypedWithdraw, pctWithdrawCarrier } = await import("../src/lib/account-groups.ts");
  assert.deepEqual(parseTypedWithdraw({ withdrawPct: 3 }), { pct: 3 });
  assert.deepEqual(parseTypedWithdraw({ withdraw: 100 }), { cents: 100 });
  const by = resolveOverrides(
    [
      { year: 2038, typed: {}, withdraw: { cents: 30_000_00 } },
      { year: 2040, typed: {}, withdraw: { pct: 3 } },
      { year: 2041, typed: {} },
    ],
    2.5,
  );
  assert.deepEqual(by.get(2041).withdraw, { pct: 3, from: 2040 });
  const settings = resolveGroupSettings([], { investReturnPct: 0, cashReturnPct: 0, measuredAddCents: emptyBalances() });
  const carry = pctWithdrawCarrier(2.5);
  // 2040: $100k cash is NOT counted — 3% of the $400k invested = $12,000.
  const o2040 = carry(2040, { ...emptyBalances(), cash: 100_000_00, brokerage: 400_000_00 }, by.get(2040));
  assert.equal(o2040.withdraw.cents, 12_000_00);
  const r = groupsYear({ ...emptyBalances(), cash: 100_000_00, brokerage: 400_000_00 }, settings, {
    year: 2040, thisYear: 2026, inflationPct: 2.5, flowCents: 0, age: 59, birthYear: 1981, overrides: o2040,
  });
  assert.equal(r.groups.find((g) => g.kind === "brokerage").takeCents, 12_000_00);
  // 2041: the same dollars + 2.5%, whatever the balance did.
  const o2041 = carry(2041, { ...emptyBalances(), brokerage: 900_000_00 }, by.get(2041));
  assert.equal(o2041.withdraw.cents, 12_300_00);
});

test("a typed Proj Withdraw % takes that share of the group's start and carries forward", async () => {
  const { groupsYear, resolveGroupSettings, resolveOverrides, emptyBalances, parseTypedGroups } = await import("../src/lib/account-groups.ts");
  assert.deepEqual(parseTypedGroups({ roth: { takePct: 4 }, cash: { takePct: 4 } }), { roth: { takePct: 4 } });
  const by = resolveOverrides([{ year: 2040, typed: { roth: { takePct: 4 } } }, { year: 2041, typed: {} }], 2.5);
  assert.deepEqual(by.get(2040).roth, { takePct: 4, takeFrom: 2040 });
  assert.deepEqual(by.get(2041).roth, { takePct: 4, takeFrom: 2040 }); // carries
  const settings = resolveGroupSettings([], { investReturnPct: 0, cashReturnPct: 0, measuredAddCents: emptyBalances() });
  const r = groupsYear({ ...emptyBalances(), roth: 500_000_00, brokerage: 100_000_00 }, settings, {
    year: 2040, thisYear: 2026, inflationPct: 2.5, flowCents: 0, age: 59, birthYear: 1981, overrides: by.get(2040),
  });
  const take = Object.fromEntries(r.groups.map((g) => [g.kind, g.takeCents]));
  assert.equal(take.roth, 20_000_00); // 4% of Roth's $500,000
  assert.equal(take.brokerage, 0);
});

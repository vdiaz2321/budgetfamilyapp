import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyBalances,
  groupsYear,
  inferGroup,
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

test("blank Pay end follows military retirement, else withdrawals start", async () => {
  const { incomeForYear, payStop, withPayEnds } = await import("../src/lib/retirement.ts");
  const pay = { id: "p", name: "Pay", kind: "pay", monthlyCents: 1_000_000, startYear: null, startMonth: null, endYear: null, endMonth: null, taxable: true };
  assert.deepEqual(payStop(2033, 11, null), { endYear: 2033, endMonth: 10, why: "military" });
  assert.deepEqual(payStop(2030, null, 2040), { endYear: 2029, endMonth: 12, why: "military" });
  assert.deepEqual(payStop(null, null, 2034), { endYear: 2033, endMonth: 12, why: "withdrawals" });
  assert.equal(payStop(null, null, null), null);
  const lines = withPayEnds([pay], payStop(2033, 11, null));
  assert.equal(incomeForYear(2033, null, null, lines, 0).afterTaxCents, 10_000_000);
  assert.equal(incomeForYear(2034, null, null, lines, 0).afterTaxCents, 0);
  // A typed end wins over the retirement date.
  const typed = withPayEnds([{ ...pay, endYear: 2030, endMonth: 6 }], payStop(2033, 11, null));
  assert.equal(typed[0].endYear, 2030);
});

test("Pay rises by its raise each January after this year", async () => {
  const { incomeForYear } = await import("../src/lib/retirement.ts");
  const pay = { id: "p", name: "Pay", kind: "pay", monthlyCents: 1_000_000, startYear: null, startMonth: null, endYear: null, endMonth: null, raisePct: 10, taxable: true };
  const when = { thisYear: 2026, birthYear: null };
  assert.equal(incomeForYear(2026, null, null, [pay], 0, undefined, when).afterTaxCents, 12_000_000);
  assert.equal(incomeForYear(2028, null, null, [pay], 0, undefined, when).afterTaxCents, 14_520_000);
});

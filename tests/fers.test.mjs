// The GS pension (src/lib/fers.ts) across the career shapes a household can
// have: GS only, GS after the military, a spouse's GS career, too few years.
// Amounts checked by hand against OPM's computation rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFers, estimateFers } from "../src/lib/fers.ts";

const career = (startYear, endYear, extra = {}) => ({
  owner: "self",
  gsStartYear: startYear,
  gsStartMonth: null,
  gsEndYear: endYear,
  gsEndMonth: null,
  high3AnnualCents: 100_000_00,
  survivorPct: 0,
  startEarly: false,
  ...extra,
});

test("GS only, leaving at 63 with 18 years: 62+5, 1% a year, no supplement", () => {
  const e = estimateFers(career(2026, 2043), 1981);
  assert.equal(e.path, "62+5");
  assert.equal(e.annualCents, 18_000_00);
  assert.equal(e.startYear, 2044);
  assert.equal(e.supplement, false);
});

test("leaving at 62+ with 20+ years earns 1.1%", () => {
  const e = estimateFers(career(2023, 2043), 1981); // 21 years, leaves at 63
  assert.equal(e.multiplierPct, 1.1);
  assert.equal(e.annualCents, 23_100_00);
});

test("spouse, 40 years leaving at 61: 60+20 with supplement; 50% survivor costs 10%", () => {
  const e = estimateFers(career(2010, 2049, { owner: "spouse", survivorPct: 50 }), 1989);
  assert.equal(e.path, "60+20");
  assert.equal(e.supplement, true);
  assert.equal(e.grossAnnualCents, 40_000_00);
  assert.equal(e.annualCents, 36_000_00);
  assert.equal(e.survivorAnnualCents, 20_000_00);
});

test("10 years leaving at 59: waits for 62 uncut, or starts now 15% cut", () => {
  const wait = estimateFers(career(2030, 2039), 1981);
  assert.equal(wait.path, "MRA+10");
  assert.equal(wait.startYear, 2043);
  assert.equal(wait.annualCents, 10_000_00);
  const early = estimateFers(career(2030, 2039, { startEarly: true }), 1981);
  assert.equal(early.startYear, 2040);
  assert.equal(early.reductionPct, 15);
  assert.equal(early.annualCents, 8_500_00);
});

test("7 years leaving at 52: deferred to 62", () => {
  const e = estimateFers(career(2026, 2032), 1981);
  assert.equal(e.path, "deferred");
  assert.equal(e.startYear, 2043);
  assert.equal(e.annualCents, 7_000_00);
});

test("under 5 years: no pension, and the line is dropped from the plan", () => {
  assert.equal(estimateFers(career(2026, 2029), 1981).path, null);
  const line = { id: "f", kind: "fers", name: "GS pension", owner: "self", startYear: 2026, startMonth: null, endYear: 2029, endMonth: null, annualCents: 100_000_00, monthlyCents: 0 };
  assert.equal(applyFers([line], { birthYear: 1981, spouseBirthYear: null }).length, 0);
});

test("applyFers: pension paid from its start; supplement from SS until 62", () => {
  const fers = { id: "f", kind: "fers", name: "GS pension", owner: "self", startYear: 2001, startMonth: null, endYear: 2040, endMonth: null, annualCents: 100_000_00, monthlyCents: 0 };
  const ss = { id: "s", kind: "social_security", name: "SS", piaCents: 3_000_00, monthlyCents: 3_000_00 };
  const out = applyFers([fers, ss], { birthYear: 1981, spouseBirthYear: null });
  const pension = out.find((l) => l.id === "f");
  assert.equal(pension.annualCents, 40_000_00);
  assert.equal(pension.startYear, 2041);
  assert.equal(pension.endYear, null);
  const sup = out.find((l) => l.fersSupplement);
  assert.equal(sup.monthlyCents, 2_100_00); // 3,000 × 70% × 40 ÷ 40
  assert.equal(sup.endYear, 2042);
});

test("a spouse's pension uses the spouse's birth year", () => {
  const line = { id: "f", kind: "fers", name: "Spouse's GS pension", owner: "spouse", startYear: 2026, startMonth: null, endYear: 2043, endMonth: null, annualCents: 100_000_00, monthlyCents: 0 };
  const [p] = applyFers([line], { birthYear: 1981, spouseBirthYear: 1989 });
  // Spouse leaves at 55 with 18 years: under the MRA, so deferred to 62 (2051).
  assert.equal(p.startYear, 2051);
  assert.equal(p.annualCents, 18_000_00);
});

test("spouse's supplement: their own SS at 62 × GS years ÷ 40, until their 62", () => {
  // Born 1989, 2010–2049 (40 yrs), leaves at 61: 60+20 with the supplement.
  const line = { id: "f", kind: "fers", name: "Spouse's GS pension", owner: "spouse", startYear: 2010, startMonth: null, endYear: 2049, endMonth: null, annualCents: 100_000_00, monthlyCents: 0, piaCents: 1_800_00 };
  const out = applyFers([line], { birthYear: 1981, spouseBirthYear: 1989 });
  const sup = out.find((l) => l.fersSupplement);
  assert.equal(sup.monthlyCents, 1_800_00);
  assert.equal(sup.startYear, 2050);
  assert.equal(sup.endYear, 2050); // through Dec of the year they turn 61
  // Without their SS at 62 there's no supplement line.
  const none = applyFers([{ ...line, piaCents: null }], { birthYear: 1981, spouseBirthYear: 1989 });
  assert.equal(none.some((l) => l.fersSupplement), false);
});

// Social Security from the SSA statement and, for a death before 62, the
// earnings record (src/lib/ssa.ts). Synthetic workers only: no real record in
// the repo. Survivor PIAs checked by hand against the 2026 PIA formula
// (ssa.gov/oact/cola/piaformula.html).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySsRecord, recordDeathPia, spousalFactor, statementBenefitCents } from "../src/lib/ssa.ts";

const rec = (earnings, birthMonth = 6, retirementByAge = null) => ({
  birthMonth,
  earnings: Object.entries(earnings).map(([year, dollars]) => ({ year: Number(year), cents: dollars * 100 })),
  statement: retirementByAge
    ? { statementDate: "2026-10-22", retirementByAge, disabilityCents: null, survivors: null, assumedEarningsCents: null }
    : null,
});

test("death before 62: computation years, AIME and the 2026 bend points", () => {
  // Born 1996, dies 2026: elapsed 2019–2025 = 8 years − 5 dropouts = 3.
  // 2024 is the indexing year, so nothing is indexed: AIME = 180,000 / 36 = 5,000.
  // PIA = 0.9 × 1,286 + 0.32 × (5,000 − 1,286) = 2,345.88 → 2,345.80.
  // Family max = 1.5 × 1,643 + 2.72 × (2,345.80 − 1,643) = 4,376.12 → 4,376.10.
  const r = recordDeathPia(rec({ 2024: 60000, 2025: 60000, 2026: 60000 }), 1996, 2026, 2026);
  assert.deepEqual(r, { piaCents: 234580, familyMaxCents: 437610 });
});

test("a later death counts more years of earnings", () => {
  const r = rec({ 2020: 50000, 2021: 52000, 2022: 54000, 2023: 56000, 2024: 58000, 2025: 60000, 2026: 62000, 2027: 64000, 2028: 66000 });
  const early = recordDeathPia(r, 1990, 2026, 2026);
  const later = recordDeathPia(r, 1990, 2028, 2026);
  assert.ok(later.piaCents > early.piaCents);
  assert.equal(recordDeathPia(r, 1960, 2026, 2026), null, "62 or older: the retirement PIA applies");
});

test("spousal factors", () => {
  assert.equal(Math.round(spousalFactor(60) * 1000), 650); // spouse at 62
  assert.equal(spousalFactor(0), 1);
});

test("statement figures: by age, held to 62–70, none when missing", () => {
  const r = rec({ 2025: 90000 }, 3, { 62: 212700, 67: 312600, 70: 393600 });
  assert.equal(statementBenefitCents(r, 67), 312600);
  assert.equal(statementBenefitCents(r, 75), 393600, "past 70 reads the age-70 figure");
  assert.equal(statementBenefitCents(r, 65), null, "an age the statement doesn't have");
  assert.equal(statementBenefitCents(rec({ 2025: 90000 }), 67), null, "no statement");
});

test("applySsRecord: his line is the statement's figure at his start age, a spousal line from the age-67 one", () => {
  const lines = [
    { id: "ss", name: "Social Security", kind: "social_security", monthlyCents: 274100, startYear: 2048, startMonth: 3, endYear: null, taxable: true },
    { id: "va", name: "VA", kind: "va", monthlyCents: 73000, startYear: null, startMonth: null, endYear: null, taxable: false },
  ];
  const plan = { birthYear: 1981, spouseBirthYear: 1989, spouseClaimAge: 62, thisYear: 2026 };
  const out = applySsRecord(lines, rec({ 2025: 93368 }, 3, { 62: 212700, 67: 312600, 70: 393600 }), plan);
  const his = out.find((l) => l.id === "ss");
  assert.equal(his.fromRecord, true);
  assert.equal(his.monthlyCents, 312600, "starts 2048 = age 67: the statement's at-67 figure");
  assert.equal(his.piaCents, 312600);
  const sp = out.find((l) => l.spousal);
  assert.equal(sp.startYear, 2051); // her 62, after his 2048 start
  assert.equal(sp.monthlyCents, Math.floor((312600 / 200) * 0.65) * 100);
  assert.equal(out.find((l) => l.id === "va").monthlyCents, 73000, "other lines untouched");
  // A start at 70 reads the age-70 figure.
  const at70 = applySsRecord([{ ...lines[0], startYear: 2051 }], rec({ 2025: 93368 }, 3, { 62: 212700, 67: 312600, 70: 393600 }), plan);
  assert.equal(at70[0].monthlyCents, 393600);
  // No record, or a statement without his start age: the typed line stands.
  assert.equal(applySsRecord(lines, null, plan), lines);
  assert.equal(applySsRecord(lines, rec({ 2025: 93368 }, 3), plan), lines);
});

test("statement Social Security rises with COLA from this year; a typed line from its start", async () => {
  const { lineColaBase } = await import("../src/lib/retirement.ts");
  const cola = { pct: 2.5, byYear: {}, military: true, va: true, socialSecurity: true };
  const when = { thisYear: 2026, birthYear: 1981 };
  const line = { id: "ss", name: "SS", kind: "social_security", monthlyCents: 312600, startYear: 2048, startMonth: 3, endYear: null, taxable: true };
  assert.equal(lineColaBase({ ...line, fromRecord: true }, cola, when), 2026, "statement figures are today's dollars");
  assert.equal(lineColaBase(line, cola, when), 2048, "a typed amount is the start-year payment");
  // The spousal line, half of a statement figure, follows the statement.
  const out = applySsRecord([line], rec({ 2025: 93368 }, 3, { 67: 312600 }), { birthYear: 1981, spouseBirthYear: 1989, spouseClaimAge: 67, thisYear: 2026 });
  assert.ok(out.every((l) => l.fromRecord));
});

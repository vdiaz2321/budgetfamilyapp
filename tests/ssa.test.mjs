// Social Security from the earnings record (src/lib/ssa.ts). Synthetic
// workers only: no real record in the repo. Checked by hand against the
// 2026 PIA formula (ssa.gov/oact/cola/piaformula.html).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySsRecord,
  benefitAtStartCents,
  recordDeathPia,
  recordRetirementPiaCents,
  spousalFactor,
  workerFactor,
} from "../src/lib/ssa.ts";

const rec = (earnings, birthMonth = 6) => ({
  birthMonth,
  earnings: Object.entries(earnings).map(([year, dollars]) => ({ year: Number(year), cents: dollars * 100 })),
  statement: null,
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

test("earnings that stop early lower the retirement PIA", () => {
  const working = {};
  for (let y = 2000; y <= 2040; y++) working[y] = 80000;
  const stopping = {};
  for (let y = 2000; y <= 2030; y++) stopping[y] = 80000;
  const a = recordRetirementPiaCents(rec(working), 1978, 2045, 2026);
  const b = recordRetirementPiaCents(rec(stopping), 1978, 2045, 2026);
  assert.ok(b < a);
});

test("claiming factors", () => {
  assert.equal(Math.round(workerFactor(-60) * 1000), 700); // 62 with full retirement at 67
  assert.equal(Math.round(workerFactor(36) * 100), 124); // 70
  assert.equal(Math.round(spousalFactor(60) * 1000), 650); // spouse at 62
  assert.equal(spousalFactor(0), 1);
  // Born June: 62 starts in July (the month after the birthday), 59 months early.
  assert.equal(benefitAtStartCents(200000, 1980, 6, 2042, 7), Math.floor(2000 * (1 - 36 * 5 / 900 - 23 * 5 / 1200)) * 100);
});

test("applySsRecord: his line from the record, a spousal line that starts after his", () => {
  const earnings = {};
  for (let y = 2000; y <= 2033; y++) earnings[y] = 90000;
  const lines = [
    { id: "ss", name: "Social Security", kind: "social_security", monthlyCents: 300000, startYear: 2048, startMonth: 3, endYear: null, taxable: true },
    { id: "va", name: "VA", kind: "va", monthlyCents: 73000, startYear: null, startMonth: null, endYear: null, taxable: false },
  ];
  const out = applySsRecord(lines, rec(earnings, 3), { birthYear: 1981, spouseBirthYear: 1989, spouseClaimAge: 62, thisYear: 2026 });
  const his = out.find((l) => l.id === "ss");
  assert.equal(his.fromRecord, true);
  assert.equal(his.monthlyCents, his.piaCents - (his.piaCents % 100), "at 67 the benefit is the PIA, to the dollar");
  const sp = out.find((l) => l.spousal);
  assert.equal(sp.startYear, 2051); // her 62, after his 2048 start
  assert.equal(sp.monthlyCents, Math.floor((his.piaCents / 200) * 0.65) * 100);
  assert.equal(out.find((l) => l.id === "va").monthlyCents, 73000, "other lines untouched");
  assert.equal(applySsRecord(lines, null, { birthYear: 1981, spouseBirthYear: 1989, spouseClaimAge: 62, thisYear: 2026 }), lines);
});

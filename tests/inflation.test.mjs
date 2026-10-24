import { test } from "node:test";
import assert from "node:assert/strict";

const { inflationGrowth, inflationIn, recordInflationChange } = await import("../src/lib/inflation.ts");
const { inflatedSpending } = await import("../src/lib/retirement.ts");

test("a rate changed in 2030 moves only 2030 on", () => {
  const history = recordInflationChange([], 2.5, 3.4, 2030);
  assert.deepEqual(history, [{ until: 2029, pct: 2.5 }]);
  const infl = { pct: 3.4, history };
  assert.equal(inflationIn(2029, infl), 2.5);
  assert.equal(inflationIn(2030, infl), 3.4);
  // 2026 → 2031: 2027–2029 at 2.5%, 2030–2031 at 3.4%.
  const f = inflationGrowth(2026, 2031, infl);
  assert.ok(Math.abs(f - 1.025 ** 3 * 1.034 ** 2) < 1e-12);
  // A second change the same year adds nothing.
  assert.deepEqual(recordInflationChange(history, 3.4, 3.0, 2030), history);
  // A later change keeps 3.4% for the years between.
  const later = recordInflationChange(history, 3.4, 3.0, 2033);
  assert.equal(inflationIn(2031, { pct: 3.0, history: later }), 3.4);
  assert.equal(inflationIn(2033, { pct: 3.0, history: later }), 3.0);
});

test("carried spending keeps its rise after New Year", () => {
  const rows = [2026, 2027, 2028].map((year) => ({ year, baseSpendingCents: 80_000_00 }));
  // Seen in 2026 and again in 2027, 2027 is the same $82,000.
  assert.equal(inflatedSpending(rows, 2026, 2.5).get(2027), 82_000_00);
  assert.equal(inflatedSpending(rows, 2027, 2.5).get(2027), 82_000_00);
  assert.equal(inflatedSpending(rows, 2027, 2.5).get(2028), 84_050_00);
});

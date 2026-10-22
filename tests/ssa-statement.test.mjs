import assert from "node:assert/strict";
import test from "node:test";
import { earningsByYear, parseSsaStatementText } from "../src/lib/ssa-statement.ts";

// Synthetic statement — invented person and numbers, same layout as the
// online Form SSA-7005-SM-OL text. Never paste a real statement here.
const FIXTURE = `Your Social Security Statement
JOHN Q PUBLIC
October 22, 2026
Retirement Benefits
You have earned enough credits to qualify for retirement benefits. Your full retirement age is 67, based on your date of
birth: May 3, 1980. As shown in the chart, you can start as early as 62.
These personalized estimates are based on your
earnings to date and assume you continue to earn
$80,000 per year until you start your benefits. Estimates may change.
Disability Benefits
You have earned enough credits. If you became disabled right now and you
have enough recent work, your monthly payment would
be about $2,500. Learn more at ssa.gov/disability.
Survivors Benefits
If you die this year, certain members of your family may qualify. Estimates include:
Minor child: $2,000
Spouse, if caring for a disabled child or child
younger than age 16: $2,010
Spouse, if benefits start at full retirement age: $2,700
Total family benefits cannot be more than: $4,900
Your spouse or minor child may be eligible for an
additional one-time death benefit of $255. Learn more.
Personalized Monthly Retirement Benefit Estimates
(Depending on the Age You Start)
Age Retirement Benefits Start
Monthly Benefit Amount
62 $2,000
63 $2,150
64 $2,300
65 $2,500
66 $2,700
67 $2,900
68 $3,100
69 $3,400
70 $3,700
Earnings Record
Review your earnings history below.
Work Year
Earnings
Taxed for
Social Security
Earnings Taxed
for Medicare
(began 1966)
1991-2000 $20,000 $20,000
2001-2005 $100,001 $100,001
2006 $50,000 $50,000
2007 $52,000 $61,000
2008 $54,000 $54,000
2025 $90,000 $90,000
2026 Not yet recorded Not yet recorded
Taxes Paid
Estimated taxes paid for Social Security: You paid: $40,000 Your employers paid: $40,000
`;

test("reads every field from the online statement layout", () => {
  const s = parseSsaStatementText(FIXTURE);
  assert.ok(s);
  assert.equal(s.statementDate, "2026-10-22");
  assert.equal(s.birthYear, 1980);
  assert.equal(s.birthMonth, 5);
  assert.deepEqual(s.retirementByAge, {
    62: 200_000, 63: 215_000, 64: 230_000, 65: 250_000, 66: 270_000,
    67: 290_000, 68: 310_000, 69: 340_000, 70: 370_000,
  });
  assert.equal(s.disabilityCents, 250_000);
  assert.equal(s.assumedEarningsCents, 8_000_000);
  assert.deepEqual(s.survivors, {
    childCents: 200_000,
    caregiverCents: 201_000, // label broken across lines: "child\nyounger than age 16"
    spouseAtFraCents: 270_000,
    familyMaxCents: 490_000,
  });
  // Social Security column only; "Not yet recorded" skipped; taxes-paid amounts ignored.
  assert.deepEqual(s.earnings, [
    { from: 1991, to: 2000, cents: 2_000_000 },
    { from: 2001, to: 2005, cents: 10_000_100 },
    { from: 2006, to: 2006, cents: 5_000_000 },
    { from: 2007, to: 2007, cents: 5_200_000 },
    { from: 2008, to: 2008, cents: 5_400_000 },
    { from: 2025, to: 2025, cents: 9_000_000 },
  ]);
  // The one-time $255 death benefit never shows up anywhere.
  assert.ok(!JSON.stringify(s).includes("25500"));
  // The name is not returned.
  assert.ok(!JSON.stringify(s).toLowerCase().includes("public"));
});

test("tolerates different whitespace from other PDF extractors", () => {
  const squashed = FIXTURE.replace(/\n/g, " ").replace(/ \$/g, "  $");
  const s = parseSsaStatementText(squashed);
  assert.ok(s);
  assert.equal(s.survivors?.caregiverCents, 201_000);
  assert.equal(s.retirementByAge[70], 370_000);
  assert.equal(s.earnings.length, 6);
});

test("combined ranges split evenly, cent-exact, remainder on the last year", () => {
  const s = parseSsaStatementText(FIXTURE);
  assert.ok(s);
  const rows = earningsByYear(s);
  const range = rows.filter((r) => r.year >= 1991 && r.year <= 2000);
  assert.equal(range.length, 10);
  assert.ok(range.every((r) => r.split));
  assert.ok(range.every((r) => r.cents === 200_000));

  const odd = rows.filter((r) => r.year >= 2001 && r.year <= 2005);
  assert.deepEqual(odd.map((r) => r.cents), [2_000_020, 2_000_020, 2_000_020, 2_000_020, 2_000_020]);
  assert.equal(odd.reduce((a, r) => a + r.cents, 0), 10_000_100);

  const uneven = earningsByYear({ ...s, earnings: [{ from: 2001, to: 2003, cents: 100 }] });
  assert.deepEqual(uneven, [
    { year: 2001, cents: 33, split: true },
    { year: 2002, cents: 33, split: true },
    { year: 2003, cents: 34, split: true },
  ]);

  const single = rows.find((r) => r.year === 2006);
  assert.deepEqual(single, { year: 2006, cents: 5_000_000, split: false });
  assert.equal(rows.length, 10 + 5 + 4);
  assert.equal(
    rows.reduce((a, r) => a + r.cents, 0),
    s.earnings.reduce((a, r) => a + r.cents, 0),
  );
});

test("returns null for text that is not an SSA statement", () => {
  assert.equal(parseSsaStatementText(""), null);
  assert.equal(parseSsaStatementText("Grocery receipt\nMilk $3.49\nTotal $12.00"), null);
  assert.equal(
    parseSsaStatementText("Vanguard Annual Statement\nOctober 1, 2026\n62 $2,000\n2006 $50,000"),
    null,
  );
});

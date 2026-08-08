import assert from "node:assert/strict";
import test from "node:test";
import { projectSnowball } from "../src/lib/snowball.ts";

test("zero-interest payoff reaches zero on schedule", () => {
  const result = projectSnowball(
    [{ id: "loan", balanceCents: 100_000, minCents: 10_000, apr: 0 }],
    0,
    "2026-08-01",
    24,
    true,
  );
  assert.equal(result.ledger.get("loan")?.length, 10);
  assert.equal(result.ledger.get("loan")?.at(-1)?.balanceCents, 0);
  assert.equal(result.totalInterestCents.get("loan"), 0);
});

test("APR estimate splits payment into interest and principal", () => {
  const result = projectSnowball(
    [{ id: "loan", balanceCents: 1_200_000, minCents: 110_000, apr: 12 }],
    0,
    "2026-08-01",
    24,
    true,
  );
  const first = result.ledger.get("loan")?.[0];
  assert.equal(first?.interestCents, 12_000);
  assert.equal(first?.principalCents, 98_000);
  assert.equal(first?.balanceCents, 1_102_000);
});

test("one-time extra reduces payoff duration", () => {
  const base = projectSnowball(
    [{ id: "loan", balanceCents: 100_000, minCents: 10_000, apr: 0 }],
    0,
    "2026-08-01",
    24,
    true,
  );
  const boosted = projectSnowball(
    [{ id: "loan", balanceCents: 100_000, minCents: 10_000, apr: 0 }],
    0,
    "2026-08-01",
    24,
    true,
    { oneTimeMonth: "2026-08-01", oneTimeExtraCents: 20_000 },
  );
  assert.ok((boosted.ledger.get("loan")?.length ?? 99) < (base.ledger.get("loan")?.length ?? 0));
});

test("flags a payment that does not cover estimated interest", () => {
  const result = projectSnowball(
    [{ id: "card", balanceCents: 1_000_000, minCents: 5_000, apr: 24 }],
    0,
    "2026-08-01",
    12,
    true,
  );
  assert.equal(result.negativeAmortization.has("card"), true);
  assert.ok((result.ledger.get("card")?.at(-1)?.balanceCents ?? 0) > 1_000_000);
});


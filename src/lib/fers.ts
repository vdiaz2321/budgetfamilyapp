// The GS pension — the FERS basic annuity — worked out from a GS career as
// typed (Victor, 2026-10-25). Rules checked on OPM's pages on 2026-10-25:
//   eligibility  https://www.opm.gov/retirement-center/fers-information/eligibility/
//   computation  https://www.opm.gov/retirement-center/fers-information/computation/
//   supplement   https://www.opm.gov/retirement-center/fers-information/types-of-retirement/
//   COLA         https://www.opm.gov/retirement-center/my-annuity-and-benefits/annuity-payments/
//   survivor     https://www.opm.gov/retirement-center/survivor-benefits/
//
// Ages are worked out from the birth year alone (a January birthday), the
// same way the rest of the plan counts ages; a pension date can be a few
// months early for a later birthday.

import type { ColaPlan, IncomeLine } from "./retirement";

export type FersOwner = "self" | "spouse";

/** A FERS line's GS career as typed. */
export type FersInputs = {
  owner: FersOwner;
  /** First and last month in the GS job (1–12; null = Jan / Dec). */
  gsStartYear: number;
  gsStartMonth: number | null;
  gsEndYear: number;
  gsEndMonth: number | null;
  /** Expected high-3 average basic pay, per year, in the dollars of the last GS years. */
  high3AnnualCents: number;
  survivorPct: 0 | 25 | 50;
  /** 10–29 years: take the reduced annuity at the MRA instead of waiting for 62. */
  startEarly: boolean;
};

export type FersEstimate = {
  /** Whole years and months of GS service. */
  serviceYears: number;
  serviceMonths: number;
  /** Age (whole years) on leaving the GS job. */
  ageAtSeparation: number;
  /** The owner's minimum retirement age, in months. */
  mraMonths: number;
  /** null: under 5 years — no annuity. */
  path: FersPath | null;
  /** 1 or 1.1 (% of high-3 per year). */
  multiplierPct: number;
  /** The age cut on an early (MRA+10) start, % (0 when none). */
  reductionPct: number;
  /** First month paid. */
  startYear: number;
  startMonth: number;
  /** Age (whole years) when the annuity starts. */
  startAge: number;
  /** Per year after the age cut, before the survivor cut. */
  grossAnnualCents: number;
  /** Per year paid to the owner: after the age cut and the survivor cut. */
  annualCents: number;
  /** Per year to the surviving spouse: the elected share of the unreduced annuity. */
  survivorAnnualCents: number;
  /** Paid a FERS supplement until 62 (an unreduced start before 62). */
  supplement: boolean;
  /** COLAs are paid each January after this year (the year the owner turns 62, or the start if later). */
  colaFromYear: number;
  /** 10–29 years: the owner can pick an early, reduced start. */
  canStartEarly: boolean;
};

export type FersPath =
  | "62+5"
  | "60+20"
  | "MRA+30"
  | "MRA+10"
  | "deferred";

/** OPM's minimum retirement age table, in months. */
export function fersMraMonths(birthYear: number): number {
  if (birthYear < 1948) return 55 * 12;
  if (birthYear <= 1952) return 55 * 12 + (birthYear - 1947) * 2;
  if (birthYear <= 1964) return 56 * 12;
  if (birthYear <= 1969) return 56 * 12 + (birthYear - 1964) * 2;
  return 57 * 12;
}

/** "57" or "56 and 4 months". */
export function mraLabel(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} and ${m} months` : String(y);
}

const at = (year: number, month: number | null, fallback: number) => year * 12 + (month ?? fallback) - 1;

/**
 * The annuity a GS career earns. Null when the dates are missing or the end
 * is before the start.
 *  - Leaving at 62 with 5 years, 60 with 20, or the MRA with 30: paid from
 *    the next month, no cut. Before 62 that also brings the supplement.
 *  - Leaving at the MRA with 10–29 years: paid at 62 with no cut, or now
 *    with 5% off for each year under 62 (none with 20 years from 60 on).
 *  - Leaving earlier with 5+ years: deferred — paid at 62; with 10+ years at
 *    the MRA instead, cut the same way; with 20 at 60 and 30 at the MRA, uncut.
 *  - 1.1% a year instead of 1% when leaving at 62+ with 20+ years.
 */
export function estimateFers(inp: FersInputs, birthYear: number | null): FersEstimate | null {
  if (birthYear == null || !inp.high3AnnualCents) return null;
  const start = at(inp.gsStartYear, inp.gsStartMonth, 1);
  const end = at(inp.gsEndYear, inp.gsEndMonth, 12);
  if (end < start) return null;
  const service = end - start + 1;
  const birth = birthYear * 12;
  const ageAt = (m: number) => m - birth;
  const sep = end + 1; // the month after the last one worked
  const age = ageAt(sep);
  const mra = fersMraMonths(birthYear);
  const Y = 12;

  let path: FersPath | null = null;
  let begin = sep;
  let early = false;
  let supplement = false;
  if (service >= 5 * Y && age >= 62 * Y) path = "62+5";
  else if (service >= 20 * Y && age >= 60 * Y) path = "60+20";
  else if (service >= 30 * Y && age >= mra) path = "MRA+30";
  else if (service >= 10 * Y && age >= mra) {
    path = "MRA+10";
    early = inp.startEarly;
    if (!early) begin = Math.max(sep, birth + 62 * Y);
  } else if (service >= 5 * Y) {
    path = "deferred";
    if (service >= 30 * Y) begin = Math.max(sep, birth + mra);
    else if (service >= 20 * Y) begin = Math.max(sep, birth + 60 * Y);
    else if (service >= 10 * Y && inp.startEarly) {
      early = true;
      begin = Math.max(sep, birth + mra);
    } else begin = Math.max(sep, birth + 62 * Y);
  }
  if (path === "60+20" || path === "MRA+30") supplement = age < 62 * Y;

  const multiplierPct = age >= 62 * Y && service >= 20 * Y ? 1.1 : 1;
  const startAge = ageAt(begin);
  // 5/12 of 1% for each month under 62; none with 20 years from 60 on.
  const reductionPct =
    early && startAge < 62 * Y && !(service >= 20 * Y && startAge >= 60 * Y)
      ? Math.round(((62 * Y - startAge) * 5) / 12 * 100) / 100
      : 0;
  const unreduced = (inp.high3AnnualCents * multiplierPct * service) / 12 / 100;
  const gross = path ? Math.round(unreduced * (1 - reductionPct / 100)) : 0;
  // A full (50%) survivor annuity costs 10% of the annuity; a partial (25%) 5%.
  const survivorCut = inp.survivorPct === 50 ? 0.1 : inp.survivorPct === 25 ? 0.05 : 0;
  const beginYear = Math.floor(begin / 12);
  return {
    serviceYears: Math.floor(service / 12),
    serviceMonths: service % 12,
    ageAtSeparation: Math.floor(age / 12),
    mraMonths: mra,
    path,
    multiplierPct,
    reductionPct,
    startYear: beginYear,
    startMonth: (begin % 12) + 1,
    startAge: Math.floor(startAge / 12),
    grossAnnualCents: gross,
    annualCents: Math.round(gross * (1 - survivorCut)),
    survivorAnnualCents: path ? Math.round((unreduced * inp.survivorPct) / 100) : 0,
    supplement: !!path && supplement,
    colaFromYear: Math.max(beginYear, birthYear + 62),
    canStartEarly: service >= 10 * Y && service < 20 * Y && (path === "MRA+10" || path === "deferred"),
  };
}

/** FERS "diet COLA": the whole CPI rise up to 2%, 2% for a rise of 2–3%,
 *  and the rise less 1% above 3%. */
export const fersCola = (pct: number) => (pct <= 2 ? pct : pct <= 3 ? 2 : pct - 1);

/** Growth by `year` from every FERS COLA paid after `fromYear`. */
export function fersColaGrowth(cola: ColaPlan, fromYear: number, year: number): number {
  let f = 1;
  for (let y = fromYear + 1; y <= year; y++) f *= 1 + fersCola(cola.byYear[String(y)] ?? cola.pct) / 100;
  return f;
}

/** A FERS line's GS career, read off the line as stored. */
export function fersInputsOf(line: IncomeLine): FersInputs | null {
  if (line.kind !== "fers" || line.startYear == null || line.endYear == null) return null;
  return {
    owner: line.owner ?? "self",
    gsStartYear: line.startYear,
    gsStartMonth: line.startMonth,
    gsEndYear: line.endYear,
    gsEndMonth: line.endMonth ?? null,
    high3AnnualCents: line.annualCents ?? Math.round(line.monthlyCents * 12),
    survivorPct: line.survivorPct ?? 0,
    startEarly: !!line.fersStartEarly,
  };
}

/** Social Security at 62 for a full-retirement age of 67: 70% of the PIA. */
const SS_AT_62_SHARE = 0.7;

/**
 * Turns each FERS line from the GS career typed into the annuity it pays:
 * its own start month, no end, the amount after the age and survivor cuts.
 * A start before 62 with no cut also gets the FERS supplement until 62 —
 * about Social Security at 62 × GS years ÷ 40 — when that person's Social
 * Security is known (his: the line with a PIA; the spouse's: their own Social
 * Security at 62, stored in the GS line's `piaCents`). Lines that pay nothing (under
 * 5 years, or dates missing) are dropped.
 */
export function applyFers(
  lines: IncomeLine[],
  people: { birthYear: number | null; spouseBirthYear: number | null },
): IncomeLine[] {
  const out: IncomeLine[] = [];
  for (const line of lines) {
    if (line.kind !== "fers") {
      out.push(line);
      continue;
    }
    const inp = fersInputsOf(line);
    const born = inp?.owner === "spouse" ? people.spouseBirthYear : people.birthYear;
    const est = inp ? estimateFers(inp, born) : null;
    if (!inp || !est || !est.path || born == null) continue;
    out.push({
      ...line,
      monthlyCents: est.annualCents / 12,
      annualCents: est.annualCents,
      startYear: est.startYear,
      startMonth: est.startMonth,
      endYear: null,
      endMonth: null,
      raisePct: null,
      taxable: true,
      fers: est,
    });
    if (est.supplement) {
      // His: from his Social Security line's PIA. The spouse's: their own
      // Social Security at 62, typed on the GS line from their SSA statement
      // (Victor, 2026-10-26) — the plan holds no record of theirs.
      const ss = lines.find((l) => l.kind === "social_security" && !l.spousal && l.piaCents);
      const ssAt62 = inp.owner === "spouse" ? (line.piaCents ?? 0) : ss?.piaCents ? ss.piaCents * SS_AT_62_SHARE : 0;
      if (ssAt62 > 0) {
        const monthly = Math.round((ssAt62 * Math.min(est.serviceYears, 40)) / 40);
        // Paid through the month before 62.
        out.push({
          ...line,
          id: `${line.id}-supplement`,
          name: `${line.name} supplement`,
          monthlyCents: monthly,
          annualCents: null,
          startYear: est.startYear,
          startMonth: est.startMonth,
          endYear: born + 61,
          endMonth: 12,
          raisePct: null,
          taxable: true,
          fersSupplement: true,
        });
      }
    }
  }
  return out;
}

// Social Security worked out from the earnings record, the way SSA does it
// (Social Security Act §215, ssa.gov/oact/cola/piaformula.html). Checked
// against Victor's 2026-10-22 statement to the dollar (tests/ssa.test.mjs).
//
// Everything is in "today's dollars", like the SSA statement: the wage index
// is frozen at the latest one SSA's current bend points use (this year − 2),
// so a future PIA comes out at today's wage level. Future earnings are typed
// in their own year's dollars and shrunk back to today's at SS_WAGE_GROWTH.
//
// Only a type import, so Node's test runner loads it directly.
//
// Update each October from ssa.gov/oact/cola: AWI (AWI.html), bend points
// (bendpoints.html), the taxable maximum (cbb.html).

import type { IncomeLine } from "./retirement";

/** National Average Wage Index, 1951–2025 (2025 published October 2026). */
const AWI: Record<number, number> = {
  1951: 2799.16, 1952: 2973.32, 1953: 3139.44, 1954: 3155.64, 1955: 3301.44,
  1956: 3532.36, 1957: 3641.72, 1958: 3673.8, 1959: 3855.8, 1960: 4007.12,
  1961: 4086.76, 1962: 4291.4, 1963: 4396.64, 1964: 4576.32, 1965: 4658.72,
  1966: 4938.36, 1967: 5213.44, 1968: 5571.76, 1969: 5893.76, 1970: 6186.24,
  1971: 6497.08, 1972: 7133.8, 1973: 7580.16, 1974: 8030.76, 1975: 8630.92,
  1976: 9226.48, 1977: 9779.44, 1978: 10556.03, 1979: 11479.46, 1980: 12513.46,
  1981: 13773.1, 1982: 14531.34, 1983: 15239.24, 1984: 16135.07, 1985: 16822.51,
  1986: 17321.82, 1987: 18426.51, 1988: 19334.04, 1989: 20099.55, 1990: 21027.98,
  1991: 21811.6, 1992: 22935.42, 1993: 23132.67, 1994: 23753.53, 1995: 24705.66,
  1996: 25913.9, 1997: 27426.0, 1998: 28861.44, 1999: 30469.84, 2000: 32154.82,
  2001: 32921.92, 2002: 33252.09, 2003: 34064.95, 2004: 35648.55, 2005: 36952.94,
  2006: 38651.41, 2007: 40405.48, 2008: 41334.97, 2009: 40711.61, 2010: 41673.83,
  2011: 42979.61, 2012: 44321.67, 2013: 44888.16, 2014: 46481.52, 2015: 48098.63,
  2016: 48642.15, 2017: 50321.89, 2018: 52145.8, 2019: 54099.99, 2020: 55628.6,
  2021: 60575.07, 2022: 63795.13, 2023: 66621.8, 2024: 69846.57, 2025: 72800.33,
};
const LATEST_AWI_YEAR = 2025;

/** 1977's wage index and bend points, which every later year's scale from. */
const BASE_BENDS: [number, number, number, number, number] = [180, 1085, 230, 332, 433];

/** Taxable maximum by year, 1951–2027. */
const TAXABLE_MAX: Record<number, number> = (() => {
  const t: Record<number, number> = {};
  for (const [a, b, v] of [[1951, 1954, 3600], [1955, 1958, 4200], [1959, 1965, 4800], [1966, 1967, 6600], [1968, 1971, 7800]])
    for (let y = a; y <= b; y++) t[y] = v;
  return Object.assign(t, {
    1972: 9000, 1973: 10800, 1974: 13200, 1975: 14100, 1976: 15300, 1977: 16500,
    1978: 17700, 1979: 22900, 1980: 25900, 1981: 29700, 1982: 32400, 1983: 35700,
    1984: 37800, 1985: 39600, 1986: 42000, 1987: 43800, 1988: 45000, 1989: 48000,
    1990: 51300, 1991: 53400, 1992: 55500, 1993: 57600, 1994: 60600, 1995: 61200,
    1996: 62700, 1997: 65400, 1998: 68400, 1999: 72600, 2000: 76200, 2001: 80400,
    2002: 84900, 2003: 87000, 2004: 87900, 2005: 90000, 2006: 94200, 2007: 97500,
    2008: 102000, 2009: 106800, 2010: 106800, 2011: 106800, 2012: 110100,
    2013: 113700, 2014: 117000, 2015: 118500, 2016: 118500, 2017: 127200,
    2018: 128400, 2019: 132900, 2020: 137700, 2021: 142800, 2022: 147000,
    2023: 160200, 2024: 168600, 2025: 176100, 2026: 184500, 2027: 192300,
  });
})();

/** Wage growth a year, %, that shrinks a future year's earnings to today's
 *  dollars (SSA Trustees' intermediate wage assumption, about 3.5%). */
export const SS_WAGE_GROWTH = 3.5;

/** Full retirement age, born 1960 or later. */
const FRA = 67;

/** One year of the record: what SSA posted, or what's planned. */
export type SsEarningsRow = {
  year: number;
  cents: number;
  /** Spread evenly out of a combined range on the statement ("1991-2000"). */
  split?: boolean;
};

/** The statement's own figures, kept to compare the calculator against. */
export type SsStatementFigures = {
  statementDate: string;
  retirementByAge: Record<string, number>;
  disabilityCents: number | null;
  survivors: { childCents: number; caregiverCents: number; spouseAtFraCents: number; familyMaxCents: number } | null;
  assumedEarningsCents: number | null;
};

export type SsRecord = {
  /** Birth month (1–12); null = January. Only claiming-age months use it. */
  birthMonth: number | null;
  earnings: SsEarningsRow[];
  statement: SsStatementFigures | null;
};

/** A stored `earnings` jsonb, with anything malformed dropped, sorted by year. */
export function parseSsEarnings(raw: unknown): SsEarningsRow[] {
  if (!Array.isArray(raw)) return [];
  const byYear = new Map<number, SsEarningsRow>();
  for (const r of raw) {
    const year = Number(r?.year);
    const cents = Number(r?.cents);
    if (!Number.isInteger(year) || year < 1937 || year > 2100 || !Number.isFinite(cents) || cents < 0) continue;
    byYear.set(year, { year, cents: Math.round(cents), ...(r?.split ? { split: true } : {}) });
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** A `social_security_records` row as the plan uses it; null = none saved. */
export function toSsRecord(row: { birth_month?: number | null; earnings?: unknown; statement?: unknown } | null | undefined): SsRecord | null {
  if (!row) return null;
  const earnings = parseSsEarnings(row.earnings);
  if (earnings.length === 0) return null;
  const st = row.statement as SsStatementFigures | null | undefined;
  return {
    birthMonth: row.birth_month ?? null,
    earnings,
    statement: st && typeof st === "object" && typeof st.statementDate === "string" ? st : null,
  };
}

// ---- the formula --------------------------------------------------------

/** PIA and family max round down to the dime, AIME to the dollar. */
const floorDime = (x: number) => Math.floor(x * 10 + 1e-7) / 10;

/** The wage index frozen at `freeze`: years after it count at face value. */
const awi = (year: number, freeze: number) => AWI[Math.min(year, freeze)];

/** [PIA bend 1, PIA bend 2, family bends 1–3] for an eligibility year. */
function bendPoints(eligYear: number, freeze: number): number[] {
  const r = awi(Math.min(eligYear - 2, freeze), freeze) / AWI[1977];
  return BASE_BENDS.map((b) => Math.round(b * r));
}

/** The taxable maximum, from the same frozen index past the table. */
function taxableMax(year: number, freeze: number): number {
  if (TAXABLE_MAX[year] && year - 2 <= freeze) return TAXABLE_MAX[year];
  return Math.round((60600 * awi(year - 2, freeze)) / AWI[1992] / 300) * 300;
}

/** Retirement and survivor family maximum: 150/272/134/175% of the PIA's slices. */
function familyMaxOf(pia: number, f: number[]): number {
  const [f1, f2, f3] = f;
  return floorDime(
    1.5 * Math.min(pia, f1) + 2.72 * Math.max(0, Math.min(pia, f2) - f1) +
      1.34 * Math.max(0, Math.min(pia, f3) - f2) + 1.75 * Math.max(0, pia - f3),
  );
}

/** The PIA (dollars, to the dime) from earnings by year (dollars): index each
 *  year to eligibility − 2, keep the top `compYears`, average them a month. */
function computePia(earnings: Map<number, number>, eligYear: number, compYears: number, lastYear: number, freeze: number) {
  const idxYear = eligYear - 2;
  const indexed: number[] = [];
  for (let y = 1951; y <= lastYear; y++) {
    const capped = Math.min(earnings.get(y) ?? 0, taxableMax(y, freeze));
    const factor = y < idxYear ? awi(idxYear, freeze) / awi(y, freeze) : 1;
    indexed.push(Math.round(capped * factor * 100) / 100);
  }
  const n = Math.max(2, compYears);
  const top = indexed.sort((a, b) => b - a).slice(0, n).reduce((s, v) => s + v, 0);
  const aime = Math.floor(top / (n * 12));
  const [b1, b2, ...fam] = bendPoints(eligYear, freeze);
  const pia = floorDime(0.9 * Math.min(aime, b1) + 0.32 * Math.max(0, Math.min(aime, b2) - b1) + 0.15 * Math.max(0, aime - b2));
  return { pia, familyMax: familyMaxOf(pia, fam), aime };
}

/** The index the statement freezes at this year. */
const freezeFor = (thisYear: number) => Math.min(LATEST_AWI_YEAR, thisYear - 2);

/** The record in today's dollars: past years as posted, years after this one
 *  shrunk by wage growth. `flatFrom`/`flatCents` replace every year from then
 *  on (the statement's "keeps earning $X until he claims"). */
function earningsMap(rec: SsRecord, thisYear: number, flat?: { from: number; dollars: number }): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rec.earnings) {
    if (flat && r.year >= flat.from) continue;
    const dollars = r.cents / 100;
    m.set(r.year, r.year > thisYear ? dollars / Math.pow(1 + SS_WAGE_GROWTH / 100, r.year - thisYear) : dollars);
  }
  if (flat) for (let y = flat.from; y <= 2100; y++) m.set(y, flat.dollars);
  return m;
}

const toCents = (dollars: number) => Math.round(dollars * 100);

/**
 * The retirement PIA in today's dollars when benefits start in `claimYear`:
 * earnings through the year before it (later ones arrive by recomputation),
 * the top 35 years, eligibility at 62.
 */
export function recordRetirementPiaCents(rec: SsRecord, birthYear: number, claimYear: number, thisYear: number): number {
  const freeze = freezeFor(thisYear);
  const elig = birthYear + 62;
  const r = computePia(earningsMap(rec, thisYear), elig, 35, Math.max(elig - 1, claimYear - 1), freeze);
  return toCents(r.pia);
}

/**
 * The PIA and family maximum survivors draw on for a death in `deathYear`
 * before 62, in today's dollars: eligibility in the death year, earnings
 * through it, the years after he turns 21 less 5 dropouts (at least 2).
 * Null at 62 or later — the retirement PIA applies then.
 */
export function recordDeathPia(
  rec: SsRecord,
  birthYear: number,
  deathYear: number,
  thisYear: number,
): { piaCents: number; familyMaxCents: number } | null {
  if (deathYear >= birthYear + 62) return null;
  const elapsed = Math.max(0, deathYear - (birthYear + 22));
  const r = computePia(earningsMap(rec, thisYear), deathYear, elapsed - 5, deathYear, freezeFor(thisYear));
  return { piaCents: toCents(r.pia), familyMaxCents: toCents(r.familyMax) };
}

/** Share of the PIA a worker gets starting `monthsFromFra` from full
 *  retirement age: 5/9% a month off for the first 36 early, 5/12% before
 *  that; 2/3% a month added after it, to 70. */
export function workerFactor(monthsFromFra: number): number {
  if (monthsFromFra >= 0) return 1 + (Math.min(monthsFromFra, (70 - FRA) * 12) * 2) / 300;
  const m = -monthsFromFra;
  return 1 - (Math.min(m, 36) * 5) / 900 - (Math.max(0, m - 36) * 5) / 1200;
}

/** A spouse's share of HALF the worker's PIA: 25/36% a month off for the
 *  first 36 early, 5/12% before that; nothing added after full retirement age. */
export function spousalFactor(monthsEarly: number): number {
  const m = Math.max(0, monthsEarly);
  return 1 - (Math.min(m, 36) * 25) / 3600 - (Math.max(0, m - 36) * 5) / 1200;
}

/** Months from full retirement age to a start in `startYear`/`startMonth`.
 *  At 62 the first month is the one after the birthday month. */
function monthsFromFra(birthYear: number, birthMonth: number, startYear: number, startMonth: number): number {
  const ageMonths = (startYear - birthYear) * 12 + (startMonth - birthMonth);
  return Math.max(ageMonths, 62 * 12 + 1) - FRA * 12;
}

/** The monthly benefit starting in `startYear`/`startMonth`, rounded down to the dollar. */
export function benefitAtStartCents(piaCents: number, birthYear: number, birthMonth: number, startYear: number, startMonth: number): number {
  return Math.floor((piaCents / 100) * workerFactor(monthsFromFra(birthYear, birthMonth, startYear, startMonth)) + 1e-7) * 100;
}

/** What the plan needs to put a record to work. */
export type SsRecordPlan = {
  birthYear: number | null;
  spouseBirthYear: number | null;
  /** The age the spouse starts the spousal benefit; null = none. */
  spouseClaimAge: number | null;
  thisYear: number;
};

/** The Social Security line the record belongs to: the largest one. */
export function recordLine(lines: IncomeLine[]): IncomeLine | null {
  return lines
    .filter((l) => l.kind === "social_security" && !l.spousal)
    .reduce<IncomeLine | null>((best, l) => (best == null || l.monthlyCents > best.monthlyCents ? l : best), null);
}

/**
 * The income lines with the record put to work:
 * - his Social Security line's PIA and amount come from the record at the
 *   start it already has (a full-retirement-age line is added if none);
 * - with a spouse claim age, a spousal line: half his PIA, cut for each
 *   month she starts before 67, from that age or his start, whichever is later.
 */
export function applySsRecord(lines: IncomeLine[], rec: SsRecord | null, plan: SsRecordPlan): IncomeLine[] {
  if (!rec || plan.birthYear == null || rec.earnings.length === 0) return lines;
  const birthYear = plan.birthYear;
  const birthMonth = rec.birthMonth ?? 1;
  const own = recordLine(lines);
  const line: IncomeLine = own ?? {
    id: "ss-record",
    name: "Social Security",
    kind: "social_security",
    monthlyCents: 0,
    startYear: birthYear + FRA,
    startMonth: birthMonth,
    endYear: null,
    taxable: true,
  };
  const startYear = line.startYear ?? plan.thisYear;
  const startMonth = line.startMonth ?? 1;
  const piaCents = recordRetirementPiaCents(rec, birthYear, startYear, plan.thisYear);
  const worked: IncomeLine = {
    ...line,
    piaCents,
    monthlyCents: benefitAtStartCents(piaCents, birthYear, birthMonth, startYear, startMonth),
    fromRecord: true,
  };
  const out = own ? lines.map((l) => (l === own ? worked : l)) : [...lines, worked];
  if (plan.spouseClaimAge != null && plan.spouseBirthYear != null) {
    const herAgeYear = plan.spouseBirthYear + plan.spouseClaimAge;
    const spStart = Math.max(herAgeYear, startYear);
    const spMonth = spStart === startYear ? startMonth : 1;
    const early = Math.max(0, (FRA - (spStart - plan.spouseBirthYear)) * 12);
    out.push({
      id: "ss-spousal",
      name: "Spousal benefit (Social Security)",
      kind: "social_security",
      monthlyCents: Math.floor((piaCents / 200) * spousalFactor(early) + 1e-7) * 100,
      startYear: spStart,
      startMonth: spMonth,
      endYear: null,
      taxable: line.taxable,
      spousal: true,
    });
  }
  return out;
}

/**
 * The calculator run on the statement's own assumptions — earnings at the
 * statement's figure every year from its year on, the wage index of its date
 * — to show it lands on the statement's numbers.
 */
export function statementCheck(rec: SsRecord, birthYear: number) {
  const s = rec.statement;
  if (!s || s.assumedEarningsCents == null) return null;
  const year = Number(s.statementDate.slice(0, 4));
  const flat = { from: year, dollars: s.assumedEarningsCents / 100 };
  const freeze = freezeFor(year);
  const map = earningsMap(rec, year, flat);
  const birthMonth = rec.birthMonth ?? 1;
  const retire: Record<string, number> = {};
  for (let age = 62; age <= 70; age++) {
    const start = age === 62 ? (birthMonth === 12 ? [birthYear + 63, 1] : [birthYear + 62, birthMonth + 1]) : [birthYear + age, birthMonth];
    const pia = computePia(map, birthYear + 62, 35, start[0] - 1, freeze).pia;
    // A start after full retirement age is credited the next January, as the statement shows.
    const credited = age > FRA && age < 70 ? (age - FRA - 1) * 12 + (13 - birthMonth) : null;
    const f = credited != null ? workerFactor(credited) : workerFactor(monthsFromFra(birthYear, birthMonth, start[0], start[1]));
    retire[age] = Math.floor(pia * f + 1e-7) * 100;
  }
  const elapsed = Math.max(0, year - (birthYear + 22));
  const d = computePia(map, year, elapsed - 5, year, freeze);
  return {
    retirementByAge: retire,
    survivors: {
      childCents: Math.floor(d.pia * 0.75 + 1e-7) * 100,
      spouseAtFraCents: Math.floor(d.pia + 1e-7) * 100,
      familyMaxCents: Math.floor(d.familyMax + 1e-7) * 100,
    },
  };
}

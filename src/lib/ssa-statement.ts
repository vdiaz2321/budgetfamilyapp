// Reads the numbers out of a Social Security Statement (Form SSA-7005-SM-OL,
// the PDF downloaded from my Social Security). Pure text in, numbers out — no
// imports, so it runs the same on the server, in the browser, and in tests.
//
// Privacy: the statement is read in the browser only. This parser never looks
// for the person's name or SSN and returns nothing but the figures below.

export type SsStatement = {
  /** "YYYY-MM-DD" — the date printed at the top ("October 22, 2026"). */
  statementDate: string;
  /** From "based on your date of birth: March 28, 1981." (the day is dropped). */
  birthYear: number;
  birthMonth: number;
  /** Age (62..70) → estimated monthly benefit in cents. */
  retirementByAge: Record<number, number>;
  /** "your monthly payment would be about $2,798". */
  disabilityCents: number | null;
  survivors: {
    childCents: number;
    caregiverCents: number;
    spouseAtFraCents: number;
    familyMaxCents: number;
  } | null;
  /** "assume you continue to earn $93,368 per year". */
  assumedEarningsCents: number | null;
  /** Social Security column only. A combined row "1991-2000 $28,242" keeps its range. */
  earnings: { from: number; to: number; cents: number }[];
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_RE = "(January|February|March|April|May|June|July|August|September|October|November|December)";
const MONEY_RE = "\\$\\s*(\\d{1,3}(?:,\\d{3})*|\\d+)(?:\\.(\\d{2}))?";

function toCents(whole: string, frac?: string): number {
  const dollars = Number(whole.replace(/,/g, ""));
  const cents = frac ? Number(frac) : 0;
  return dollars * 100 + cents;
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.toLowerCase()) + 1;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** First money amount right after `label` (label words may be split by any whitespace). */
function moneyAfter(text: string, label: RegExp): number | null {
  const re = new RegExp(`${label.source}\\s*:?\\s*${MONEY_RE}`, "i");
  const m = re.exec(text);
  if (!m) return null;
  const n = m.length;
  return toCents(m[n - 2], m[n - 1]);
}

/** Builds a regex source that matches the words with any whitespace (incl. line breaks) between them. */
function words(phrase: string): RegExp {
  const src = phrase
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(src, "i");
}

export function parseSsaStatementText(text: string): SsStatement | null {
  if (typeof text !== "string" || text.length === 0) return null;
  // One space for every run of whitespace, so labels broken across lines
  // ("child\nyounger than age 16") read as one phrase.
  const flat = text.replace(/\s+/g, " ");
  if (!/Social\s+Security\s+Statement/i.test(flat)) return null;

  // Date of birth — "based on your date of birth: May 3, 1980."
  const dobRe = new RegExp(`date\\s+of\\s+birth\\s*:?\\s*${MONTH_RE}\\s+(\\d{1,2}),?\\s*(\\d{4})`, "i");
  const dob = dobRe.exec(flat);
  if (!dob) return null;
  const birthMonth = monthIndex(dob[1]);
  const birthYear = Number(dob[3]);

  // Statement date — the first full date that is not the date of birth.
  const withoutDob = flat.slice(0, dob.index) + " " + flat.slice(dob.index + dob[0].length);
  const dateRe = new RegExp(`${MONTH_RE}\\s+(\\d{1,2}),\\s*(\\d{4})`, "i");
  const sd = dateRe.exec(withoutDob);
  if (!sd) return null;
  const statementDate = `${sd[3]}-${pad2(monthIndex(sd[1]))}-${pad2(Number(sd[2]))}`;

  // Retirement table — rows "62 $2,127" … "70 $3,936" after its heading.
  const tableStart = flat.search(/Personalized\s+Monthly\s+Retirement\s+Benefit\s+Estimates|Age\s+Retirement\s+Benefits\s+Start/i);
  const tableText = tableStart >= 0 ? flat.slice(tableStart) : "";
  const retirementByAge: Record<number, number> = {};
  const ageRe = new RegExp(`(?:^|[^\\d$,.])(6[2-9]|70)\\s+${MONEY_RE}`, "g");
  for (const m of tableText.matchAll(ageRe)) {
    const age = Number(m[1]);
    if (retirementByAge[age] === undefined) retirementByAge[age] = toCents(m[2], m[3]);
  }
  if (Object.keys(retirementByAge).length === 0) return null;

  // Disability — "If you became disabled right now … would be about $2,500."
  let disabilityCents: number | null = null;
  const dis = new RegExp(`disabled\\s+right\\s+now[^$]{0,200}?would\\s+be\\s+about\\s+${MONEY_RE}`, "i").exec(flat);
  if (dis) disabilityCents = toCents(dis[1], dis[2]);

  // Survivors — all four lines, or nothing. Exact wording on purpose, so a
  // stray amount (e.g. the $255 one-time death benefit) can never slip in.
  const child = moneyAfter(flat, words("Minor child"));
  const caregiver = moneyAfter(
    flat,
    words("Spouse, if caring for a disabled child or child younger than age 16"),
  );
  const spouseFra = moneyAfter(flat, words("Spouse, if benefits start at full retirement age"));
  const familyMax = moneyAfter(flat, words("Total family benefits cannot be more than"));
  const survivors =
    child !== null && caregiver !== null && spouseFra !== null && familyMax !== null
      ? { childCents: child, caregiverCents: caregiver, spouseAtFraCents: spouseFra, familyMaxCents: familyMax }
      : null;

  // Assumed future earnings — "assume you continue to earn $80,000 per year".
  let assumedEarningsCents: number | null = null;
  const ae = new RegExp(`continue\\s+to\\s+earn\\s+${MONEY_RE}\\s+(?:per|a)\\s+year`, "i").exec(flat);
  if (ae) assumedEarningsCents = toCents(ae[1], ae[2]);

  // Earnings record — "2006 $50,000 $50,000" (Social Security, then Medicare),
  // "1991-2000 $20,000 $20,000", or "2026 Not yet recorded".
  const earnings: SsStatement["earnings"] = [];
  let start = -1;
  for (const heading of [/Taxed\s+for\s+Social\s+Security/i, /Work\s+Year/i, /Earnings\s+Record/i]) {
    start = flat.search(heading);
    if (start >= 0) break;
  }
  if (start >= 0) {
    let region = flat.slice(start);
    const end = region.search(/Taxes\s+Paid/i);
    if (end >= 0) region = region.slice(0, end);
    const cell = `(?:${MONEY_RE}|Not\\s+yet\\s+recorded)`;
    const rowRe = new RegExp(
      `(?:^|[^\\d$,.])(\\d{4})(?:\\s*[-\\u2013\\u2014]\\s*(\\d{4}))?\\s+${cell}(?:\\s+(?:\\$\\s*[\\d,]+(?:\\.\\d{2})?|Not\\s+yet\\s+recorded))?`,
      "gi",
    );
    const seen = new Set<number>();
    for (const m of region.matchAll(rowRe)) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      if (from < 1937 || to > 2200 || to < from) continue;
      if (m[3] === undefined) continue; // "Not yet recorded"
      if (seen.has(from)) continue;
      seen.add(from);
      earnings.push({ from, to, cents: toCents(m[3], m[4]) });
    }
    earnings.sort((a, b) => a.from - b.from);
  }

  return {
    statementDate,
    birthYear,
    birthMonth,
    retirementByAge,
    disabilityCents,
    survivors,
    assumedEarningsCents,
    earnings,
  };
}

/** Splits combined ranges evenly across their years (cent-exact: remainder on the last year), returns per-year rows flagged `split: true` when they came from a range. */
export function earningsByYear(s: SsStatement): { year: number; cents: number; split: boolean }[] {
  const out: { year: number; cents: number; split: boolean }[] = [];
  for (const row of s.earnings) {
    const years = row.to - row.from + 1;
    if (years <= 1) {
      out.push({ year: row.from, cents: row.cents, split: false });
      continue;
    }
    const each = Math.floor(row.cents / years);
    const remainder = row.cents - each * years;
    for (let y = row.from; y <= row.to; y++) {
      out.push({ year: y, cents: y === row.to ? each + remainder : each, split: true });
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

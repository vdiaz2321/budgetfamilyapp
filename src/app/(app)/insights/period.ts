// Shared period math for Insights. A "period" is one bucket at a chosen
// granularity, identified by a string key. Both the server page and the client
// period-picker use these helpers so labels and ranges always agree.

export type Granularity = "weekly" | "monthly" | "quarterly" | "yearly";

const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const DAY = 86_400_000;

export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const shift = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - shift);
  x.setHours(0, 0, 0, 0);
  return x;
}

// The key of the period that contains `date`, at the given granularity.
export function periodKeyOf(g: Granularity, date: Date): string {
  const y = date.getFullYear();
  switch (g) {
    case "weekly":
      return ymd(mondayOf(date));
    case "quarterly":
      return `${y}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    case "yearly":
      return `${y}`;
    default:
      return `${y}-${pad2(date.getMonth() + 1)}`;
  }
}

// The key that a transaction's `YYYY-MM-DD` date string falls into.
export function keyOfDate(g: Granularity, iso: string): string {
  switch (g) {
    case "weekly":
      return ymd(mondayOf(new Date(`${iso}T00:00:00`)));
    case "quarterly":
      return `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
    case "yearly":
      return iso.slice(0, 4);
    default:
      return iso.slice(0, 7);
  }
}

export function currentPeriodKey(g: Granularity, now = new Date()): string {
  return periodKeyOf(g, now);
}

// Inclusive [from, to] date-string range covered by a period key.
export function periodRange(g: Granularity, key: string): { from: string; to: string } {
  switch (g) {
    case "weekly": {
      const start = new Date(`${key}T00:00:00`);
      return { from: key, to: ymd(new Date(start.getTime() + 6 * DAY)) };
    }
    case "quarterly": {
      const y = Number(key.slice(0, 4));
      const q = Number(key.slice(6)) - 1;
      return { from: `${y}-${pad2(q * 3 + 1)}-01`, to: ymd(new Date(y, q * 3 + 3, 0)) };
    }
    case "yearly":
      return { from: `${key}-01-01`, to: `${key}-12-31` };
    default: {
      const y = Number(key.slice(0, 4));
      const m = Number(key.slice(5, 7)) - 1;
      return { from: `${key}-01`, to: ymd(new Date(y, m + 1, 0)) };
    }
  }
}

// The key of the period immediately before `key`.
export function priorKey(g: Granularity, key: string): string {
  switch (g) {
    case "weekly":
      return ymd(new Date(new Date(`${key}T00:00:00`).getTime() - 7 * DAY));
    case "quarterly": {
      const y = Number(key.slice(0, 4));
      const q = Number(key.slice(6));
      return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
    }
    case "yearly":
      return `${Number(key) - 1}`;
    default: {
      const y = Number(key.slice(0, 4));
      const m = Number(key.slice(5, 7)); // 1-based
      return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
    }
  }
}

// Full label, e.g. "August 2026" / "Q3 2026" / "Week of Aug 17" / "2026".
export function periodLabel(g: Granularity, key: string): string {
  switch (g) {
    case "weekly": {
      const d = new Date(`${key}T00:00:00`);
      return `Week of ${MON[d.getMonth()]} ${d.getDate()}`;
    }
    case "quarterly":
      return `Q${key.slice(6)} ${key.slice(0, 4)}`;
    case "yearly":
      return key;
    default:
      return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  }
}

// Short axis label for a chart bucket. `withYear` disambiguates when a series
// spans more than one calendar year.
export function bucketLabel(g: Granularity, key: string, withYear: boolean): string {
  switch (g) {
    case "weekly": {
      const d = new Date(`${key}T00:00:00`);
      return `${MON[d.getMonth()]} ${d.getDate()}`;
    }
    case "quarterly":
      return `Q${key.slice(6)} '${key.slice(2, 4)}`;
    case "yearly":
      return key;
    default: {
      const m = Number(key.slice(5, 7)) - 1;
      return withYear ? `${MON[m]} '${key.slice(2, 4)}` : MON[m];
    }
  }
}

// Step a key forward by one bucket (used to build a contiguous series).
function nextKey(g: Granularity, key: string): string {
  switch (g) {
    case "weekly":
      return ymd(new Date(new Date(`${key}T00:00:00`).getTime() + 7 * DAY));
    case "quarterly": {
      const y = Number(key.slice(0, 4));
      const q = Number(key.slice(6));
      return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
    }
    case "yearly":
      return `${Number(key) + 1}`;
    default: {
      const y = Number(key.slice(0, 4));
      const m = Number(key.slice(5, 7)); // 1-based
      return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
    }
  }
}

// Ordinal position of a key on its granularity's timeline, so we can measure
// how many buckets separate two keys.
function ordinal(g: Granularity, key: string): number {
  switch (g) {
    case "weekly":
      return Math.round(new Date(`${key}T00:00:00`).getTime() / (7 * DAY));
    case "quarterly":
      return Number(key.slice(0, 4)) * 4 + (Number(key.slice(6)) - 1);
    case "yearly":
      return Number(key);
    default:
      return Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1);
  }
}

// How many buckets back from "now" a granularity's chart series runs.
const SERIES_SPAN: Record<Granularity, number> = {
  weekly: 12,
  monthly: 12,
  quarterly: 8,
  yearly: 6,
};

// The ordered list of bucket keys to plot. Ends at the later of {current,
// selected} and starts SERIES_SPAN buckets earlier — but always includes the
// selected key, and for yearly never reaches before `minYear` (earliest data).
export function seriesKeys(
  g: Granularity,
  selectedKey: string,
  minYear: number,
  now = new Date(),
): string[] {
  const curKey = currentPeriodKey(g, now);
  const endOrd = Math.max(ordinal(g, curKey), ordinal(g, selectedKey));
  let startOrd = endOrd - (SERIES_SPAN[g] - 1);
  startOrd = Math.min(startOrd, ordinal(g, selectedKey));
  if (g === "yearly") startOrd = Math.max(startOrd, minYear);

  // Walk from the end backward until we pass startOrd, collecting keys.
  const keys: string[] = [];
  let k = ordinal(g, curKey) >= endOrd ? curKey : selectedKey;
  // Rebuild the end key from the max ordinal safely by stepping from selected.
  // Simpler: start at the smaller key and step forward.
  const startKey = keyFromOrdinal(g, startOrd);
  k = startKey;
  while (ordinal(g, k) <= endOrd) {
    keys.push(k);
    k = nextKey(g, k);
  }
  return keys;
}

// Inverse of ordinal() — reconstruct a key from a timeline position.
function keyFromOrdinal(g: Granularity, ord: number): string {
  switch (g) {
    case "weekly":
      return ymd(new Date(ord * 7 * DAY));
    case "quarterly": {
      const y = Math.floor(ord / 4);
      const q = (ord % 4) + 1;
      return `${y}-Q${q}`;
    }
    case "yearly":
      return `${ord}`;
    default: {
      const y = Math.floor(ord / 12);
      const m = (ord % 12) + 1;
      return `${y}-${pad2(m)}`;
    }
  }
}

// Options offered in the picker's second-level menu, newest first.
export function periodOptions(
  g: Granularity,
  minYear: number,
  now = new Date(),
): { key: string; label: string }[] {
  const curOrd = ordinal(g, currentPeriodKey(g, now));
  const count =
    g === "weekly" ? 12 : g === "monthly" ? 24 : g === "quarterly" ? 12 : Math.max(1, now.getFullYear() - minYear + 1);
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const key = keyFromOrdinal(g, curOrd - i);
    out.push({ key, label: periodLabel(g, key) });
  }
  return out;
}

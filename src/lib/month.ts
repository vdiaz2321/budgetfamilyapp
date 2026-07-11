// Month helpers for the Budget page. A "month key" is `YYYY-MM`; the database
// stores plans/actuals against the first-of-month date (`YYYY-MM-01`).

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type MonthInfo = {
  key: string; // YYYY-MM
  firstOfMonth: string; // YYYY-MM-01 (for DB queries)
  label: string; // "July 2026"
  year: number;
  prevKey: string;
  nextKey: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Parse a `?month=YYYY-MM` param, falling back to the current month.
export function resolveMonth(raw: string | undefined): MonthInfo {
  let year: number;
  let month1: number; // 1-based

  const match = raw?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    year = parseInt(match[1], 10);
    month1 = Math.min(12, Math.max(1, parseInt(match[2], 10)));
  } else {
    const now = new Date();
    year = now.getFullYear();
    month1 = now.getMonth() + 1;
  }

  const prev = month1 === 1 ? { y: year - 1, m: 12 } : { y: year, m: month1 - 1 };
  const next = month1 === 12 ? { y: year + 1, m: 1 } : { y: year, m: month1 + 1 };

  return {
    key: `${year}-${pad2(month1)}`,
    firstOfMonth: `${year}-${pad2(month1)}-01`,
    label: `${MONTH_NAMES[month1 - 1]} ${year}`,
    year,
    prevKey: `${prev.y}-${pad2(prev.m)}`,
    nextKey: `${next.y}-${pad2(next.m)}`,
  };
}

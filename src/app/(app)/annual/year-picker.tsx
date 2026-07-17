"use client";

import { useRouter } from "next/navigation";

type Props = {
  year: number;
  currentYear: number;
};

// Capitall's first year — the earliest any budget data exists, so the picker
// never needs to reach below it.
const START_YEAR = 2026;

// The bold year in the navigator, but a real <select> so any year is one tap
// away instead of clicking the arrow N times to reach a distant year. Floor is
// fixed at START_YEAR and the top grows to a few years ahead of today — so as
// time passes the list *adds* future years rather than shifting off the past.
// Picking the current year drops the ?year param so the URL stays clean.
export function YearPicker({ year, currentYear }: Props) {
  const router = useRouter();
  const years: number[] = [];
  // Guard the bounds so a year reached via URL still appears in the list.
  const min = Math.min(START_YEAR, year);
  const max = Math.max(currentYear + 5, year);
  for (let y = max; y >= min; y--) years.push(y);

  return (
    <div className="relative">
      <select
        aria-label="Jump to year"
        value={year}
        onChange={(e) => {
          const y = parseInt(e.target.value, 10);
          router.push(y === currentYear ? "/annual" : `/annual?year=${y}`);
        }}
        className={`min-w-[3.5rem] cursor-pointer appearance-none rounded-lg bg-transparent px-2 text-center text-sm font-bold outline-none focus:bg-brand-soft ${
          year === currentYear ? "" : "text-brand"
        }`}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

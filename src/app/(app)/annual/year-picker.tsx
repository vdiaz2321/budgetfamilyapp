"use client";

import { useRouter } from "next/navigation";

type Props = {
  year: number;
  currentYear: number;
  /** The first spreadsheet year (2018) — nothing exists before it. */
  firstYear: number;
};

// The bold year in the navigator, but a real <select> so any year is one tap
// away instead of clicking the arrow N times to reach a distant year. It runs
// from the first spreadsheet year — those years show the sheet's totals — up
// to this year: later years have nothing in them yet.
// Picking the current year drops the ?year param so the URL stays clean.
export function YearPicker({ year, currentYear, firstYear }: Props) {
  const router = useRouter();
  const years: number[] = [];
  // Guard the bounds so a year reached via URL still appears in the list.
  const min = Math.min(firstYear, year);
  const max = Math.max(currentYear, year);
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

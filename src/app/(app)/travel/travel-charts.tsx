"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

export type YearPoint = {
  year: string;
  hotel: number;
  pocket: number;
  stays: number;
};

// Compact axis money: $0 / $1.5k / $5.3k — keeps the gutter narrow, same
// shorthand the Insights charts use.
function axisMoney(cents: number, currency: string): string {
  const dollars = cents / 100;
  const symbol = formatMoney(0, currency).replace(/[\d.,]/g, "");
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `${symbol}${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `${symbol}${Math.round(dollars)}`;
}

const GRIDLINES = [1, 0.5, 0];

// ---- What the room listed for against what actually left the wallet, a pair
// of bars per year. The gap between them IS the saving, which is what the
// sheet's stacked version was really showing.
export function CostBars({
  years,
  currency,
  selected,
  onPick,
}: {
  years: YearPoint[];
  currency: string;
  onPick?: (year: string) => void;
  // The year the Reservations list is filtered to, washed here so the filter
  // and the chart are visibly the same subject.
  selected?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...years.flatMap((y) => [y.hotel, y.pocket]));
  const pct = (v: number) => (v <= 0 ? 0 : Math.max(1.5, (v / max) * 100));

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-5 text-[11px] font-medium text-muted">
        <Key color="var(--viz-soft)" label="Hotel cost" />
        <Key color="var(--viz-debt)" label="Pocket cost" />
      </div>

      <div className="flex">
        <div className="relative mr-2 h-36 w-12 shrink-0">
          {GRIDLINES.map((g) => (
            <span
              key={g}
              className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-muted"
              style={{ top: `${(1 - g) * 100}%` }}
            >
              {axisMoney(max * g, currency)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 h-36">
            {GRIDLINES.map((g) => (
              <span
                key={g}
                className="absolute inset-x-0 border-t"
                style={{ top: `${(1 - g) * 100}%`, borderColor: "var(--viz-grid)" }}
              />
            ))}
          </div>

          <div className="relative flex h-36 items-end gap-1">
            {years.map((y, i) => (
              <div
                key={y.year}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={onPick ? () => onPick(y.year) : undefined}
                className={`relative flex h-full flex-1 flex-col justify-end rounded-t-md ${onPick ? "cursor-pointer" : ""}`}
                style={selected?.includes(y.year) ? { backgroundColor: "var(--viz-sel)" } : undefined}
              >
                <div className="flex h-full items-end justify-center gap-1">
                  <div
                    className="w-[38%] max-w-[16px] rounded-t-[4px]"
                    style={{ height: `${pct(y.hotel)}%`, backgroundColor: "var(--viz-soft)" }}
                  />
                  <div
                    className="w-[38%] max-w-[16px] rounded-t-[4px]"
                    style={{ height: `${pct(y.pocket)}%`, backgroundColor: "var(--viz-debt)" }}
                  />
                </div>

                {hover === i ? (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2">
                    <YearTip point={y} currency={currency} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-1 flex gap-1">
            {years.map((y) => (
              <span
                key={y.year}
                className={`flex-1 text-center text-[10px] tabular-nums ${
                  selected?.includes(y.year) ? "font-bold text-foreground" : "text-muted"
                }`}
              >
                {y.year}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Total saved per year, as a line with the value called out at each mark.
export function SavedLine({
  years,
  currency,
  selected,
  onPick,
}: {
  years: YearPoint[];
  currency: string;
  selected?: string[];
  onPick?: (year: string) => void;
}) {
  const W = 320;
  const H = 120;
  const padX = 20;
  const padTop = 22;
  const padBottom = 18;
  const saved = years.map((y) => Math.max(0, y.hotel - y.pocket));
  const max = Math.max(1, ...saved);
  const step = years.length > 1 ? (W - padX * 2) / (years.length - 1) : 0;
  const x = (i: number) => padX + step * i;
  const y = (v: number) => padTop + (1 - v / max) * (H - padTop - padBottom);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full"
        role="img"
        aria-label="Total saved per year"
      >
        {GRIDLINES.map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={y(max * g)}
            y2={y(max * g)}
            stroke="var(--viz-grid)"
            strokeWidth={1}
          />
        ))}
        {years.length > 1 ? (
          <polyline
            points={saved.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke="var(--positive)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {saved.map((v, i) => (
          <g key={years[i].year}>
            {selected?.includes(years[i].year) ? (
              <circle cx={x(i)} cy={y(v)} r={7} fill="var(--positive)" opacity={0.25} />
            ) : null}
            <circle cx={x(i)} cy={y(v)} r={3.5} fill="var(--positive)" />
            <text
              x={x(i)}
              y={y(v) - 8}
              // The end labels would run off the viewBox if they were centred.
              textAnchor={i === 0 ? "start" : i === saved.length - 1 ? "end" : "middle"}
              className="fill-current text-[10px] font-semibold tabular-nums"
              style={{ fill: "var(--positive)" }}
            >
              {formatMoney(v, currency).replace(/\.\d\d$/, "")}
            </text>
            <text
              x={x(i)}
              y={H - 4}
              textAnchor={i === 0 ? "start" : i === saved.length - 1 ? "end" : "middle"}
              className="text-[10px] tabular-nums"
              style={{ fill: selected?.includes(years[i].year) ? "var(--foreground)" : "var(--muted)" }}
            >
              {years[i].year}
            </text>
          </g>
        ))}
      </svg>
      {/* One invisible hover strip per year, the width of the gap between
          marks, so the tip opens anywhere in a year's column. */}
      {years.map((p, i) => {
        const half = years.length > 1 ? step / 2 : W / 2;
        const left = Math.max(0, x(i) - half);
        const right = Math.min(W, x(i) + half);
        const edge = i === 0 ? "left-0" : i === years.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
        return (
          <div
            key={p.year}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            onClick={onPick ? () => onPick(p.year) : undefined}
            className={`absolute inset-y-0 ${onPick ? "cursor-pointer" : ""}`}
            style={{ left: `${(left / W) * 100}%`, width: `${((right - left) / W) * 100}%` }}
          >
            {hover === i ? (
              <div
                className={`pointer-events-none absolute z-10 mb-2 ${edge}`}
                style={{ bottom: `${(1 - y(saved[i]) / H) * 100}%` }}
              >
                <YearTip point={p} currency={currency} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// The hover card both travel charts share: the year, what the rooms listed
// for, what we paid, and the difference. Every row carries a swatch so the
// figures line up in one column. The bar colors identify the rows as
// swatches, not as text color — light blue at this size is unreadable on the
// surface, so hotel and pocket stay in the foreground color.
function YearTip({ point, currency }: { point: YearPoint; currency: string }) {
  const rows = [
    { color: "var(--viz-soft)", value: point.hotel, label: "hotel cost", tone: "" },
    { color: "var(--viz-debt)", value: point.pocket, label: "pocket cost", tone: "" },
    { color: "var(--positive)", value: point.hotel - point.pocket, label: "saved", tone: "text-positive" },
  ];
  return (
    <div className="whitespace-nowrap rounded-md bg-surface px-2.5 py-1.5 text-[11px] shadow-lg ring-1 ring-line">
      <p className="font-bold tabular-nums">{point.year}</p>
      <div className="mt-0.5 grid grid-cols-[auto_auto_auto] items-center gap-x-1.5">
        {rows.map((r, k) => (
          <div
            key={r.label}
            className={`contents ${k === 2 ? "[&>*]:mt-0.5 [&>*]:border-t [&>*]:border-line [&>*]:pt-0.5" : ""}`}
          >
            <span className="flex h-full items-center">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: r.color }} />
            </span>
            <span className={`text-right font-semibold tabular-nums ${r.tone}`}>{formatMoney(r.value, currency)}</span>
            <span className="text-muted">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

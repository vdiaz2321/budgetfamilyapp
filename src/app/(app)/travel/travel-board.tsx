"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { StayModal } from "./stay-modal";
import {
  POCKET_PAID_LABELS,
  pointsValueCents,
  savedCents,
  stayYear,
  type TravelCard,
  type TravelStay,
} from "./types";

const ALL = "__all__";

export function TravelBoard({
  stays,
  cards,
  currency,
}: {
  stays: TravelStay[];
  cards: TravelCard[];
  currency: string;
}) {
  const [year, setYear] = useState<string>(ALL);
  const [brand, setBrand] = useState<string>(ALL);
  const [holder, setHolder] = useState<string>(ALL);
  const [editing, setEditing] = useState<TravelStay | null>(null);
  const [adding, setAdding] = useState(false);

  const cardName = useMemo(
    () => new Map(cards.map((c) => [c.id, c.name])),
    [cards],
  );
  const years = useMemo(
    () => Array.from(new Set(stays.map(stayYear))).sort().reverse(),
    [stays],
  );
  const brands = useMemo(
    () => Array.from(new Set(stays.map((s) => s.brand).filter(Boolean) as string[])).sort(),
    [stays],
  );
  const holders = useMemo(
    () => Array.from(new Set(stays.map((s) => s.holder).filter(Boolean) as string[])).sort(),
    [stays],
  );

  const filtered = useMemo(
    () =>
      stays.filter(
        (s) =>
          (year === ALL || stayYear(s) === year) &&
          (brand === ALL || s.brand === brand) &&
          (holder === ALL || s.holder === holder),
      ),
    [stays, year, brand, holder],
  );

  const totals = useMemo(() => {
    let hotel = 0, pocket = 0, points = 0, nights = 0, credit = 0;
    for (const s of filtered) {
      hotel += s.hotelCostCents;
      pocket += s.pocketCostCents;
      points += s.pointsCost;
      nights += s.nights;
      credit += s.hotelCreditCents;
    }
    return { hotel, pocket, points, nights, credit, saved: hotel - pocket };
  }, [filtered]);

  // Per-year rollup over ALL stays, not the filtered set: this table is the
  // year-over-year picture, and narrowing it to one year would leave one row.
  const byYear = useMemo(() => {
    const map = new Map<string, { hotel: number; pocket: number; stays: number; points: number }>();
    for (const s of stays) {
      const key = stayYear(s);
      const row = map.get(key) ?? { hotel: 0, pocket: 0, stays: 0, points: 0 };
      row.hotel += s.hotelCostCents;
      row.pocket += s.pocketCostCents;
      row.points += s.pointsCost;
      row.stays += 1;
      map.set(key, row);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [stays]);

  const byBrand = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of filtered) {
      const key = s.brand?.trim() || "Unbranded";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  return (
    <div className="space-y-3">
      <header className="rounded-xl bg-surface px-4 py-4 shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold sm:text-xl">Travel Log</h1>
            <p className="text-xs text-muted">
              Every hotel and apartment stay, what it cost in points, and what you saved against the cash rate.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong"
          >
            Add stay
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Tile label="Total saved" value={formatMoney(totals.saved, currency)} color="var(--positive)" sub={`${filtered.length} stay${filtered.length === 1 ? "" : "s"} · ${totals.nights} night${totals.nights === 1 ? "" : "s"}`} />
          <Tile label="Cash rate" value={formatMoney(totals.hotel, currency)} color="var(--viz-income)" sub="What the rooms listed for" />
          <Tile label="Out of pocket" value={formatMoney(totals.pocket, currency)} color="var(--negative)" sub="What actually left the wallet" />
          <Tile label="Points used" value={totals.points.toLocaleString()} color="var(--viz-savings)" sub={`Worth ${formatMoney(filtered.reduce((sum, s) => sum + pointsValueCents(s), 0), currency)}`} />
          <Tile label="Hotel credits" value={formatMoney(totals.credit, currency)} color="var(--viz-bills)" sub="Card credits applied" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <FilterChip label="All years" active={year === ALL} onClick={() => setYear(ALL)} />
          {years.map((y) => (
            <FilterChip key={y} label={y} active={year === y} onClick={() => setYear(y)} />
          ))}
          {brands.length > 0 ? (
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value={ALL}>All brands</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          ) : null}
          {holders.length > 0 ? (
            <select
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              className="rounded-md bg-background px-2 py-1 text-xs font-semibold ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value={ALL}>All owners</option>
              {holders.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          ) : null}
        </div>
      </header>

      {stays.length === 0 ? (
        <section className="rounded-xl bg-surface px-4 py-10 text-center shadow-sm ring-1 ring-black/5 dark:ring-white/10">
          <p className="text-sm font-semibold">No stays logged yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            Add a reservation and the log tracks the points it cost, the cash rate you avoided, and what you saved. Points spent on a card come straight off that card&apos;s balance.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-4 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-strong"
          >
            Add your first stay
          </button>
        </section>
      ) : (
        <>
          {/* ---- Year-over-year rollup: the sheet's summary block. */}
          <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <div className="border-b border-line px-4 py-3 sm:px-6">
              <h2 className="text-sm font-bold">Saved by year</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-center font-semibold">Year</th>
                    <th className="px-3 py-2 text-center font-semibold">Stays</th>
                    <th className="px-3 py-2 text-center font-semibold">Points</th>
                    <th className="px-3 py-2 text-center font-semibold">Cash rate</th>
                    <th className="px-3 py-2 text-center font-semibold">Out of pocket</th>
                    <th className="px-3 py-2 text-center font-semibold">Total saved</th>
                  </tr>
                </thead>
                <tbody>
                  {byYear.map(([y, row]) => (
                    <tr
                      key={y}
                      className={`border-b border-line/60 last:border-0 ${year === y ? "bg-black/[0.03] dark:bg-white/[0.06]" : ""}`}
                    >
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">{y}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted">{row.stays}</td>
                      <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {row.points > 0 ? row.points.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatMoney(row.hotel, currency)}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-negative">{formatMoney(row.pocket, currency)}</td>
                      <td className="px-3 py-2 text-center font-bold tabular-nums text-positive">
                        {formatMoney(row.hotel - row.pocket, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {byBrand.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-3 sm:px-6">
                {byBrand.map(([b, count]) => (
                  <span key={b} className="rounded-md bg-black/5 px-2 py-1 text-[11px] font-semibold dark:bg-white/10">
                    <span className="tabular-nums">{count}</span> <span className="text-muted">{b}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          {/* ---- The reservations themselves. */}
          <section className="overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-6">
              <h2 className="text-sm font-bold">Reservations</h2>
              <span className="text-xs text-muted tabular-nums">{filtered.length} shown</span>
            </div>

            {/* Desktop: the full grid. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-center font-semibold">Check in</th>
                    <th className="px-3 py-2 text-center font-semibold">Property</th>
                    <th className="px-3 py-2 text-center font-semibold">City</th>
                    <th className="px-3 py-2 text-center font-semibold">Nights</th>
                    <th className="px-3 py-2 text-center font-semibold">Card</th>
                    <th className="px-3 py-2 text-center font-semibold">Points</th>
                    <th className="px-3 py-2 text-center font-semibold">Cash rate</th>
                    <th className="px-3 py-2 text-center font-semibold">Out of pocket</th>
                    <th className="px-3 py-2 text-center font-semibold">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setEditing(s)}
                      className="cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
                    >
                      <td className="px-3 py-2 text-center tabular-nums">{s.checkIn.replace(/-/g, "‑")}</td>
                      <td className="px-3 py-2 text-left font-semibold">
                        {s.propertyName}
                        {s.brand ? <span className="ml-1.5 text-[10px] font-semibold text-muted">{s.brand}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-center text-muted">{s.city ?? "—"}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{s.nights}</td>
                      <td className="px-3 py-2 text-center text-xs">
                        {(s.accountId ? cardName.get(s.accountId) : null) ?? s.cardLabel ?? "—"}
                        {s.holder ? <span className="ml-1 text-muted">· {s.holder}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums" style={{ color: "var(--viz-savings)" }}>
                        {s.pointsCost > 0 ? s.pointsCost.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatMoney(s.hotelCostCents, currency)}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-negative">
                        {formatMoney(s.pocketCostCents, currency)}
                        {s.pocketPaidWith !== "cash" ? (
                          <span className="ml-1 text-[10px] font-semibold text-muted">
                            {POCKET_PAID_LABELS[s.pocketPaidWith]}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-center font-bold tabular-nums text-positive">
                        {formatMoney(savedCents(s), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: one card per stay — a 9-column grid can't be read at 375px. */}
            <ul className="divide-y divide-line sm:hidden">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(s)}
                    className="w-full px-4 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 text-sm font-semibold">{s.propertyName}</span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-positive">
                        {formatMoney(savedCents(s), currency)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      <span className="tabular-nums">{s.checkIn.replace(/-/g, "‑")}</span>
                      <span className="tabular-nums">{s.nights}n</span>
                      {s.city ? <span>{s.city}</span> : null}
                      {s.brand ? <span>{s.brand}</span> : null}
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                      <span>
                        <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">Points</span>
                        <span className="tabular-nums font-semibold" style={{ color: "var(--viz-savings)" }}>
                          {s.pointsCost > 0 ? s.pointsCost.toLocaleString() : "—"}
                        </span>
                      </span>
                      <span>
                        <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">Cash rate</span>
                        <span className="tabular-nums font-semibold">{formatMoney(s.hotelCostCents, currency)}</span>
                      </span>
                      <span>
                        <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted">Pocket</span>
                        <span className="tabular-nums font-semibold text-negative">
                          {formatMoney(s.pocketCostCents, currency)}
                        </span>
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted">No stays match these filters.</p>
            ) : null}
          </section>
        </>
      )}

      {adding || editing ? (
        <StayModal
          stay={editing}
          cards={cards}
          currency={currency}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-background px-2 py-2 text-center ring-1 ring-line">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums" style={{ color }}>{value}</div>
      {sub ? <div className="mt-0.5 text-[9px] font-medium text-muted">{sub}</div> : null}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
        active
          ? "bg-black/10 text-foreground dark:bg-white/15"
          : "text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );
}

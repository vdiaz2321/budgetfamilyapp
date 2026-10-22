"use client";

// The Social Security earnings record on the plan form (Victor, 2026-10-22):
// read the SSA statement once, then add a year at a time — the Invest page's
// import + "Add month" pattern. The statement is read on this device; only
// its numbers go to the server (lib/ssa-statement-pdf, lib/ssa-statement).

import { useMemo, useState, useTransition } from "react";
import { ModalShell } from "@/components/modal-shell";
import { displayToCents, formatMoneyWhole } from "@/lib/money";
import {
  benefitAtStartCents,
  recordRetirementPiaCents,
  spousalFactor,
  statementCheck,
  type SsRecord,
  type SsStatementFigures,
} from "@/lib/ssa";
import { earningsByYear, parseSsaStatementText, type SsStatement } from "@/lib/ssa-statement";
import { clearSsRecord, deleteSsYear, importSsStatement, saveSsYear } from "./actions";

const box = "rounded-md bg-surface px-2 py-1.5 text-sm tabular-nums ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-brand";
const label = "block max-sm:text-[12px] sm:text-sm font-bold uppercase tracking-wide text-foreground";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The first month a claim at `age` can be paid: at 62, the month after the birthday. */
function claimStart(birthYear: number, birthMonth: number, age: number): [number, number] {
  if (age !== 62) return [birthYear + age, birthMonth];
  return birthMonth === 12 ? [birthYear + 63, 1] : [birthYear + 62, birthMonth + 1];
}

export function SsRecordSection({
  record,
  birthYear,
  spouseBirthYear,
  spouseClaimAge,
  thisYear,
  currency,
}: {
  record: SsRecord | null;
  birthYear: number | null;
  spouseBirthYear: number | null;
  spouseClaimAge: number | null;
  thisYear: number;
  currency: string;
}) {
  const [importing, setImporting] = useState(false);
  const [year, setYear] = useState("");
  const [amount, setAmount] = useState("");
  const [claimAge, setClaimAge] = useState(spouseClaimAge == null ? "" : String(spouseClaimAge));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const money = (c: number) => formatMoneyWhole(c, currency);
  const birthMonth = record?.birthMonth ?? 1;
  const lastPosted = record?.statement ? Number(record.statement.statementDate.slice(0, 4)) - 1 : thisYear - 1;

  // His benefit at 62, 67 and 70 from the record as it stands.
  const atAge = useMemo(() => {
    if (!record || birthYear == null) return null;
    return [62, 67, 70].map((age) => {
      const [y, m] = claimStart(birthYear, birthMonth, age);
      const pia = recordRetirementPiaCents(record, birthYear, y, thisYear);
      return { age, cents: benefitAtStartCents(pia, birthYear, birthMonth, y, m) };
    });
  }, [record, birthYear, birthMonth, thisYear]);

  // The calculator on the statement's own assumptions: does it land on the statement?
  const check = useMemo(() => {
    if (!record?.statement || birthYear == null) return null;
    const c = statementCheck(record, birthYear);
    if (!c) return null;
    const off = Object.entries(record.statement.retirementByAge).reduce(
      (worst, [age, cents]) => Math.max(worst, Math.abs((c.retirementByAge[age] ?? 0) - cents)),
      0,
    );
    return { off };
  }, [record, birthYear]);

  const spousal = useMemo(() => {
    const age = Number(claimAge);
    if (!record || birthYear == null || spouseBirthYear == null || !age) return null;
    const [y] = claimStart(birthYear, birthMonth, 67);
    const pia = recordRetirementPiaCents(record, birthYear, y, thisYear);
    const early = Math.max(0, (67 - age) * 12);
    return Math.floor((pia / 200) * spousalFactor(early) + 1e-7) * 100;
  }, [record, birthYear, birthMonth, spouseBirthYear, claimAge, thisYear]);

  const run = (fn: () => Promise<{ error: string | null }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
      if (!r.error) after?.();
    });

  const saveYear = () => {
    const fd = new FormData();
    fd.set("year", year.trim());
    fd.set("earnings", amount.trim());
    run(() => saveSsYear(fd), () => {
      setYear("");
      setAmount("");
    });
  };

  const rows = record?.earnings ?? [];
  const posted = rows.filter((r) => r.year <= lastPosted).reduce((t, r) => t + r.cents, 0);

  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="rounded-lg bg-sky-100 px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-sky-200 dark:bg-sky-900/50 dark:hover:bg-sky-900"
        >
          {record ? "Import a newer statement" : "Import SSA statement (PDF)"}
        </button>
        <a
          href="https://www.ssa.gov/myaccount/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold underline underline-offset-2"
          style={{ color: "var(--viz-savings)" }}
        >
          Get it at my Social Security
        </a>
        {record ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Remove the Social Security record? The plan goes back to the amount typed on the line.")) run(clearSsRecord);
            }}
            className="ml-auto rounded-md px-2 py-1 text-sm font-semibold text-negative ring-1 ring-line transition hover:bg-sky-50 disabled:opacity-50 dark:hover:bg-sky-950/40"
          >
            Remove record
          </button>
        ) : null}
      </div>
      <p className="text-xs text-foreground sm:text-sm">Read on this device: only the numbers are saved.</p>

      {record && atAge ? (
        <div className="overflow-x-auto rounded-lg ring-1 ring-line">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="bg-sky-50 dark:bg-sky-950/40">
                <th className="px-3 py-1.5 text-left font-bold">Monthly benefit</th>
                {atAge.map((a) => (
                  <th key={a.age} className="px-3 py-1.5 text-center font-bold">At {a.age}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-3 py-1.5 font-semibold">Your plan</td>
                {atAge.map((a) => (
                  <td key={a.age} className="px-3 py-1.5 text-center font-semibold" style={{ color: "var(--viz-income)" }}>
                    {money(a.cents)}
                  </td>
                ))}
              </tr>
              {record.statement ? (
                <tr>
                  <td className="px-3 py-1.5">
                    Statement
                    {record.statement.assumedEarningsCents ? (
                      <span className="block text-xs sm:text-sm">
                        Assumes {money(record.statement.assumedEarningsCents)}/yr to then
                      </span>
                    ) : null}
                  </td>
                  {atAge.map((a) => (
                    <td key={a.age} className="px-3 py-1.5 text-center">
                      {record.statement!.retirementByAge[String(a.age)] != null ? money(record.statement!.retirementByAge[String(a.age)]) : "—"}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {check ? (
        <p className={`text-xs sm:text-sm ${check.off <= 200 ? "text-positive" : "text-negative"}`}>
          {check.off <= 200
            ? "✓ On the statement's assumptions, the calculator matches it."
            : `On the statement's assumptions, the calculator is off by up to ${money(check.off)}/mo.`}
        </p>
      ) : null}

      {record ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-line">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="bg-sky-50 dark:bg-sky-950/40">
                <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Year</th>
                <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Age</th>
                <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Earnings</th>
                <th className="px-1.5 sm:px-3 py-1.5 text-center font-bold">Source</th>
                <th className="w-0 px-1 py-1.5 sm:px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr
                  key={r.year}
                  onClick={() => {
                    setYear(String(r.year));
                    setAmount((r.cents / 100).toFixed(2));
                  }}
                  className={`cursor-pointer transition hover:bg-sky-50 dark:hover:bg-sky-950/40 ${String(r.year) === year ? "bg-sky-50 dark:bg-sky-950/40" : ""}`}
                >
                  <td className="px-1.5 sm:px-3 py-1 text-center">{r.year}</td>
                  <td className="px-1.5 sm:px-3 py-1 text-center">{birthYear != null ? r.year - birthYear : "—"}</td>
                  <td className="px-1.5 sm:px-3 py-1 text-right" style={{ color: r.year <= lastPosted ? "var(--viz-income)" : "var(--viz-savings)" }}>
                    {money(r.cents)}
                  </td>
                  <td className="px-1.5 sm:px-3 py-1 text-center text-xs sm:text-sm">
                    {r.year > lastPosted ? "Planned" : r.split ? "Split" : "SSA"}
                  </td>
                  <td className="px-1 py-1 text-right sm:px-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={(e) => {
                        e.stopPropagation();
                        run(() => deleteSsYear(r.year));
                      }}
                      aria-label={`Remove ${r.year}`}
                      className="rounded px-1.5 text-negative transition hover:bg-sky-100 disabled:opacity-50 dark:hover:bg-sky-900/50"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={2} className="px-1.5 sm:px-3 py-1.5 text-center">Posted total</td>
                <td className="px-1.5 sm:px-3 py-1.5 text-right" style={{ color: "var(--viz-income)" }}>{money(posted)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.some((r) => r.split) ? (
        <p className="text-xs text-foreground sm:text-sm">Split: spread from a combined range. Type each year for exact numbers.</p>
      ) : null}

      {/* One year by hand: next year's posted earnings, or a planned one. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-24">
          <span className={label}>Year</span>
          <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder={String(thisYear)} className={`${box} mt-1 w-full text-center`} />
        </label>
        <label className="w-36">
          <span className={label}>Earnings</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={`${box} mt-1 w-full text-center`} />
        </label>
        <button
          type="button"
          disabled={pending || !year.trim() || !amount.trim()}
          onClick={saveYear}
          className="h-[34px] rounded-md bg-brand px-3 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? "Saving…" : rows.some((r) => String(r.year) === year.trim()) ? "Update year" : "Add year"}
        </button>
      </div>
      <p className="text-xs text-foreground sm:text-sm">Future years: in that year&rsquo;s dollars.</p>

      {spouseBirthYear != null && record ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={label}>Spouse&rsquo;s spousal benefit</span>
          <select
            name="spouseSsClaimAge"
            value={claimAge}
            onChange={(e) => setClaimAge(e.target.value)}
            aria-label="Spouse's spousal benefit starts at age"
            className={`${box} cursor-pointer`}
          >
            <option value="">None</option>
            {[62, 63, 64, 65, 66, 67].map((a) => (
              <option key={a} value={a}>From age {a} ({spouseBirthYear + a})</option>
            ))}
          </select>
          {spousal != null ? (
            <span className="text-sm font-semibold" style={{ color: "var(--viz-income)" }}>
              {money(spousal)}/mo
            </span>
          ) : null}
          <span className="basis-full text-xs text-foreground sm:text-sm">No record of her own: half your benefit at 67, less before. Starts once you start yours.</span>
        </div>
      ) : null}

      {error ? <p className="text-sm font-medium text-negative">{error}</p> : null}
      {importing ? (
        <SsImportModal
          currency={currency}
          onClose={() => setImporting(false)}
          onSaved={() => setImporting(false)}
        />
      ) : null}
    </div>
  );
}

/** A combined range on the statement, typed out year by year. */
type RangeDraft = { from: number; to: number; cents: number; years: Record<number, string>; even: Record<number, string> };

function SsImportModal({ currency, onClose, onSaved }: { currency: string; onClose: () => void; onSaved: () => void }) {
  const [parsed, setParsed] = useState<SsStatement | null>(null);
  const [ranges, setRanges] = useState<RangeDraft[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const money = (c: number) => formatMoneyWhole(c, currency);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setParsed(null);
    setReading(true);
    try {
      const { readSsaStatementPdf } = await import("@/lib/ssa-statement-pdf");
      const s = parseSsaStatementText(await readSsaStatementPdf(file));
      if (!s) setError("That doesn't look like a Social Security Statement.");
      else {
        setParsed(s);
        // Combined ranges start spread evenly; each year can be typed over.
        const even = earningsByYear(s);
        setRanges(
          s.earnings
            .filter((r) => r.to > r.from)
            .map((r) => {
              const years = Object.fromEntries(
                even.filter((e) => e.year >= r.from && e.year <= r.to).map((e) => [e.year, (e.cents / 100).toFixed(2)]),
              );
              return { ...r, years, even: years };
            }),
        );
      }
    } catch {
      setError("Couldn't read that PDF.");
    } finally {
      setReading(false);
    }
  };

  const rangeTotal = (r: RangeDraft) => Object.values(r.years).reduce((t, v) => t + displayToCents(v || "0"), 0);
  const rangesOk = ranges.every((r) => rangeTotal(r) === r.cents);

  const save = () => {
    if (!parsed) return;
    const earnings = [
      ...parsed.earnings.filter((r) => r.to === r.from).map((r) => ({ year: r.from, cents: r.cents })),
      // "Split" only while a range is left spread evenly; typed out, it's exact.
      ...ranges.flatMap((r) => {
        const typed = Object.keys(r.years).some((y) => r.years[Number(y)] !== r.even[Number(y)]);
        return Object.entries(r.years).map(([y, v]) => ({ year: Number(y), cents: displayToCents(v || "0"), split: !typed }));
      }),
    ].sort((a, b) => a.year - b.year);
    const statement: SsStatementFigures = {
      statementDate: parsed.statementDate,
      retirementByAge: Object.fromEntries(Object.entries(parsed.retirementByAge).map(([a, c]) => [String(a), c])),
      disabilityCents: parsed.disabilityCents,
      survivors: parsed.survivors,
      assumedEarningsCents: parsed.assumedEarningsCents,
    };
    start(async () => {
      const r = await importSsStatement({ birthMonth: parsed.birthMonth, statement, earnings });
      if (r.error) setError(r.error);
      else onSaved();
    });
  };

  const [sy, sm, sd] = parsed ? parsed.statementDate.split("-").map(Number) : [0, 0, 0];

  return (
    <ModalShell
      title="Import SSA statement"
      onClose={onClose}
      className="sm:max-w-2xl"
      headerEnd={
        <>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm font-semibold ring-1 ring-line transition hover:bg-sky-100 hover:ring-sky-400 dark:hover:bg-sky-950/40">
            Cancel
          </button>
          <button
            type="button"
            disabled={!parsed || !rangesOk || pending}
            onClick={save}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save record"}
          </button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <label className="block">
          <span className={label}>Statement PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => void read(e.target.files?.[0])}
            className="mt-1 block w-full rounded-md bg-sky-50 px-2 py-1.5 text-sm text-foreground ring-1 ring-line file:mr-2 file:rounded file:border-0 file:bg-sky-100 file:px-2 file:py-1 file:text-sm file:font-semibold file:text-foreground dark:bg-background dark:file:bg-sky-900/50"
          />
        </label>
        <p className="text-xs text-foreground sm:text-sm">Read on this device. The file isn&rsquo;t uploaded or kept; your name isn&rsquo;t saved.</p>
        {reading ? <p className="text-sm">Reading…</p> : null}
        {error ? <p className="text-sm font-medium text-negative">{error}</p> : null}

        {parsed ? (
          <>
            <ul className="divide-y divide-line rounded-lg text-sm ring-1 ring-line">
              <li className="flex justify-between gap-3 px-3 py-1.5">
                <span>Statement date</span>
                <span className="font-semibold">{MONTHS[sm - 1]} {sd}, {sy}</span>
              </li>
              <li className="flex justify-between gap-3 px-3 py-1.5">
                <span>Benefit at 62 · 67 · 70</span>
                <span className="font-semibold tabular-nums" style={{ color: "var(--viz-income)" }}>
                  {[62, 67, 70].map((a) => (parsed.retirementByAge[a] != null ? money(parsed.retirementByAge[a]) : "—")).join(" · ")}
                </span>
              </li>
              {parsed.survivors ? (
                <li className="flex justify-between gap-3 px-3 py-1.5">
                  <span>Survivors: child · family max</span>
                  <span className="font-semibold tabular-nums" style={{ color: "var(--viz-income)" }}>
                    {money(parsed.survivors.childCents)} · {money(parsed.survivors.familyMaxCents)}
                  </span>
                </li>
              ) : null}
              <li className="flex justify-between gap-3 px-3 py-1.5">
                <span>Years of earnings</span>
                <span className="font-semibold tabular-nums">
                  {parsed.earnings[0]?.from}–{parsed.earnings.at(-1)?.to} · {money(parsed.earnings.reduce((t, r) => t + r.cents, 0))}
                </span>
              </li>
            </ul>

            {ranges.map((r, i) => {
              const total = rangeTotal(r);
              return (
                <div key={r.from} className="space-y-2 rounded-lg px-3 pb-3 pt-2 ring-1 ring-line">
                  <p className="text-sm font-semibold">
                    {r.from}–{r.to} combined: {money(r.cents)}
                  </p>
                  <p className="text-xs text-foreground sm:text-sm">Split evenly. Type each year if you have it.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {Object.keys(r.years).map((y) => (
                      <label key={y} className="block">
                        <span className="block text-xs font-bold sm:text-sm">{y}</span>
                        <input
                          value={r.years[Number(y)]}
                          onChange={(e) =>
                            setRanges((prev) =>
                              prev.map((x, j) => (j === i ? { ...x, years: { ...x.years, [y]: e.target.value } } : x)),
                            )
                          }
                          inputMode="decimal"
                          className={`${box} mt-0.5 w-full text-center`}
                        />
                      </label>
                    ))}
                  </div>
                  <p className={`text-xs sm:text-sm ${total === r.cents ? "text-positive" : "text-negative"}`}>
                    {total === r.cents ? `✓ Adds up to ${money(r.cents)}` : `Adds up to ${money(total)}, needs ${money(r.cents)}`}
                  </p>
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </ModalShell>
  );
}
